// GET /api/strategy/compare?recordId=...
//
// Returns a structured diff between a historical DecisionRecord and the
// user's current ACTIVE strategy for the SAME objective.
//
// This lets the user answer:
//   "How does this historical strategy compare to what I have now?"
//
// The diff is deterministic — reuses compareStrategyReplay so there is ONE
// comparison code path. Ephemeral fields (generatedAt, explanation prose)
// are excluded.
//
// Security: authenticated + user-scoped. A user can only compare their own
// records. Cross-user access returns 404 (no information leak).
//
// This endpoint NEVER mutates anything — historical records are immutable.

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { buildStrategyDiff, explainStrategyChange, buildStrategyChange, type StrategyRecordSummary } from '@/lib/strategy/change'
import type { Strategy } from '@/lib/strategy/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const userId = (session.user as any).id
  if (!userId) return NextResponse.json({ error: 'No user id' }, { status: 400 })

  const { searchParams } = new URL(req.url)
  const recordId = searchParams.get('recordId')
  if (!recordId) {
    return NextResponse.json({ error: 'recordId query parameter is required' }, { status: 400 })
  }

  // Load the historical record — must belong to this user.
  const historical = await db.decisionRecord.findFirst({
    where: { id: recordId, userId },
  })
  if (!historical) {
    return NextResponse.json({ error: 'Record not found' }, { status: 404 })
  }

  // Load the current ACTIVE strategy for the SAME objective (if any).
  // If the historical record IS the current active, we compare against itself
  // (the diff will be empty).
  const current = historical.planStatus === 'ACTIVE'
    ? historical
    : await db.decisionRecord.findFirst({
        where: {
          userId,
          planStatus: 'ACTIVE',
          objectiveId: historical.objectiveId,
        },
        orderBy: { createdAt: 'desc' },
      })

  const historicalStrategy = historical.strategySnapshot as unknown as Strategy | null
  const currentStrategy = current?.strategySnapshot as unknown as Strategy | null

  if (!historicalStrategy || !currentStrategy) {
    return NextResponse.json({ error: 'Strategy snapshot missing' }, { status: 404 })
  }

  // Build the structured diff
  const diff = buildStrategyDiff(historicalStrategy, currentStrategy)

  // Build the change description (for the explanation)
  const prevSummary: StrategyRecordSummary = {
    id: historical.id,
    stateVersion: historical.stateVersion,
    intentVersion: historical.intentVersion,
    objectiveId: historical.objectiveId,
    runtimePolicyHash: historical.runtimePolicyHash,
    strategyEngineVersion: historical.strategyEngineVersion,
    trigger: historical.trigger,
    previousRecordId: historical.previousRecordId,
    changeReason: historical.changeReason,
    createdAt: historical.createdAt,
    strategySnapshot: historical.strategySnapshot,
  }
  const nextSummary: StrategyRecordSummary = {
    id: current!.id,
    stateVersion: current!.stateVersion,
    intentVersion: current!.intentVersion,
    objectiveId: current!.objectiveId,
    runtimePolicyHash: current!.runtimePolicyHash,
    strategyEngineVersion: current!.strategyEngineVersion,
    trigger: current!.trigger,
    previousRecordId: current!.previousRecordId,
    changeReason: current!.changeReason,
    createdAt: current!.createdAt,
    strategySnapshot: current!.strategySnapshot,
  }
  const change = buildStrategyChange(prevSummary, nextSummary)
  const explanation = explainStrategyChange(change)

  return NextResponse.json({
    historical: {
      recordId: historical.id,
      createdAt: historical.createdAt.toISOString(),
      planStatus: historical.planStatus,
      objectiveId: historical.objectiveId,
      bestTrajectoryLabel: historicalStrategy.bestTrajectory?.label ?? null,
      bestTrajectoryId: historicalStrategy.bestTrajectory?.id ?? null,
      destinationStatus: historicalStrategy.bestTrajectory?.destinationStatus ?? null,
      totalMonths: historicalStrategy.bestTrajectory?.totalMonths ?? null,
      totalCostUSD: historicalStrategy.bestTrajectory?.totalCostUSD ?? null,
      blockersCount: historicalStrategy.blockers?.length ?? 0,
      actionsCount: historicalStrategy.actionPlan?.actions?.length ?? 0,
      stateVersion: historical.stateVersion,
      intentVersion: historical.intentVersion,
      runtimePolicyHash: historical.runtimePolicyHash,
      strategyEngineVersion: historical.strategyEngineVersion,
    },
    current: {
      recordId: current!.id,
      createdAt: current!.createdAt.toISOString(),
      planStatus: current!.planStatus,
      objectiveId: current!.objectiveId,
      bestTrajectoryLabel: currentStrategy.bestTrajectory?.label ?? null,
      bestTrajectoryId: currentStrategy.bestTrajectory?.id ?? null,
      destinationStatus: currentStrategy.bestTrajectory?.destinationStatus ?? null,
      totalMonths: currentStrategy.bestTrajectory?.totalMonths ?? null,
      totalCostUSD: currentStrategy.bestTrajectory?.totalCostUSD ?? null,
      blockersCount: currentStrategy.blockers?.length ?? 0,
      actionsCount: currentStrategy.actionPlan?.actions?.length ?? 0,
      stateVersion: current!.stateVersion,
      intentVersion: current!.intentVersion,
      runtimePolicyHash: current!.runtimePolicyHash,
      strategyEngineVersion: current!.strategyEngineVersion,
    },
    cause: change.cause,
    explanation,
    diff: {
      bestTrajectoryChanged: diff.bestTrajectoryChanged,
      blockersChanged: diff.blockersChanged,
      actionPlanChanged: diff.actionPlanChanged,
      policyContextChanged: diff.policyContextChanged,
      engineChanged: diff.engineChanged,
      profileAnalysisChanged: diff.profileAnalysisChanged,
      intentFrontierChanged: diff.intentFrontierChanged,
      differences: diff.comparison.differences,
      exact: diff.comparison.exact,
    },
  })
}
