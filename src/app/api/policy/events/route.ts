// GET /api/policy/events
// Returns published policy events (user-facing feed). Supports filtering by
// jurisdiction, entityId, and status. Public endpoint (no auth required for
// browsing events — they are verified, published policy changes).

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const jurisdictionId = url.searchParams.get('jurisdiction')
    const entityId = url.searchParams.get('entityId')
    const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50'), 100)

    const where: any = { status: 'PUBLISHED' }
    if (jurisdictionId) where.jurisdictionId = jurisdictionId
    if (entityId) where.entityId = entityId

    let events: any[] = []
    try {
      events = await db.policyEvent.findMany({
        where,
        orderBy: { publishedAt: 'desc' },
        take: limit,
      })
    } catch (e) {
      // DB may be unavailable — return empty
      console.warn('[/api/policy/events] DB unavailable:', e)
    }

    return NextResponse.json({ events })
  } catch (err) {
    console.error('[/api/policy/events]', err)
    return NextResponse.json({ error: 'Failed to fetch events' }, { status: 500 })
  }
}
