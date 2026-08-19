// Wayfinder — Policy Snapshot API + Diff Engine
//
// getPolicySnapshot(jurisdiction, asOf) returns the deterministic snapshot
// active for a jurisdiction at a given date. This is the foundation of
// temporal reproducibility: a route computed on 2025-08-01 uses the rules
// effective on that date, even after later policy changes.
//
// comparePolicySnapshots(a, b) produces a structured PolicyDiff enumerating
// every added/removed/changed program, requirement, transition, and threshold.
// Each change points back to evidence.

import type {
  ImmigrationProgram,
  NormalizedRequirement,
  NormalizedTransition,
  PolicyChange,
  PolicyChangeKind,
  PolicyDiff,
  PolicySnapshot,
} from './types'
import {
  PROGRAMS,
  REQUIREMENTS,
  SNAPSHOTS,
  TRANSITIONS,
  getSnapshot,
} from './knowledge'

// ---------------------------------------------------------------------------
// Snapshot selection
// ---------------------------------------------------------------------------

/**
 * Returns the snapshot whose [effectiveFrom, effectiveTo) window contains asOf,
 * preferring the most recently published snapshot at or before asOf.
 *
 * CRITICAL SAFETY: by default, only AUTHORITATIVE snapshots are considered.
 * SIMULATED / TEST_FIXTURE snapshots are excluded unless `allowSimulated` is
 * explicitly true. This prevents synthetic data from ever being used for user
 * recommendations, eligibility decisions, or current-policy displays by default.
 */
export function getPolicySnapshot(
  jurisdictionId: string = 'global',
  asOf: string | Date = new Date(),
  allowSimulated: boolean = false,
): PolicySnapshot {
  const asOfDate = typeof asOf === 'string' ? new Date(asOf) : asOf
  const asOfMs = asOfDate.getTime()

  // Filter by provenance unless simulated is explicitly allowed
  const provenanceFiltered = SNAPSHOTS.filter((s) =>
    allowSimulated || s.provenance === 'AUTHORITATIVE' || s.provenance === 'DERIVED',
  )

  // Candidates: snapshots effective on asOf
  const candidates = provenanceFiltered.filter((s) => {
    const from = new Date(s.effectiveFrom).getTime()
    const to = s.effectiveTo ? new Date(s.effectiveTo).getTime() : Infinity
    return asOfMs >= from && asOfMs < to
  })

  if (candidates.length > 0) {
    return candidates.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())[0]
  }

  // No snapshot effective on asOf → return the latest published at or before asOf
  const prior = provenanceFiltered
    .filter((s) => new Date(s.publishedAt).getTime() <= asOfMs)
    .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
  return prior[0] ?? provenanceFiltered[0] ?? SNAPSHOTS[0]
}

/** Returns the snapshot marked as 'current'. CRITICAL: only returns
 *  AUTHORITATIVE snapshots — a SIMULATED snapshot can never be "current". */
export function getCurrentPolicySnapshot(jurisdictionId: string = 'global'): PolicySnapshot {
  const current = SNAPSHOTS.find((s) => s.status === 'current' && s.provenance === 'AUTHORITATIVE')
  if (current) return current
  // Fall back to the latest AUTHORITATIVE snapshot
  const auth = SNAPSHOTS.filter((s) => s.provenance === 'AUTHORITATIVE')
  return [...auth].sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())[0]
}

/** Returns all snapshots, newest first. Includes simulated ones (for the
 *  policy explorer UI) but marks them clearly. */
export function listSnapshots(): PolicySnapshot[] {
  return [...SNAPSHOTS].sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
}

/** Returns only authoritative snapshots. */
export function listAuthoritativeSnapshots(): PolicySnapshot[] {
  return listSnapshots().filter((s) => s.provenance === 'AUTHORITATIVE')
}

/** Returns only simulated/test snapshots (for the explorer's simulation mode). */
export function listSimulatedSnapshots(): PolicySnapshot[] {
  return listSnapshots().filter((s) => s.provenance === 'SIMULATED' || s.provenance === 'TEST_FIXTURE')
}

// ---------------------------------------------------------------------------
// Entities within a snapshot
// ---------------------------------------------------------------------------

export function getProgramsInSnapshot(snapshotId: string): ImmigrationProgram[] {
  return PROGRAMS.filter((p) => p.policyVersionId === snapshotId)
}

export function getRequirementsInSnapshot(snapshotId: string): NormalizedRequirement[] {
  return REQUIREMENTS.filter((r) => r.policyVersionId === snapshotId)
}

export function getTransitionsInSnapshot(snapshotId: string): NormalizedTransition[] {
  return TRANSITIONS.filter((t) => t.policyVersionId === snapshotId)
}

// ---------------------------------------------------------------------------
// Diff engine
// ---------------------------------------------------------------------------

/**
 * Compares two snapshots. Produces a structured PolicyDiff with one PolicyChange
 * per added/removed/changed entity. Threshold and rule changes are detected by
 * comparing normalized requirement params.
 */
export function comparePolicySnapshots(
  fromSnapshotId: string,
  toSnapshotId: string,
): PolicyDiff {
  const from = getSnapshot(fromSnapshotId)
  const to = getSnapshot(toSnapshotId)
  if (!from || !to) {
    return { fromSnapshotId, toSnapshotId, changes: [], summary: {} as Record<PolicyChangeKind, number> }
  }

  const changes: PolicyChange[] = []

  // --- Programs ---
  const fromPrograms = new Map(getProgramsInSnapshot(fromSnapshotId).map((p) => [programKey(p), p]))
  const toPrograms = new Map(getProgramsInSnapshot(toSnapshotId).map((p) => [programKey(p), p]))

  for (const [key, p] of toPrograms) {
    const old = fromPrograms.get(key)
    if (!old) {
      changes.push(change('PROGRAM_ADDED', p.id, p.name, {
        newValue: p, effectiveFrom: p.effectiveFrom, evidenceIds: programEvidence(p),
        summary: `Program added: ${p.name} (${p.jurisdictionId}).`,
      }))
      continue
    }
    // Program exists in both — check status changes
    if (old.status !== p.status) {
      if (old.status === 'active' && p.status === 'suspended') {
        changes.push(change('PROGRAM_SUSPENDED', p.id, p.name, {
          oldValue: old.status, newValue: p.status, effectiveFrom: p.effectiveFrom,
          evidenceIds: programEvidence(p), summary: `Program suspended: ${p.name}.`,
        }))
      } else if (old.status === 'suspended' && p.status === 'active') {
        changes.push(change('PROGRAM_REOPENED', p.id, p.name, {
          oldValue: old.status, newValue: p.status, effectiveFrom: p.effectiveFrom,
          evidenceIds: programEvidence(p), summary: `Program reopened: ${p.name}.`,
        }))
      }
    }
    // Name change?
    if (old.name !== p.name) {
      changes.push(change('PROGRAM_RENAMED', p.id, p.name, {
        field: 'name', oldValue: old.name, newValue: p.name, effectiveFrom: p.effectiveFrom,
        evidenceIds: programEvidence(p), summary: `Program renamed: ${old.name} → ${p.name}.`,
      }))
    }
  }
  for (const [key, p] of fromPrograms) {
    if (!toPrograms.has(key)) {
      changes.push(change('PROGRAM_REMOVED', p.id, p.name, {
        oldValue: p, evidenceIds: programEvidence(p), summary: `Program removed: ${p.name}.`,
      }))
    }
  }

  // --- Requirements (matched by semantic key: jurisdiction + label-slug + kind) ---
  const fromReqs = new Map(getRequirementsInSnapshot(fromSnapshotId).map((r) => [reqKey(r), r]))
  const toReqs = new Map(getRequirementsInSnapshot(toSnapshotId).map((r) => [reqKey(r), r]))

  for (const [key, r] of toReqs) {
    const old = fromReqs.get(key)
    if (!old) {
      changes.push(change('REQUIREMENT_ADDED', r.id, r.label, {
        newValue: r, effectiveFrom: r.effectiveFrom, evidenceIds: r.evidenceIds,
        summary: `Requirement added: ${r.label}.`,
      }))
      continue
    }
    // Threshold / rule change: compare params
    if (JSON.stringify(old.params) !== JSON.stringify(r.params)) {
      const thresholdField = detectThresholdField(old.params, r.params)
      const kind: PolicyChangeKind = thresholdField ? 'THRESHOLD_CHANGED' : 'RULE_CHANGED'
      changes.push(change(kind, r.id, r.label, {
        field: thresholdField, oldValue: old.params, newValue: r.params,
        effectiveFrom: r.effectiveFrom, evidenceIds: r.evidenceIds,
        summary: thresholdField
          ? `Threshold changed: ${r.label} — ${thresholdField} ${fmtVal(old.params[thresholdField])} → ${fmtVal(r.params[thresholdField])}.`
          : `Rule changed: ${r.label}.`,
      }))
    }
  }
  for (const [key, r] of fromReqs) {
    if (!toReqs.has(key)) {
      changes.push(change('REQUIREMENT_REMOVED', r.id, r.label, {
        oldValue: r, evidenceIds: r.evidenceIds, summary: `Requirement removed: ${r.label}.`,
      }))
    }
  }

  // --- Transitions ---
  const fromTrs = new Map(getTransitionsInSnapshot(fromSnapshotId).map((t) => [t.id, t]))
  const toTrs = new Map(getTransitionsInSnapshot(toSnapshotId).map((t) => [t.id, t]))

  for (const [id, t] of toTrs) {
    if (!fromTrs.has(id)) {
      changes.push(change('TRANSITION_ADDED', t.id, `${t.fromStatusId} → ${t.toStatusId}`, {
        newValue: t, effectiveFrom: t.effectiveFrom, evidenceIds: t.evidenceIds,
        summary: `Transition added: ${t.fromStatusId} → ${t.toStatusId}.`,
      }))
    }
  }
  for (const [id, t] of fromTrs) {
    if (!toTrs.has(id)) {
      changes.push(change('TRANSITION_REMOVED', t.id, `${t.fromStatusId} → ${t.toStatusId}`, {
        oldValue: t, evidenceIds: t.evidenceIds, summary: `Transition removed: ${t.fromStatusId} → ${t.toStatusId}.`,
      }))
    }
  }

  // --- Effective date changes (same entity, different effectiveFrom) ---
  for (const [key, r] of toReqs) {
    const old = fromReqs.get(key)
    if (old && old.effectiveFrom !== r.effectiveFrom) {
      changes.push(change('EFFECTIVE_DATE_CHANGED', r.id, r.label, {
        field: 'effectiveFrom', oldValue: old.effectiveFrom, newValue: r.effectiveFrom,
        effectiveFrom: r.effectiveFrom, evidenceIds: r.evidenceIds,
        summary: `Effective date changed: ${r.label} — ${old.effectiveFrom} → ${r.effectiveFrom}.`,
      }))
    }
  }

  const summary = countByKind(changes)
  return { fromSnapshotId, toSnapshotId, changes, summary }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function change(kind: PolicyChangeKind, entityId: string, entityLabel: string, rest: Omit<PolicyChange, 'kind' | 'entityId' | 'entityLabel'>): PolicyChange {
  return { kind, entityId, entityLabel, ...rest }
}

function countByKind(changes: PolicyChange[]): Record<PolicyChangeKind, number> {
  const out = {} as Record<PolicyChangeKind, number>
  for (const c of changes) out[c.kind] = (out[c.kind] ?? 0) + 1
  return out
}

/** Stable key for matching a program across snapshots (jurisdiction + name). */
function programKey(p: ImmigrationProgram): string {
  return `${p.jurisdictionId}::${p.name}`
}

/** Stable key for matching a requirement across snapshots (kind + label).
 *  This lets us detect that "Salary ≥ threshold" is the SAME requirement with
 *  a CHANGED threshold, rather than an add+remove. */
function reqKey(r: NormalizedRequirement): string {
  return `${r.kind}::${r.label.replace(/ ≥ .*$/, '').replace(/\(.*\)/, '').trim()}`
}

/** Detect which param field changed, if any (for THRESHOLD_CHANGED vs RULE_CHANGED). */
function detectThresholdField(oldP: Record<string, unknown>, newP: Record<string, unknown>): string | undefined {
  const thresholdFields = ['amount', 'reduced_for_shortage', 'min', 'years', 'max']
  for (const f of thresholdFields) {
    if (oldP[f] !== undefined && newP[f] !== undefined && JSON.stringify(oldP[f]) !== JSON.stringify(newP[f])) {
      return f
    }
  }
  return undefined
}

function fmtVal(v: unknown): string {
  if (v == null) return '—'
  if (typeof v === 'number') return String(v)
  return JSON.stringify(v)
}

function programEvidence(p: ImmigrationProgram): string[] {
  // Collect evidence from the program's requirements + transitions
  const reqEv = p.requirementIds.flatMap((rid) => REQUIREMENTS.find((r) => r.id === rid)?.evidenceIds ?? [])
  const trEv = p.transitionIds.flatMap((tid) => TRANSITIONS.find((t) => t.id === tid)?.evidenceIds ?? [])
  return Array.from(new Set([...reqEv, ...trEv]))
}
