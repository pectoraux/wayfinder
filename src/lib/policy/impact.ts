// Wayfinder — Plan Recomputation & Impact Analysis
//
// When a verified policy change is published, recompute affected plans and
// classify the impact. CRITICAL: uses resolveRuntimePolicy (the runtime
// resolver) — NO hardcoded snapshot IDs, NO simulationMode=true.
//
// Only MATERIAL changes (ROUTE_DEGRADED, ROUTE_INVALIDATED, NEW_BETTER_ROUTE)
// generate user-facing alerts. NO_MATERIAL_CHANGE and MINOR_CHANGE do not.

import type { CandidateFact, PlanImpact, PlanImpactLevel } from './types'
import type { MobilityPlan, MobilityState, Intent } from '@/lib/domain/types'
import { buildPlanWithRuntimePolicy } from '@/lib/engine/optimize'
import { diffPlans } from './plan-diff'

/**
 * Recompute a plan under the CURRENT runtime policy (post-publication) and
 * classify the impact using a deterministic plan diff.
 *
 * NO hardcoded snapshot IDs. NO simulationMode=true. The new plan is computed
 * under the same runtime policy that the route engine uses.
 *
 * @param oldPlan  the user's saved plan (computed under the old policy)
 * @param state    the user's mobility state
 * @param intent   the user's intent
 * @returns        the recomputed plan + the impact classification
 */
export async function recomputePlanImpact(
  oldPlan: MobilityPlan,
  state: MobilityState,
  intent: Intent,
): Promise<{ newPlan: MobilityPlan; impact: PlanImpact }> {
  // Recompute under the CURRENT runtime policy (post-publication, cache invalidated).
  // simulationMode = false — this is production impact analysis.
  const newPlan = await buildPlanWithRuntimePolicy(state, intent, [], {
    asOfDate: oldPlan.asOfDate,
    simulationMode: false,
  })

  // Compute the deterministic diff
  const diff = diffPlans(oldPlan, newPlan)

  // Classify the impact from the diff
  const oldBest = oldPlan.routes.find((r) => r.id === oldPlan.recommendation.bestRouteId)
  const newBest = newPlan.routes.find((r) => r.id === newPlan.recommendation.bestRouteId)

  let level: PlanImpactLevel
  let whatChanged: string
  let whyItMatters: string
  let whatHappensToPlan: string
  const alternativesOpened: string[] = []
  const alternativesClosed: string[] = []
  let recommendedAction: string

  if (diff.bestRouteChanged) {
    const oldBestClosed = diff.routesClosed.includes(oldBest?.id ?? '')
    if (oldBestClosed) {
      level = 'ROUTE_INVALIDATED'
      whatChanged = `Your best route (${oldBest?.label}) was invalidated by the policy change.`
      whyItMatters = 'The policy change made your planned route no longer viable under current rules.'
      whatHappensToPlan = `Your plan shifts from ${oldBest?.label} to ${newBest?.label}.`
      alternativesOpened.push(newBest?.label ?? '')
      alternativesClosed.push(oldBest?.label ?? '')
      recommendedAction = `Review the new recommended route: ${newBest?.label}.`
    } else {
      level = 'NEW_BETTER_ROUTE'
      whatChanged = `Policy update changed the ranking. ${newBest?.label} now ranks first.`
      whyItMatters = 'Your previous best route is still valid, but a better option emerged under the new rules.'
      whatHappensToPlan = `Your plan shifts from ${oldBest?.label} to ${newBest?.label}.`
      alternativesOpened.push(newBest?.label ?? '')
      recommendedAction = `Review the new best route: ${newBest?.label}.`
    }
  } else {
    // Same best route — check for new blockers
    const newBlockersForBest = diff.newBlockers.filter((b) => b.routeId === oldBest?.id)
    if (newBlockersForBest.length > 0) {
      level = 'ROUTE_DEGRADED'
      whatChanged = `Your best route (${oldBest?.label}) was affected: ${newBlockersForBest.map((b) => b.blocker).join(', ')}.`
      whyItMatters = 'The route is not fully invalidated but requirements have tightened.'
      whatHappensToPlan = 'Your route remains the best option but requires meeting a higher bar.'
      recommendedAction = 'Review the updated requirements for your route.'
    } else {
      // Check score changes
      const bestScoreChange = diff.scoreChanges.find((s) => s.routeId === oldBest?.id)
      if (bestScoreChange && Math.abs(bestScoreChange.delta) >= 3) {
        level = 'MINOR_CHANGE'
        whatChanged = `Your best route's score changed by ${bestScoreChange.delta > 0 ? '+' : ''}${bestScoreChange.delta.toFixed(0)} points.`
        whyItMatters = 'This is a minor shift that does not change your recommended route.'
        whatHappensToPlan = 'Your current plan remains the best option, with a slightly adjusted outlook.'
        recommendedAction = 'No action needed — the change is minor.'
      } else {
        level = 'NO_MATERIAL_CHANGE'
        whatChanged = 'Policy changed but your plan is materially unaffected.'
        whyItMatters = 'The changes did not cross any threshold that affects your routes.'
        whatHappensToPlan = 'Your current plan remains the best option.'
        recommendedAction = 'No action needed.'
      }
    }
  }

  return {
    newPlan,
    impact: {
      level,
      whatChanged,
      whyItMatters,
      whatHappensToPlan,
      alternativesOpened,
      alternativesClosed,
      recommendedAction,
    },
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
  const candidateEffectiveDate = candidate.effectiveFrom ?? new Date().toISOString()
  return decisionRecords
    .filter((r) => new Date(r.asOfDate).getTime() < new Date(candidateEffectiveDate).getTime())
    .map((r) => r.id)
}
