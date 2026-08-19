// Wayfinder — N0.3 Profile Editor Tests
//
// Tests the authoritative profile editor: server validation, immutable
// snapshots, concurrency-safe versioning, strategy recomputation, and the
// guarantee that previews do not pollute history.

import { describe, it, expect, beforeAll } from 'vitest'
import { db } from '@/lib/db'
import { validateProfileUpdates, applyValidatedUpdates, EDITABLE_FIELDS } from '@/lib/domain/profile-validation'
import { buildCanonicalPlanningContext, STRATEGY_ENGINE_VERSION } from '@/lib/strategy/planning-context'
import { buildStrategy } from '@/lib/strategy'
import { classifyStrategyChangeCause, type StrategyRecordSummary } from '@/lib/strategy/change'
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

async function createMobilitySnapshot(personId: string, state: MobilityState) {
  return db.$transaction(async (tx) => {
    const latest = await tx.mobilityStateSnapshot.findFirst({
      where: { personId }, orderBy: { version: 'desc' },
    })
    const newVersion = (latest?.version ?? 0) + 1
    return tx.mobilityStateSnapshot.create({
      data: { personId, version: newVersion, state: state as any, source: 'USER_CONFIRMED' },
    })
  })
}

async function createIntentRecord(personId: string, intent: Intent) {
  return db.$transaction(async (tx) => {
    const latest = await tx.intentRecord.findFirst({
      where: { personId }, orderBy: { version: 'desc' },
    })
    const newVersion = (latest?.version ?? 0) + 1
    return tx.intentRecord.create({
      data: { personId, version: newVersion, rawInput: intent.rawInput, intent: intent as any },
    })
  })
}

// ---------------------------------------------------------------------------
// 1. Validation tests (pure functions)
// ---------------------------------------------------------------------------

describe('Profile update validation', () => {
  it('accepts valid updates for editable fields', () => {
    const result = validateProfileUpdates({
      age: 30,
      annualIncomeUSD: 95000,
      remoteWorkEligible: true,
      languages: [{ language: 'de', cefr: 'B2' }],
    })
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
    expect(result.validatedUpdates.age).toBe(30)
    expect(result.validatedUpdates.annualIncomeUSD).toBe(95000)
  })

  it('rejects unknown fields', () => {
    const result = validateProfileUpdates({
      age: 30,
      unknownField: 'malicious',
      schemaVersion: 2, // attempt to overwrite schemaVersion
    })
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('unknown field: unknownField'))).toBe(true)
    expect(result.errors.some((e) => e.includes('unknown field: schemaVersion'))).toBe(true)
    // The valid field (age) should still be in validatedUpdates
    expect(result.validatedUpdates.age).toBe(30)
  })

  it('rejects invalid education level', () => {
    const result = validateProfileUpdates({ education: 'invalid_level' })
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('education must be one of'))).toBe(true)
  })

  it('rejects invalid occupation category', () => {
    const result = validateProfileUpdates({ occupationCategory: 'invalid_cat' })
    expect(result.valid).toBe(false)
  })

  it('rejects negative income', () => {
    const result = validateProfileUpdates({ annualIncomeUSD: -1000 })
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('non-negative'))).toBe(true)
  })

  it('rejects invalid language CEFR', () => {
    const result = validateProfileUpdates({ languages: [{ language: 'en', cefr: 'X5' }] })
    expect(result.valid).toBe(false)
  })

  it('accepts null values for nullable fields', () => {
    const result = validateProfileUpdates({
      age: null,
      education: null,
      founderStatus: null,
    })
    expect(result.valid).toBe(true)
  })

  it('accepts valid arrays for country-code fields', () => {
    const result = validateProfileUpdates({
      nationalities: ['KE', 'UG'],
      credentialRecognizedIn: ['DE'],
    })
    expect(result.valid).toBe(true)
  })

  it('EDITABLE_FIELDS only contains UserFact fields (no schemaVersion, capturedAt)', () => {
    expect(EDITABLE_FIELDS).not.toContain('schemaVersion')
    expect(EDITABLE_FIELDS).not.toContain('capturedAt')
    expect(EDITABLE_FIELDS).not.toContain('constraints')
    expect(EDITABLE_FIELDS).not.toContain('preferences')
  })
})

// ---------------------------------------------------------------------------
// 2. applyValidatedUpdates tests
// ---------------------------------------------------------------------------

describe('applyValidatedUpdates', () => {
  it('preserves USER_CONFIRMED provenance on updated fields', () => {
    const updated = applyValidatedUpdates(baseState, { annualIncomeUSD: 95000 })
    expect(updated.annualIncomeUSD.value).toBe(95000)
    expect(updated.annualIncomeUSD.status).toBe('confirmed_by_user')
    expect(updated.annualIncomeUSD.provenance).toBe('user_edit')
  })

  it('does NOT mutate the input state', () => {
    const original = JSON.parse(JSON.stringify(baseState))
    applyValidatedUpdates(baseState, { annualIncomeUSD: 95000 })
    expect(baseState.annualIncomeUSD.value).toBe(original.annualIncomeUSD.value)
  })

  it('updates capturedAt', () => {
    const updated = applyValidatedUpdates(baseState, { age: 30 })
    expect(updated.capturedAt).not.toBe(baseState.capturedAt)
  })
})

// ---------------------------------------------------------------------------
// 3. DB-backed profile editor tests
// ---------------------------------------------------------------------------

describe('Profile editor (DB-backed)', () => {
  const editorUserId = `editor-test-${Date.now()}`

  beforeAll(async () => {
    await cleanupTestUser(editorUserId)
  })

  async function setupBaseProfile() {
    const person = await ensurePerson(editorUserId)
    const snap = await createMobilitySnapshot(person.id, baseState)
    const intentRec = await createIntentRecord(person.id, baseIntent)
    return { person, snap, intentRec }
  }

  it('creates an immutable snapshot on update (does not mutate the old one)', async () => {
    const { person, snap } = await setupBaseProfile()
    const oldSnapshotState = JSON.parse(JSON.stringify(snap.state))

    // Apply an update
    const updated = applyValidatedUpdates(baseState, { annualIncomeUSD: 95000 })
    await createMobilitySnapshot(person.id, updated)

    // The old snapshot must be unchanged
    const oldRefreshed = await db.mobilityStateSnapshot.findUnique({ where: { id: snap.id } })
    expect(JSON.stringify(oldRefreshed!.state)).toBe(JSON.stringify(oldSnapshotState))
    expect((oldRefreshed!.state as any).annualIncomeUSD.value).toBe(baseState.annualIncomeUSD.value)
  })

  it('version increments monotonically', async () => {
    const { person } = await setupBaseProfile()
    const versions: number[] = []
    for (let i = 0; i < 3; i++) {
      const updated = applyValidatedUpdates(baseState, { annualIncomeUSD: 70000 + i * 1000 })
      const snap = await createMobilitySnapshot(person.id, updated)
      versions.push(snap.version)
    }
    expect(versions[1]).toBeGreaterThan(versions[0])
    expect(versions[2]).toBeGreaterThan(versions[1])
  })

  it('DB-level @@unique([personId, version]) rejects duplicate versions', async () => {
    const uniqueUserId = `editor-unique-${Date.now()}`
    await cleanupTestUser(uniqueUserId)
    const person = await ensurePerson(uniqueUserId)
    const snap1 = await createMobilitySnapshot(person.id, baseState)
    await expect(
      db.mobilityStateSnapshot.create({
        data: { personId: person.id, version: snap1.version, state: baseState as any, source: 'USER_CONFIRMED' },
      }),
    ).rejects.toThrow()
    await cleanupTestUser(uniqueUserId)
  })

  it('USER_CONFIRMED source is preserved', async () => {
    const { person } = await setupBaseProfile()
    const updated = applyValidatedUpdates(baseState, { savingsUSD: 50000 })
    const snap = await createMobilitySnapshot(person.id, updated)
    expect(snap.source).toBe('USER_CONFIRMED')
  })

  it('USER_PROFILE_CHANGED cause is classified when stateVersion differs', async () => {
    const { person, snap, intentRec } = await setupBaseProfile()
    // Create a strategy record for the old state
    const ctx1 = await buildCanonicalPlanningContext({ state: baseState, intent: baseIntent, asOfDate: '2025-06-01' })
    const strategy1 = buildStrategy(baseState, baseIntent, ctx1.routes, ctx1)
    const record1 = await db.decisionRecord.create({
      data: {
        personId: person.id, userId: editorUserId,
        stateVersion: snap.version, mobilityStateSnapshotId: snap.id,
        intentVersion: intentRec.version, intentRecordId: intentRec.id,
        policyVersion: ctx1.policyContext.baseSnapshotId, policyHash: ctx1.policyContext.runtimeHash,
        runtimePolicyVersion: ctx1.policyContext.runtimeVersionId, runtimePolicyHash: ctx1.policyContext.runtimeHash,
        asOfDate: new Date(ctx1.policyContext.asOf), plan: strategy1 as any,
        trigger: 'OBJECTIVE_ADOPT', planStatus: 'ACTIVE', strategyEngineVersion: STRATEGY_ENGINE_VERSION,
        objectiveId: 'income', objectiveVersion: 1, strategySnapshot: strategy1 as any,
        uniqueActiveObjectiveKey: `${editorUserId}:objective-cause-test`,
        changeReason: 'MANUAL_ADOPTION',
      },
    })

    // Now create a new snapshot (profile change)
    const newState = applyValidatedUpdates(baseState, { annualIncomeUSD: 99000 })
    const snap2 = await createMobilitySnapshot(person.id, newState)

    // Supersede the old record so the uniqueActiveObjectiveKey is freed
    await db.decisionRecord.update({
      where: { id: record1.id },
      data: { planStatus: 'SUPERSEDED', uniqueActiveObjectiveKey: null },
    })

    // Create a new strategy record with the new state
    const ctx2 = await buildCanonicalPlanningContext({ state: newState, intent: baseIntent, asOfDate: '2025-06-01' })
    const strategy2 = buildStrategy(newState, baseIntent, ctx2.routes, ctx2)
    const record2 = await db.decisionRecord.create({
      data: {
        personId: person.id, userId: editorUserId,
        stateVersion: snap2.version, mobilityStateSnapshotId: snap2.id,
        intentVersion: intentRec.version, intentRecordId: intentRec.id,
        policyVersion: ctx2.policyContext.baseSnapshotId, policyHash: ctx2.policyContext.runtimeHash,
        runtimePolicyVersion: ctx2.policyContext.runtimeVersionId, runtimePolicyHash: ctx2.policyContext.runtimeHash,
        asOfDate: new Date(ctx2.policyContext.asOf), plan: strategy2 as any,
        trigger: 'edit', planStatus: 'ACTIVE', strategyEngineVersion: STRATEGY_ENGINE_VERSION,
        objectiveId: 'objective-cause-test', objectiveVersion: 1, strategySnapshot: strategy2 as any,
        uniqueActiveObjectiveKey: `${editorUserId}:objective-cause-test`,
        previousRecordId: record1.id, changeReason: 'USER_PROFILE_CHANGED',
      },
    })

    // Verify the cause classification
    const cause = classifyStrategyChangeCause(
      { id: record1.id, stateVersion: snap.version, intentVersion: intentRec.version, objectiveId: 'objective-cause-test', runtimePolicyHash: ctx1.policyContext.runtimeHash, strategyEngineVersion: STRATEGY_ENGINE_VERSION, trigger: 'OBJECTIVE_ADOPT', previousRecordId: null, changeReason: null, createdAt: record1.createdAt, strategySnapshot: strategy1 },
      { id: record2.id, stateVersion: snap2.version, intentVersion: intentRec.version, objectiveId: 'objective-cause-test', runtimePolicyHash: ctx2.policyContext.runtimeHash, strategyEngineVersion: STRATEGY_ENGINE_VERSION, trigger: 'edit', previousRecordId: record1.id, changeReason: 'USER_PROFILE_CHANGED', createdAt: record2.createdAt, strategySnapshot: strategy2 },
    )
    expect(cause).toBe('USER_PROFILE_CHANGED')
  })

  it('historical strategy remains immutable after profile change', async () => {
    const { person, snap } = await setupBaseProfile()
    const ctx = await buildCanonicalPlanningContext({ state: baseState, intent: baseIntent, asOfDate: '2025-06-01' })
    const strategy = buildStrategy(baseState, baseIntent, ctx.routes, ctx)
    const record = await db.decisionRecord.create({
      data: {
        personId: person.id, userId: editorUserId,
        stateVersion: snap.version, mobilityStateSnapshotId: snap.id,
        intentVersion: 1, intentRecordId: 'test-intent',
        policyVersion: ctx.policyContext.baseSnapshotId, policyHash: ctx.policyContext.runtimeHash,
        runtimePolicyVersion: ctx.policyContext.runtimeVersionId, runtimePolicyHash: ctx.policyContext.runtimeHash,
        asOfDate: new Date(ctx.policyContext.asOf), plan: strategy as any,
        trigger: 'OBJECTIVE_ADOPT', planStatus: 'ACTIVE', strategyEngineVersion: STRATEGY_ENGINE_VERSION,
        objectiveId: 'immutability-test', objectiveVersion: 1, strategySnapshot: strategy as any,
        uniqueActiveObjectiveKey: `${editorUserId}:immutability-test`,
      },
    })
    const beforeSnapshot = JSON.stringify(record.strategySnapshot)

    // Create a new snapshot (profile change)
    const newState = applyValidatedUpdates(baseState, { annualIncomeUSD: 88888 })
    await createMobilitySnapshot(person.id, newState)

    // The old record's snapshot must be unchanged
    const after = await db.decisionRecord.findUnique({ where: { id: record.id } })
    expect(JSON.stringify(after!.strategySnapshot)).toBe(beforeSnapshot)
  })

  it('preview (counterfactual) does NOT create a DecisionRecord', async () => {
    const { person } = await setupBaseProfile()
    const countBefore = await db.decisionRecord.count({ where: { userId: editorUserId } })

    // Simulate a preview: build a strategy with modified state but do NOT persist
    const previewState = applyValidatedUpdates(baseState, { annualIncomeUSD: 999999 })
    const ctx = await buildCanonicalPlanningContext({ state: previewState, intent: baseIntent, asOfDate: '2025-06-01' })
    const _previewStrategy = buildStrategy(previewState, baseIntent, ctx.routes, ctx)
    // Note: we do NOT create a DecisionRecord here — preview only

    const countAfter = await db.decisionRecord.count({ where: { userId: editorUserId } })
    expect(countAfter).toBe(countBefore)
  })

  it('replay of historical pre-update strategy still reproduces the old strategy', async () => {
    const { person, snap, intentRec } = await setupBaseProfile()
    const ctx = await buildCanonicalPlanningContext({ state: baseState, intent: baseIntent, asOfDate: '2025-06-01' })
    const strategy = buildStrategy(baseState, baseIntent, ctx.routes, ctx)
    const record = await db.decisionRecord.create({
      data: {
        personId: person.id, userId: editorUserId,
        stateVersion: snap.version, mobilityStateSnapshotId: snap.id,
        intentVersion: intentRec.version, intentRecordId: intentRec.id,
        policyVersion: ctx.policyContext.baseSnapshotId, policyHash: ctx.policyContext.runtimeHash,
        runtimePolicyVersion: ctx.policyContext.runtimeVersionId, runtimePolicyHash: ctx.policyContext.runtimeHash,
        asOfDate: new Date(ctx.policyContext.asOf), plan: strategy as any,
        trigger: 'OBJECTIVE_ADOPT', planStatus: 'ACTIVE', strategyEngineVersion: STRATEGY_ENGINE_VERSION,
        objectiveId: 'replay-test', objectiveVersion: 1, strategySnapshot: strategy as any,
        uniqueActiveObjectiveKey: `${editorUserId}:replay-test`,
      },
    })

    // Create a new snapshot (profile change)
    const newState = applyValidatedUpdates(baseState, { annualIncomeUSD: 77777 })
    await createMobilitySnapshot(person.id, newState)

    // Replay the OLD record — it must use the OLD snapshot, not the new one
    const { replayStrategy } = await import('@/lib/strategy/replay')
    const result = await replayStrategy(record.id)
    expect(['EXACT_MATCH', 'ENGINE_CHANGED']).toContain(result.status)
    // The replayed strategy's state must have the OLD income, not 77777
    expect(result.replayedStrategy!.state.annualIncomeUSD.value).toBe(baseState.annualIncomeUSD.value)
  })
})
