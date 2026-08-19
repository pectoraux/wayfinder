// POST /api/route/validate
// Given a route (entryPathwayId + original snapshot) and a target snapshot,
// returns whether the route is still valid and the invalidation reasons.
//
// Body: { route: { entryPathwayId, eligibility: { evidenceIds: [] } }, originalSnapshotId, currentSnapshotId }

import { NextResponse } from 'next/server'
import { isRouteStillValid } from '@/lib/graph/mobility-graph'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface ValidateBody {
  route: { entryPathwayId: string; eligibility: { evidenceIds: string[] } }
  originalSnapshotId: string
  currentSnapshotId: string
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as ValidateBody
    if (!body?.route || !body.originalSnapshotId || !body.currentSnapshotId) {
      return NextResponse.json({ error: 'route, originalSnapshotId, and currentSnapshotId are required' }, { status: 400 })
    }
    const invalidation = isRouteStillValid(body.route, body.originalSnapshotId, body.currentSnapshotId)
    return NextResponse.json({ invalidation })
  } catch (err) {
    console.error('[/api/route/validate]', err)
    return NextResponse.json({ error: 'Failed to validate route' }, { status: 500 })
  }
}
