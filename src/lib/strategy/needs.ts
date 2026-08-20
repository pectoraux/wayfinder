// Wayfinder — Needs + Desired Capability Intelligence (N0.5)
//
// This module implements the intelligence layer that answers:
//
//   "What does this Voyager actually need,
//    and what capability would unlock the blocked trajectory?"
//
// It distinguishes:
//   WANT (what the user says)
//   NEED (what must actually be satisfied)
//   OBJECTIVE (the outcome they pursue)
//   CONSTRAINT (what restricts the solution space)
//   PREFERENCE (how they want tradeoffs resolved)
//   BLOCKER (what currently prevents a trajectory)
//   DESIRED CAPABILITY (what capability, if acquired, could remove the blocker)
//
// The inference is:
//   - deterministic (same inputs → same outputs)
//   - evidence-based (derived from actual route/blocker analysis)
//   - inspectable (the user can see WHY a need/capability was inferred)
//   - correctable (the user can reject/correct inferred needs → new intent version)
//
// NO SECRET PSYCHOLOGY. The need inference uses the existing Intent model's
// statedGoal, desiredOutcomes, implicitObjectives, constraints, and preferences
// — plus the actual route/blocker analysis — to produce a structured NeedAssessment.

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
// Need model (distinguishes WANT from NEED from OBJECTIVE)
// ---------------------------------------------------------------------------

export interface NeedAssessment {
  /** What the user explicitly asked for (e.g., "Portugal"). */
  wants: Want[]
  /** What the system infers the user actually needs (e.g., "stable EU residence"). */
  needs: InferredNeed[]
  /** The measurable outcome the user is pursuing. */
  objectives: string[]
  /** What restricts the solution space. */
  constraints: ConstraintSummary[]
  /** How the user wants tradeoffs resolved. */
  preferences: PreferenceSummary[]
  /** Human-readable explanation of the inference. */
  explanation: string
}

export interface Want {
  /** The raw user expression. */
  expression: string
  /** What the user explicitly asked for (parsed from statedGoal). */
  goal: IntentGoal
  /** Where this want came from. */
  source: 'USER_STATED'
}

export interface InferredNeed {
  /** The canonical need label (e.g., "stable long-term EU residence"). */
  label: string
  /** Why the system inferred this need (evidence chain). */
  evidence: string
  /** The stated goal this need was derived from. */
  derivedFrom: IntentGoal
  /** Whether the user has confirmed or corrected this need. */
  confirmed: boolean | null // null = not yet reviewed
  /** Whether the user rejected this inferred need. */
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
// DesiredCapability model
// ---------------------------------------------------------------------------

export type CapabilityUnlockRelation = 'MAY_UNLOCK' | 'REQUIRED_FOR' | 'CONTRIBUTES_TO' | 'DOES_NOT_SUFFICIENTLY_UNLOCK'

export interface DesiredCapability {
  /** The canonical capability ID from the taxonomy. */
  capabilityId: CapabilityId
  /** Human-readable label. */
  label: string
  /** The blocker that triggered this desired capability. */
  triggeringBlockerId: string
  /** The blocker label. */
  triggeringBlockerLabel: string
  /** The trajectory this blocker belongs to. */
  triggeringTrajectoryId: string
  /** The trajectory label. */
  triggeringTrajectoryLabel: string
  /** The objective this capability would help achieve. */
  affectedObjective: string | null
  /** How this capability relates to the route's viability. */
  unlockRelation: CapabilityUnlockRelation
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
  /** Whether the capability is required for this route or just contributes. */
  relation: CapabilityUnlockRelation
  /** How many other blockers remain on this route even if this capability is acquired. */
  remainingBlockers: number
}

// ---------------------------------------------------------------------------
// Capability impact summary
// ---------------------------------------------------------------------------

export interface CapabilityImpactSummary {
  /** Total desired capabilities identified. */
  totalCapabilities: number
  /** Capabilities that could unlock at least one additional trajectory. */
  impactfulCapabilities: number
  /** Total additional trajectories that could become viable. */
  potentialTrajectoriesUnlocked: number
  /** Per-capability impact detail. */
  capabilities: DesiredCapability[]
  /** Human-readable explanation. */
  explanation: string
}

// ---------------------------------------------------------------------------
// Need inference
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

/**
 * Infer the user's needs from their stated intent.
 * Deterministic — same intent → same needs. Inspectable — each need has
 * an evidence chain. Correctable — the user can reject or confirm.
 */
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

  // Add needs from implicit objectives
  for (const implicit of intent.implicitObjectives) {
    needs.push({
      label: implicit.objective,
      evidence: implicit.evidence,
      derivedFrom: intent.statedGoal,
      confirmed: null,
      rejected: false,
    })
  }

  // Add needs from desired outcomes
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
// Blocker → DesiredCapability inference
// ---------------------------------------------------------------------------

/**
 * Analyze all blockers across all trajectories and derive DesiredCapabilities.
 *
 * Each DesiredCapability is:
 *   - traceable to an actual blocked trajectory + blocker
 *   - derived deterministically from the blocker's pattern
 *   - linked to the canonical capability taxonomy
 *   - assessed for urgency + impact
 *
 * @param trajectories The user's strategy trajectories (viable + blocked)
 * @param blockers The blockers on the best trajectory
 * @param objectiveId The active objective (if any)
 * @param allRoutes All routes available to the user (for unlock analysis)
 */
export function inferDesiredCapabilities(
  trajectories: Trajectory[],
  blockers: BlockerAnalysis[],
  objectiveId: string | null,
  allRoutes: Route[],
): DesiredCapability[] {
  const capabilities: DesiredCapability[] = []
  const seenCapabilityIds = new Set<string>()

  // For each blocker, derive the desired capability
  for (const blocker of blockers) {
    const pattern = classifyBlockerPattern(blocker.label, blocker.reason)
    const candidateCapabilities = getCapabilitiesForPattern(pattern)

    for (const capDef of candidateCapabilities) {
      // Deduplicate by capabilityId (but keep multiple blockers that map to the same capability)
      const dedupKey = capDef.id
      if (seenCapabilityIds.has(dedupKey)) {
        // Already have this capability — just add another triggering blocker reference
        const existing = capabilities.find((c) => c.capabilityId === capDef.id)
        if (existing) {
          existing.potentialUnlocks.push(...computePotentialUnlocks(capDef, allRoutes, trajectories))
        }
        continue
      }
      seenCapabilityIds.add(dedupKey)

      const potentialUnlocks = computePotentialUnlocks(capDef, allRoutes, trajectories)
      const urgency = computeUrgency(blocker, capDef)
      const impact = computeImpact(capDef, potentialUnlocks, trajectories)

      capabilities.push({
        capabilityId: capDef.id,
        label: capDef.label,
        triggeringBlockerId: blocker.blockerId,
        triggeringBlockerLabel: blocker.label,
        triggeringTrajectoryId: trajectories[0]?.id ?? '',
        triggeringTrajectoryLabel: trajectories[0]?.label ?? '',
        affectedObjective: objectiveId,
        unlockRelation: blocker.category === 'THIRD_PARTY' ? 'REQUIRED_FOR' : 'MAY_UNLOCK',
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

  return capabilities
}

/**
 * Compute which routes could potentially be unlocked by a capability.
 * This uses the existing route data — a route is a "potential unlock" if
 * it has a blocker that matches the capability's patterns.
 */
function computePotentialUnlocks(
  capDef: CapabilityDefinition,
  allRoutes: Route[],
  trajectories: Trajectory[],
): PotentialRouteUnlock[] {
  const unlocks: PotentialRouteUnlock[] = []

  for (const route of allRoutes) {
    // Skip routes that are already fully eligible
    if (route.eligibility.status === 'eligible') continue

    // Check if any blocker on this route matches the capability's patterns
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

/**
 * Compute urgency (0..1). Higher = more urgent.
 * Based on:
 *   - blocker difficulty (harder = more urgent to start)
 *   - blocker category (third-party = more urgent, longer lead time)
 *   - acquisition time (longer = more urgent to start early)
 */
function computeUrgency(blocker: BlockerAnalysis, capDef: CapabilityDefinition): number {
  let urgency = 0.3 // base

  if (blocker.difficulty === 'very_hard') urgency += 0.3
  else if (blocker.difficulty === 'hard') urgency += 0.2
  else if (blocker.difficulty === 'moderate') urgency += 0.1

  if (blocker.category === 'THIRD_PARTY') urgency += 0.2
  else if (blocker.category === 'EXTERNAL') urgency += 0.15

  if (capDef.typicalAcquisitionMonths >= 6) urgency += 0.2
  else if (capDef.typicalAcquisitionMonths >= 3) urgency += 0.1

  return Math.min(urgency, 1.0)
}

/**
 * Compute impact (0..1). Higher = more impactful.
 * Based on:
 *   - number of potential routes unlocked
 *   - whether any route has zero remaining blockers (MAY_UNLOCK)
 *   - legitimacy (required > supportive)
 */
function computeImpact(
  capDef: CapabilityDefinition,
  potentialUnlocks: PotentialRouteUnlock[],
  trajectories: Trajectory[],
): number {
  if (potentialUnlocks.length === 0) return 0

  let impact = 0.1 * potentialUnlocks.length

  // Bonus for routes that could be fully unlocked
  const fullUnlocks = potentialUnlocks.filter((u) => u.remainingBlockers === 0).length
  impact += 0.3 * fullUnlocks

  // Required capabilities matter more than supportive
  if (capDef.legitimacy === 'required') impact += 0.2

  // Scale by total trajectories (more trajectories = more relative impact)
  if (trajectories.length > 0) {
    const unlockRatio = potentialUnlocks.length / trajectories.length
    impact += 0.2 * unlockRatio
  }

  return Math.min(impact, 1.0)
}

// ---------------------------------------------------------------------------
// Capability impact summary
// ---------------------------------------------------------------------------

/**
 * Build a summary of all desired capabilities and their collective impact.
 */
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
// Counterfactual capability analysis
// ---------------------------------------------------------------------------

export interface CounterfactualCapabilityResult {
  /** The capability being analyzed. */
  capabilityId: CapabilityId
  /** The label. */
  label: string
  /** Trajectories that would become newly viable. */
  newlyViableTrajectories: { id: string; label: string }[]
  /** Trajectories that would still be blocked (but with fewer blockers). */
  partiallyImproved: { id: string; label: string; remainingBlockers: number }[]
  /** Human-readable explanation. */
  explanation: string
}

/**
 * Analyze: "If the user had capability X, what would change?"
 *
 * This uses the existing route infrastructure — it does NOT persist a new
 * strategy or create a DecisionRecord. It's a pure analysis function.
 */
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
