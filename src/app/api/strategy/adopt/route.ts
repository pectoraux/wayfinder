// POST /api/strategy/adopt
// Persists a strategy adoption: saves the strategy + plan as a DecisionRecord
// with trigger=OBJECTIVE_ADOPT, marks previous ACTIVE plans as SUPERSEDED.
//
// GET — returns the user's active strategy (from the most recent ACTIVE
// DecisionRecord that has a strategySnapshot). Used for page reload.
//
// Body (POST): { strategy, plan?, objectiveId }
// Returns: { recordId, activePlanId }

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { STRATEGY_ENGINE_VERSION } from '@/lib/strategy/planning-context'
import { getCurrentPolicySnapshot } from '@/lib/policy/snapshot'
import type { Strategy, MobilityPlan } from '@/lib/strategy/types'
import type { MobilityState, Intent } from '@/lib/domain/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface AdoptBody {
  strategy: Strategy
  plan?: MobilityPlan
  objectiveId: string
  state: MobilityState
  intent: Intent
}

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const userId = (session.user as any).id
  if (!userId) return NextResponse.json({ strategy: null, objectiveId: null })

  try {
    // Find the most recent ACTIVE DecisionRecord with a strategySnapshot
    const record = await db.decisionRecord.findFirst({
      where: { userId, planStatus: 'ACTIVE', strategySnapshot: { not: null } },
      orderBy: { createdAt: 'desc' },
    })

    if (!record || !record.strategySnapshot) {
      return NextResponse.json({ strategy: null, objectiveId: null })
    }

    const strategy = record.strategySnapshot as unknown as Strategy
    const currentPolicy = getCurrentPolicySnapshot()

    // Check staleness
    const isStale = strategy.policyContext?.runtimeHash !== currentPolicy.hash
      || strategy.strategyEngineVersion !== STRATEGY_ENGINE_VERSION

    return NextResponse.json({
      strategy,
      objectiveId: record.objectiveId,
      recordId: record.id,
      createdAt: record.createdAt.toISOString(),
      isStale,
      currentPolicyHash: currentPolicy.hash,
      strategyEngineVersion: STRATEGY_ENGINE_VERSION,
    })
  } catch (err) {
    console.error('[/api/strategy/adopt GET]', err)
    return NextResponse.json({ strategy: null, objectiveId: null })
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
    const body = (await req.json()) as AdoptBody
    if (!body?.strategy || !body?.objectiveId) {
      return NextResponse.json({ error: 'strategy and objectiveId are required' }, { status: 400 })
    }

    // Find or create a Person for this user
    let person = await db.person.findFirst({ where: { userId } })
    if (!person) {
      person = await db.person.create({ data: { userId } })
    }

    // Count existing records for version numbering
    const existingCount = await db.decisionRecord.count({ where: { personId: person.id } })
    const stateVersion = existingCount + 1

    // Mark previous ACTIVE plans for this user + objective as SUPERSEDED
    await db.decisionRecord.updateMany({
      where: { userId, planStatus: 'ACTIVE', objectiveId: body.objectiveId },
      data: { planStatus: 'SUPERSEDED' },
    })

    // Also mark any non-objective-specific ACTIVE plans as SUPERSEDED
    // (for backward compat with plans that don't have objectiveId)
    await db.decisionRecord.updateMany({
      where: { userId, planStatus: 'ACTIVE', objectiveId: null },
      data: { planStatus: 'SUPERSEDED' },
    })

    // Create the new ACTIVE record with the strategy snapshot
    const record = await db.decisionRecord.create({
      data: {
        personId: person.id,
        stateVersion,
        intentVersion: 1,
        policyVersion: body.strategy.policyContext?.baseSnapshotId ?? 'snap-2024-11',
        policyHash: body.strategy.policyContext?.runtimeHash ?? 'unknown',
        runtimePolicyVersion: body.strategy.policyContext?.runtimeVersionId ?? null,
        runtimePolicyHash: body.strategy.policyContext?.runtimeHash ?? null,
        asOfDate: new Date(body.strategy.policyContext?.asOf ?? new Date().toISOString()),
        plan: (body.plan ?? body.strategy) as any,
        userId,
        trigger: 'OBJECTIVE_ADOPT',
        planStatus: 'ACTIVE',
        strategyEngineVersion: body.strategy.strategyEngineVersion ?? STRATEGY_ENGINE_VERSION,
        objectiveId: body.objectiveId,
        strategySnapshot: body.strategy as any,
      },
    })

    return NextResponse.json({
      recordId: record.id,
      activePlanId: record.id,
      objectiveId: body.objectiveId,
    })
  } catch (err) {
    console.error('[/api/strategy/adopt]', err)
    return NextResponse.json({ error: 'Failed to adopt strategy' }, { status: 500 })
  }
}
