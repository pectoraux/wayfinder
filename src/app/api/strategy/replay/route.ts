// GET /api/strategy/replay?recordId=...
// Replays a stored strategy from its provenance and returns the replay status.
//
// Returns one of:
//   EXACT_MATCH | ENGINE_CHANGED | POLICY_UNAVAILABLE | STATE_UNAVAILABLE
//   | INTENT_UNAVAILABLE | REPLAY_FAILED
//
// This is the audit endpoint — it lets an administrator or curious user verify
// that a historical strategy can be reproduced from its stored inputs.

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

  const { searchParams } = new URL(req.url)
  const recordId = searchParams.get('recordId')
  if (!recordId) {
    return NextResponse.json({ error: 'recordId query parameter is required' }, { status: 400 })
  }

  const verify = req.headers.get('x-wayfinder-verify') === '1'
  const mode = searchParams.get('mode') ?? 'replay'

  try {
    if (verify || mode === 'verify') {
      const result = await verifyStrategyRecord(recordId)
      return NextResponse.json({ mode: 'verify', result })
    }

    const result = await replayStrategy(recordId)
    return NextResponse.json({
      mode: 'replay',
      status: result.status,
      explanation: result.explanation,
      differences: result.differences,
      provenance: result.provenance,
      // We return the replayed strategy's structural summary (not the full
      // snapshot) so the caller can compare without us dumping huge JSON.
      replayedSummary: result.replayedStrategy
        ? {
            bestTrajectoryId: result.replayedStrategy.bestTrajectory?.id,
            bestTrajectoryLabel: result.replayedStrategy.bestTrajectory?.label,
            strategyEngineVersion: result.replayedStrategy.strategyEngineVersion,
            policyHash: result.replayedStrategy.policyContext?.runtimeHash,
          }
        : null,
      storedSummary: {
        bestTrajectoryId: result.storedStrategy?.bestTrajectory?.id,
        bestTrajectoryLabel: result.storedStrategy?.bestTrajectory?.label,
        strategyEngineVersion: result.storedStrategy?.strategyEngineVersion,
        policyHash: result.storedStrategy?.policyContext?.runtimeHash,
      },
    })
  } catch (err) {
    console.error('[/api/strategy/replay]', err)
    return NextResponse.json({ error: 'Replay failed' }, { status: 500 })
  }
}
