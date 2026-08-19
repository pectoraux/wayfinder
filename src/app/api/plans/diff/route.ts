// POST /api/plans/diff
// Given two plan record ids (oldRecordId, newRecordId), returns the deterministic
// plan diff. Uses the existing diffPlans function — no LLM.

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { diffPlans } from '@/lib/policy/plan-diff'
import type { MobilityPlan } from '@/lib/domain/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const userId = (session.user as any).id

  const body = await req.json()
  const { oldRecordId, newRecordId } = body
  if (!oldRecordId || !newRecordId) {
    return NextResponse.json({ error: 'oldRecordId and newRecordId are required' }, { status: 400 })
  }

  // Load both records (must belong to the user for privacy)
  const [oldRecord, newRecord] = await Promise.all([
    db.decisionRecord.findUnique({ where: { id: oldRecordId } }),
    db.decisionRecord.findUnique({ where: { id: newRecordId } }),
  ])

  if (!oldRecord || !newRecord) {
    return NextResponse.json({ error: 'Record not found' }, { status: 404 })
  }
  if (oldRecord.userId !== userId || newRecord.userId !== userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const oldPlan = oldRecord.plan as unknown as MobilityPlan
  const newPlan = newRecord.plan as unknown as MobilityPlan
  const diff = diffPlans(oldPlan, newPlan)

  return NextResponse.json({
    diff,
    oldPlan: {
      recordId: oldRecord.id,
      createdAt: oldRecord.createdAt.toISOString(),
      bestRoute: oldPlan.routes.find((r) => r.id === oldPlan.recommendation.bestRouteId)?.label,
      policyVersion: oldRecord.policyVersion,
    },
    newPlan: {
      recordId: newRecord.id,
      createdAt: newRecord.createdAt.toISOString(),
      bestRoute: newPlan.routes.find((r) => r.id === newPlan.recommendation.bestRouteId)?.label,
      policyVersion: newRecord.policyVersion,
    },
  })
}
