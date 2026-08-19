// GET /api/policy/events/[id]
// Returns a single policy event with full detail. Public endpoint.

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    let event: any = null
    try {
      event = await db.policyEvent.findUnique({ where: { id } })
    } catch (e) {
      console.warn('[/api/policy/events/[id]] DB unavailable:', e)
    }
    if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 404 })
    return NextResponse.json({ event })
  } catch (err) {
    console.error('[/api/policy/events/[id]]', err)
    return NextResponse.json({ error: 'Failed to fetch event' }, { status: 500 })
  }
}
