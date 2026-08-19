// POST /api/strategy
// The intelligence layer endpoint. Given a MobilityState and Intent, returns
// the full Strategy output: trajectories, blockers, unlocks, action plan,
// profile analysis, intent frontier, alternative intents, preference questions,
// and uncertainty assessment.
//
// This is what makes Wayfinder more than a visa database.

import { NextResponse } from 'next/server'
import { generateRoutes } from '@/lib/engine/routes'
import { buildStrategy } from '@/lib/strategy'
import type { Intent, MobilityState } from '@/lib/domain/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface StrategyRequestBody {
  state: MobilityState
  intent: Intent
  asOfDate?: string
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as StrategyRequestBody
    if (!body?.state || !body?.intent) {
      return NextResponse.json({ error: 'state and intent are required' }, { status: 400 })
    }

    const routes = generateRoutes(body.state, body.intent, body.asOfDate)
    const strategy = buildStrategy(body.state, body.intent, routes)

    return NextResponse.json({ strategy })
  } catch (err) {
    console.error('[/api/strategy]', err)
    return NextResponse.json({ error: 'Failed to build strategy' }, { status: 500 })
  }
}
