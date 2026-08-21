// GET /api/strategy/[id]/explanation
// Returns the decision graph + deterministic explanation for a historical strategy.
//
// The explanation is reconstructed from the stored strategy snapshot — it is
// NOT regenerated from current inputs. This preserves historical immutability.
//
// Security: authenticated + user-scoped. The DecisionRecord must belong to
// the requesting user.

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { buildDecisionGraph, generateExplanation } from '@/lib/strategy/decision-graph'
import type { Strategy } from '@/lib/strategy/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const userId = (session.user as any).id
  if (!userId) return NextResponse.json({ error: 'No user id' }, { status: 400 })

  const { id: recordId } = await params

  // Verify the DecisionRecord belongs to this user
  const record = await db.decisionRecord.findFirst({
    where: { id: recordId, userId },
  })
  if (!record) {
    return NextResponse.json({ error: 'Record not found' }, { status: 404 })
  }

  const strategy = record.strategySnapshot as unknown as Strategy | null
  if (!strategy) {
    return NextResponse.json({ error: 'Strategy snapshot missing' }, { status: 404 })
  }

  // If the strategy already has a decision graph (N0.6+), return it.
  // Otherwise, reconstruct it from the stored strategy — but mark it as
  // legacyReconstructed so the audit trail is honest about provenance.
  let graph = strategy.decisionGraph
  let explanation = strategy.explanation

  if (!graph) {
    // FIX #7: mark as legacy reconstructed — this graph was NOT originally
    // persisted with the historical record. It is reconstructed for
    // backward compatibility, not as historical evidence.
    graph = buildDecisionGraph(strategy, true)
  }
  if (!explanation || typeof explanation === 'string') {
    explanation = generateExplanation(strategy, graph)
  }

  return NextResponse.json({
    recordId: record.id,
    createdAt: record.createdAt.toISOString(),
    objectiveId: record.objectiveId,
    strategy: {
      bestTrajectoryLabel: strategy.bestTrajectory?.label ?? null,
      statedGoal: strategy.intent?.statedGoal ?? null,
    },
    graph,
    explanation,
  })
}
