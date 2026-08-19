// /api/watchlist
// GET    — list the authenticated user's watchlist entries
// POST   — add a watch entry (watchType, watchId, watchLabel)
// DELETE — remove a watch entry (by id or watchType+watchId)

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const userId = (session.user as any).id
  if (!userId) return NextResponse.json({ entries: [] })

  const entries = await db.policyWatchlist.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
  })
  return NextResponse.json({ entries })
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const userId = (session.user as any).id
  if (!userId) return NextResponse.json({ error: 'No user id' }, { status: 400 })

  const body = await req.json()
  const { watchType, watchId, watchLabel } = body
  if (!watchType || !watchId || !watchLabel) {
    return NextResponse.json({ error: 'watchType, watchId, and watchLabel are required' }, { status: 400 })
  }

  // Upsert (unique on userId + watchType + watchId)
  const entry = await db.policyWatchlist.upsert({
    where: { userId_watchType_watchId: { userId, watchType, watchId } },
    create: { userId, watchType, watchId, watchLabel },
    update: { watchLabel }, // update the label in case it changed
  })

  return NextResponse.json({ entry })
}

export async function DELETE(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const userId = (session.user as any).id

  const url = new URL(req.url)
  const id = url.searchParams.get('id')
  const watchType = url.searchParams.get('watchType')
  const watchId = url.searchParams.get('watchId')

  if (id) {
    await db.policyWatchlist.deleteMany({ where: { id, userId: userId ?? undefined } })
  } else if (watchType && watchId && userId) {
    await db.policyWatchlist.delete({
      where: { userId_watchType_watchId: { userId, watchType, watchId } },
    })
  } else {
    return NextResponse.json({ error: 'Provide id or watchType+watchId' }, { status: 400 })
  }

  return NextResponse.json({ ok: true })
}
