// Wayfinder — Mobility Graph Abstraction
//
// A graph over ImmigrationStatus nodes connected by NormalizedTransition edges.
// This is a domain-layer abstraction implemented in TypeScript over the
// normalized knowledge base. The storage layer (TS modules today, a graph DB
// later) is hidden behind this interface, so it can be replaced without
// touching the route engine.
//
// Operations:
//   getNeighbors(statusId, snapshotId)  — statuses reachable in one transition
//   findPaths(fromStatusId, toStatusId, snapshotId) — all simple paths
//   getTransitions(statusId, snapshotId) — outgoing transitions
//   getRequirements(programId, snapshotId) — entry requirements for a program

import type {
  ImmigrationProgram,
  ImmigrationStatus,
  NormalizedRequirement,
  NormalizedTransition,
} from '@/lib/policy/types'
import {
  PROGRAMS,
  REQUIREMENTS,
  STATUSES,
  TRANSITIONS,
  getProgram,
  getStatus,
  getSnapshot as getSnapshotSafe,
} from '@/lib/policy/knowledge'
import type { PolicySnapshot } from '@/lib/policy/types'
import { getProgramsInSnapshot, getRequirementsInSnapshot, getTransitionsInSnapshot } from '@/lib/policy/snapshot'

export interface MobilityGraph {
  snapshot: PolicySnapshot
  statuses: ImmigrationStatus[]
  transitions: NormalizedTransition[]
  programs: ImmigrationProgram[]
  requirements: NormalizedRequirement[]
}

/** Build the graph for a snapshot. */
export function buildGraph(snapshotId: string): MobilityGraph {
  const snapshot = getSnapshotSafe(snapshotId)
  return {
    snapshot,
    statuses: STATUSES,
    transitions: getTransitionsInSnapshot(snapshotId),
    programs: getProgramsInSnapshot(snapshotId),
    requirements: getRequirementsInSnapshot(snapshotId),
  }
}

/** Outgoing transitions from a status in this snapshot. */
export function getTransitions(graph: MobilityGraph, statusId: string): NormalizedTransition[] {
  return graph.transitions.filter((t) => t.fromStatusId === statusId)
}

/** Statuses directly reachable from a status. */
export function getNeighbors(graph: MobilityGraph, statusId: string): ImmigrationStatus[] {
  const outgoing = getTransitions(graph, statusId)
  return outgoing
    .map((t) => getStatus(t.toStatusId))
    .filter((s): s is ImmigrationStatus => Boolean(s))
}

/** Entry requirements for a program (resolved against the snapshot). */
export function getRequirements(graph: MobilityGraph, programId: string): NormalizedRequirement[] {
  const program = graph.programs.find((p) => p.id === programId) ?? getProgram(programId)
  if (!program) return []
  return program.requirementIds
    .map((rid) => graph.requirements.find((r) => r.id === rid) ?? REQUIREMENTS.find((r) => r.id === rid))
    .filter((r): r is NormalizedRequirement => Boolean(r))
}

/** All simple paths (no repeated nodes) from one status to another.
 *  BFS with path tracking; capped at maxDepth to bound the search. */
export function findPaths(
  graph: MobilityGraph,
  fromStatusId: string,
  toStatusId: string,
  maxDepth = 6,
): NormalizedTransition[][] {
  if (fromStatusId === toStatusId) return [[]]
  const results: NormalizedTransition[][] = []
  const queue: { statusId: string; path: NormalizedTransition[] }[] = [{ statusId: fromStatusId, path: [] }]

  while (queue.length > 0) {
    const { statusId, path } = queue.shift()!
    if (path.length >= maxDepth) continue
    const outgoing = getTransitions(graph, statusId)
    for (const t of outgoing) {
      if (path.some((p) => p.id === t.id)) continue // don't repeat edges
      if (path.some((p) => p.fromStatusId === t.toStatusId || p.toStatusId === t.toStatusId) && t.toStatusId === fromStatusId) continue
      const newPath = [...path, t]
      if (t.toStatusId === toStatusId) {
        results.push(newPath)
      } else if (!path.some((p) => p.toStatusId === t.toStatusId)) {
        queue.push({ statusId: t.toStatusId, path: newPath })
      }
    }
  }
  return results
}

/** All statuses reachable from a given status (transitive closure). */
export function getReachableStatuses(graph: MobilityGraph, fromStatusId: string): Set<string> {
  const visited = new Set<string>()
  const queue = [fromStatusId]
  while (queue.length > 0) {
    const s = queue.shift()!
    if (visited.has(s)) continue
    visited.add(s)
    for (const t of getTransitions(graph, s)) {
      if (!visited.has(t.toStatusId)) queue.push(t.toStatusId)
    }
  }
  visited.delete(fromStatusId)
  return visited
}

// ---------------------------------------------------------------------------
// Route invalidation — does a route computed under one snapshot survive a
// newer snapshot?
// ---------------------------------------------------------------------------

import type { RouteInvalidation, InvalidationReason } from '@/lib/policy/types'
import { comparePolicySnapshots } from '@/lib/policy/snapshot'

/**
 * Given a route (its entry program + transitions) computed under
 * `originalSnapshotId`, determine whether it is still valid under
 * `currentSnapshotId`.
 */
export function isRouteStillValid(
  route: { entryPathwayId: string; eligibility: { evidenceIds: string[] } },
  originalSnapshotId: string,
  currentSnapshotId: string,
): RouteInvalidation {
  const reasons: InvalidationReason[] = []
  const affectedEntityIds: string[] = []
  let effectiveFrom: string | undefined
  const alternativeRouteIds: string[] = []

  const diff = comparePolicySnapshots(originalSnapshotId, currentSnapshotId)

  // Map the route's program to its normalized id. Legacy pathways use ids like
  // 'de-blue-card' which match the v1 program id; v2 programs append '-v2'.
  const programId = route.entryPathwayId
  const program = PROGRAMS.find((p) => p.id === programId)
  if (!program) {
    return {
      valid: false,
      reasons: ['POLICY_VERSION_OUTDATED'],
      description: `Program ${programId} not found in the normalized knowledge base; cannot validate.`,
      affectedEntityIds: [programId],
      alternativeRouteIds,
    }
  }

  // Check the program's status under the current snapshot
  const currentProgram = PROGRAMS.find(
    (p) => p.jurisdictionId === program.jurisdictionId && p.name === program.name && p.policyVersionId === currentSnapshotId,
  ) ?? program

  if (currentProgram.status === 'suspended' && program.status === 'active') {
    reasons.push('PROGRAM_SUSPENDED')
    affectedEntityIds.push(currentProgram.id)
    effectiveFrom = currentProgram.effectiveFrom
  }
  if (currentProgram.status === 'closed') {
    reasons.push('PROGRAM_CLOSED')
    affectedEntityIds.push(currentProgram.id)
  }

  // Check requirement changes affecting this program.
  // A change's entityId may be a v2 requirement (e.g. req-de-bc-salary-v2)
  // that supersedes a v1 requirement the program references. Match via the
  // supersedes chain.
  const programReqIds = new Set(program.requirementIds)
  const reqAffectsProgram = (changeEntityId: string): boolean => {
    if (programReqIds.has(changeEntityId)) return true
    // Check if the change entity supersedes a requirement the program uses
    const changedReq = REQUIREMENTS.find((r) => r.id === changeEntityId)
    if (changedReq?.supersedesId && programReqIds.has(changedReq.supersedesId)) return true
    // Check if the change entity is superseded by a requirement the program uses
    const supersededBy = REQUIREMENTS.find((r) => r.supersedesId === changeEntityId)
    if (supersededBy && programReqIds.has(supersededBy.id)) return true
    return false
  }

  for (const change of diff.changes) {
    if (change.kind === 'PROGRAM_SUSPENDED' && change.entityId === currentProgram.id) {
      // already captured above
      continue
    }
    // Match requirement changes that affect this program (via supersedes chain)
    if (change.kind === 'THRESHOLD_CHANGED' || change.kind === 'RULE_CHANGED' || change.kind === 'REQUIREMENT_REMOVED' || change.kind === 'REQUIREMENT_ADDED') {
      if (!reqAffectsProgram(change.entityId)) continue
      if (change.kind === 'THRESHOLD_CHANGED') {
        const oldAmount = (change.oldValue as any)?.amount
        const newAmount = (change.newValue as any)?.amount
        if (typeof oldAmount === 'number' && typeof newAmount === 'number' && newAmount > oldAmount) {
          reasons.push('THRESHOLD_RAISED')
        } else {
          reasons.push('REQUIREMENT_CHANGED')
        }
        affectedEntityIds.push(change.entityId)
        effectiveFrom = change.effectiveFrom
      } else if (change.kind === 'REQUIREMENT_REMOVED') {
        reasons.push('REQUIREMENT_REMOVED')
        affectedEntityIds.push(change.entityId)
      } else if (change.kind === 'RULE_CHANGED') {
        reasons.push('REQUIREMENT_CHANGED')
        affectedEntityIds.push(change.entityId)
        effectiveFrom = change.effectiveFrom
      }
    }
    // Transition removed affecting this program
    if (change.kind === 'TRANSITION_REMOVED') {
      const programTransitionIds = new Set(program.transitionIds)
      if (programTransitionIds.has(change.entityId)) {
        reasons.push('TRANSITION_REMOVED')
        affectedEntityIds.push(change.entityId)
      }
    }
  }

  // Find alternative routes: programs for the same jurisdiction that are still
  // active under the current snapshot. We consider BOTH v2 programs (if they
  // exist for this jurisdiction) AND v1 programs that haven't been superseded
  // (i.e. no v2 replacement was published — they remain in force).
  if (reasons.length > 0) {
    const sameJurisdiction = PROGRAMS.filter(
      (p) => p.jurisdictionId === program.jurisdictionId && p.id !== program.id && p.id !== currentProgram.id,
    )
    // A v1 program is still valid under v2 if no v2 program supersedes it.
    // We detect supersession by name match: if a v2 program with the same name
    // exists, the v1 program was superseded (replaced or suspended).
    const isV1Superseded = (p: typeof program): boolean => {
      return PROGRAMS.some(
        (x) => x.policyVersionId === currentSnapshotId && x.name === p.name && x.jurisdictionId === p.jurisdictionId,
      )
    }
    const alts = sameJurisdiction.filter((p) => {
      if (p.policyVersionId === currentSnapshotId) return p.status === 'active'
      // v1 program: include only if not superseded and still active
      return p.status === 'active' && !isV1Superseded(p)
    })
    alternativeRouteIds.push(...alts.map((p) => `route-${p.id.replace(/-v2$/, '')}`))
  }

  const valid = reasons.length === 0
  const description = valid
    ? 'Route is still valid under the current policy snapshot.'
    : `Route invalidated: ${reasons.join(', ')}${effectiveFrom ? ` (effective ${effectiveFrom})` : ''}.`

  return { valid, reasons, description, affectedEntityIds, effectiveFrom, alternativeRouteIds }
}

/** Convenience: reasons only. */
export function getRouteInvalidationReasons(
  route: { entryPathwayId: string; eligibility: { evidenceIds: string[] } },
  originalSnapshotId: string,
  currentSnapshotId: string,
): InvalidationReason[] {
  return isRouteStillValid(route, originalSnapshotId, currentSnapshotId).reasons
}

// ---------------------------------------------------------------------------
// Impact analysis
// ---------------------------------------------------------------------------

import type { PolicyChange, PolicyImpact } from '@/lib/policy/types'

/** Given a policy change, find which routes (programs) are affected. */
export function getAffectedRoutes(change: PolicyChange): string[] {
  // A route is identified by its program id (legacy form: route-<programId>)
  // Map normalized program ids to route ids.
  const affected: string[] = []

  if (change.kind.startsWith('PROGRAM_')) {
    // The program itself changed
    affected.push(`route-${change.entityId.replace(/-v2$/, '')}`)
  }
  if (change.kind === 'THRESHOLD_CHANGED' || change.kind === 'RULE_CHANGED' || change.kind === 'REQUIREMENT_REMOVED' || change.kind === 'REQUIREMENT_ADDED') {
    // Find programs that reference this requirement
    for (const p of PROGRAMS) {
      if (p.requirementIds.includes(change.entityId) || p.requirementIds.includes(change.entityId.replace(/-v2$/, '-v1'))) {
        affected.push(`route-${p.id.replace(/-v2$/, '')}`)
      }
    }
  }
  if (change.kind === 'TRANSITION_ADDED' || change.kind === 'TRANSITION_REMOVED') {
    for (const p of PROGRAMS) {
      if (p.transitionIds.includes(change.entityId)) {
        affected.push(`route-${p.id.replace(/-v2$/, '')}`)
      }
    }
  }
  return Array.from(new Set(affected))
}

/** Given a policy change, find affected transitions. */
export function getAffectedTransitions(change: PolicyChange): string[] {
  if (change.kind.startsWith('TRANSITION_')) return [change.entityId]
  if (change.kind === 'PROGRAM_SUSPENDED' || change.kind === 'PROGRAM_CLOSED' || change.kind === 'PROGRAM_REMOVED') {
    const p = PROGRAMS.find((x) => x.id === change.entityId)
    return p?.transitionIds ?? []
  }
  return []
}

/** Full impact of a policy change. decisionRecords is an optional list of
 *  saved DecisionRecord.asOfDate/policyVersion pairs to check against. */
export function getPolicyImpact(
  change: PolicyChange,
  decisionRecords: { id: string; policyVersion: string; asOfDate: string }[] = [],
): PolicyImpact {
  const affectedRouteIds = getAffectedRoutes(change)
  const affectedTransitionIds = getAffectedTransitions(change)

  // A decision record is affected if it was computed under a snapshot that the
  // change supersedes. We use the policy version string as a proxy.
  const affectedDecisionRecordIds = decisionRecords
    .filter((d) => d.policyVersion !== change.effectiveFrom) // simplified
    .map((d) => d.id)

  const summary = `${change.kind} on ${change.entityLabel}: ${affectedRouteIds.length} route(s), ${affectedTransitionIds.length} transition(s), ${affectedDecisionRecordIds.length} decision record(s) affected.`

  return { policyChange: change, affectedRouteIds, affectedTransitionIds, affectedDecisionRecordIds, summary }
}
