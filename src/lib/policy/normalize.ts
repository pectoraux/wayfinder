// Wayfinder — Migration Adapter (Legacy Pathway → Normalized Program)
//
// The existing route engine (src/lib/engine/routes.ts) works against the
// legacy Pathway type. Rather than rewrite that working engine, this adapter
// lets both representations coexist:
//
//   - Legacy PATHWAYS (src/lib/knowledge/pathways.ts) → used by the route engine
//   - Normalized PROGRAMS (src/lib/policy/knowledge.ts) → used by the temporal
//     APIs (snapshot, diff, invalidation, impact)
//
// This adapter bridges them: given a legacy Pathway id, find the matching
// normalized Program (and vice versa). The mapping is 1:1 for v1 programs;
// v2 programs (the hypothetical future snapshot) have no legacy counterpart
// and are accessed only through the normalized APIs.

import type { Pathway } from '@/lib/domain/types'
import { PATHWAYS } from '@/lib/knowledge/pathways'
import type { ImmigrationProgram, NormalizedRequirement, NormalizedTransition, PolicySnapshot } from './types'
import { PROGRAMS, REQUIREMENTS, TRANSITIONS, getProgram } from './knowledge'
import { getCurrentPolicySnapshot } from './snapshot'

/** Map a legacy Pathway to its normalized Program under the current snapshot.
 *  For v1 programs the ids match exactly ('de-blue-card' → 'de-blue-card'). */
export function pathwayToProgram(pathway: Pathway, snapshotId?: string): ImmigrationProgram | undefined {
  const snap = snapshotId ? getCurrentPolicySnapshot() : undefined
  // Try exact id match first
  const exact = PROGRAMS.find((p) => p.id === pathway.id)
  if (exact) return exact
  // Fall back to jurisdiction + name match
  return PROGRAMS.find(
    (p) => p.jurisdictionId === pathway.countryCode && p.name === pathway.name,
  )
}

/** Map a normalized Program back to its legacy Pathway (for the route engine). */
export function programToPathway(program: ImmigrationProgram): Pathway | undefined {
  // v1 programs share ids with legacy pathways
  return PATHWAYS.find((p) => p.id === program.id || p.id === program.id.replace(/-v2$/, ''))
}

/** Get the normalized requirements for a legacy pathway, resolved against a
 *  specific snapshot. This is the bridge the route engine uses to thread
 *  asOfDate through eligibility evaluation. */
export function getNormalizedRequirementsForPathway(
  pathwayId: string,
  snapshotId: string,
): NormalizedRequirement[] {
  const program = getProgram(pathwayId) ?? PROGRAMS.find((p) => p.id === pathwayId.replace(/-v2$/, ''))
  if (!program) return []
  // For v2 programs, the program itself carries the v2 requirement ids.
  // For v1 programs accessed under a v2 snapshot, we swap in v2 requirements
  // where a supersedes relationship exists.
  const reqs = program.requirementIds
    .map((rid) => REQUIREMENTS.find((r) => r.id === rid))
    .filter((r): r is NormalizedRequirement => Boolean(r))

  if (snapshotId === program.policyVersionId) return reqs

  // If we're evaluating a v1 program under a v2 snapshot, swap superseded reqs
  return reqs.map((r) => {
    const v2 = REQUIREMENTS.find((x) => x.supersedesId === r.id && x.policyVersionId === snapshotId)
    return v2 ?? r
  })
}

/** Get the normalized transitions for a legacy pathway under a snapshot. */
export function getNormalizedTransitionsForPathway(
  pathwayId: string,
  _snapshotId: string,
): NormalizedTransition[] {
  const program = getProgram(pathwayId) ?? PROGRAMS.find((p) => p.id === pathwayId.replace(/-v2$/, ''))
  if (!program) return []
  return program.transitionIds
    .map((tid) => TRANSITIONS.find((t) => t.id === tid))
    .filter((t): t is NormalizedTransition => Boolean(t))
}

/** The snapshot a legacy pathway was originally computed under. */
export function getSnapshotForPathway(pathwayId: string): PolicySnapshot | undefined {
  const program = getProgram(pathwayId) ?? PROGRAMS.find((p) => p.id === pathwayId.replace(/-v2$/, ''))
  if (!program) return undefined
  return { id: program.policyVersionId } as PolicySnapshot
}
