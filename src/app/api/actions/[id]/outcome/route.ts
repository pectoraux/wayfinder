// POST /api/actions/[id]/outcome
// Records an IMMUTABLE observed outcome event for a user action.
//
// N0.4b ARCHITECTURAL INVARIANTS:
//   1. PREDICTIONS ARE SERVER-DERIVED: the client submits ONLY actual
//      observations. The server resolves the UserAction → DecisionRecord →
//      historical strategy snapshot → action template, and derives the
//      prediction from that frozen historical data. The client can NEVER
//      control what Wayfinder "predicted."
//   2. DECISION RECORD OWNERSHIP: the server resolves the DecisionRecord
//      from the UserAction's persisted decisionRecordId. The client cannot
//      submit an arbitrary decisionRecordId.
//   3. OUTCOME EVENTS ARE IMMUTABLE: each submission creates a NEW event.
//      Historical observations are never overwritten. Idempotency is based
//      on a client-provided eventId — retries with the same eventId return
//      the existing event; different eventIds create new events.
//   4. PROVENANCE IS SERVER-CONTROLLED: client submissions are always
//      USER_REPORTED. The client cannot claim EXTERNALLY_VERIFIED.
//
// Body: { actualEffect?, actualDurationMonths?, actualCostUSD?,
//         actualBlockerResolved?, notes?, eventId? }

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { evaluateActionOutcome } from '@/lib/strategy/evaluation'
import { deriveActionPrediction } from '@/lib/strategy/prediction'
import type { Strategy } from '@/lib/strategy/types'
import { createHash } from 'crypto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface OutcomeBody {
  // ONLY actual observations accepted from the client
  actualEffect?: string
  actualDurationMonths?: number
  actualCostUSD?: number
  actualBlockerResolved?: boolean
  notes?: string
  /** Client-generated event ID for idempotency. Retries with the same
   *  eventId return the existing event. Different eventIds create new events. */
  eventId?: string
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const userId = (session.user as any).id
  if (!userId) return NextResponse.json({ error: 'No user id' }, { status: 400 })

  const { id: userActionId } = await params

  try {
    const body = (await req.json()) as OutcomeBody

    // 1. Verify the UserAction belongs to this user
    const userAction = await db.userAction.findFirst({
      where: { id: userActionId, userId },
    })
    if (!userAction) {
      return NextResponse.json({ error: 'Action not found' }, { status: 404 })
    }

    // 2. Resolve the DecisionRecord from the UserAction's persisted
    //    decisionRecordId — NOT from the client body.
    const decisionRecordId = userAction.decisionRecordId
    let prediction = {
      predictedEffect: null as string | null,
      predictedCostUSD: null as number | null,
      predictedDurationMonths: null as number | null,
      predictedBlockerResolved: null as boolean | null,
      decisionRecordId: decisionRecordId,
    }

    if (decisionRecordId) {
      // 3. Verify the DecisionRecord belongs to this user (ownership)
      const record = await db.decisionRecord.findFirst({
        where: { id: decisionRecordId, userId },
      })
      if (record?.strategySnapshot) {
        // 4. Derive predictions SERVER-SIDE from the historical strategy
        const strategy = record.strategySnapshot as unknown as Strategy
        prediction = deriveActionPrediction(strategy, userAction.actionId, decisionRecordId)
      }
    }

    // 5. Idempotency: use client-provided eventId, or derive from body hash
    //    if not provided. Retries with the same key return the existing event.
    const eventId = body.eventId ?? deriveEventId(userId, userActionId, body)
    const idempotencyKey = `${userId}:${userActionId}:${eventId}`

    // 6. Check for existing event (idempotent retry)
    const existing = await db.actionOutcome.findUnique({
      where: { idempotencyKey },
    })
    if (existing) {
      // Idempotent retry — return the existing event, do NOT create a new one
      const evaluation = evaluateActionOutcome({
        predictedEffect: existing.predictedEffect,
        actualEffect: existing.actualEffect,
        predictedDurationMonths: existing.predictedDurationMonths,
        actualDurationMonths: existing.actualDurationMonths,
        predictedCostUSD: existing.predictedCostUSD,
        actualCostUSD: existing.actualCostUSD,
        predictedBlockerResolved: existing.predictedBlockerResolved,
        actualBlockerResolved: existing.actualBlockerResolved,
      })
      return NextResponse.json({ outcome: existing, evaluation, idempotent: true })
    }

    // 7. Create a NEW immutable outcome event.
    //    Provenance is ALWAYS USER_REPORTED for client submissions —
    //    the client cannot claim EXTERNALLY_VERIFIED.
    const outcome = await db.actionOutcome.create({
      data: {
        userId,
        userActionId,
        decisionRecordId: prediction.decisionRecordId,
        // Predictions — server-derived, immutable
        predictedEffect: prediction.predictedEffect,
        predictedCostUSD: prediction.predictedCostUSD,
        predictedDurationMonths: prediction.predictedDurationMonths,
        predictedBlockerResolved: prediction.predictedBlockerResolved,
        // Actuals — client-submitted observations
        actualEffect: body.actualEffect ?? null,
        actualDurationMonths: body.actualDurationMonths ?? null,
        actualCostUSD: body.actualCostUSD ?? null,
        actualBlockerResolved: body.actualBlockerResolved ?? null,
        // Status + provenance — server-controlled
        status: 'USER_REPORTED',
        provenance: 'USER_REPORTED',
        notes: body.notes ?? null,
        idempotencyKey,
      },
    })

    const evaluation = evaluateActionOutcome({
      predictedEffect: outcome.predictedEffect,
      actualEffect: outcome.actualEffect,
      predictedDurationMonths: outcome.predictedDurationMonths,
      actualDurationMonths: outcome.actualDurationMonths,
      predictedCostUSD: outcome.predictedCostUSD,
      actualCostUSD: outcome.actualCostUSD,
      predictedBlockerResolved: outcome.predictedBlockerResolved,
      actualBlockerResolved: outcome.actualBlockerResolved,
    })

    return NextResponse.json({ outcome, evaluation, idempotent: false }, { status: 201 })
  } catch (err) {
    console.error('[/api/actions/[id]/outcome]', err)
    return NextResponse.json({ error: 'Failed to record outcome' }, { status: 500 })
  }
}

// GET — returns ALL outcome events for a specific action
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const userId = (session.user as any).id
  if (!userId) return NextResponse.json({ outcomes: [] })

  const { id: userActionId } = await params

  // Verify ownership
  const userAction = await db.userAction.findFirst({
    where: { id: userActionId, userId },
  })
  if (!userAction) {
    return NextResponse.json({ error: 'Action not found' }, { status: 404 })
  }

  // Return ALL outcome events for this action (immutable history)
  const outcomes = await db.actionOutcome.findMany({
    where: { userActionId },
    orderBy: { createdAt: 'desc' },
  })

  // Compute evaluation for the most recent outcome
  const latest = outcomes[0]
  const evaluation = latest
    ? evaluateActionOutcome({
        predictedEffect: latest.predictedEffect,
        actualEffect: latest.actualEffect,
        predictedDurationMonths: latest.predictedDurationMonths,
        actualDurationMonths: latest.actualDurationMonths,
        predictedCostUSD: latest.predictedCostUSD,
        actualCostUSD: latest.actualCostUSD,
        predictedBlockerResolved: latest.predictedBlockerResolved,
        actualBlockerResolved: latest.actualBlockerResolved,
      })
    : null

  return NextResponse.json({ outcomes, evaluation })
}

/** Derive a deterministic event ID from the request body (fallback when
 *  the client doesn't provide one). Same observations → same ID → idempotent. */
function deriveEventId(userId: string, userActionId: string, body: OutcomeBody): string {
  const payload = JSON.stringify({
    actualEffect: body.actualEffect ?? null,
    actualDurationMonths: body.actualDurationMonths ?? null,
    actualCostUSD: body.actualCostUSD ?? null,
    actualBlockerResolved: body.actualBlockerResolved ?? null,
    notes: body.notes ?? null,
  })
  return createHash('sha256').update(`${userId}:${userActionId}:${payload}`).digest('hex').slice(0, 16)
}
