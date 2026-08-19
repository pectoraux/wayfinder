// GET /api/plans/active
// Returns the user's ACTIVE plan (the most recent one with planStatus=ACTIVE).
// POST — set a specific plan as active (accept a new plan). Marks the old
// active plan as SUPERSEDED and the new one as ACTIVE.

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const userId = (session.user as any).id
  if (!userId) return NextResponse.json({ plan: null })

  const record = await db.decisionRecord.findFirst({
    where: { userId, planStatus: 'ACTIVE' },
    orderBy: { createdAt: 'desc' },
  })

  if (!record) return NextResponse.json({ plan: null })

  return NextResponse.json({
    plan: record.plan,
    recordId: record.id,
    createdAt: record.createdAt.toISOString(),
    trigger: record.trigger,
    policyVersion: record.policyVersion,
    runtimePolicyVersion: record.runtimePolicyVersion,
    runtimePolicyHash: record.runtimePolicyHash,
  })
}

// POST — accept a plan (make it the active plan)
// Body: { recordId: string }
// Marks the current ACTIVE plan as SUPERSEDED, marks the specified record as ACTIVE.
export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const userId = (session.user as any).id
  if (!userId) return NextResponse.json({ error: 'No user id' }, { status: 400 })

  const body = await req.json()
  const { recordId } = body
  if (!recordId) {
    return NextResponse.json({ error: 'recordId is required' }, { status: 400 })
  }

  // Verify the target record belongs to this user
  const target = await db.decisionRecord.findUnique({ where: { id: recordId } })
  if (!target || target.userId !== userId) {
    return NextResponse.json({ error: 'Plan not found or not owned by user' }, { status: 404 })
  }

  // Mark ALL current ACTIVE plans for this user as SUPERSEDED
  await db.decisionRecord.updateMany({
    where: { userId, planStatus: 'ACTIVE' },
    data: { planStatus: 'SUPERSEDED' },
  })

  // Mark the target as ACTIVE
  await db.decisionRecord.update({
    where: { id: recordId },
    data: { planStatus: 'ACTIVE' },
  })

  return NextResponse.json({ ok: true, activePlanId: recordId })
}
