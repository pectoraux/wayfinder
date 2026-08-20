// POST /api/strategy/feedback
// Records user feedback on a specific historical strategy recommendation.
//
// Feedback is the user's subjective assessment — NOT a factual claim about
// the outside world. It's immutable: each submission creates a new event.
//
// GET /api/strategy/feedback?decisionRecordId=...
// Returns all feedback events for a specific DecisionRecord.
//
// Security: authenticated + user-scoped. The DecisionRecord must belong to
// the requesting user.

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface FeedbackBody {
  decisionRecordId: string
  usefulness?: number
  assumptionAccuracy?: number
  explanationAccuracy?: number
  blockerAccuracy?: number
  confidenceAssessment?: number
  freeText?: string
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const userId = (session.user as any).id
  if (!userId) return NextResponse.json({ error: 'No user id' }, { status: 400 })

  try {
    const body = (await req.json()) as FeedbackBody
    if (!body?.decisionRecordId) {
      return NextResponse.json({ error: 'decisionRecordId is required' }, { status: 400 })
    }

    // Verify the DecisionRecord belongs to this user
    const record = await db.decisionRecord.findFirst({
      where: { id: body.decisionRecordId, userId },
    })
    if (!record) {
      return NextResponse.json({ error: 'Record not found' }, { status: 404 })
    }

    // Validate ratings (1-5 scale if provided)
    const validateRating = (v: number | undefined): number | null => {
      if (v == null) return null
      if (typeof v !== 'number' || v < 1 || v > 5 || !Number.isInteger(v)) {
        throw new Error(`Rating must be an integer 1-5, got ${v}`)
      }
      return v
    }

    const feedback = await db.strategyFeedback.create({
      data: {
        userId,
        decisionRecordId: body.decisionRecordId,
        usefulness: validateRating(body.usefulness),
        assumptionAccuracy: validateRating(body.assumptionAccuracy),
        explanationAccuracy: validateRating(body.explanationAccuracy),
        blockerAccuracy: validateRating(body.blockerAccuracy),
        confidenceAssessment: validateRating(body.confidenceAssessment),
        freeText: body.freeText ?? null,
      },
    })

    return NextResponse.json({ feedback }, { status: 201 })
  } catch (err: any) {
    if (err.message?.includes('Rating must be')) {
      return NextResponse.json({ error: err.message }, { status: 400 })
    }
    console.error('[/api/strategy/feedback]', err)
    return NextResponse.json({ error: 'Failed to record feedback' }, { status: 500 })
  }
}

export async function GET(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const userId = (session.user as any).id
  if (!userId) return NextResponse.json({ feedback: [] })

  const { searchParams } = new URL(req.url)
  const decisionRecordId = searchParams.get('decisionRecordId')

  const where: { userId: string; decisionRecordId?: string } = { userId }
  if (decisionRecordId) where.decisionRecordId = decisionRecordId

  const feedback = await db.strategyFeedback.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 50,
  })

  return NextResponse.json({ feedback })
}
