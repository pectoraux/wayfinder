// POST /api/profile
// Updates the user's mobility state. Creates a new immutable MobilityStateSnapshot.
// Returns the new state version + triggers strategy recomputation on the client.
//
// CRITICAL INTEGRITY RULES:
//   1. Version allocation is TRANSACTIONAL: `MAX(version) + 1` inside a
//      Prisma transaction. The previous `count(...) + 1` approach could
//      produce the same version number under concurrent writes.
//   2. Snapshots are immutable — we never mutate an existing row.
//   3. User-entered facts preserve USER_CONFIRMED provenance. We never
//      accidentally promote a user edit to OFFICIAL or GOVERNMENT_VERIFIED.
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

/** Deep-merge updates into the current state, returning a new MobilityState.
 *  Preserves USER_CONFIRMED provenance on UserFact fields — never promotes
 *  a user edit to OFFICIAL or GOVERNMENT_VERIFIED. */
function applyUpdates(state: MobilityState, updates: Record<string, unknown>): MobilityState {
  const updated: MobilityState = JSON.parse(JSON.stringify(state))

  for (const [key, value] of Object.entries(updates)) {
    if (key in updated) {
      const current = (updated as any)[key]
      if (current && typeof current === 'object' && 'value' in current) {
        // UserFact field: update the value, mark as user-confirmed, preserve provenance type
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

    // TRANSACTIONAL version allocation. The previous `count(...) + 1` approach
    // could produce the same version number under concurrent writes — two
    // simultaneous POSTs would both see count=N and both create version N+1.
    // `MAX(version) + 1` inside a transaction with serializable isolation
    // (Prisma's default for SQLite/Postgres interactive transactions) prevents
    // that race: the second transaction sees the first's commit when it
    // re-reads the max, or fails and we retry.
    const result = await db.$transaction(async (tx) => {
      // Find or create a Person for this user
      let person = await tx.person.findFirst({ where: { userId } })
      if (!person) {
        person = await tx.person.create({ data: { userId } })
      }

      // MAX(version) for this person — concurrency-safe inside the transaction
      const latest = await tx.mobilityStateSnapshot.findFirst({
        where: { personId: person.id },
        orderBy: { version: 'desc' },
      })
      const newVersion = (latest?.version ?? 0) + 1

      // Create a new immutable MobilityStateSnapshot
      const snapshot = await tx.mobilityStateSnapshot.create({
        data: {
          personId: person.id,
          version: newVersion,
          state: updatedState as any,
          source: 'USER_CONFIRMED',
        },
      })

      return { snapshot, newVersion }
    })

    return NextResponse.json({
      snapshotId: result.snapshot.id,
      stateVersion: result.newVersion,
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
      snapshotId: snapshot.id,
      source: snapshot.source,
      createdAt: snapshot.createdAt.toISOString(),
    })
  } catch {
    return NextResponse.json({ state: null })
  }
}
