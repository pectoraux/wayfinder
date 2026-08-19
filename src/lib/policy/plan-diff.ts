// Wayfinder — Deterministic Plan Diff
//
// Given two MobilityPlans (old and new), produce a structured PlanDiff.
// Computed entirely by code — the LLM never calculates the diff. The LLM
// may explain it afterward.

import type { MobilityPlan, Route, RouteScores } from '@/lib/domain/types'
import type { PlanDiff } from './types'

/** Compute a deterministic diff between two plan versions. */
export function diffPlans(oldPlan: MobilityPlan, newPlan: MobilityPlan): PlanDiff {
  const oldBest = oldPlan.routes.find((r) => r.id === oldPlan.recommendation.bestRouteId)
  const newBest = newPlan.routes.find((r) => r.id === newPlan.recommendation.bestRouteId)

  const bestRouteChanged = oldBest?.id !== newBest?.id

  // Routes opened (newly eligible) / closed (newly ineligible)
  const routesOpened: string[] = []
  const routesClosed: string[] = []
  const eligibilityChanges: PlanDiff['eligibilityChanges'] = []
  const scoreChanges: PlanDiff['scoreChanges'] = []
  const costChanges: PlanDiff['costChanges'] = []
  const timelineChanges: PlanDiff['timelineChanges'] = []
  const newBlockers: PlanDiff['newBlockers'] = []
  const resolvedBlockers: PlanDiff['resolvedBlockers'] = []

  // Build a map of old routes by id for comparison
  const oldRoutesMap = new Map(oldPlan.routes.map((r) => [r.id, r]))

  for (const newRoute of newPlan.routes) {
    const oldRoute = oldRoutesMap.get(newRoute.id)

    // Eligibility changes
    if (oldRoute) {
      if (oldRoute.eligibility.status !== newRoute.eligibility.status) {
        eligibilityChanges.push({
          routeId: newRoute.id,
          label: newRoute.label,
          oldStatus: oldRoute.eligibility.status,
          newStatus: newRoute.eligibility.status,
        })
        // Route opened if it became eligible
        if (oldRoute.eligibility.status !== 'eligible' && newRoute.eligibility.status === 'eligible') {
          routesOpened.push(newRoute.id)
        }
        // Route closed if it became ineligible
        if (oldRoute.eligibility.status !== 'ineligible' && newRoute.eligibility.status === 'ineligible') {
          routesClosed.push(newRoute.id)
        }
      }

      // Score changes (all score dimensions)
      for (const key of Object.keys(newRoute.scores) as (keyof RouteScores)[]) {
        const oldVal = oldRoute.scores[key] ?? 0
        const newVal = newRoute.scores[key] ?? 0
        if (oldVal !== newVal) {
          scoreChanges.push({
            routeId: newRoute.id,
            label: newRoute.label,
            field: key,
            oldValue: oldVal,
            newValue: newVal,
            delta: newVal - oldVal,
          })
        }
      }

      // Cost changes
      if (oldRoute.totalCostUSD !== newRoute.totalCostUSD) {
        costChanges.push({
          routeId: newRoute.id,
          label: newRoute.label,
          oldValue: oldRoute.totalCostUSD,
          newValue: newRoute.totalCostUSD,
          delta: newRoute.totalCostUSD - oldRoute.totalCostUSD,
        })
      }

      // Timeline changes
      if (oldRoute.totalMonths !== newRoute.totalMonths) {
        timelineChanges.push({
          routeId: newRoute.id,
          label: newRoute.label,
          oldMonths: oldRoute.totalMonths,
          newMonths: newRoute.totalMonths,
          delta: newRoute.totalMonths - oldRoute.totalMonths,
        })
      }

      // Blocker changes
      const oldBlockerLabels = new Set(oldRoute.eligibility.blockers.map((b) => b.label))
      const newBlockerLabels = new Set(newRoute.eligibility.blockers.map((b) => b.label))
      for (const nb of newRoute.eligibility.blockers) {
        if (!oldBlockerLabels.has(nb.label)) {
          newBlockers.push({ routeId: newRoute.id, label: newRoute.label, blocker: nb.label })
        }
      }
      for (const ob of oldRoute.eligibility.blockers) {
        if (!newBlockerLabels.has(ob.label)) {
          resolvedBlockers.push({ routeId: newRoute.id, label: newRoute.label, blocker: ob.label })
        }
      }
    } else {
      // New route that wasn't in the old plan
      if (newRoute.eligibility.status === 'eligible') {
        routesOpened.push(newRoute.id)
      }
    }
  }

  // Routes that disappeared (were in old but not new)
  const newRouteIds = new Set(newPlan.routes.map((r) => r.id))
  for (const oldRoute of oldPlan.routes) {
    if (!newRouteIds.has(oldRoute.id)) {
      routesClosed.push(oldRoute.id)
    }
  }

  return {
    bestRouteChanged,
    previousBestRoute: oldBest?.label,
    newBestRoute: newBest?.label,
    routesOpened,
    routesClosed,
    eligibilityChanges,
    scoreChanges,
    costChanges,
    timelineChanges,
    newBlockers,
    resolvedBlockers,
  }
}

/** Summarize a plan diff for display. */
export function summarizePlanDiff(diff: PlanDiff): string {
  const parts: string[] = []
  if (diff.bestRouteChanged) {
    parts.push(`Best route changed from ${diff.previousBestRoute ?? '—'} to ${diff.newBestRoute ?? '—'}.`)
  }
  if (diff.routesOpened.length > 0) {
    parts.push(`${diff.routesOpened.length} route(s) became newly eligible.`)
  }
  if (diff.routesClosed.length > 0) {
    parts.push(`${diff.routesClosed.length} route(s) became ineligible.`)
  }
  if (diff.newBlockers.length > 0) {
    parts.push(`${diff.newBlockers.length} new blocker(s) appeared.`)
  }
  if (diff.resolvedBlockers.length > 0) {
    parts.push(`${diff.resolvedBlockers.length} blocker(s) resolved.`)
  }
  return parts.length > 0 ? parts.join(' ') : 'No material changes.'
}
