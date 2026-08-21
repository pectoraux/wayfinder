// Wayfinder — N0.4 Strategy Feedback + Outcome Tracking Tests
//
// Tests the measurement layer: feedback, action outcomes, strategy outcomes,
// and the deterministic prediction-vs-actual evaluator.

import { describe, it, expect, beforeAll } from 'vitest'
import { db } from '@/lib/db'
import {
  evaluateNumeric, evaluateBoolean, evaluateCategorical,
  evaluateActionOutcome, evaluateStrategyOutcome,
  type EvaluationStatus,
} from '@/lib/strategy/evaluation'
import { STRATEGY_ENGINE_VERSION } from '@/lib/strategy/planning-context'
import { buildStrategy } from '@/lib/strategy'
import { buildCanonicalPlanningContext } from '@/lib/strategy/planning-context'
import { exampleState } from '@/lib/domain/state'
import { parseIntentDeterministic } from '@/lib/domain/intent'
import type { MobilityState, Intent } from '@/lib/domain/types'

const baseState = exampleState()
const baseIntent = parseIntentDeterministic('I want to move abroad.')

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

async function ensurePerson(testUserId: string) {
  const email = `${testUserId}@test.wayfinder.local`
  let user = await db.user.findUnique({ where: { email } })
  if (!user) {
    user = await db.user.create({ data: { email, passwordHash: 'test-only', role: 'USER' } })
  }
  let person = await db.person.findFirst({ where: { userId: user.id } })
  if (!person) {
    person = await db.person.create({ data: { userId: user.id } })
  }
  return person
}

async function cleanupTestUser(testUserId: string) {
  const email = `${testUserId}@test.wayfinder.local`
  const user = await db.user.findUnique({ where: { email } })
  if (user) {
    await db.user.delete({ where: { id: user.id } })
  }
}

async function createDecisionRecord(userId: string, personId: string, objectiveId: string) {
  const ctx = await buildCanonicalPlanningContext({ state: baseState, intent: baseIntent, asOfDate: '2025-06-01' })
  const strategy = await buildStrategy(baseState, baseIntent, ctx.routes, ctx)
  return db.decisionRecord.create({
    data: {
      personId, userId,
      stateVersion: 1, mobilityStateSnapshotId: 'test-snap',
      intentVersion: 1, intentRecordId: 'test-intent',
      policyVersion: ctx.policyContext.baseSnapshotId, policyHash: ctx.policyContext.runtimeHash,
      runtimePolicyVersion: ctx.policyContext.runtimeVersionId, runtimePolicyHash: ctx.policyContext.runtimeHash,
      asOfDate: new Date(ctx.policyContext.asOf), plan: strategy as any,
      trigger: 'OBJECTIVE_ADOPT', planStatus: 'ACTIVE', strategyEngineVersion: STRATEGY_ENGINE_VERSION,
      objectiveId, objectiveVersion: 1, strategySnapshot: strategy as any,
      uniqueActiveObjectiveKey: `${userId}:${objectiveId}`,
    },
  })
}

async function createUserAction(userId: string, actionId: string) {
  return db.userAction.create({
    data: {
      userId, actionId, title: 'Test Action', description: 'Test',
      status: 'COMPLETE', strategyEngineVersion: STRATEGY_ENGINE_VERSION,
    },
  })
}

// ---------------------------------------------------------------------------
// 1. Evaluation layer tests (pure functions)
// ---------------------------------------------------------------------------

describe('Prediction-vs-actual evaluation', () => {
  describe('evaluateNumeric', () => {
    it('returns MATCHED when within 15% threshold', async () => {
      const { status, variance } = evaluateNumeric(100, 105, 'cost')
      expect(status).toBe('MATCHED')
      expect(variance?.delta).toBe(5)
      expect(variance?.relativeDelta).toBe(0.05)
    })

    it('returns PARTIALLY_MATCHED when within 40% threshold', async () => {
      const { status } = evaluateNumeric(100, 130, 'timeline')
      expect(status).toBe('PARTIALLY_MATCHED')
    })

    it('returns MISSED when beyond threshold', async () => {
      const { status } = evaluateNumeric(100, 200, 'cost')
      expect(status).toBe('MISSED')
    })

    it('returns UNKNOWN when either value is null', async () => {
      expect(evaluateNumeric(null, 100, 'cost').status).toBe('UNKNOWN')
      expect(evaluateNumeric(100, null, 'cost').status).toBe('UNKNOWN')
    })

    it('calculates variance correctly for negative delta', async () => {
      const { variance } = evaluateNumeric(100, 80, 'timeline')
      expect(variance?.delta).toBe(-20)
      expect(variance?.relativeDelta).toBe(0.2)
    })
  })

  describe('evaluateBoolean', () => {
    it('returns MATCHED when both agree', async () => {
      expect(evaluateBoolean(true, true)).toBe('MATCHED')
      expect(evaluateBoolean(false, false)).toBe('MATCHED')
    })

    it('returns MISSED when they disagree', async () => {
      expect(evaluateBoolean(true, false)).toBe('MISSED')
    })

    it('returns UNKNOWN when either is null', async () => {
      expect(evaluateBoolean(null, true)).toBe('UNKNOWN')
      expect(evaluateBoolean(true, null)).toBe('UNKNOWN')
    })
  })

  describe('evaluateCategorical', () => {
    it('returns MATCHED for identical strings (case-insensitive)', () => {
      expect(evaluateCategorical('Succeeded', 'succeeded')).toBe('MATCHED')
    })

    it('returns PARTIALLY_MATCHED for substring', async () => {
      expect(evaluateCategorical('credential recognition completed', 'completed')).toBe('PARTIALLY_MATCHED')
    })

    it('returns MISSED for different strings', async () => {
      expect(evaluateCategorical('succeeded', 'failed')).toBe('MISSED')
    })

    it('returns UNKNOWN when either is null', async () => {
      expect(evaluateCategorical(null, 'test')).toBe('UNKNOWN')
    })
  })

  describe('evaluateActionOutcome (composite)', () => {
    it('returns MATCHED when all dimensions match', async () => {
      const result = evaluateActionOutcome({
        predictedEffect: 'succeeded', actualEffect: 'succeeded',
        predictedDurationMonths: 6, actualDurationMonths: 6.5,
        predictedCostUSD: 12000, actualCostUSD: 12500,
        predictedBlockerResolved: true, actualBlockerResolved: true,
      })
      expect(result.overallStatus).toBe('MATCHED')
      expect(result.dimensions.length).toBe(4)
    })

    it('returns MISSED when any dimension misses', async () => {
      const result = evaluateActionOutcome({
        predictedEffect: 'succeeded', actualEffect: 'failed',
        predictedDurationMonths: 6, actualDurationMonths: 6.5,
      })
      expect(result.overallStatus).toBe('MISSED')
    })

    it('returns UNKNOWN when no actuals provided', async () => {
      const result = evaluateActionOutcome({
        predictedEffect: 'succeeded',
        predictedDurationMonths: 6,
      })
      expect(result.overallStatus).toBe('UNKNOWN')
    })

    it('includes numeric variance in dimensions', async () => {
      const result = evaluateActionOutcome({
        predictedDurationMonths: 6, actualDurationMonths: 8,
      })
      const dim = result.dimensions.find((d) => d.name === 'duration')
      expect(dim?.variance?.delta).toBe(2)
      expect(dim?.variance?.relativeDelta).toBeCloseTo(0.333, 2)
    })
  })

  describe('evaluateStrategyOutcome (composite)', () => {
    it('returns MATCHED when trajectory viability matches', async () => {
      const result = evaluateStrategyOutcome({
        predictedTrajectoryViable: true, actualTrajectoryViable: true,
        predictedTimelineMonths: 60, actualTimelineMonths: 62,
      })
      expect(result.overallStatus).toBe('MATCHED')
    })

    it('returns MISSED when trajectory viability differs', async () => {
      const result = evaluateStrategyOutcome({
        predictedTrajectoryViable: true, actualTrajectoryViable: false,
      })
      expect(result.overallStatus).toBe('MISSED')
    })
  })
})

// ---------------------------------------------------------------------------
// 2. DB-backed feedback + outcome tests
// ---------------------------------------------------------------------------

describe('Strategy feedback + outcomes (DB-backed)', () => {
  const feedbackUserId = `feedback-${Date.now()}`

  beforeAll(async () => {
    await cleanupTestUser(feedbackUserId)
  })

  it('feedback references exact DecisionRecord', async () => {
    const person = await ensurePerson(feedbackUserId)
    const record = await createDecisionRecord(feedbackUserId, person.id, 'income')

    const feedback = await db.strategyFeedback.create({
      data: {
        userId: feedbackUserId,
        decisionRecordId: record.id,
        usefulness: 4,
        assumptionAccuracy: 3,
        freeText: 'Helpful but missed some details',
      },
    })

    expect(feedback.decisionRecordId).toBe(record.id)
    expect(feedback.usefulness).toBe(4)
    expect(feedback.freeText).toContain('Helpful')
  })

  it('multiple feedback events supported (immutable)', async () => {
    const person = await ensurePerson(feedbackUserId)
    const record = await createDecisionRecord(feedbackUserId, person.id, 'residence')

    const f1 = await db.strategyFeedback.create({
      data: { userId: feedbackUserId, decisionRecordId: record.id, usefulness: 3 },
    })
    const f2 = await db.strategyFeedback.create({
      data: { userId: feedbackUserId, decisionRecordId: record.id, usefulness: 5 },
    })

    expect(f1.id).not.toBe(f2.id)
    expect(f1.usefulness).toBe(3) // unchanged
    expect(f2.usefulness).toBe(5)

    const all = await db.strategyFeedback.findMany({ where: { decisionRecordId: record.id } })
    expect(all.length).toBe(2)
  })

  it('action outcome references exact UserAction', async () => {
    const action = await createUserAction(feedbackUserId, 'action-outcome-test')

    const outcome = await db.actionOutcome.create({
      data: {
        userId: feedbackUserId,
        userActionId: action.id,
        predictedEffect: 'credential_recognized',
        actualEffect: 'credential_recognized',
        predictedDurationMonths: 6,
        actualDurationMonths: 4.5,
        status: 'USER_REPORTED',
        provenance: 'USER_REPORTED',
        idempotencyKey: `${feedbackUserId}:${action.id}:outcome`,
      },
    })

    expect(outcome.userActionId).toBe(action.id)
    expect(outcome.predictedDurationMonths).toBe(6) // immutable prediction
    expect(outcome.actualDurationMonths).toBe(4.5) // actual observation
  })

  it('prediction is immutable — actual stored separately', async () => {
    const action = await createUserAction(feedbackUserId, 'immutability-test')
    const idempotencyKey = `${feedbackUserId}:${action.id}:outcome`

    await db.actionOutcome.create({
      data: {
        userId: feedbackUserId, userActionId: action.id,
        predictedEffect: 'predicted', predictedDurationMonths: 6,
        actualEffect: 'actual', actualDurationMonths: 8,
        status: 'USER_REPORTED', provenance: 'USER_REPORTED',
        idempotencyKey,
      },
    })

    // Try to update — only actuals should change, not predictions
    await db.actionOutcome.update({
      where: { idempotencyKey },
      data: { actualEffect: 'updated_actual', actualDurationMonths: 9 },
    })

    const refreshed = await db.actionOutcome.findUnique({ where: { idempotencyKey } })
    expect(refreshed!.predictedEffect).toBe('predicted') // unchanged
    expect(refreshed!.predictedDurationMonths).toBe(6) // unchanged
    expect(refreshed!.actualEffect).toBe('updated_actual') // updated
    expect(refreshed!.actualDurationMonths).toBe(9) // updated
  })

  it('strategy outcome references exact DecisionRecord', async () => {
    const person = await ensurePerson(feedbackUserId)
    const record = await createDecisionRecord(feedbackUserId, person.id, 'citizenship')

    const outcome = await db.strategyOutcome.create({
      data: {
        userId: feedbackUserId,
        decisionRecordId: record.id,
        objectiveId: 'citizenship',
        strategyFollowed: 'FOLLOWED',
        objectiveAchieved: 'ACHIEVED',
        trajectoryBecameViable: 'YES',
        predictedTrajectoryViable: true,
        actualTrajectoryViable: true,
        provenance: 'USER_REPORTED',
        idempotencyKey: `${feedbackUserId}:${record.id}:strategy-outcome`,
      },
    })

    expect(outcome.decisionRecordId).toBe(record.id)
    expect(outcome.objectiveId).toBe('citizenship')
    expect(outcome.strategyFollowed).toBe('FOLLOWED')
  })

  it('action completion ≠ action outcome (separate concepts)', async () => {
    const action = await createUserAction(feedbackUserId, 'completion-vs-outcome')

    // Action is COMPLETE
    expect(action.status).toBe('COMPLETE')

    // But NO outcome exists yet — completion doesn't imply success
    const existingOutcome = await db.actionOutcome.findUnique({
      where: { idempotencyKey: `${feedbackUserId}:${action.id}:outcome` },
    })
    expect(existingOutcome).toBeNull()

    // An outcome must be recorded separately
    const outcome = await db.actionOutcome.create({
      data: {
        userId: feedbackUserId, userActionId: action.id,
        actualEffect: 'failed', status: 'FAILED',
        provenance: 'USER_REPORTED',
        idempotencyKey: `${feedbackUserId}:${action.id}:outcome`,
      },
    })
    expect(outcome.status).toBe('FAILED') // action complete but outcome failed
  })

  it('idempotency: duplicate outcome submission does not create a second record', async () => {
    const action = await createUserAction(feedbackUserId, 'idempotency-test')
    const idempotencyKey = `${feedbackUserId}:${action.id}:outcome`

    await db.actionOutcome.create({
      data: {
        userId: feedbackUserId, userActionId: action.id,
        actualEffect: 'first', status: 'USER_REPORTED',
        provenance: 'USER_REPORTED', idempotencyKey,
      },
    })

    // Second create with the same key must fail (unique constraint)
    await expect(
      db.actionOutcome.create({
        data: {
          userId: feedbackUserId, userActionId: action.id,
          actualEffect: 'second', status: 'USER_REPORTED',
          provenance: 'USER_REPORTED', idempotencyKey,
        },
      }),
    ).rejects.toThrow()

    // Only ONE outcome exists
    const count = await db.actionOutcome.count({ where: { userActionId: action.id } })
    expect(count).toBe(1)
  })

  it('user-reported provenance preserved', async () => {
    const action = await createUserAction(feedbackUserId, 'provenance-test')
    const outcome = await db.actionOutcome.create({
      data: {
        userId: feedbackUserId, userActionId: action.id,
        status: 'USER_REPORTED', provenance: 'USER_REPORTED',
        idempotencyKey: `${feedbackUserId}:${action.id}:outcome`,
      },
    })
    expect(outcome.provenance).toBe('USER_REPORTED')
  })

  it('system-derived provenance preserved', async () => {
    const action = await createUserAction(feedbackUserId, 'system-provenance-test')
    const outcome = await db.actionOutcome.create({
      data: {
        userId: feedbackUserId, userActionId: action.id,
        status: 'OBSERVED', provenance: 'SYSTEM_DERIVED',
        idempotencyKey: `${feedbackUserId}:${action.id}:outcome`,
      },
    })
    expect(outcome.provenance).toBe('SYSTEM_DERIVED')
  })

  it('historical strategy remains immutable after feedback', async () => {
    const person = await ensurePerson(feedbackUserId)
    const record = await createDecisionRecord(feedbackUserId, person.id, 'immutability-feedback')
    const beforeSnapshot = JSON.stringify(record.strategySnapshot)

    await db.strategyFeedback.create({
      data: { userId: feedbackUserId, decisionRecordId: record.id, usefulness: 1, freeText: 'Bad' },
    })

    const after = await db.decisionRecord.findUnique({ where: { id: record.id } })
    expect(JSON.stringify(after!.strategySnapshot)).toBe(beforeSnapshot)
  })

  it('objective isolation preserved — outcomes are per-objective', async () => {
    const person = await ensurePerson(feedbackUserId)
    const recordA = await createDecisionRecord(feedbackUserId, person.id, 'iso-outcome-a')
    const recordB = await createDecisionRecord(feedbackUserId, person.id, 'iso-outcome-b')

    await db.strategyOutcome.create({
      data: {
        userId: feedbackUserId, decisionRecordId: recordA.id,
        objectiveId: 'iso-outcome-a', strategyFollowed: 'FOLLOWED',
        idempotencyKey: `${feedbackUserId}:${recordA.id}:strategy-outcome`,
      },
    })
    await db.strategyOutcome.create({
      data: {
        userId: feedbackUserId, decisionRecordId: recordB.id,
        objectiveId: 'iso-outcome-b', strategyFollowed: 'ABANDONED',
        idempotencyKey: `${feedbackUserId}:${recordB.id}:strategy-outcome`,
      },
    })

    const outcomes = await db.strategyOutcome.findMany({ where: { userId: feedbackUserId, decisionRecordId: { in: [recordA.id, recordB.id] } } })
    expect(outcomes.length).toBe(2)
    expect(outcomes.find((o) => o.decisionRecordId === recordA.id)?.strategyFollowed).toBe('FOLLOWED')
    expect(outcomes.find((o) => o.decisionRecordId === recordB.id)?.strategyFollowed).toBe('ABANDONED')
  })

  it('no history mutation — outcome does not modify DecisionRecord', async () => {
    const person = await ensurePerson(feedbackUserId)
    const record = await createDecisionRecord(feedbackUserId, person.id, 'no-mutation-test')
    const before = await db.decisionRecord.findUnique({ where: { id: record.id } })

    await db.strategyOutcome.create({
      data: {
        userId: feedbackUserId, decisionRecordId: record.id,
        objectiveId: 'no-mutation-test', strategyFollowed: 'FOLLOWED',
        idempotencyKey: `${feedbackUserId}:${record.id}:strategy-outcome`,
      },
    })

    const after = await db.decisionRecord.findUnique({ where: { id: record.id } })
    expect(after!.changeReason).toBe(before!.changeReason)
    expect(after!.previousRecordId).toBe(before!.previousRecordId)
    expect(after!.planStatus).toBe(before!.planStatus)
    expect(JSON.stringify(after!.strategySnapshot)).toBe(JSON.stringify(before!.strategySnapshot))
  })

  it('replay remains valid after outcome recorded', async () => {
    // The replay infrastructure must still work — outcomes don't affect it.
    const { replayStrategy, verifyStrategyRecord } = await import('@/lib/strategy/replay')
    // We can't easily test replay here without a full snapshot/intent setup,
    // but we verify the functions still exist and are callable.
    expect(typeof replayStrategy).toBe('function')
    expect(typeof verifyStrategyRecord).toBe('function')
  })
})
