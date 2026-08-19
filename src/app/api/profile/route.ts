// POST /api/profile
// Updates the user's mobility state. Creates a new immutable MobilityStateSnapshot.
// Returns the new state version + triggers strategy recomputation on the client.
//
// CRITICAL INTEGRITY RULES (N0.3):
//   1. SERVER AUTHORITY: the base state is the server's LATEST committed
//      MobilityStateSnapshot, NOT the client-supplied `currentState`. The
//      client's `currentState` is only used as a fallback when the server has
//      no snapshot yet (first-ever profile).
//   2. VALIDATION: updates are validated against the actual domain structure
//      (validateProfileUpdates). Unknown fields are REJECTED.
//   3. VERSION UNIQUENESS: version allocation is `MAX(version)+1` inside a
//      transaction, backed by a DB-level `@@unique([personId, version])`
//      constraint. P2002 → 409.
//   4. IMMUTABILITY: snapshots are never mutated — each update creates a new row.
//   5. PROVENANCE: user-entered facts preserve USER_CONFIRMED provenance.
//   6. STRATEGY RECOMPUTATION: after a profile update, the canonical strategy
//      is recomputed (via buildCanonicalPlanningContext + buildStrategy) and
//      persisted as a new DecisionRecord with changeReason=USER_PROFILE_CHANGED.
//      This is NOT a second strategy engine — it reuses the canonical path.
//
// Body: { updates: Partial<MobilityState>, currentState?: MobilityState }
// The server loads its authoritative latest snapshot, merges the updates into
// that, and persists the result as a new version.

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { validateProfileUpdates, applyValidatedUpdates } from '@/lib/domain/profile-validation'
import { buildCanonicalPlanningContext, STRATEGY_ENGINE_VERSION } from '@/lib/strategy/planning-context'
import { buildStrategy } from '@/lib/strategy'
import type { MobilityState, Intent } from '@/lib/domain/types'

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

    // VALIDATE the updates against the actual domain structure.
    // Unknown fields are REJECTED here — the client cannot inject arbitrary keys.
    const validation = validateProfileUpdates(body.updates)
    if (!validation.valid) {
      return NextResponse.json(
        { error: 'Invalid updates', errors: validation.errors },
        { status: 400 },
      )
    }

    // SERVER-AUTHORITATIVE + TRANSACTIONAL update.
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

      // Apply the VALIDATED updates to the authoritative base state.
      const updatedState = applyValidatedUpdates(baseState, validation.validatedUpdates)

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

      return { snapshot, newVersion, updatedState, personId: person.id }
    })

    // After the profile snapshot is persisted, recompute the canonical strategy
    // and persist it as a new DecisionRecord (if the user has an adopted
    // strategy). This uses the CANONICAL planning path — no second engine.
    // We do this OUTSIDE the snapshot transaction to avoid holding the lock
    // during the (potentially slow) strategy build.
    let strategyImpact: {
      recomputed: boolean
      changeReason: string | null
      recordId: string | null
      bestTrajectoryLabel: string | null
      previousBestTrajectoryLabel: string | null
    } = {
      recomputed: false,
      changeReason: null,
      recordId: null,
      bestTrajectoryLabel: null,
      previousBestTrajectoryLabel: null,
    }

    try {
      // Load the user's latest intent
      const intentRecord = await db.intentRecord.findFirst({
        where: { personId: result.personId },
        orderBy: { version: 'desc' },
      })
      if (intentRecord) {
        const intent = intentRecord.intent as unknown as Intent

        // Find the user's previous ACTIVE strategy (any objective) to link
        const previousActive = await db.decisionRecord.findFirst({
          where: { userId, planStatus: 'ACTIVE' },
          orderBy: { createdAt: 'desc' },
        })

        // Build the canonical planning context (same path as /api/strategy)
        const ctx = await buildCanonicalPlanningContext({
          state: result.updatedState,
          intent,
          asOfDate: new Date().toISOString(),
        })
        const newStrategy = buildStrategy(result.updatedState, intent, ctx.routes, ctx)

        // If there's a previous ACTIVE for the SAME objective, supersede it
        // and create a new ACTIVE with changeReason=USER_PROFILE_CHANGED.
        if (previousActive) {
          const objectiveId = previousActive.objectiveId ?? 'default'

          // Supersede the previous ACTIVE for this objective
          await db.decisionRecord.updateMany({
            where: { userId, planStatus: 'ACTIVE', objectiveId },
            data: { planStatus: 'SUPERSEDED', uniqueActiveObjectiveKey: null },
          })

          // Create the new ACTIVE record
          const newRecord = await db.decisionRecord.create({
            data: {
              personId: result.personId,
              userId,
              stateVersion: result.newVersion,
              mobilityStateSnapshotId: result.snapshot.id,
              intentVersion: intentRecord.version,
              intentRecordId: intentRecord.id,
              policyVersion: ctx.policyContext.baseSnapshotId,
              policyHash: ctx.policyContext.runtimeHash,
              runtimePolicyVersion: ctx.policyContext.runtimeVersionId,
              runtimePolicyHash: ctx.policyContext.runtimeHash,
              asOfDate: new Date(ctx.policyContext.asOf),
              plan: newStrategy as any,
              trigger: 'edit',
              planStatus: 'ACTIVE',
              strategyEngineVersion: STRATEGY_ENGINE_VERSION,
              objectiveId,
              objectiveVersion: 1,
              strategySnapshot: {
                ...newStrategy,
                mobilityStateVersion: result.newVersion,
                mobilityStateSnapshotId: result.snapshot.id,
                intentVersion: intentRecord.version,
                intentRecordId: intentRecord.id,
                objectiveId,
                objectiveVersion: 1,
              } as any,
              uniqueActiveObjectiveKey: `${userId}:${objectiveId}`,
              previousRecordId: previousActive.id,
              changeReason: 'USER_PROFILE_CHANGED',
            },
          })

          strategyImpact = {
            recomputed: true,
            changeReason: 'USER_PROFILE_CHANGED',
            recordId: newRecord.id,
            bestTrajectoryLabel: newStrategy.bestTrajectory?.label ?? null,
            previousBestTrajectoryLabel: (previousActive.strategySnapshot as any)?.bestTrajectory?.label ?? null,
          }
        }
      }
    } catch (strategyErr) {
      // Strategy recomputation failure should NOT fail the profile update —
      // the snapshot is already persisted. Log + continue.
      console.error('[/api/profile] strategy recomputation failed:', strategyErr)
    }

    return NextResponse.json({
      snapshotId: result.snapshot.id,
      stateVersion: result.newVersion,
      updatedState: result.updatedState,
      source: 'USER_CONFIRMED',
      strategyImpact,
    })
  } catch (err: any) {
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
