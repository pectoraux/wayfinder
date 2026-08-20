// POST /api/actions/[id]/outcome
// Records the observed outcome of a user action.
//
// Stores predicted values (immutable — from the original strategy) alongside
// actual observed values. The prediction is NEVER overwritten by reality.
//
// Idempotency: uses an idempotency key derived from (userId, userActionId)
// to prevent duplicate outcomes from browser retries.
//
// Security: authenticated + user-scoped. The UserAction must belong to the
// requesting user.

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { evaluateActionOutcome } from '@/lib/strategy/evaluation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface OutcomeBody {
  predictedEffect?: string
  actualEffect?: string
  predictedDurationMonths?: number
  actualDurationMonths?: number
  predictedCostUSD?: number
  actualCostUSD?: number
  predictedBlockerResolved?: boolean
  actualBlockerResolved?: boolean
  status?: string
  provenance?: string
  notes?: string
  decisionRecordId?: string
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

    // Verify the UserAction belongs to this user
    const userAction = await db.userAction.findFirst({
      where: { id: userActionId, userId },
    })
    if (!userAction) {
      return NextResponse.json({ error: 'Action not found' }, { status: 404 })
    }

    // Idempotency key: (userId, userActionId) — one outcome per action.
    // If an outcome already exists for this action, update it rather than
    // creating a duplicate.
    const idempotencyKey = `${userId}:${userActionId}:outcome`

    // Validate provenance
    const validProvenances = ['USER_REPORTED', 'SYSTEM_DERIVED', 'EXTERNALLY_VERIFIED']
    const provenance = body.provenance ?? 'USER_REPORTED'
    if (!validProvenances.includes(provenance)) {
      return NextResponse.json({ error: `Invalid provenance: ${provenance}` }, { status: 400 })
    }

    // Validate status
    const validStatuses = ['UNKNOWN', 'OBSERVED', 'CONFIRMED', 'USER_REPORTED', 'EXTERNALLY_VERIFIED', 'FAILED']
    const status = body.status ?? 'OBSERVED'
    if (!validStatuses.includes(status)) {
      return NextResponse.json({ error: `Invalid status: ${status}` }, { status: 400 })
    }

    const outcome = await db.actionOutcome.upsert({
      where: { idempotencyKey },
      create: {
        userId,
        userActionId,
        decisionRecordId: body.decisionRecordId ?? null,
        predictedEffect: body.predictedEffect ?? null,
        actualEffect: body.actualEffect ?? null,
        predictedDurationMonths: body.predictedDurationMonths ?? null,
        actualDurationMonths: body.actualDurationMonths ?? null,
        predictedCostUSD: body.predictedCostUSD ?? null,
        actualCostUSD: body.actualCostUSD ?? null,
        predictedBlockerResolved: body.predictedBlockerResolved ?? null,
        actualBlockerResolved: body.actualBlockerResolved ?? null,
        status,
        provenance,
        notes: body.notes ?? null,
        idempotencyKey,
      },
      update: {
        // Only update the ACTUAL values + status — never overwrite predictions
        actualEffect: body.actualEffect ?? undefined,
        actualDurationMonths: body.actualDurationMonths ?? undefined,
        actualCostUSD: body.actualCostUSD ?? undefined,
        actualBlockerResolved: body.actualBlockerResolved ?? undefined,
        status,
        provenance,
        notes: body.notes ?? undefined,
      },
    })

    // Compute the evaluation
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

    return NextResponse.json({ outcome, evaluation }, { status: 201 })
  } catch (err) {
    console.error('[/api/actions/[id]/outcome]', err)
    return NextResponse.json({ error: 'Failed to record outcome' }, { status: 500 })
  }
}

// GET — returns the outcome for a specific action (if any)
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const userId = (session.user as any).id
  if (!userId) return NextResponse.json({ outcome: null })

  const { id: userActionId } = await params
  const idempotencyKey = `${userId}:${userActionId}:outcome`

  const outcome = await db.actionOutcome.findUnique({
    where: { idempotencyKey },
  })

  if (!outcome) {
    return NextResponse.json({ outcome: null, evaluation: null })
  }

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

  return NextResponse.json({ outcome, evaluation })
}
