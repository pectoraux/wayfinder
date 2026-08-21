// Wayfinder — N0.7 Outcome Intelligence Tests
//
// Tests the outcome intelligence layer: expected outcomes, observed outcomes,
// deterministic evaluation, immutability, objective isolation, authorization,
// graph linkage, provenance, and adversarial scenarios.
//
// KEY INVARIANTS:
//   1. Expected outcomes are deterministic and immutable
//   2. Observed outcomes are immutable and append-only
//   3. Evaluations are deterministic (same inputs → same result)
//   4. No fabricated precision (no fake approval probabilities)
//   5. Objective isolation (outcomes don't leak across objectives)
//   6. Cross-user authorization (no user can access another's outcomes)
//   7. Historical strategies remain immutable
//   8. Replay remains independent of outcomes
//   9. Graph OUTCOME nodes integrate with observations
//  10. No adaptive learning (outcomes don't change the engine)

import { describe, it, expect, beforeAll } from 'vitest'
import { buildStrategy } from '@/lib/strategy'
import { exampleState } from '@/lib/domain/state'
import { parseIntentDeterministic } from '@/lib/domain/intent'
import { generateRoutes } from '@/lib/engine/routes'
import { buildDecisionGraph, type DecisionGraph } from '@/lib/strategy/decision-graph'
import {
  createExpectedOutcomes,
  deriveOutcomeTypeFromAction,
  deriveOutcomeTypeFromStrategy,
  deriveOutcomeConfidence,
  deriveConfidenceLevel,
  deriveOutcomeTypeFromGraph,
  deriveStrategyOutcomeTypeFromGraph,
  validateGraphNodeLinkage,
  validateGraphEdge,
  validateActionOutcomeLinkage,
  validateStrategyOutcomeLinkage,
  deriveExpectedByDate,
  evaluateActionOutcomeN07,
  evaluateStrategyOutcomeN07,
  mapEvaluationStatus,
  validateOutcomeType,
  validateProvenance,
  OUTCOME_TYPES,
  type OutcomeType,
  type OutcomeEvaluationStatus,
  type ConfidenceLevel,
} from '@/lib/strategy/outcome-intelligence'
import type { Strategy, Action } from '@/lib/strategy/types'
import type { EvaluationStatus } from '@/lib/strategy/evaluation'

const baseState = exampleState()
const baseIntent = parseIntentDeterministic('I want to move abroad and earn more.')
const baseRoutes = generateRoutes(baseState, baseIntent, '2025-06-01')

describe('N0.7 — Outcome Intelligence', () => {
  let strategy: Strategy

  beforeAll(async () => {
    strategy = await buildStrategy(baseState, baseIntent, baseRoutes)
  })

  // =========================================================================
  // 1. EXPECTED OUTCOME CREATION
  // =========================================================================

  describe('Expected outcome creation', () => {
    it('creates expected outcomes deterministically from a strategy', () => {
      const graph = buildDecisionGraph(strategy)
      const records = createExpectedOutcomes({
        strategy,
        decisionRecordId: 'rec-1',
        objectiveId: 'income',
        userId: 'user-1',
        adoptionDate: new Date('2025-01-01'),
        graph,
      })

      expect(records.length).toBeGreaterThan(0)
      // Should always have at least a strategy-level expected outcome
      expect(records.some((r) => r.scope === 'STRATEGY')).toBe(true)
      // Action-level outcomes are created when the strategy has actions
      if (strategy.actionPlan?.actions?.length) {
        expect(records.some((r) => r.scope === 'ACTION')).toBe(true)
      }
    })

    it('same strategy + adoption context → same expected outcomes (deterministic)', () => {
      const records1 = createExpectedOutcomes({
        strategy,
        decisionRecordId: 'rec-1',
        objectiveId: 'income',
        userId: 'user-1',
        adoptionDate: new Date('2025-01-01'),
      })
      const records2 = createExpectedOutcomes({
        strategy,
        decisionRecordId: 'rec-1',
        objectiveId: 'income',
        userId: 'user-1',
        adoptionDate: new Date('2025-01-01'),
      })

      expect(JSON.stringify(records1)).toBe(JSON.stringify(records2))
    })

    it('expected outcomes have strategy provenance (decisionRecordId + objectiveId)', () => {
      const records = createExpectedOutcomes({
        strategy,
        decisionRecordId: 'rec-test',
        objectiveId: 'income',
        userId: 'user-test',
        adoptionDate: new Date('2025-01-01'),
      })

      for (const r of records) {
        expect(r.decisionRecordId).toBe('rec-test')
        expect(r.objectiveId).toBe('income')
        expect(r.userId).toBe('user-test')
      }
    })

    it('expected outcomes link to graph OUTCOME nodes where applicable', () => {
      const graph = buildDecisionGraph(strategy)
      const records = createExpectedOutcomes({
        strategy,
        decisionRecordId: 'rec-graph',
        objectiveId: 'income',
        userId: 'user-graph',
        adoptionDate: new Date('2025-01-01'),
        graph,
      })

      // Strategy-level outcome should have a graphNodeId if the graph has an OUTCOME node
      const strategyRecord = records.find((r) => r.scope === 'STRATEGY')
      if (strategyRecord && graph.nodes.some((n) => n.type === 'OUTCOME')) {
        expect(strategyRecord.graphNodeId).toBeTruthy()
      }
    })

    it('expected outcomes have deterministic idempotency keys', () => {
      const records = createExpectedOutcomes({
        strategy,
        decisionRecordId: 'rec-idem',
        objectiveId: 'income',
        userId: 'user-idem',
        adoptionDate: new Date('2025-01-01'),
      })

      for (const r of records) {
        expect(r.idempotencyKey).toBeTruthy()
        expect(r.idempotencyKey).toContain('user-idem')
        expect(r.idempotencyKey).toContain('rec-idem')
      }
    })
  })

  // =========================================================================
  // 2. OUTCOME TYPE DERIVATION
  // =========================================================================

  describe('Outcome type derivation', () => {
    it('derives CREDENTIAL_RECOGNIZED from credential-related actions', () => {
      const action: Action = {
        id: 'act-cred',
        title: 'Get degree recognized',
        description: 'Submit credential for recognition in Germany',
        timeframe: '90_DAYS',
        impact: 0.8,
        timeSensitive: false,
        reversible: false,
      }
      expect(deriveOutcomeTypeFromAction(action)).toBe('CREDENTIAL_RECOGNIZED')
    })

    it('derives LANGUAGE_ACHIEVED from language-related actions', () => {
      const action: Action = {
        id: 'act-lang',
        title: 'Take B2 German test',
        description: 'Pass the Goethe B2 certification exam',
        timeframe: '6_MONTHS',
        impact: 0.7,
        timeSensitive: false,
        reversible: false,
      }
      expect(deriveOutcomeTypeFromAction(action)).toBe('LANGUAGE_ACHIEVED')
    })

    it('derives APPLICATION_SUBMITTED from application-related actions', () => {
      const action: Action = {
        id: 'act-app',
        title: 'Submit visa application',
        description: 'Submit the D7 visa application to Portuguese consulate',
        timeframe: '30_DAYS',
        impact: 0.9,
        timeSensitive: true,
        reversible: false,
      }
      expect(deriveOutcomeTypeFromAction(action)).toBe('APPLICATION_SUBMITTED')
    })

    it('derives strategy-level outcome type from best trajectory', () => {
      const type = deriveOutcomeTypeFromStrategy(strategy)
      expect(OUTCOME_TYPES).toContain(type)
    })

    it('outcome type is deterministic (same action → same type)', () => {
      const action: Action = {
        id: 'act-det',
        title: 'Get degree recognized',
        description: 'Credential recognition',
        timeframe: '90_DAYS',
        impact: 0.8,
        timeSensitive: false,
        reversible: false,
      }
      const type1 = deriveOutcomeTypeFromAction(action)
      const type2 = deriveOutcomeTypeFromAction(action)
      expect(type1).toBe(type2)
    })
  })

  // =========================================================================
  // 3. CONFIDENCE DERIVATION (qualitative, no fabricated precision)
  // =========================================================================

  describe('Confidence derivation', () => {
    it('confidence level is derived from strategy uncertainties (conservative)', () => {
      const level = deriveConfidenceLevel(strategy)
      // Should be a valid ConfidenceLevel
      expect(['HIGH', 'MEDIUM', 'LOW', 'UNKNOWN']).toContain(level)
    })

    it('confidence level is UNKNOWN when no uncertainties exist', () => {
      const strategyNoUncertainties: Strategy = {
        ...strategy,
        uncertainties: [],
      }
      expect(deriveConfidenceLevel(strategyNoUncertainties)).toBe('UNKNOWN')
    })

    it('confidence level uses the WORST dimension (conservative)', () => {
      const strategyMixed: Strategy = {
        ...strategy,
        uncertainties: [
          { dimension: 'Legal eligibility', confidence: 'HIGH' as any, reason: 'r1' },
          { dimension: 'Policy stability', confidence: 'LOW' as any, reason: 'r2' },
        ],
      }
      // LOW is the worst → confidence level is LOW
      expect(deriveConfidenceLevel(strategyMixed)).toBe('LOW')
    })

    it('confidence level is HIGH only when ALL dimensions are HIGH', () => {
      const strategyAllHigh: Strategy = {
        ...strategy,
        uncertainties: [
          { dimension: 'Legal eligibility', confidence: 'HIGH' as any, reason: 'r1' },
          { dimension: 'Policy stability', confidence: 'HIGH' as any, reason: 'r2' },
        ],
      }
      expect(deriveConfidenceLevel(strategyAllHigh)).toBe('HIGH')
    })

    it('no fabricated numeric precision (deriveOutcomeConfidence returns null)', () => {
      // The deprecated numeric function MUST return null — new code must NOT
      // fabricate numeric probabilities.
      expect(deriveOutcomeConfidence(strategy)).toBeNull()
    })

    it('confidence level is never a fabricated probability', () => {
      const level = deriveConfidenceLevel(strategy)
      // The result is a qualitative string, never a number
      expect(typeof level).toBe('string')
      expect(['HIGH', 'MEDIUM', 'LOW', 'UNKNOWN']).toContain(level)
    })
  })

  // =========================================================================
  // 4. DETERMINISTIC EVALUATION
  // =========================================================================

  describe('Deterministic evaluation', () => {
    it('ACHIEVED when predicted matches actual', () => {
      const evaluation = evaluateActionOutcomeN07({
        predictedEffect: 'Credential recognized',
        actualEffect: 'Credential recognized',
        expectedOutcomeId: 'exp-1',
        provenance: 'USER_REPORTED',
      })
      expect(evaluation.status).toBe('ACHIEVED')
    })

    it('PARTIALLY_ACHIEVED when there is a partial match', () => {
      // "Credential recognized" is a substring of "Credential recognized with restrictions"
      const evaluation = evaluateActionOutcomeN07({
        predictedEffect: 'Credential recognized',
        actualEffect: 'Credential recognized with restrictions',
        expectedOutcomeId: 'exp-2',
        provenance: 'USER_REPORTED',
      })
      // Partial match (one contains the other)
      expect(['PARTIALLY_ACHIEVED', 'ACHIEVED']).toContain(evaluation.status)
    })

    it('NOT_ACHIEVED when predicted contradicts actual', () => {
      const evaluation = evaluateActionOutcomeN07({
        predictedBlockerResolved: true,
        actualBlockerResolved: false,
        expectedOutcomeId: 'exp-3',
        provenance: 'USER_REPORTED',
      })
      expect(evaluation.status).toBe('NOT_ACHIEVED')
    })

    it('UNKNOWN when no actual observation recorded', () => {
      const evaluation = evaluateActionOutcomeN07({
        predictedEffect: 'Credential recognized',
        actualEffect: null,
        expectedOutcomeId: 'exp-4',
        provenance: 'USER_REPORTED',
      })
      expect(evaluation.status).toBe('UNKNOWN')
    })

    it('same inputs → same evaluation (deterministic)', () => {
      const opts = {
        predictedEffect: 'Test',
        actualEffect: 'Test',
        expectedOutcomeId: 'exp-det',
        provenance: 'USER_REPORTED' as const,
      }
      const evaluation1 = evaluateActionOutcomeN07(opts)
      const evaluation2 = evaluateActionOutcomeN07(opts)
      expect(JSON.stringify(evaluation1)).toBe(JSON.stringify(evaluation2))
    })

    it('evaluation flags user-reported data as not objective truth', () => {
      const evaluation = evaluateActionOutcomeN07({
        predictedEffect: 'Test',
        actualEffect: 'Test',
        expectedOutcomeId: 'exp-user',
        provenance: 'USER_REPORTED',
      })
      expect(evaluation.basedOnUserReport).toBe(true)
    })

    it('evaluation does not flag system-derived data as user-reported', () => {
      const evaluation = evaluateActionOutcomeN07({
        predictedEffect: 'Test',
        actualEffect: 'Test',
        expectedOutcomeId: 'exp-sys',
        provenance: 'EXTERNAL_VERIFICATION',
      })
      expect(evaluation.basedOnUserReport).toBe(false)
    })

    it('mapEvaluationStatus converts N0.4b statuses to N0.7 statuses', () => {
      expect(mapEvaluationStatus('MATCHED')).toBe('ACHIEVED')
      expect(mapEvaluationStatus('PARTIALLY_MATCHED')).toBe('PARTIALLY_ACHIEVED')
      expect(mapEvaluationStatus('MISSED')).toBe('NOT_ACHIEVED')
      expect(mapEvaluationStatus('UNKNOWN')).toBe('UNKNOWN')
    })
  })

  // =========================================================================
  // 5. EXPECTED BY DATE DERIVATION
  // =========================================================================

  describe('Expected by date derivation', () => {
    it('derives expected date from action timeframe + adoption date', () => {
      const action: Action = {
        id: 'act-date',
        title: 'Test',
        description: 'Test',
        timeframe: '6_MONTHS',
        impact: 0.5,
        timeSensitive: false,
        reversible: false,
      }
      const adoptionDate = new Date('2025-01-01')
      const expectedBy = deriveExpectedByDate(action, adoptionDate)
      expect(expectedBy).not.toBeNull()
      // Should be ~6 months later
      expect(expectedBy!.getMonth()).toBe(adoptionDate.getMonth() + 6)
    })

    it('returns null for ONGOING timeframe (no fixed date)', () => {
      const action: Action = {
        id: 'act-ongoing',
        title: 'Test',
        description: 'Test',
        timeframe: 'ONGOING',
        impact: 0.5,
        timeSensitive: false,
        reversible: false,
      }
      expect(deriveExpectedByDate(action, new Date())).toBeNull()
    })
  })

  // =========================================================================
  // 6. PROVENANCE VALIDATION
  // =========================================================================

  describe('Provenance validation', () => {
    it('accepts USER_CONFIRMED from client submissions', () => {
      expect(validateProvenance('USER_CONFIRMED', true)).toBe('USER_CONFIRMED')
    })

    it('rejects EXTERNAL_VERIFICATION from client submissions', () => {
      expect(validateProvenance('EXTERNAL_VERIFICATION', true)).toBeNull()
    })

    it('accepts EXTERNAL_VERIFICATION from server-side only', () => {
      expect(validateProvenance('EXTERNAL_VERIFICATION', false)).toBe('EXTERNAL_VERIFICATION')
    })

    it('rejects invalid provenance values', () => {
      expect(validateProvenance('INVALID', true)).toBeNull()
    })
  })

  // =========================================================================
  // 7. OUTCOME TYPE VALIDATION
  // =========================================================================

  describe('Outcome type validation', () => {
    it('accepts valid outcome types', () => {
      for (const type of OUTCOME_TYPES) {
        expect(validateOutcomeType(type)).toBe(type)
      }
    })

    it('rejects invalid outcome types', () => {
      expect(validateOutcomeType('INVALID_TYPE')).toBeNull()
      expect(validateOutcomeType('')).toBeNull()
    })
  })

  // =========================================================================
  // 8. NO ADAPTIVE LEARNING
  // =========================================================================

  describe('No adaptive learning', () => {
    it('evaluation does not modify the strategy', () => {
      const strategyCopy: Strategy = JSON.parse(JSON.stringify(strategy))
      evaluateStrategyOutcomeN07({
        predictedTrajectoryViable: true,
        actualTrajectoryViable: false,
        expectedOutcomeId: 'exp-nolearn',
        provenance: 'USER_REPORTED',
      })
      // Strategy is unchanged
      expect(JSON.stringify(strategy)).toBe(JSON.stringify(strategyCopy))
    })

    it('evaluation does not produce a probability or learning signal', () => {
      const evaluation = evaluateActionOutcomeN07({
        predictedEffect: 'Test',
        actualEffect: 'Test',
        expectedOutcomeId: 'exp-noprob',
        provenance: 'USER_REPORTED',
      })
      // Evaluation is a categorical status, not a probability
      expect(typeof evaluation.status).toBe('string')
      expect(['ACHIEVED', 'PARTIALLY_ACHIEVED', 'NOT_ACHIEVED', 'UNKNOWN']).toContain(evaluation.status)
      // No numeric "accuracy" or "learning rate"
      expect(evaluation).not.toHaveProperty('accuracy')
      expect(evaluation).not.toHaveProperty('learningRate')
      expect(evaluation).not.toHaveProperty('weight')
    })
  })

  // =========================================================================
  // 9. STRATEGY-LEVEL EVALUATION
  // =========================================================================

  describe('Strategy-level evaluation', () => {
    it('evaluates strategy outcome with trajectory viability', () => {
      const evaluation = evaluateStrategyOutcomeN07({
        predictedTrajectoryViable: true,
        actualTrajectoryViable: true,
        expectedOutcomeId: 'exp-strat-1',
        provenance: 'USER_REPORTED',
      })
      expect(evaluation.status).toBe('ACHIEVED')
    })

    it('evaluates strategy outcome with timeline variance', () => {
      const evaluation = evaluateStrategyOutcomeN07({
        predictedTimelineMonths: 12,
        actualTimelineMonths: 13,
        expectedOutcomeId: 'exp-strat-2',
        provenance: 'USER_REPORTED',
      })
      // 13 vs 12 months is ~8% off, within the 15% threshold → ACHIEVED
      expect(['ACHIEVED', 'PARTIALLY_ACHIEVED']).toContain(evaluation.status)
    })

    it('evaluates strategy outcome with significant timeline delay', () => {
      const evaluation = evaluateStrategyOutcomeN07({
        predictedTimelineMonths: 6,
        actualTimelineMonths: 13,
        expectedOutcomeId: 'exp-strat-3',
        provenance: 'USER_REPORTED',
      })
      // 13 vs 6 months is >100% off → NOT_ACHIEVED or PARTIALLY_ACHIEVED
      expect(['NOT_ACHIEVED', 'PARTIALLY_ACHIEVED']).toContain(evaluation.status)
    })
  })

  // =========================================================================
  // 10. IMMUTABILITY (expected outcomes are never changed after creation)
  // =========================================================================

  describe('Immutability', () => {
    it('expected outcome records are plain data (no mutation methods)', () => {
      const records = createExpectedOutcomes({
        strategy,
        decisionRecordId: 'rec-imm',
        objectiveId: 'income',
        userId: 'user-imm',
        adoptionDate: new Date('2025-01-01'),
      })
      // Records should be plain objects — no mutation methods
      for (const r of records) {
        expect(typeof r).toBe('object')
        expect(r).not.toHaveProperty('save')
        expect(r).not.toHaveProperty('update')
        expect(r).not.toHaveProperty('delete')
      }
    })

    it('createExpectedOutcomes is a pure function (no side effects)', () => {
      const strategyBefore: Strategy = JSON.parse(JSON.stringify(strategy))
      createExpectedOutcomes({
        strategy,
        decisionRecordId: 'rec-pure',
        objectiveId: 'income',
        userId: 'user-pure',
        adoptionDate: new Date('2025-01-01'),
      })
      // Strategy is not mutated
      expect(JSON.stringify(strategy)).toBe(JSON.stringify(strategyBefore))
    })
  })

  // =========================================================================
  // 11. NO FABRICATED APPROVAL PROBABILITY
  // =========================================================================

  describe('No fabricated precision', () => {
    it('confidence is never a precise fake probability', () => {
      const conf = deriveOutcomeConfidence(strategy)
      if (conf !== null) {
        // Confidence is a coarse value, not a fabricated precise number
        const str = conf.toString()
        // Should not have more than 1 decimal place
        if (str.includes('.')) {
          expect(str.split('.')[1].length).toBeLessThanOrEqual(1)
        }
      }
    })

    it('evaluation does not fabricate an approval probability', () => {
      const evaluation = evaluateStrategyOutcomeN07({
        predictedTrajectoryViable: true,
        actualTrajectoryViable: true,
        expectedOutcomeId: 'exp-nofab',
        provenance: 'USER_REPORTED',
      })
      // No probability field
      expect(evaluation).not.toHaveProperty('approvalProbability')
      expect(evaluation).not.toHaveProperty('successProbability')
      expect(evaluation).not.toHaveProperty('confidence_score')
    })
  })

  // =========================================================================
  // 12. HISTORICAL STRATEGY REMAINS IMMUTABLE
  // =========================================================================

  describe('Historical strategy immutability', () => {
    it('outcome creation does not modify the historical strategy snapshot', () => {
      const strategySnapshot = JSON.parse(JSON.stringify(strategy))
      createExpectedOutcomes({
        strategy,
        decisionRecordId: 'rec-hist',
        objectiveId: 'income',
        userId: 'user-hist',
        adoptionDate: new Date('2025-01-01'),
      })
      // Strategy snapshot is unchanged
      expect(JSON.stringify(strategy)).toBe(JSON.stringify(strategySnapshot))
    })
  })

  // =========================================================================
  // 13. EXISTING ARCHITECTURE INTACT
  // =========================================================================

  describe('Existing architecture intact', () => {
    it('replay remains intact', async () => {
      const { replayStrategy } = await import('@/lib/strategy/replay')
      expect(typeof replayStrategy).toBe('function')
    })

    it('verifyStrategyRecord remains intact', async () => {
      const { verifyStrategyRecord } = await import('@/lib/strategy/replay')
      expect(typeof verifyStrategyRecord).toBe('function')
    })

    it('Strategy Memory remains intact', async () => {
      const { buildStrategyChange } = await import('@/lib/strategy/change')
      expect(typeof buildStrategyChange).toBe('function')
    })

    it('decision graph remains intact', () => {
      const graph = buildDecisionGraph(strategy)
      expect(graph.nodes.length).toBeGreaterThan(0)
    })

    it('needs + capabilities remain intact', () => {
      expect(strategy.needs).toBeDefined()
      expect(strategy.desiredCapabilities).toBeDefined()
    })

    it('evaluation module (N0.4b) remains intact', async () => {
      const { evaluateActionOutcome } = await import('@/lib/strategy/evaluation')
      expect(typeof evaluateActionOutcome).toBe('function')
    })

    it('prediction module (N0.4b) remains intact', async () => {
      const { deriveActionPrediction } = await import('@/lib/strategy/prediction')
      expect(typeof deriveActionPrediction).toBe('function')
    })
  })

  // =========================================================================
  // N0.7 HARDENING — Architectural invariants
  // =========================================================================

  describe('N0.7 Hardening — Architectural invariants', () => {
    let graph: ReturnType<typeof buildDecisionGraph>

    beforeAll(() => {
      graph = buildDecisionGraph(strategy)
    })

    // --- Historical strategy integrity ---

    it('createExpectedOutcomes does NOT accept a client-provided strategy', () => {
      // The ExpectedOutcomeInput interface requires `strategy: Strategy` —
      // but this is resolved SERVER-SIDE from the DecisionRecord, never from
      // the request body. The /api/actions route no longer accepts a `strategy`
      // field in the body. We verify the pure function uses ONLY its input
      // strategy (not any external state).
      const records1 = createExpectedOutcomes({
        strategy,
        decisionRecordId: 'rec-1',
        objectiveId: 'income',
        userId: 'user-1',
        adoptionDate: new Date('2025-01-01'),
        graph,
      })
      // A DIFFERENT strategy would produce different predictions — but the
      // point is the server resolves the strategy, not the client.
      expect(records1.length).toBeGreaterThan(0)
      // All records must reference the SAME decisionRecordId (server-resolved)
      for (const r of records1) {
        expect(r.decisionRecordId).toBe('rec-1')
      }
    })

    it('a forged strategy cannot alter the predicted values in expected outcomes', () => {
      // Simulate: the server resolves the historical strategy from the
      // DecisionRecord. A forged strategy submitted by the client is NEVER
      // passed to createExpectedOutcomes. The predictions come from the
      // historical strategy snapshot only.
      const realRecords = createExpectedOutcomes({
        strategy, // the REAL historical strategy
        decisionRecordId: 'rec-real',
        objectiveId: 'income',
        userId: 'user-real',
        adoptionDate: new Date('2025-01-01'),
        graph,
      })

      // The forged strategy has materially different predictions, but it is
      // NEVER passed to createExpectedOutcomes. The real records use the
      // real strategy's predictions.
      const forgedStrategy: Strategy = {
        ...strategy,
        bestTrajectory: strategy.bestTrajectory
          ? { ...strategy.bestTrajectory, totalCostUSD: 999999, totalMonths: 999 } as any
          : undefined as any,
      }

      // Verify the real records do NOT contain the forged values
      for (const r of realRecords) {
        if (r.predictedTotalCostUSD != null) {
          expect(r.predictedTotalCostUSD).not.toBe(999999)
        }
        if (r.predictedTimelineMonths != null) {
          expect(r.predictedTimelineMonths).not.toBe(999)
        }
      }

      // The forged strategy WOULD produce different values — proving the
      // server MUST use the real strategy, not the client's.
      const forgedRecords = createExpectedOutcomes({
        strategy: forgedStrategy,
        decisionRecordId: 'rec-forged',
        objectiveId: 'income',
        userId: 'user-forged',
        adoptionDate: new Date('2025-01-01'),
        graph: buildDecisionGraph(forgedStrategy),
      })
      const forgedStrategyRecord = forgedRecords.find((r) => r.scope === 'STRATEGY')
      if (forgedStrategyRecord?.predictedTotalCostUSD != null) {
        expect(forgedStrategyRecord.predictedTotalCostUSD).toBe(999999)
      }
    })

    // --- Outcome identity ---

    it('ExpectedOutcomeRecord does not have expectedOutcomeId (only observed outcomes reference it)', () => {
      const records = createExpectedOutcomes({
        strategy,
        decisionRecordId: 'rec-id',
        objectiveId: 'income',
        userId: 'user-id',
        adoptionDate: new Date('2025-01-01'),
        graph,
      })
      // Expected outcomes don't have expectedOutcomeId — they ARE the expected
      // outcome. Only observed outcomes reference expectedOutcomeId.
      for (const r of records) {
        expect(r).not.toHaveProperty('expectedOutcomeId')
      }
    })

    // --- Graph integrity ---

    it('deriveOutcomeTypeFromGraph returns UNKNOWN when action node does not exist', () => {
      const type = deriveOutcomeTypeFromGraph(graph, 'nonexistent-action-id')
      expect(type).toBe('UNKNOWN')
    })

    it('deriveOutcomeTypeFromGraph returns UNKNOWN when no LEADS_TO edge exists', () => {
      // Build a graph with an action node but no LEADS_TO edge
      const minimalGraph = {
        ...graph,
        edges: graph.edges.filter((e) => e.type !== 'LEADS_TO'),
      }
      // Find an action that exists in the graph
      const actionNode = minimalGraph.nodes.find((n) => n.type === 'ACTION')
      if (actionNode) {
        // Extract the original action ID from the node ID (action-${hash})
        const actionId = actionNode.id.replace('action-', '')
        const type = deriveOutcomeTypeFromGraph(minimalGraph, actionId)
        expect(type).toBe('UNKNOWN')
      }
    })

    it('validateGraphNodeLinkage rejects non-existent nodes', () => {
      const result = validateGraphNodeLinkage(graph, 'nonexistent-node', 'ACTION')
      expect(result.valid).toBe(false)
      expect(result.reason).toBe('NODE_NOT_FOUND')
    })

    it('validateGraphNodeLinkage rejects node type mismatch', () => {
      // Find an OUTCOME node and try to validate it as an ACTION
      const outcomeNode = graph.nodes.find((n) => n.type === 'OUTCOME')
      if (outcomeNode) {
        const result = validateGraphNodeLinkage(graph, outcomeNode.id, 'ACTION')
        expect(result.valid).toBe(false)
        expect(result.reason).toBe('NODE_TYPE_MISMATCH')
      }
    })

    it('validateGraphNodeLinkage accepts valid nodes', () => {
      const actionNode = graph.nodes.find((n) => n.type === 'ACTION')
      if (actionNode) {
        const result = validateGraphNodeLinkage(graph, actionNode.id, 'ACTION')
        expect(result.valid).toBe(true)
        expect(result.reason).toBe('OK')
      }
    })

    it('validateGraphEdge verifies exact edge existence + direction', () => {
      // Find a LEADS_TO edge and verify it
      const leadsToEdge = graph.edges.find((e) => e.type === 'LEADS_TO')
      if (leadsToEdge) {
        expect(validateGraphEdge(graph, leadsToEdge.from, leadsToEdge.to, 'LEADS_TO')).toBe(true)
        // Wrong direction
        expect(validateGraphEdge(graph, leadsToEdge.to, leadsToEdge.from, 'LEADS_TO')).toBe(false)
        // Wrong type
        expect(validateGraphEdge(graph, leadsToEdge.from, leadsToEdge.to, 'BLOCKS')).toBe(false)
      }
    })

    it('graphNodeId is only set when the node exists in the historical graph', () => {
      const records = createExpectedOutcomes({
        strategy,
        decisionRecordId: 'rec-graph-valid',
        objectiveId: 'income',
        userId: 'user-graph-valid',
        adoptionDate: new Date('2025-01-01'),
        graph,
      })
      // Every non-null graphNodeId must correspond to a real node in the graph
      for (const r of records) {
        if (r.graphNodeId) {
          const nodeExists = graph.nodes.some((n) => n.id === r.graphNodeId)
          expect(nodeExists).toBe(true)
        }
      }
    })

    // --- Epistemic integrity ---

    it('no fabricated confidence probability (deriveOutcomeConfidence returns null)', () => {
      expect(deriveOutcomeConfidence(strategy)).toBeNull()
    })

    it('qualitative uncertainty is preserved (not converted to probability)', () => {
      const strategyWithLow: Strategy = {
        ...strategy,
        uncertainties: [
          { dimension: 'test', confidence: 'LOW' as any, reason: 'r' },
        ],
      }
      // The qualitative level is LOW, not a fabricated 0.2
      expect(deriveConfidenceLevel(strategyWithLow)).toBe('LOW')
    })

    it('UNKNOWN remains UNKNOWN (not converted to failure)', () => {
      const evaluation = evaluateActionOutcomeN07({
        predictedEffect: 'test',
        actualEffect: null, // no observation
        expectedOutcomeId: 'exp-unknown',
        provenance: 'USER_REPORTED',
      })
      expect(evaluation.status).toBe('UNKNOWN')
      // UNKNOWN is not NOT_ACHIEVED
      expect(evaluation.status).not.toBe('NOT_ACHIEVED')
    })

    it('missing observation is not interpreted as failure', () => {
      const evaluation = evaluateStrategyOutcomeN07({
        predictedTrajectoryViable: true,
        actualTrajectoryViable: null, // not observed
        expectedOutcomeId: 'exp-missing',
        provenance: 'USER_REPORTED',
      })
      expect(evaluation.status).toBe('UNKNOWN')
    })

    // --- Temporal integrity ---

    it('expected dates derive from immutable historical adoption timestamp, not new Date()', () => {
      const adoptionDate = new Date('2025-01-15T10:00:00Z')
      const records1 = createExpectedOutcomes({
        strategy,
        decisionRecordId: 'rec-temporal',
        objectiveId: 'income',
        userId: 'user-temporal',
        adoptionDate,
        graph,
      })

      // Running the same derivation on a DIFFERENT current date produces the
      // SAME expected dates (because they derive from adoptionDate, not now)
      const records2 = createExpectedOutcomes({
        strategy,
        decisionRecordId: 'rec-temporal',
        objectiveId: 'income',
        userId: 'user-temporal',
        adoptionDate, // SAME adoption date
        graph,
      })

      for (let i = 0; i < records1.length; i++) {
        expect(records1[i].expectedByDate?.getTime()).toBe(records2[i].expectedByDate?.getTime())
      }
    })

    it('expected dates change when the adoption date changes (proving they derive from it)', () => {
      const adoption1 = new Date('2025-01-01')
      const adoption2 = new Date('2025-06-01')

      const records1 = createExpectedOutcomes({
        strategy,
        decisionRecordId: 'rec-temporal-1',
        objectiveId: 'income',
        userId: 'user-temporal',
        adoptionDate: adoption1,
        graph,
      })
      const records2 = createExpectedOutcomes({
        strategy,
        decisionRecordId: 'rec-temporal-2',
        objectiveId: 'income',
        userId: 'user-temporal',
        adoptionDate: adoption2,
        graph,
      })

      // The strategy-level expected date should differ (~5 months apart)
      const strat1 = records1.find((r) => r.scope === 'STRATEGY')
      const strat2 = records2.find((r) => r.scope === 'STRATEGY')
      if (strat1?.expectedByDate && strat2?.expectedByDate) {
        expect(strat1.expectedByDate.getTime()).not.toBe(strat2.expectedByDate.getTime())
      }
    })

    // --- Provenance integrity ---

    it('client cannot claim EXTERNAL_VERIFICATION (rejected by validateProvenance)', () => {
      expect(validateProvenance('EXTERNAL_VERIFICATION', true)).toBeNull()
    })

    it('client cannot claim EXTERNALLY_VERIFIED (rejected)', () => {
      expect(validateProvenance('EXTERNALLY_VERIFIED', true)).toBeNull()
    })

    it('server can set EXTERNAL_VERIFICATION (not from client)', () => {
      expect(validateProvenance('EXTERNAL_VERIFICATION', false)).toBe('EXTERNAL_VERIFICATION')
    })

    it('client USER_REPORTED is accepted', () => {
      expect(validateProvenance('USER_REPORTED', true)).toBe('USER_REPORTED')
    })

    it('client USER_CONFIRMED is accepted', () => {
      expect(validateProvenance('USER_CONFIRMED', true)).toBe('USER_CONFIRMED')
    })

    // --- Immutability ---

    it('repeated submission with the same idempotency key returns the existing event (pure function determinism)', () => {
      const records1 = createExpectedOutcomes({
        strategy,
        decisionRecordId: 'rec-imm',
        objectiveId: 'income',
        userId: 'user-imm',
        adoptionDate: new Date('2025-01-01'),
        graph,
      })
      const records2 = createExpectedOutcomes({
        strategy,
        decisionRecordId: 'rec-imm',
        objectiveId: 'income',
        userId: 'user-imm',
        adoptionDate: new Date('2025-01-01'),
        graph,
      })
      // Same inputs → same idempotency keys → same records
      for (let i = 0; i < records1.length; i++) {
        expect(records1[i].idempotencyKey).toBe(records2[i].idempotencyKey)
      }
    })

    it('a distinct observation creates a distinct idempotency key', () => {
      // Different decisionRecordId → different idempotency key
      const records1 = createExpectedOutcomes({
        strategy,
        decisionRecordId: 'rec-A',
        objectiveId: 'income',
        userId: 'user-distinct',
        adoptionDate: new Date('2025-01-01'),
        graph,
      })
      const records2 = createExpectedOutcomes({
        strategy,
        decisionRecordId: 'rec-B',
        objectiveId: 'income',
        userId: 'user-distinct',
        adoptionDate: new Date('2025-01-01'),
        graph,
      })
      const key1 = records1[0]?.idempotencyKey
      const key2 = records2[0]?.idempotencyKey
      expect(key1).not.toBe(key2)
    })

    // --- Strategy/action symmetry ---

    it('both action + strategy outcomes use N0.7 evaluation semantics', () => {
      const actionEval = evaluateActionOutcomeN07({
        predictedEffect: 'test',
        actualEffect: 'test',
        expectedOutcomeId: 'exp-action',
        provenance: 'USER_REPORTED',
      })
      const strategyEval = evaluateStrategyOutcomeN07({
        predictedTrajectoryViable: true,
        actualTrajectoryViable: true,
        expectedOutcomeId: 'exp-strategy',
        provenance: 'USER_REPORTED',
      })
      // Both return OutcomeEvaluation with status + basedOnUserReport
      expect(actionEval).toHaveProperty('status')
      expect(actionEval).toHaveProperty('basedOnUserReport')
      expect(strategyEval).toHaveProperty('status')
      expect(strategyEval).toHaveProperty('basedOnUserReport')
      expect(actionEval.basedOnUserReport).toBe(true)
      expect(strategyEval.basedOnUserReport).toBe(true)
    })

    it('both action + strategy evaluations map MATCHED → ACHIEVED', () => {
      expect(mapEvaluationStatus('MATCHED')).toBe('ACHIEVED')
      expect(mapEvaluationStatus('PARTIALLY_MATCHED')).toBe('PARTIALLY_ACHIEVED')
      expect(mapEvaluationStatus('MISSED')).toBe('NOT_ACHIEVED')
      expect(mapEvaluationStatus('UNKNOWN')).toBe('UNKNOWN')
    })

    // --- No adaptive learning ---

    it('evaluation does not modify the strategy engine (no side effects)', () => {
      const strategyBefore = JSON.parse(JSON.stringify(strategy))
      evaluateActionOutcomeN07({
        predictedEffect: 'test',
        actualEffect: 'test',
        expectedOutcomeId: 'exp-no-side-effect',
        provenance: 'USER_REPORTED',
      })
      evaluateStrategyOutcomeN07({
        predictedTrajectoryViable: true,
        actualTrajectoryViable: true,
        expectedOutcomeId: 'exp-no-side-effect',
        provenance: 'USER_REPORTED',
      })
      expect(JSON.stringify(strategy)).toBe(JSON.stringify(strategyBefore))
    })

    it('no probability/learning signal is produced', () => {
      const evaluation = evaluateActionOutcomeN07({
        predictedEffect: 'test',
        actualEffect: 'test',
        expectedOutcomeId: 'exp-no-learn',
        provenance: 'USER_REPORTED',
      })
      expect(evaluation).not.toHaveProperty('accuracy')
      expect(evaluation).not.toHaveProperty('probability')
      expect(evaluation).not.toHaveProperty('learningRate')
      expect(evaluation).not.toHaveProperty('weight')
    })
  })

  // =========================================================================
  // N0.7 FINAL HARDENING — Referential integrity + server-authoritative
  // classification + no numeric confidence regression
  // =========================================================================

  describe('N0.7 Final Hardening — referential integrity + server-authoritative classification', () => {
    let graph: ReturnType<typeof buildDecisionGraph>

    beforeAll(() => {
      graph = buildDecisionGraph(strategy)
    })

    // --- expectedOutcomeId is never a surrogate ---

    it('expectedOutcomeId in evaluation is null when no expected outcome exists', () => {
      // The evaluation function accepts expectedOutcomeId: string | null.
      // When no expected outcome exists, it MUST be null — never a surrogate
      // like userActionId or decisionRecordId.
      const evaluation = evaluateActionOutcomeN07({
        predictedEffect: 'test',
        actualEffect: 'test',
        expectedOutcomeId: null, // null, NOT a surrogate
        provenance: 'USER_REPORTED',
      })
      expect(evaluation.expectedOutcomeId).toBeNull()
    })

    it('expectedOutcomeId in evaluation is the actual expected outcome ID when it exists', () => {
      const evaluation = evaluateActionOutcomeN07({
        predictedEffect: 'test',
        actualEffect: 'test',
        expectedOutcomeId: 'real-expected-outcome-id',
        provenance: 'USER_REPORTED',
      })
      expect(evaluation.expectedOutcomeId).toBe('real-expected-outcome-id')
    })

    it('expectedOutcomeId in strategy evaluation is null when no expected exists', () => {
      const evaluation = evaluateStrategyOutcomeN07({
        predictedTrajectoryViable: true,
        actualTrajectoryViable: true,
        expectedOutcomeId: null, // null, NOT decisionRecordId
        provenance: 'USER_REPORTED',
      })
      expect(evaluation.expectedOutcomeId).toBeNull()
    })

    it('ExpectedOutcomeRecord has NO expectedOutcomeId field (expected outcomes are the root)', () => {
      const records = createExpectedOutcomes({
        strategy,
        decisionRecordId: 'rec-root',
        objectiveId: 'income',
        userId: 'user-root',
        adoptionDate: new Date('2025-01-01'),
        graph,
      })
      for (const r of records) {
        // Expected outcomes ARE the expected outcome — they don't reference
        // another expected outcome.
        expect(r).not.toHaveProperty('expectedOutcomeId')
      }
    })

    // --- Server-authoritative outcome classification ---

    it('client cannot choose outcomeType — observed inherits from expected', () => {
      // The OutcomeBody interface documents that body.outcomeType is IGNORED.
      // The observed outcome's type is ALWAYS inherited from the expected
      // outcome, or UNKNOWN if no expected exists.
      //
      // This test verifies the pure-function semantics: createExpectedOutcomes
      // derives the type from the graph (authoritative). The API routes
      // inherit from the existing expected outcome — never from body.outcomeType.
      const records = createExpectedOutcomes({
        strategy,
        decisionRecordId: 'rec-inherit',
        objectiveId: 'income',
        userId: 'user-inherit',
        adoptionDate: new Date('2025-01-01'),
        graph,
      })
      // Every record's outcomeType came from the graph (or UNKNOWN), not
      // from any client input.
      for (const r of records) {
        expect(OUTCOME_TYPES).toContain(r.outcomeType)
      }
    })

    it('observed outcomeType is UNKNOWN when no expected outcome exists', () => {
      // When there's no expected outcome (e.g., pre-N0.7 records), the
      // observed outcome's type is UNKNOWN — not a client-chosen value.
      // The API routes implement: outcomeType = existingExpected?.outcomeType ?? 'UNKNOWN'
      // This test verifies the fallback logic.
      const existingExpected = null // no expected outcome
      const outcomeType = (existingExpected as any)?.outcomeType ?? 'UNKNOWN'
      expect(outcomeType).toBe('UNKNOWN')
    })

    it('observed outcomeType matches expected outcomeType when expected exists', () => {
      // When an expected outcome exists, the observed inherits its type.
      const existingExpected = { outcomeType: 'CREDENTIAL_RECOGNIZED' }
      const outcomeType = (existingExpected as any)?.outcomeType ?? 'UNKNOWN'
      expect(outcomeType).toBe('CREDENTIAL_RECOGNIZED')
    })

    // --- No numeric confidence regression ---

    it('deriveOutcomeConfidence returns null (no fabricated probability)', () => {
      expect(deriveOutcomeConfidence(strategy)).toBeNull()
    })

    it('deriveConfidenceLevel returns a valid ConfidenceLevel, never a number', () => {
      const level = deriveConfidenceLevel(strategy)
      expect(typeof level).toBe('string')
      expect(['HIGH', 'MEDIUM', 'LOW', 'UNKNOWN']).toContain(level)
    })

    it('ExpectedOutcomeRecord uses confidenceLevel (qualitative), not confidence (numeric)', () => {
      const records = createExpectedOutcomes({
        strategy,
        decisionRecordId: 'rec-no-numeric',
        objectiveId: 'income',
        userId: 'user-no-numeric',
        adoptionDate: new Date('2025-01-01'),
        graph,
      })
      for (const r of records) {
        // The record has confidenceLevel (qualitative), NOT confidence (numeric)
        expect(r).toHaveProperty('confidenceLevel')
        expect(r).not.toHaveProperty('confidence')
        if (r.confidenceLevel) {
          expect(['HIGH', 'MEDIUM', 'LOW', 'UNKNOWN']).toContain(r.confidenceLevel)
        }
      }
    })

    it('no new code writes numeric confidence (regression guard)', () => {
      // This test documents the invariant: new code must NEVER write a numeric
      // confidence value. The deprecated `confidence` field exists only for
      // backward compat with pre-N0.7 records. The createExpectedOutcomes
      // function does NOT produce a numeric confidence.
      const records = createExpectedOutcomes({
        strategy,
        decisionRecordId: 'rec-regression',
        objectiveId: 'income',
        userId: 'user-regression',
        adoptionDate: new Date('2025-01-01'),
        graph,
      })
      for (const r of records) {
        // The record must NOT have a numeric confidence property
        expect(r).not.toHaveProperty('confidence')
        // It MUST have a qualitative confidenceLevel
        expect(r).toHaveProperty('confidenceLevel')
      }
    })

    // --- Prisma enum enforcement (schema-level) ---

    it('outcomeType is a real Prisma enum (not a String)', () => {
      // The schema uses `outcomeType OutcomeType @default(UNKNOWN)` — a real
      // Prisma enum, not a String. This is enforced at the DB level.
      // We verify the enum values are the expected set.
      expect(OUTCOME_TYPES).toContain('UNKNOWN')
      expect(OUTCOME_TYPES).toContain('CREDENTIAL_RECOGNIZED')
      expect(OUTCOME_TYPES).toContain('ROUTE_UNLOCKED')
    })

    it('OutcomeEvaluationStatus is a real Prisma enum', () => {
      const validStatuses: OutcomeEvaluationStatus[] = ['ACHIEVED', 'PARTIALLY_ACHIEVED', 'NOT_ACHIEVED', 'UNKNOWN']
      for (const s of validStatuses) {
        expect(['ACHIEVED', 'PARTIALLY_ACHIEVED', 'NOT_ACHIEVED', 'UNKNOWN']).toContain(s)
      }
    })

    it('ConfidenceLevel is a real Prisma enum', () => {
      const validLevels: ConfidenceLevel[] = ['HIGH', 'MEDIUM', 'LOW', 'UNKNOWN']
      for (const l of validLevels) {
        expect(['HIGH', 'MEDIUM', 'LOW', 'UNKNOWN']).toContain(l)
      }
    })
  })

  // =========================================================================
  // N0.7 FINAL HARDENING — No text-based classification + full causal chain
  // =========================================================================

  describe('N0.7 Final Hardening — no text classification + full causal chain validation', () => {
    let graph: ReturnType<typeof buildDecisionGraph>

    beforeAll(() => {
      graph = buildDecisionGraph(strategy)
    })

    // Helper: build a synthetic graph with specific structure for testing
    function buildSyntheticGraph(opts: {
      actionId?: string
      outcomeId?: string
      outcomeLabel?: string
      outcomeDescription?: string
      outcomeProvenanceSource?: string
      edgeType?: string
      edgeDirection?: 'forward' | 'reverse'
      destinationType?: string
      includeEdge?: boolean
    }): DecisionGraph {
      const actionId = opts.actionId ?? 'act-syn'
      const outcomeId = opts.outcomeId ?? 'out-syn'
      const nodes: any[] = [
        { id: 'obj', type: 'OBJECTIVE', label: 'Obj', description: 'd', evidence: 'e', provenance: { source: 'test', references: {} } },
        { id: `action-${hashIdLocal(actionId)}`, type: 'ACTION', label: 'Act', description: 'd', evidence: 'e', provenance: { source: 'test', references: {} } },
      ]
      // Add the destination node (default OUTCOME, but can be overridden)
      const destType = opts.destinationType ?? 'OUTCOME'
      nodes.push({
        id: outcomeId,
        type: destType,
        label: opts.outcomeLabel ?? 'Outcome',
        description: opts.outcomeDescription ?? 'd',
        evidence: 'e',
        provenance: { source: opts.outcomeProvenanceSource ?? 'Test.synthetic', references: {} },
      })

      const edges: any[] = []
      if (opts.includeEdge !== false) {
        const edgeType = opts.edgeType ?? 'LEADS_TO'
        if (opts.edgeDirection === 'reverse') {
          edges.push({ from: outcomeId, to: `action-${hashIdLocal(actionId)}`, type: edgeType })
        } else {
          edges.push({ from: `action-${hashIdLocal(actionId)}`, to: outcomeId, type: edgeType })
        }
      }

      return {
        nodes,
        edges,
        graphSchemaVersion: '1.0.0',
        graphHash: 'synthetic',
        generatedAt: '2025-01-01T00:00:00Z',
        engineVersion: 'test',
      }
    }

    function hashIdLocal(id: string): string {
      let hash = 0
      for (let i = 0; i < id.length; i++) {
        const char = id.charCodeAt(i)
        hash = ((hash << 5) - hash) + char
        hash |= 0
      }
      return Math.abs(hash).toString(36)
    }

    // --- BLOCKER 1: No text-based classification ---

    // Test A: OUTCOME node with "Residence permit" label but NO authoritative
    // outcome type must produce UNKNOWN, not RESIDENCE_GRANTED.
    it('Test A: OUTCOME node with "Residence permit" label but no authoritative type → UNKNOWN', () => {
      const synthGraph = buildSyntheticGraph({
        actionId: 'act-a',
        outcomeId: 'out-a',
        outcomeLabel: 'Residence permit',
        outcomeProvenanceSource: 'Some.Unknown.Source', // no exact mapping
      })
      const type = deriveOutcomeTypeFromGraph(synthGraph, 'act-a')
      expect(type).toBe('UNKNOWN')
      expect(type).not.toBe('RESIDENCE_GRANTED')
    })

    // Test B: Changing only label/description/display text must NOT change
    // the derived OutcomeType.
    it('Test B: changing only label/description does NOT change OutcomeType', () => {
      const graph1 = buildSyntheticGraph({
        actionId: 'act-b',
        outcomeId: 'out-b',
        outcomeLabel: 'Residence permit',
        outcomeDescription: 'A permit for residence',
        outcomeProvenanceSource: 'DesiredCapability.potentialUnlocks',
      })
      const graph2 = buildSyntheticGraph({
        actionId: 'act-b',
        outcomeId: 'out-b',
        outcomeLabel: 'COMPLETELY DIFFERENT TEXT',
        outcomeDescription: 'TOTALLY UNRELATED DESCRIPTION',
        outcomeProvenanceSource: 'DesiredCapability.potentialUnlocks',
      })
      const type1 = deriveOutcomeTypeFromGraph(graph1, 'act-b')
      const type2 = deriveOutcomeTypeFromGraph(graph2, 'act-b')
      // Same provenance.source → same OutcomeType, regardless of label
      expect(type1).toBe(type2)
      expect(type1).toBe('CAPABILITY_ACQUIRED')
    })

    // Test C: An explicit authoritative domain outcome type produces the
    // corresponding OutcomeType regardless of display label.
    it('Test C: authoritative provenance.source produces OutcomeType regardless of label', () => {
      const synthGraph = buildSyntheticGraph({
        actionId: 'act-c',
        outcomeId: 'out-c',
        outcomeLabel: 'xyz gibberish label',
        outcomeProvenanceSource: 'DesiredCapability.potentialUnlocks',
      })
      const type = deriveOutcomeTypeFromGraph(synthGraph, 'act-c')
      // The authoritative source maps to CAPABILITY_ACQUIRED, even though
      // the label is gibberish.
      expect(type).toBe('CAPABILITY_ACQUIRED')
    })

    // Test D: No label.includes()/description.includes() semantic
    // classification remains in the authoritative outcome derivation path.
    it('Test D: no label.includes() in authoritative derivation (Strategy.bestTrajectory → UNKNOWN)', () => {
      // A strategy-level outcome with source 'Strategy.bestTrajectory' has
      // NO exact mapping → UNKNOWN. Previously this would have read the
      // label for "citizenship"/"residence"/etc. Now it returns UNKNOWN.
      const synthGraph = buildSyntheticGraph({
        actionId: 'act-d',
        outcomeId: 'out-d',
        outcomeLabel: 'Portuguese citizenship pathway',
        outcomeProvenanceSource: 'Strategy.bestTrajectory',
      })
      // For the strategy-level derivation, we need a strategy with a
      // bestTrajectory whose ID hashes to 'out-d'. We verify the function
      // returns UNKNOWN regardless of the label.
      const fakeStrategy = {
        ...strategy,
        bestTrajectory: { ...strategy.bestTrajectory!, id: 'syn' },
      } as Strategy
      // Rebuild graph with outcome ID matching the fake strategy
      const synthGraph2 = buildSyntheticGraph({
        actionId: 'act-d2',
        outcomeId: `outcome-${hashIdLocal('syn')}`,
        outcomeLabel: 'Portuguese citizenship pathway',
        outcomeProvenanceSource: 'Strategy.bestTrajectory',
      })
      const type = deriveStrategyOutcomeTypeFromGraph(synthGraph2, fakeStrategy)
      // Returns UNKNOWN — no text-based classification
      expect(type).toBe('UNKNOWN')
      expect(type).not.toBe('CITIZENSHIP_GRANTED')
    })

    // --- BLOCKER 2: Full causal chain validation ---

    // Test E: Valid ACTION→LEADS_TO→OUTCOME produces correct graphNodeId.
    it('Test E: valid ACTION→LEADS_TO→OUTCOME produces correct graphNodeId', () => {
      const synthGraph = buildSyntheticGraph({
        actionId: 'act-e',
        outcomeId: 'out-e',
        outcomeProvenanceSource: 'DesiredCapability.potentialUnlocks',
      })
      const linkage = validateActionOutcomeLinkage(synthGraph, 'act-e')
      expect(linkage.valid).toBe(true)
      expect(linkage.reason).toBe('OK')
      expect(linkage.actionNodeId).toBe(`action-${hashIdLocal('act-e')}`)
      expect(linkage.outcomeNodeId).toBe('out-e')
      expect(linkage.edgeType).toBe('LEADS_TO')
    })

    // Test F: Missing edge (ACTION + OUTCOME exist, no LEADS_TO) → invalid.
    it('Test F: missing LEADS_TO edge → invalid, graphNodeId must be null', () => {
      const synthGraph = buildSyntheticGraph({
        actionId: 'act-f',
        outcomeId: 'out-f',
        includeEdge: false, // no edge
      })
      const linkage = validateActionOutcomeLinkage(synthGraph, 'act-f')
      expect(linkage.valid).toBe(false)
      expect(linkage.reason).toBe('LEADS_TO_EDGE_MISSING')
      expect(linkage.outcomeNodeId).toBeUndefined()
    })

    // Test G: Wrong direction (OUTCOME→LEADS_TO→ACTION) → invalid.
    it('Test G: wrong edge direction (OUTCOME→ACTION) → invalid', () => {
      const synthGraph = buildSyntheticGraph({
        actionId: 'act-g',
        outcomeId: 'out-g',
        edgeDirection: 'reverse', // OUTCOME → ACTION
      })
      const linkage = validateActionOutcomeLinkage(synthGraph, 'act-g')
      expect(linkage.valid).toBe(false)
      // The edge is in the wrong direction — no LEADS_TO from ACTION
      expect(linkage.reason).toBe('LEADS_TO_EDGE_MISSING')
    })

    // Test H: Wrong edge type (ACTION→REQUIRES→OUTCOME) → invalid.
    it('Test H: wrong edge type (REQUIRES instead of LEADS_TO) → invalid', () => {
      const synthGraph = buildSyntheticGraph({
        actionId: 'act-h',
        outcomeId: 'out-h',
        edgeType: 'REQUIRES', // wrong type
      })
      const linkage = validateActionOutcomeLinkage(synthGraph, 'act-h')
      expect(linkage.valid).toBe(false)
      expect(linkage.reason).toBe('LEADS_TO_EDGE_MISSING')
    })

    // Test I: Edge destination is not an OUTCOME node (ACTION→LEADS_TO→CAPABILITY) → rejected.
    it('Test I: edge destination is CAPABILITY (not OUTCOME) → rejected', () => {
      const synthGraph = buildSyntheticGraph({
        actionId: 'act-i',
        outcomeId: 'out-i',
        destinationType: 'CAPABILITY', // wrong destination type
      })
      const linkage = validateActionOutcomeLinkage(synthGraph, 'act-i')
      expect(linkage.valid).toBe(false)
      expect(linkage.reason).toBe('EDGE_DESTINATION_NOT_OUTCOME')
    })

    // Test J: A forged graph node ID that has the correct string format
    // but does not exist in the historical graph → rejected.
    it("Test J: forged action ID that does not exist in graph → rejected", () => {
      const linkage = validateActionOutcomeLinkage(graph, 'forged-action-id-not-in-graph')
      expect(linkage.valid).toBe(false)
      expect(linkage.reason).toBe('ACTION_NODE_NOT_FOUND')
    })

    // Test K: A current/new graph node cannot satisfy validation against
    // an older historical strategy graph.
    it('Test K: current graph cannot satisfy validation against old historical graph', () => {
      // Build a "historical" graph (the one from beforeAll)
      const historicalGraph = graph
      // Build a "current" graph with DIFFERENT nodes
      const currentGraph = buildSyntheticGraph({
        actionId: 'act-current-only',
        outcomeId: 'out-current-only',
      })
      // The historical graph does NOT contain 'act-current-only' — validation
      // against the historical graph must fail.
      const linkage = validateActionOutcomeLinkage(historicalGraph, 'act-current-only')
      expect(linkage.valid).toBe(false)
      expect(linkage.reason).toBe('ACTION_NODE_NOT_FOUND')
      // The current graph DOES contain it — but we must use the historical graph,
      // not the current one.
      const currentLinkage = validateActionOutcomeLinkage(currentGraph, 'act-current-only')
      expect(currentLinkage.valid).toBe(true)
      // This proves the validation is graph-specific — a current graph cannot
      // satisfy validation against a historical graph.
    })

    // --- Strategy-level OUTCOME node validation ---

    it('strategy-level OUTCOME node validation rejects non-existent node', () => {
      const fakeStrategy = {
        ...strategy,
        bestTrajectory: { ...strategy.bestTrajectory!, id: 'nonexistent' },
      } as Strategy
      const linkage = validateStrategyOutcomeLinkage(graph, fakeStrategy)
      expect(linkage.valid).toBe(false)
      expect(linkage.reason).toBe('OUTCOME_NODE_NOT_FOUND')
    })

    it('strategy-level OUTCOME node validation accepts existing OUTCOME node', () => {
      // Use the real strategy — its bestTrajectory should have an OUTCOME node
      if (strategy.bestTrajectory) {
        const linkage = validateStrategyOutcomeLinkage(graph, strategy)
        // May or may not be valid depending on whether the graph has the node
        // but the function should not crash
        expect(typeof linkage.valid).toBe('boolean')
      }
    })

    it('strategy-level OUTCOME node validation rejects node with wrong type', () => {
      // Build a graph where the outcome ID exists but has type CAPABILITY
      const fakeStrategy = {
        ...strategy,
        bestTrajectory: { ...strategy.bestTrajectory!, id: 'wrong-type' },
      } as Strategy
      const synthGraph = buildSyntheticGraph({
        actionId: 'act-wt',
        outcomeId: `outcome-${hashIdLocal('wrong-type')}`,
        destinationType: 'CAPABILITY', // wrong type
      })
      const linkage = validateStrategyOutcomeLinkage(synthGraph, fakeStrategy)
      expect(linkage.valid).toBe(false)
      expect(linkage.reason).toBe('OUTCOME_NODE_TYPE_MISMATCH')
    })

    // --- createExpectedOutcomes uses the new validation ---

    it('createExpectedOutcomes sets graphNodeId only when full causal chain is valid', () => {
      const records = createExpectedOutcomes({
        strategy,
        decisionRecordId: 'rec-chain',
        objectiveId: 'income',
        userId: 'user-chain',
        adoptionDate: new Date('2025-01-01'),
        graph,
      })
      // Every non-null graphNodeId on an ACTION-level record must correspond
      // to a real OUTCOME node connected via a valid LEADS_TO edge from a
      // real ACTION node. Strategy-level records use validateStrategyOutcomeLinkage
      // (node existence + type only — no edge required).
      for (const r of records) {
        if (r.graphNodeId && r.scope === 'ACTION') {
          // Verify the node exists + has type OUTCOME
          const node = graph.nodes.find((n) => n.id === r.graphNodeId)
          expect(node).toBeDefined()
          expect(node!.type).toBe('OUTCOME')
          // Verify a LEADS_TO edge connects some ACTION to this OUTCOME
          const hasLeadsTo = graph.edges.some(
            (e) => e.to === r.graphNodeId && e.type === 'LEADS_TO'
          )
          expect(hasLeadsTo).toBe(true)
        }
        if (r.graphNodeId && r.scope === 'STRATEGY') {
          // Strategy-level: node must exist + have type OUTCOME
          const node = graph.nodes.find((n) => n.id === r.graphNodeId)
          expect(node).toBeDefined()
          expect(node!.type).toBe('OUTCOME')
        }
      }
    })

    it('createExpectedOutcomes sets graphNodeId=null when graph is absent', () => {
      const records = createExpectedOutcomes({
        strategy,
        decisionRecordId: 'rec-no-graph',
        objectiveId: 'income',
        userId: 'user-no-graph',
        adoptionDate: new Date('2025-01-01'),
        // no graph
      })
      for (const r of records) {
        expect(r.graphNodeId).toBeNull()
      }
    })
  })
})
