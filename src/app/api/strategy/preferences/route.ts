// POST /api/strategy/preferences
// Records a user's preference answer, creates a new intent version, and
// triggers strategy recomputation. Returns the new strategy + a diff.
//
// Body: { questionId, answer, currentIntent, state, asOfDate? }

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { buildCanonicalPlanningContext } from '@/lib/strategy/planning-context'
import { buildStrategy } from '@/lib/strategy'
import type { Intent, MobilityState, Preference } from '@/lib/domain/types'
import { diffPlans } from '@/lib/policy/plan-diff'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface PrefBody {
  questionId: string
  answer: string
  currentIntent: Intent
  state: MobilityState
  asOfDate?: string
}

/** Map a preference answer to updated priority weights. */
function applyPreferenceAnswer(intent: Intent, questionId: string, answer: string): Intent {
  const priorities = [...intent.priorities]

  if (questionId === 'pq-income-vs-residence') {
    if (answer === 'residence') {
      // Boost safety + citizenship, reduce income
      updateWeight(priorities, 'safety_priority', 0.35)
      updateWeight(priorities, 'citizenship_priority', 0.3)
      updateWeight(priorities, 'income_priority', 0.1)
    } else if (answer === 'income') {
      updateWeight(priorities, 'income_priority', 0.45)
      updateWeight(priorities, 'safety_priority', 0.1)
    }
    // 'balanced' → keep defaults
  }

  if (questionId === 'pq-speed-vs-optionality') {
    if (answer === 'speed') {
      // Not a direct priority, but affects ranking via compositeUtility
      // We can encode this as a preference note
    } else if (answer === 'optionality') {
      updateWeight(priorities, 'mobility_priority', 0.35)
    }
  }

  if (questionId === 'pq-study-first') {
    if (answer === 'study') {
      updateWeight(priorities, 'education_value', 0.3)
    }
  }

  return { ...intent, priorities }
}

function updateWeight(priorities: Preference[], kind: Preference['kind'], weight: number) {
  const existing = priorities.find((p) => p.kind === kind)
  if (existing) {
    existing.weight = weight
  } else {
    priorities.push({ kind, weight })
  }
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const userId = (session.user as any).id
  if (!userId) return NextResponse.json({ error: 'No user id' }, { status: 400 })

  try {
    const body = (await req.json()) as PrefBody
    if (!body?.questionId || !body?.answer || !body?.currentIntent || !body?.state) {
      return NextResponse.json({ error: 'questionId, answer, currentIntent, and state are required' }, { status: 400 })
    }

    // 1. Apply the preference answer to the intent
    const updatedIntent = applyPreferenceAnswer(body.currentIntent, body.questionId, body.answer)
    const intentVersion = (body.currentIntent.constraints?.length ?? 0) + 1

    // 2. Persist the preference answer
    await db.userPreference.create({
      data: {
        userId,
        questionId: body.questionId,
        answer: body.answer,
        intentVersion,
      },
    })

    // 3. Recompute the strategy using the canonical planning context
    const ctx = await buildCanonicalPlanningContext({
      state: body.state,
      intent: updatedIntent,
      asOfDate: body.asOfDate,
    })
    const newStrategy = buildStrategy(body.state, updatedIntent, ctx.routes, ctx)

    // 4. Compute a diff summary (what changed)
    const oldBestTrajectory = body.currentIntent // placeholder — the real diff compares old vs new strategy
    const diff = {
      intentChanged: JSON.stringify(body.currentIntent.priorities) !== JSON.stringify(updatedIntent.priorities),
      oldPriorities: body.currentIntent.priorities,
      newPriorities: updatedIntent.priorities,
      newBestTrajectory: newStrategy.bestTrajectory.label,
      strategyEngineVersion: ctx.strategyEngineVersion,
      runtimePolicyHash: ctx.policyContext.runtimeHash,
    }

    return NextResponse.json({
      strategy: newStrategy,
      updatedIntent,
      diff,
    })
  } catch (err) {
    console.error('[/api/strategy/preferences]', err)
    return NextResponse.json({ error: 'Failed to apply preference' }, { status: 500 })
  }
}
