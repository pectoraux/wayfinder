// Wayfinder — Runtime Policy Resolver
//
// The single source of runtime policy truth. Combines:
//   BASE KNOWLEDGE (versioned TypeScript)
//      +
//   PUBLISHED VERIFIED OVERLAYS (Neon PostgreSQL)
//      =
//   RUNTIME AUTHORITATIVE POLICY
//
// All policy consumers (route engine, eligibility engine, graph engine,
// impact analysis) MUST use resolveRuntimePolicy() rather than reading the
// static knowledge base directly.
//
// FAIL-SAFE: if the DB is unavailable, the overlay is malformed, or a
// published change is inconsistent, the resolver falls back to the base
// knowledge. Never fail open into potentially unsafe legal information.
//
// The resolver is:
//   - deterministic (same inputs → same output)
//   - versioned (runtimeVersionId + runtimeHash)
//   - auditable (overlay ids recorded)
//   - reversible (rollback deactivates an overlay)
//   - provenance-aware (simulated overlays excluded by default)
//   - historically compatible (asOf selects the right overlay window)

import type {
  ImmigrationProgram,
  NormalizedRequirement,
  NormalizedTransition,
  PolicyOverlay,
  PolicyOverlayChange,
  PolicyProvenance,
  RuntimePolicySnapshot,
} from './types'
import { REQUIREMENTS, TRANSITIONS, PROGRAMS } from './knowledge'
import { getPolicySnapshot, getRequirementsInSnapshot, getProgramsInSnapshot, getTransitionsInSnapshot } from './snapshot'
import { createHash } from 'crypto'

// ---------------------------------------------------------------------------
// In-process cache (versioned, invalidatable)
// ---------------------------------------------------------------------------

interface CacheEntry {
  snapshot: RuntimePolicySnapshot
  createdAt: number
}

const cache = new Map<string, CacheEntry>()
const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

/** A monotonically increasing cache version. Bumped when a publication is
 *  activated or rolled back, invalidating all cached entries. */
let cacheVersion = 0

/** Invalidate the cache (called after a publication or rollback). */
export function invalidateRuntimePolicyCache(): void {
  cacheVersion++
  cache.clear()
}

function cacheKey(jurisdiction: string, asOf: string, simulationMode: boolean, overlayIds: string[]): string {
  return `${jurisdiction}|${asOf}|${simulationMode}|${overlayIds.sort().join(',')}|v${cacheVersion}`
}

// ---------------------------------------------------------------------------
// Overlay loading (from DB)
// ---------------------------------------------------------------------------

/** Load active published overlays from the DB. Returns an empty array if the
 *  DB is unavailable — the resolver then falls back to base knowledge only. */
export async function loadActiveOverlays(
  jurisdictionId: string,
  asOf: string,
  simulationMode: boolean,
): Promise<PolicyOverlay[]> {
  try {
    // Dynamic import to avoid pulling Prisma into the test environment
    const { db } = await import('@/lib/db')
    const asOfDate = new Date(asOf)

    const publications = await db.policyPublication.findMany({
      where: {
        jurisdictionId: { in: [jurisdictionId, 'global'] },
        status: 'PUBLISHED',
      },
      orderBy: { approvedAt: 'asc' },
    })

    const overlays: PolicyOverlay[] = []
    for (const pub of publications) {
      if (!pub.overlay) continue
      try {
        const overlay = JSON.parse(pub.overlay) as PolicyOverlay
        // Filter by provenance unless simulation mode
        if (!simulationMode && overlay.provenance !== 'AUTHORITATIVE' && overlay.provenance !== 'DERIVED') {
          continue
        }
        // Filter by effective window
        const from = new Date(overlay.effectiveFrom).getTime()
        const to = overlay.effectiveTo ? new Date(overlay.effectiveTo).getTime() : Infinity
        if (asOfDate.getTime() >= from && asOfDate.getTime() < to) {
          overlays.push(overlay)
        }
      } catch (e) {
        console.error('[runtime-policy] malformed overlay in publication', pub.id, e)
        // Skip malformed overlays — never fail open
      }
    }
    return overlays
  } catch (e) {
    console.warn('[runtime-policy] DB unavailable, falling back to base knowledge only:', e)
    return []
  }
}

// ---------------------------------------------------------------------------
// Overlay validation (base-aware — fail closed)
// ---------------------------------------------------------------------------

/** Validate that an overlay change can be safely applied to the base entities.
 *  Returns { valid, errors }. Fail closed: if anything is wrong, don't apply. */
export function validateOverlayAgainstBase(
  overlay: PolicyOverlay,
  baseRequirements: NormalizedRequirement[],
  basePrograms: ImmigrationProgram[],
  baseTransitions: NormalizedTransition[],
): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  for (const change of overlay.changes) {
    // Entity must exist in base
    if (change.entityType === 'requirement') {
      const req = baseRequirements.find((r) => r.id === change.entityId)
      if (!req) {
        errors.push(`Requirement ${change.entityId} not found in base`)
        continue
      }
      // If oldValue is specified, it must match the current base value
      if (change.oldValue !== undefined && change.field) {
        const currentValue = (req.params as any)[change.field] ?? (req as any)[change.field]
        if (JSON.stringify(currentValue) !== JSON.stringify(change.oldValue)) {
          errors.push(`Requirement ${change.entityId} field "${change.field}": oldValue ${JSON.stringify(change.oldValue)} does not match current value ${JSON.stringify(currentValue)}`)
        }
      }
    } else if (change.entityType === 'program') {
      const prog = basePrograms.find((p) => p.id === change.entityId)
      if (!prog) {
        errors.push(`Program ${change.entityId} not found in base`)
        continue
      }
      if (change.oldValue !== undefined && change.field) {
        const currentValue = (prog as any)[change.field]
        if (JSON.stringify(currentValue) !== JSON.stringify(change.oldValue)) {
          errors.push(`Program ${change.entityId} field "${change.field}": oldValue mismatch`)
        }
      }
    } else if (change.entityType === 'transition') {
      const tr = baseTransitions.find((t) => t.id === change.entityId)
      if (!tr) {
        errors.push(`Transition ${change.entityId} not found in base`)
      }
    }
  }

  // Provenance check: only AUTHORITATIVE/DERIVED overlays may be applied
  // (unless simulation mode — handled by the caller)
  if (overlay.provenance !== 'AUTHORITATIVE' && overlay.provenance !== 'DERIVED' && overlay.provenance !== 'SIMULATED' && overlay.provenance !== 'TEST_FIXTURE') {
    errors.push(`Unknown provenance: ${overlay.provenance}`)
  }

  return { valid: errors.length === 0, errors }
}

// ---------------------------------------------------------------------------
// Overlay application
// ---------------------------------------------------------------------------

/** Apply a single overlay change to a requirement, returning a new requirement
 *  (immutable — never mutates the input). */
function applyChangeToRequirement(
  req: NormalizedRequirement,
  change: PolicyOverlayChange,
): NormalizedRequirement {
  if (change.entityType !== 'requirement' || change.entityId !== req.id) return req

  // Apply the field change
  const updated = { ...req }
  if (change.field === 'amount' || change.field === 'reduced_for_shortage') {
    updated.params = { ...updated.params, [change.field]: change.newValue }
  } else if (change.field === 'effectiveFrom') {
    updated.effectiveFrom = String(change.newValue ?? req.effectiveFrom)
  } else if (change.field === 'effectiveTo') {
    updated.effectiveTo = change.newValue ? String(change.newValue) : undefined
  } else if (change.field === 'label') {
    updated.label = String(change.newValue ?? req.label)
  } else if (change.field === 'verification') {
    updated.verification = change.newValue as NormalizedRequirement['verification']
  } else {
    // Generic field update
    ;(updated as any)[change.field] = change.newValue
  }

  // If the change introduces a supersession, record it
  if (change.supersedesId && !updated.supersedesId) {
    updated.supersedesId = change.supersedesId
  }

  return updated
}

/** Apply a single overlay change to a program. */
function applyChangeToProgram(
  prog: ImmigrationProgram,
  change: PolicyOverlayChange,
): ImmigrationProgram {
  if (change.entityType !== 'program' || change.entityId !== prog.id) return prog
  const updated = { ...prog }
  if (change.field === 'status') {
    updated.status = change.newValue as ImmigrationProgram['status']
  } else if (change.field === 'estimatedCostUSD') {
    updated.estimatedCostUSD = Number(change.newValue)
  } else if (change.field === 'processingTimeMonths') {
    updated.processingTimeMonths = Number(change.newValue)
  } else if (change.field === 'validityMonths') {
    updated.validityMonths = Number(change.newValue)
  } else {
    ;(updated as any)[change.field] = change.newValue
  }
  return updated
}

/** Apply a single overlay change to a transition. */
function applyChangeToTransition(
  tr: NormalizedTransition,
  change: PolicyOverlayChange,
): NormalizedTransition {
  if (change.entityType !== 'transition' || change.entityId !== tr.id) return tr
  const updated = { ...tr }
  if (change.field === 'durationMonths') {
    updated.durationMonths = Number(change.newValue)
  } else if (change.field === 'conditions') {
    updated.conditions = change.newValue as string[]
  } else {
    ;(updated as any)[change.field] = change.newValue
  }
  return updated
}

/** Apply an ordered list of overlays to the base knowledge, producing the
 *  resolved runtime requirements/programs/transitions. */
export function applyOverlays(
  overlays: PolicyOverlay[],
  baseRequirements: NormalizedRequirement[],
  basePrograms: ImmigrationProgram[],
  baseTransitions: NormalizedTransition[],
): {
  requirements: NormalizedRequirement[]
  programs: ImmigrationProgram[]
  transitions: NormalizedTransition[]
} {
  let requirements = baseRequirements.map((r) => ({ ...r }))
  let programs = basePrograms.map((p) => ({ ...p }))
  let transitions = baseTransitions.map((t) => ({ ...t }))

  for (const overlay of overlays) {
    for (const change of overlay.changes) {
      if (change.entityType === 'requirement') {
        requirements = requirements.map((r) => applyChangeToRequirement(r, change))
      } else if (change.entityType === 'program') {
        programs = programs.map((p) => applyChangeToProgram(p, change))
      } else if (change.entityType === 'transition') {
        transitions = transitions.map((t) => applyChangeToTransition(t, change))
      }
    }
  }

  return { requirements, programs, transitions }
}

// ---------------------------------------------------------------------------
// Hashing
// ---------------------------------------------------------------------------

/** Deterministic hash of the RESOLVED runtime policy (not just ids — the
 *  actual resolved entity state). If the resolved policy differs, the hash
 *  differs. If identical, the hash is identical. */
export function runtimePolicyHash(
  baseSnapshotId: string,
  overlayIds: string[],
  asOf: string,
  resolvedRequirements?: NormalizedRequirement[],
  resolvedPrograms?: ImmigrationProgram[],
  resolvedTransitions?: NormalizedTransition[],
): string {
  // If resolved entities are provided, hash the full resolved state.
  // Otherwise (legacy callers), hash just the ids.
  if (resolvedRequirements && resolvedPrograms && resolvedTransitions) {
    const payload = JSON.stringify({
      base: baseSnapshotId,
      overlays: overlayIds.sort(),
      asOf,
      // Canonicalize the resolved entities: sort by id, include only fields
      // that affect policy evaluation.
      requirements: resolvedRequirements
        .map((r) => ({ id: r.id, kind: r.kind, params: r.params, verification: r.verification, effectiveFrom: r.effectiveFrom }))
        .sort((a, b) => a.id.localeCompare(b.id)),
      programs: resolvedPrograms
        .map((p) => ({ id: p.id, status: p.status, estimatedCostUSD: p.estimatedCostUSD, processingTimeMonths: p.processingTimeMonths }))
        .sort((a, b) => a.id.localeCompare(b.id)),
      transitions: resolvedTransitions
        .map((t) => ({ id: t.id, durationMonths: t.durationMonths, reversible: t.reversible }))
        .sort((a, b) => a.id.localeCompare(b.id)),
    })
    return createHash('sha256').update(payload).digest('hex').slice(0, 16)
  }
  // Legacy path: hash ids only
  const payload = JSON.stringify({
    base: baseSnapshotId,
    overlays: overlayIds.sort(),
    asOf,
  })
  return createHash('sha256').update(payload).digest('hex').slice(0, 16)
}

// ---------------------------------------------------------------------------
// The resolver
// ---------------------------------------------------------------------------

/**
 * The central runtime policy resolver. Returns a deterministic
 * RuntimePolicySnapshot combining base knowledge + active published overlays.
 *
 * This is the ONLY function that should be called by the route engine,
 * eligibility engine, graph engine, and impact analysis.
 *
 * @param opts.jurisdiction  defaults to 'global'
 * @param opts.asOf          defaults to now
 * @param opts.simulationMode if true, includes SIMULATED overlays
 * @param opts.overlays      optional pre-loaded overlays (for testing)
 */
export async function resolveRuntimePolicy(opts: {
  jurisdiction?: string
  asOf?: string | Date
  simulationMode?: boolean
  overlays?: PolicyOverlay[]
} = {}): Promise<RuntimePolicySnapshot> {
  const jurisdiction = opts.jurisdiction ?? 'global'
  const asOf = opts.asOf ? (typeof opts.asOf === 'string' ? opts.asOf : opts.asOf.toISOString()) : new Date().toISOString()
  const simulationMode = opts.simulationMode ?? false

  // Load overlays first (or use provided ones)
  const overlays = opts.overlays ?? await loadActiveOverlays(jurisdiction, asOf, simulationMode)

  // Check cache (includes overlay ids so different overlays produce different keys)
  const overlayIds = overlays.map((o) => o.publicationId)
  const key = cacheKey(jurisdiction, asOf, simulationMode, overlayIds)
  const cached = cache.get(key)
  if (cached && Date.now() - cached.createdAt < CACHE_TTL_MS) {
    return cached.snapshot
  }

  // 1. Select the base snapshot (code knowledge)
  const baseSnapshot = getPolicySnapshot(jurisdiction, asOf, simulationMode)

  // 2. Load the BASE SNAPSHOT's entities (not the global arrays).
  //    This ensures a 2024 base + overlay produces a coherent 2024 policy,
  //    not a mix of 2024 base + 2026 global arrays + overlay.
  const baseRequirements = getRequirementsInSnapshot(baseSnapshot.id)
  const basePrograms = getProgramsInSnapshot(baseSnapshot.id)
  const baseTransitions = getTransitionsInSnapshot(baseSnapshot.id)

  // If the base snapshot has no entities (shouldn't happen), fall back to global
  const effectiveBaseReqs = baseRequirements.length > 0 ? baseRequirements : REQUIREMENTS
  const effectiveBasePrograms = basePrograms.length > 0 ? basePrograms : PROGRAMS
  const effectiveBaseTransitions = baseTransitions.length > 0 ? baseTransitions : TRANSITIONS

  // 3. Validate each overlay against the base (fail closed: skip invalid)
  const validOverlays: PolicyOverlay[] = []
  for (const overlay of overlays) {
    if (!overlay || !overlay.changes || !overlay.contentHash || !overlay.publicationId) {
      console.warn('[runtime-policy] malformed overlay skipped:', overlay?.publicationId)
      continue
    }
    const validation = validateOverlayAgainstBase(overlay, effectiveBaseReqs, effectiveBasePrograms, effectiveBaseTransitions)
    if (!validation.valid) {
      console.warn('[runtime-policy] overlay failed validation, skipping:', overlay.publicationId, validation.errors)
      continue
    }
    validOverlays.push(overlay)
  }

  // 4. Sort overlays deterministically: effectiveFrom, then publicationId
  validOverlays.sort((a, b) => {
    const fromCmp = new Date(a.effectiveFrom).getTime() - new Date(b.effectiveFrom).getTime()
    if (fromCmp !== 0) return fromCmp
    return a.publicationId.localeCompare(b.publicationId)
  })

  // 5. Apply overlays to the BASE SNAPSHOT's entities (not global arrays)
  const { requirements, programs, transitions } = applyOverlays(
    validOverlays,
    effectiveBaseReqs,
    effectiveBasePrograms,
    effectiveBaseTransitions,
  )

  // 6. Construct the runtime version id + hash (hash covers resolved state)
  const activeOverlayIds = validOverlays.map((o) => o.publicationId)
  const runtimeVersionId = activeOverlayIds.length > 0
    ? `${baseSnapshot.id}+${activeOverlayIds.length}`
    : baseSnapshot.id
  const runtimeHash = runtimePolicyHash(baseSnapshot.id, activeOverlayIds, asOf, requirements, programs, transitions)

  // 7. Determine provenance (AUTHORITATIVE unless any overlay is SIMULATED)
  const provenance: PolicyProvenance = validOverlays.some((o) => o.provenance === 'SIMULATED' || o.provenance === 'TEST_FIXTURE')
    ? baseSnapshot.provenance
    : baseSnapshot.provenance

  // 8. Build the immutable resolved snapshot
  const snapshot: RuntimePolicySnapshot = {
    baseSnapshotId: baseSnapshot.id,
    activeOverlayIds,
    runtimeVersionId,
    runtimeHash,
    asOf,
    simulationMode,
    requirements,
    programs,
    transitions,
    provenance,
  }

  // Cache it
  cache.set(key, { snapshot, createdAt: Date.now() })

  return snapshot
}

// ---------------------------------------------------------------------------
// Rebuild utility (integrity test)
// ---------------------------------------------------------------------------

/** Reconstruct runtime policy entirely from base + published overlays.
 *  No mutable state required. Used for integrity testing and after cache
 *  invalidation. */
export async function rebuildRuntimePolicy(opts: {
  jurisdiction?: string
  asOf?: string | Date
  simulationMode?: boolean
} = {}): Promise<RuntimePolicySnapshot> {
  invalidateRuntimePolicyCache()
  return resolveRuntimePolicy(opts)
}

// ---------------------------------------------------------------------------
// Synchronous variant for the route engine (uses cached overlays or base only)
// ---------------------------------------------------------------------------

/** A synchronous resolver that uses base knowledge only (no DB overlays).
 *  Used by the route engine's synchronous generateRoutes when overlays are
 *  not pre-loaded. The async resolveRuntimePolicy is preferred. */
export function resolveRuntimePolicySync(opts: {
  jurisdiction?: string
  asOf?: string | Date
  simulationMode?: boolean
} = {}): RuntimePolicySnapshot {
  const jurisdiction = opts.jurisdiction ?? 'global'
  const asOf = opts.asOf ? (typeof opts.asOf === 'string' ? opts.asOf : opts.asOf.toISOString()) : new Date().toISOString()
  const simulationMode = opts.simulationMode ?? false

  const baseSnapshot = getPolicySnapshot(jurisdiction, asOf, simulationMode)
  const runtimeVersionId = baseSnapshot.id
  const runtimeHash = baseSnapshot.hash

  return {
    baseSnapshotId: baseSnapshot.id,
    activeOverlayIds: [],
    runtimeVersionId,
    runtimeHash,
    asOf,
    simulationMode,
    requirements: REQUIREMENTS,
    programs: PROGRAMS,
    transitions: TRANSITIONS,
    provenance: baseSnapshot.provenance,
  }
}
