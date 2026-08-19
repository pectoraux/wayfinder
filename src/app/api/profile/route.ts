// POST /api/profile
// Updates the user's mobility state. Creates a new immutable MobilityStateSnapshot.
// Returns the new state version + triggers strategy recomputation on the client.
//
// Body: { updates: Partial<MobilityState>, currentState: MobilityState }
// The server merges the updates into the current state and snapshots the result.

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import type { MobilityState } from '@/lib/domain/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface ProfileUpdateBody {
  updates: Record<string, unknown>
  currentState: MobilityState
}

/** Deep-merge updates into the current state, returning a new MobilityState. */
function applyUpdates(state: MobilityState, updates: Record<string, unknown>): MobilityState {
  const updated: MobilityState = JSON.parse(JSON.stringify(state))

  for (const [key, value] of Object.entries(updates)) {
    if (key in updated) {
      // For UserFact fields, update the value while preserving status/provenance
      const current = (updated as any)[key]
      if (current && typeof current === 'object' && 'value' in current) {
        current.value = value
        current.status = 'confirmed_by_user'
        current.provenance = 'user_edit'
      } else {
        ;(updated as any)[key] = value
      }
    }
  }

  updated.capturedAt = new Date().toISOString()
  return updated
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const userId = (session.user as any).id
  if (!userId) return NextResponse.json({ error: 'No user id' }, { status: 400 })

  try {
    const body = (await req.json()) as ProfileUpdateBody
    if (!body?.updates || !body?.currentState) {
      return NextResponse.json({ error: 'updates and currentState are required' }, { status: 400 })
    }

    // Apply the updates to the current state
    const updatedState = applyUpdates(body.currentState, body.updates)

    // Find or create a Person for this user
    let person = await db.person.findFirst({ where: { userId } })
    if (!person) {
      person = await db.person.create({ data: { userId } })
    }

    // Count existing snapshots for version numbering
    const existingCount = await db.mobilityStateSnapshot.count({ where: { personId: person.id } })
    const newVersion = existingCount + 1

    // Create a new immutable MobilityStateSnapshot
    const snapshot = await db.mobilityStateSnapshot.create({
      data: {
        personId: person.id,
        version: newVersion,
        state: updatedState as any,
        source: 'USER_CONFIRMED',
      },
    })

    return NextResponse.json({
      snapshotId: snapshot.id,
      stateVersion: newVersion,
      updatedState,
      source: 'USER_CONFIRMED',
    })
  } catch (err) {
    console.error('[/api/profile]', err)
    return NextResponse.json({ error: 'Failed to update profile' }, { status: 500 })
  }
}

// GET — returns the user's latest mobility state snapshot
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const userId = (session.user as any).id
  if (!userId) return NextResponse.json({ state: null })

  try {
    const person = await db.person.findFirst({ where: { userId } })
    if (!person) return NextResponse.json({ state: null })

    const snapshot = await db.mobilityStateSnapshot.findFirst({
      where: { personId: person.id },
      orderBy: { version: 'desc' },
    })

    if (!snapshot) return NextResponse.json({ state: null })

    return NextResponse.json({
      state: snapshot.state,
      version: snapshot.version,
      source: snapshot.source,
      createdAt: snapshot.createdAt.toISOString(),
    })
  } catch {
    return NextResponse.json({ state: null })
  }
}
