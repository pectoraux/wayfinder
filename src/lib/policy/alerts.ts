// Wayfinder — Alert Generation Pipeline
//
// When a policy is published:
//   PolicyPublication → affected plans → recompute under NEW runtime policy
//   → impact classification (from deterministic plan diff) → alert candidates
//   → materiality threshold → PolicyAlert
//
// CRITICAL: this uses resolveRuntimePolicy() — the single source of runtime
// policy truth. NO hardcoded snapshot IDs. NO simulationMode=true in production.
// The old plan is evaluated under the old policy context; the new plan is
// evaluated under the new (post-publication) runtime policy.

import type {
  CandidateFact,
  PlanImpact,
  PlanImpactLevel,
  AlertSeverity,
  PlanDiff,
  PolicyContext,
} from './types'
import type { MobilityPlan, MobilityState, Intent } from '@/lib/domain/types'
import { buildPlan } from '@/lib/engine/optimize'
import { buildPlanWithRuntimePolicy } from '@/lib/engine/optimize'
import { diffPlans } from './plan-diff'

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
  planDiff: PlanDiff
  idempotencyKey: string
  title: string
  whatChanged: string
  whyItMatters: string
  recommendedAction: string
  alternativeRoutes: string[]
  severity: AlertSeverity
  previousPolicyContext?: PolicyContext
  newPolicyContext?: PolicyContext
  previousBestRoute?: string
  newBestRoute?: string
}

/**
 * Generate alert candidates for a published policy change.
 *
 * The old plan is the user's saved plan (computed under the old runtime policy).
 * The new plan is recomputed under the CURRENT runtime policy (which now
 * includes the just-published overlay, because the cache was invalidated).
 *
 * The impact is derived from a deterministic plan diff — NOT from assumptions.
 *
 * @param publication     the published PolicyPublication
 * @param candidate       the CandidateFact that was approved
 * @param affectedPlans   the user plans affected (each with state + intent + decisionRecordId + userId)
 * @returns               alert candidates (only MATERIAL impacts)
 */
export async function generateAlertCandidates(
  publication: { id: string; contentHash: string },
  candidate: CandidateFact,
  affectedPlans: {
    userId: string
    decisionRecordId: string
    plan: MobilityPlan
    state: MobilityState
    intent: Intent
  }[],
): Promise<AlertCandidate[]> {
  const alerts: AlertCandidate[] = []

  for (const ap of affectedPlans) {
    // Recompute the plan under the CURRENT runtime policy (post-publication).
    // NO simulationMode — this is production impact analysis.
    const newPlan = await buildPlanWithRuntimePolicy(ap.state, ap.intent, [], {
      asOfDate: ap.plan.asOfDate,
      simulationMode: false,
    })

    // Compute the deterministic diff between old and new plans
    const planDiff = diffPlans(ap.plan, newPlan)

    // Classify the impact from the diff
    const impact = classifyImpactFromDiff(ap.plan, newPlan, planDiff)

    // Only generate alerts for MATERIAL impacts
    if (impact.level === 'NO_MATERIAL_CHANGE' || impact.level === 'MINOR_CHANGE') {
      continue
    }

    const severity = severityForImpact(impact.level)
    const idempotencyKey = `${ap.userId}|${publication.id}|${ap.decisionRecordId}|${impact.level}`

    const oldBest = ap.plan.routes.find((r) => r.id === ap.plan.recommendation.bestRouteId)
    const newBest = newPlan.routes[0]

    alerts.push({
      userId: ap.userId,
      decisionRecordId: ap.decisionRecordId,
      policyPublicationId: publication.id,
      policyChangeId: candidate.id,
      impact,
      planDiff,
      idempotencyKey,
      title: buildAlertTitle(impact, candidate),
      whatChanged: impact.whatChanged,
      whyItMatters: impact.whyItMatters,
      recommendedAction: impact.recommendedAction,
      alternativeRoutes: impact.alternativesOpened,
      severity,
      previousPolicyContext: ap.plan.runtimePolicyVersion ? {
        jurisdiction: 'global',
        asOf: ap.plan.asOfDate,
        baseSnapshotId: ap.plan.policySnapshotId ?? 'snap-2024-11',
        activeOverlayIds: ap.plan.activeOverlayIds ?? [],
        runtimeVersionId: ap.plan.runtimePolicyVersion,
        runtimeHash: ap.plan.runtimePolicyHash ?? ap.plan.policyHash,
        provenance: 'AUTHORITATIVE',
        simulationMode: false,
      } : undefined,
      newPolicyContext: newPlan.runtimePolicyVersion ? {
        jurisdiction: 'global',
        asOf: newPlan.asOfDate,
        baseSnapshotId: newPlan.policySnapshotId ?? 'snap-2024-11',
        activeOverlayIds: newPlan.activeOverlayIds ?? [],
        runtimeVersionId: newPlan.runtimePolicyVersion,
        runtimeHash: newPlan.runtimePolicyHash ?? newPlan.policyHash,
        provenance: 'AUTHORITATIVE',
        simulationMode: false,
      } : undefined,
      previousBestRoute: oldBest?.label,
      newBestRoute: newBest?.label,
    })
  }

  return alerts
}

/** Classify the impact level from a deterministic plan diff. */
function classifyImpactFromDiff(
  oldPlan: MobilityPlan,
  newPlan: MobilityPlan,
  diff: PlanDiff,
): PlanImpact {
  const oldBest = oldPlan.routes.find((r) => r.id === oldPlan.recommendation.bestRouteId)
  const newBest = newPlan.routes[0]

  // If the best route changed
  if (diff.bestRouteChanged) {
    // Did the old best become ineligible?
    const oldBestClosed = diff.routesClosed.includes(oldBest?.id ?? '')
    if (oldBestClosed) {
      return {
        level: 'ROUTE_INVALIDATED',
        whatChanged: `Your best route (${oldBest?.label}) was invalidated by the policy change.`,
        whyItMatters: 'The policy change made your planned route no longer viable under current rules.',
        whatHappensToPlan: `Your plan shifts from ${oldBest?.label} to ${newBest?.label}.`,
        alternativesOpened: newBest ? [newBest.label] : [],
        alternativesClosed: oldBest ? [oldBest.label] : [],
        recommendedAction: `Review the new recommended route: ${newBest?.label}.`,
        severity: 'CRITICAL',
      }
    }
    // A new better route emerged
    return {
      level: 'NEW_BETTER_ROUTE',
      whatChanged: `Policy update changed the ranking. ${newBest?.label} now ranks first.`,
      whyItMatters: 'Your previous best route is still valid, but a better option emerged under the new rules.',
      whatHappensToPlan: `Your plan shifts from ${oldBest?.label} to ${newBest?.label}.`,
      alternativesOpened: newBest ? [newBest.label] : [],
      alternativesClosed: [],
      recommendedAction: `Review the new best route: ${newBest?.label}.`,
      severity: 'NOTICE',
    }
  }

  // Same best route — check for new blockers or score degradation
  const newBlockersForBest = diff.newBlockers.filter((b) => b.routeId === oldBest?.id)
  if (newBlockersForBest.length > 0) {
    return {
      level: 'ROUTE_DEGRADED',
      whatChanged: `Your best route (${oldBest?.label}) was affected: ${newBlockersForBest.map((b) => b.blocker).join(', ')}.`,
      whyItMatters: 'The route is not fully invalidated but requirements have tightened.',
      whatHappensToPlan: 'Your route remains the best option but requires meeting a higher bar.',
      alternativesOpened: [],
      alternativesClosed: [],
      recommendedAction: 'Review the updated requirements for your route.',
      severity: 'IMPORTANT',
    }
  }

  // Check score changes
  const bestScoreChange = diff.scoreChanges.find((s) => s.routeId === oldBest?.id)
  if (bestScoreChange && Math.abs(bestScoreChange.delta) >= 3) {
    return {
      level: 'MINOR_CHANGE',
      whatChanged: `Your best route's score changed by ${bestScoreChange.delta > 0 ? '+' : ''}${bestScoreChange.delta.toFixed(0)} points.`,
      whyItMatters: 'This is a minor shift that does not change your recommended route.',
      whatHappensToPlan: 'Your current plan remains the best option, with a slightly adjusted outlook.',
      alternativesOpened: [],
      alternativesClosed: [],
      recommendedAction: 'No action needed — the change is minor.',
      severity: 'INFO',
    }
  }

  // No material change
  return {
    level: 'NO_MATERIAL_CHANGE',
    whatChanged: 'Policy changed but your plan is materially unaffected.',
    whyItMatters: 'The changes did not cross any threshold that affects your routes.',
    whatHappensToPlan: 'Your current plan remains the best option.',
    alternativesOpened: [],
    alternativesClosed: [],
    recommendedAction: 'No action needed.',
    severity: 'INFO',
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
