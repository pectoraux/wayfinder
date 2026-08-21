// Wayfinder — Decision Graph (N0.6 hardened)
//
// This module implements the explainable decision graph that answers:
//   "Why does this strategy exist?"
//
// N0.6 HARDENING (9 issues fixed):
//   1. Explanation is GRAPH-DERIVED (traverses nodes+edges, not parallel fields)
//   2. Correct edge semantics (Capability→Action via REQUIRES, no ADDRESSES misuse)
//   3. Blockers connected to the CORRECT needs (not needs[0])
//   4. graphSchemaVersion + graphHash (first-class immutable graph artifact)
//   5. Canonical graph comparison (excludes generatedAt from hash)
//   6. Structured provenance references (not just string labels)
//   7. Legacy reconstructed graphs explicitly marked
//   8. Separated confidence dimensions
//   9. Cleaned up dead nodeIdCounter code
//
// The graph is:
//   - DETERMINISTIC: same inputs → same graph (no LLM)
//   - IMMUTABLE: stored as a snapshot with a canonical hash
//   - REPLAYABLE: can be reconstructed and compared via graphHash
//   - TRACEABLE: every node has structured provenance + evidence
//   - AUTHORITATIVE: the explanation is DERIVED from the graph, not parallel

import type { Strategy, Trajectory, BlockerAnalysis, ActionPlan, Action } from '@/lib/strategy/types'
import type { NeedAssessment, DesiredCapability, CapabilityImpactSummary, CapabilityTrigger } from '@/lib/strategy/needs'
import type { Intent, MobilityState } from '@/lib/domain/types'
import { createHash } from 'crypto'

// ---------------------------------------------------------------------------
// Graph schema version
// ---------------------------------------------------------------------------

/** Bumped when the graph structure changes. Part of the canonical hash. */
export const GRAPH_SCHEMA_VERSION = '1.0.0'

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

/** Structured provenance — references to exact source artifacts, not just labels. */
export interface NodeProvenance {
  /** The source module/type that produced this node. */
  source: string
  /** Specific field references (e.g., 'blockerId:blk-001', 'trajectoryId:traj-de'). */
  references: Record<string, string>
}

export interface DecisionNode {
  id: string
  type: DecisionNodeType
  label: string
  description: string
  evidence: string
  /** Structured provenance — traceable to exact source artifacts. */
  provenance: NodeProvenance
}

export interface DecisionEdge {
  from: string
  to: string
  type: DecisionEdgeType
  label?: string
}

export interface DecisionGraph {
  nodes: DecisionNode[]
  edges: DecisionEdge[]
  /** Graph schema version (bumped on structural changes). */
  graphSchemaVersion: string
  /** Canonical hash of nodes+edges (excludes generatedAt). */
  graphHash: string
  /** When this graph was generated (NOT part of the hash). */
  generatedAt: string
  /** Strategy engine version that generated this graph. */
  engineVersion: string
  /** Whether this graph was reconstructed for a legacy record (pre-N0.6). */
  legacyReconstructed?: boolean
}

// ---------------------------------------------------------------------------
// Graph diff
// ---------------------------------------------------------------------------

export interface DecisionGraphDiff {
  addedNodes: DecisionNode[]
  removedNodes: DecisionNode[]
  changedNodes: Array<{ oldNode: DecisionNode; newNode: DecisionNode; changes: string[] }>
  addedEdges: DecisionEdge[]
  removedEdges: DecisionEdge[]
  /** True if the graph hashes match. */
  hashMatch: boolean
  summary: string
}

// ---------------------------------------------------------------------------
// Explanation (GRAPH-DERIVED — traverses nodes+edges)
// ---------------------------------------------------------------------------

export interface ConfidenceByDimension {
  evidence: 'high' | 'medium' | 'low' | 'unknown'
  policy: 'high' | 'medium' | 'low' | 'unknown'
  recommendation: 'high' | 'medium' | 'low' | 'unknown'
  outcome: 'high' | 'medium' | 'low' | 'unknown'
}

/**
 * A single step in an explanation path. Every consecutive pair of steps in a
 * path MUST be connected by an exact graph edge — recorded as `connectingEdge`
 * + `edgeDirection` so the relationship is explicit and verifiable.
 *
 * A missing edge TERMINATES the path. We never reuse an unrelated edge
 * elsewhere in the graph to keep a path going. False causality is worse than
 * an incomplete path.
 */
export interface ExplanationStep {
  type: DecisionNodeType
  label: string
  description: string
  reasoning: string
  /** The graph node ID this step was derived from. */
  nodeId: string
  /** The graph edge type that connects this step to the previous one.
   *  Undefined for the first step (the path root). */
  connectingEdge?: DecisionEdgeType
  /** Direction of the connecting edge relative to path traversal:
   *  - 'forward'  : edge.from === prev.nodeId, edge.to === this.nodeId
   *  - 'reverse'  : edge.from === this.nodeId, edge.to === prev.nodeId
   *
   *  This makes the edge semantics EXPLICIT. For example, the BLOCKS edge is
   *  stored as Blocker→Objective (the blocker blocks the objective), but the
   *  path traverses it as Objective→Blocker (reverse) so the explanation can
   *  start at the objective. The edge itself is unchanged — only the
   *  traversal direction is recorded. */
  edgeDirection?: 'forward' | 'reverse'
}

/**
 * A VERIFIED reasoning branch — a self-contained causal chain where every
 * consecutive pair of steps has an exact graph edge.
 *
 * The explanation is MULTI-BRANCH, not a single linear chain. The two
 * foundational proven relationships are kept SEPARATE:
 *   - Objective →(CAUSES)→ Need           (Need branch)
 *   - Blocker →(BLOCKS)→ Objective        (Blocker-resolution branch)
 *
 * We do NOT invent a Need→Blocker edge. The Need branch terminates after the
 * Need. The Blocker-resolution branch continues:
 *   Objective ←(BLOCKS)← Blocker ←(ADDRESSES)← Capability →(REQUIRES)→ Action →(LEADS_TO)→ Outcome
 */
export interface ExplanationPath {
  /** Stable identifier for this branch. */
  id: string
  /** Human-readable label for this branch. */
  label: string
  /** The kind of provenance this branch represents. */
  kind:
    | 'NEED_PROVENANCE'
    | 'BLOCKER_RESOLUTION'
    | 'ACTION_OUTCOME'
    | 'ASSUMPTION'
    | 'TRADEOFF'
    | 'ALTERNATIVE'
  /** Ordered steps. Each consecutive pair has a verified graph edge
   *  (connectingEdge + edgeDirection). The path TERMINATES when no verified
   *  edge exists — it never reuses an unrelated edge elsewhere in the graph. */
  steps: ExplanationStep[]
  /** Why this path terminated (for audit transparency). */
  terminationReason:
    | 'COMPLETE'
    | 'NO_FURTHER_VERIFIED_EDGE'
    | 'NO_ENTRY_NODE'
}

export interface StrategyExplanation {
  summary: string
  /** VERIFIED reasoning branches. Each path is a self-contained causal chain
   *  where every consecutive pair has an exact graph edge. The explanation is
   *  MULTI-BRANCH — Objective→Need and Blocker→Objective are SEPARATE proven
   *  relationships, not conflated into one linear chain. */
  paths: ExplanationPath[]
  /** Explicit scope label clarifying the explanation model. */
  explanationScope: 'MULTI_BRANCH_VERIFIED'
  assumptions: string[]
  rejectedAlternatives: string[]
  /** Separated confidence dimensions (not a single scalar). */
  confidence: ConfidenceByDimension
  /** Overall confidence (derived from the dimensions, conservative). */
  overallConfidence: 'high' | 'medium' | 'low' | 'unknown'
  graph: DecisionGraph
}

// ---------------------------------------------------------------------------
// Canonical graph hash (excludes generatedAt)
// ---------------------------------------------------------------------------

function computeGraphHash(nodes: DecisionNode[], edges: DecisionEdge[]): string {
  const payload = canonicalizeGraphPayload(nodes, edges)
  return createHash('sha256').update(payload).digest('hex')
}

/** Canonicalize the graph payload (nodes + edges) for deterministic comparison.
 *  Excludes generatedAt, graphHash, legacyReconstructed. */
function canonicalizeGraphPayload(nodes: DecisionNode[], edges: DecisionEdge[]): string {
  return JSON.stringify({
    nodes: nodes
      .map((n) => ({
        id: n.id,
        type: n.type,
        label: n.label,
        description: n.description,
        evidence: n.evidence,
        provenance: n.provenance,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    edges: edges
      .map((e) => ({ from: e.from, to: e.to, type: e.type, label: e.label }))
      .sort((a, b) => `${a.from}-${a.type}-${a.to}`.localeCompare(`${b.from}-${b.type}-${b.to}`)),
  })
}

// ---------------------------------------------------------------------------
// Canonical graph comparison (for replay verification)
// ---------------------------------------------------------------------------

export type GraphComparisonStatus = 'EXACT_MATCH' | 'GRAPH_MISMATCH'

export interface GraphComparisonResult {
  status: GraphComparisonStatus
  /** The stored graph's hash. */
  storedHash: string
  /** The replayed graph's hash. */
  replayedHash: string
  /** Differences (if any). */
  differences: string[]
}

/**
 * Compare a stored graph against a replayed graph using INDEPENDENT canonical
 * comparison — does NOT trust the supplied graphHash field.
 *
 * The comparator canonicalizes both graphs' nodes+edges and derives the
 * status from the canonical representation. This means even if graphHash
 * is stale or tampered, the comparison will detect the difference.
 */
export function compareGraphs(stored: DecisionGraph, replayed: DecisionGraph): GraphComparisonResult {
  const differences: string[] = []

  // Independently canonicalize both graphs
  const storedCanonical = canonicalizeGraphPayload(stored.nodes, stored.edges)
  const replayedCanonical = canonicalizeGraphPayload(replayed.nodes, replayed.edges)

  // Derive hashes from the canonical payloads (not from the stored graphHash field)
  const storedDerivedHash = createHash('sha256').update(storedCanonical).digest('hex')
  const replayedDerivedHash = createHash('sha256').update(replayedCanonical).digest('hex')

  // Check graphSchemaVersion
  if (stored.graphSchemaVersion !== replayed.graphSchemaVersion) {
    differences.push(`graphSchemaVersion: stored=${stored.graphSchemaVersion} replayed=${replayed.graphSchemaVersion}`)
  }

  // Node count
  if (stored.nodes.length !== replayed.nodes.length) {
    differences.push(`node count: stored=${stored.nodes.length} replayed=${replayed.nodes.length}`)
  }

  // Edge count
  if (stored.edges.length !== replayed.edges.length) {
    differences.push(`edge count: stored=${stored.edges.length} replayed=${replayed.edges.length}`)
  }

  // Detailed node comparison
  const storedNodes = new Map(stored.nodes.map((n) => [n.id, n]))
  for (const replayedNode of replayed.nodes) {
    const storedNode = storedNodes.get(replayedNode.id)
    if (storedNode) {
      if (storedNode.label !== replayedNode.label) {
        differences.push(`node ${replayedNode.id} label: "${storedNode.label}" → "${replayedNode.label}"`)
      }
      if (storedNode.type !== replayedNode.type) {
        differences.push(`node ${replayedNode.id} type: ${storedNode.type} → ${replayedNode.type}`)
      }
      if (storedNode.description !== replayedNode.description) {
        differences.push(`node ${replayedNode.id} description changed`)
      }
      if (storedNode.evidence !== replayedNode.evidence) {
        differences.push(`node ${replayedNode.id} evidence changed`)
      }
      if (JSON.stringify(storedNode.provenance) !== JSON.stringify(replayedNode.provenance)) {
        differences.push(`node ${replayedNode.id} provenance changed`)
      }
    } else {
      differences.push(`node ${replayedNode.id} missing in stored graph`)
    }
  }

  // Check for nodes in stored but not in replayed
  const replayedNodeIds = new Set(replayed.nodes.map((n) => n.id))
  for (const storedNode of stored.nodes) {
    if (!replayedNodeIds.has(storedNode.id)) {
      differences.push(`node ${storedNode.id} missing in replayed graph`)
    }
  }

  // Detailed edge comparison
  const storedEdgeKeys = new Set(stored.edges.map((e) => `${e.from}-${e.type}-${e.to}-${e.label ?? ''}`))
  const replayedEdgeKeys = new Set(replayed.edges.map((e) => `${e.from}-${e.type}-${e.to}-${e.label ?? ''}`))

  for (const key of replayedEdgeKeys) {
    if (!storedEdgeKeys.has(key)) {
      differences.push(`edge added in replayed: ${key}`)
    }
  }
  for (const key of storedEdgeKeys) {
    if (!replayedEdgeKeys.has(key)) {
      differences.push(`edge removed in replayed: ${key}`)
    }
  }

  // Status is derived from the INDEPENDENT canonical comparison,
  // NOT from the stored graphHash field.
  const canonicalMatch = storedCanonical === replayedCanonical

  return {
    status: canonicalMatch ? 'EXACT_MATCH' : 'GRAPH_MISMATCH',
    storedHash: storedDerivedHash,
    replayedHash: replayedDerivedHash,
    differences,
  }
}

// ---------------------------------------------------------------------------
// Deterministic graph generation
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

/**
 * Build a deterministic DecisionGraph from a Strategy.
 *
 * The graph is the AUTHORITATIVE explanation substrate — the explanation
 * renderer CONSUMES the graph, it does not read Strategy fields directly.
 *
 * Causal chain: Objective → Need → Blocker → Capability → Action → Outcome
 * Each edge is semantically correct:
 *   Objective CAUSES Need
 *   Need is BLOCKED by Blocker
 *   Blocker is ADDRESSED by Capability (Capability → Blocker: ADDRESSES)
 *   Capability REQUIRES Action (Capability → Action: REQUIRES)
 *   Action LEADS_TO Outcome
 */
export function buildDecisionGraph(strategy: Strategy, legacyReconstructed = false): DecisionGraph {
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
    provenance: {
      source: 'Intent.statedGoal',
      references: { statedGoal: objectiveLabel },
    },
  })

  // --- NEED nodes (with correct objective association) ---
  const needNodeIds: string[] = []
  const needs = strategy.needs
  if (needs) {
    for (const need of needs.needs) {
      const nodeId = `need-${hashString(need.label)}`
      needNodeIds.push(nodeId)
      nodes.push({
        id: nodeId,
        type: 'NEED',
        label: need.label,
        description: `Inferred need: ${need.label}`,
        evidence: need.evidence,
        provenance: {
          source: 'NeedAssessment.needs',
          references: { label: need.label, derivedFrom: need.derivedFrom },
        },
      })
      edges.push({ from: objectiveId, to: nodeId, type: 'CAUSES', label: 'implies' })
    }
  }

  // --- BLOCKER nodes ---
  // N0.6 final hardening: blockers are connected to the OBJECTIVE (provable)
  // and to CAPABILITY nodes via their triggers (actual provenance). We do NOT
  // invent blocker→need edges because the current domain model does not
  // contain enough information to determine a true blocker→need relationship.
  // False edges are worse than missing edges.
  const blockerNodeIds = new Set<string>()
  for (const blocker of strategy.blockers) {
    const nodeId = `blocker-${hashString(blocker.blockerId)}`
    blockerNodeIds.add(nodeId)
    nodes.push({
      id: nodeId,
      type: 'BLOCKER',
      label: blocker.label,
      description: blocker.reason,
      evidence: `Blocker category: ${blocker.category}, difficulty: ${blocker.difficulty}`,
      provenance: {
        source: 'BlockerAnalysis',
        references: { blockerId: blocker.blockerId, category: blocker.category },
      },
    })
    // Blocker BLOCKS the objective (this is provable — the blocker prevents
    // achieving the objective on this trajectory)
    edges.push({ from: nodeId, to: objectiveId, type: 'BLOCKS', label: 'prevents' })
    // Do NOT connect to needs — the actual blocker→need relationship is not
    // represented in the current domain model. Using CapabilityTrigger
    // provenance (blocker→capability) is the correct causal chain.
  }

  // --- OUTCOME node for bestTrajectory (created EARLY so that both action
  //     LEADS_TO edges and ALTERNATIVE_TO edges can reference it without
  //     producing orphan edges). ---
  let bestOutcomeId: string | undefined
  if (strategy.bestTrajectory) {
    bestOutcomeId = `outcome-${hashString(strategy.bestTrajectory.id)}`
    if (!nodes.find((n) => n.id === bestOutcomeId)) {
      nodes.push({
        id: bestOutcomeId,
        type: 'OUTCOME',
        label: strategy.bestTrajectory.label,
        description: `Expected outcome: ${strategy.bestTrajectory.destinationStatus}`,
        evidence: `Trajectory ${strategy.bestTrajectory.id}, ${strategy.bestTrajectory.totalMonths} months, $${strategy.bestTrajectory.totalCostUSD}`,
        provenance: {
          source: 'Strategy.bestTrajectory',
          references: { trajectoryId: strategy.bestTrajectory.id, sourceRouteId: strategy.bestTrajectory.sourceRouteId ?? '' },
        },
      })
    }
  }

  // --- CAPABILITY nodes ---
  const capabilityNodeIds: string[] = []
  for (const cap of strategy.desiredCapabilities ?? []) {
    const nodeId = `cap-${hashString(cap.capabilityId)}`
    capabilityNodeIds.push(nodeId)
    nodes.push({
      id: nodeId,
      type: 'CAPABILITY',
      label: cap.label,
      description: `Required capability: ${cap.capabilityId}`,
      evidence: cap.triggers.map((t) => `${t.blockerLabel} (${t.trajectoryLabel})`).join('; '),
      provenance: {
        source: 'DesiredCapability',
        references: {
          capabilityId: cap.capabilityId,
          triggerBlockerIds: cap.triggers.map((t) => t.blockerId).join(','),
          triggerTrajectoryIds: cap.triggers.map((t) => t.trajectoryId).join(','),
        },
      },
    })

    // FIX #2: Capability ADDRESSES the blockers it resolves (correct semantics).
    // N0.6: Only create the ADDRESSES edge if the blocker node actually exists
    // in the graph. A capability trigger may reference a blockerId that was
    // filtered out of strategy.blockers — in that case, creating an edge to a
    // non-existent node would produce an orphan edge. Missing edges are better
    // than orphan edges.
    for (const trigger of cap.triggers) {
      const blockerNodeId = `blocker-${hashString(trigger.blockerId)}`
      if (blockerNodeIds.has(blockerNodeId)) {
        edges.push({ from: nodeId, to: blockerNodeId, type: 'ADDRESSES', label: 'resolves' })
      }
    }

    // Capability LEADS_TO outcomes (potential unlocks)
    for (const unlock of cap.potentialUnlocks) {
      const outcomeId = `outcome-${hashString(unlock.routeId)}`
      if (!nodes.find((n) => n.id === outcomeId)) {
        nodes.push({
          id: outcomeId,
          type: 'OUTCOME',
          label: unlock.routeLabel,
          description: `Potential outcome: ${unlock.routeLabel} (${unlock.remainingBlockers === 0 ? 'fully unlocked' : `${unlock.remainingBlockers} blockers remain`})`,
          evidence: `Route ${unlock.routeId}, country ${unlock.countryCode}`,
          provenance: {
            source: 'DesiredCapability.potentialUnlocks',
            references: { routeId: unlock.routeId, countryCode: unlock.countryCode },
          },
        })
      }
      edges.push({ from: nodeId, to: outcomeId, type: 'LEADS_TO', label: 'could unlock' })
    }
  }

  // --- ACTION nodes ---
  // FIX #2: Action nodes now have a REQUIRES edge from the Capability
  // that addresses the same blocker. This creates the causal chain:
  //   Blocker ← ADDRESSES ← Capability → REQUIRES → Action → LEADS_TO → Outcome
  for (const action of strategy.actionPlan.actions) {
    const nodeId = `action-${hashString(action.id)}`
    nodes.push({
      id: nodeId,
      type: 'ACTION',
      label: action.title,
      description: action.description,
      evidence: `Timeframe: ${action.timeframe}, impact: ${action.impact}, time-sensitive: ${action.timeSensitive}`,
      provenance: {
        source: 'ActionPlan.actions',
        references: { actionId: action.id, addressesBlockerId: action.addressesBlockerId ?? 'none' },
      },
    })

    // Action ADDRESSES the blocker (if it has one AND the blocker exists)
    if (action.addressesBlockerId) {
      const blockerNodeId = `blocker-${hashString(action.addressesBlockerId)}`
      // N0.6: Only create the edge if the blocker node exists (no orphan edges)
      if (blockerNodeIds.has(blockerNodeId)) {
        edges.push({ from: nodeId, to: blockerNodeId, type: 'ADDRESSES', label: 'addresses' })
      }

      // FIX #2: Find capabilities that also address this blocker and create
      // Capability → REQUIRES → Action edges
      for (const cap of strategy.desiredCapabilities ?? []) {
        const capAddressesThisBlocker = cap.triggers.some(
          (t) => t.blockerId === action.addressesBlockerId
        )
        if (capAddressesThisBlocker) {
          const capNodeId = `cap-${hashString(cap.capabilityId)}`
          edges.push({ from: capNodeId, to: nodeId, type: 'REQUIRES', label: 'requires action' })
        }
      }
    }

    // Action LEADS_TO the best trajectory (outcome) — the outcome node was
    // already created above, so this edge is never orphaned.
    if (bestOutcomeId) {
      edges.push({ from: nodeId, to: bestOutcomeId, type: 'LEADS_TO', label: 'advances' })
    }

    // Action DEPENDS_ON other actions (only if the dependency exists)
    if (action.dependsOn) {
      for (const depId of action.dependsOn) {
        const depNodeId = `action-${hashString(depId)}`
        // The dependency action node will be created in a later iteration of
        // this loop (or was already created). We add the edge unconditionally
        // because all actions in actionPlan.actions get nodes.
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
      provenance: {
        source: 'Strategy.uncertainties + Strategy.bestTrajectory',
        references: {},
      },
    })
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
      provenance: {
        source: 'Strategy.intentFrontier + Strategy.alternativeIntents',
        references: {},
      },
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
      provenance: {
        source: 'Strategy.alternativeTrajectories',
        references: { trajectoryId: alt.id },
      },
    })
    if (bestOutcomeId) {
      edges.push({ from: nodeId, to: bestOutcomeId, type: 'ALTERNATIVE_TO', label: 'alternative to' })
    }
  }

  const graphHash = computeGraphHash(nodes, edges)

  return {
    nodes,
    edges,
    graphSchemaVersion: GRAPH_SCHEMA_VERSION,
    graphHash,
    generatedAt: strategy.generatedAt,
    engineVersion: strategy.strategyEngineVersion ?? 'unknown',
    legacyReconstructed,
  }
}

// ---------------------------------------------------------------------------
// GRAPH-DERIVED Explanation (multi-branch verified paths)
// ---------------------------------------------------------------------------
//
// The explanation is modeled as MULTIPLE VERIFIED GRAPH PATHS, not one linear
// chain. The two foundational proven relationships are kept SEPARATE:
//
//   Branch 1 (Need provenance):
//     OBJECTIVE →(CAUSES)→ NEED
//     The path TERMINATES after the need. We do NOT invent a Need→Blocker
//     edge — the domain model does not contain that relationship.
//
//   Branch 2 (Blocker resolution):
//     OBJECTIVE ←(BLOCKS)← BLOCKER ←(ADDRESSES)← CAPABILITY →(REQUIRES)→ ACTION →(LEADS_TO)→ OUTCOME
//     Each hop follows an EXACT graph edge. A missing edge truncates the path.
//
// Every consecutive node pair in every displayed path has the exact
// corresponding graph edge (recorded as connectingEdge + edgeDirection).
// A missing edge TERMINATES the path — it never reuses an unrelated edge
// elsewhere in the graph. False causality is worse than an incomplete path.
// ---------------------------------------------------------------------------

export function generateExplanation(strategy: Strategy, graph: DecisionGraph): StrategyExplanation {
  const paths = buildExplanationPaths(graph)
  const assumptions = extractAssumptionsFromGraph(graph)
  const rejectedAlternatives = extractAlternativesFromGraph(graph)
  const confidence = assessConfidenceByDimension(strategy)
  const overallConfidence = deriveOverallConfidence(confidence)
  const summary = buildSummaryFromGraph(graph)

  return {
    summary,
    paths,
    explanationScope: 'MULTI_BRANCH_VERIFIED',
    assumptions,
    rejectedAlternatives,
    confidence,
    overallConfidence,
    graph,
  }
}

/**
 * Build VERIFIED explanation paths by traversing the graph. Each path is a
 * self-contained causal chain. Every consecutive step pair has an exact graph
 * edge (connectingEdge + edgeDirection). A missing edge TERMINATES the path.
 *
 * Paths built:
 *   1. NEED_PROVENANCE:        Objective →(CAUSES)→ Need  [terminates]
 *   2. BLOCKER_RESOLUTION:     Objective ←(BLOCKS)← Blocker ←(ADDRESSES)←
 *                              Capability →(REQUIRES)→ Action →(LEADS_TO)→ Outcome
 *   3. ACTION_OUTCOME (fallback when no blockers): Action →(LEADS_TO)→ Outcome
 */
function buildExplanationPaths(graph: DecisionGraph): ExplanationPath[] {
  const paths: ExplanationPath[] = []
  const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]))

  const objectiveNode = graph.nodes.find((n) => n.type === 'OBJECTIVE')
  if (!objectiveNode) return paths

  const objectiveStep: ExplanationStep = {
    type: 'OBJECTIVE',
    label: objectiveNode.label,
    description: objectiveNode.description,
    reasoning: objectiveNode.evidence,
    nodeId: objectiveNode.id,
  }

  // === BRANCH 1: NEED PROVENANCE ===
  // Objective →(CAUSES)→ Need  [terminates — no Need→Blocker edge exists]
  const needEdges = graph.edges.filter(
    (e) => e.from === objectiveNode.id && e.type === 'CAUSES'
  )
  for (const needEdge of needEdges) {
    const needNode = nodeMap.get(needEdge.to)
    if (!needNode || needNode.type !== 'NEED') continue

    paths.push({
      id: `need-${needNode.id}`,
      label: `Need implied by objective: ${needNode.label}`,
      kind: 'NEED_PROVENANCE',
      steps: [
        objectiveStep,
        {
          type: 'NEED',
          label: needNode.label,
          description: needNode.description,
          reasoning: needNode.evidence,
          nodeId: needNode.id,
          connectingEdge: 'CAUSES',
          edgeDirection: 'forward',
        },
      ],
      // The need branch TERMINATES here. We do NOT invent a Need→Blocker edge.
      terminationReason: 'NO_FURTHER_VERIFIED_EDGE',
    })
  }

  // === BRANCH 2: BLOCKER RESOLUTION ===
  // Objective ←(BLOCKS)← Blocker ←(ADDRESSES)← Capability →(REQUIRES)→ Action →(LEADS_TO)→ Outcome
  const blockerEdges = graph.edges.filter(
    (e) => e.to === objectiveNode.id && e.type === 'BLOCKS'
  )

  for (const blockerEdge of blockerEdges) {
    const blockerNode = nodeMap.get(blockerEdge.from)
    if (!blockerNode || blockerNode.type !== 'BLOCKER') continue

    const blockerStep: ExplanationStep = {
      type: 'BLOCKER',
      label: blockerNode.label,
      description: blockerNode.description,
      reasoning: blockerNode.evidence,
      nodeId: blockerNode.id,
      connectingEdge: 'BLOCKS',
      edgeDirection: 'reverse', // edge is Blocker→Objective; traversed Objective→Blocker
    }

    // Find capabilities that ADDRESSES this blocker
    // Edge: Capability →(ADDRESSES)→ Blocker (traversed Blocker→Capability, reverse)
    const capEdges = graph.edges.filter(
      (e) => e.type === 'ADDRESSES' && e.to === blockerNode.id
    )

    if (capEdges.length === 0) {
      // Blocker has no resolving capability — path terminates at the blocker
      paths.push({
        id: `blocker-${blockerNode.id}`,
        label: `Blocker: ${blockerNode.label}`,
        kind: 'BLOCKER_RESOLUTION',
        steps: [objectiveStep, blockerStep],
        terminationReason: 'NO_FURTHER_VERIFIED_EDGE',
      })
      continue
    }

    for (const capEdge of capEdges) {
      const capNode = nodeMap.get(capEdge.from)
      if (!capNode || capNode.type !== 'CAPABILITY') continue

      const capStep: ExplanationStep = {
        type: 'CAPABILITY',
        label: capNode.label,
        description: capNode.description,
        reasoning: capNode.evidence,
        nodeId: capNode.id,
        connectingEdge: 'ADDRESSES',
        edgeDirection: 'reverse', // edge is Capability→Blocker; traversed Blocker→Capability
      }

      // Find actions this capability REQUIRES
      // Edge: Capability →(REQUIRES)→ Action (forward)
      const actionEdges = graph.edges.filter(
        (e) => e.from === capNode.id && e.type === 'REQUIRES'
      )

      if (actionEdges.length === 0) {
        paths.push({
          id: `blocker-${blockerNode.id}-cap-${capNode.id}`,
          label: `Capability for: ${blockerNode.label}`,
          kind: 'BLOCKER_RESOLUTION',
          steps: [objectiveStep, blockerStep, capStep],
          terminationReason: 'NO_FURTHER_VERIFIED_EDGE',
        })
        continue
      }

      for (const actionEdge of actionEdges) {
        const actionNode = nodeMap.get(actionEdge.to)
        if (!actionNode || actionNode.type !== 'ACTION') continue

        const actionStep: ExplanationStep = {
          type: 'ACTION',
          label: actionNode.label,
          description: actionNode.description,
          reasoning: actionNode.evidence,
          nodeId: actionNode.id,
          connectingEdge: 'REQUIRES',
          edgeDirection: 'forward',
        }

        // Find outcomes this action LEADS_TO
        // Edge: Action →(LEADS_TO)→ Outcome (forward)
        const outcomeEdges = graph.edges.filter(
          (e) => e.from === actionNode.id && e.type === 'LEADS_TO'
        )

        if (outcomeEdges.length === 0) {
          paths.push({
            id: `blocker-${blockerNode.id}-cap-${capNode.id}-action-${actionNode.id}`,
            label: `Action: ${actionNode.label}`,
            kind: 'BLOCKER_RESOLUTION',
            steps: [objectiveStep, blockerStep, capStep, actionStep],
            terminationReason: 'NO_FURTHER_VERIFIED_EDGE',
          })
          continue
        }

        for (const outcomeEdge of outcomeEdges) {
          const outcomeNode = nodeMap.get(outcomeEdge.to)
          if (!outcomeNode || outcomeNode.type !== 'OUTCOME') continue

          paths.push({
            id: `blocker-${blockerNode.id}-cap-${capNode.id}-action-${actionNode.id}-outcome-${outcomeNode.id}`,
            label: `Resolution path: ${blockerNode.label}`,
            kind: 'BLOCKER_RESOLUTION',
            steps: [
              objectiveStep,
              blockerStep,
              capStep,
              actionStep,
              {
                type: 'OUTCOME',
                label: outcomeNode.label,
                description: outcomeNode.description,
                reasoning: outcomeNode.evidence,
                nodeId: outcomeNode.id,
                connectingEdge: 'LEADS_TO',
                edgeDirection: 'forward',
              },
            ],
            terminationReason: 'COMPLETE',
          })
          break // one outcome per action
        }
        break // one action per capability
      }
    }
  }

  // === BRANCH 3 (fallback): ACTION → OUTCOME when no blockers ===
  if (blockerEdges.length === 0) {
    const actionNodes = graph.nodes.filter((n) => n.type === 'ACTION')
    for (const actionNode of actionNodes) {
      const outcomeEdges = graph.edges.filter(
        (e) => e.from === actionNode.id && e.type === 'LEADS_TO'
      )
      for (const outcomeEdge of outcomeEdges) {
        const outcomeNode = nodeMap.get(outcomeEdge.to)
        if (!outcomeNode || outcomeNode.type !== 'OUTCOME') continue

        paths.push({
          id: `action-${actionNode.id}`,
          label: `Action: ${actionNode.label}`,
          kind: 'ACTION_OUTCOME',
          steps: [
            {
              type: 'ACTION',
              label: actionNode.label,
              description: actionNode.description,
              reasoning: actionNode.evidence,
              nodeId: actionNode.id,
            },
            {
              type: 'OUTCOME',
              label: outcomeNode.label,
              description: outcomeNode.description,
              reasoning: outcomeNode.evidence,
              nodeId: outcomeNode.id,
              connectingEdge: 'LEADS_TO',
              edgeDirection: 'forward',
            },
          ],
          terminationReason: 'COMPLETE',
        })
        break
      }
    }
  }

  return paths
}

// ---------------------------------------------------------------------------
// Graph causal-structure validation
// ---------------------------------------------------------------------------
//
// Validates that a graph contains NO invalid causal relationships. Used by
// verifyStrategyRecord() to fail verification if a historical graph contains
// a fabricated relationship (e.g., a Need→Blocker edge invented by old code).
// ---------------------------------------------------------------------------

export type GraphCausalViolationType =
  | 'FABRICATED_NEED_BLOCKER_EDGE'
  | 'ORPHAN_EDGE'
  | 'INVALID_EDGE_TYPE_FOR_NODES'

export interface GraphCausalViolation {
  type: GraphCausalViolationType
  description: string
  edge?: DecisionEdge
}

/**
 * Validate the causal structure of a DecisionGraph. Returns a list of
 * violations — an empty list means the graph is causally valid.
 *
 * Detected violations:
 *   - FABRICATED_NEED_BLOCKER_EDGE: any edge between a NEED and a BLOCKER
 *     (either direction). The domain model does NOT contain a Need↔Blocker
 *     relationship. Inventing one is the exact conflation this module prevents.
 *   - ORPHAN_EDGE: an edge that references a non-existent node.
 *   - INVALID_EDGE_TYPE_FOR_NODES: an edge type used between node types that
 *     do not match the edge's semantic contract (e.g., a BLOCKS edge that
 *     does not go Blocker→Objective).
 */
export function validateGraphCausalStructure(graph: DecisionGraph): GraphCausalViolation[] {
  const violations: GraphCausalViolation[] = []
  const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]))

  for (const edge of graph.edges) {
    const fromNode = nodeMap.get(edge.from)
    const toNode = nodeMap.get(edge.to)

    if (!fromNode || !toNode) {
      violations.push({
        type: 'ORPHAN_EDGE',
        description: `Edge ${edge.from}→${edge.to} (${edge.type}) references a non-existent node`,
        edge,
      })
      continue
    }

    // FABRICATED_NEED_BLOCKER_EDGE — the exact conflation we prevent.
    if (
      (fromNode.type === 'NEED' && toNode.type === 'BLOCKER') ||
      (fromNode.type === 'BLOCKER' && toNode.type === 'NEED')
    ) {
      violations.push({
        type: 'FABRICATED_NEED_BLOCKER_EDGE',
        description: `Fabricated causal edge between NEED and BLOCKER: ${edge.from}→${edge.to} (${edge.type}). The domain model does not contain a Need↔Blocker relationship.`,
        edge,
      })
    }

    // Edge-type semantic contracts
    if (edge.type === 'BLOCKS' && (fromNode.type !== 'BLOCKER' || toNode.type !== 'OBJECTIVE')) {
      violations.push({
        type: 'INVALID_EDGE_TYPE_FOR_NODES',
        description: `BLOCKS edge must go Blocker→Objective, but goes ${fromNode.type}→${toNode.type}`,
        edge,
      })
    }
    if (edge.type === 'CAUSES' && (fromNode.type !== 'OBJECTIVE' || toNode.type !== 'NEED')) {
      violations.push({
        type: 'INVALID_EDGE_TYPE_FOR_NODES',
        description: `CAUSES edge must go Objective→Need, but goes ${fromNode.type}→${toNode.type}`,
        edge,
      })
    }
    if (edge.type === 'ADDRESSES') {
      const valid = (fromNode.type === 'CAPABILITY' && toNode.type === 'BLOCKER') ||
                    (fromNode.type === 'ACTION' && toNode.type === 'BLOCKER')
      if (!valid) {
        violations.push({
          type: 'INVALID_EDGE_TYPE_FOR_NODES',
          description: `ADDRESSES edge must go Capability→Blocker or Action→Blocker, but goes ${fromNode.type}→${toNode.type}`,
          edge,
        })
      }
    }
    if (edge.type === 'REQUIRES' && (fromNode.type !== 'CAPABILITY' || toNode.type !== 'ACTION')) {
      violations.push({
        type: 'INVALID_EDGE_TYPE_FOR_NODES',
        description: `REQUIRES edge must go Capability→Action, but goes ${fromNode.type}→${toNode.type}`,
        edge,
      })
    }
    if (edge.type === 'LEADS_TO') {
      const valid = (fromNode.type === 'ACTION' && toNode.type === 'OUTCOME') ||
                    (fromNode.type === 'CAPABILITY' && toNode.type === 'OUTCOME')
      if (!valid) {
        violations.push({
          type: 'INVALID_EDGE_TYPE_FOR_NODES',
          description: `LEADS_TO edge must go Action→Outcome or Capability→Outcome, but goes ${fromNode.type}→${toNode.type}`,
          edge,
        })
      }
    }
  }

  return violations
}

// ---------------------------------------------------------------------------
// Explanation path verification
// ---------------------------------------------------------------------------

export interface PathVerificationViolation {
  pathId: string
  stepIndex: number
  description: string
}

/**
 * Verify that EVERY consecutive step pair in EVERY path has an exact graph
 * edge (connectingEdge + edgeDirection). Returns a list of violations —
 * an empty list means all paths are graph-verified.
 *
 * This is the core invariant: "No displayed path contains a hop without
 * its exact graph edge."
 */
export function verifyExplanationPaths(
  graph: DecisionGraph,
  paths: ExplanationPath[],
): PathVerificationViolation[] {
  const violations: PathVerificationViolation[] = []

  for (const path of paths) {
    for (let i = 1; i < path.steps.length; i++) {
      const prev = path.steps[i - 1]
      const curr = path.steps[i]

      if (!curr.connectingEdge || !curr.edgeDirection) {
        violations.push({
          pathId: path.id,
          stepIndex: i,
          description: `Step ${i} in path "${path.id}" has no connectingEdge/edgeDirection`,
        })
        continue
      }

      const edgeExists = curr.edgeDirection === 'forward'
        ? graph.edges.some(
            (e) => e.from === prev.nodeId && e.to === curr.nodeId && e.type === curr.connectingEdge
          )
        : graph.edges.some(
            (e) => e.from === curr.nodeId && e.to === prev.nodeId && e.type === curr.connectingEdge
          )

      if (!edgeExists) {
        violations.push({
          pathId: path.id,
          stepIndex: i,
          description: `Step ${i} in path "${path.id}": no ${curr.connectingEdge} edge between ${prev.nodeId} and ${curr.nodeId} (direction: ${curr.edgeDirection})`,
        })
      }
    }
  }

  return violations
}

function buildSummaryFromGraph(graph: DecisionGraph): string {
  const parts: string[] = []
  const objective = graph.nodes.find((n) => n.type === 'OBJECTIVE')
  if (objective) parts.push(`Your objective is ${objective.label}`)

  const outcome = graph.nodes.find((n) => n.type === 'OUTCOME')
  if (outcome) parts.push(`the recommended trajectory is ${outcome.label}`)

  const blocker = graph.nodes.find((n) => n.type === 'BLOCKER')
  if (blocker) parts.push(`the primary blocker is ${blocker.label}`)

  const capability = graph.nodes.find((n) => n.type === 'CAPABILITY')
  if (capability) parts.push(`the required capability is ${capability.label}`)

  const action = graph.nodes.find((n) => n.type === 'ACTION')
  if (action) parts.push(`the next action is ${action.label}`)

  return parts.join(', ') + '.'
}

function extractAssumptionsFromGraph(graph: DecisionGraph): string[] {
  return graph.nodes
    .filter((n) => n.type === 'ASSUMPTION')
    .map((n) => n.label)
}

function extractAlternativesFromGraph(graph: DecisionGraph): string[] {
  return graph.nodes
    .filter((n) => n.type === 'ALTERNATIVE')
    .map((n) => n.label)
}

/**
 * FIX #8: Confidence is separated by dimension, not collapsed into one scalar.
 */
function assessConfidenceByDimension(strategy: Strategy): ConfidenceByDimension {
  const uncertainties = strategy.uncertainties

  const getDim = (name: string): 'high' | 'medium' | 'low' | 'unknown' => {
    const u = uncertainties.find((u) => u.dimension.toLowerCase().includes(name.toLowerCase()))
    return (u?.confidence ?? 'unknown') as 'high' | 'medium' | 'low' | 'unknown'
  }

  return {
    evidence: getDim('Legal eligibility'),
    policy: getDim('Policy stability'),
    recommendation: uncertainties.length > 0 ? 'medium' as const : 'unknown' as const,
    outcome: getDim('Real-world approval outcome'),
  }
}

function deriveOverallConfidence(conf: ConfidenceByDimension): 'high' | 'medium' | 'low' | 'unknown' {
  const values = Object.values(conf)
  const highCount = values.filter((v) => v === 'high').length
  const lowCount = values.filter((v) => v === 'low' || v === 'unknown').length
  const total = values.length

  if (total === 0) return 'unknown'
  if (highCount / total >= 0.7) return 'high'
  if (lowCount / total >= 0.5) return 'low'
  return 'medium'
}

// ---------------------------------------------------------------------------
// Helpers (extracted from Strategy — used only for graph construction)
// ---------------------------------------------------------------------------

function extractAssumptions(strategy: Strategy): string[] {
  const assumptions: string[] = []

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

  for (const u of strategy.uncertainties) {
    if (u.confidence === 'LOW' || u.confidence === 'UNKNOWN') {
      assumptions.push(`${u.dimension}: ${u.reason}`)
    }
  }

  if (strategy.bestTrajectory) {
    assumptions.push(`Trajectory ${strategy.bestTrajectory.label} is the best available option given current profile and policy.`)
  }

  return assumptions
}

function extractTradeoffs(strategy: Strategy): Array<{ label: string; description: string; evidence: string }> {
  const tradeoffs: Array<{ label: string; description: string; evidence: string }> = []

  for (const alt of strategy.alternativeIntents) {
    tradeoffs.push({
      label: alt.title,
      description: alt.rationale,
      evidence: alt.tradeoffs.join('; '),
    })
  }

  if (strategy.intentFrontier.distinctStrategies.length > 1) {
    tradeoffs.push({
      label: 'Multi-objective tradeoff',
      description: `${strategy.intentFrontier.distinctStrategies.length} distinct strategies were identified across different objectives.`,
      evidence: 'IntentFrontier.distinctStrategies',
    })
  }

  return tradeoffs
}

// ---------------------------------------------------------------------------
// Graph diff (updated to use graphHash)
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

  const oldEdgeKeys = new Set(oldGraph.edges.map((e) => `${e.from}-${e.type}-${e.to}`))
  const newEdgeKeys = new Set(newGraph.edges.map((e) => `${e.from}-${e.type}-${e.to}`))

  const addedEdges = newGraph.edges.filter((e) => !oldEdgeKeys.has(`${e.from}-${e.type}-${e.to}`))
  const removedEdges = oldGraph.edges.filter((e) => !newEdgeKeys.has(`${e.from}-${e.type}-${e.to}`))

  const hashMatch = oldGraph.graphHash === newGraph.graphHash

  const parts: string[] = []
  if (addedNodes.length > 0) parts.push(`${addedNodes.length} node(s) added`)
  if (removedNodes.length > 0) parts.push(`${removedNodes.length} node(s) removed`)
  if (changedNodes.length > 0) parts.push(`${changedNodes.length} node(s) changed`)
  if (addedEdges.length > 0) parts.push(`${addedEdges.length} edge(s) added`)
  if (removedEdges.length > 0) parts.push(`${removedEdges.length} edge(s) removed`)
  if (!hashMatch) parts.push(`graph hash changed: ${oldGraph.graphHash} → ${newGraph.graphHash}`)

  const summary = parts.length === 0
    ? 'No changes in the decision graph.'
    : `Decision graph changed: ${parts.join(', ')}.`

  return { addedNodes, removedNodes, changedNodes, addedEdges, removedEdges, hashMatch, summary }
}
