// PATCH /api/actions/[id]
// Update an action's status: start, complete, block, cancel.
// Body: { status, blockedReason?, stateChange? }
//
// If stateChange is provided (on COMPLETE), creates a new MobilityStateSnapshot
// and returns it so the client can recompute strategy.

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import type { MobilityState } from '@/lib/domain/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type ActionStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETE' | 'BLOCKED' | 'CANCELLED'

interface PatchBody {
  status: ActionStatus
  blockedReason?: string
  /** If completing an action that changes the user's profile, provide the
   *  updated MobilityState fields here. */
  stateChange?: {
    field: string
    oldValue: unknown
    newValue: unknown
    /** The full updated MobilityState (to snapshot) */
    updatedState: MobilityState
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const userId = (session.user as any).id

  const { id } = await params
  const body = (await req.json()) as PatchBody

  // Load the action — verify ownership
  const action = await db.userAction.findUnique({ where: { id } })
  if (!action) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (action.userId !== userId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // Update the action status
  const data: any = { status: body.status }
  if (body.status === 'IN_PROGRESS') data.startedAt = new Date()
  if (body.status === 'COMPLETE') data.completedAt = new Date()
  if (body.status === 'BLOCKED' && body.blockedReason) data.blockedReason = body.blockedReason

  const updated = await db.userAction.update({ where: { id }, data })

  // If completing with a state change, create a new MobilityStateSnapshot
  let stateSnapshotId: string | null = null
  if (body.status === 'COMPLETE' && body.stateChange?.updatedState) {
    // Find or create a Person for this user
    let person = await db.person.findFirst({ where: { userId } })
    if (!person) {
      person = await db.person.create({ data: { userId } })
    }

    // Count existing snapshots for version numbering
    const existingCount = await db.mobilityStateSnapshot.count({ where: { personId: person.id } })
    const snapshot = await db.mobilityStateSnapshot.create({
      data: {
        personId: person.id,
        version: existingCount + 1,
        state: body.stateChange.updatedState as any,
        source: `action:${action.actionId}`,
      },
    })
    stateSnapshotId = snapshot.id
  }

  return NextResponse.json({
    action: updated,
    stateSnapshotId,
    stateChanged: stateSnapshotId !== null,
  })
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const userId = (session.user as any).id
  const { id } = await params

  const action = await db.userAction.findUnique({ where: { id } })
  if (!action) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (action.userId !== userId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  return NextResponse.json({ action })
}
