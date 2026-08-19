// GET /api/plans/history
// Returns the authenticated user's plan history (all DecisionRecords, newest first).
// Each record includes: id, createdAt, trigger, planStatus, bestRouteLabel,
// policyVersion, previousRecordId, policyPublicationId.

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
  if (!userId) return NextResponse.json({ plans: [] })

  const records = await db.decisionRecord.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: {
      id: true,
      createdAt: true,
      trigger: true,
      planStatus: true,
      policyVersion: true,
      runtimePolicyVersion: true,
      previousRecordId: true,
      policyPublicationId: true,
      plan: true,
    },
  })

  // Extract a summary from each plan
  const plans = records.map((r) => {
    const plan = r.plan as any
    const bestRoute = plan?.routes?.find((rt: any) => rt.id === plan?.recommendation?.bestRouteId)
    return {
      id: r.id,
      createdAt: r.createdAt.toISOString(),
      trigger: r.trigger,
      planStatus: r.planStatus,
      policyVersion: r.policyVersion,
      runtimePolicyVersion: r.runtimePolicyVersion,
      previousRecordId: r.previousRecordId,
      policyPublicationId: r.policyPublicationId,
      bestRouteLabel: bestRoute?.label ?? 'Unknown',
      bestRouteId: bestRoute?.id ?? '',
      asOfDate: plan?.asOfDate ?? '',
    }
  })

  return NextResponse.json({ plans })
}
