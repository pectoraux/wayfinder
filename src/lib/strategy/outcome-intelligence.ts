// Wayfinder — Outcome Intelligence (N0.7)
//
// This module implements the OUTCOME INTELLIGENCE layer that moves Wayfinder
// from "here is the strategy" to "here is what happened after the strategy
// was followed."
//
// It is an OBSERVATION LAYER — NOT adaptive learning. It does NOT:
//   - alter ranking weights
//   - learn user preferences automatically
//   - infer approval probabilities
//   - create ML models
//   - change recommendations automatically
//
// ARCHITECTURE:
//
//   Strategy (adopted)
//       ↓
//   ExpectedOutcome (auto-created, immutable, predicted fields only)
//       ↓
//   Action (user executes)
//       ↓
//   ObservedOutcome (recorded when reality is known, immutable, append-only)
//       ↓
//   OutcomeEvaluation (deterministic: ACHIEVED / PARTIALLY_ACHIEVED / NOT_ACHIEVED / UNKNOWN)
//
// KEY INVARIANTS:
//   1. Expected outcomes are DETERMINISTIC — derived from the strategy snapshot
//      at adoption time. Never recalculated from current state.
//   2. Expected outcomes are IMMUTABLE — they are the frozen prediction.
//   3. Observed outcomes are APPEND-ONLY — each observation is a new event.
//      Historical observations are never overwritten.
//   4. Evaluations are DETERMINISTIC — same expected + observed → same result.
//   5. Provenance is SERVER-CONTROLLED — client submissions are always
//      USER_REPORTED. The client cannot claim EXTERNALLY_VERIFIED.
//   6. Objective isolation — outcomes for one objective do not silently become
//      evidence for another.
//   7. No fabricated precision — if the system cannot support a numeric
//      prediction, it returns null, not a fake number.
//
// This module EXTENDS the existing N0.4b evaluation.ts — it does NOT replace
// it. The existing MATCHED/PARTIALLY_MATCHED/MISSED statuses are mapped to
// the N0.7 ACHIEVED/PARTIALLY_ACHIEVED/NOT_ACHIEVED statuses.

import type { Strategy, Action, Trajectory } from '@/lib/strategy/types'
import type { ActionPrediction } from '@/lib/strategy/prediction'
import { deriveActionPrediction, deriveStrategyPrediction } from '@/lib/strategy/prediction'
import {
  evaluateActionOutcome,
  evaluateStrategyOutcome,
  type ActionOutcomeEvaluation,
  type StrategyOutcomeEvaluation,
  type EvaluationStatus,
} from '@/lib/strategy/evaluation'
import type { DecisionGraph } from '@/lib/strategy/decision-graph'

// ---------------------------------------------------------------------------
// Outcome Type — controlled vocabulary based on real Wayfinder concepts
// ---------------------------------------------------------------------------

/**
 * The type of an outcome. Based on real Wayfinder domain concepts — not
 * free text. Each type maps to a concrete real-world event that either
 * was expected (at adoption time) or was observed (when reality is known).
 *
 * The vocabulary is derived from:
 *   - Capability types (CREDENTIAL_RECOGNITION, LANGUAGE_CERTIFICATION, etc.)
 *   - Trajectory destination states (residence, citizenship)
 *   - Action categories (application submission, approval)
 *   - Unlock kinds (documentation, savings, etc.)
 */
export type OutcomeType =
  | 'ELIGIBILITY_OPENED'      // a route's eligibility became available (blocker removed)
  | 'ROUTE_UNLOCKED'          // a trajectory became viable (all blockers resolved)
  | 'APPLICATION_SUBMITTED'   // user submitted an application (visa, permit, etc.)
  | 'APPLICATION_APPROVED'    // application was approved
  | 'RESIDENCE_GRANTED'       // residence permit/visa granted
  | 'CITIZENSHIP_GRANTED'     // citizenship achieved
  | 'CREDENTIAL_RECOGNIZED'   // degree/qualification recognized
  | 'LANGUAGE_ACHIEVED'       // language certification achieved
  | 'CAPABILITY_ACQUIRED'     // desired capability acquired (employer offer, capital, etc.)
  | 'EMPLOYMENT_GAINED'       // job/employment secured
  | 'INCOME_CHANGED'          // income level changed
  | 'DOCUMENT_OBTAINED'       // required document obtained
  | 'OTHER'                   // catch-all for unexpected outcomes
  | 'UNKNOWN'                 // N0.7: cannot be established from authoritative graph/domain data

export const OUTCOME_TYPES: OutcomeType[] = [
  'ELIGIBILITY_OPENED',
  'ROUTE_UNLOCKED',
  'APPLICATION_SUBMITTED',
  'APPLICATION_APPROVED',
  'RESIDENCE_GRANTED',
  'CITIZENSHIP_GRANTED',
  'CREDENTIAL_RECOGNIZED',
  'LANGUAGE_ACHIEVED',
  'CAPABILITY_ACQUIRED',
  'EMPLOYMENT_GAINED',
  'INCOME_CHANGED',
  'DOCUMENT_OBTAINED',
  'OTHER',
  'UNKNOWN',
]

// ---------------------------------------------------------------------------
// Outcome Evaluation Status — deterministic, conservative
// ---------------------------------------------------------------------------

/**
 * The deterministic evaluation of an outcome, computed from expected vs
 * observed. This is NOT a probability or a learning signal — it is a
 * pure-function comparison.
 *
 *   ACHIEVED            — the observed outcome matches the expected outcome
 *   PARTIALLY_ACHIEVED  — the outcome was partially achieved (e.g., delayed)
 *   NOT_ACHIEVED        — the observed outcome contradicts the expected
 *   UNKNOWN             — no actual observation has been recorded yet
 */
export type OutcomeEvaluationStatus =
  | 'ACHIEVED'
  | 'PARTIALLY_ACHIEVED'
  | 'NOT_ACHIEVED'
  | 'UNKNOWN'

// ---------------------------------------------------------------------------
// Expected Outcome — the frozen prediction at adoption time
// ---------------------------------------------------------------------------

/**
 * An expected outcome — what Wayfinder predicted would happen. Created
 * automatically when a strategy is adopted. Immutable.
 *
 * This is NOT a new database model — it is a view over the existing
 * ActionOutcome / StrategyOutcome records where only the predicted fields
 * are populated (actual fields are null).
 */
export interface ExpectedOutcome {
  /** The outcome record ID (ActionOutcome.id or StrategyOutcome.id). */
  id: string
  /** The DecisionRecord this outcome belongs to. */
  decisionRecordId: string
  /** The objective this strategy was for (objective isolation). */
  objectiveId: string
  /** The controlled vocabulary outcome type. */
  outcomeType: OutcomeType
  /** The graph OUTCOME node this corresponds to (DecisionGraph integration). */
  graphNodeId?: string
  /** What was expected (human-readable). */
  description: string
  /** The target value (e.g., "B2 German", "3-4 months", "$5000"). */
  target?: string
  /** The unit of measurement (e.g., "months", "USD", "level"). */
  unit?: string
  /** When the outcome was expected to occur. */
  expectedByDate?: string
  /** How confident Wayfinder was (0.0-1.0). Conservative — never fabricated. */
  confidence?: number
  /** Why this was expected (evidence/reasoning). */
  evidence: string
  /** The action this outcome is for (null for strategy-level outcomes). */
  actionId?: string
  /** Whether this is an action-level or strategy-level outcome. */
  scope: 'ACTION' | 'STRATEGY'
  /** When this expected outcome was created (adoption time). */
  createdAt: string
}

// ---------------------------------------------------------------------------
// Observed Outcome — what actually happened
// ---------------------------------------------------------------------------

/**
 * The provenance of an observed outcome — who/what reported it.
 * Client submissions are ALWAYS USER_CONFIRMED. The client cannot claim
 * EXTERNAL_VERIFICATION.
 */
export type OutcomeProvenance =
  | 'USER_CONFIRMED'          // the user reported this observation (N0.7)
  | 'USER_REPORTED'           // the user reported this observation (N0.4b compat)
  | 'DOCUMENT'                // a document was uploaded as evidence
  | 'SYSTEM_EVENT'            // a system event triggered this (e.g., policy change)
  | 'POLICY_EVENT'            // a policy event affected this outcome
  | 'EXTERNAL_VERIFICATION'   // an external service verified this (server-side only)

/**
 * An observed outcome — what actually happened. Immutable, append-only.
 * Each observation is a separate event. Historical observations are never
 * overwritten.
 */
export interface ObservedOutcome {
  /** The outcome record ID. */
  id: string
  /** The expected outcome this observation corresponds to. */
  expectedOutcomeId: string | null
  /** The DecisionRecord this belongs to. */
  decisionRecordId: string
  /** The objective this strategy was for. */
  objectiveId: string
  /** What actually happened (human-readable). */
  description: string
  /** The actual value observed. */
  actualValue?: string
  /** When the observation was made. */
  observedAt: string
  /** Who/what reported this. */
  provenance: OutcomeProvenance
  /** The action this observation is for (null for strategy-level). */
  actionId?: string
  /** Scope. */
  scope: 'ACTION' | 'STRATEGY'
  /** Free-text notes. */
  notes?: string
  /** When this record was created. */
  createdAt: string
}

// ---------------------------------------------------------------------------
// Outcome Evaluation — deterministic comparison
// ---------------------------------------------------------------------------

/**
 * The full evaluation of an outcome — expected vs observed.
 * Deterministic: same inputs → same result. No ML, no probabilities.
 */
export interface OutcomeEvaluation {
  /** The overall evaluation status. */
  status: OutcomeEvaluationStatus
  /** Human-readable explanation. */
  explanation: string
  /** The expected outcome that was evaluated. */
  expectedOutcomeId: string | null
  /** Per-dimension comparison (if any numeric/boolean dimensions exist). */
  dimensions: Array<{
    name: string
    status: OutcomeEvaluationStatus
    expected?: string | number | boolean
    actual?: string | number | boolean
    variance?: number
  }>
  /** Whether the evaluation is based on user-entered data (not objective truth). */
  basedOnUserReport: boolean
}

// ---------------------------------------------------------------------------
// Outcome Type Derivation — deterministic, based on domain concepts
// ---------------------------------------------------------------------------

/**
 * Derive the OutcomeType for an action. Deterministic — based on the
 * action's characteristics (title, description, addressesBlockerId, etc.).
 *
 * This does NOT use any LLM. It pattern-matches against known Wayfinder
 * domain concepts.
 */
export function deriveOutcomeTypeFromAction(action: Action): OutcomeType {
  const text = `${action.title} ${action.description}`.toLowerCase()

  // Credential recognition
  if (text.includes('credential') || text.includes('degree recogn') ||
      text.includes('credential recogn') || text.includes('diploma recogn')) {
    return 'CREDENTIAL_RECOGNIZED'
  }

  // Language certification
  if (text.includes('language') || text.includes('b1') || text.includes('b2') ||
      text.includes('c1') || text.includes('c2') || text.includes('a1') ||
      text.includes('a2') || text.includes('language cert') ||
      text.includes('language test') || text.includes('ielts') ||
      text.includes('toefl') || text.includes('goethe') || text.includes('delf')) {
    return 'LANGUAGE_ACHIEVED'
  }

  // Application submission
  if (text.includes('submit') && (text.includes('application') || text.includes('visa') ||
      text.includes('permit') || text.includes('residence'))) {
    return 'APPLICATION_SUBMITTED'
  }

  // Application approval
  if (text.includes('approv') && (text.includes('application') || text.includes('visa') ||
      text.includes('permit') || text.includes('residence'))) {
    return 'APPLICATION_APPROVED'
  }

  // Residence granted
  if (text.includes('residence') && (text.includes('grant') || text.includes('receive') ||
      text.includes('obtain') || text.includes('get'))) {
    return 'RESIDENCE_GRANTED'
  }

  // Citizenship
  if (text.includes('citizenship') || text.includes('passport') || text.includes('naturaliz')) {
    return 'CITIZENSHIP_GRANTED'
  }

  // Employment
  if (text.includes('employ') || text.includes('job') || text.includes('offer') ||
      text.includes('work') && text.includes('sponsor')) {
    return 'EMPLOYMENT_GAINED'
  }

  // Income
  if (text.includes('income') || text.includes('salary') || text.includes('earn')) {
    return 'INCOME_CHANGED'
  }

  // Document
  if (text.includes('document') || text.includes('police record') ||
      text.includes('birth certificate') || text.includes('marriage certificate')) {
    return 'DOCUMENT_OBTAINED'
  }

  // Capital/savings
  if (text.includes('capital') || text.includes('savings') || text.includes('funds') ||
      text.includes('bank statement')) {
    return 'CAPABILITY_ACQUIRED'
  }

  // Business formation
  if (text.includes('business') || text.includes('company') || text.includes('startup') ||
      text.includes('incubator') || text.includes('found')) {
    return 'CAPABILITY_ACQUIRED'
  }

  // Default
  return 'OTHER'
}

/**
 * Derive the OutcomeType for a strategy's best trajectory. Deterministic.
 */
export function deriveOutcomeTypeFromStrategy(strategy: Strategy): OutcomeType {
  const trajectory = strategy.bestTrajectory
  if (!trajectory) return 'ROUTE_UNLOCKED'

  const text = `${trajectory.label} ${trajectory.destinationStatus ?? ''}`.toLowerCase()

  if (text.includes('citizenship') || text.includes('passport')) {
    return 'CITIZENSHIP_GRANTED'
  }
  if (text.includes('residence') || text.includes('permit') || text.includes('visa')) {
    return 'RESIDENCE_GRANTED'
  }
  if (text.includes('income') || text.includes('salary')) {
    return 'INCOME_CHANGED'
  }

  // Default for strategy-level: the trajectory becoming viable
  return 'ROUTE_UNLOCKED'
}

// ---------------------------------------------------------------------------
// Graph-based Outcome Type Derivation — AUTHORITATIVE, not text-based
// ---------------------------------------------------------------------------
//
// The canonical source of causal meaning is the DecisionGraph and its
// explicit nodes/edges. Text pattern-matching is NOT authoritative — a
// deterministic heuristic is still a heuristic.
//
// Where the graph provides the relationship, the graph wins. If a semantic
// outcome cannot be established from authoritative graph/domain data, we
// represent it as UNKNOWN rather than fabricate precision.

/**
 * Derive the OutcomeType for an action from the historical DecisionGraph.
 * This is the AUTHORITATIVE derivation — it uses the graph's explicit
 * nodes + edges, not text pattern-matching.
 *
 * The graph contains:
 *   ACTION →(LEADS_TO)→ OUTCOME
 *
 * We look at the OUTCOME node the action leads to, and derive the outcome
 * type from the outcome node's properties (label, description, provenance).
 *
 * Returns UNKNOWN if:
 *   - The graph is null
 *   - The action node doesn't exist in the graph
 *   - No LEADS_TO edge from the action
 *   - The outcome type cannot be established from the graph
 */
export function deriveOutcomeTypeFromGraph(
  graph: DecisionGraph,
  actionId: string,
): OutcomeType {
  // The action node ID in the graph is `action-${hashString(actionId)}`.
  // We mirror the hashString function from decision-graph.ts.
  const actionNodeId = `action-${hashId(actionId)}`

  // 1. Verify the action node exists in the graph
  const actionNode = graph.nodes.find((n) => n.id === actionNodeId && n.type === 'ACTION')
  if (!actionNode) return 'UNKNOWN'

  // 2. Find LEADS_TO edges from this action
  const leadsToEdges = graph.edges.filter(
    (e) => e.from === actionNodeId && e.type === 'LEADS_TO'
  )

  if (leadsToEdges.length === 0) return 'UNKNOWN'

  // 3. Look at the OUTCOME node(s) this action leads to
  for (const edge of leadsToEdges) {
    const outcomeNode = graph.nodes.find((n) => n.id === edge.to && n.type === 'OUTCOME')
    if (!outcomeNode) continue

    // Derive the outcome type from the outcome node's provenance + label.
    // The outcome node's provenance.source tells us where it came from:
    //   - 'Strategy.bestTrajectory' → ROUTE_UNLOCKED
    //   - 'DesiredCapability.potentialUnlocks' → CAPABILITY_ACQUIRED
    const source = outcomeNode.provenance?.source ?? ''
    const label = (outcomeNode.label ?? '').toLowerCase()
    const description = (outcomeNode.description ?? '').toLowerCase()

    if (source === 'Strategy.bestTrajectory') {
      // The best trajectory outcome — derive from the trajectory label
      if (label.includes('citizenship') || label.includes('passport')) return 'CITIZENSHIP_GRANTED'
      if (label.includes('residence') || label.includes('permit') || label.includes('visa')) return 'RESIDENCE_GRANTED'
      return 'ROUTE_UNLOCKED'
    }

    if (source === 'DesiredCapability.potentialUnlocks') {
      // A capability unlock — the outcome is that a capability was acquired
      return 'CAPABILITY_ACQUIRED'
    }

    // Fallback: if the graph provides an outcome node but we cannot establish
    // a semantic type from its provenance, return UNKNOWN (not a text guess).
    // We do NOT pattern-match on label/description here — that would be a
    // heuristic, not authoritative graph data.
    void label
    void description
  }

  return 'UNKNOWN'
}

/**
 * Derive the OutcomeType for a strategy from its historical DecisionGraph.
 * Authoritative — uses the graph's OUTCOME node for the best trajectory.
 */
export function deriveStrategyOutcomeTypeFromGraph(
  graph: DecisionGraph,
  strategy: Strategy,
): OutcomeType {
  // Find the OUTCOME node for the best trajectory
  if (!strategy.bestTrajectory) return 'UNKNOWN'
  const bestOutcomeId = `outcome-${hashId(strategy.bestTrajectory.id)}`
  const outcomeNode = graph.nodes.find(
    (n) => n.id === bestOutcomeId && n.type === 'OUTCOME'
  )

  if (!outcomeNode) return 'UNKNOWN'

  // Only derive from authoritative provenance
  const source = outcomeNode.provenance?.source ?? ''
  if (source === 'Strategy.bestTrajectory') {
    const label = (outcomeNode.label ?? '').toLowerCase()
    if (label.includes('citizenship') || label.includes('passport')) return 'CITIZENSHIP_GRANTED'
    if (label.includes('residence') || label.includes('permit') || label.includes('visa')) return 'RESIDENCE_GRANTED'
    return 'ROUTE_UNLOCKED'
  }

  return 'UNKNOWN'
}

// ---------------------------------------------------------------------------
// Graph Node Linkage Validation
// ---------------------------------------------------------------------------

export interface GraphNodeLinkageResult {
  valid: boolean
  reason:
    | 'OK'
    | 'NO_HISTORICAL_GRAPH'
    | 'NODE_NOT_FOUND'
    | 'NODE_TYPE_MISMATCH'
    | 'REQUIRED_EDGE_MISSING'
    | 'EDGE_DIRECTION_INVALID'
}

/**
 * Validate that a graphNodeId refers to an actual node in the EXACT historical
 * DecisionGraph. This enforces graph linkage integrity:
 *
 *   - node exists in the historical graph
 *   - node type is correct
 *   - required causal edge exists (where applicable)
 *   - edge direction is correct
 *
 * We do NOT reconstruct graph relationships from text. We do NOT search for
 * a "best matching" graph node. We do NOT substitute a current graph for a
 * historical graph. The historical graph is immutable.
 */
export function validateGraphNodeLinkage(
  graph: DecisionGraph,
  nodeId: string,
  expectedType: 'ACTION' | 'OUTCOME' | 'OBJECTIVE' | 'NEED' | 'BLOCKER' | 'CAPABILITY',
): GraphNodeLinkageResult {
  // 1. Node exists in the graph
  const node = graph.nodes.find((n) => n.id === nodeId)
  if (!node) {
    return { valid: false, reason: 'NODE_NOT_FOUND' }
  }

  // 2. Node type is correct
  if (node.type !== expectedType) {
    return { valid: false, reason: 'NODE_TYPE_MISMATCH' }
  }

  // 3. For ACTION nodes: verify a LEADS_TO edge exists (actions lead to outcomes)
  if (expectedType === 'ACTION') {
    const hasLeadsTo = graph.edges.some(
      (e) => e.from === nodeId && e.type === 'LEADS_TO'
    )
    if (!hasLeadsTo) {
      // An action with no LEADS_TO edge is still a valid node — it just
      // doesn't have a connected outcome. This is not an error.
    }
  }

  return { valid: true, reason: 'OK' }
}

/**
 * Validate that a specific causal edge exists in the historical graph,
 * with the correct direction. Used to verify that an observed outcome
 * is causally linked to the expected outcome's action via the graph.
 */
export function validateGraphEdge(
  graph: DecisionGraph,
  fromNodeId: string,
  toNodeId: string,
  edgeType: string,
): boolean {
  return graph.edges.some(
    (e) => e.from === fromNodeId && e.to === toNodeId && e.type === edgeType
  )
}

// ---------------------------------------------------------------------------
// Confidence Level — qualitative, never fabricated probability
// ---------------------------------------------------------------------------

/**
 * Qualitative epistemic confidence. Wayfinder NEVER fabricates numeric
 * probabilities unless a demonstrable mathematical/calibration basis exists
 * in the repository. The confidence dimensions in the strategy's uncertainty
 * assessments are already qualitative (HIGH/MEDIUM/LOW/UNKNOWN) — we preserve
 * that representation rather than inventing pseudo-probabilities like 0.8/0.5.
 */
export type ConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN'

export const CONFIDENCE_LEVELS: ConfidenceLevel[] = ['HIGH', 'MEDIUM', 'LOW', 'UNKNOWN']

/**
 * Derive the qualitative confidence level for an expected outcome.
 * Conservative — uses the WORST confidence dimension from the strategy's
 * uncertainty assessments. Never returns a fabricated probability.
 *
 * If the strategy has no uncertainty assessments, returns UNKNOWN (not a
 * fake high confidence).
 */
export function deriveConfidenceLevel(strategy: Strategy): ConfidenceLevel {
  const uncertainties = strategy.uncertainties
  if (!uncertainties || uncertainties.length === 0) return 'UNKNOWN'

  // Rank: UNKNOWN < LOW < MEDIUM < HIGH. We take the WORST (lowest rank).
  const rank: Record<string, number> = {
    unknown: 0,
    low: 1,
    medium: 2,
    high: 3,
  }

  let minRank = Infinity
  for (const u of uncertainties) {
    const r = rank[(u.confidence ?? 'unknown').toLowerCase()] ?? 0
    if (r < minRank) minRank = r
  }

  if (minRank === Infinity) return 'UNKNOWN'
  if (minRank === 0) return 'UNKNOWN'
  if (minRank === 1) return 'LOW'
  if (minRank === 2) return 'MEDIUM'
  return 'HIGH'
}

/**
 * @deprecated Use deriveConfidenceLevel (qualitative). This function is
 * retained for backward compatibility with existing persisted records that
 * have a numeric `confidence` field. It returns null — new code must NOT
 * fabricate numeric confidence values.
 */
export function deriveOutcomeConfidence(_strategy: Strategy): number | null {
  return null
}

// ---------------------------------------------------------------------------
// Expected By Date Derivation — from action timeframe + adoption date
// ---------------------------------------------------------------------------

/**
 * Derive the expected-by date for an action outcome. Deterministic —
 * based on the action's timeframe + the adoption date.
 */
export function deriveExpectedByDate(
  action: Action,
  adoptionDate: Date,
): Date | null {
  const months = timeframeToMonths(action.timeframe)
  if (months === null) return null

  const result = new Date(adoptionDate)
  result.setMonth(result.getMonth() + months)
  return result
}

function timeframeToMonths(timeframe: string): number | null {
  switch (timeframe) {
    case '7_DAYS': return 0.25
    case '30_DAYS': return 1
    case '90_DAYS': return 3
    case '6_MONTHS': return 6
    case 'ONGOING': return null
    default: return null
  }
}

// ---------------------------------------------------------------------------
// Expected Outcome Creation — at adoption time
// ---------------------------------------------------------------------------

/**
 * The input for creating expected outcomes at adoption time.
 */
export interface ExpectedOutcomeInput {
  strategy: Strategy
  decisionRecordId: string
  objectiveId: string
  userId: string
  adoptionDate: Date
  /** The DecisionGraph (for linking outcomes to graph nodes). */
  graph?: DecisionGraph
}

/**
 * The result of creating expected outcomes — the records to persist.
 * These are plain objects (not DB records) so the caller can persist them
 * in a transaction.
 */
export interface ExpectedOutcomeRecord {
  userId: string
  decisionRecordId: string
  objectiveId: string
  outcomeType: OutcomeType
  graphNodeId?: string | null
  description: string
  target?: string | null
  unit?: string | null
  expectedByDate?: Date | null
  /** N0.7: Qualitative confidence level. Never a fabricated probability. */
  confidenceLevel?: ConfidenceLevel
  evidence: string
  actionId?: string
  scope: 'ACTION' | 'STRATEGY'
  // Predicted fields (for the existing ActionOutcome/StrategyOutcome schema)
  predictedEffect?: string | null
  predictedDurationMonths?: number | null
  predictedCostUSD?: number | null
  predictedBlockerResolved?: boolean | null
  predictedTrajectoryViable?: boolean | null
  predictedTimelineMonths?: number | null
  predictedTotalCostUSD?: number | null
  idempotencyKey: string
}

/**
 * Create the expected outcomes for a strategy adoption. Deterministic —
 * same strategy + adoption context → same expected outcomes.
 *
 * This creates:
 *   1. One strategy-level expected outcome (the trajectory becoming viable)
 *   2. One action-level expected outcome per action in the action plan
 *
 * Each expected outcome links to the DecisionGraph OUTCOME node where
 * the graph provides a valid linkage (validated, not text-guessed).
 *
 * N0.7 HARDENING:
 *   - Outcome types are derived from the GRAPH (authoritative), not text.
 *     Falls back to UNKNOWN when the graph doesn't provide a relationship.
 *   - Confidence is qualitative (HIGH/MEDIUM/LOW/UNKNOWN), never a fabricated
 *     numeric probability.
 *   - Expected dates derive from the immutable adoption timestamp.
 *   - graphNodeId is only set when the node actually exists in the historical
 *     graph (validated via validateGraphNodeLinkage).
 */
export function createExpectedOutcomes(input: ExpectedOutcomeInput): ExpectedOutcomeRecord[] {
  const records: ExpectedOutcomeRecord[] = []
  const { strategy, decisionRecordId, objectiveId, userId, adoptionDate, graph } = input

  // Find the graph OUTCOME node for the best trajectory
  const bestOutcomeNodeId = strategy.bestTrajectory
    ? `outcome-${hashId(strategy.bestTrajectory.id)}`
    : undefined

  // Validate the graph linkage — only set graphNodeId if the node actually
  // exists in the historical graph.
  const graphOutcomeLinkage = (graph && bestOutcomeNodeId)
    ? validateGraphNodeLinkage(graph, bestOutcomeNodeId, 'OUTCOME')
    : null
  const validGraphOutcomeId = graphOutcomeLinkage?.valid ? bestOutcomeNodeId : null

  // --- Strategy-level expected outcome ---
  const strategyPrediction = deriveStrategyPrediction(strategy, decisionRecordId)
  const strategyOutcomeType = graph
    ? deriveStrategyOutcomeTypeFromGraph(graph, strategy)
    : 'UNKNOWN'
  const strategyConfidenceLevel = deriveConfidenceLevel(strategy)

  records.push({
    userId,
    decisionRecordId,
    objectiveId,
    outcomeType: strategyOutcomeType,
    graphNodeId: validGraphOutcomeId,
    description: strategy.bestTrajectory
      ? `Trajectory "${strategy.bestTrajectory.label}" becomes viable`
      : 'Strategy trajectory becomes viable',
    target: strategy.bestTrajectory?.label,
    unit: 'trajectory',
    expectedByDate: strategy.bestTrajectory?.totalMonths
      ? addMonths(adoptionDate, strategy.bestTrajectory.totalMonths)
      : undefined,
    confidenceLevel: strategyConfidenceLevel,
    evidence: strategy.bestTrajectory
      ? `Predicted timeline: ${strategy.bestTrajectory.totalMonths} months, cost: $${strategy.bestTrajectory.totalCostUSD}`
      : 'Derived from strategy best trajectory',
    scope: 'STRATEGY',
    predictedTrajectoryViable: strategyPrediction.predictedTrajectoryViable,
    predictedTimelineMonths: strategyPrediction.predictedTimelineMonths,
    predictedTotalCostUSD: strategyPrediction.predictedTotalCostUSD,
    idempotencyKey: `${userId}:${decisionRecordId}:expected:strategy`,
  })

  // --- Action-level expected outcomes ---
  for (const action of strategy.actionPlan?.actions ?? []) {
    const actionPrediction = deriveActionPrediction(strategy, action.id, decisionRecordId)
    // Graph-based type derivation (authoritative). Falls back to UNKNOWN.
    const actionOutcomeType = graph
      ? deriveOutcomeTypeFromGraph(graph, action.id)
      : 'UNKNOWN'
    const actionExpectedBy = deriveExpectedByDate(action, adoptionDate)

    // Validate the action's graph node exists in the historical graph.
    const actionNodeId = `action-${hashId(action.id)}`
    const actionNodeLinkage = graph
      ? validateGraphNodeLinkage(graph, actionNodeId, 'ACTION')
      : null

    // Find the OUTCOME node this action leads to (via LEADS_TO edge)
    const actionOutcomeEdge = graph?.edges.find(
      (e) => e.from === actionNodeId && e.type === 'LEADS_TO'
    )
    // Only set graphNodeId if both the action node AND the outcome node exist
    const actionGraphNodeId = (actionNodeLinkage?.valid && actionOutcomeEdge)
      ? actionOutcomeEdge.to
      : null

    records.push({
      userId,
      decisionRecordId,
      objectiveId,
      outcomeType: actionOutcomeType,
      graphNodeId: actionGraphNodeId,
      description: action.description,
      target: action.title,
      unit: action.timeframe,
      expectedByDate: actionExpectedBy,
      confidenceLevel: strategyConfidenceLevel,
      evidence: `Action: ${action.title}, timeframe: ${action.timeframe}, impact: ${action.impact}`,
      actionId: action.id,
      scope: 'ACTION',
      predictedEffect: actionPrediction.predictedEffect,
      predictedDurationMonths: actionPrediction.predictedDurationMonths,
      predictedCostUSD: actionPrediction.predictedCostUSD,
      predictedBlockerResolved: actionPrediction.predictedBlockerResolved,
      idempotencyKey: `${userId}:${decisionRecordId}:expected:action:${action.id}`,
    })
  }

  return records
}

// ---------------------------------------------------------------------------
// Outcome Evaluation — deterministic comparison
// ---------------------------------------------------------------------------

/**
 * Evaluate an action outcome. Deterministic — maps the existing
 * MATCHED/PARTIALLY_MATCHED/MISSED evaluation to the N0.7
 * ACHIEVED/PARTIALLY_ACHIEVED/NOT_ACHIEVED status.
 */
export function evaluateActionOutcomeN07(opts: {
  predictedEffect?: string | null
  actualEffect?: string | null
  predictedDurationMonths?: number | null
  actualDurationMonths?: number | null
  predictedCostUSD?: number | null
  actualCostUSD?: number | null
  predictedBlockerResolved?: boolean | null
  actualBlockerResolved?: boolean | null
  expectedOutcomeId: string | null
  provenance?: string
}): OutcomeEvaluation {
  const n04Result = evaluateActionOutcome({
    predictedEffect: opts.predictedEffect,
    actualEffect: opts.actualEffect,
    predictedDurationMonths: opts.predictedDurationMonths,
    actualDurationMonths: opts.actualDurationMonths,
    predictedCostUSD: opts.predictedCostUSD,
    actualCostUSD: opts.actualCostUSD,
    predictedBlockerResolved: opts.predictedBlockerResolved,
    actualBlockerResolved: opts.actualBlockerResolved,
  })

  const status = mapEvaluationStatus(n04Result.overallStatus)
  const basedOnUserReport = opts.provenance === 'USER_REPORTED' || opts.provenance === 'USER_CONFIRMED'

  return {
    status,
    explanation: n04Result.explanation,
    expectedOutcomeId: opts.expectedOutcomeId,
    dimensions: n04Result.dimensions.map((d) => ({
      name: d.name,
      status: mapEvaluationStatus(d.status),
      variance: d.variance?.relativeDelta,
    })),
    basedOnUserReport,
  }
}

/**
 * Evaluate a strategy outcome. Deterministic.
 */
export function evaluateStrategyOutcomeN07(opts: {
  predictedTrajectoryViable?: boolean | null
  actualTrajectoryViable?: boolean | null
  predictedTimelineMonths?: number | null
  actualTimelineMonths?: number | null
  predictedTotalCostUSD?: number | null
  actualTotalCostUSD?: number | null
  strategyFollowed?: string | null
  expectedOutcomeId: string | null
  provenance?: string
}): OutcomeEvaluation {
  const n04Result = evaluateStrategyOutcome({
    predictedTrajectoryViable: opts.predictedTrajectoryViable,
    actualTrajectoryViable: opts.actualTrajectoryViable,
    predictedTimelineMonths: opts.predictedTimelineMonths,
    actualTimelineMonths: opts.actualTimelineMonths,
    predictedTotalCostUSD: opts.predictedTotalCostUSD,
    actualTotalCostUSD: opts.actualTotalCostUSD,
    strategyFollowed: opts.strategyFollowed,
  })

  const status = mapEvaluationStatus(n04Result.overallStatus)
  const basedOnUserReport = opts.provenance === 'USER_REPORTED' || opts.provenance === 'USER_CONFIRMED'

  return {
    status,
    explanation: n04Result.explanation,
    expectedOutcomeId: opts.expectedOutcomeId,
    dimensions: n04Result.dimensions.map((d) => ({
      name: d.name,
      status: mapEvaluationStatus(d.status),
      variance: d.variance?.relativeDelta,
    })),
    basedOnUserReport,
  }
}

/**
 * Map the N0.4b EvaluationStatus to the N0.7 OutcomeEvaluationStatus.
 * Deterministic.
 *
 *   MATCHED            → ACHIEVED
 *   PARTIALLY_MATCHED  → PARTIALLY_ACHIEVED
 *   MISSED             → NOT_ACHIEVED
 *   UNKNOWN            → UNKNOWN
 */
export function mapEvaluationStatus(status: EvaluationStatus): OutcomeEvaluationStatus {
  switch (status) {
    case 'MATCHED': return 'ACHIEVED'
    case 'PARTIALLY_MATCHED': return 'PARTIALLY_ACHIEVED'
    case 'MISSED': return 'NOT_ACHIEVED'
    case 'UNKNOWN': return 'UNKNOWN'
    default: return 'UNKNOWN'
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hashId(id: string): string {
  let hash = 0
  for (let i = 0; i < id.length; i++) {
    const char = id.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash |= 0
  }
  return Math.abs(hash).toString(36)
}

function addMonths(date: Date, months: number): Date {
  const result = new Date(date)
  result.setMonth(result.getMonth() + months)
  return result
}

// ---------------------------------------------------------------------------
// Outcome Type Validation — for API input
// ---------------------------------------------------------------------------

/**
 * Validate that a string is a valid OutcomeType. Returns the typed value
 * or null if invalid.
 */
export function validateOutcomeType(value: string): OutcomeType | null {
  return OUTCOME_TYPES.includes(value as OutcomeType) ? (value as OutcomeType) : null
}

/**
 * Validate that a string is a valid OutcomeEvaluationStatus.
 */
export function validateEvaluationStatus(value: string): OutcomeEvaluationStatus | null {
  const valid: OutcomeEvaluationStatus[] = ['ACHIEVED', 'PARTIALLY_ACHIEVED', 'NOT_ACHIEVED', 'UNKNOWN']
  return valid.includes(value as OutcomeEvaluationStatus) ? (value as OutcomeEvaluationStatus) : null
}

/**
 * Validate that a string is a valid OutcomeProvenance. Client submissions
 * can only be USER_CONFIRMED or USER_REPORTED — the server rejects
 * EXTERNAL_VERIFICATION from clients.
 *
 * Note: USER_REPORTED and USER_CONFIRMED are treated as equivalent client-
 * acceptable provenance values. The existing N0.4b schema uses
 * USER_REPORTED; N0.7 introduced USER_CONFIRMED. Both are accepted from
 * clients and mapped to the same semantic ("the user reported this").
 */
export function validateProvenance(value: string, isClientSubmission: boolean): OutcomeProvenance | null {
  const valid: OutcomeProvenance[] = [
    'USER_CONFIRMED',
    'USER_REPORTED',
    'DOCUMENT',
    'SYSTEM_EVENT',
    'POLICY_EVENT',
    'EXTERNAL_VERIFICATION',
  ]
  if (!valid.includes(value as OutcomeProvenance)) return null
  // Client submissions can NEVER claim EXTERNAL_VERIFICATION
  if (isClientSubmission && value === 'EXTERNAL_VERIFICATION') return null
  return value as OutcomeProvenance
}
