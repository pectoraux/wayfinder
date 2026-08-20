// POST /api/strategy/[id]/outcome
// Records the observed outcome of a strategy as a whole.
//
// Stores predicted values (immutable — from the original strategy) alongside
// actual observed values. The prediction is NEVER overwritten by reality.
//
// Idempotency: uses an idempotency key derived from (userId, decisionRecordId)
// to prevent duplicate outcomes from browser retries.
//
// Security: authenticated + user-scoped. The DecisionRecord must belong to
// the requesting user.

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { evaluateStrategyOutcome } from '@/lib/strategy/evaluation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface StrategyOutcomeBody {
  strategyFollowed?: string
  objectiveAchieved?: string
  trajectoryBecameViable?: string
  predictedTrajectoryViable?: boolean
  actualTrajectoryViable?: boolean
  predictedTimelineMonths?: number
  actualTimelineMonths?: number
  predictedTotalCostUSD?: number
  actualTotalCostUSD?: number
  provenance?: string
  notes?: string
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const userId = (session.user as any).id
  if (!userId) return NextResponse.json({ error: 'No user id' }, { status: 400 })

  const { id: decisionRecordId } = await params

  try {
    const body = (await req.json()) as StrategyOutcomeBody

    // Verify the DecisionRecord belongs to this user
    const record = await db.decisionRecord.findFirst({
      where: { id: decisionRecordId, userId },
    })
    if (!record) {
      return NextResponse.json({ error: 'Record not found' }, { status: 404 })
    }

    // Idempotency key: (userId, decisionRecordId) — one outcome per strategy.
    const idempotencyKey = `${userId}:${decisionRecordId}:strategy-outcome`

    // Validate provenance
    const validProvenances = ['USER_REPORTED', 'SYSTEM_DERIVED', 'EXTERNALLY_VERIFIED']
    const provenance = body.provenance ?? 'USER_REPORTED'
    if (!validProvenances.includes(provenance)) {
      return NextResponse.json({ error: `Invalid provenance: ${provenance}` }, { status: 400 })
    }

    // Validate enums
    const validFollowed = ['UNKNOWN', 'FOLLOWED', 'PARTIALLY_FOLLOWED', 'ABANDONED']
    const validAchieved = ['UNKNOWN', 'ACHIEVED', 'PARTIALLY_ACHIEVED', 'NOT_ACHIEVED', 'SUPERSEDED']
    const validViable = ['UNKNOWN', 'YES', 'NO']

    const strategyFollowed = body.strategyFollowed ?? 'UNKNOWN'
    const objectiveAchieved = body.objectiveAchieved ?? 'UNKNOWN'
    const trajectoryBecameViable = body.trajectoryBecameViable ?? 'UNKNOWN'

    if (!validFollowed.includes(strategyFollowed)) {
      return NextResponse.json({ error: `Invalid strategyFollowed: ${strategyFollowed}` }, { status: 400 })
    }
    if (!validAchieved.includes(objectiveAchieved)) {
      return NextResponse.json({ error: `Invalid objectiveAchieved: ${objectiveAchieved}` }, { status: 400 })
    }
    if (!validViable.includes(trajectoryBecameViable)) {
      return NextResponse.json({ error: `Invalid trajectoryBecameViable: ${trajectoryBecameViable}` }, { status: 400 })
    }

    const outcome = await db.strategyOutcome.upsert({
      where: { idempotencyKey },
      create: {
        userId,
        decisionRecordId,
        objectiveId: record.objectiveId,
        strategyFollowed,
        objectiveAchieved,
        trajectoryBecameViable,
        predictedTrajectoryViable: body.predictedTrajectoryViable ?? null,
        actualTrajectoryViable: body.actualTrajectoryViable ?? null,
        predictedTimelineMonths: body.predictedTimelineMonths ?? null,
        actualTimelineMonths: body.actualTimelineMonths ?? null,
        predictedTotalCostUSD: body.predictedTotalCostUSD ?? null,
        actualTotalCostUSD: body.actualTotalCostUSD ?? null,
        provenance,
        notes: body.notes ?? null,
        idempotencyKey,
      },
      update: {
        // Only update ACTUAL values + status — never overwrite predictions
        strategyFollowed,
        objectiveAchieved,
        trajectoryBecameViable,
        actualTrajectoryViable: body.actualTrajectoryViable ?? undefined,
        actualTimelineMonths: body.actualTimelineMonths ?? undefined,
        actualTotalCostUSD: body.actualTotalCostUSD ?? undefined,
        provenance,
        notes: body.notes ?? undefined,
      },
    })

    const evaluation = evaluateStrategyOutcome({
      predictedTrajectoryViable: outcome.predictedTrajectoryViable,
      actualTrajectoryViable: outcome.actualTrajectoryViable,
      predictedTimelineMonths: outcome.predictedTimelineMonths,
      actualTimelineMonths: outcome.actualTimelineMonths,
      predictedTotalCostUSD: outcome.predictedTotalCostUSD,
      actualTotalCostUSD: outcome.actualTotalCostUSD,
      strategyFollowed: outcome.strategyFollowed,
    })

    return NextResponse.json({ outcome, evaluation }, { status: 201 })
  } catch (err) {
    console.error('[/api/strategy/[id]/outcome]', err)
    return NextResponse.json({ error: 'Failed to record outcome' }, { status: 500 })
  }
}

// GET — returns the outcome for a specific strategy (if any)
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const userId = (session.user as any).id
  if (!userId) return NextResponse.json({ outcome: null })

  const { id: decisionRecordId } = await params
  const idempotencyKey = `${userId}:${decisionRecordId}:strategy-outcome`

  const outcome = await db.strategyOutcome.findUnique({
    where: { idempotencyKey },
  })

  if (!outcome) {
    return NextResponse.json({ outcome: null, evaluation: null })
  }

  const evaluation = evaluateStrategyOutcome({
    predictedTrajectoryViable: outcome.predictedTrajectoryViable,
    actualTrajectoryViable: outcome.actualTrajectoryViable,
    predictedTimelineMonths: outcome.predictedTimelineMonths,
    actualTimelineMonths: outcome.actualTimelineMonths,
    predictedTotalCostUSD: outcome.predictedTotalCostUSD,
    actualTotalCostUSD: outcome.actualTotalCostUSD,
    strategyFollowed: outcome.strategyFollowed,
  })

  return NextResponse.json({ outcome, evaluation })
}
