// GET /api/alerts
// Returns the authenticated user's policy alerts (unread first, then by date).
// POST — (admin/internal) create an alert (used by the alert generation pipeline).

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const userId = (session.user as any).id
  if (!userId) {
    return NextResponse.json({ alerts: [], unreadCount: 0 })
  }

  const url = new URL(req.url)
  const unreadOnly = url.searchParams.get('unreadOnly') === 'true'

  const where: any = { userId }
  if (unreadOnly) where.read = false

  const alerts = await db.policyAlert.findMany({
    where,
    orderBy: [{ read: 'asc' }, { createdAt: 'desc' }],
    take: 50,
  })

  const unreadCount = await db.policyAlert.count({ where: { userId, read: false } })

  return NextResponse.json({ alerts, unreadCount })
}

// Internal POST — creates an alert with idempotency. Used by the alert
// generation pipeline (called after a publication).
export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  // Only admins or internal services may create alerts
  if (!session || (session.user as any)?.role !== 'ADMIN') {
    // Allow the cron job / internal pipeline with a service token
    const authHeader = req.headers.get('authorization')
    const expected = `Bearer ${process.env.CRON_SECRET ?? 'wayfinder-cron-dev'}`
    if (authHeader !== expected) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  try {
    const body = await req.json()
    const {
      userId, decisionRecordId, policyPublicationId, policyChangeId,
      impactLevel, severity, title, whatChanged, whyItMatters,
      recommendedAction, alternativeRoutes, idempotencyKey,
    } = body

    if (!userId || !idempotencyKey || !title) {
      return NextResponse.json({ error: 'userId, idempotencyKey, and title are required' }, { status: 400 })
    }

    // Idempotent create — skips if the idempotency key already exists
    const alert = await db.policyAlert.upsert({
      where: { idempotencyKey },
      create: {
        userId,
        decisionRecordId: decisionRecordId ?? null,
        policyPublicationId: policyPublicationId ?? null,
        policyChangeId: policyChangeId ?? '',
        impactLevel: impactLevel ?? 'MINOR_CHANGE',
        severity: severity ?? 'NOTICE',
        title,
        whatChanged: whatChanged ?? '',
        whyItMatters: whyItMatters ?? '',
        recommendedAction: recommendedAction ?? '',
        alternativeRoutes: alternativeRoutes ? JSON.stringify(alternativeRoutes) : null,
        body: `${whatChanged}\n\n${whyItMatters}\n\n${recommendedAction}`,
        idempotencyKey,
      },
      update: {}, // no-op if it already exists
    })

    return NextResponse.json({ alertId: alert.id, created: true })
  } catch (err) {
    console.error('[/api/alerts POST]', err)
    return NextResponse.json({ error: 'Failed to create alert' }, { status: 500 })
  }
}
