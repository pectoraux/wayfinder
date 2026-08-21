// GET /api/strategy/[id]/outcomes
// Lists ALL expected + observed outcomes for a strategy (both action-level
// and strategy-level). Returns a unified view of:
//   - Expected outcomes (predictions frozen at adoption time)
//   - Observed outcomes (actual results recorded later)
//   - Evaluations (deterministic ACHIEVED/PARTIALLY_ACHIEVED/NOT_ACHIEVED/UNKNOWN)
//
// N0.7 OUTCOME INTELLIGENCE:
//   - User-scoped + authenticated. No cross-user access.
//   - Objective-aware: outcomes are filtered by the strategy's objectiveId.
//   - Immutable: this endpoint never writes — it only reads.
//   - Deterministic: same data → same output.
//
// Returns:
//   {
//     strategyOutcome: StrategyOutcome | null,  // the strategy-level expected+observed
//     actionOutcomes: [{ action, expected, observed, evaluation }],
//     summary: { totalExpected, totalObserved, achievedCount, ... }
//   }

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { evaluateActionOutcomeN07, evaluateStrategyOutcomeN07, type OutcomeEvaluation } from '@/lib/strategy/outcome-intelligence'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const userId = (session.user as any).id
  if (!userId) return NextResponse.json({ error: 'No user id' }, { status: 400 })

  const { id: decisionRecordId } = await params

  // 1. Verify the DecisionRecord belongs to this user
  const record = await db.decisionRecord.findFirst({
    where: { id: decisionRecordId, userId },
  })
  if (!record) {
    return NextResponse.json({ error: 'Record not found' }, { status: 404 })
  }

  // 2. Fetch the strategy-level outcomes (expected + observed)
  //    Expected = provenance SYSTEM_DERIVED (auto-created at adoption)
  //    Observed = provenance USER_REPORTED or EXTERNALLY_VERIFIED
  const strategyOutcomes = await db.strategyOutcome.findMany({
    where: { decisionRecordId },
    orderBy: { createdAt: 'asc' },
  })

  const strategyExpected = strategyOutcomes.find((o) => o.provenance === 'SYSTEM_DERIVED')
  const strategyObserved = strategyOutcomes.filter((o) => o.provenance !== 'SYSTEM_DERIVED')

  // Compute evaluation for the latest observed strategy outcome
  let strategyEvaluation: OutcomeEvaluation | null = null
  const latestStrategyObserved = strategyObserved[strategyObserved.length - 1]
  if (strategyExpected && latestStrategyObserved) {
    strategyEvaluation = evaluateStrategyOutcomeN07({
      predictedTrajectoryViable: strategyExpected.predictedTrajectoryViable,
      actualTrajectoryViable: latestStrategyObserved.actualTrajectoryViable,
      predictedTimelineMonths: strategyExpected.predictedTimelineMonths,
      actualTimelineMonths: latestStrategyObserved.actualTimelineMonths,
      predictedTotalCostUSD: strategyExpected.predictedTotalCostUSD,
      actualTotalCostUSD: latestStrategyObserved.actualTotalCostUSD,
      strategyFollowed: latestStrategyObserved.strategyFollowed,
      expectedOutcomeId: strategyExpected.id,
      provenance: latestStrategyObserved.provenance,
    })
  } else if (strategyExpected) {
    // Expected but not yet observed
    strategyEvaluation = {
      status: 'UNKNOWN',
      explanation: 'No actual observation recorded yet — evaluation is unknown.',
      expectedOutcomeId: strategyExpected.id,
      dimensions: [],
      basedOnUserReport: false,
    }
  }

  // 3. Fetch the action-level outcomes
  //    Find all UserActions linked to this DecisionRecord
  const userActions = await db.userAction.findMany({
    where: { decisionRecordId },
    orderBy: { createdAt: 'asc' },
  })

  const actionOutcomes: Array<{
    action: { id: string; actionId: string; title: string; status: string }
    expected: Awaited<ReturnType<typeof db.actionOutcome.findFirst>> | null
    observed: Awaited<ReturnType<typeof db.actionOutcome.findMany>>
    evaluation: OutcomeEvaluation | null
  }> = []
  for (const userAction of userActions) {
    const outcomes = await db.actionOutcome.findMany({
      where: { userActionId: userAction.id },
      orderBy: { createdAt: 'asc' },
    })

    const expected = outcomes.find((o) => o.provenance === 'SYSTEM_DERIVED')
    const observed = outcomes.filter((o) => o.provenance !== 'SYSTEM_DERIVED')
    const latestObserved = observed[observed.length - 1]

    let evaluation: OutcomeEvaluation | null = null
    if (expected && latestObserved) {
      evaluation = evaluateActionOutcomeN07({
        predictedEffect: expected.predictedEffect,
        actualEffect: latestObserved.actualEffect,
        predictedDurationMonths: expected.predictedDurationMonths,
        actualDurationMonths: latestObserved.actualDurationMonths,
        predictedCostUSD: expected.predictedCostUSD,
        actualCostUSD: latestObserved.actualCostUSD,
        predictedBlockerResolved: expected.predictedBlockerResolved,
        actualBlockerResolved: latestObserved.actualBlockerResolved,
        expectedOutcomeId: expected.id,
        provenance: latestObserved.provenance,
      })
    } else if (expected) {
      evaluation = {
        status: 'UNKNOWN',
        explanation: 'No actual observation recorded yet — evaluation is unknown.',
        expectedOutcomeId: expected.id,
        dimensions: [],
        basedOnUserReport: false,
      }
    }

    actionOutcomes.push({
      action: {
        id: userAction.id,
        actionId: userAction.actionId,
        title: userAction.title,
        status: userAction.status,
      },
      expected: expected ?? null,
      observed: observed,
      evaluation,
    })
  }

  // 4. Compute summary
  const totalExpected = (strategyExpected ? 1 : 0) + actionOutcomes.filter((a) => a.expected).length
  const totalObserved = strategyObserved.length + actionOutcomes.reduce((sum, a) => sum + a.observed.length, 0)
  const achievedCount = [
    strategyEvaluation?.status,
    ...actionOutcomes.map((a) => a.evaluation?.status),
  ].filter((s) => s === 'ACHIEVED').length
  const partiallyAchievedCount = [
    strategyEvaluation?.status,
    ...actionOutcomes.map((a) => a.evaluation?.status),
  ].filter((s) => s === 'PARTIALLY_ACHIEVED').length
  const notAchievedCount = [
    strategyEvaluation?.status,
    ...actionOutcomes.map((a) => a.evaluation?.status),
  ].filter((s) => s === 'NOT_ACHIEVED').length
  const unknownCount = [
    strategyEvaluation?.status,
    ...actionOutcomes.map((a) => a.evaluation?.status),
  ].filter((s) => s === 'UNKNOWN' || s === undefined).length

  return NextResponse.json({
    decisionRecordId,
    objectiveId: record.objectiveId,
    strategyOutcome: {
      expected: strategyExpected ?? null,
      observed: strategyObserved,
      evaluation: strategyEvaluation,
    },
    actionOutcomes,
    summary: {
      totalExpected,
      totalObserved,
      achieved: achievedCount,
      partiallyAchieved: partiallyAchievedCount,
      notAchieved: notAchievedCount,
      unknown: unknownCount,
    },
  })
}
