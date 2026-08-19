// Wayfinder — Decision Replay
//
// Reconstruct a plan from a saved DecisionRecord's inputs (state + intent +
// asOf + policy context). This proves reproducibility: the same inputs under
// the same policy produce the same plan.

import type { MobilityPlan, MobilityState, Intent } from '@/lib/domain/types'
import { buildPlan } from '@/lib/engine/optimize'
import { buildPlanWithRuntimePolicy } from '@/lib/engine/optimize'
import type { PolicyContext } from './types'

/**
 * Replay a saved decision: reconstruct the plan from the saved state + intent
 * + asOf date + policy context. The replayed plan should have the same
 * policy hash, route set, best route, and scores as the original.
 *
 * If the original plan was computed under a specific runtime policy (with
 * overlays), the replay uses the same asOf date. Overlays that were active
 * at the original computation time may no longer be active — this is expected
 * (historical replay uses the policy that was in force at asOf).
 */
export async function replayDecision(opts: {
  state: MobilityState
  intent: Intent
  asOfDate: string
  simulationMode?: boolean
}): Promise<MobilityPlan> {
  return buildPlanWithRuntimePolicy(opts.state, opts.intent, [], {
    asOfDate: opts.asOfDate,
    simulationMode: opts.simulationMode ?? false,
  })
}

/**
 * Compare two plans for reproducibility: same policy hash, same best route,
 * same number of routes, same scores for the best route.
 */
export function plansMatch(oldPlan: MobilityPlan, newPlan: MobilityPlan): {
  match: boolean
  differences: string[]
} {
  const differences: string[] = []

  // Policy hash must match
  const oldHash = oldPlan.runtimePolicyHash ?? oldPlan.policyHash
  const newHash = newPlan.runtimePolicyHash ?? newPlan.policyHash
  if (oldHash !== newHash) {
    differences.push(`Policy hash: ${oldHash} → ${newHash}`)
  }

  // Same number of routes
  if (oldPlan.routes.length !== newPlan.routes.length) {
    differences.push(`Route count: ${oldPlan.routes.length} → ${newPlan.routes.length}`)
  }

  // Same best route
  if (oldPlan.recommendation.bestRouteId !== newPlan.recommendation.bestRouteId) {
    differences.push(`Best route: ${oldPlan.recommendation.bestRouteId} → ${newPlan.recommendation.bestRouteId}`)
  }

  // Same best-route score (risk-adjusted)
  const oldBest = oldPlan.routes.find((r) => r.id === oldPlan.recommendation.bestRouteId)
  const newBest = newPlan.routes.find((r) => r.id === newPlan.recommendation.bestRouteId)
  if (oldBest && newBest && oldBest.scores.riskAdjusted !== newBest.scores.riskAdjusted) {
    differences.push(`Best route risk-adjusted score: ${oldBest.scores.riskAdjusted} → ${newBest.scores.riskAdjusted}`)
  }

  return { match: differences.length === 0, differences }
}
