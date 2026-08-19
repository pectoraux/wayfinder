// GET /api/admin/policy/dashboard
// Returns the policy monitoring dashboard: sources monitored, sources healthy,
// pending reviews, verified changes, fetch failures, etc. ADMIN only.

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { SOURCES } from '@/lib/policy/sources'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any)?.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const [totalCandidates, pendingReview, approved, rejected, publications, auditRecords, dbSources, recentSnapshots] = await Promise.all([
      db.candidateFact.count(),
      db.candidateFact.count({ where: { extractionStatus: 'PENDING_REVIEW' } }),
      db.candidateFact.count({ where: { extractionStatus: 'APPROVED' } }),
      db.candidateFact.count({ where: { extractionStatus: 'REJECTED' } }),
      db.policyPublication.count(),
      db.adminAuditRecord.count(),
      db.policySource.count(),
      db.sourceSnapshot.findMany({ orderBy: { retrievedAt: 'desc' }, take: 10, include: { source: true } }),
    ])

    const changedSnapshots = recentSnapshots.filter((s) => s.changeType && s.changeType !== 'UNCHANGED' && s.changeType !== 'FETCH_ERROR')
    const fetchFailures = recentSnapshots.filter((s) => s.changeType === 'FETCH_ERROR')

    return NextResponse.json({
      sources: {
        registered: SOURCES.length,
        inDb: dbSources,
        active: SOURCES.filter((s) => s.active).length,
      },
      candidates: {
        total: totalCandidates,
        pendingReview,
        approved,
        rejected,
      },
      publications: {
        total: publications,
      },
      recentSnapshots: recentSnapshots.map((s) => ({
        id: s.id,
        sourceId: s.sourceId,
        sourceName: s.source?.name ?? 'Unknown',
        sourceUrl: s.source?.url ?? '',
        retrievedAt: s.retrievedAt,
        changeType: s.changeType,
        contentHash: s.contentHash,
      })),
      changedCount: changedSnapshots.length,
      fetchFailureCount: fetchFailures.length,
      auditRecords,
    })
  } catch (err) {
    console.error('[/api/admin/policy/dashboard]', err)
    return NextResponse.json({ error: 'Failed to load dashboard' }, { status: 500 })
  }
}
