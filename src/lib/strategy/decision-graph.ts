// Wayfinder — Decision Graph (N0.6)
//
// This module implements the explainable decision graph that answers:
//   "Why does this strategy exist?"
//
// The graph is:
//   - DETERMINISTIC: same inputs → same graph (no LLM in the reasoning path)
//   - IMMUTABLE: stored as a snapshot, never mutated
//   - REPLAYABLE: can be reconstructed from historical strategy inputs
//   - TRACEABLE: every node has provenance + evidence
//
// GRAPH STRUCTURE:
//
//   Objective → Need → Blocker → Capability → Action → Expected Outcome
//                                      ↑
//                                 Assumption
//                                 Tradeoff
//                                 Alternative
//
// The graph is a DAG (directed acyclic graph) — edges flow from objectives
// down to outcomes, with cross-references for tradeoffs and alternatives.

import type { Strategy, Trajectory, BlockerAnalysis, ActionPlan, Action } from '@/lib/strategy/types'
import type { NeedAssessment, DesiredCapability, CapabilityImpactSummary } from '@/lib/strategy/needs'
import type { Intent, MobilityState } from '@/lib/domain/types'

// ---------------------------------------------------------------------------
// Graph primitives
// ---------------------------------------------------------------------------

export type DecisionNodeType =
  | 'OBJECTIVE'
  | 'NEED'
  | 'BLOCKER'
  | 'CAPABILITY'
  | 'ACTION'
  | 'OUTCOME'
  | 'ASSUMPTION'
  | 'TRADEOFF'
  | 'ALTERNATIVE'

export type DecisionEdgeType =
  | 'SATISFIES'
  | 'CAUSES'
  | 'BLOCKS'
  | 'REQUIRES'
  | 'DEPENDS_ON'
  | 'LEADS_TO'
  | 'TRADEOFF_WITH'
  | 'ALTERNATIVE_TO'
  | 'ADDRESSES'

export interface DecisionNode {
  id: string
  type: DecisionNodeType
  label: string
  description: string
  /** Evidence backing this node (deterministic — no LLM). */
  evidence: string
  /** Provenance: where this node was derived from. */
  provenance: string
}

export interface DecisionEdge {
  from: string // node id
  to: string   // node id
  type: DecisionEdgeType
  label?: string
}

export interface DecisionGraph {
  nodes: DecisionNode[]
  edges: DecisionEdge[]
  /** When this graph was generated (ISO). */
  generatedAt: string
  /** The strategy engine version that generated this graph. */
  engineVersion: string
}

// ---------------------------------------------------------------------------
// Graph diff (for Strategy Memory integration)
// ---------------------------------------------------------------------------

export interface DecisionGraphDiff {
  /** Nodes added in the new graph. */
  addedNodes: DecisionNode[]
  /** Nodes removed from the old graph. */
  removedNodes: DecisionNode[]
  /** Nodes that changed (same id, different content). */
  changedNodes: Array<{ oldNode: DecisionNode; newNode: DecisionNode; changes: string[] }>
  /** Edges added. */
  addedEdges: DecisionEdge[]
  /** Edges removed. */
  removedEdges: DecisionEdge[]
  /** Human-readable summary. */
  summary: string
}

// ---------------------------------------------------------------------------
// Explanation (deterministic, no LLM)
// ---------------------------------------------------------------------------

export interface StrategyExplanation {
  /** The one-sentence summary. */
  summary: string
  /** The causal chain from objective to outcome. */
  causalChain: ExplanationStep[]
  /** Key assumptions the strategy relies on. */
  assumptions: string[]
  /** Alternatives that were considered but not chosen. */
  rejectedAlternatives: string[]
  /** Confidence assessment (deterministic). */
  confidence: 'high' | 'medium' | 'low' | 'unknown'
  /** The full decision graph. */
  graph: DecisionGraph
}

export interface ExplanationStep {
  type: DecisionNodeType
  label: string
  description: string
  /** Why this step follows from the previous one. */
  reasoning: string
}

// ---------------------------------------------------------------------------
// Deterministic graph generation
// ---------------------------------------------------------------------------

let nodeIdCounter = 0
function nextNodeId(prefix: string): string {
  return `${prefix}-${++nodeIdCounter}`
}

/**
 * Build a deterministic DecisionGraph from a Strategy.
 *
 * Same Strategy inputs → same graph structure (node IDs are deterministic
 * based on the node type + content hash, not a counter).
 *
 * The graph is built by walking the causal chain:
 *   Objective → Needs → Blockers → Capabilities → Actions → Outcomes
 * with cross-references for Assumptions, Tradeoffs, and Alternatives.
 */
export function buildDecisionGraph(strategy: Strategy): DecisionGraph {
  // Reset counter for determinism — we use content-based IDs
  const nodes: DecisionNode[] = []
  const edges: DecisionEdge[] = []

  // --- OBJECTIVE node ---
  const objectiveId = 'obj'
  const objectiveLabel = strategy.intent.statedGoal ?? 'unknown'
  nodes.push({
    id: objectiveId,
    type: 'OBJECTIVE',
    label: objectiveLabel,
    description: `The user's stated objective: ${objectiveLabel}`,
    evidence: strategy.intent.rawInput,
    provenance: 'Intent.statedGoal',
  })

  // --- NEED nodes ---
  const needs = strategy.needs
  if (needs) {
    for (const need of needs.needs) {
      const nodeId = `need-${hashString(need.label)}`
      nodes.push({
        id: nodeId,
        type: 'NEED',
        label: need.label,
        description: `Inferred need: ${need.label}`,
        evidence: need.evidence,
        provenance: 'NeedAssessment.needs',
      })
      edges.push({ from: objectiveId, to: nodeId, type: 'CAUSES', label: 'implies' })
    }
  }

  // --- BLOCKER nodes ---
  for (const blocker of strategy.blockers) {
    const nodeId = `blocker-${hashString(blocker.blockerId)}`
    nodes.push({
      id: nodeId,
      type: 'BLOCKER',
      label: blocker.label,
      description: blocker.reason,
      evidence: `Blocker category: ${blocker.category}, difficulty: ${blocker.difficulty}`,
      provenance: 'BlockerAnalysis',
    })
    // Blocker blocks the objective
    edges.push({ from: nodeId, to: objectiveId, type: 'BLOCKS', label: 'prevents' })

    // If there's a need, connect the blocker to it
    if (needs && needs.needs.length > 0) {
      const firstNeedId = `need-${hashString(needs.needs[0].label)}`
      edges.push({ from: nodeId, to: firstNeedId, type: 'BLOCKS', label: 'obstructs' })
    }
  }

  // --- CAPABILITY nodes ---
  for (const cap of strategy.desiredCapabilities ?? []) {
    const nodeId = `cap-${hashString(cap.capabilityId)}`
    nodes.push({
      id: nodeId,
      type: 'CAPABILITY',
      label: cap.label,
      description: `Required capability: ${cap.capabilityId}`,
      evidence: cap.triggers.map((t) => `${t.blockerLabel} (${t.trajectoryLabel})`).join('; '),
      provenance: 'DesiredCapability',
    })

    // Capability REQUIRES the blockers it addresses
    for (const trigger of cap.triggers) {
      const blockerNodeId = `blocker-${hashString(trigger.blockerId)}`
      edges.push({ from: nodeId, to: blockerNodeId, type: 'ADDRESSES', label: 'resolves' })
    }

    // Capability LEADS_TO outcomes (potential unlocks)
    for (const unlock of cap.potentialUnlocks) {
      const outcomeId = `outcome-${hashString(unlock.routeId)}`
      // Only add the outcome node if it doesn't already exist
      if (!nodes.find((n) => n.id === outcomeId)) {
        nodes.push({
          id: outcomeId,
          type: 'OUTCOME',
          label: unlock.routeLabel,
          description: `Potential outcome: ${unlock.routeLabel} (${unlock.remainingBlockers === 0 ? 'fully unlocked' : `${unlock.remainingBlockers} blockers remain`})`,
          evidence: `Route ${unlock.routeId}, country ${unlock.countryCode}`,
          provenance: 'DesiredCapability.potentialUnlocks',
        })
      }
      edges.push({ from: nodeId, to: outcomeId, type: 'LEADS_TO', label: 'could unlock' })
    }
  }

  // --- ACTION nodes ---
  for (const action of strategy.actionPlan.actions) {
    const nodeId = `action-${hashString(action.id)}`
    nodes.push({
      id: nodeId,
      type: 'ACTION',
      label: action.title,
      description: action.description,
      evidence: `Timeframe: ${action.timeframe}, impact: ${action.impact}, time-sensitive: ${action.timeSensitive}`,
      provenance: 'ActionPlan.actions',
    })

    // Action DEPENDS_ON the capability it addresses (if any)
    if (action.addressesBlockerId) {
      const blockerNodeId = `blocker-${hashString(action.addressesBlockerId)}`
      edges.push({ from: nodeId, to: blockerNodeId, type: 'ADDRESSES', label: 'addresses' })
    }

    // Action LEADS_TO the best trajectory
    if (strategy.bestTrajectory) {
      const outcomeId = `outcome-${hashString(strategy.bestTrajectory.id)}`
      if (!nodes.find((n) => n.id === outcomeId)) {
        nodes.push({
          id: outcomeId,
          type: 'OUTCOME',
          label: strategy.bestTrajectory.label,
          description: `Expected outcome: ${strategy.bestTrajectory.destinationStatus}`,
          evidence: `Trajectory ${strategy.bestTrajectory.id}, ${strategy.bestTrajectory.totalMonths} months, $${strategy.bestTrajectory.totalCostUSD}`,
          provenance: 'Strategy.bestTrajectory',
        })
      }
      edges.push({ from: nodeId, to: outcomeId, type: 'LEADS_TO', label: 'advances' })
    }

    // Action DEPENDS_ON other actions
    if (action.dependsOn) {
      for (const depId of action.dependsOn) {
        const depNodeId = `action-${hashString(depId)}`
        edges.push({ from: nodeId, to: depNodeId, type: 'DEPENDS_ON', label: 'depends on' })
      }
    }
  }

  // --- ASSUMPTION nodes ---
  const assumptions = extractAssumptions(strategy)
  for (const assumption of assumptions) {
    const nodeId = `assumption-${hashString(assumption)}`
    nodes.push({
      id: nodeId,
      type: 'ASSUMPTION',
      label: assumption,
      description: `Strategy assumption: ${assumption}`,
      evidence: 'Derived from strategy inputs + policy context',
      provenance: 'Strategy.explanation + Strategy.uncertainties',
    })
    // Assumption DEPENDS_ON the objective
    edges.push({ from: objectiveId, to: nodeId, type: 'DEPENDS_ON', label: 'assumes' })
  }

  // --- TRADEOFF nodes ---
  const tradeoffs = extractTradeoffs(strategy)
  for (const tradeoff of tradeoffs) {
    const nodeId = `tradeoff-${hashString(tradeoff.label)}`
    nodes.push({
      id: nodeId,
      type: 'TRADEOFF',
      label: tradeoff.label,
      description: tradeoff.description,
      evidence: tradeoff.evidence,
      provenance: 'Strategy.intentFrontier + Strategy.alternativeIntents',
    })
    edges.push({ from: objectiveId, to: nodeId, type: 'TRADEOFF_WITH', label: 'trades off' })
  }

  // --- ALTERNATIVE nodes ---
  for (const alt of strategy.alternativeTrajectories.slice(0, 3)) {
    const nodeId = `alt-${hashString(alt.id)}`
    nodes.push({
      id: nodeId,
      type: 'ALTERNATIVE',
      label: alt.label,
      description: `Alternative trajectory: ${alt.label}`,
      evidence: `${alt.totalMonths} months, $${alt.totalCostUSD}, ${alt.viable ? 'viable' : 'blocked'}`,
      provenance: 'Strategy.alternativeTrajectories',
    })
    // Alternative is ALTERNATIVE_TO the best trajectory
    if (strategy.bestTrajectory) {
      const bestOutcomeId = `outcome-${hashString(strategy.bestTrajectory.id)}`
      edges.push({ from: nodeId, to: bestOutcomeId, type: 'ALTERNATIVE_TO', label: 'alternative to' })
    }
  }

  return {
    nodes,
    edges,
    generatedAt: strategy.generatedAt,
    engineVersion: strategy.strategyEngineVersion ?? 'unknown',
  }
}

// ---------------------------------------------------------------------------
// Explanation generation (deterministic, no LLM)
// ---------------------------------------------------------------------------

export function generateExplanation(strategy: Strategy, graph: DecisionGraph): StrategyExplanation {
  const causalChain = buildCausalChain(strategy, graph)
  const assumptions = extractAssumptions(strategy)
  const rejectedAlternatives = extractRejectedAlternatives(strategy)
  const confidence = assessConfidence(strategy)

  const summary = buildSummary(strategy)

  return {
    summary,
    causalChain,
    assumptions,
    rejectedAlternatives,
    confidence,
    graph,
  }
}

function buildCausalChain(strategy: Strategy, graph: DecisionGraph): ExplanationStep[] {
  const steps: ExplanationStep[] = []

  // 1. Objective
  steps.push({
    type: 'OBJECTIVE',
    label: strategy.intent.statedGoal,
    description: `Your objective is ${strategy.intent.statedGoal}.`,
    reasoning: 'This is what you stated you want to accomplish.',
  })

  // 2. Needs
  if (strategy.needs?.needs[0]) {
    steps.push({
      type: 'NEED',
      label: strategy.needs.needs[0].label,
      description: `Your underlying need is ${strategy.needs.needs[0].label}.`,
      reasoning: strategy.needs.needs[0].evidence,
    })
  }

  // 3. Best trajectory
  if (strategy.bestTrajectory) {
    steps.push({
      type: 'OUTCOME',
      label: strategy.bestTrajectory.label,
      description: `The recommended trajectory is ${strategy.bestTrajectory.label}, leading to ${strategy.bestTrajectory.destinationStatus}.`,
      reasoning: strategy.bestTrajectory.viable
        ? 'This trajectory is currently viable — you meet the entry requirements.'
        : 'This trajectory has blockers that need to be resolved.',
    })
  }

  // 4. Blockers
  if (strategy.blockers.length > 0) {
    const primaryBlocker = strategy.blockers[0]
    steps.push({
      type: 'BLOCKER',
      label: primaryBlocker.label,
      description: `The primary blocker is: ${primaryBlocker.label}.`,
      reasoning: primaryBlocker.reason,
    })
  }

  // 5. Capabilities
  if (strategy.desiredCapabilities && strategy.desiredCapabilities.length > 0) {
    const primaryCap = strategy.desiredCapabilities[0]
    steps.push({
      type: 'CAPABILITY',
      label: primaryCap.label,
      description: `Required capability: ${primaryCap.label}.`,
      reasoning: `Triggered by: ${primaryCap.triggers.map((t) => t.blockerLabel).join(', ')}.`,
    })
  }

  // 6. Actions
  if (strategy.actionPlan.actions.length > 0) {
    const primaryAction = strategy.actionPlan.actions[0]
    steps.push({
      type: 'ACTION',
      label: primaryAction.title,
      description: `Recommended action: ${primaryAction.title}.`,
      reasoning: primaryAction.description,
    })
  }

  return steps
}

function buildSummary(strategy: Strategy): string {
  const parts: string[] = []
  if (strategy.intent.statedGoal) parts.push(`Your objective is ${strategy.intent.statedGoal}`)
  if (strategy.bestTrajectory) parts.push(`the recommended trajectory is ${strategy.bestTrajectory.label}`)
  if (strategy.blockers.length > 0) parts.push(`the primary blocker is ${strategy.blockers[0].label}`)
  if (strategy.desiredCapabilities && strategy.desiredCapabilities.length > 0) {
    parts.push(`the required capability is ${strategy.desiredCapabilities[0].label}`)
  }
  if (strategy.actionPlan.actions.length > 0) {
    parts.push(`the next action is ${strategy.actionPlan.actions[0].title}`)
  }
  return parts.join(', ') + '.'
}

function extractAssumptions(strategy: Strategy): string[] {
  const assumptions: string[] = []

  // From the original deterministic explanation string (now stored as
  // StrategyExplanation, but the original string was moved to a different
  // field). We use the strategy's explanation prose if it's a string,
  // otherwise extract from the explanation object's summary.
  const explanationText = typeof strategy.explanation === 'string'
    ? strategy.explanation
    : (strategy.explanation as any)?.summary ?? ''

  if (explanationText) {
    const sentences = explanationText.split('. ')
    for (const s of sentences) {
      if (s.toLowerCase().includes('assume') || s.toLowerCase().includes('if ')) {
        assumptions.push(s.trim())
      }
    }
  }

  // From uncertainties
  for (const u of strategy.uncertainties) {
    if (u.confidence === 'LOW' || u.confidence === 'UNKNOWN') {
      assumptions.push(`${u.dimension}: ${u.reason}`)
    }
  }

  // From the best trajectory
  if (strategy.bestTrajectory) {
    assumptions.push(`Trajectory ${strategy.bestTrajectory.label} is the best available option given current profile and policy.`)
  }

  return assumptions
}

function extractTradeoffs(strategy: Strategy): Array<{ label: string; description: string; evidence: string }> {
  const tradeoffs: Array<{ label: string; description: string; evidence: string }> = []

  // From alternative intents
  for (const alt of strategy.alternativeIntents) {
    tradeoffs.push({
      label: alt.title,
      description: alt.rationale,
      evidence: alt.tradeoffs.join('; '),
    })
  }

  // From the intent frontier
  if (strategy.intentFrontier.distinctStrategies.length > 1) {
    tradeoffs.push({
      label: 'Multi-objective tradeoff',
      description: `${strategy.intentFrontier.distinctStrategies.length} distinct strategies were identified across different objectives.`,
      evidence: 'IntentFrontier.distinctStrategies',
    })
  }

  return tradeoffs
}

function extractRejectedAlternatives(strategy: Strategy): string[] {
  const rejected: string[] = []

  for (const alt of strategy.alternativeTrajectories.slice(1, 4)) {
    rejected.push(`${alt.label} (${alt.viable ? 'viable but lower-ranked' : 'blocked'})`)
  }

  for (const alt of strategy.alternativeIntents) {
    if (!alt.mayBeSuperior) {
      rejected.push(alt.title)
    }
  }

  return rejected
}

function assessConfidence(strategy: Strategy): 'high' | 'medium' | 'low' | 'unknown' {
  if (strategy.uncertainties.length === 0) return 'unknown'

  const highCount = strategy.uncertainties.filter((u) => u.confidence === 'HIGH').length
  const lowCount = strategy.uncertainties.filter((u) => u.confidence === 'LOW' || u.confidence === 'UNKNOWN').length
  const total = strategy.uncertainties.length

  if (highCount / total >= 0.7) return 'high'
  if (lowCount / total >= 0.5) return 'low'
  return 'medium'
}

// ---------------------------------------------------------------------------
// Graph diff
// ---------------------------------------------------------------------------

export function diffDecisionGraphs(oldGraph: DecisionGraph, newGraph: DecisionGraph): DecisionGraphDiff {
  const oldNodes = new Map(oldGraph.nodes.map((n) => [n.id, n]))
  const newNodes = new Map(newGraph.nodes.map((n) => [n.id, n]))

  const addedNodes: DecisionNode[] = []
  const removedNodes: DecisionNode[] = []
  const changedNodes: Array<{ oldNode: DecisionNode; newNode: DecisionNode; changes: string[] }> = []

  for (const [id, newNode] of newNodes) {
    const oldNode = oldNodes.get(id)
    if (!oldNode) {
      addedNodes.push(newNode)
    } else {
      const changes: string[] = []
      if (oldNode.label !== newNode.label) changes.push(`label: "${oldNode.label}" → "${newNode.label}"`)
      if (oldNode.description !== newNode.description) changes.push('description changed')
      if (oldNode.evidence !== newNode.evidence) changes.push('evidence changed')
      if (changes.length > 0) {
        changedNodes.push({ oldNode, newNode, changes })
      }
    }
  }

  for (const [id, oldNode] of oldNodes) {
    if (!newNodes.has(id)) {
      removedNodes.push(oldNode)
    }
  }

  // Edge diff
  const oldEdgeKeys = new Set(oldGraph.edges.map((e) => `${e.from}-${e.type}-${e.to}`))
  const newEdgeKeys = new Set(newGraph.edges.map((e) => `${e.from}-${e.type}-${e.to}`))

  const addedEdges = newGraph.edges.filter((e) => !oldEdgeKeys.has(`${e.from}-${e.type}-${e.to}`))
  const removedEdges = oldGraph.edges.filter((e) => !newEdgeKeys.has(`${e.from}-${e.type}-${e.to}`))

  const parts: string[] = []
  if (addedNodes.length > 0) parts.push(`${addedNodes.length} node(s) added`)
  if (removedNodes.length > 0) parts.push(`${removedNodes.length} node(s) removed`)
  if (changedNodes.length > 0) parts.push(`${changedNodes.length} node(s) changed`)
  if (addedEdges.length > 0) parts.push(`${addedEdges.length} edge(s) added`)
  if (removedEdges.length > 0) parts.push(`${removedEdges.length} edge(s) removed`)

  const summary = parts.length === 0
    ? 'No changes in the decision graph.'
    : `Decision graph changed: ${parts.join(', ')}.`

  return { addedNodes, removedNodes, changedNodes, addedEdges, removedEdges, summary }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hashString(s: string): string {
  let hash = 0
  for (let i = 0; i < s.length; i++) {
    const char = s.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash |= 0
  }
  return Math.abs(hash).toString(36)
}
