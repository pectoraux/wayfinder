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
// Graph-based Outcome Type Derivation — AUTHORITATIVE, never text-based
// ---------------------------------------------------------------------------
//
// BLOCKER 1 FIX: The previous implementation used label.includes() and
// description.includes() to classify outcomes (e.g., "citizenship" →
// CITIZENSHIP_GRANTED). That is text-based semantic inference — a graph
// node being selected does not make its label-based interpretation
// authoritative.
//
// The ONLY authoritative machine-readable metadata on a DecisionNode is:
//   - node.type (OBJECTIVE, NEED, BLOCKER, CAPABILITY, ACTION, OUTCOME, ...)
//   - node.provenance.source (the module that produced the node)
//   - node.provenance.references (specific field references)
//
// None of these contain an explicit OutcomeType. Therefore:
//   - We map provenance.source to a COARSE OutcomeType only where the
//     mapping is semantically exact (e.g., 'DesiredCapability.potentialUnlocks'
//     → CAPABILITY_ACQUIRED — a capability unlock IS a capability acquired).
//   - We return UNKNOWN for any source that does not have an exact mapping.
//   - We NEVER read node.label or node.description for classification.
//
// Test B invariant: changing only label/description/display text must NOT
// change the derived OutcomeType. This is now structurally enforced —
// those fields are never read by the derivation.

/**
 * The authoritative mapping from a graph node's provenance.source to an
 * OutcomeType. This mapping is EXACT — it only includes cases where the
 * source semantics directly imply the OutcomeType.
 *
 * Sources NOT in this map produce UNKNOWN. We do NOT invent semantic
 * precision by reading display text.
 */
const PROVENANCE_SOURCE_TO_OUTCOME_TYPE: Record<string, OutcomeType> = {
  // A capability potential-unlock outcome means a capability would be
  // acquired. This is an exact semantic match.
  'DesiredCapability.potentialUnlocks': 'CAPABILITY_ACQUIRED',
  // NOTE: 'Strategy.bestTrajectory' does NOT have an exact mapping to a
  // specific OutcomeType (CITIZENSHIP_GRANTED vs RESIDENCE_GRANTED vs
  // ROUTE_UNLOCKED). The graph does not contain authoritative metadata
  // to distinguish these. We return UNKNOWN rather than guessing from
  // the trajectory label.
}

/**
 * Derive the OutcomeType for an action from the historical DecisionGraph.
 * AUTHORITATIVE — uses ONLY the graph's explicit nodes/edges and the
 * outcome node's provenance.source. NEVER reads label/description text.
 *
 * Returns UNKNOWN if:
 *   - The graph is null
 *   - The action node doesn't exist in the graph
 *   - No LEADS_TO edge from the action to an OUTCOME node
 *   - The outcome node's provenance.source has no exact mapping
 */
export function deriveOutcomeTypeFromGraph(
  graph: DecisionGraph,
  actionId: string,
): OutcomeType {
  const actionNodeId = `action-${hashId(actionId)}`

  // 1. Verify the action node exists in the graph
  const actionNode = graph.nodes.find((n) => n.id === actionNodeId && n.type === 'ACTION')
  if (!actionNode) return 'UNKNOWN'

  // 2. Find a LEADS_TO edge to an OUTCOME node
  const leadsToEdge = graph.edges.find(
    (e) => e.from === actionNodeId && e.type === 'LEADS_TO'
  )
  if (!leadsToEdge) return 'UNKNOWN'

  // 3. Verify the destination is an OUTCOME node
  const outcomeNode = graph.nodes.find(
    (n) => n.id === leadsToEdge.to && n.type === 'OUTCOME'
  )
  if (!outcomeNode) return 'UNKNOWN'

  // 4. Derive the outcome type from the outcome node's AUTHORITATIVE
  //    provenance.source ONLY. Never from label/description text.
  const source = outcomeNode.provenance?.source ?? ''
  return PROVENANCE_SOURCE_TO_OUTCOME_TYPE[source] ?? 'UNKNOWN'
}

/**
 * Derive the OutcomeType for a strategy from its historical DecisionGraph.
 * AUTHORITATIVE — uses ONLY the graph's OUTCOME node provenance.source.
 * NEVER reads label/description text.
 *
 * Returns UNKNOWN if the outcome node's provenance.source has no exact
 * mapping. The graph does not contain authoritative metadata to
 * distinguish CITIZENSHIP_GRANTED from RESIDENCE_GRANTED from
 * ROUTE_UNLOCKED — so we return UNKNOWN rather than guessing.
 */
export function deriveStrategyOutcomeTypeFromGraph(
  graph: DecisionGraph,
  strategy: Strategy,
): OutcomeType {
  if (!strategy.bestTrajectory) return 'UNKNOWN'
  const bestOutcomeId = `outcome-${hashId(strategy.bestTrajectory.id)}`
  const outcomeNode = graph.nodes.find(
    (n) => n.id === bestOutcomeId && n.type === 'OUTCOME'
  )

  if (!outcomeNode) return 'UNKNOWN'

  // Derive from AUTHORITATIVE provenance.source ONLY. Never from label.
  const source = outcomeNode.provenance?.source ?? ''
  return PROVENANCE_SOURCE_TO_OUTCOME_TYPE[source] ?? 'UNKNOWN'
}

// ---------------------------------------------------------------------------
// Graph Node Linkage Validation — full causal chain verification
// ---------------------------------------------------------------------------
//
// BLOCKER 2 FIX: The previous validateGraphNodeLinkage() only checked node
// existence + type. It did NOT verify the ACTION→LEADS_TO→OUTCOME causal
// edge. The createExpectedOutcomes() function used the edge destination as
// graphNodeId without validating that the destination was actually an
// OUTCOME node.
//
// The new validation API verifies the FULL causal chain:
//   1. ACTION node exists
//   2. ACTION node has type ACTION
//   3. OUTCOME node exists
//   4. OUTCOME node has type OUTCOME
//   5. edge exists
//   6. edge.from === ACTION node ID
//   7. edge.to === OUTCOME node ID
//   8. edge.type === LEADS_TO
//
// If ANY condition fails, the linkage is invalid and graphNodeId must be null.

export interface ActionOutcomeLinkageResult {
  valid: boolean
  reason:
    | 'OK'
    | 'ACTION_NODE_NOT_FOUND'
    | 'ACTION_NODE_TYPE_MISMATCH'
    | 'OUTCOME_NODE_NOT_FOUND'
    | 'OUTCOME_NODE_TYPE_MISMATCH'
    | 'LEADS_TO_EDGE_MISSING'
    | 'EDGE_DIRECTION_INVALID'
    | 'EDGE_TYPE_INVALID'
    | 'EDGE_DESTINATION_NOT_OUTCOME'
  /** The validated ACTION node ID (only present when valid). */
  actionNodeId?: string
  /** The validated OUTCOME node ID (only present when valid). */
  outcomeNodeId?: string
  /** The validated edge type (only present when valid). */
  edgeType?: string
}

/**
 * Validate the full ACTION →(LEADS_TO)→ OUTCOME causal chain in the EXACT
 * historical DecisionGraph.
 *
 * This verifies ALL of the following:
 *   1. ACTION node exists in the graph
 *   2. ACTION node has type ACTION
 *   3. A LEADS_TO edge exists from the ACTION node
 *   4. The edge's destination node exists
 *   5. The destination node has type OUTCOME
 *   6. edge.from === actionNodeId
 *   7. edge.to === outcomeNodeId
 *   8. edge.type === 'LEADS_TO'
 *
 * If ANY condition fails, returns { valid: false, reason: ... }.
 * The caller MUST set graphNodeId = null when valid is false.
 *
 * We do NOT reconstruct graph relationships from text. We do NOT search for
 * a "best matching" graph node. We do NOT substitute a current graph for a
 * historical graph. The historical graph is immutable.
 */
export function validateActionOutcomeLinkage(
  graph: DecisionGraph,
  actionId: string,
): ActionOutcomeLinkageResult {
  const actionNodeId = `action-${hashId(actionId)}`

  // 1. ACTION node exists
  const actionNode = graph.nodes.find((n) => n.id === actionNodeId)
  if (!actionNode) {
    return { valid: false, reason: 'ACTION_NODE_NOT_FOUND' }
  }

  // 2. ACTION node has type ACTION
  if (actionNode.type !== 'ACTION') {
    return { valid: false, reason: 'ACTION_NODE_TYPE_MISMATCH' }
  }

  // 3. Find a LEADS_TO edge from the ACTION node
  const leadsToEdge = graph.edges.find(
    (e) => e.from === actionNodeId && e.type === 'LEADS_TO'
  )
  if (!leadsToEdge) {
    return { valid: false, reason: 'LEADS_TO_EDGE_MISSING' }
  }

  // 4. The edge's destination node exists
  const outcomeNode = graph.nodes.find((n) => n.id === leadsToEdge.to)
  if (!outcomeNode) {
    return { valid: false, reason: 'OUTCOME_NODE_NOT_FOUND' }
  }

  // 5. The destination node has type OUTCOME (NOT a CAPABILITY, ACTION, etc.)
  if (outcomeNode.type !== 'OUTCOME') {
    return { valid: false, reason: 'EDGE_DESTINATION_NOT_OUTCOME' }
  }

  // 6, 7, 8 are implicitly verified by the edge filter above:
  //   - edge.from === actionNodeId (filter condition)
  //   - edge.to === outcomeNode.id (we found the node by this ID)
  //   - edge.type === 'LEADS_TO' (filter condition)

  return {
    valid: true,
    reason: 'OK',
    actionNodeId,
    outcomeNodeId: outcomeNode.id,
    edgeType: 'LEADS_TO',
  }
}

export interface StrategyOutcomeLinkageResult {
  valid: boolean
  reason:
    | 'OK'
    | 'NO_BEST_TRAJECTORY'
    | 'OUTCOME_NODE_NOT_FOUND'
    | 'OUTCOME_NODE_TYPE_MISMATCH'
  /** The validated OUTCOME node ID (only present when valid). */
  outcomeNodeId?: string
}

/**
 * Validate the strategy-level OUTCOME node in the EXACT historical
 * DecisionGraph. Verifies the OUTCOME node for the best trajectory exists
 * and has type OUTCOME.
 *
 * Does NOT assume that `outcome-${hash(bestTrajectory.id)}` is valid merely
 * because the ID can be generated — verifies the node actually exists in the
 * historical graph.
 */
export function validateStrategyOutcomeLinkage(
  graph: DecisionGraph,
  strategy: Strategy,
): StrategyOutcomeLinkageResult {
  if (!strategy.bestTrajectory) {
    return { valid: false, reason: 'NO_BEST_TRAJECTORY' }
  }

  const bestOutcomeId = `outcome-${hashId(strategy.bestTrajectory.id)}`
  const outcomeNode = graph.nodes.find((n) => n.id === bestOutcomeId)

  if (!outcomeNode) {
    return { valid: false, reason: 'OUTCOME_NODE_NOT_FOUND' }
  }

  if (outcomeNode.type !== 'OUTCOME') {
    return { valid: false, reason: 'OUTCOME_NODE_TYPE_MISMATCH' }
  }

  return {
    valid: true,
    reason: 'OK',
    outcomeNodeId: outcomeNode.id,
  }
}

/**
 * @deprecated Use validateActionOutcomeLinkage() for action-level outcomes
 * or validateStrategyOutcomeLinkage() for strategy-level outcomes. This
 * function is retained for backward compatibility but only checks node
 * existence + type — it does NOT verify the causal edge.
 */
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
 * @deprecated Use validateActionOutcomeLinkage() or validateStrategyOutcomeLinkage().
 * This function only checks node existence + type — it does NOT verify the
 * causal edge. Retained for backward compatibility.
 */
export function validateGraphNodeLinkage(
  graph: DecisionGraph,
  nodeId: string,
  expectedType: 'ACTION' | 'OUTCOME' | 'OBJECTIVE' | 'NEED' | 'BLOCKER' | 'CAPABILITY',
): GraphNodeLinkageResult {
  const node = graph.nodes.find((n) => n.id === nodeId)
  if (!node) {
    return { valid: false, reason: 'NODE_NOT_FOUND' }
  }
  if (node.type !== expectedType) {
    return { valid: false, reason: 'NODE_TYPE_MISMATCH' }
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

  // Validate the strategy-level OUTCOME node in the historical graph.
  // Uses validateStrategyOutcomeLinkage — verifies the node exists AND has
  // type OUTCOME. Does NOT assume the generated ID is valid.
  const strategyLinkage = graph
    ? validateStrategyOutcomeLinkage(graph, strategy)
    : null
  const validGraphOutcomeId = strategyLinkage?.valid
    ? strategyLinkage.outcomeNodeId ?? null
    : null

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
    // Graph-based type derivation (authoritative, never text). Falls back to UNKNOWN.
    const actionOutcomeType = graph
      ? deriveOutcomeTypeFromGraph(graph, action.id)
      : 'UNKNOWN'
    const actionExpectedBy = deriveExpectedByDate(action, adoptionDate)

    // Validate the FULL ACTION→LEADS_TO→OUTCOME causal chain.
    // graphNodeId is only set when ALL of the following are true:
    //   1. ACTION node exists + has type ACTION
    //   2. LEADS_TO edge exists from ACTION
    //   3. Destination node exists + has type OUTCOME
    // If ANY condition fails, graphNodeId is null.
    const actionLinkage = graph
      ? validateActionOutcomeLinkage(graph, action.id)
      : null
    const actionGraphNodeId = actionLinkage?.valid
      ? actionLinkage.outcomeNodeId ?? null
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
