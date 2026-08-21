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
import {
  evaluateStrategyOutcomeN07,
  validateProvenance,
  deriveConfidenceLevel,
} from '@/lib/strategy/outcome-intelligence'
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
  /** N0.7: Client-provided outcomeType is REJECTED. The observed outcome's
   *  type is ALWAYS inherited from the expected outcome (or UNKNOWN if no
   *  expected outcome exists). The client cannot choose causal classification. */
  outcomeType?: string
  /** N0.7: Client-provided provenance is REJECTED. Server always sets
   *  USER_REPORTED for client submissions. Documented but ignored. */
  provenance?: string
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
    //    N0.7: Symmetric with the action-level route — uses N0.7 semantics:
    //    outcomeType, evaluationStatus, expectedOutcomeId, confidenceLevel,
    //    graphNodeId (all validated against the historical graph).

    // Resolve the existing expected strategy outcome (SYSTEM_DERIVED)
    const existingExpected = await db.strategyOutcome.findFirst({
      where: { decisionRecordId, provenance: 'SYSTEM_DERIVED' },
      orderBy: { createdAt: 'desc' },
    })

    // N0.7: Server-authoritative outcome classification. The observed
    // outcome's type is ALWAYS inherited from the expected outcome. If no
    // expected outcome exists, it is UNKNOWN. The client CANNOT choose the
    // causal classification — body.outcomeType is ignored.
    const outcomeType = (existingExpected?.outcomeType as any) ?? 'UNKNOWN'

    // N0.7: confidenceLevel from the historical strategy (qualitative)
    const confidenceLevel = strategy
      ? deriveConfidenceLevel(strategy)
      : (existingExpected?.confidenceLevel as any) ?? 'UNKNOWN'

    // N0.7: Client cannot claim EXTERNALLY_VERIFIED
    const validatedProvenance = body.provenance
      ? validateProvenance(body.provenance, true)
      : null
    const finalProvenance = validatedProvenance ?? 'USER_REPORTED'

    // N0.7: Compute deterministic evaluationStatus
    const n07Evaluation = evaluateStrategyOutcomeN07({
      predictedTrajectoryViable: prediction.predictedTrajectoryViable,
      actualTrajectoryViable: body.actualTrajectoryViable ?? null,
      predictedTimelineMonths: prediction.predictedTimelineMonths,
      actualTimelineMonths: body.actualTimelineMonths ?? null,
      predictedTotalCostUSD: prediction.predictedTotalCostUSD,
      actualTotalCostUSD: body.actualTotalCostUSD ?? null,
      strategyFollowed,
      // N0.7: expectedOutcomeId is the actual expected outcome ID, or null.
      // NEVER a surrogate (decisionRecordId).
      expectedOutcomeId: existingExpected?.id ?? null,
      provenance: finalProvenance,
    })

    const outcome = await db.strategyOutcome.create({
      data: {
        userId,
        decisionRecordId,
        objectiveId: record.objectiveId,
        // N0.7 fields
        outcomeType,
        graphNodeId: existingExpected?.graphNodeId ?? null,
        confidenceLevel,
        expectedOutcomeId: existingExpected?.id ?? null,
        evaluationStatus: n07Evaluation.status,
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
        provenance: finalProvenance,
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

    return NextResponse.json({ outcome, evaluation, n07Evaluation, idempotent: false }, { status: 201 })
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
