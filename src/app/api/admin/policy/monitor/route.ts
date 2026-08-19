// POST /api/admin/policy/monitor
// Triggers a policy monitoring run (fetch all active sources, detect changes,
// extract candidates). ADMIN only. This is the endpoint the Vercel cron job
// calls, and the admin "Run monitoring now" button.

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { runPolicyMonitoring } from '@/lib/policy/monitoring'
import { SOURCES } from '@/lib/policy/sources'
import { db } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60 // Vercel serverless function limit

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any)?.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const body = await req.json().catch(() => ({}))
    const { extractCandidates = true, sourceIds } = body

    // Filter sources if specific ids requested
    const sources = sourceIds?.length
      ? SOURCES.filter((s) => sourceIds.includes(s.id))
      : SOURCES

    // Load previous snapshots from DB (most recent per source)
    const previousSnapshots = new Map<string, { contentHash: string; content: string }>()
    try {
      for (const source of sources) {
        const dbSource = await db.policySource.findUnique({ where: { url: source.canonicalUrl } })
        if (dbSource) {
          const lastSnap = await db.sourceSnapshot.findFirst({
            where: { sourceId: dbSource.id, retrievalStatus: 'OK' },
            orderBy: { retrievedAt: 'desc' },
          })
          if (lastSnap?.content) {
            previousSnapshots.set(source.id, { contentHash: lastSnap.contentHash, content: lastSnap.content })
          }
        }
      }
    } catch (e) {
      console.warn('[monitor] could not load previous snapshots:', e)
    }

    const results = await runPolicyMonitoring(sources, previousSnapshots, { extractCandidates })

    // Persist snapshots to DB
    for (const result of results) {
      if (!result.fetched || !result.contentHash) continue
      const source = sources.find((s) => s.id === result.sourceId)
      if (!source) continue

      try {
        const dbSource = await db.policySource.upsert({
          where: { url: source.canonicalUrl },
          create: {
            jurisdictionId: source.jurisdictionId,
            sourceType: source.sourceType,
            authority: source.authority,
            name: source.name,
            url: source.canonicalUrl,
            retrievalMethod: source.retrievalMethod,
            trustLevel: source.trustLevel,
            active: source.active,
            monitoringFrequencyHours: source.monitoringFrequencyHours,
            lastCheckedAt: new Date(),
            lastSuccessfulFetchAt: new Date(),
          },
          update: {
            lastCheckedAt: new Date(),
            lastSuccessfulFetchAt: new Date(),
          },
        })

        await db.sourceSnapshot.create({
          data: {
            sourceId: dbSource.id,
            contentHash: result.contentHash,
            contentType: 'text/html',
            contentLength: 0,
            retrievalStatus: result.changeType === 'FETCH_ERROR' ? 'HTTP_ERROR' : 'OK',
            changeType: result.changeType ?? undefined,
            diffSummary: result.diffSummary ?? undefined,
          },
        })
      } catch (e) {
        console.error('[monitor] DB persist failed for', result.sourceId, e)
      }
    }

    return NextResponse.json({
      monitored: results.length,
      changed: results.filter((r) => r.changeType && r.changeType !== 'UNCHANGED' && r.changeType !== 'FETCH_ERROR').length,
      errors: results.filter((r) => r.changeType === 'FETCH_ERROR').length,
      candidatesExtracted: results.reduce((sum, r) => sum + r.candidatesExtracted, 0),
      results,
    })
  } catch (err) {
    console.error('[/api/admin/policy/monitor]', err)
    return NextResponse.json({ error: 'Monitoring failed' }, { status: 500 })
  }
}

export async function GET() {
  return NextResponse.json({ ok: true, endpoint: '/api/admin/policy/monitor', method: 'POST' })
}
