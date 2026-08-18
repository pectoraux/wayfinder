// POST /api/mobility/simulate
// Counterfactual: applies a modification to the user's state and recomputes the
// best route + frontier delta. Deterministic.

import { NextResponse } from 'next/server'
import { runScenario, defaultScenarios, type ScenarioSpec } from '@/lib/engine/simulate'
import { generateRoutes } from '@/lib/engine/routes'
import { rankRoutes } from '@/lib/engine/optimize'
import type { Intent, MobilityState } from '@/lib/domain/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface SimRequestBody {
  state: MobilityState
  intent: Intent
  scenarioId?: string
  modification?: ScenarioSpec
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as SimRequestBody
    if (!body?.state || !body?.intent) {
      return NextResponse.json({ error: 'state and intent are required' }, { status: 400 })
    }

    let spec: ScenarioSpec | undefined
    if (body.modification) {
      spec = body.modification
    } else if (body.scenarioId) {
      spec = defaultScenarios(body.state).find((s) => s.id === body.scenarioId)
    }
    if (!spec) {
      return NextResponse.json({ error: 'Provide scenarioId or modification' }, { status: 400 })
    }

    const result = runScenario(body.state, body.intent, spec)

    // Also return the full recomputed route list for the modified state, so the
    // UI can re-render the frontier under the counterfactual.
    const modifiedRoutes = generateRoutes(spec.modify(JSON.parse(JSON.stringify(body.state))), body.intent)
    const ranked = rankRoutes(modifiedRoutes, body.intent)

    return NextResponse.json({ scenario: result, modifiedRoutes: ranked })
  } catch (err) {
    console.error('[/api/mobility/simulate]', err)
    return NextResponse.json({ error: 'Failed to simulate' }, { status: 500 })
  }
}
