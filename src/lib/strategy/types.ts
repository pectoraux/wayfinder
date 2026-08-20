// Wayfinder — Strategy Domain Types
//
// The intelligence layer types that make Wayfinder more than a visa database.
// These represent multi-step trajectories, blocker analysis, action plans,
// profile value analysis, and the intent frontier.

import type { Route, MobilityState, Intent, CountryCode } from '@/lib/domain/types'
import type { PlanImpactLevel, AlertSeverity } from '@/lib/policy/types'

// ===========================================================================
// 1. TRAJECTORY — a multi-step, potentially multi-country legal path
// ===========================================================================

/** A single step in a trajectory (a visa/status in one country). */
export interface TrajectoryStep {
  order: number
  countryCode: CountryCode
  countryName: string
  status: string
  programId?: string
  programName?: string
  description: string
  durationMonths: number
  /** Requirements that must be met to enter this step. */
  requirements: string[]
  /** Whether this step is currently blocked. */
  blocked: boolean
  blockerLabels?: string[]
  /** Evidence backing this step's rules. */
  evidenceIds: string[]
}

/** A multi-step legal trajectory from current state to a destination. */
export interface Trajectory {
  id: string
  label: string
  steps: TrajectoryStep[]
  /** Total months from start to final destination. */
  totalMonths: number
  /** Total cost in USD. */
  totalCostUSD: number
  /** Countries traversed. */
  countries: CountryCode[]
  /** Whether the trajectory spans multiple countries. */
  multiCountry: boolean
  /** Final destination status. */
  destinationStatus: string
  /** Downstream options available after completing this trajectory. */
  downstreamOptionality: number
  /** How reversible the trajectory is at each step. */
  reversibility: 'high' | 'medium' | 'low'
  /** Risk band. */
  risk: 'low' | 'medium' | 'high'
  /** The route this trajectory was derived from (if applicable). */
  sourceRouteId?: string
  /** Whether this trajectory is currently viable (first step not blocked). */
  viable: boolean
  /** Why this trajectory is being considered. */
  rationale: string
}

// ===========================================================================
// 2. BLOCKER CLASSIFICATION
// ===========================================================================

export type BlockerCategory =
  | 'USER_CONTROLLED'    // the user can fix this themselves (e.g., learn a language, save money)
  | 'THIRD_PARTY'        // requires an external actor (employer, incubator, endorsement)
  | 'EXTERNAL'           // depends on external processes (credential recognition, processing time)
  | 'POLICY_DEPENDENT'   // depends on policy decisions (program suspension, quota changes)

export interface BlockerAnalysis {
  blockerId: string
  label: string
  reason: string
  category: BlockerCategory
  /** What the user would need to do (if user-controlled). */
  userAction?: string
  /** What third party could help (if third-party). */
  thirdPartyRole?: string
  /** How difficult it is to resolve. */
  difficulty: 'easy' | 'moderate' | 'hard' | 'very_hard'
  /** Estimated time to resolve (months). */
  estimatedResolutionMonths?: number
  /** What would unlock this blocker. */
  unlocks: UnlockOption[]
}

export interface UnlockOption {
  kind: 'credential_recognition' | 'language_cert' | 'employer_offer' | 'incubator_support' | 'endorsement' | 'savings' | 'education' | 'business_formation' | 'documentation' | 'policy_change'
  label: string
  description: string
  /** Enabler ids that could provide this. */
  enablerIds: string[]
  /** Whether this is something the user can do themselves. */
  userActionable: boolean
  /** Estimated time to complete. */
  estimatedMonths?: number
}

// ===========================================================================
// 3. ACTION PLAN
// ===========================================================================

export type ActionTimeframe = '7_DAYS' | '30_DAYS' | '90_DAYS' | '6_MONTHS' | 'ONGOING'

export interface Action {
  id: string
  title: string
  description: string
  timeframe: ActionTimeframe
  /** Which blocker or dependency this action addresses. */
  addressesBlockerId?: string
  /** Which trajectory step this action advances. */
  trajectoryStep?: number
  /** Impact on route viability (0..1). */
  impact: number
  /** Whether this action is time-sensitive. */
  timeSensitive: boolean
  /** Estimated cost in USD. */
  estimatedCostUSD?: number
  /** Whether this action is reversible. */
  reversible: boolean
  /** Dependencies that must be completed first. */
  dependsOn?: string[]
}

export interface ActionPlan {
  actions: Action[]
  /** The highest-leverage single action. */
  highestLeverageAction?: Action
  /** Summary of the plan. */
  summary: string
}

// ===========================================================================
// 4. PROFILE VALUE ANALYSIS
// ===========================================================================

export interface ProfileAsset {
  attribute: string
  label: string
  /** How much this asset contributes to route viability (0..1). */
  leverage: number
  /** Which routes this asset benefits. */
  benefitsRoutes: string[]
  /** Whether this is a rare/valuable attribute. */
  rare: boolean
}

export interface ProfileGap {
  attribute: string
  label: string
  /** How much closing this gap would expand the frontier (0..1). */
  frontierExpansion: number
  /** Which routes would become newly viable. */
  unlocksRoutes: string[]
  /** Whether the user can close this gap themselves. */
  userActionable: boolean
}

export interface ProfileAnalysis {
  /** The user's highest-leverage current assets, ranked. */
  topAssets: ProfileAsset[]
  /** The biggest gaps, ranked by frontier expansion. */
  topGaps: ProfileGap[]
  /** The single highest-leverage change to expand the mobility frontier. */
  highestLeverageChange?: {
    label: string
    description: string
    /** How many new routes would become viable. */
    newRoutesOpened: number
    /** The counterfactual scenario that produces this change. */
    scenarioId?: string
  }
  /** How many trajectories are viable now. */
  currentViableTrajectories: number
  /** How many would be viable after the highest-leverage change. */
  postChangeViableTrajectories: number
}

// ===========================================================================
// 5. INTENT FRONTIER — objectives × trajectories
// ===========================================================================

export interface ObjectiveTrajectory {
  objective: string
  objectiveLabel: string
  bestTrajectoryId: string
  bestTrajectoryLabel: string
  cost: number
  timeMonths: number
  risk: 'low' | 'medium' | 'high'
  optionality: number
  /** Whether this objective is the user's stated one or an alternative. */
  isStated: boolean
}

export interface IntentFrontier {
  /** The Pareto-optimal objectives and their best trajectories. */
  points: ObjectiveTrajectory[]
  /** Which objectives are genuinely different strategies. */
  distinctStrategies: ObjectiveTrajectory[]
}

// ===========================================================================
// 6. PREFERENCE ELICITATION
// ===========================================================================

export interface PreferenceQuestion {
  id: string
  question: string
  /** Which preference dimension this question illuminates. */
  dimension: string
  /** Why we're asking (what changes in the ranking). */
  rationale: string
  /** The options the user can choose. */
  options: { label: string; value: string; implications: string }[]
  /** Which routes/trajectories are affected by the answer. */
  affectedRouteIds: string[]
}

// ===========================================================================
// 7. UNCERTAINTY
// ===========================================================================

export type ConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN'

export interface UncertaintyAssessment {
  dimension: string
  confidence: ConfidenceLevel
  reason: string
}

// ===========================================================================
// 8. STRATEGY — the composite intelligence output
// ===========================================================================

/**
 * Canonical strategy provenance: the exact inputs that produced a strategy.
 *
 * Every persisted Strategy/Plan recommendation must be answerable:
 *   "Which user state, intent, policy, and strategy-engine version produced this?"
 *
 * This object is the answer. It is stored alongside the strategy snapshot and
 * on the DecisionRecord so the recommendation can be reconstructed and audited
 * even after the underlying inputs change.
 */
export interface StrategyProvenance {
  /** The strategy engine version (e.g. '1.0.0'). */
  strategyEngineVersion: string
  /** The runtime policy version id (base + overlay count). */
  runtimePolicyVersion: string
  /** The deterministic hash of the resolved runtime policy. */
  runtimePolicyHash: string
  /** The as-of date the strategy was computed for (ISO). */
  asOfDate: string
  /** The MobilityStateSnapshot id this strategy was computed against. */
  mobilityStateSnapshotId: string
  /** The MobilityStateSnapshot.version this strategy was computed against. */
  mobilityStateVersion: number
  /** The IntentRecord id this strategy was computed against. */
  intentRecordId: string
  /** The IntentRecord.version this strategy was computed against. */
  intentVersion: number
  /** The objective this strategy optimized for (e.g. 'residence'). */
  objectiveId: string
  /** The objective version (immutable objective/intention record version). */
  objectiveVersion: number
  /** When this strategy was generated (ISO). */
  generatedAt: string
}

export interface Strategy {
  /** The user's current state. */
  state: MobilityState
  /** The user's intent. */
  intent: Intent
  /** The best trajectory. */
  bestTrajectory: Trajectory
  /** Alternative trajectories worth considering. */
  alternativeTrajectories: Trajectory[]
  /** Blocker analysis for the best trajectory. */
  blockers: BlockerAnalysis[]
  /** What would unlock the blockers. */
  unlocks: UnlockOption[]
  /** The action plan. */
  actionPlan: ActionPlan
  /** Profile value analysis. */
  profileAnalysis: ProfileAnalysis
  /** The intent frontier (objectives × trajectories). */
  intentFrontier: IntentFrontier
  /** Alternative intents discovered. */
  alternativeIntents: { title: string; rationale: string; tradeoffs: string[]; mayBeSuperior: boolean }[]
  /** Preference questions that would change the ranking. */
  preferenceQuestions: PreferenceQuestion[]
  /** Per-dimension uncertainty assessment. */
  uncertainties: UncertaintyAssessment[]
  /** The single highest-leverage change. */
  highestLeverageChange?: ProfileAnalysis['highestLeverageChange']
  /** Strategy explanation (deterministic). */
  explanation: string
  /** Generated at. */
  generatedAt: string
  /** The runtime policy context used to compute this strategy. */
  policyContext?: {
    baseSnapshotId: string
    activeOverlayIds: string[]
    runtimeVersionId: string
    runtimeHash: string
    asOf: string
    simulationMode: boolean
  }
  /** The strategy engine version. */
  strategyEngineVersion?: string

  // -------------------------------------------------------------------------
  // Canonical provenance — the exact inputs that produced this strategy.
  // These fields let the system answer:
  //   "Which profile snapshot did this use?"
  //   "Which intent version did this use?"
  //   "Which objective did this optimize?"
  //   "Which policy + engine version produced this?"
  // -------------------------------------------------------------------------
  /** The MobilityStateSnapshot.version this strategy was computed against. */
  mobilityStateVersion?: number
  /** The MobilityStateSnapshot id this strategy was computed against. */
  mobilityStateSnapshotId?: string
  /** The IntentRecord.version this strategy was computed against. */
  intentVersion?: number
  /** The IntentRecord id this strategy was computed against. */
  intentRecordId?: string
  /** The objective this strategy optimized for (e.g. 'residence'). */
  objectiveId?: string
  /** The objective version (immutable objective/intention record version). */
  objectiveVersion?: number

  // -------------------------------------------------------------------------
  // N0.5 — Needs + Desired Capability Intelligence
  // -------------------------------------------------------------------------
  /** The inferred needs assessment (WANT vs NEED vs OBJECTIVE). */
  needs?: import('./needs').NeedAssessment
  /** Desired capabilities derived from blocked trajectories. */
  desiredCapabilities?: import('./needs').DesiredCapability[]
  /** Summary of capability impact across all routes. */
  capabilityImpact?: import('./needs').CapabilityImpactSummary
}
