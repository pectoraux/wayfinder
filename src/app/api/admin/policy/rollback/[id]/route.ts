// POST /api/admin/policy/rollback/[id]
// Rolls back a published policy overlay. Does NOT delete the publication —
// marks it ROLLED_BACK and creates an audit record. The runtime policy cache
// is invalidated so the overlay is no longer active.
// ADMIN only.

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { invalidateRuntimePolicyCache } from '@/lib/policy/runtime-resolver'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface RollbackBody {
  reason?: string
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any)?.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const body = (await req.json().catch(() => ({}))) as RollbackBody

  try {
    const publication = await db.policyPublication.findUnique({ where: { id } })
    if (!publication) {
      return NextResponse.json({ error: 'Publication not found' }, { status: 404 })
    }
    if (publication.status !== 'PUBLISHED') {
      return NextResponse.json({ error: `Cannot rollback: status is ${publication.status}, not PUBLISHED` }, { status: 400 })
    }

    // Mark as rolled back (never delete)
    const updated = await db.policyPublication.update({
      where: { id },
      data: {
        status: 'ROLLED_BACK',
        rolledBackAt: new Date(),
        rolledBackBy: session.user?.email ?? 'unknown',
        rollbackReason: body.reason ?? 'No reason provided',
      },
    })

    // Audit record
    await db.adminAuditRecord.create({
      data: {
        adminId: (session.user as any).id ?? 'unknown',
        adminEmail: session.user?.email ?? 'unknown',
        action: 'PUBLISH_POLICY_VERSION',
        entityId: id,
        entityType: 'PolicyPublication',
        before: JSON.stringify({ status: 'PUBLISHED' }),
        after: JSON.stringify({ status: 'ROLLED_BACK', reason: body.reason }),
        reason: body.reason,
      },
    })

    // Invalidate the runtime policy cache so the rollback takes effect
    invalidateRuntimePolicyCache()

    return NextResponse.json({
      ok: true,
      publicationId: id,
      status: 'ROLLED_BACK',
      rolledBackAt: updated.rolledBackAt,
    })
  } catch (err) {
    console.error('[/api/admin/policy/rollback]', err)
    return NextResponse.json({ error: 'Rollback failed' }, { status: 500 })
  }
}
