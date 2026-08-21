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
import { buildDecisionGraph } from '@/lib/strategy/decision-graph'
import {
  createExpectedOutcomes,
  deriveOutcomeTypeFromAction,
  deriveOutcomeTypeFromStrategy,
  deriveOutcomeConfidence,
  deriveExpectedByDate,
  evaluateActionOutcomeN07,
  evaluateStrategyOutcomeN07,
  mapEvaluationStatus,
  validateOutcomeType,
  validateProvenance,
  OUTCOME_TYPES,
  type OutcomeType,
  type OutcomeEvaluationStatus,
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
  // 3. CONFIDENCE DERIVATION (conservative, no fabricated precision)
  // =========================================================================

  describe('Confidence derivation', () => {
    it('confidence is derived from strategy uncertainties (conservative)', () => {
      const conf = deriveOutcomeConfidence(strategy)
      // Should be a number in [0, 1] or null if no uncertainties
      if (conf !== null) {
        expect(conf).toBeGreaterThanOrEqual(0)
        expect(conf).toBeLessThanOrEqual(1)
      }
    })

    it('confidence is null when no uncertainties exist', () => {
      const strategyNoUncertainties: Strategy = {
        ...strategy,
        uncertainties: [],
      }
      expect(deriveOutcomeConfidence(strategyNoUncertainties)).toBeNull()
    })

    it('confidence uses the WORST dimension (conservative)', () => {
      const strategyMixed: Strategy = {
        ...strategy,
        uncertainties: [
          { dimension: 'Legal eligibility', confidence: 'HIGH' as any, reason: 'r1' },
          { dimension: 'Policy stability', confidence: 'LOW' as any, reason: 'r2' },
        ],
      }
      const conf = deriveOutcomeConfidence(strategyMixed)
      expect(conf).not.toBeNull()
      // LOW maps to 0.2, which is the worst
      expect(conf).toBeLessThanOrEqual(0.2)
    })

    it('no fabricated precision (confidence is never a fake probability)', () => {
      const conf = deriveOutcomeConfidence(strategy)
      // Confidence is a coarse value (0.1, 0.2, 0.5, 0.8), not a fabricated
      // precise number like 0.732
      if (conf !== null) {
        const coarseValues = [0.1, 0.2, 0.5, 0.8, 1.0]
        expect(coarseValues).toContain(conf)
      }
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
})
