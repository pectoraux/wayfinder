// GET /api/policy/diff?from=snap-2024-11&to=snap-2026-01
// Returns the structured PolicyDiff between two snapshots.

import { NextResponse } from 'next/server'
import { comparePolicySnapshots } from '@/lib/policy/snapshot'
import { getManyEvidence } from '@/lib/knowledge/evidence'

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
  const evidenceIds = Array.from(new Set(diff.changes.flatMap((c) => c.evidenceIds)))

  return NextResponse.json({
    diff,
    evidence: getManyEvidence(evidenceIds),
  })
}
