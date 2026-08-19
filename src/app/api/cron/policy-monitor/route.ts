// Vercel Cron Job — /api/cron/policy-monitor
// Runs the policy monitoring workflow on a schedule. Protected by a CRON_SECRET
// bearer token (set in Vercel env vars). Vercel cron config is in vercel.json.

import { NextResponse } from 'next/server'
import { runPolicyMonitoring } from '@/lib/policy/monitoring'
import { SOURCES } from '@/lib/policy/sources'
import { db } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: Request) {
  // Verify the cron secret
  const authHeader = req.headers.get('authorization')
  const expected = `Bearer ${process.env.CRON_SECRET ?? 'wayfinder-cron-dev'}`
  if (authHeader !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    // Load previous snapshots from DB
    const previousSnapshots = new Map<string, { contentHash: string; content: string }>()
    const dbSources = await db.policySource.findMany({ where: { active: true } })
    for (const dbs of dbSources) {
      const last = await db.sourceSnapshot.findFirst({
        where: { sourceId: dbs.id, retrievalStatus: 'OK' },
        orderBy: { retrievedAt: 'desc' },
      })
      if (last?.content) {
        const codeSource = SOURCES.find((s) => s.canonicalUrl === dbs.url)
        if (codeSource) {
          previousSnapshots.set(codeSource.id, { contentHash: last.contentHash, content: last.content })
        }
      }
    }

    const results = await runPolicyMonitoring(SOURCES, previousSnapshots, { extractCandidates: true })

    return NextResponse.json({
      ok: true,
      monitored: results.length,
      changed: results.filter((r) => r.changeType && r.changeType !== 'UNCHANGED' && r.changeType !== 'FETCH_ERROR').length,
      candidatesExtracted: results.reduce((s, r) => s + r.candidatesExtracted, 0),
      at: new Date().toISOString(),
    })
  } catch (err) {
    console.error('[cron/policy-monitor]', err)
    return NextResponse.json({ error: 'Monitoring failed' }, { status: 500 })
  }
}
