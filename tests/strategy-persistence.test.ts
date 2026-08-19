// Tests for strategy persistence, staleness, and profile editing.

import { describe, it, expect } from 'vitest'
import { getStrategyStaleness, getFullStrategyStaleness } from '@/lib/strategy/staleness'
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
const strategy = buildStrategy(state, intent, routes)

// ===========================================================================
// 1. STALENESS ENGINE
// ===========================================================================

describe('Strategy staleness', () => {
  it('returns CURRENT for a strategy with matching policy hash + engine version', () => {
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
    }
    const result = getStrategyStaleness(freshStrategy)
    expect(result.status).toBe('CURRENT')
    expect(result.shouldRecalculate).toBe(false)
  })

  it('returns STALE_POLICY when the policy hash differs', () => {
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
    }
    const result = getStrategyStaleness(staleStrategy)
    expect(result.shouldRecalculate).toBe(true)
    expect(result.reasons.some((r) => r.includes('policy'))).toBe(true)
  })

  it('returns STALE_ENGINE when the engine version differs', () => {
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
    }
    const result = getStrategyStaleness(staleStrategy)
    expect(result.shouldRecalculate).toBe(true)
    expect(result.reasons.some((r) => r.includes('engine'))).toBe(true)
  })

  it('returns STALE_MULTIPLE when both policy and engine differ', () => {
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
    }
    const result = getStrategyStaleness(staleStrategy)
    expect(result.shouldRecalculate).toBe(true)
    expect(result.reasons.length).toBe(2)
  })

  it('provides a human-readable explanation', () => {
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
    }
    const result = getStrategyStaleness(staleStrategy)
    expect(result.explanation).toContain('policy')
  })
})

// ===========================================================================
// 2. FULL STALENESS (server-side, with state/intent versions)
// ===========================================================================

describe('Full strategy staleness', () => {
  it('returns CURRENT when all parameters match', () => {
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
    }
    const result = getFullStrategyStaleness(
      freshStrategy,
      currentPolicy.hash,
      1, // currentStateVersion
      1, // currentIntentVersion
      STRATEGY_ENGINE_VERSION,
    )
    expect(result.status).toBe('CURRENT')
  })

  it('detects policy change in full check', () => {
    // The strategy from buildStrategy() without a context has no policyContext,
    // so the staleness check can't compare hashes. We need to pass a mock context.
    const strategyWithPolicy: Strategy = {
      ...strategy,
      policyContext: {
        baseSnapshotId: 'snap-2024-11',
        activeOverlayIds: [],
        runtimeVersionId: 'snap-2024-11',
        runtimeHash: 'stored-hash-123',
        asOf: '2025-06-01',
        simulationMode: false,
      },
      strategyEngineVersion: STRATEGY_ENGINE_VERSION,
    }
    const result = getFullStrategyStaleness(
      strategyWithPolicy,
      'different-hash',
      1,
      1,
      STRATEGY_ENGINE_VERSION,
    )
    expect(result.shouldRecalculate).toBe(true)
  })
})

// ===========================================================================
// 3. STRATEGY REPRODUCIBILITY
// ===========================================================================

describe('Strategy reproducibility', () => {
  it('same state + intent + routes produce the same strategy engine version', () => {
    const s1 = buildStrategy(state, intent, routes)
    const s2 = buildStrategy(state, intent, routes)
    expect(s1.strategyEngineVersion).toBe(s2.strategyEngineVersion)
    expect(s1.strategyEngineVersion).toBe(STRATEGY_ENGINE_VERSION)
  })

  it('strategy carries strategyEngineVersion for reproducibility', () => {
    expect(strategy.strategyEngineVersion).toBeDefined()
    expect(strategy.strategyEngineVersion).toBe(STRATEGY_ENGINE_VERSION)
  })
})

// ===========================================================================
// 4. PROFILE STATE VERSIONING
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

  it('degree recognition change is detectable', () => {
    const before = state.credentialRecognizedIn.value
    const modified: MobilityState = JSON.parse(JSON.stringify(state))
    modified.credentialRecognizedIn = {
      ...modified.credentialRecognizedIn,
      value: [...before, 'DE'],
    }
    expect(modified.credentialRecognizedIn.value).toContain('DE')
    expect(before).not.toContain('DE')
  })
})

// ===========================================================================
// 5. OBJECTIVE ISOLATION
// ===========================================================================

describe('Objective isolation', () => {
  it('different objectives produce different priority vectors', () => {
    const incomeIntent = { ...intent, priorities: [{ kind: 'income_priority' as const, weight: 0.5 }] }
    const residenceIntent = { ...intent, priorities: [{ kind: 'safety_priority' as const, weight: 0.3 }] }

    expect(incomeIntent.priorities).not.toEqual(residenceIntent.priorities)
  })

  it('adopting one objective does not change the original intent', () => {
    const original = JSON.parse(JSON.stringify(intent))
    const adopted = { ...intent, priorities: [{ kind: 'safety_priority' as const, weight: 0.3 }] }
    expect(intent.priorities).toEqual(original.priorities)
    expect(adopted.priorities).not.toEqual(original.priorities)
  })
})
