// GET /api/admin/policy/candidates
// Lists candidate facts for the review queue. ADMIN only.
// POST — create a candidate manually (for testing).

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any)?.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const url = new URL(req.url)
  const status = url.searchParams.get('status')

  const where = status ? { extractionStatus: status } : {}
  const candidates = await db.candidateFact.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: { sourceSnapshot: { select: { sourceId: true, retrievedAt: true } } },
  })

  return NextResponse.json({ candidates })
}
