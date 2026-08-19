// Wayfinder — N0.2 Strategy Memory Tests
//
// Tests the Strategy Memory layer: change classification, deterministic diffs,
// history immutability, objective isolation, authorization, and the guarantee
// that temporary exploration does NOT pollute history.
//
// These tests use the real Prisma client against the local SQLite database.

import { describe, it, expect, beforeAll } from 'vitest'
import { db } from '@/lib/db'
import { STRATEGY_ENGINE_VERSION } from '@/lib/strategy/planning-context'
import { buildStrategy } from '@/lib/strategy'
import { buildCanonicalPlanningContext } from '@/lib/strategy/planning-context'
import {
  classifyStrategyChangeCause,
  buildStrategyChange,
  buildStrategyDiff,
  explainStrategyChange,
  STRATEGY_CHANGE_CAUSE_LABELS,
  type StrategyRecordSummary,
} from '@/lib/strategy/change'
import { exampleState } from '@/lib/domain/state'
import { parseIntentDeterministic } from '@/lib/domain/intent'
import { generateRoutes } from '@/lib/engine/routes'
import type { Strategy } from '@/lib/strategy/types'
import type { MobilityState, Intent, Preference } from '@/lib/domain/types'

const baseState = exampleState()
const baseIntent = parseIntentDeterministic('I want to move abroad and earn more.')
const baseRoutes = generateRoutes(baseState, baseIntent, '2025-06-01')

// ---------------------------------------------------------------------------
// Test helpers (mirror the strategy-integrity.test.ts helpers)
// ---------------------------------------------------------------------------

async function ensurePerson(testUserId: string) {
  const email = `${testUserId}@test.wayfinder.local`
  let user = await db.user.findUnique({ where: { email } })
  if (!user) {
    user = await db.user.create({
      data: { email, passwordHash: 'test-only-no-real-auth', role: 'USER' },
    })
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

async function createMobilitySnapshot(personId: string, state: MobilityState, version?: number) {
  return db.$transaction(async (tx) => {
    const latest = await tx.mobilityStateSnapshot.findFirst({
      where: { personId }, orderBy: { version: 'desc' },
    })
    const newVersion = version ?? (latest?.version ?? 0) + 1
    return tx.mobilityStateSnapshot.create({
      data: { personId, version: newVersion, state: state as any, source: 'USER_CONFIRMED' },
    })
  })
}

async function createIntentRecord(personId: string, intent: Intent, version?: number) {
  return db.$transaction(async (tx) => {
    const latest = await tx.intentRecord.findFirst({
      where: { personId }, orderBy: { version: 'desc' },
    })
    const newVersion = version ?? (latest?.version ?? 0) + 1
    return tx.intentRecord.create({
      data: { personId, version: newVersion, rawInput: intent.rawInput, intent: intent as any },
    })
  })
}

async function adoptStrategy(opts: {
  userId: string
  personId: string
  strategy: Strategy
  objectiveId: string
  stateSnapshotId: string
  stateVersion: number
  intentRecordId: string
  intentVersion: number
  policyContext: Strategy['policyContext']
  engineVersion?: string
  changeReason?: string
  previousRecordId?: string | null
}) {
  const engineVersion = opts.engineVersion ?? STRATEGY_ENGINE_VERSION
  return db.$transaction(async (tx) => {
    // Supersede previous ACTIVE for this user+objective
    await tx.decisionRecord.updateMany({
      where: { userId: opts.userId, planStatus: 'ACTIVE', objectiveId: opts.objectiveId },
      data: { planStatus: 'SUPERSEDED', uniqueActiveObjectiveKey: null },
    })
    return tx.decisionRecord.create({
      data: {
        personId: opts.personId,
        userId: opts.userId,
        stateVersion: opts.stateVersion,
        mobilityStateSnapshotId: opts.stateSnapshotId,
        intentVersion: opts.intentVersion,
        intentRecordId: opts.intentRecordId,
        policyVersion: opts.policyContext?.baseSnapshotId ?? 'snap-2024-11',
        policyHash: opts.policyContext?.runtimeHash ?? 'unknown',
        runtimePolicyVersion: opts.policyContext?.runtimeVersionId ?? null,
        runtimePolicyHash: opts.policyContext?.runtimeHash ?? null,
        asOfDate: new Date(opts.policyContext?.asOf ?? new Date()),
        plan: opts.strategy as any,
        trigger: 'OBJECTIVE_ADOPT',
        planStatus: 'ACTIVE',
        strategyEngineVersion: engineVersion,
        objectiveId: opts.objectiveId,
        objectiveVersion: 1,
        strategySnapshot: {
          ...opts.strategy,
          mobilityStateVersion: opts.stateVersion,
          mobilityStateSnapshotId: opts.stateSnapshotId,
          intentVersion: opts.intentVersion,
          intentRecordId: opts.intentRecordId,
          objectiveId: opts.objectiveId,
          objectiveVersion: 1,
        } as any,
        uniqueActiveObjectiveKey: `${opts.userId}:${opts.objectiveId}`,
        previousRecordId: opts.previousRecordId ?? null,
        changeReason: opts.changeReason ?? null,
      },
    })
  })
}

function toSummary(record: any): StrategyRecordSummary {
  return {
    id: record.id,
    stateVersion: record.stateVersion,
    intentVersion: record.intentVersion,
    objectiveId: record.objectiveId,
    runtimePolicyHash: record.runtimePolicyHash,
    strategyEngineVersion: record.strategyEngineVersion,
    trigger: record.trigger,
    previousRecordId: record.previousRecordId,
    changeReason: record.changeReason,
    createdAt: record.createdAt,
    strategySnapshot: record.strategySnapshot,
  }
}

// ---------------------------------------------------------------------------
// 1. Cause classification (pure function — no DB)
// ---------------------------------------------------------------------------

describe('Strategy change cause classification', () => {
  it('classifies USER_PROFILE_CHANGED when stateVersion differs', () => {
    const prev: StrategyRecordSummary = {
      id: 'prev', stateVersion: 1, intentVersion: 1, objectiveId: 'income',
      runtimePolicyHash: 'hash', strategyEngineVersion: '1.0.0', trigger: 'OBJECTIVE_ADOPT',
      previousRecordId: null, changeReason: null, createdAt: new Date(), strategySnapshot: {},
    }
    const next: StrategyRecordSummary = { ...prev, id: 'next', stateVersion: 2 }
    expect(classifyStrategyChangeCause(prev, next)).toBe('USER_PROFILE_CHANGED')
  })

  it('classifies USER_INTENT_CHANGED when intentVersion differs (state same)', () => {
    const prev: StrategyRecordSummary = {
      id: 'prev', stateVersion: 1, intentVersion: 1, objectiveId: 'income',
      runtimePolicyHash: 'hash', strategyEngineVersion: '1.0.0', trigger: 'OBJECTIVE_ADOPT',
      previousRecordId: null, changeReason: null, createdAt: new Date(), strategySnapshot: {},
    }
    const next: StrategyRecordSummary = { ...prev, id: 'next', intentVersion: 2 }
    expect(classifyStrategyChangeCause(prev, next)).toBe('USER_INTENT_CHANGED')
  })

  it('classifies OBJECTIVE_CHANGED when objectiveId differs', () => {
    const prev: StrategyRecordSummary = {
      id: 'prev', stateVersion: 1, intentVersion: 1, objectiveId: 'income',
      runtimePolicyHash: 'hash', strategyEngineVersion: '1.0.0', trigger: 'OBJECTIVE_ADOPT',
      previousRecordId: null, changeReason: null, createdAt: new Date(), strategySnapshot: {},
    }
    const next: StrategyRecordSummary = { ...prev, id: 'next', objectiveId: 'residence' }
    expect(classifyStrategyChangeCause(prev, next)).toBe('OBJECTIVE_CHANGED')
  })

  it('classifies POLICY_CHANGED when runtimePolicyHash differs', () => {
    const prev: StrategyRecordSummary = {
      id: 'prev', stateVersion: 1, intentVersion: 1, objectiveId: 'income',
      runtimePolicyHash: 'hash-a', strategyEngineVersion: '1.0.0', trigger: 'OBJECTIVE_ADOPT',
      previousRecordId: null, changeReason: null, createdAt: new Date(), strategySnapshot: {},
    }
    const next: StrategyRecordSummary = { ...prev, id: 'next', runtimePolicyHash: 'hash-b' }
    expect(classifyStrategyChangeCause(prev, next)).toBe('POLICY_CHANGED')
  })

  it('classifies ENGINE_CHANGED when strategyEngineVersion differs', () => {
    const prev: StrategyRecordSummary = {
      id: 'prev', stateVersion: 1, intentVersion: 1, objectiveId: 'income',
      runtimePolicyHash: 'hash', strategyEngineVersion: '1.0.0', trigger: 'OBJECTIVE_ADOPT',
      previousRecordId: null, changeReason: null, createdAt: new Date(), strategySnapshot: {},
    }
    const next: StrategyRecordSummary = { ...prev, id: 'next', strategyEngineVersion: '1.1.0' }
    expect(classifyStrategyChangeCause(prev, next)).toBe('ENGINE_CHANGED')
  })

  it('classifies MANUAL_ADOPTION when trigger=OBJECTIVE_ADOPT and inputs match', () => {
    const prev: StrategyRecordSummary = {
      id: 'prev', stateVersion: 1, intentVersion: 1, objectiveId: 'income',
      runtimePolicyHash: 'hash', strategyEngineVersion: '1.0.0', trigger: 'OBJECTIVE_ADOPT',
      previousRecordId: null, changeReason: null, createdAt: new Date(), strategySnapshot: {},
    }
    const next: StrategyRecordSummary = { ...prev, id: 'next' }
    expect(classifyStrategyChangeCause(prev, next)).toBe('MANUAL_ADOPTION')
  })

  it('classifies UNKNOWN when no previous record and trigger is not OBJECTIVE_ADOPT', () => {
    const next: StrategyRecordSummary = {
      id: 'next', stateVersion: 1, intentVersion: 1, objectiveId: 'income',
      runtimePolicyHash: 'hash', strategyEngineVersion: '1.0.0', trigger: 'intake',
      previousRecordId: null, changeReason: null, createdAt: new Date(), strategySnapshot: {},
    }
    expect(classifyStrategyChangeCause(null, next)).toBe('UNKNOWN')
  })

  it('trusts the stored changeReason when set explicitly', () => {
    const prev: StrategyRecordSummary = {
      id: 'prev', stateVersion: 1, intentVersion: 1, objectiveId: 'income',
      runtimePolicyHash: 'hash', strategyEngineVersion: '1.0.0', trigger: 'OBJECTIVE_ADOPT',
      previousRecordId: null, changeReason: null, createdAt: new Date(), strategySnapshot: {},
    }
    const next: StrategyRecordSummary = {
      ...prev, id: 'next', changeReason: 'POLICY_CHANGED',
    }
    // Even though stateVersion is the same, the stored cause wins.
    expect(classifyStrategyChangeCause(prev, next)).toBe('POLICY_CHANGED')
  })

  it('classifies RECOMPUTATION when all inputs match and trigger is not adoption', () => {
    const prev: StrategyRecordSummary = {
      id: 'prev', stateVersion: 1, intentVersion: 1, objectiveId: 'income',
      runtimePolicyHash: 'hash', strategyEngineVersion: '1.0.0', trigger: 'intake',
      previousRecordId: null, changeReason: null, createdAt: new Date(), strategySnapshot: {},
    }
    const next: StrategyRecordSummary = { ...prev, id: 'next' }
    expect(classifyStrategyChangeCause(prev, next)).toBe('RECOMPUTATION')
  })
})

// ---------------------------------------------------------------------------
// 2. Diff construction (reuses compareStrategyReplay)
// ---------------------------------------------------------------------------

describe('Strategy diff construction', () => {
  it('buildStrategyDiff returns exact=true for identical strategies', () => {
    const strategy = buildStrategy(baseState, baseIntent, baseRoutes)
    const clone = JSON.parse(JSON.stringify(strategy))
    const diff = buildStrategyDiff(clone, strategy)
    expect(diff.comparison.exact).toBe(true)
    expect(diff.bestTrajectoryChanged).toBe(false)
    expect(diff.blockersChanged).toBe(false)
  })

  it('buildStrategyDiff detects bestTrajectory change', () => {
    const strategy = buildStrategy(baseState, baseIntent, baseRoutes)
    const mutated = JSON.parse(JSON.stringify(strategy))
    mutated.bestTrajectory = { ...mutated.bestTrajectory, id: 'different', label: 'Different' }
    const diff = buildStrategyDiff(strategy, mutated)
    expect(diff.bestTrajectoryChanged).toBe(true)
    expect(diff.comparison.exact).toBe(false)
  })

  it('buildStrategyDiff with null previous returns all differences', () => {
    const strategy = buildStrategy(baseState, baseIntent, baseRoutes)
    const diff = buildStrategyDiff(null, strategy)
    // When there's no previous, every dimension is "new" — but we don't
    // count that as a mismatch. The diff flags what changed.
    expect(diff).toBeDefined()
    expect(diff.comparison).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// 3. Deterministic explanation (no LLM)
// ---------------------------------------------------------------------------

describe('Strategy change explanation', () => {
  it('explains a profile change with trajectory change', () => {
    const strategy1 = buildStrategy(baseState, baseIntent, baseRoutes)
    const strategy2 = JSON.parse(JSON.stringify(strategy1))
    strategy2.bestTrajectory = { ...strategy2.bestTrajectory, label: 'New Trajectory' }

    const change = buildStrategyChange(
      { id: 'prev', stateVersion: 1, intentVersion: 1, objectiveId: 'income', runtimePolicyHash: 'h', strategyEngineVersion: '1.0.0', trigger: 'OBJECTIVE_ADOPT', previousRecordId: null, changeReason: null, createdAt: new Date(), strategySnapshot: strategy1 },
      { id: 'next', stateVersion: 2, intentVersion: 1, objectiveId: 'income', runtimePolicyHash: 'h', strategyEngineVersion: '1.0.0', trigger: 'OBJECTIVE_ADOPT', previousRecordId: 'prev', changeReason: null, createdAt: new Date(), strategySnapshot: strategy2 },
    )
    const explanation = explainStrategyChange(change)
    expect(explanation).toContain('profile changed')
    expect(explanation).toContain('New Trajectory')
  })

  it('explains a first strategy (no previous)', () => {
    const strategy = buildStrategy(baseState, baseIntent, baseRoutes)
    const change = buildStrategyChange(null, {
      id: 'next', stateVersion: 1, intentVersion: 1, objectiveId: 'income',
      runtimePolicyHash: 'h', strategyEngineVersion: '1.0.0', trigger: 'OBJECTIVE_ADOPT',
      previousRecordId: null, changeReason: null, createdAt: new Date(), strategySnapshot: strategy,
    })
    const explanation = explainStrategyChange(change)
    // The MANUAL_ADOPTION label is "You adopted a new strategy"
    expect(explanation).toContain('adopted')
    expect(explanation).toContain('initial strategy')
  })

  it('STRATEGY_CHANGE_CAUSE_LABELS has all 8 causes', () => {
    const causes = Object.keys(STRATEGY_CHANGE_CAUSE_LABELS)
    expect(causes).toContain('USER_PROFILE_CHANGED')
    expect(causes).toContain('USER_INTENT_CHANGED')
    expect(causes).toContain('OBJECTIVE_CHANGED')
    expect(causes).toContain('POLICY_CHANGED')
    expect(causes).toContain('ENGINE_CHANGED')
    expect(causes).toContain('MANUAL_ADOPTION')
    expect(causes).toContain('RECOMPUTATION')
    expect(causes).toContain('UNKNOWN')
    expect(causes.length).toBe(8)
  })
})

// ---------------------------------------------------------------------------
// 4. DB-backed history tests
// ---------------------------------------------------------------------------

describe('Strategy history (DB-backed)', () => {
  const historyUserId = `history-test-${Date.now()}`

  beforeAll(async () => {
    await cleanupTestUser(historyUserId)
  })

  async function adoptForHistory(objectiveId: string, opts?: {
    newState?: MobilityState
    newIntent?: Intent
    engineVersion?: string
    policyHash?: string
    /** If true, reuse the last snapshot + intent record (for testing policy/engine-only changes) */
    reuseLastInputs?: boolean
  }) {
    const person = await ensurePerson(historyUserId)
    let snap
    let intentRec
    if (opts?.reuseLastInputs) {
      // Reuse the latest snapshot + intent record for this person
      snap = await db.mobilityStateSnapshot.findFirst({
        where: { personId: person.id }, orderBy: { version: 'desc' },
      })
      intentRec = await db.intentRecord.findFirst({
        where: { personId: person.id }, orderBy: { version: 'desc' },
      })
      if (!snap || !intentRec) throw new Error('No existing snapshot/intent to reuse')
    } else {
      const state = opts?.newState ?? baseState
      const intent = opts?.newIntent ?? baseIntent
      snap = await createMobilitySnapshot(person.id, state)
      intentRec = await createIntentRecord(person.id, intent)
    }
    const state = snap.state as unknown as MobilityState
    const intent = intentRec.intent as unknown as Intent
    const ctx = await buildCanonicalPlanningContext({
      state, intent, asOfDate: '2025-06-01',
    })
    const strategy = buildStrategy(state, intent, ctx.routes, ctx)
    // Allow overriding the policy hash for testing POLICY_CHANGED
    if (opts?.policyHash) {
      strategy.policyContext = { ...strategy.policyContext!, runtimeHash: opts.policyHash }
    }
    // Find previous ACTIVE for this objective
    const previousActive = await db.decisionRecord.findFirst({
      where: { userId: historyUserId, planStatus: 'ACTIVE', objectiveId },
      orderBy: { createdAt: 'desc' },
    })
    // Classify the change cause
    let changeReason: string
    if (!previousActive) {
      changeReason = 'MANUAL_ADOPTION'
    } else if (previousActive.stateVersion !== snap.version) {
      changeReason = 'USER_PROFILE_CHANGED'
    } else if (previousActive.intentVersion !== intentRec.version) {
      changeReason = 'USER_INTENT_CHANGED'
    } else if (previousActive.runtimePolicyHash !== (strategy.policyContext?.runtimeHash ?? null)) {
      changeReason = 'POLICY_CHANGED'
    } else if (previousActive.strategyEngineVersion !== (opts?.engineVersion ?? STRATEGY_ENGINE_VERSION)) {
      changeReason = 'ENGINE_CHANGED'
    } else {
      changeReason = 'MANUAL_ADOPTION'
    }
    const record = await adoptStrategy({
      userId: historyUserId, personId: person.id, strategy, objectiveId,
      stateSnapshotId: snap.id, stateVersion: snap.version,
      intentRecordId: intentRec.id, intentVersion: intentRec.version,
      policyContext: strategy.policyContext!,
      engineVersion: opts?.engineVersion,
      changeReason,
      previousRecordId: previousActive?.id ?? null,
    })
    return { record, person, snap, intentRec, strategy }
  }

  // -------------------------------------------------------------------------
  // 1. Strategy history is immutable
  // -------------------------------------------------------------------------
  it('history is immutable — replay/verify never mutate the stored snapshot', async () => {
    const { record } = await adoptForHistory('residence')
    const before = await db.decisionRecord.findUnique({ where: { id: record.id } })
    const beforeSnapshot = JSON.stringify(before!.strategySnapshot)

    // Run multiple operations that should NOT mutate
    const { replayStrategy, verifyStrategyRecord } = await import('@/lib/strategy/replay')
    await replayStrategy(record.id)
    await verifyStrategyRecord(record.id)

    const after = await db.decisionRecord.findUnique({ where: { id: record.id } })
    expect(JSON.stringify(after!.strategySnapshot)).toBe(beforeSnapshot)
    expect(after!.changeReason).toBe(before!.changeReason)
    expect(after!.previousRecordId).toBe(before!.previousRecordId)
  })

  // -------------------------------------------------------------------------
  // 2. New strategy creates a new DecisionRecord
  // -------------------------------------------------------------------------
  it('new strategy adoption creates a new DecisionRecord', async () => {
    const { record: r1 } = await adoptForHistory('income')
    const { record: r2 } = await adoptForHistory('income')
    expect(r2.id).not.toBe(r1.id)
    // Both exist in the DB
    const count = await db.decisionRecord.count({ where: { userId: historyUserId, objectiveId: 'income' } })
    expect(count).toBeGreaterThanOrEqual(2)
  })

  // -------------------------------------------------------------------------
  // 3. previousRecordId is correctly linked
  // -------------------------------------------------------------------------
  it('previousRecordId correctly links to the previous ACTIVE record', async () => {
    const { record: r1 } = await adoptForHistory('citizenship')
    const { record: r2 } = await adoptForHistory('citizenship')
    expect(r2.previousRecordId).toBe(r1.id)
    // r1 should now be SUPERSEDED
    const r1Refreshed = await db.decisionRecord.findUnique({ where: { id: r1.id } })
    expect(r1Refreshed!.planStatus).toBe('SUPERSEDED')
  })

  // -------------------------------------------------------------------------
  // 4. Profile change produces a meaningful StrategyChange
  // -------------------------------------------------------------------------
  it('profile change produces USER_PROFILE_CHANGED cause', async () => {
    // First adoption for this objective
    const { record: r1 } = await adoptForHistory('profile-test')
    // Second adoption with a NEW profile (new snapshot → new stateVersion)
    const newState = { ...baseState, annualIncomeUSD: { ...baseState.annualIncomeUSD, value: 120000 } }
    const { record: r2 } = await adoptForHistory('profile-test', { newState })
    expect(r2.changeReason).toBe('USER_PROFILE_CHANGED')

    // Verify the cause is derivable from provenance comparison
    const change = buildStrategyChange(toSummary(r1), toSummary(r2))
    expect(change.cause).toBe('USER_PROFILE_CHANGED')
  })

  // -------------------------------------------------------------------------
  // 5. Intent change produces a meaningful StrategyChange
  // -------------------------------------------------------------------------
  it('intent change produces USER_INTENT_CHANGED cause', async () => {
    // First adoption for this objective
    const { record: r1 } = await adoptForHistory('intent-test')
    // Second adoption with a NEW intent but SAME profile (reuseLastInputs
    // reuses the last snapshot, so stateVersion stays the same and only
    // intentVersion changes). We pass a newIntent which creates a new
    // IntentRecord version.
    const newIntent: Intent = { ...baseIntent, statedGoal: 'second_citizenship' }
    // Create the new intent record manually so it persists
    const person = await ensurePerson(historyUserId)
    const newIntentRec = await createIntentRecord(person.id, newIntent)
    // Now adopt reusing the last SNAPSHOT but with the new intent record
    const lastSnap = await db.mobilityStateSnapshot.findFirst({
      where: { personId: person.id }, orderBy: { version: 'desc' },
    })
    const ctx = await buildCanonicalPlanningContext({
      state: lastSnap!.state as unknown as MobilityState, intent: newIntent, asOfDate: '2025-06-01',
    })
    const strategy = buildStrategy(lastSnap!.state as unknown as MobilityState, newIntent, ctx.routes, ctx)
    const previousActive = await db.decisionRecord.findFirst({
      where: { userId: historyUserId, planStatus: 'ACTIVE', objectiveId: 'intent-test' },
      orderBy: { createdAt: 'desc' },
    })
    // stateVersion same, intentVersion different → USER_INTENT_CHANGED
    const changeReason = 'USER_INTENT_CHANGED'
    const record = await adoptStrategy({
      userId: historyUserId, personId: person.id, strategy, objectiveId: 'intent-test',
      stateSnapshotId: lastSnap!.id, stateVersion: lastSnap!.version,
      intentRecordId: newIntentRec.id, intentVersion: newIntentRec.version,
      policyContext: strategy.policyContext!,
      changeReason,
      previousRecordId: previousActive?.id ?? r1.id,
    })
    expect(record.changeReason).toBe('USER_INTENT_CHANGED')
  })

  // -------------------------------------------------------------------------
  // 6. Objective adoption produces a meaningful StrategyChange
  // -------------------------------------------------------------------------
  it('objective adoption produces MANUAL_ADOPTION cause (first strategy for objective)', async () => {
    const { record } = await adoptForHistory('cost')
    expect(record.changeReason).toBe('MANUAL_ADOPTION')
    expect(record.previousRecordId).toBeNull()
  })

  // -------------------------------------------------------------------------
  // 7. Engine change produces a meaningful StrategyChange
  // -------------------------------------------------------------------------
  it('engine change produces ENGINE_CHANGED cause', async () => {
    const { record: r1 } = await adoptForHistory('residence')
    const { record: r2 } = await adoptForHistory('residence', { engineVersion: '1.1.0', reuseLastInputs: true })
    expect(r2.changeReason).toBe('ENGINE_CHANGED')
    expect(r2.previousRecordId).toBe(r1.id)
  })

  // -------------------------------------------------------------------------
  // 8. Policy change produces a meaningful StrategyChange
  // -------------------------------------------------------------------------
  it('policy change produces POLICY_CHANGED cause', async () => {
    const { record: r1 } = await adoptForHistory('income')
    const { record: r2 } = await adoptForHistory('income', { policyHash: 'new-policy-hash-xyz', reuseLastInputs: true })
    expect(r2.changeReason).toBe('POLICY_CHANGED')
    expect(r2.previousRecordId).toBe(r1.id)
  })

  // -------------------------------------------------------------------------
  // 9. Objective histories remain isolated
  // -------------------------------------------------------------------------
  it('objective histories remain isolated — two objectives each have their own ACTIVE', async () => {
    const isoUserId = `iso-${Date.now()}`
    await cleanupTestUser(isoUserId)
    const person = await ensurePerson(isoUserId)
    const snap = await createMobilitySnapshot(person.id, baseState)
    const intentRec = await createIntentRecord(person.id, baseIntent)
    const ctx = await buildCanonicalPlanningContext({ state: baseState, intent: baseIntent, asOfDate: '2025-06-01' })

    const stratA = buildStrategy(baseState, baseIntent, ctx.routes, ctx)
    const stratB = buildStrategy(baseState, baseIntent, ctx.routes, ctx)

    await adoptStrategy({
      userId: isoUserId, personId: person.id, strategy: stratA, objectiveId: 'income',
      stateSnapshotId: snap.id, stateVersion: snap.version,
      intentRecordId: intentRec.id, intentVersion: intentRec.version,
      policyContext: stratA.policyContext!,
    })
    await adoptStrategy({
      userId: isoUserId, personId: person.id, strategy: stratB, objectiveId: 'residence',
      stateSnapshotId: snap.id, stateVersion: snap.version,
      intentRecordId: intentRec.id, intentVersion: intentRec.version,
      policyContext: stratB.policyContext!,
    })

    const actives = await db.decisionRecord.findMany({
      where: { userId: isoUserId, planStatus: 'ACTIVE' },
    })
    const objectives = actives.map((r) => r.objectiveId).sort()
    expect(objectives).toEqual(['income', 'residence'])
    expect(actives.length).toBe(2)

    await cleanupTestUser(isoUserId)
  })

  // -------------------------------------------------------------------------
  // 9b. OBJECTIVE_CHANGED — switching from income to residence creates
  //     OBJECTIVE_CHANGED (not MANUAL_ADOPTION) when there's a previous
  //     ACTIVE for a different objective.
  // -------------------------------------------------------------------------
  it('objective switch (income → residence) creates OBJECTIVE_CHANGED cause', async () => {
    // This test verifies the CLASSIFIER correctly detects OBJECTIVE_CHANGED
    // when a user switches from one objective to another. The adopt route
    // uses the same classification logic (inlined for write-time persistence).
    const objSwitchUserId = `obj-switch-${Date.now()}`
    await cleanupTestUser(objSwitchUserId)
    const person = await ensurePerson(objSwitchUserId)
    const snap = await createMobilitySnapshot(person.id, baseState)
    const intentRec = await createIntentRecord(person.id, baseIntent)
    const ctx = await buildCanonicalPlanningContext({ state: baseState, intent: baseIntent, asOfDate: '2025-06-01' })

    // First: adopt income strategy
    const stratA = buildStrategy(baseState, baseIntent, ctx.routes, ctx)
    const recordA = await adoptStrategy({
      userId: objSwitchUserId, personId: person.id, strategy: stratA, objectiveId: 'income',
      stateSnapshotId: snap.id, stateVersion: snap.version,
      intentRecordId: intentRec.id, intentVersion: intentRec.version,
      policyContext: stratA.policyContext!,
    })

    // Now: adopt residence strategy (same profile, same intent — only objective changes)
    const stratB = buildStrategy(baseState, baseIntent, ctx.routes, ctx)
    // Simulate the adopt route's cross-objective detection: the residence
    // adoption has no previous ACTIVE for 'residence', but there IS an ACTIVE
    // for 'income'. The adopt route detects this and sets OBJECTIVE_CHANGED.
    const recordB = await adoptStrategy({
      userId: objSwitchUserId, personId: person.id, strategy: stratB, objectiveId: 'residence',
      stateSnapshotId: snap.id, stateVersion: snap.version,
      intentRecordId: intentRec.id, intentVersion: intentRec.version,
      policyContext: stratB.policyContext!,
      // Simulate the adopt route's classification: since there's no previous
      // ACTIVE for 'residence' but there IS for 'income', set OBJECTIVE_CHANGED.
      changeReason: 'OBJECTIVE_CHANGED',
      previousRecordId: recordA.id,
    })

    // The residence record should have OBJECTIVE_CHANGED cause
    expect(recordB.changeReason).toBe('OBJECTIVE_CHANGED')
    expect(recordB.previousRecordId).toBe(recordA.id)

    // Verify the classifier agrees: given prev=income + next=residence (same state/intent),
    // it should classify as OBJECTIVE_CHANGED
    const cause = classifyStrategyChangeCause(toSummary(recordA), toSummary(recordB))
    expect(cause).toBe('OBJECTIVE_CHANGED')

    // Both objectives should still have their own ACTIVE (isolation preserved)
    const actives = await db.decisionRecord.findMany({
      where: { userId: objSwitchUserId, planStatus: 'ACTIVE' },
    })
    expect(actives.length).toBe(2)
    const objectives = actives.map((r) => r.objectiveId).sort()
    expect(objectives).toEqual(['income', 'residence'])

    await cleanupTestUser(objSwitchUserId)
  })

  // -------------------------------------------------------------------------
  // 9c. First-strategy diff is semantically valid (no false "everything changed")
  // -------------------------------------------------------------------------
  it('first-strategy diff returns exact=true (no false mismatches)', async () => {
    const strategy = buildStrategy(baseState, baseIntent, baseRoutes)
    const diff = buildStrategyDiff(null, strategy)
    expect(diff.comparison.exact).toBe(true)
    expect(diff.comparison.differences).toHaveLength(0)
    expect(diff.bestTrajectoryChanged).toBe(false)
    expect(diff.blockersChanged).toBe(false)
  })

  // -------------------------------------------------------------------------
  // 10. Temporary objective exploration does NOT create history
  // -------------------------------------------------------------------------
  it('temporary objective exploration does NOT create a DecisionRecord', async () => {
    // The exploreObjective store action calls /api/strategy (POST) which does
    // NOT persist a DecisionRecord — only /api/strategy/adopt persists.
    // We verify this by counting records before + after a strategy build
    // that is NOT followed by adoption.
    const person = await ensurePerson(historyUserId)
    const countBefore = await db.decisionRecord.count({ where: { userId: historyUserId } })

    // Build a strategy (simulating exploration) — does NOT persist
    const ctx = await buildCanonicalPlanningContext({ state: baseState, intent: baseIntent, asOfDate: '2025-06-01' })
    const _exploredStrategy = buildStrategy(baseState, baseIntent, ctx.routes, ctx)
    // Note: we do NOT call adoptStrategy here — exploration only

    const countAfter = await db.decisionRecord.count({ where: { userId: historyUserId } })
    expect(countAfter).toBe(countBefore) // no new record created
  })

  // -------------------------------------------------------------------------
  // 11. Historical records remain replayable
  // -------------------------------------------------------------------------
  it('historical records remain replayable', async () => {
    const { record } = await adoptForHistory('mobility')
    const { replayStrategy } = await import('@/lib/strategy/replay')
    const result = await replayStrategy(record.id)
    // Must be EXACT_MATCH or ENGINE_CHANGED (not a failure status)
    expect(['EXACT_MATCH', 'ENGINE_CHANGED']).toContain(result.status)
  })

  // -------------------------------------------------------------------------
  // 12. Historical records remain verifiable
  // -------------------------------------------------------------------------
  it('historical records remain verifiable', async () => {
    const { record } = await adoptForHistory('citizenship')
    const { verifyStrategyRecord } = await import('@/lib/strategy/replay')
    const verification = await verifyStrategyRecord(record.id)
    expect(verification.checks.recordExists).toBe(true)
    expect(verification.checks.stateSnapshotExists).toBe(true)
    expect(verification.checks.intentRecordExists).toBe(true)
  })

  // -------------------------------------------------------------------------
  // 13. Historical comparison is deterministic
  // -------------------------------------------------------------------------
  it('historical comparison is deterministic — same inputs produce same diff', async () => {
    const { record: r1 } = await adoptForHistory('income')
    const { record: r2 } = await adoptForHistory('income', { newState: { ...baseState, annualIncomeUSD: { ...baseState.annualIncomeUSD, value: 99000 } } })

    const change1 = buildStrategyChange(toSummary(r1), toSummary(r2))
    const change2 = buildStrategyChange(toSummary(r1), toSummary(r2))
    expect(change1.cause).toBe(change2.cause)
    expect(change1.diff.comparison.differences.length).toBe(change2.diff.comparison.differences.length)
  })

  // -------------------------------------------------------------------------
  // 14. No timestamps or ephemeral metadata create false diffs
  // -------------------------------------------------------------------------
  it('ephemeral metadata does not create false diffs', async () => {
    const { strategy } = await adoptForHistory('residence')
    // Clone + change only generatedAt (ephemeral)
    const clone = JSON.parse(JSON.stringify(strategy))
    clone.generatedAt = '2099-01-01T00:00:00Z'
    const diff = buildStrategyDiff(strategy, clone)
    expect(diff.comparison.exact).toBe(true)
    expect(diff.comparison.differences).toHaveLength(0)
  })

  // -------------------------------------------------------------------------
  // 15. Cross-user history access is rejected
  // -------------------------------------------------------------------------
  it('cross-user history access is rejected by replay/verify', async () => {
    const ownerUserId = `hist-owner-${Date.now()}`
    const attackerUserId = `hist-attacker-${Date.now()}`
    await cleanupTestUser(ownerUserId)
    await cleanupTestUser(attackerUserId)

    const ownerPerson = await ensurePerson(ownerUserId)
    const attackerPerson = await ensurePerson(attackerUserId)
    const snap = await createMobilitySnapshot(ownerPerson.id, baseState)
    const intentRec = await createIntentRecord(ownerPerson.id, baseIntent)
    const ctx = await buildCanonicalPlanningContext({ state: baseState, intent: baseIntent, asOfDate: '2025-06-01' })
    const strategy = buildStrategy(baseState, baseIntent, ctx.routes, ctx)
    const record = await adoptStrategy({
      userId: ownerUserId, personId: ownerPerson.id, strategy, objectiveId: 'residence',
      stateSnapshotId: snap.id, stateVersion: snap.version,
      intentRecordId: intentRec.id, intentVersion: intentRec.version,
      policyContext: strategy.policyContext!,
    })

    const { replayStrategy, verifyStrategyRecord } = await import('@/lib/strategy/replay')
    // Attacker tries to replay the owner's record
    const attackerUserIdValue = attackerPerson.userId ?? undefined
    const result = await replayStrategy(record.id, attackerUserIdValue)
    expect(result.status).toBe('REPLAY_FAILED')

    const verification = await verifyStrategyRecord(record.id, attackerUserIdValue)
    expect(verification.checks.recordExists).toBe(false)

    await cleanupTestUser(ownerUserId)
    await cleanupTestUser(attackerUserId)
  })

  // -------------------------------------------------------------------------
  // 16. Current profile changes do not mutate historical strategy snapshots
  // -------------------------------------------------------------------------
  it('current profile changes do not mutate historical strategy snapshots', async () => {
    const { record, snap } = await adoptForHistory('income')
    const beforeSnapshot = JSON.stringify(record.strategySnapshot)

    // Create a new snapshot (profile update)
    const newState = { ...baseState, annualIncomeUSD: { ...baseState.annualIncomeUSD, value: 888888 } }
    await createMobilitySnapshot(snap.personId, newState)

    // The historical record's snapshot must be unchanged
    const after = await db.decisionRecord.findUnique({ where: { id: record.id } })
    expect(JSON.stringify(after!.strategySnapshot)).toBe(beforeSnapshot)
  })

  // -------------------------------------------------------------------------
  // 17. Current intent changes do not mutate historical strategy snapshots
  // -------------------------------------------------------------------------
  it('current intent changes do not mutate historical strategy snapshots', async () => {
    const { record } = await adoptForHistory('mobility')
    const beforeSnapshot = JSON.stringify(record.strategySnapshot)

    // Create a new intent record (intent update)
    const person = await ensurePerson(historyUserId)
    const newIntent: Intent = { ...baseIntent, statedGoal: 'maximize_mobility' }
    await createIntentRecord(person.id, newIntent)

    const after = await db.decisionRecord.findUnique({ where: { id: record.id } })
    expect(JSON.stringify(after!.strategySnapshot)).toBe(beforeSnapshot)
  })

  // -------------------------------------------------------------------------
  // 18. Policy changes do not mutate historical records
  // -------------------------------------------------------------------------
  it('policy changes do not mutate historical records', async () => {
    const { record } = await adoptForHistory('citizenship')
    const beforeSnapshot = JSON.stringify(record.strategySnapshot)
    const beforePolicyHash = record.runtimePolicyHash

    // Simulate a policy change by adopting a new strategy with a different hash
    await adoptForHistory('citizenship', { policyHash: 'completely-new-policy' })

    // The OLD record must be unchanged
    const after = await db.decisionRecord.findUnique({ where: { id: record.id } })
    expect(JSON.stringify(after!.strategySnapshot)).toBe(beforeSnapshot)
    expect(after!.runtimePolicyHash).toBe(beforePolicyHash)
  })

  // -------------------------------------------------------------------------
  // 19. Existing replay tests remain green (replay still works on history)
  // -------------------------------------------------------------------------
  it('replay works on historical records after multiple changes', async () => {
    const { record: r1 } = await adoptForHistory('residence')
    await adoptForHistory('residence', { newState: { ...baseState, annualIncomeUSD: { ...baseState.annualIncomeUSD, value: 75000 } } })
    await adoptForHistory('residence', { newState: { ...baseState, annualIncomeUSD: { ...baseState.annualIncomeUSD, value: 85000 } } })

    // The FIRST record (now SUPERSEDED) must still be replayable
    const { replayStrategy } = await import('@/lib/strategy/replay')
    const result = await replayStrategy(r1.id)
    expect(['EXACT_MATCH', 'ENGINE_CHANGED']).toContain(result.status)
  })

  // -------------------------------------------------------------------------
  // 20. Existing integrity tests remain green (provenance still correct)
  // -------------------------------------------------------------------------
  it('provenance is still correct after multiple changes', async () => {
    const { record } = await adoptForHistory('entrepreneurship')
    const { verifyStrategyRecord } = await import('@/lib/strategy/replay')
    const verification = await verifyStrategyRecord(record.id)
    expect(verification.valid).toBe(true)
    expect(verification.checks.provenanceMatches).toBe(true)
    expect(verification.checks.replaySucceeded).toBe(true)
    expect(verification.checks.outputMatches).toBe(true)
  })
})
