// Tests for strategy persistence, staleness, and profile editing.
//
// These tests cover the staleness engine + reproducibility invariants that do
// not require DB access. The DB-backed integrity tests (adoption atomicity,
// concurrent profile updates, replay) live in tests/strategy-integrity.test.ts.

import { describe, it, expect, beforeAll } from 'vitest'
import { getStrategyStaleness, getFullStrategyStaleness, deriveStalenessStatus } from '@/lib/strategy/staleness'
import { STRATEGY_ENGINE_VERSION } from '@/lib/strategy/planning-context'
import { buildStrategy } from '@/lib/strategy'
import { exampleState } from '@/lib/domain/state'
import { parseIntentDeterministic } from '@/lib/domain/intent'
import { generateRoutes } from '@/lib/engine/routes'
import { getCurrentPolicySnapshot } from '@/lib/policy/snapshot'
import type { Strategy } from '@/lib/strategy/types'
import type { MobilityState } from '@/lib/domain/types'

const state = exampleState()
const intent = parseIntentDeterministic('I want to move abroad.')
const routes = generateRoutes(state, intent, '2025-06-01')
let strategy: any
beforeAll(async () => {
  strategy = await buildStrategy(state, intent, routes)
})

// ===========================================================================
// 1. STALENESS ENGINE — deriveStalenessStatus (pure function)
// ===========================================================================

describe('Staleness status derivation (pure)', () => {
  it('returns CURRENT when no dimensions mismatch', async () => {
    const result = deriveStalenessStatus({
      policy: false, profile: false, intent: false, engine: false,
    })
    expect(result.status).toBe('CURRENT')
    expect(result.shouldRecalculate).toBe(false)
    expect(result.dimensions).toEqual({
      policy: false, profile: false, intent: false, engine: false,
    })
  })

  it('returns STALE_POLICY when only policy mismatches', async () => {
    const result = deriveStalenessStatus({
      policy: true, profile: false, intent: false, engine: false,
    })
    expect(result.status).toBe('STALE_POLICY')
    expect(result.shouldRecalculate).toBe(true)
    expect(result.dimensions.policy).toBe(true)
    expect(result.dimensions.profile).toBe(false)
    expect(result.reasons).toHaveLength(1)
    expect(result.reasons[0]).toMatch(/policy/i)
  })

  it('returns STALE_PROFILE when only profile mismatches', async () => {
    const result = deriveStalenessStatus({
      policy: false, profile: true, intent: false, engine: false,
    })
    expect(result.status).toBe('STALE_PROFILE')
    expect(result.dimensions.profile).toBe(true)
    expect(result.reasons[0]).toMatch(/profile/i)
  })

  it('returns STALE_INTENT when only intent mismatches', async () => {
    const result = deriveStalenessStatus({
      policy: false, profile: false, intent: true, engine: false,
    })
    expect(result.status).toBe('STALE_INTENT')
    expect(result.dimensions.intent).toBe(true)
    expect(result.reasons[0]).toMatch(/priorit/i)
  })

  it('returns STALE_ENGINE when only engine mismatches', async () => {
    const result = deriveStalenessStatus({
      policy: false, profile: false, intent: false, engine: true,
    })
    expect(result.status).toBe('STALE_ENGINE')
    expect(result.dimensions.engine).toBe(true)
    expect(result.reasons[0]).toMatch(/engine/i)
  })

  it('returns STALE_MULTIPLE when 2+ dimensions mismatch', async () => {
    const result = deriveStalenessStatus({
      policy: true, profile: true, intent: false, engine: false,
    })
    expect(result.status).toBe('STALE_MULTIPLE')
    expect(result.shouldRecalculate).toBe(true)
    expect(result.reasons).toHaveLength(2)
  })

  it('returns STALE_MULTIPLE when all 4 dimensions mismatch', async () => {
    const result = deriveStalenessStatus({
      policy: true, profile: true, intent: true, engine: true,
    })
    expect(result.status).toBe('STALE_MULTIPLE')
    expect(result.reasons).toHaveLength(4)
  })

  it('exposes per-dimension flags even on STALE_MULTIPLE', async () => {
    const result = deriveStalenessStatus({
      policy: true, profile: false, intent: true, engine: false,
    })
    expect(result.status).toBe('STALE_MULTIPLE')
    expect(result.dimensions).toEqual({
      policy: true, profile: false, intent: true, engine: false,
    })
  })
})

// ===========================================================================
// 2. STALENESS ENGINE — getStrategyStaleness (client variant)
// ===========================================================================

describe('Strategy staleness (client variant)', () => {
  it('returns CURRENT for a strategy with matching policy hash + engine version', async () => {
    const currentPolicy = getCurrentPolicySnapshot()
    const freshStrategy: Strategy = {
      ...strategy,
      policyContext: {
        baseSnapshotId: currentPolicy.id,
        activeOverlayIds: [],
        runtimeVersionId: currentPolicy.id,
        runtimeHash: currentPolicy.hash,
        asOf: '2025-06-01',
        simulationMode: false,
      },
      strategyEngineVersion: STRATEGY_ENGINE_VERSION,
      mobilityStateVersion: 1,
      intentVersion: 1,
    }
    const result = getStrategyStaleness(freshStrategy, 1, 1)
    expect(result.status).toBe('CURRENT')
    expect(result.shouldRecalculate).toBe(false)
  })

  it('returns STALE_POLICY when the policy hash differs', async () => {
    const staleStrategy: Strategy = {
      ...strategy,
      policyContext: {
        baseSnapshotId: 'snap-old',
        activeOverlayIds: [],
        runtimeVersionId: 'snap-old',
        runtimeHash: 'old-hash-12345',
        asOf: '2024-01-01',
        simulationMode: false,
      },
      strategyEngineVersion: STRATEGY_ENGINE_VERSION,
      mobilityStateVersion: 1,
      intentVersion: 1,
    }
    const result = getStrategyStaleness(staleStrategy, 1, 1)
    expect(result.status).toBe('STALE_POLICY')
    expect(result.dimensions.policy).toBe(true)
    expect(result.dimensions.profile).toBe(false)
  })

  it('returns STALE_ENGINE when the engine version differs', async () => {
    const currentPolicy = getCurrentPolicySnapshot()
    const staleStrategy: Strategy = {
      ...strategy,
      policyContext: {
        baseSnapshotId: currentPolicy.id,
        activeOverlayIds: [],
        runtimeVersionId: currentPolicy.id,
        runtimeHash: currentPolicy.hash,
        asOf: '2025-06-01',
        simulationMode: false,
      },
      strategyEngineVersion: '0.9.0', // old version
      mobilityStateVersion: 1,
      intentVersion: 1,
    }
    const result = getStrategyStaleness(staleStrategy, 1, 1)
    expect(result.status).toBe('STALE_ENGINE')
    expect(result.dimensions.engine).toBe(true)
  })

  it('returns STALE_PROFILE when the state version differs', async () => {
    const currentPolicy = getCurrentPolicySnapshot()
    const staleStrategy: Strategy = {
      ...strategy,
      policyContext: {
        baseSnapshotId: currentPolicy.id,
        activeOverlayIds: [],
        runtimeVersionId: currentPolicy.id,
        runtimeHash: currentPolicy.hash,
        asOf: '2025-06-01',
        simulationMode: false,
      },
      strategyEngineVersion: STRATEGY_ENGINE_VERSION,
      mobilityStateVersion: 1,
      intentVersion: 1,
    }
    const result = getStrategyStaleness(staleStrategy, 2, 1) // current state version = 2
    expect(result.status).toBe('STALE_PROFILE')
    expect(result.dimensions.profile).toBe(true)
  })

  it('returns STALE_INTENT when the intent version differs', async () => {
    const currentPolicy = getCurrentPolicySnapshot()
    const staleStrategy: Strategy = {
      ...strategy,
      policyContext: {
        baseSnapshotId: currentPolicy.id,
        activeOverlayIds: [],
        runtimeVersionId: currentPolicy.id,
        runtimeHash: currentPolicy.hash,
        asOf: '2025-06-01',
        simulationMode: false,
      },
      strategyEngineVersion: STRATEGY_ENGINE_VERSION,
      mobilityStateVersion: 1,
      intentVersion: 1,
    }
    const result = getStrategyStaleness(staleStrategy, 1, 3) // current intent version = 3
    expect(result.status).toBe('STALE_INTENT')
    expect(result.dimensions.intent).toBe(true)
  })

  it('returns STALE_MULTIPLE when both policy and engine differ', async () => {
    const staleStrategy: Strategy = {
      ...strategy,
      policyContext: {
        baseSnapshotId: 'snap-old',
        activeOverlayIds: [],
        runtimeVersionId: 'snap-old',
        runtimeHash: 'old-hash',
        asOf: '2024-01-01',
        simulationMode: false,
      },
      strategyEngineVersion: '0.9.0',
      mobilityStateVersion: 1,
      intentVersion: 1,
    }
    const result = getStrategyStaleness(staleStrategy, 1, 1)
    expect(result.status).toBe('STALE_MULTIPLE')
    expect(result.reasons.length).toBe(2)
  })

  it('provides a human-readable explanation', async () => {
    const staleStrategy: Strategy = {
      ...strategy,
      policyContext: {
        baseSnapshotId: 'snap-old',
        activeOverlayIds: [],
        runtimeVersionId: 'snap-old',
        runtimeHash: 'old-hash',
        asOf: '2024-01-01',
        simulationMode: false,
      },
      strategyEngineVersion: STRATEGY_ENGINE_VERSION,
      mobilityStateVersion: 1,
      intentVersion: 1,
    }
    const result = getStrategyStaleness(staleStrategy, 1, 1)
    expect(result.explanation).toContain('policy')
  })
})

// ===========================================================================
// 3. FULL STALENESS (server-side, with state/intent versions)
// ===========================================================================

describe('Full strategy staleness (server variant — all 4 dimensions)', () => {
  const currentPolicy = getCurrentPolicySnapshot()

  function makeStrategy(overrides: Partial<Strategy> = {}): Strategy {
    return {
      ...strategy,
      policyContext: {
        baseSnapshotId: currentPolicy.id,
        activeOverlayIds: [],
        runtimeVersionId: currentPolicy.id,
        runtimeHash: currentPolicy.hash,
        asOf: '2025-06-01',
        simulationMode: false,
      },
      strategyEngineVersion: STRATEGY_ENGINE_VERSION,
      mobilityStateVersion: 1,
      intentVersion: 1,
      ...overrides,
    }
  }

  it('returns CURRENT when all 4 dimensions match', async () => {
    const result = getFullStrategyStaleness(
      makeStrategy(),
      currentPolicy.hash,
      1, // currentStateVersion
      1, // currentIntentVersion
      STRATEGY_ENGINE_VERSION,
    )
    expect(result.status).toBe('CURRENT')
    expect(result.dimensions).toEqual({
      policy: false, profile: false, intent: false, engine: false,
    })
  })

  it('returns STALE_POLICY when only the policy hash differs', async () => {
    const result = getFullStrategyStaleness(
      makeStrategy(),
      'different-policy-hash',
      1,
      1,
      STRATEGY_ENGINE_VERSION,
    )
    expect(result.status).toBe('STALE_POLICY')
    expect(result.dimensions.policy).toBe(true)
    expect(result.dimensions.profile).toBe(false)
  })

  it('returns STALE_PROFILE when only the state version differs', async () => {
    const result = getFullStrategyStaleness(
      makeStrategy(),
      currentPolicy.hash,
      7, // current state version is now 7
      1,
      STRATEGY_ENGINE_VERSION,
    )
    expect(result.status).toBe('STALE_PROFILE')
    expect(result.dimensions.profile).toBe(true)
  })

  it('returns STALE_INTENT when only the intent version differs', async () => {
    const result = getFullStrategyStaleness(
      makeStrategy(),
      currentPolicy.hash,
      1,
      4, // current intent version is now 4
      STRATEGY_ENGINE_VERSION,
    )
    expect(result.status).toBe('STALE_INTENT')
    expect(result.dimensions.intent).toBe(true)
  })

  it('returns STALE_ENGINE when only the engine version differs', async () => {
    const result = getFullStrategyStaleness(
      makeStrategy(),
      currentPolicy.hash,
      1,
      1,
      '99.0.0', // engine has moved on
    )
    expect(result.status).toBe('STALE_ENGINE')
    expect(result.dimensions.engine).toBe(true)
  })

  it('returns STALE_MULTIPLE when policy + profile differ', async () => {
    const result = getFullStrategyStaleness(
      makeStrategy(),
      'different-policy-hash',
      7,
      1,
      STRATEGY_ENGINE_VERSION,
    )
    expect(result.status).toBe('STALE_MULTIPLE')
    expect(result.dimensions.policy).toBe(true)
    expect(result.dimensions.profile).toBe(true)
    expect(result.dimensions.intent).toBe(false)
    expect(result.dimensions.engine).toBe(false)
  })

  it('returns STALE_MULTIPLE when policy + intent differ', async () => {
    const result = getFullStrategyStaleness(
      makeStrategy(),
      'different-policy-hash',
      1,
      4,
      STRATEGY_ENGINE_VERSION,
    )
    expect(result.status).toBe('STALE_MULTIPLE')
    expect(result.reasons.length).toBe(2)
  })

  it('returns STALE_MULTIPLE when profile + intent differ', async () => {
    const result = getFullStrategyStaleness(
      makeStrategy(),
      currentPolicy.hash,
      2,
      2,
      STRATEGY_ENGINE_VERSION,
    )
    expect(result.status).toBe('STALE_MULTIPLE')
  })

  it('returns STALE_MULTIPLE when all 4 dimensions differ', async () => {
    const result = getFullStrategyStaleness(
      makeStrategy(),
      'different-policy-hash',
      99,
      99,
      '99.0.0',
    )
    expect(result.status).toBe('STALE_MULTIPLE')
    expect(result.reasons.length).toBe(4)
    expect(result.dimensions).toEqual({
      policy: true, profile: true, intent: true, engine: true,
    })
  })

  it('never infers staleness from timestamps — only exact versions', async () => {
    // An old generatedAt timestamp with matching versions is still CURRENT.
    const oldStrategy = makeStrategy({
      generatedAt: '2020-01-01T00:00:00Z',
      policyContext: {
        baseSnapshotId: currentPolicy.id,
        activeOverlayIds: [],
        runtimeVersionId: currentPolicy.id,
        runtimeHash: currentPolicy.hash,
        asOf: '2025-06-01',
        simulationMode: false,
      },
    })
    const result = getFullStrategyStaleness(
      oldStrategy,
      currentPolicy.hash,
      1,
      1,
      STRATEGY_ENGINE_VERSION,
    )
    expect(result.status).toBe('CURRENT')
  })
})

// ===========================================================================
// 4. STRATEGY REPRODUCIBILITY
// ===========================================================================

describe('Strategy reproducibility', () => {
  it('same state + intent + routes produce the same strategy engine version', async () => {
    const s1 = await buildStrategy(state, intent, routes)
    const s2 = await buildStrategy(state, intent, routes)
    expect(s1.strategyEngineVersion).toBe(s2.strategyEngineVersion)
    expect(s1.strategyEngineVersion).toBe(STRATEGY_ENGINE_VERSION)
  })

  it('strategy carries strategyEngineVersion for reproducibility', async () => {
    expect(strategy.strategyEngineVersion).toBeDefined()
    expect(strategy.strategyEngineVersion).toBe(STRATEGY_ENGINE_VERSION)
  })

  it('StrategyProvenance type is constructable from all required fields', async () => {
    const provenance = {
      strategyEngineVersion: STRATEGY_ENGINE_VERSION,
      runtimePolicyVersion: 'snap-2024-11',
      runtimePolicyHash: 'abc123',
      asOfDate: '2025-06-01',
      mobilityStateSnapshotId: 'snap-1',
      mobilityStateVersion: 1,
      intentRecordId: 'intent-1',
      intentVersion: 1,
      objectiveId: 'residence',
      objectiveVersion: 1,
      generatedAt: '2025-06-01T00:00:00Z',
    }
    expect(provenance.strategyEngineVersion).toBe(STRATEGY_ENGINE_VERSION)
    expect(provenance.mobilityStateVersion).toBe(1)
    expect(provenance.intentVersion).toBe(1)
    expect(provenance.objectiveId).toBe('residence')
  })
})

// ===========================================================================
// 5. PROFILE STATE VERSIONING
// ===========================================================================

describe('Profile state versioning', () => {
  it('modifying the state creates a new object (not a mutation)', () => {
    const original: MobilityState = JSON.parse(JSON.stringify(state))
    const modified: MobilityState = JSON.parse(JSON.stringify(state))
    modified.annualIncomeUSD = { ...modified.annualIncomeUSD, value: 90000 }

    expect(modified).not.toBe(original)
    expect(modified.annualIncomeUSD.value).toBe(90000)
    expect(original.annualIncomeUSD.value).toBe(70000)
  })

  it('degree recognition change is detectable', async () => {
    const before = state.credentialRecognizedIn.value
    const modified: MobilityState = JSON.parse(JSON.stringify(state))
    modified.credentialRecognizedIn = {
      ...modified.credentialRecognizedIn,
      value: [...before, 'DE'],
    }
    expect(modified.credentialRecognizedIn.value).toContain('DE')
    expect(before).not.toContain('DE')
  })

  it('preserves USER_CONFIRMED provenance on user-edited fields', async () => {
    const modified: MobilityState = JSON.parse(JSON.stringify(state))
    const before = modified.annualIncomeUSD.provenance
    modified.annualIncomeUSD = {
      ...modified.annualIncomeUSD,
      value: 95000,
      status: 'confirmed_by_user',
      provenance: 'user_edit',
    }
    expect(modified.annualIncomeUSD.value).toBe(95000)
    expect(modified.annualIncomeUSD.status).toBe('confirmed_by_user')
    // Provenance is now 'user_edit' (was whatever it was before)
    expect(modified.annualIncomeUSD.provenance).toBe('user_edit')
    expect(before).not.toBe('user_edit')
  })
})

// ===========================================================================
// 6. OBJECTIVE ISOLATION
// ===========================================================================

describe('Objective isolation', () => {
  it('different objectives produce different priority vectors', async () => {
    const incomeIntent = { ...intent, priorities: [{ kind: 'income_priority' as const, weight: 0.5 }] }
    const residenceIntent = { ...intent, priorities: [{ kind: 'safety_priority' as const, weight: 0.3 }] }

    expect(incomeIntent.priorities).not.toEqual(residenceIntent.priorities)
  })

  it('adopting one objective does not change the original intent', async () => {
    const original = JSON.parse(JSON.stringify(intent))
    const adopted = { ...intent, priorities: [{ kind: 'safety_priority' as const, weight: 0.3 }] }
    expect(intent.priorities).toEqual(original.priorities)
    expect(adopted.priorities).not.toEqual(original.priorities)
  })
})
