// POST /api/mobility/plan
// The core endpoint. Given a MobilityState and Intent, runs the deterministic
// engine (policy → routes → frontier → recommendation → alternative intents →
// enablers → counterfactuals) and attaches an LLM-generated narrative for the
// key result sections. The LLM never changes a fact or ranking.

import { NextResponse } from 'next/server'
import { buildPlan } from '@/lib/engine/optimize'
import { withEnablers } from '@/lib/engine/enabler-match'
import { generateNarrative } from '@/lib/ai/explanation'
import { defaultScenarios, type ScenarioSpec } from '@/lib/engine/simulate'
import { getManyEvidence } from '@/lib/knowledge/evidence'
import type { Intent, MobilityState } from '@/lib/domain/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface PlanRequestBody {
  state: MobilityState
  intent: Intent
  scenarios?: ScenarioSpec[]
  generateNarrative?: boolean
  asOfDate?: string // ISO date — when provided, evaluates against the policy snapshot active on that date
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as PlanRequestBody
    if (!body?.state || !body?.intent) {
      return NextResponse.json({ error: 'state and intent are required' }, { status: 400 })
    }

    const scenarios = body.scenarios ?? defaultScenarios(body.state)
    let plan = buildPlan(body.state, body.intent, scenarios, body.asOfDate)
    plan = withEnablers(plan)

    const wantNarrative = body.generateNarrative !== false
    const narrative = wantNarrative
      ? await generateNarrative(plan)
      : null

    const evidence = getManyEvidence(plan.evidenceIds)

    return NextResponse.json({ plan, narrative, evidence })
  } catch (err) {
    console.error('[/api/mobility/plan]', err)
    return NextResponse.json({ error: 'Failed to build plan' }, { status: 500 })
  }
}
