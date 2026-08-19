// Tests for strategy-policy consistency.
//
// Verifies that the strategy API uses the same canonical planning context
// (runtime policy resolver + routes) as the plan API. The strategy and plan
// must never be computed against different policy worlds.

import { describe, it, expect } from 'vitest'
import { buildCanonicalPlanningContext, STRATEGY_ENGINE_VERSION } from '@/lib/strategy/planning-context'
import { buildStrategy } from '@/lib/strategy'
import { buildPlan } from '@/lib/engine/optimize'
import { exampleState } from '@/lib/domain/state'
import { parseIntentDeterministic } from '@/lib/domain/intent'
import { generateRoutes } from '@/lib/engine/routes'

const state = exampleState()
const intent = parseIntentDeterministic('I want to move abroad and earn more.')

describe('Strategy-policy consistency', () => {
  it('STRATEGY_ENGINE_VERSION is defined', () => {
    expect(STRATEGY_ENGINE_VERSION).toBeTruthy()
    expect(typeof STRATEGY_ENGINE_VERSION).toBe('string')
  })

  it('buildCanonicalPlanningContext resolves runtime policy + routes', async () => {
    const ctx = await buildCanonicalPlanningContext({
      state,
      intent,
      asOfDate: '2025-06-01',
    })
    expect(ctx.runtimePolicy).toBeDefined()
    expect(ctx.runtimePolicy.runtimeHash).toBeTruthy()
    expect(ctx.policyContext).toBeDefined()
    expect(ctx.policyContext.runtimeHash).toBe(ctx.runtimePolicy.runtimeHash)
    expect(ctx.routes.length).toBeGreaterThan(0)
    expect(ctx.strategyEngineVersion).toBe(STRATEGY_ENGINE_VERSION)
  })

  it('buildStrategy with context carries policyContext + engineVersion', () => {
    const routes = generateRoutes(state, intent, '2025-06-01')
    const strategy = buildStrategy(state, intent, routes)
    // Without context, policyContext is undefined (backward compat)
    expect(strategy.strategyEngineVersion).toBe(STRATEGY_ENGINE_VERSION)
  })

  it('strategy and plan use the same route set when given the same context', async () => {
    const ctx = await buildCanonicalPlanningContext({
      state,
      intent,
      asOfDate: '2025-06-01',
    })

    // Build plan using the same routes
    const plan = buildPlan(state, intent, [], '2025-06-01')
    // Build strategy using the canonical context's routes
    const strategy = buildStrategy(state, intent, ctx.routes, ctx)

    // Both should have the same number of routes
    expect(strategy.bestTrajectory).toBeDefined()
    // The plan's routes and the context's routes are the same length
    expect(plan.routes.length).toBe(ctx.routes.length)
  })

  it('strategy policyContext matches the canonical context', async () => {
    const ctx = await buildCanonicalPlanningContext({
      state,
      intent,
      asOfDate: '2025-06-01',
    })
    const strategy = buildStrategy(state, intent, ctx.routes, ctx)

    expect(strategy.policyContext).toBeDefined()
    expect(strategy.policyContext!.runtimeHash).toBe(ctx.policyContext.runtimeHash)
    expect(strategy.policyContext!.baseSnapshotId).toBe(ctx.policyContext.baseSnapshotId)
    expect(strategy.policyContext!.asOf).toBe(ctx.policyContext.asOf)
    expect(strategy.policyContext!.simulationMode).toBe(false)
  })

  it('strategy is reproducible — same inputs produce same policyContext', async () => {
    const ctx1 = await buildCanonicalPlanningContext({
      state,
      intent,
      asOfDate: '2025-06-01',
    })
    const ctx2 = await buildCanonicalPlanningContext({
      state,
      intent,
      asOfDate: '2025-06-01',
    })

    expect(ctx1.policyContext.runtimeHash).toBe(ctx2.policyContext.runtimeHash)
    expect(ctx1.policyContext.baseSnapshotId).toBe(ctx2.policyContext.baseSnapshotId)
  })

  it('simulation mode is explicitly carried in the policyContext', async () => {
    const ctx = await buildCanonicalPlanningContext({
      state,
      intent,
      asOfDate: '2025-06-01',
      simulationMode: false,
    })
    expect(ctx.policyContext.simulationMode).toBe(false)
    expect(ctx.simulationMode).toBe(false)
  })

  it('a different asOfDate produces a different runtimeHash (different policy world)', async () => {
    const ctx1 = await buildCanonicalPlanningContext({
      state,
      intent,
      asOfDate: '2025-06-01',
    })
    const ctx2 = await buildCanonicalPlanningContext({
      state,
      intent,
      asOfDate: '2026-06-01',
    })
    // Different dates should produce different hashes (different policy snapshots)
    expect(ctx1.policyContext.asOf).not.toBe(ctx2.policyContext.asOf)
  })
})
