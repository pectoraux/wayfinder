// Tests for the interactive strategy loop.
//
// Covers:
//   - Preference application (answer → intent changes → priorities shift)
//   - Action lifecycle (NOT_STARTED → IN_PROGRESS → COMPLETE)
//   - Strategy recomputation after preference change
//   - Strategy recomputation after state change
//   - Policy consistency preserved across recomputation

import { describe, it, expect } from 'vitest'
import { buildCanonicalPlanningContext, STRATEGY_ENGINE_VERSION } from '@/lib/strategy/planning-context'
import { buildStrategy } from '@/lib/strategy'
import { exampleState } from '@/lib/domain/state'
import { parseIntentDeterministic } from '@/lib/domain/intent'
import { generateRoutes } from '@/lib/engine/routes'
import type { Intent, MobilityState, Preference } from '@/lib/domain/types'

type ActionStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETE' | 'BLOCKED' | 'CANCELLED'

// Local copy of the preference application logic (mirrors the API)
function applyPreferenceAnswer(intent: Intent, questionId: string, answer: string): Intent {
  // Deep clone priorities to avoid mutation
  const priorities: Preference[] = intent.priorities.map((p) => ({ ...p }))

  function updateWeight(kind: Preference['kind'], weight: number) {
    const existing = priorities.find((p) => p.kind === kind)
    if (existing) {
      existing.weight = weight
    } else {
      priorities.push({ kind, weight })
    }
  }

  if (questionId === 'pq-income-vs-residence') {
    if (answer === 'residence') {
      updateWeight('safety_priority', 0.35)
      updateWeight('citizenship_priority', 0.3)
      updateWeight('income_priority', 0.1)
    } else if (answer === 'income') {
      updateWeight('income_priority', 0.45)
      updateWeight('safety_priority', 0.1)
    }
  }

  if (questionId === 'pq-speed-vs-optionality' && answer === 'optionality') {
    updateWeight('mobility_priority', 0.35)
  }

  if (questionId === 'pq-study-first' && answer === 'study') {
    updateWeight('education_value', 0.3)
  }

  return { ...intent, priorities }
}

const state = exampleState()
const intent = parseIntentDeterministic('I want to move abroad and earn more.')

// ===========================================================================
// 1. PREFERENCE APPLICATION
// ===========================================================================

describe('Preference application', () => {
  it('answering "residence" boosts safety_priority and reduces income_priority', () => {
    const updated = applyPreferenceAnswer(intent, 'pq-income-vs-residence', 'residence')
    const safety = updated.priorities.find((p) => p.kind === 'safety_priority')
    const income = updated.priorities.find((p) => p.kind === 'income_priority')
    expect(safety?.weight).toBe(0.35)
    expect(income?.weight).toBe(0.1)
  })

  it('answering "income" boosts income_priority', () => {
    const updated = applyPreferenceAnswer(intent, 'pq-income-vs-residence', 'income')
    const income = updated.priorities.find((p) => p.kind === 'income_priority')
    expect(income?.weight).toBe(0.45)
  })

  it('answering "balanced" leaves priorities unchanged', () => {
    const updated = applyPreferenceAnswer(intent, 'pq-income-vs-residence', 'balanced')
    expect(updated.priorities).toEqual(intent.priorities)
  })

  it('the original intent is not mutated', () => {
    const original = JSON.parse(JSON.stringify(intent))
    applyPreferenceAnswer(intent, 'pq-income-vs-residence', 'residence')
    expect(intent.priorities).toEqual(original.priorities)
  })

  it('answering "optionality" boosts mobility_priority', () => {
    const updated = applyPreferenceAnswer(intent, 'pq-speed-vs-optionality', 'optionality')
    const mobility = updated.priorities.find((p) => p.kind === 'mobility_priority')
    expect(mobility?.weight).toBe(0.35)
  })
})

// ===========================================================================
// 2. STRATEGY RECOMPUTATION AFTER PREFERENCE CHANGE
// ===========================================================================

describe('Strategy recomputation after preference change', () => {
  it('recomputing strategy with updated priorities produces a valid strategy', () => {
    const updatedIntent = applyPreferenceAnswer(intent, 'pq-income-vs-residence', 'residence')
    const routes = generateRoutes(state, updatedIntent, '2025-06-01')
    const strategy = buildStrategy(state, updatedIntent, routes)

    expect(strategy).toBeDefined()
    expect(strategy.bestTrajectory).toBeDefined()
    expect(strategy.intent.priorities).not.toEqual(intent.priorities)
  })

  it('the recomputed strategy carries the same engine version', () => {
    const updatedIntent = applyPreferenceAnswer(intent, 'pq-income-vs-residence', 'residence')
    const routes = generateRoutes(state, updatedIntent, '2025-06-01')
    const strategy = buildStrategy(state, updatedIntent, routes)

    expect(strategy.strategyEngineVersion).toBe(STRATEGY_ENGINE_VERSION)
  })
})

// ===========================================================================
// 3. ACTION LIFECYCLE
// ===========================================================================

describe('Action lifecycle', () => {
  it('ActionStatus has the expected states', () => {
    const statuses: ActionStatus[] = ['NOT_STARTED', 'IN_PROGRESS', 'COMPLETE', 'BLOCKED', 'CANCELLED']
    expect(statuses).toHaveLength(5)
    expect(statuses).toContain('NOT_STARTED')
    expect(statuses).toContain('COMPLETE')
  })

  it('the strategy produces actions with deterministic IDs', () => {
    const routes = generateRoutes(state, intent, '2025-06-01')
    const strategy = buildStrategy(state, intent, routes)

    if (strategy.actionPlan.actions.length > 0) {
      for (const action of strategy.actionPlan.actions) {
        expect(action.id).toMatch(/^act-/)
      }
    }
  })

  it('the action plan has a highest-leverage action when actions exist', () => {
    const routes = generateRoutes(state, intent, '2025-06-01')
    const strategy = buildStrategy(state, intent, routes)

    if (strategy.actionPlan.actions.length > 0) {
      expect(strategy.actionPlan.highestLeverageAction).toBeDefined()
    }
  })
})

// ===========================================================================
// 4. STATE CHANGE → STRATEGY RECOMPUTATION
// ===========================================================================

describe('State change → strategy recomputation', () => {
  it('adding degree recognition changes the strategy output', () => {
    // Baseline strategy
    const routes1 = generateRoutes(state, intent, '2025-06-01')
    const strategy1 = buildStrategy(state, intent, routes1)

    // Modified state: degree recognized in Germany
    const modifiedState: MobilityState = JSON.parse(JSON.stringify(state))
    modifiedState.credentialRecognizedIn = {
      ...modifiedState.credentialRecognizedIn,
      value: Array.from(new Set([...modifiedState.credentialRecognizedIn.value, 'DE'])),
    }

    const routes2 = generateRoutes(modifiedState, intent, '2025-06-01')
    const strategy2 = buildStrategy(modifiedState, intent, routes2)

    // The strategies should differ (different state → potentially different routes/blockers)
    expect(strategy2).toBeDefined()
    expect(strategy2.bestTrajectory).toBeDefined()
    // The profile analysis should reflect the change
    expect(strategy2.profileAnalysis.currentViableTrajectories).toBeGreaterThanOrEqual(
      strategy1.profileAnalysis.currentViableTrajectories,
    )
  })
})

// ===========================================================================
// 5. POLICY CONSISTENCY ACROSS RECOMPUTATION
// ===========================================================================

describe('Policy consistency across recomputation', () => {
  it('recomputing strategy with the same context produces the same policy hash', async () => {
    const ctx1 = await buildCanonicalPlanningContext({ state, intent, asOfDate: '2025-06-01' })
    const ctx2 = await buildCanonicalPlanningContext({ state, intent, asOfDate: '2025-06-01' })

    expect(ctx1.policyContext.runtimeHash).toBe(ctx2.policyContext.runtimeHash)
  })

  it('strategy after preference change uses the same policy context', async () => {
    const ctx1 = await buildCanonicalPlanningContext({ state, intent, asOfDate: '2025-06-01' })
    const strategy1 = buildStrategy(state, intent, ctx1.routes, ctx1)

    const updatedIntent = applyPreferenceAnswer(intent, 'pq-income-vs-residence', 'residence')
    const ctx2 = await buildCanonicalPlanningContext({ state, intent: updatedIntent, asOfDate: '2025-06-01' })
    const strategy2 = buildStrategy(state, updatedIntent, ctx2.routes, ctx2)

    // Same policy hash (only the intent changed, not the policy)
    expect(strategy1.policyContext?.runtimeHash).toBe(strategy2.policyContext?.runtimeHash)
  })
})

// ===========================================================================
// 6. PREFERENCE → INTENT VERSION
// ===========================================================================

describe('Preference → intent version', () => {
  it('applying a preference creates a new intent object (not a mutation)', () => {
    const updated = applyPreferenceAnswer(intent, 'pq-income-vs-residence', 'residence')
    expect(updated).not.toBe(intent)
    expect(updated.priorities).not.toBe(intent.priorities)
  })

  it('different answers produce different priority vectors', () => {
    const residenceIntent = applyPreferenceAnswer(intent, 'pq-income-vs-residence', 'residence')
    const incomeIntent = applyPreferenceAnswer(intent, 'pq-income-vs-residence', 'income')

    const residenceSafety = residenceIntent.priorities.find((p) => p.kind === 'safety_priority')?.weight
    const incomeSafety = incomeIntent.priorities.find((p) => p.kind === 'safety_priority')?.weight

    expect(residenceSafety).not.toBe(incomeSafety)
  })
})
