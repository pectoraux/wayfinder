// POST /api/strategy
// The intelligence layer endpoint. Uses the SAME canonical planning context
// as the plan API (buildCanonicalPlanningContext) so strategy and plan always
// share the exact same runtime policy + routes.
//
// CRITICAL: this endpoint does NOT independently call generateRoutes. It
// resolves the runtime policy via resolveRuntimePolicy (which loads DB overlays)
// and generates routes against that resolved policy — exactly like the plan API.

import { NextResponse } from 'next/server'
import { buildCanonicalPlanningContext } from '@/lib/strategy/planning-context'
import { buildStrategy } from '@/lib/strategy'
import type { Intent, MobilityState } from '@/lib/domain/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface StrategyRequestBody {
  state: MobilityState
  intent: Intent
  asOfDate?: string
  simulationMode?: boolean
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as StrategyRequestBody
    if (!body?.state || !body?.intent) {
      return NextResponse.json({ error: 'state and intent are required' }, { status: 400 })
    }

    // 1. Resolve the canonical planning context (runtime policy + routes)
    //    This is the SAME context used by the plan API.
    const context = await buildCanonicalPlanningContext({
      state: body.state,
      intent: body.intent,
      asOfDate: body.asOfDate,
      simulationMode: body.simulationMode ?? false,
    })

    // 2. Build the strategy using the canonical context's routes
    const strategy = await buildStrategy(body.state, body.intent, context.routes, context)

    return NextResponse.json({ strategy })
  } catch (err) {
    console.error('[/api/strategy]', err)
    return NextResponse.json({ error: 'Failed to build strategy' }, { status: 500 })
  }
}
