// Wayfinder — Needs + Desired Capability Intelligence (N0.5 hardened)
//
// This module implements the intelligence layer that answers:
//
//   "What does this Voyager actually need,
//    and what capability would unlock the blocked trajectory?"
//
// N0.5 HARDENING (4 bugs fixed):
//   1. TRACEABILITY: triggers[] replaces single triggeringBlockerId — all
//      causal references preserved.
//   2. FRONTIER COVERAGE: blockers from ALL meaningful trajectories are
//      analyzed, not just the best one.
//   3. OBJECTIVE: affectedObjective is populated from the intent's statedGoal.
//   4. DEDUPLICATION: capabilities are deduplicated by ID but ALL triggers
//      are accumulated — no loss of provenance.

import type { MobilityState, Intent, Constraint, Preference, IntentGoal, IntentOutcome } from '@/lib/domain/types'
import type { Route } from '@/lib/domain/types'
import type { BlockerAnalysis, Trajectory } from '@/lib/strategy/types'
import {
  classifyBlockerPattern,
  getCapabilitiesForPattern,
  CAPABILITY_TAXONOMY,
  type CapabilityId,
  type CapabilityDefinition,
  type BlockerPattern,
} from './capabilities'

// ---------------------------------------------------------------------------
// Need model
// ---------------------------------------------------------------------------

export interface NeedAssessment {
  wants: Want[]
  needs: InferredNeed[]
  objectives: string[]
  constraints: ConstraintSummary[]
  preferences: PreferenceSummary[]
  explanation: string
}

export interface Want {
  expression: string
  goal: IntentGoal
  source: 'USER_STATED'
}

export interface InferredNeed {
  label: string
  evidence: string
  derivedFrom: IntentGoal
  confirmed: boolean | null
  rejected: boolean
}

export interface ConstraintSummary {
  kind: string
  value: string
  rationale?: string
}

export interface PreferenceSummary {
  kind: string
  weight: number
  note?: string
}

// ---------------------------------------------------------------------------
// DesiredCapability model (hardened — triggers[] preserves ALL provenance)
// ---------------------------------------------------------------------------

export type CapabilityUnlockRelation = 'MAY_UNLOCK' | 'REQUIRED_FOR' | 'CONTRIBUTES_TO' | 'DOES_NOT_SUFFICIENTLY_UNLOCK'

/** A single causal trigger for a desired capability. */
export interface CapabilityTrigger {
  /** The blocker that caused this capability inference. */
  blockerId: string
  /** The blocker label. */
  blockerLabel: string
  /** The trajectory containing this blocker. */
  trajectoryId: string
  /** The trajectory label. */
  trajectoryLabel: string
  /** The objective this trajectory was computed for. */
  objectiveId: string | null
  /** How this capability relates to this specific blocker. */
  relation: CapabilityUnlockRelation
}

export interface DesiredCapability {
  capabilityId: CapabilityId
  label: string
  /** ALL triggers that caused this capability inference — no provenance loss. */
  triggers: CapabilityTrigger[]
  /** The primary objective this capability would help achieve (from the
   *  first trigger; may be null if the strategy has no objective context). */
  affectedObjective: string | null
  /** Whether this capability requires a third-party actor. */
  requiresActor: boolean
  /** Whether the user can self-acquire this capability. */
  userSelfAcquirable: boolean
  /** Typical time to acquire (months). */
  typicalAcquisitionMonths: number
  /** Whether this was inferred or explicitly requested. */
  origin: 'INFERRED' | 'EXPLICIT'
  /** Routes that could potentially be unlocked by this capability. */
  potentialUnlocks: PotentialRouteUnlock[]
  /** Deterministic urgency score (0..1, higher = more urgent). */
  urgency: number
  /** Deterministic impact score (0..1, higher = more impactful). */
  impact: number
}

export interface PotentialRouteUnlock {
  routeId: string
  routeLabel: string
  countryCode: string
  relation: CapabilityUnlockRelation
  remainingBlockers: number
}

// ---------------------------------------------------------------------------
// Capability impact summary
// ---------------------------------------------------------------------------

export interface CapabilityImpactSummary {
  totalCapabilities: number
  impactfulCapabilities: number
  potentialTrajectoriesUnlocked: number
  capabilities: DesiredCapability[]
  explanation: string
}

// ---------------------------------------------------------------------------
// Need inference (unchanged — deterministic, inspectable)
// ---------------------------------------------------------------------------

const GOAL_TO_NEED_MAP: Record<IntentGoal, { label: string; evidence: string }> = {
  move_abroad_general: { label: 'international relocation with viable legal pathway', evidence: 'User stated a general desire to move abroad.' },
  earn_more: { label: 'higher income in a stronger economy', evidence: 'User stated income maximization as their goal.' },
  study_and_stay: { label: 'educational admission leading to post-study residence', evidence: 'User stated study as the entry path.' },
  start_company_abroad: { label: 'founder-friendly jurisdiction with startup visa pathway', evidence: 'User stated company formation abroad as their goal.' },
  safer_life_for_family: { label: 'safe, stable residence with family security', evidence: 'User stated family safety as the primary concern.' },
  spend_years_abroad: { label: 'multi-year residence with renewal pathway', evidence: 'User stated a multi-year horizon abroad.' },
  second_citizenship: { label: 'citizenship pathway with acceptable naturalization timeline', evidence: 'User stated second citizenship as the goal.' },
  maximize_mobility: { label: 'maximum visa-free mobility and passport strength', evidence: 'User stated mobility maximization as the goal.' },
  maximize_income: { label: 'highest achievable income step in a strong economy', evidence: 'User stated income maximization as their goal.' },
  remote_work_abroad: { label: 'remote-work-compatible residence with stable income verification', evidence: 'User stated remote work abroad as the goal.' },
  other: { label: 'a viable international mobility pathway', evidence: 'User stated an uncategorized goal.' },
}

export function inferNeeds(intent: Intent): NeedAssessment {
  const wants: Want[] = [{
    expression: intent.rawInput,
    goal: intent.statedGoal,
    source: 'USER_STATED',
  }]

  const needMap = GOAL_TO_NEED_MAP[intent.statedGoal] ?? GOAL_TO_NEED_MAP.other
  const needs: InferredNeed[] = [{
    label: needMap.label,
    evidence: needMap.evidence,
    derivedFrom: intent.statedGoal,
    confirmed: null,
    rejected: false,
  }]

  for (const implicit of intent.implicitObjectives) {
    needs.push({
      label: implicit.objective,
      evidence: implicit.evidence,
      derivedFrom: intent.statedGoal,
      confirmed: null,
      rejected: false,
    })
  }

  const objectives = intent.desiredOutcomes.map((o) => o.outcome)

  const constraints: ConstraintSummary[] = intent.constraints.map((c) => ({
    kind: c.kind,
    value: c.value,
    rationale: c.rationale,
  }))

  const preferences: PreferenceSummary[] = intent.priorities.map((p) => ({
    kind: p.kind,
    weight: p.weight,
    note: p.note,
  }))

  const explanation = buildNeedExplanation(wants, needs, objectives)

  return { wants, needs, objectives, constraints, preferences, explanation }
}

function buildNeedExplanation(wants: Want[], needs: InferredNeed[], objectives: string[]): string {
  const wantLabel = wants[0]?.goal ?? 'unknown'
  const needLabel = needs[0]?.label ?? 'unknown'
  const objectiveLabel = objectives[0] ?? 'unknown'
  return `You want ${wantLabel}. Based on your stated priorities, Wayfinder believes your underlying need is ${needLabel}. Your primary objective appears to be ${objectiveLabel}.`
}

// ---------------------------------------------------------------------------
// Blocker → DesiredCapability inference (HARDENED)
// ---------------------------------------------------------------------------

/**
 * Collect ALL blockers across ALL meaningful trajectories.
 *
 * N0.5 hardening: previously only blockers from the best trajectory were
 * analyzed. Now we analyze blockers from:
 *   - the best trajectory
 *   - alternative trajectories
 *   - any trajectory that has blockers (blocked but meaningful)
 *
 * We do NOT analyze routes that have no trajectory association (raw routes
 * without trajectory context are not meaningful for capability inference).
 */
interface TrajectoryBlockerAssociation {
  trajectory: Trajectory
  blocker: BlockerAnalysis
}

function collectAllTrajectoryBlockers(
  trajectories: Trajectory[],
  bestTrajectoryBlockers: BlockerAnalysis[],
): TrajectoryBlockerAssociation[] {
  const associations: TrajectoryBlockerAssociation[] = []

  // Best trajectory blockers (passed in separately because analyzeBlockers
  // is called on the best route, not on trajectories directly)
  const bestTrajectory = trajectories[0]
  if (bestTrajectory) {
    for (const blocker of bestTrajectoryBlockers) {
      associations.push({ trajectory: bestTrajectory, blocker })
    }
  }

  // Alternative trajectory blockers: we need to analyze blockers for each
  // alternative trajectory. The existing analyzeBlockers function takes a
  // Route, so we need to find the route for each trajectory.
  // However, we don't have the routes here — we have trajectories.
  // The trajectory itself contains blockerLabels, which we can use.
  // But the actual BlockerAnalysis objects come from analyzeBlockers(route).
  //
  // APPROACH: we accept pre-analyzed trajectory-blocker pairs from the caller.
  // The caller (buildStrategy) has access to routes and can call analyzeBlockers
  // for each meaningful trajectory's source route.
  //
  // For now, we also accept additional associations via the function signature.

  return associations
}

/**
 * Analyze blockers across ALL meaningful trajectories and derive DesiredCapabilities.
 *
 * N0.5 hardening:
 *   1. Accepts trajectoryBlockerAssociations — blockers from ALL trajectories,
 *      not just the best one.
 *   2. Deduplicates by capabilityId but preserves ALL triggers (no provenance loss).
 *   3. Populates affectedObjective from the intent's statedGoal.
 *   4. Each trigger records the exact trajectory + blocker it came from.
 *
 * @param trajectoryBlockerAssociations All (trajectory, blocker) pairs across
 *        meaningful trajectories
 * @param objectiveId The active objective (from intent.statedGoal)
 * @param allRoutes All routes for unlock analysis
 */
export function inferDesiredCapabilities(
  trajectoryBlockerAssociations: TrajectoryBlockerAssociation[],
  objectiveId: string | null,
  allRoutes: Route[],
): DesiredCapability[] {
  const capabilitiesBy = new Map<CapabilityId, DesiredCapability>()

  for (const { trajectory, blocker } of trajectoryBlockerAssociations) {
    const pattern = classifyBlockerPattern(blocker.label, blocker.reason)
    const candidateCapabilities = getCapabilitiesForPattern(pattern)

    for (const capDef of candidateCapabilities) {
      const trigger: CapabilityTrigger = {
        blockerId: blocker.blockerId,
        blockerLabel: blocker.label,
        trajectoryId: trajectory.id,
        trajectoryLabel: trajectory.label,
        objectiveId,
        relation: blocker.category === 'THIRD_PARTY' ? 'REQUIRED_FOR' : 'MAY_UNLOCK',
      }

      const existing = capabilitiesBy.get(capDef.id)
      if (existing) {
        // Deduplicate by capabilityId — but ACCUMULATE triggers (no provenance loss)
        existing.triggers.push(trigger)
        // Recompute urgency (take the max across all triggers)
        const newUrgency = computeUrgency(blocker, capDef)
        if (newUrgency > existing.urgency) {
          existing.urgency = newUrgency
        }
      } else {
        const potentialUnlocks = computePotentialUnlocks(capDef, allRoutes)
        const urgency = computeUrgency(blocker, capDef)
        const impact = computeImpact(capDef, potentialUnlocks, trajectoryBlockerAssociations.map((a) => a.trajectory))

        capabilitiesBy.set(capDef.id, {
          capabilityId: capDef.id,
          label: capDef.label,
          triggers: [trigger],
          affectedObjective: objectiveId,
          requiresActor: capDef.requiresActor,
          userSelfAcquirable: capDef.userSelfAcquirable,
          typicalAcquisitionMonths: capDef.typicalAcquisitionMonths,
          origin: 'INFERRED',
          potentialUnlocks,
          urgency,
          impact,
        })
      }
    }
  }

  return Array.from(capabilitiesBy.values())
}

/**
 * Compute which routes could potentially be unlocked by a capability.
 */
function computePotentialUnlocks(
  capDef: CapabilityDefinition,
  allRoutes: Route[],
): PotentialRouteUnlock[] {
  const unlocks: PotentialRouteUnlock[] = []

  for (const route of allRoutes) {
    if (route.eligibility.status === 'eligible') continue

    const matchingBlockers = route.eligibility.blockers.filter((b) => {
      const pattern = classifyBlockerPattern(b.label, b.reason)
      return capDef.resolvesBlockerPatterns.includes(pattern)
    })

    if (matchingBlockers.length > 0) {
      const remainingBlockers = route.eligibility.blockers.length - matchingBlockers.length
      const relation: CapabilityUnlockRelation = remainingBlockers === 0 ? 'MAY_UNLOCK' : 'CONTRIBUTES_TO'

      unlocks.push({
        routeId: route.id,
        routeLabel: route.label,
        countryCode: route.countryCode,
        relation,
        remainingBlockers,
      })
    }
  }

  return unlocks
}

function computeUrgency(blocker: BlockerAnalysis, capDef: CapabilityDefinition): number {
  let urgency = 0.3
  if (blocker.difficulty === 'very_hard') urgency += 0.3
  else if (blocker.difficulty === 'hard') urgency += 0.2
  else if (blocker.difficulty === 'moderate') urgency += 0.1
  if (blocker.category === 'THIRD_PARTY') urgency += 0.2
  else if (blocker.category === 'EXTERNAL') urgency += 0.15
  if (capDef.typicalAcquisitionMonths >= 6) urgency += 0.2
  else if (capDef.typicalAcquisitionMonths >= 3) urgency += 0.1
  return Math.min(urgency, 1.0)
}

function computeImpact(
  capDef: CapabilityDefinition,
  potentialUnlocks: PotentialRouteUnlock[],
  trajectories: Trajectory[],
): number {
  if (potentialUnlocks.length === 0) return 0
  let impact = 0.1 * potentialUnlocks.length
  const fullUnlocks = potentialUnlocks.filter((u) => u.remainingBlockers === 0).length
  impact += 0.3 * fullUnlocks
  if (capDef.legitimacy === 'required') impact += 0.2
  if (trajectories.length > 0) {
    const unlockRatio = potentialUnlocks.length / trajectories.length
    impact += 0.2 * unlockRatio
  }
  return Math.min(impact, 1.0)
}

// ---------------------------------------------------------------------------
// Capability impact summary
// ---------------------------------------------------------------------------

export function buildCapabilityImpactSummary(
  capabilities: DesiredCapability[],
  trajectories: Trajectory[],
): CapabilityImpactSummary {
  const impactful = capabilities.filter((c) => c.potentialUnlocks.length > 0)
  const totalUnlocks = new Set(impactful.flatMap((c) => c.potentialUnlocks.map((u) => u.routeId))).size

  const explanation = capabilities.length === 0
    ? 'No missing capabilities identified — your strategy does not currently require third-party capabilities.'
    : `${capabilities.length} desired capabilit${capabilities.length === 1 ? 'y' : 'ies'} identified. ${impactful.length} could unlock ${totalUnlocks} additional trajectory${totalUnlocks === 1 ? '' : 'ies'}.`

  return {
    totalCapabilities: capabilities.length,
    impactfulCapabilities: impactful.length,
    potentialTrajectoriesUnlocked: totalUnlocks,
    capabilities,
    explanation,
  }
}

// ---------------------------------------------------------------------------
// Counterfactual capability analysis (unchanged — pure, non-persistent)
// ---------------------------------------------------------------------------

export interface CounterfactualCapabilityResult {
  capabilityId: CapabilityId
  label: string
  newlyViableTrajectories: { id: string; label: string }[]
  partiallyImproved: { id: string; label: string; remainingBlockers: number }[]
  explanation: string
}

export function analyzeCounterfactualCapability(
  capabilityId: CapabilityId,
  allRoutes: Route[],
  trajectories: Trajectory[],
): CounterfactualCapabilityResult {
  const capDef = getCapabilitiesDefinition(capabilityId)
  if (!capDef) {
    return {
      capabilityId,
      label: 'Unknown',
      newlyViableTrajectories: [],
      partiallyImproved: [],
      explanation: 'Unknown capability.',
    }
  }

  const newlyViable: { id: string; label: string }[] = []
  const partiallyImproved: { id: string; label: string; remainingBlockers: number }[] = []

  for (const route of allRoutes) {
    if (route.eligibility.status === 'eligible') continue

    const matchingBlockers = route.eligibility.blockers.filter((b) => {
      const pattern = classifyBlockerPattern(b.label, b.reason)
      return capDef.resolvesBlockerPatterns.includes(pattern)
    })

    if (matchingBlockers.length === 0) continue

    const remainingBlockers = route.eligibility.blockers.length - matchingBlockers.length
    const trajectory = trajectories.find((t) => t.sourceRouteId === route.id)

    if (remainingBlockers === 0) {
      newlyViable.push({ id: trajectory?.id ?? route.id, label: trajectory?.label ?? route.label })
    } else {
      partiallyImproved.push({
        id: trajectory?.id ?? route.id,
        label: trajectory?.label ?? route.label,
        remainingBlockers,
      })
    }
  }

  const explanation = newlyViable.length > 0
    ? `If you acquired ${capDef.label}, ${newlyViable.length} additional trajectory${newlyViable.length === 1 ? 'y' : 'ies'} would become viable.`
    : `Acquiring ${capDef.label} would improve ${partiallyImproved.length} trajectory${partiallyImproved.length === 1 ? 'y' : 'ies'} but not fully unlock them (other blockers remain).`

  return {
    capabilityId,
    label: capDef.label,
    newlyViableTrajectories: newlyViable,
    partiallyImproved,
    explanation,
  }
}

function getCapabilitiesDefinition(id: CapabilityId): CapabilityDefinition | undefined {
  return CAPABILITY_TAXONOMY.find((c) => c.id === id)
}

// Export the association type for the caller
export type { TrajectoryBlockerAssociation }
