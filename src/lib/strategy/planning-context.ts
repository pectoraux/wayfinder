// Wayfinder — Canonical Planning Context
//
// The single entry point that resolves the runtime policy and generates
// routes ONCE, then passes the result to both buildPlan and buildStrategy.
// This guarantees the plan and strategy always use the same policy context.
//
// STRATEGY_ENGINE_VERSION is bumped when the strategy logic changes, enabling
// reproducibility and cache invalidation.

import type { MobilityState, Intent, Route, MobilityPlan } from '@/lib/domain/types'
import type { RuntimePolicySnapshot, PolicyContext } from '@/lib/policy/types'
import { toPolicyContext } from '@/lib/policy/types'
import { resolveRuntimePolicy } from '@/lib/policy/runtime-resolver'
import { generateRoutes } from '@/lib/engine/routes'

/** Bumped when strategy logic changes. Included in reproducibility metadata. */
export const STRATEGY_ENGINE_VERSION = '1.0.0'

export interface CanonicalPlanningContext {
  /** The resolved runtime policy (base + overlays). */
  runtimePolicy: RuntimePolicySnapshot
  /** The lightweight policy context for storage/reproducibility. */
  policyContext: PolicyContext
  /** The routes generated against this policy context. */
  routes: Route[]
  /** The as-of date used. */
  asOfDate: string
  /** Whether simulation mode was used. */
  simulationMode: boolean
  /** The strategy engine version. */
  strategyEngineVersion: string
}

/**
 * Resolve the canonical planning context: runtime policy + routes.
 * Both buildPlan and buildStrategy MUST consume this context.
 *
 * This guarantees the plan and strategy use the EXACT same policy world.
 */
export async function buildCanonicalPlanningContext(opts: {
  state: MobilityState
  intent: Intent
  asOfDate?: string | Date
  simulationMode?: boolean
}): Promise<CanonicalPlanningContext> {
  const asOf = opts.asOfDate
    ? (typeof opts.asOfDate === 'string' ? opts.asOfDate : opts.asOfDate.toISOString())
    : new Date().toISOString()
  const simulationMode = opts.simulationMode ?? false

  // 1. Resolve the runtime policy (base knowledge + DB overlays)
  const runtimePolicy = await resolveRuntimePolicy({
    asOf,
    simulationMode,
  })

  // 2. Generate routes using the resolved runtime policy
  const routes = generateRoutes(opts.state, opts.intent, asOf, simulationMode)

  // 3. Build the lightweight policy context for reproducibility
  const policyContext = toPolicyContext(runtimePolicy)

  return {
    runtimePolicy,
    policyContext,
    routes,
    asOfDate: asOf,
    simulationMode,
    strategyEngineVersion: STRATEGY_ENGINE_VERSION,
  }
}
