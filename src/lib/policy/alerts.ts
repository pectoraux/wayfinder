// Wayfinder — Alert Generation Pipeline
//
// When a policy is published:
//   PolicyPublication → affected routes → affected active plans → impact
//   classification → alert candidates → materiality threshold → PolicyAlert
//
// Only MATERIAL impacts (ROUTE_DEGRADED, ROUTE_INVALIDATED, NEW_BETTER_ROUTE)
// produce user-facing alerts. NO_MATERIAL_CHANGE and MINOR_CHANGE do not.
//
// Deduplication: an idempotency key (userId + publicationId + planId +
// impactType) prevents duplicate alerts if the job runs twice.

import type { CandidateFact, PlanImpact, PlanImpactLevel, AlertSeverity } from './types'
import type { MobilityPlan, MobilityState, Intent } from '@/lib/domain/types'
import { buildPlan } from '@/lib/engine/optimize'
import { isRouteStillValid } from '@/lib/graph/mobility-graph'

// ---------------------------------------------------------------------------
// Severity mapping
// ---------------------------------------------------------------------------

/** Map a PlanImpactLevel to an AlertSeverity. */
export function severityForImpact(level: PlanImpactLevel): AlertSeverity {
  switch (level) {
    case 'ROUTE_INVALIDATED': return 'CRITICAL'
    case 'ROUTE_DEGRADED': return 'IMPORTANT'
    case 'NEW_BETTER_ROUTE': return 'NOTICE'
    case 'MINOR_CHANGE': return 'INFO'
    case 'NO_MATERIAL_CHANGE': return 'INFO'
  }
}

// ---------------------------------------------------------------------------
// Alert generation
// ---------------------------------------------------------------------------

export interface AlertCandidate {
  userId: string
  decisionRecordId: string
  policyPublicationId: string
  policyChangeId: string
  impact: PlanImpact
  idempotencyKey: string
  title: string
  whatChanged: string
  whyItMatters: string
  recommendedAction: string
  alternativeRoutes: string[]
  severity: AlertSeverity
}

/**
 * Generate alert candidates for a published policy change.
 *
 * @param publication   the published PolicyPublication
 * @param candidate     the CandidateFact that was approved
 * @param affectedPlans the user plans affected by this publication
 *                      (each with the user's state + intent + decisionRecordId + userId)
 * @returns             alert candidates (only MATERIAL impacts)
 */
export function generateAlertCandidates(
  publication: { id: string; contentHash: string },
  candidate: CandidateFact,
  affectedPlans: {
    userId: string
    decisionRecordId: string
    plan: MobilityPlan
    state: MobilityState
    intent: Intent
  }[],
): AlertCandidate[] {
  const alerts: AlertCandidate[] = []

  for (const ap of affectedPlans) {
    // Recompute the plan under the new policy
    const impact = recomputeImpact(ap.plan, ap.state, ap.intent, publication.id)

    // Only generate alerts for MATERIAL impacts
    if (impact.level === 'NO_MATERIAL_CHANGE' || impact.level === 'MINOR_CHANGE') {
      continue
    }

    const severity = severityForImpact(impact.level)
    const idempotencyKey = `${ap.userId}|${publication.id}|${ap.decisionRecordId}|${impact.level}`

    alerts.push({
      userId: ap.userId,
      decisionRecordId: ap.decisionRecordId,
      policyPublicationId: publication.id,
      policyChangeId: candidate.id,
      impact,
      idempotencyKey,
      title: buildAlertTitle(impact, candidate),
      whatChanged: impact.whatChanged,
      whyItMatters: impact.whyItMatters,
      recommendedAction: impact.recommendedAction,
      alternativeRoutes: impact.alternativesOpened,
      severity,
    })
  }

  return alerts
}

/** Recompute the impact of a policy change on a plan. */
function recomputeImpact(
  oldPlan: MobilityPlan,
  state: MobilityState,
  intent: Intent,
  _newPublicationId: string,
): PlanImpact {
  const oldBest = oldPlan.routes.find((r) => r.id === oldPlan.recommendation.bestRouteId)
  const oldSnapshotId = oldPlan.policySnapshotId ?? 'snap-2024-11'

  // Check if the old best route is still valid under the new snapshot
  // (using the code knowledge base; the DB overlay is applied at runtime)
  const invalidation = oldBest
    ? isRouteStillValid(
        { entryPathwayId: oldBest.entryPathwayId, eligibility: { evidenceIds: oldBest.evidenceIds } },
        oldSnapshotId,
        'snap-2026-01', // the latest snapshot (simplified — would use the new publication's version)
      )
    : null

  // Recompute the plan
  const newPlan = buildPlan(state, intent, [], oldPlan.asOfDate, true)
  const newBest = newPlan.routes[0]

  let level: PlanImpactLevel
  let whatChanged: string
  let whyItMatters: string
  let whatHappensToPlan: string
  const alternativesOpened: string[] = []
  const alternativesClosed: string[] = []
  let recommendedAction: string

  if (!invalidation || invalidation.valid) {
    if (newBest && oldBest && newBest.id !== oldBest.id) {
      level = 'NEW_BETTER_ROUTE'
      whatChanged = `Policy update changed the ranking. ${newBest.label} now ranks first.`
      whyItMatters = 'Your previous best route is still valid, but a better option emerged.'
      whatHappensToPlan = `Your plan shifts from ${oldBest.label} to ${newBest.label}.`
      alternativesOpened.push(newBest.label)
      recommendedAction = `Review the new best route: ${newBest.label}.`
    } else {
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
    if (newBest && newBest.id !== oldBest?.id) {
      level = 'ROUTE_INVALIDATED'
      whatChanged = `Your best route (${oldBest?.label}) was invalidated: ${invalidation.reasons.join(', ')}.`
      whyItMatters = 'The policy change made your planned route no longer viable under current rules.'
      whatHappensToPlan = `Your plan shifts from ${oldBest?.label} to ${newBest.label}.`
      alternativesOpened.push(newBest.label)
      recommendedAction = `Review the new recommended route: ${newBest.label}.`
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
    severity: severityForImpact(level),
  }
}

function buildAlertTitle(impact: PlanImpact, candidate: CandidateFact): string {
  const route = candidate.entityLabel
  switch (impact.level) {
    case 'ROUTE_INVALIDATED': return `Your ${route} route changed`
    case 'ROUTE_DEGRADED': return `Your ${route} route requirements tightened`
    case 'NEW_BETTER_ROUTE': return `A better route emerged after a policy update`
    default: return `Policy update: ${route}`
  }
}
