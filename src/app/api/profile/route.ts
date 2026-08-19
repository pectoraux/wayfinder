// POST /api/profile
// Updates the user's mobility state. Creates a new immutable MobilityStateSnapshot.
// Returns the new state version + triggers strategy recomputation on the client.
//
// CRITICAL INTEGRITY RULES:
//   1. SERVER AUTHORITY: the base state is the server's LATEST committed
//      MobilityStateSnapshot, NOT the client-supplied `currentState`. The
//      client's `currentState` is only used as a fallback when the server has
//      no snapshot yet (first-ever profile). This prevents a stale or
//      malicious client from overwriting the profile with an outdated base
//      or from clobbering a concurrent edit.
//   2. VERSION UNIQUENESS: version allocation is `MAX(version)+1` inside a
//      transaction, backed by a DB-level `@@unique([personId, version])`
//      constraint. Even if two concurrent transactions both read the same
//      max, only one can commit; the other gets a P2002 and must retry.
//   3. IMMUTABILITY: snapshots are never mutated — each update creates a new row.
//   4. PROVENANCE: user-entered facts preserve USER_CONFIRMED provenance. We
//      never accidentally promote a user edit to OFFICIAL or GOVERNMENT_VERIFIED.
//
// Body: { updates: Partial<MobilityState>, currentState?: MobilityState }
// The server loads its authoritative latest snapshot, merges the updates into
// that, and persists the result as a new version.

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import type { MobilityState } from '@/lib/domain/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface ProfileUpdateBody {
  updates: Record<string, unknown>
  /** Optional client-side current state. Used ONLY as a fallback when the
   *  server has no snapshot for this user yet (first-ever profile). For all
   *  subsequent updates, the server's latest committed snapshot is the
   *  authoritative base. */
  currentState?: MobilityState
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
    if (!body?.updates) {
      return NextResponse.json({ error: 'updates is required' }, { status: 400 })
    }

    // SERVER-AUTHORITATIVE + TRANSACTIONAL update.
    //
    // The base state is the server's LATEST committed MobilityStateSnapshot.
    // We do NOT trust the client's `currentState` except as a first-ever
    // fallback. This prevents a stale client from clobbering a newer server
    // state, and prevents a malicious client from rewriting history.
    //
    // Version allocation is `MAX(version)+1` inside the transaction, backed
    // by the DB-level `@@unique([personId, version])` constraint. If two
    // concurrent transactions both read the same max and both try to insert
    // the same version, one commits and the other gets a P2002 unique-
    // constraint violation — which we surface as a 409 so the client can
    // retry.
    const result = await db.$transaction(async (tx) => {
      // Find or create a Person for this user
      let person = await tx.person.findFirst({ where: { userId } })
      if (!person) {
        person = await tx.person.create({ data: { userId } })
      }

      // Load the SERVER-AUTHORITATIVE latest snapshot.
      const latest = await tx.mobilityStateSnapshot.findFirst({
        where: { personId: person.id },
        orderBy: { version: 'desc' },
      })

      // Determine the base state: server's latest, or the client fallback.
      // The client fallback is only used when the server has NO snapshot
      // (first-ever profile for this user).
      let baseState: MobilityState
      let newVersion: number
      if (latest) {
        baseState = latest.state as unknown as MobilityState
        newVersion = latest.version + 1
      } else if (body.currentState) {
        baseState = body.currentState
        newVersion = 1
      } else {
        // No server snapshot AND no client fallback — cannot proceed.
        throw new Error('NO_BASE_STATE')
      }

      // Apply the user's updates to the authoritative base state.
      const updatedState = applyUpdates(baseState, body.updates)

      // Create a new immutable MobilityStateSnapshot. The @@unique([personId, version])
      // constraint is the concurrency backstop.
      const snapshot = await tx.mobilityStateSnapshot.create({
        data: {
          personId: person.id,
          version: newVersion,
          state: updatedState as any,
          source: 'USER_CONFIRMED',
        },
      })

      return { snapshot, newVersion, updatedState }
    })

    return NextResponse.json({
      snapshotId: result.snapshot.id,
      stateVersion: result.newVersion,
      updatedState: result.updatedState,
      source: 'USER_CONFIRMED',
    })
  } catch (err: any) {
    // P2002 = unique constraint violation on (personId, version).
    // A concurrent update won the race; the client should retry.
    if (err?.code === 'P2002') {
      return NextResponse.json(
        { error: 'A concurrent profile update is in progress. Please retry.' },
        { status: 409 },
      )
    }
    if (err?.message === 'NO_BASE_STATE') {
      return NextResponse.json(
        { error: 'No existing profile found and no base state provided.' },
        { status: 400 },
      )
    }
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
