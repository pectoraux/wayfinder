// GET /api/policy/affected?from=snap-2024-11&to=snap-2026-01
// Returns the impact analysis: for each policy change, which routes,
// transitions, and decision records are affected.

import { NextResponse } from 'next/server'
import { comparePolicySnapshots } from '@/lib/policy/snapshot'
import { getPolicyImpact } from '@/lib/graph/mobility-graph'
import { db } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const from = url.searchParams.get('from')
  const to = url.searchParams.get('to')

  if (!from || !to) {
    return NextResponse.json({ error: 'from and to snapshot ids are required' }, { status: 400 })
  }

  const diff = comparePolicySnapshots(from, to)

  // Fetch saved decision records to check impact. We pass a lightweight
  // projection (id, policyVersion, asOfDate) to the impact analyzer.
  let decisionRecords: { id: string; policyVersion: string; asOfDate: string }[] = []
  try {
    const records = await db.decisionRecord.findMany({
      select: { id: true, policyVersion: true, asOfDate: true },
      take: 500,
    })
    decisionRecords = records.map((r) => ({
      id: r.id,
      policyVersion: r.policyVersion,
      asOfDate: r.asOfDate.toISOString(),
    }))
  } catch (e) {
    // DB may be empty/unavailable; impact analysis still works for routes
    console.warn('[/api/policy/affected] could not fetch decision records:', e)
  }

  const impacts = diff.changes.map((change) => getPolicyImpact(change, decisionRecords))

  return NextResponse.json({
    fromSnapshotId: from,
    toSnapshotId: to,
    changeCount: diff.changes.length,
    impacts,
    summary: diff.summary,
  })
}
