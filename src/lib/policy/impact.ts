// Wayfinder — Plan Recomputation & Impact Analysis
//
// When a verified policy change is published, recompute affected plans and
// classify the impact:
//   NO_MATERIAL_CHANGE | MINOR_CHANGE | ROUTE_DEGRADED | ROUTE_INVALIDATED | NEW_BETTER_ROUTE
//
// Only MATERIAL changes (ROUTE_DEGRADED, ROUTE_INVALIDATED, NEW_BETTER_ROUTE)
// generate user-facing alerts. NO_MATERIAL_CHANGE and MINOR_CHANGE do not.

import type { CandidateFact, PlanImpact, PlanImpactLevel } from './types'
import type { MobilityPlan, MobilityState, Intent } from '@/lib/domain/types'
import { buildPlan } from '@/lib/engine/optimize'
import { isRouteStillValid } from '@/lib/graph/mobility-graph'

/**
 * Recompute a plan under a new policy snapshot and classify the impact.
 *
 * @param oldPlan       the user's saved plan (computed under the old snapshot)
 * @param state         the user's mobility state
 * @param intent        the user's intent
 * @param newSnapshotId the new policy snapshot to evaluate against
 * @returns             a PlanImpact describing what changed and what to do
 */
export function recomputePlanImpact(
  oldPlan: MobilityPlan,
  state: MobilityState,
  intent: Intent,
  newSnapshotId: string,
): PlanImpact {
  const oldSnapshotId = oldPlan.policySnapshotId ?? 'snap-2024-11'
  const oldBest = oldPlan.routes.find((r) => r.id === oldPlan.recommendation.bestRouteId)

  // Check if the old best route is still valid under the new snapshot
  const invalidation = oldBest
    ? isRouteStillValid(
        { entryPathwayId: oldBest.entryPathwayId, eligibility: { evidenceIds: oldBest.evidenceIds } },
        oldSnapshotId,
        newSnapshotId,
      )
    : null

  // Recompute the plan under the new snapshot
  // Note: buildPlan uses the code knowledge base; for DB-published versions
  // this would load the published requirements. For this milestone, the
  // impact is assessed against the code knowledge base.
  const newPlan = buildPlan(state, intent, [], oldPlan.asOfDate, true)
  const newBest = newPlan.routes[0]

  // Classify the impact
  let level: PlanImpactLevel
  let whatChanged: string
  let whyItMatters: string
  let whatHappensToPlan: string
  const alternativesOpened: string[] = []
  const alternativesClosed: string[] = []
  let recommendedAction: string

  if (!invalidation || invalidation.valid) {
    // Old best route is still valid — check if the ranking changed
    if (newBest && oldBest && newBest.id !== oldBest.id) {
      level = 'NEW_BETTER_ROUTE'
      whatChanged = `Policy update changed the ranking. A new route (${newBest.label}) now ranks first.`
      whyItMatters = 'Your previous best route is still valid, but a better option emerged under the new rules.'
      whatHappensToPlan = `Your plan shifts from ${oldBest.label} to ${newBest.label}.`
      alternativesOpened.push(newBest.label)
      recommendedAction = `Review the new best route: ${newBest.label}.`
    } else {
      // Same best route, check if scores changed materially
      const oldScore = oldBest?.scores.riskAdjusted ?? 0
      const newScore = newBest?.scores.riskAdjusted ?? 0
      const delta = newScore - oldScore
      if (Math.abs(delta) < 3) {
        level = 'NO_MATERIAL_CHANGE'
        whatChanged = 'Policy changed but your plan is materially unaffected.'
        whyItMatters = 'The changes did not cross any threshold that affects your routes.'
        whatHappensToPlan = 'Your current plan remains the best option.'
        recommendedAction = 'No action needed.'
      } else {
        level = 'MINOR_CHANGE'
        whatChanged = `Your best route's risk-adjusted score changed by ${delta > 0 ? '+' : ''}${delta.toFixed(0)} points.`
        whyItMatters = 'This is a minor shift that does not change your recommended route.'
        whatHappensToPlan = 'Your current plan remains the best option, with a slightly adjusted outlook.'
        recommendedAction = 'No action needed — the change is minor.'
      }
    }
  } else {
    // Old best route is invalidated
    if (newBest && newBest.id !== oldBest?.id) {
      level = 'ROUTE_INVALIDATED'
      whatChanged = `Your best route (${oldBest?.label}) was invalidated: ${invalidation.reasons.join(', ')}.`
      whyItMatters = 'The policy change made your planned route no longer viable under current rules.'
      whatHappensToPlan = `Your plan shifts from ${oldBest?.label} to ${newBest.label}.`
      alternativesOpened.push(newBest.label)
      recommendedAction = `Review the new recommended route: ${newBest.label}.`
      // Old route is now closed
      if (oldBest) alternativesClosed.push(oldBest.label)
    } else {
      level = 'ROUTE_DEGRADED'
      whatChanged = `Your best route (${oldBest?.label}) was affected: ${invalidation.reasons.join(', ')}.`
      whyItMatters = 'The route is not fully invalidated but requirements have tightened.'
      whatHappensToPlan = 'Your route remains the best option but requires meeting a higher bar.'
      recommendedAction = 'Review the updated requirements for your route.'
    }
  }

  return {
    level,
    whatChanged,
    whyItMatters,
    whatHappensToPlan,
    alternativesOpened,
    alternativesClosed,
    recommendedAction,
  }
}

/**
 * Determine whether an impact is material enough to notify the user.
 * Only ROUTE_DEGRADED, ROUTE_INVALIDATED, and NEW_BETTER_ROUTE produce
 * user-facing alerts. NO_MATERIAL_CHANGE and MINOR_CHANGE do not.
 */
export function isMaterialImpact(level: PlanImpactLevel): boolean {
  return level === 'ROUTE_DEGRADED' || level === 'ROUTE_INVALIDATED' || level === 'NEW_BETTER_ROUTE'
}

/**
 * Given a candidate fact that was approved, find which saved decision records
 * are potentially affected. Returns their ids.
 */
export function getAffectedDecisionRecordIds(
  candidate: CandidateFact,
  decisionRecords: { id: string; policyVersion: string; asOfDate: string }[],
): string[] {
  // A decision record is potentially affected if it was computed under a
  // snapshot that the new publication supersedes. For this milestone, we
  // check if the record's policy version differs from the candidate's
  // effective date — a simplified heuristic.
  const candidateEffectiveDate = candidate.effectiveFrom ?? new Date().toISOString()
  return decisionRecords
    .filter((r) => new Date(r.asOfDate).getTime() < new Date(candidateEffectiveDate).getTime())
    .map((r) => r.id)
}
