// GET /api/policy/snapshot
// Returns policy snapshots. With ?asOf=YYYY-MM-DD returns the snapshot active
// on that date. With ?id=snap-2024-11 returns that specific snapshot with its
// programs, requirements, transitions. Without params, returns all snapshots.

import { NextResponse } from 'next/server'
import {
  getPolicySnapshot,
  getCurrentPolicySnapshot,
  listSnapshots,
  getProgramsInSnapshot,
  getRequirementsInSnapshot,
  getTransitionsInSnapshot,
} from '@/lib/policy/snapshot'
import { getManyEvidence } from '@/lib/knowledge/evidence'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const asOf = url.searchParams.get('asOf')
  const id = url.searchParams.get('id')
  const jurisdiction = url.searchParams.get('jurisdiction') ?? 'global'

  if (id) {
    const snap = listSnapshots().find((s) => s.id === id)
    if (!snap) return NextResponse.json({ error: 'Snapshot not found' }, { status: 404 })
    return NextResponse.json({
      snapshot: snap,
      programs: getProgramsInSnapshot(id),
      requirements: getRequirementsInSnapshot(id),
      transitions: getTransitionsInSnapshot(id),
      evidence: getManyEvidence(snap.evidenceIds),
    })
  }

  if (asOf) {
    const snap = getPolicySnapshot(jurisdiction, asOf)
    return NextResponse.json({
      snapshot: snap,
      programs: getProgramsInSnapshot(snap.id),
      requirements: getRequirementsInSnapshot(snap.id),
      transitions: getTransitionsInSnapshot(snap.id),
      evidence: getManyEvidence(snap.evidenceIds),
    })
  }

  return NextResponse.json({
    current: getCurrentPolicySnapshot(jurisdiction),
    snapshots: listSnapshots(),
  })
}
