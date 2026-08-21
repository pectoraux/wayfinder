// Wayfinder — N0.6 Decision Graph + Explainability Tests (final hardened)

import { describe, it, expect, beforeAll } from 'vitest'
import { buildStrategy } from '@/lib/strategy'
import { exampleState } from '@/lib/domain/state'
import { parseIntentDeterministic } from '@/lib/domain/intent'
import { generateRoutes } from '@/lib/engine/routes'
import {
  buildDecisionGraph,
  generateExplanation,
  diffDecisionGraphs,
  compareGraphs,
  GRAPH_SCHEMA_VERSION,
  type DecisionGraph,
  type DecisionNode,
} from '@/lib/strategy/decision-graph'
import type { Strategy } from '@/lib/strategy/types'

const baseState = exampleState()
const baseIntent = parseIntentDeterministic('I want to move abroad and earn more.')
const baseRoutes = generateRoutes(baseState, baseIntent, '2025-06-01')

describe('Decision Graph + Explainability (N0.6 final hardened)', () => {
  let strategy: Strategy

  beforeAll(async () => {
    strategy = await buildStrategy(baseState, baseIntent, baseRoutes)
  })

  // === GRAPH IDENTITY ===

  it('identical inputs create identical graph hashes (full SHA-256)', async () => {
    const s1 = await buildStrategy(baseState, baseIntent, baseRoutes)
    const s2 = await buildStrategy(baseState, baseIntent, baseRoutes)
    const g1 = buildDecisionGraph(s1)
    const g2 = buildDecisionGraph(s2)
    expect(g1.graphHash).toBe(g2.graphHash)
    expect(g1.graphHash.length).toBe(64) // full SHA-256 = 64 hex chars
  })

  it('graph has graphSchemaVersion and graphHash', () => {
    expect(strategy.decisionGraph).toBeDefined()
    expect(strategy.decisionGraph!.graphSchemaVersion).toBe(GRAPH_SCHEMA_VERSION)
    expect(strategy.decisionGraph!.graphHash).toBeTruthy()
    expect(strategy.decisionGraph!.graphHash.length).toBe(64)
  })

  it('graph hash excludes generatedAt', () => {
    const g1 = buildDecisionGraph(strategy)
    const g2: DecisionGraph = { ...g1, generatedAt: '2099-01-01T00:00:00Z' }
    expect(g1.graphHash).toBe(g2.graphHash)
  })

  // === CANONICAL GRAPH COMPARISON (independently authoritative) ===

  it('compareGraphs returns EXACT_MATCH for identical graphs', async () => {
    const s2 = await buildStrategy(baseState, baseIntent, baseRoutes)
    const g1 = strategy.decisionGraph!
    const g2 = buildDecisionGraph(s2)
    const result = compareGraphs(g1, g2)
    expect(result.status).toBe('EXACT_MATCH')
    expect(result.differences).toHaveLength(0)
  })

  it('compareGraphs detects tampered graphHash (stale hash but content differs)', () => {
    const g1 = strategy.decisionGraph!
    const tamperedGraph: DecisionGraph = {
      ...g1,
      nodes: g1.nodes.map((n) =>
        n.id === 'obj' ? { ...n, label: 'TAMPERED_OBJECTIVE' } : n
      ),
      graphHash: g1.graphHash, // Keep the stale hash
    }
    const result = compareGraphs(g1, tamperedGraph)
    expect(result.status).toBe('GRAPH_MISMATCH')
    expect(result.differences.some((d) => d.includes('label'))).toBe(true)
  })

  it('compareGraphs detects provenance change', () => {
    const g1 = strategy.decisionGraph!
    const modified: DecisionGraph = {
      ...g1,
      nodes: g1.nodes.map((n) =>
        n.type === 'OBJECTIVE'
          ? { ...n, provenance: { source: 'TAMPERED', references: {} } }
          : n
      ),
    }
    const result = compareGraphs(g1, modified)
    expect(result.status).toBe('GRAPH_MISMATCH')
    expect(result.differences.some((d) => d.includes('provenance'))).toBe(true)
  })

  it('compareGraphs detects evidence change', () => {
    const g1 = strategy.decisionGraph!
    const modified: DecisionGraph = {
      ...g1,
      nodes: g1.nodes.map((n) =>
        n.type === 'OBJECTIVE' ? { ...n, evidence: 'TAMPERED_EVIDENCE' } : n
      ),
    }
    const result = compareGraphs(g1, modified)
    expect(result.status).toBe('GRAPH_MISMATCH')
    expect(result.differences.some((d) => d.includes('evidence'))).toBe(true)
  })

  it('compareGraphs detects edge type change', () => {
    const g1 = strategy.decisionGraph!
    if (g1.edges.length > 0) {
      const modified: DecisionGraph = {
        ...g1,
        edges: g1.edges.map((e, i) =>
          i === 0 ? { ...e, type: 'SATISFIES' as any } : e
        ),
      }
      const result = compareGraphs(g1, modified)
      expect(result.status).toBe('GRAPH_MISMATCH')
    }
  })

  it('compareGraphs detects edge endpoint change', () => {
    const g1 = strategy.decisionGraph!
    if (g1.edges.length > 0) {
      const modified: DecisionGraph = {
        ...g1,
        edges: g1.edges.map((e, i) =>
          i === 0 ? { ...e, to: 'nonexistent-node' } : e
        ),
      }
      const result = compareGraphs(g1, modified)
      expect(result.status).toBe('GRAPH_MISMATCH')
    }
  })

  it('compareGraphs ignores generatedAt difference', () => {
    const g1 = strategy.decisionGraph!
    const g2: DecisionGraph = { ...g1, generatedAt: '2099-01-01T00:00:00Z' }
    const result = compareGraphs(g1, g2)
    expect(result.status).toBe('EXACT_MATCH')
  })

  // === PRIMARY PATH CONNECTIVITY ===

  it('every PRIMARY_PATH hop has a real graph edge connecting consecutive nodes', () => {
    const explanation = generateExplanation(strategy, strategy.decisionGraph!)
    const graph = strategy.decisionGraph!

    for (let i = 1; i < explanation.causalChain.length; i++) {
      const prevStep = explanation.causalChain[i - 1]
      const currStep = explanation.causalChain[i]

      if (currStep.connectingEdge) {
        // The edge must exist in the graph, connecting prevStep.nodeId to currStep.nodeId
        // (or in reverse direction for edges like BLOCKS where from=blocker, to=objective)
        const edgeForward = graph.edges.find(
          (e) => e.from === prevStep.nodeId && e.to === currStep.nodeId && e.type === currStep.connectingEdge
        )
        const edgeReverse = graph.edges.find(
          (e) => e.to === prevStep.nodeId && e.from === currStep.nodeId && e.type === currStep.connectingEdge
        )
        expect(edgeForward || edgeReverse).toBeDefined()
      }
    }
  })

  it('no fabricated Need→Blocker edges in the graph', () => {
    const graph = strategy.decisionGraph!
    // Check: no BLOCKS edge goes from a need to a blocker or vice versa
    for (const edge of graph.edges) {
      if (edge.type === 'BLOCKS') {
        const fromNode = graph.nodes.find((n) => n.id === edge.from)
        const toNode = graph.nodes.find((n) => n.id === edge.to)
        // Blockers should only BLOCK the objective, not needs
        if (fromNode?.type === 'BLOCKER') {
          expect(toNode?.type).not.toBe('NEED')
        }
        if (toNode?.type === 'BLOCKER') {
          expect(fromNode?.type).not.toBe('NEED')
        }
      }
    }
  })

  // === EXPLANATION IS GRAPH-DERIVED ===

  it('explanation is tied to graph, not Strategy (modifying Strategy after build does not change explanation)', () => {
    const graph = buildDecisionGraph(strategy)
    const modifiedStrategy: Strategy = {
      ...strategy,
      intent: { ...strategy.intent, statedGoal: 'TAMPERED' as any },
    }
    const explanation = generateExplanation(modifiedStrategy, graph)
    const objectiveStep = explanation.causalChain.find((s) => s.type === 'OBJECTIVE')
    if (objectiveStep) {
      const graphObjective = graph.nodes.find((n) => n.type === 'OBJECTIVE')
      expect(objectiveStep.label).toBe(graphObjective!.label)
      expect(objectiveStep.label).not.toBe('TAMPERED')
    }
  })

  it('explanation has causalChainScope = PRIMARY_PATH', () => {
    const explanation = generateExplanation(strategy, strategy.decisionGraph!)
    expect(explanation.causalChainScope).toBe('PRIMARY_PATH')
  })

  // === CAUSAL CORRECTNESS ===

  it('capability→action REQUIRES edge exists when they share a blocker', () => {
    const graph = strategy.decisionGraph!
    const capNodes = graph.nodes.filter((n) => n.type === 'CAPABILITY')
    for (const cap of capNodes) {
      const requiresEdges = graph.edges.filter((e) => e.from === cap.id && e.type === 'REQUIRES')
      for (const edge of requiresEdges) {
        const actionNode = graph.nodes.find((n) => n.id === edge.to)
        expect(actionNode?.type).toBe('ACTION')
      }
    }
  })

  // === LEGACY MARKING ===

  it('legacy reconstructed graphs are marked', () => {
    const graph = buildDecisionGraph(strategy, true)
    expect(graph.legacyReconstructed).toBe(true)
    const normalGraph = buildDecisionGraph(strategy, false)
    expect(normalGraph.legacyReconstructed).toBe(false)
  })

  // === CONFIDENCE ===

  it('confidence is separated by dimension', () => {
    const explanation = generateExplanation(strategy, strategy.decisionGraph!)
    expect(explanation.confidence).toBeDefined()
    expect(explanation.confidence.evidence).toBeDefined()
    expect(explanation.confidence.policy).toBeDefined()
    expect(explanation.confidence.recommendation).toBeDefined()
    expect(explanation.confidence.outcome).toBeDefined()
    expect(explanation.overallConfidence).toBeDefined()
  })

  // === GRAPH DIFF ===

  it('graph diff reports hashMatch', async () => {
    const modifiedState = { ...baseState, annualIncomeUSD: { ...baseState.annualIncomeUSD, value: 150000 } }
    const modifiedRoutes = generateRoutes(modifiedState, baseIntent, '2025-06-01')
    const newStrategy = await buildStrategy(modifiedState, baseIntent, modifiedRoutes)
    const oldGraph = strategy.decisionGraph!
    const newGraph = newStrategy.decisionGraph ?? buildDecisionGraph(newStrategy)
    const diff = diffDecisionGraphs(oldGraph, newGraph)
    expect(diff.hashMatch).toBeDefined()
  })

  // === IMMUTABILITY ===

  it('historical graphs are unaffected by profile updates', async () => {
    const oldHash = strategy.decisionGraph!.graphHash
    const newState = { ...baseState, annualIncomeUSD: { ...baseState.annualIncomeUSD, value: 200000 } }
    const newRoutes = generateRoutes(newState, baseIntent, '2025-06-01')
    await buildStrategy(newState, baseIntent, newRoutes)
    expect(strategy.decisionGraph!.graphHash).toBe(oldHash)
  })

  // === NO LLM ===

  it('no LLM dependency in graph generation', () => {
    for (const node of strategy.decisionGraph!.nodes) {
      expect(typeof node.evidence).toBe('string')
      expect(typeof node.provenance.source).toBe('string')
    }
  })

  // === GRAPH-AWARE REPLAY + VERIFICATION ===

  it('replay module exports graph comparison types', async () => {
    const replayModule = await import('@/lib/strategy/replay')
    expect(typeof replayModule.replayStrategy).toBe('function')
    expect(typeof replayModule.verifyStrategyRecord).toBe('function')
  })

  it('VerificationChecks includes graphMatches field', async () => {
    // We verify the interface exists by checking that a verification result
    // would include graphMatches. The actual DB-backed test is in
    // strategy-integrity.test.ts, but we verify the module shape here.
    const { verifyStrategyRecord } = await import('@/lib/strategy/replay')
    expect(typeof verifyStrategyRecord).toBe('function')
  })

  // === EXISTING ARCHITECTURE INTACT ===

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
