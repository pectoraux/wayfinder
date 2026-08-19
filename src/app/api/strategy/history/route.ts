// GET /api/strategy/history?objectiveId=...
//
// Returns the authenticated user's strategy history as a timeline of
// StrategyChange entries. Each entry describes the transition from the
// previous strategy to this one, with:
//   - the deterministic cause (USER_PROFILE_CHANGED, POLICY_CHANGED, etc.)
//   - the structured diff (reusing compareStrategyReplay)
//   - the previous + new strategy summaries
//   - the provenance (state version, intent version, policy hash, engine)
//
// Objective-aware: if objectiveId is provided, filters to that objective.
// If omitted, returns all objectives' histories interleaved by date.
//
// Security: authenticated + user-scoped. A user can only see their own history.
//
// Historical records are immutable — this endpoint NEVER mutates anything.

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { buildStrategyChange, explainStrategyChange, type StrategyRecordSummary } from '@/lib/strategy/change'
import type { Strategy } from '@/lib/strategy/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const userId = (session.user as any).id
  if (!userId) return NextResponse.json({ history: [] })

  const { searchParams } = new URL(req.url)
  const objectiveId = searchParams.get('objectiveId')

  const where: { userId: string; objectiveId?: string } = { userId }
  if (objectiveId) where.objectiveId = objectiveId

  // Fetch all records for this user (+ optional objective), newest first.
  const records = await db.decisionRecord.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 100,
    select: {
      id: true,
      createdAt: true,
      trigger: true,
      changeReason: true,
      planStatus: true,
      stateVersion: true,
      intentVersion: true,
      objectiveId: true,
      runtimePolicyHash: true,
      runtimePolicyVersion: true,
      strategyEngineVersion: true,
      previousRecordId: true,
      policyPublicationId: true,
      policyEventId: true,
      mobilityStateSnapshotId: true,
      intentRecordId: true,
      strategySnapshot: true,
      plan: true,
    },
  })

  // Build a lookup so we can resolve the previous record for each entry.
  const recordMap = new Map(records.map((r) => [r.id, r]))

  // Build the history timeline. Each entry is a StrategyChange describing
  // the transition from previousRecordId → this record.
  const history = records.map((r) => {
    const prev = r.previousRecordId ? recordMap.get(r.previousRecordId) ?? null : null

    const prevSummary: StrategyRecordSummary | null = prev
      ? {
          id: prev.id,
          stateVersion: prev.stateVersion,
          intentVersion: prev.intentVersion,
          objectiveId: prev.objectiveId,
          runtimePolicyHash: prev.runtimePolicyHash,
          strategyEngineVersion: prev.strategyEngineVersion,
          trigger: prev.trigger,
          previousRecordId: prev.previousRecordId,
          changeReason: prev.changeReason,
          createdAt: prev.createdAt,
          strategySnapshot: prev.strategySnapshot,
        }
      : null

    const nextSummary: StrategyRecordSummary = {
      id: r.id,
      stateVersion: r.stateVersion,
      intentVersion: r.intentVersion,
      objectiveId: r.objectiveId,
      runtimePolicyHash: r.runtimePolicyHash,
      strategyEngineVersion: r.strategyEngineVersion,
      trigger: r.trigger,
      previousRecordId: r.previousRecordId,
      changeReason: r.changeReason,
      createdAt: r.createdAt,
      strategySnapshot: r.strategySnapshot,
    }

    const change = buildStrategyChange(prevSummary, nextSummary)
    const explanation = explainStrategyChange(change)

    // Build a lightweight summary for the UI (don't dump the full strategy JSON)
    const strategy = r.strategySnapshot as unknown as Strategy | null
    const prevStrategy = prev?.strategySnapshot as unknown as Strategy | null

    return {
      recordId: r.id,
      createdAt: r.createdAt.toISOString(),
      planStatus: r.planStatus,
      objectiveId: r.objectiveId,
      cause: change.cause,
      explanation,
      previousRecordId: r.previousRecordId,
      // Provenance
      stateVersion: r.stateVersion,
      intentVersion: r.intentVersion,
      runtimePolicyHash: r.runtimePolicyHash,
      runtimePolicyVersion: r.runtimePolicyVersion,
      strategyEngineVersion: r.strategyEngineVersion,
      mobilityStateSnapshotId: r.mobilityStateSnapshotId,
      intentRecordId: r.intentRecordId,
      // Policy links
      policyPublicationId: r.policyPublicationId,
      policyEventId: r.policyEventId,
      // Strategy summaries (lightweight — not full JSON)
      bestTrajectoryLabel: strategy?.bestTrajectory?.label ?? null,
      bestTrajectoryId: strategy?.bestTrajectory?.id ?? null,
      destinationStatus: strategy?.bestTrajectory?.destinationStatus ?? null,
      totalMonths: strategy?.bestTrajectory?.totalMonths ?? null,
      totalCostUSD: strategy?.bestTrajectory?.totalCostUSD ?? null,
      blockersCount: strategy?.blockers?.length ?? 0,
      actionsCount: strategy?.actionPlan?.actions?.length ?? 0,
      // Diff summary
      diffSummary: {
        bestTrajectoryChanged: change.diff.bestTrajectoryChanged,
        blockersChanged: change.diff.blockersChanged,
        actionPlanChanged: change.diff.actionPlanChanged,
        policyContextChanged: change.diff.policyContextChanged,
        engineChanged: change.diff.engineChanged,
        profileAnalysisChanged: change.diff.profileAnalysisChanged,
        intentFrontierChanged: change.diff.intentFrontierChanged,
        differencesCount: change.diff.comparison.differences.length,
        differences: change.diff.comparison.differences.map((d) => ({
          dimension: d.dimension,
          field: d.field,
          explanation: d.explanation,
        })),
      },
      // Previous strategy summary (for the compare view)
      previousBestTrajectoryLabel: prevStrategy?.bestTrajectory?.label ?? null,
    }
  })

  return NextResponse.json({ history, objectiveId: objectiveId ?? null })
}
