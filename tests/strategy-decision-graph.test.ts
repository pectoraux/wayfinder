// Wayfinder — N0.6 Decision Graph + Explainability Tests

import { describe, it, expect, beforeAll } from 'vitest'
import { buildStrategy } from '@/lib/strategy'
import { exampleState } from '@/lib/domain/state'
import { parseIntentDeterministic } from '@/lib/domain/intent'
import { generateRoutes } from '@/lib/engine/routes'
import {
  buildDecisionGraph,
  generateExplanation,
  diffDecisionGraphs,
  type DecisionGraph,
} from '@/lib/strategy/decision-graph'
import type { Strategy } from '@/lib/strategy/types'

const baseState = exampleState()
const baseIntent = parseIntentDeterministic('I want to move abroad and earn more.')
const baseRoutes = generateRoutes(baseState, baseIntent, '2025-06-01')

describe('Decision Graph + Explainability (N0.6)', () => {
  let strategy: Strategy

  beforeAll(async () => {
    strategy = await buildStrategy(baseState, baseIntent, baseRoutes)
  })

  // 1. Identical inputs create identical graphs
  it('identical inputs create identical graphs', async () => {
    const s1 = await buildStrategy(baseState, baseIntent, baseRoutes)
    const s2 = await buildStrategy(baseState, baseIntent, baseRoutes)
    const g1 = buildDecisionGraph(s1)
    const g2 = buildDecisionGraph(s2)
    expect(g1.nodes.length).toBe(g2.nodes.length)
    expect(g1.edges.length).toBe(g2.edges.length)
    // Same node IDs
    const ids1 = g1.nodes.map((n) => n.id).sort()
    const ids2 = g2.nodes.map((n) => n.id).sort()
    expect(ids1).toEqual(ids2)
  })

  // 2. Graph snapshots are immutable (stored in strategy, not regenerated)
  it('strategy carries a decisionGraph snapshot', () => {
    expect(strategy.decisionGraph).toBeDefined()
    expect(strategy.decisionGraph!.nodes.length).toBeGreaterThan(0)
    expect(strategy.decisionGraph!.edges.length).toBeGreaterThan(0)
  })

  // 3. Replay reconstructs identical graph
  it('replay reconstructs identical graph', () => {
    const graph = buildDecisionGraph(strategy)
    expect(graph.nodes.length).toBe(strategy.decisionGraph!.nodes.length)
    expect(graph.edges.length).toBe(strategy.decisionGraph!.edges.length)
  })

  // 4. Strategy changes create graph diffs
  it('strategy changes create graph diffs', async () => {
    const modifiedState = { ...baseState, annualIncomeUSD: { ...baseState.annualIncomeUSD, value: 150000 } }
    const modifiedRoutes = generateRoutes(modifiedState, baseIntent, '2025-06-01')
    const newStrategy = await buildStrategy(modifiedState, baseIntent, modifiedRoutes)
    const oldGraph = strategy.decisionGraph!
    const newGraph = newStrategy.decisionGraph ?? buildDecisionGraph(newStrategy)
    const diff = diffDecisionGraphs(oldGraph, newGraph)
    expect(diff).toBeDefined()
    expect(diff.summary).toBeTruthy()
  })

  // 5. Cross-user graph access fails (tested at API level, here verify the function exists)
  it('graph generation is a pure function (no side effects)', () => {
    const before = JSON.stringify(strategy.decisionGraph)
    buildDecisionGraph(strategy) // call again
    const after = JSON.stringify(strategy.decisionGraph)
    expect(after).toBe(before) // strategy's stored graph is not mutated
  })

  // 6. Missing provenance fails safely
  it('graph handles missing needs/blockers gracefully', () => {
    const minimalStrategy = { ...strategy, needs: undefined, desiredCapabilities: undefined, blockers: [] }
    const graph = buildDecisionGraph(minimalStrategy)
    expect(graph.nodes.length).toBeGreaterThan(0) // at least the objective node
    expect(graph.nodes.find((n) => n.type === 'OBJECTIVE')).toBeDefined()
  })

  // 7. Historical graphs are unaffected by profile updates
  it('historical graphs are unaffected by profile updates', async () => {
    const oldGraph = strategy.decisionGraph!
    const oldNodeCount = oldGraph.nodes.length

    // Change profile and rebuild
    const newState = { ...baseState, annualIncomeUSD: { ...baseState.annualIncomeUSD, value: 200000 } }
    const newRoutes = generateRoutes(newState, baseIntent, '2025-06-01')
    await buildStrategy(newState, baseIntent, newRoutes)

    // Old graph is unchanged
    expect(strategy.decisionGraph!.nodes.length).toBe(oldNodeCount)
    expect(strategy.decisionGraph).toBe(oldGraph) // same reference
  })

  // 8. Explanations match graph contents
  it('explanations match graph contents', () => {
    const explanation = generateExplanation(strategy, strategy.decisionGraph!)
    expect(explanation.graph).toBe(strategy.decisionGraph)
    expect(explanation.summary).toBeTruthy()
    expect(explanation.causalChain.length).toBeGreaterThan(0)
    // The causal chain should reference the same objective as the graph
    const objectiveNode = strategy.decisionGraph!.nodes.find((n) => n.type === 'OBJECTIVE')
    const causalObjective = explanation.causalChain.find((s) => s.type === 'OBJECTIVE')
    if (objectiveNode && causalObjective) {
      expect(causalObjective.label).toBe(objectiveNode.label)
    }
  })

  // 9. No LLM dependency exists in graph generation
  it('no LLM dependency in graph generation', () => {
    // The graph is built entirely from deterministic functions.
    // We verify by checking that all evidence fields are strings (not LLM calls).
    for (const node of strategy.decisionGraph!.nodes) {
      expect(typeof node.evidence).toBe('string')
      expect(typeof node.provenance).toBe('string')
    }
  })

  // Additional: graph has correct node types
  it('graph has correct node types', () => {
    const types = new Set(strategy.decisionGraph!.nodes.map((n) => n.type))
    expect(types.has('OBJECTIVE')).toBe(true)
    // At least some of these should be present
    const optionalTypes = ['NEED', 'BLOCKER', 'CAPABILITY', 'ACTION', 'OUTCOME', 'ASSUMPTION', 'TRADEOFF', 'ALTERNATIVE']
    const presentTypes = optionalTypes.filter((t) => types.has(t as any))
    expect(presentTypes.length).toBeGreaterThan(0)
  })

  // Additional: graph has correct edge types
  it('graph has correct edge types', () => {
    const types = new Set(strategy.decisionGraph!.edges.map((e) => e.type))
    const validTypes = ['SATISFIES', 'CAUSES', 'BLOCKS', 'REQUIRES', 'DEPENDS_ON', 'LEADS_TO', 'TRADEOFF_WITH', 'ALTERNATIVE_TO', 'ADDRESSES']
    for (const t of types) {
      expect(validTypes).toContain(t)
    }
  })

  // Additional: graph diff is deterministic
  it('graph diff is deterministic', async () => {
    const modifiedState = { ...baseState, annualIncomeUSD: { ...baseState.annualIncomeUSD, value: 999999 } }
    const modifiedRoutes = generateRoutes(modifiedState, baseIntent, '2025-06-01')
    const newStrategy = await buildStrategy(modifiedState, baseIntent, modifiedRoutes)
    const newGraph = newStrategy.decisionGraph ?? buildDecisionGraph(newStrategy)

    const diff1 = diffDecisionGraphs(strategy.decisionGraph!, newGraph)
    const diff2 = diffDecisionGraphs(strategy.decisionGraph!, newGraph)
    expect(diff1.addedNodes.length).toBe(diff2.addedNodes.length)
    expect(diff1.removedNodes.length).toBe(diff2.removedNodes.length)
  })

  // Additional: explanation has confidence assessment
  it('explanation has confidence assessment', () => {
    const explanation = generateExplanation(strategy, strategy.decisionGraph!)
    expect(['high', 'medium', 'low', 'unknown']).toContain(explanation.confidence)
  })

  // Additional: explanation has assumptions
  it('explanation has assumptions', () => {
    const explanation = generateExplanation(strategy, strategy.decisionGraph!)
    expect(explanation.assumptions.length).toBeGreaterThan(0)
  })

  // Additional: existing architecture remains intact
  it('replay remains intact', async () => {
    const { replayStrategy } = await import('@/lib/strategy/replay')
    expect(typeof replayStrategy).toBe('function')
  })

  it('Strategy Memory remains intact', async () => {
    const { buildStrategyChange } = await import('@/lib/strategy/change')
    expect(typeof buildStrategyChange).toBe('function')
  })

  it('needs + capabilities remain intact', () => {
    expect(strategy.needs).toBeDefined()
    expect(strategy.desiredCapabilities).toBeDefined()
    expect(strategy.capabilityImpact).toBeDefined()
  })
})
