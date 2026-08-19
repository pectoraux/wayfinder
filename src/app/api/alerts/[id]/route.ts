// GET /api/alerts/[id]
// Returns a single alert with full detail. Marks it as read on first view.
// POST /api/alerts/[id] — mark as read / dismiss.

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { id } = await params
  const alert = await db.policyAlert.findUnique({ where: { id } })
  if (!alert) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (alert.userId !== (session.user as any).id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Mark as read on view
  if (!alert.read) {
    await db.policyAlert.update({ where: { id }, data: { read: true, readAt: new Date() } })
  }

  return NextResponse.json({ alert })
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { id } = await params
  const body = await req.json().catch(() => ({}))

  const alert = await db.policyAlert.findUnique({ where: { id } })
  if (!alert) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (alert.userId !== (session.user as any).id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const data: any = {}
  if (body.action === 'dismiss') {
    data.dismissedAt = new Date()
  } else if (body.action === 'markRead') {
    data.read = true
    data.readAt = new Date()
  } else if (body.action === 'markUnread') {
    data.read = false
    data.readAt = null
  }

  const updated = await db.policyAlert.update({ where: { id }, data })
  return NextResponse.json({ alert: updated })
}
