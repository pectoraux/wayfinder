// /api/actions
// GET  — list the user's actions
// POST — create/sync actions from a strategy

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import type { ActionPlan } from '@/lib/strategy/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const userId = (session.user as any).id
  if (!userId) return NextResponse.json({ actions: [] })

  const actions = await db.userAction.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: 50,
  })

  return NextResponse.json({ actions })
}

// POST — sync actions from a strategy's action plan
// Body: { actionPlan: ActionPlan, strategyEngineVersion, runtimePolicyHash }
export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const userId = (session.user as any).id
  if (!userId) return NextResponse.json({ error: 'No user id' }, { status: 400 })

  try {
    const body = await req.json()
    const { actionPlan, strategyEngineVersion, runtimePolicyHash } = body as {
      actionPlan: ActionPlan
      strategyEngineVersion?: string
      runtimePolicyHash?: string
    }

    if (!actionPlan?.actions) {
      return NextResponse.json({ error: 'actionPlan is required' }, { status: 400 })
    }

    // Upsert each action (create if doesn't exist, don't overwrite status if already exists)
    const results = []
    for (const action of actionPlan.actions) {
      const existing = await db.userAction.findUnique({
        where: { userId_actionId: { userId, actionId: action.id } },
      })

      if (!existing) {
        const created = await db.userAction.create({
          data: {
            userId,
            actionId: action.id,
            title: action.title,
            description: action.description,
            status: 'NOT_STARTED',
            strategyEngineVersion: strategyEngineVersion ?? null,
            runtimePolicyHash: runtimePolicyHash ?? null,
          },
        })
        results.push(created)
      } else {
        // Update title/description but preserve status
        results.push(existing)
      }
    }

    return NextResponse.json({ actions: results })
  } catch (err) {
    console.error('[/api/actions POST]', err)
    return NextResponse.json({ error: 'Failed to sync actions' }, { status: 500 })
  }
}
