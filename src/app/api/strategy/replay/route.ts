// GET /api/strategy/replay?recordId=...&mode=replay|verify
//
// Replays or verifies a stored strategy from its provenance.
//
// mode=replay (default):
//   Returns the replay status: EXACT_MATCH | ENGINE_CHANGED | OUTPUT_MISMATCH
//   | POLICY_UNAVAILABLE | STATE_UNAVAILABLE | INTENT_UNAVAILABLE | REPLAY_FAILED
//
// mode=verify:
//   Returns the structured verification checks: recordExists, stateSnapshotExists,
//   intentRecordExists, provenanceMatches, engineVersionKnown, policyAvailable,
//   replaySucceeded, outputMatches.
//
// SECURITY:
//   - Authenticated users only.
//   - A user can only replay/verify their OWN DecisionRecords. The recordId
//     is scoped to the requesting user's userId — passing another user's
//     recordId returns REPLAY_FAILED / recordExists=false (no information
//     leak about whether the record exists for another user).
//   - Neither operation mutates the DecisionRecord or any other persisted state.

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { replayStrategy, verifyStrategyRecord } from '@/lib/strategy/replay'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const userId = (session.user as any).id
  if (!userId) {
    return NextResponse.json({ error: 'No user id' }, { status: 400 })
  }

  const { searchParams } = new URL(req.url)
  const recordId = searchParams.get('recordId')
  if (!recordId) {
    return NextResponse.json({ error: 'recordId query parameter is required' }, { status: 400 })
  }

  const mode = searchParams.get('mode') ?? 'replay'

  try {
    if (mode === 'verify') {
      // Verify: tell me whether the persisted strategy is internally consistent
      // and whether current infrastructure can reproduce it. NEVER mutates.
      const result = await verifyStrategyRecord(recordId, userId)
      return NextResponse.json({ mode: 'verify', result })
    }

    // Replay: attempt to reconstruct the historical strategy.
    // NEVER falls back to current state/intent. NEVER overwrites history.
    const result = await replayStrategy(recordId, userId)
    return NextResponse.json({
      mode: 'replay',
      status: result.status,
      explanation: result.explanation,
      differences: result.differences,
      comparison: result.comparison,
      provenance: result.provenance,
      // We return the replayed strategy's structural summary (not the full
      // snapshot) so the caller can compare without us dumping huge JSON.
      replayedSummary: result.replayedStrategy
        ? {
            bestTrajectoryId: result.replayedStrategy.bestTrajectory?.id,
            bestTrajectoryLabel: result.replayedStrategy.bestTrajectory?.label,
            strategyEngineVersion: result.replayedStrategy.strategyEngineVersion,
            policyHash: result.replayedStrategy.policyContext?.runtimeHash,
            blockersCount: result.replayedStrategy.blockers?.length,
            actionPlanActionsCount: result.replayedStrategy.actionPlan?.actions?.length,
            intentFrontierPointsCount: result.replayedStrategy.intentFrontier?.points?.length,
          }
        : null,
      storedSummary: {
        bestTrajectoryId: result.storedStrategy?.bestTrajectory?.id,
        bestTrajectoryLabel: result.storedStrategy?.bestTrajectory?.label,
        strategyEngineVersion: result.storedStrategy?.strategyEngineVersion,
        policyHash: result.storedStrategy?.policyContext?.runtimeHash,
        blockersCount: result.storedStrategy?.blockers?.length,
        actionPlanActionsCount: result.storedStrategy?.actionPlan?.actions?.length,
        intentFrontierPointsCount: result.storedStrategy?.intentFrontier?.points?.length,
      },
    })
  } catch (err) {
    console.error('[/api/strategy/replay]', err)
    return NextResponse.json({ error: 'Replay failed' }, { status: 500 })
  }
}
