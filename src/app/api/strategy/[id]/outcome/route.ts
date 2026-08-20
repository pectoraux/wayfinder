// POST /api/strategy/[id]/outcome
// Records an IMMUTABLE observed outcome event for a strategy.
//
// N0.4b ARCHITECTURAL INVARIANTS:
//   1. PREDICTIONS ARE SERVER-DERIVED: the client submits ONLY actual
//      observations. The server resolves the DecisionRecord → strategy
//      snapshot → best trajectory, and derives the prediction from that
//      frozen historical data.
//   2. EXACT DECISION RECORD OWNERSHIP: the DecisionRecord ID comes from
//      the URL path, and ownership is verified before any write.
//   3. OUTCOME EVENTS ARE IMMUTABLE: each submission creates a NEW event.
//      Idempotency is based on a client-provided eventId.
//   4. PROVENANCE IS SERVER-CONTROLLED: client submissions are always
//      USER_REPORTED.
//
// Body: { strategyFollowed?, objectiveAchieved?, trajectoryBecameViable?,
//         actualTrajectoryViable?, actualTimelineMonths?, actualTotalCostUSD?,
//         notes?, eventId? }

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { evaluateStrategyOutcome } from '@/lib/strategy/evaluation'
import { deriveStrategyPrediction } from '@/lib/strategy/prediction'
import type { Strategy } from '@/lib/strategy/types'
import { createHash } from 'crypto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface StrategyOutcomeBody {
  // ONLY actual observations + status accepted from the client
  strategyFollowed?: string
  objectiveAchieved?: string
  trajectoryBecameViable?: string
  actualTrajectoryViable?: boolean
  actualTimelineMonths?: number
  actualTotalCostUSD?: number
  notes?: string
  eventId?: string
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

    // 1. Verify the DecisionRecord belongs to this user
    const record = await db.decisionRecord.findFirst({
      where: { id: decisionRecordId, userId },
    })
    if (!record) {
      return NextResponse.json({ error: 'Record not found' }, { status: 404 })
    }

    // 2. Derive predictions SERVER-SIDE from the historical strategy snapshot
    const strategy = record.strategySnapshot as unknown as Strategy | null
    const prediction = deriveStrategyPrediction(strategy, decisionRecordId)

    // 3. Validate enums
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

    // 4. Idempotency: client-provided eventId, or derived from body
    const eventId = body.eventId ?? deriveEventId(userId, decisionRecordId, body)
    const idempotencyKey = `${userId}:${decisionRecordId}:${eventId}`

    // 5. Check for existing event (idempotent retry)
    const existing = await db.strategyOutcome.findUnique({
      where: { idempotencyKey },
    })
    if (existing) {
      const evaluation = evaluateStrategyOutcome({
        predictedTrajectoryViable: existing.predictedTrajectoryViable,
        actualTrajectoryViable: existing.actualTrajectoryViable,
        predictedTimelineMonths: existing.predictedTimelineMonths,
        actualTimelineMonths: existing.actualTimelineMonths,
        predictedTotalCostUSD: existing.predictedTotalCostUSD,
        actualTotalCostUSD: existing.actualTotalCostUSD,
        strategyFollowed: existing.strategyFollowed,
      })
      return NextResponse.json({ outcome: existing, evaluation, idempotent: true })
    }

    // 6. Create a NEW immutable outcome event.
    //    Provenance is ALWAYS USER_REPORTED for client submissions.
    const outcome = await db.strategyOutcome.create({
      data: {
        userId,
        decisionRecordId,
        objectiveId: record.objectiveId,
        // Actual observations — client-submitted
        strategyFollowed,
        objectiveAchieved,
        trajectoryBecameViable,
        actualTrajectoryViable: body.actualTrajectoryViable ?? null,
        actualTimelineMonths: body.actualTimelineMonths ?? null,
        actualTotalCostUSD: body.actualTotalCostUSD ?? null,
        // Predictions — server-derived from historical strategy, immutable
        predictedTrajectoryViable: prediction.predictedTrajectoryViable,
        predictedTimelineMonths: prediction.predictedTimelineMonths,
        predictedTotalCostUSD: prediction.predictedTotalCostUSD,
        // Provenance — server-controlled
        provenance: 'USER_REPORTED',
        notes: body.notes ?? null,
        idempotencyKey,
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

    return NextResponse.json({ outcome, evaluation, idempotent: false }, { status: 201 })
  } catch (err) {
    console.error('[/api/strategy/[id]/outcome]', err)
    return NextResponse.json({ error: 'Failed to record outcome' }, { status: 500 })
  }
}

// GET — returns ALL outcome events for a specific strategy
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const userId = (session.user as any).id
  if (!userId) return NextResponse.json({ outcomes: [] })

  const { id: decisionRecordId } = await params

  // Verify ownership
  const record = await db.decisionRecord.findFirst({
    where: { id: decisionRecordId, userId },
  })
  if (!record) {
    return NextResponse.json({ error: 'Record not found' }, { status: 404 })
  }

  const outcomes = await db.strategyOutcome.findMany({
    where: { decisionRecordId },
    orderBy: { createdAt: 'desc' },
  })

  const latest = outcomes[0]
  const evaluation = latest
    ? evaluateStrategyOutcome({
        predictedTrajectoryViable: latest.predictedTrajectoryViable,
        actualTrajectoryViable: latest.actualTrajectoryViable,
        predictedTimelineMonths: latest.predictedTimelineMonths,
        actualTimelineMonths: latest.actualTimelineMonths,
        predictedTotalCostUSD: latest.predictedTotalCostUSD,
        actualTotalCostUSD: latest.actualTotalCostUSD,
        strategyFollowed: latest.strategyFollowed,
      })
    : null

  return NextResponse.json({ outcomes, evaluation })
}

function deriveEventId(userId: string, decisionRecordId: string, body: StrategyOutcomeBody): string {
  const payload = JSON.stringify({
    strategyFollowed: body.strategyFollowed ?? null,
    objectiveAchieved: body.objectiveAchieved ?? null,
    trajectoryBecameViable: body.trajectoryBecameViable ?? null,
    actualTrajectoryViable: body.actualTrajectoryViable ?? null,
    actualTimelineMonths: body.actualTimelineMonths ?? null,
    actualTotalCostUSD: body.actualTotalCostUSD ?? null,
    notes: body.notes ?? null,
  })
  return createHash('sha256').update(`${userId}:${decisionRecordId}:${payload}`).digest('hex').slice(0, 16)
}
