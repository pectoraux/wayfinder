// POST /api/profile
// Updates the user's mobility state. Creates a new immutable MobilityStateSnapshot.
// Returns the new state version + triggers strategy recomputation for ALL
// active objectives.
//
// CRITICAL INTEGRITY RULES (N0.3 hardened):
//   1. SERVER AUTHORITY: the base state is the server's LATEST committed
//      MobilityStateSnapshot, NOT the client-supplied `currentState`.
//   2. VALIDATION: updates are validated against the actual domain structure.
//      Unknown fields are REJECTED.
//   3. VERSION UNIQUENESS: `MAX(version)+1` inside a transaction, backed by
//      `@@unique([personId, version])`. P2002 → 409.
//   4. IMMUTABILITY: snapshots are never mutated.
//   5. MULTI-OBJECTIVE RECOMPUTATION: ALL active objective strategies are
//      recomputed, not just one. Each objective is evaluated independently.
//   6. NO SILENT FAILURE: if strategy recomputation fails for any objective,
//      the API returns an explicit partial-failure status. The profile
//      snapshot is still saved (it's immutable), but the response tells the
//      client exactly which objectives succeeded and which failed.
//   7. NO HISTORY NOISE: if the recomputed strategy is identical to the
//      previous (deterministic comparison), no new DecisionRecord is created
//      for that objective — the existing record stays current.
//   8. ATOMIC PERSISTENCE: the snapshot + all new DecisionRecords are persisted
//      in ONE transaction. If any DB write fails, the whole thing rolls back.
//      Strategy COMPUTATION happens BEFORE the transaction (no DB lock held
//      during the slow build).
//
// Body: { updates: Partial<MobilityState>, currentState?: MobilityState }

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { validateProfileUpdates, applyValidatedUpdates } from '@/lib/domain/profile-validation'
import { buildCanonicalPlanningContext, STRATEGY_ENGINE_VERSION } from '@/lib/strategy/planning-context'
import { buildStrategy } from '@/lib/strategy'
import { compareStrategyReplay } from '@/lib/strategy/replay'
import type { MobilityState, Intent } from '@/lib/domain/types'
import type { Strategy } from '@/lib/strategy/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface ProfileUpdateBody {
  updates: Record<string, unknown>
  currentState?: MobilityState
}

/** Per-objective recomputation result. */
interface ObjectiveRecomputationResult {
  objectiveId: string
  status: 'updated' | 'unchanged' | 'failed'
  /** The new record id (if status=updated). */
  recordId?: string
  /** The previous record id. */
  previousRecordId?: string
  /** The new best trajectory label (if status=updated). */
  bestTrajectoryLabel?: string | null
  /** The previous best trajectory label. */
  previousBestTrajectoryLabel?: string | null
  /** Error message (if status=failed). */
  error?: string
}

/** The full strategy impact returned to the client. */
interface StrategyImpact {
  /** Total number of active objectives evaluated. */
  totalObjectives: number
  /** Number of objectives whose strategy was updated. */
  updatedObjectives: number
  /** Number of objectives whose strategy was unchanged (no new record). */
  unchangedObjectives: number
  /** Number of objectives whose recomputation failed. */
  failedObjectives: number
  /** Per-objective results. */
  results: ObjectiveRecomputationResult[]
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
    const validation = validateProfileUpdates(body.updates)
    if (!validation.valid) {
      return NextResponse.json(
        { error: 'Invalid updates', errors: validation.errors },
        { status: 400 },
      )
    }

    // === PHASE 1: Load server-authoritative state + compute new state ===
    // (outside any transaction — no DB lock held)
    let person = await db.person.findFirst({ where: { userId } })
    if (!person) {
      person = await db.person.create({ data: { userId } })
    }

    const latest = await db.mobilityStateSnapshot.findFirst({
      where: { personId: person.id },
      orderBy: { version: 'desc' },
    })

    let baseState: MobilityState
    let newVersion: number
    if (latest) {
      baseState = latest.state as unknown as MobilityState
      newVersion = latest.version + 1
    } else if (body.currentState) {
      baseState = body.currentState
      newVersion = 1
    } else {
      return NextResponse.json(
        { error: 'No existing profile found and no base state provided.' },
        { status: 400 },
      )
    }

    const updatedState = applyValidatedUpdates(baseState, validation.validatedUpdates)

    // === PHASE 2: Compute strategies for ALL active objectives ===
    // (outside any transaction — strategy computation can be slow)
    // Find ALL active objectives — a user can have multiple (residence, income, etc.)
    const activeRecords = await db.decisionRecord.findMany({
      where: { userId, planStatus: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
    })

    // Deduplicate by objectiveId — we only need one record per objective
    const activeByObjective = new Map<string, typeof activeRecords[0]>()
    for (const record of activeRecords) {
      const objId = record.objectiveId ?? 'default'
      if (!activeByObjective.has(objId)) {
        activeByObjective.set(objId, record)
      }
    }

    // === PHASE 2: Compute strategies for ALL active objectives ===
    // (outside any transaction — strategy computation can be slow)
    //
    // CRITICAL INVARIANT (N0.3b): each objective is recomputed using its OWN
    // historical IntentRecord — NOT the person-wide latest. This preserves
    // objective isolation. If residence was adopted with intent v4 and
    // entrepreneurship with intent v2, a profile change recomputes residence
    // with v4 and entrepreneurship with v2 — never silently substituting v4
    // for both.
    //
    // For each active DecisionRecord:
    //   1. Resolve its persisted intentRecordId
    //   2. Load that exact IntentRecord
    //   3. Recompute using updatedState + that objective's intent
    //   4. If intentRecordId is missing or the record doesn't exist → FAILED

    const recomputationResults: ObjectiveRecomputationResult[] = []
    const recordsToCreate: Array<{
      objectiveId: string
      previousRecordId: string
      newStrategy: Strategy
      ctx: Awaited<ReturnType<typeof buildCanonicalPlanningContext>>
      intentRecordId: string
      intentVersion: number
    }> = []

    for (const [objectiveId, previousRecord] of activeByObjective) {
      try {
        // 1. Resolve this objective's persisted intentRecordId
        const intentRecordId = previousRecord.intentRecordId
        if (!intentRecordId) {
          recomputationResults.push({
            objectiveId,
            status: 'failed',
            previousRecordId: previousRecord.id,
            error: 'No intentRecordId on the previous record — cannot reconstruct the intent lineage for this objective.',
          })
          continue
        }

        // 2. Load that EXACT IntentRecord (not the person-wide latest)
        const objectiveIntentRecord = await db.intentRecord.findUnique({
          where: { id: intentRecordId },
        })
        if (!objectiveIntentRecord) {
          recomputationResults.push({
            objectiveId,
            status: 'failed',
            previousRecordId: previousRecord.id,
            error: `IntentRecord ${intentRecordId} (referenced by this objective) has been deleted. Cannot recompute without the original intent.`,
          })
          continue
        }

        // 3. Recompute using the NEW profile state + THIS objective's intent
        const intent = objectiveIntentRecord.intent as unknown as Intent
        const ctx = await buildCanonicalPlanningContext({
          state: updatedState,
          intent,
          asOfDate: new Date().toISOString(),
        })
        const newStrategy = await buildStrategy(updatedState, intent, ctx.routes, ctx)

        // 4. Compare against the previous strategy to detect if anything changed
        const previousStrategy = previousRecord.strategySnapshot as unknown as Strategy | null
        let isUnchanged = false
        if (previousStrategy) {
          const comparison = compareStrategyReplay(previousStrategy, newStrategy)
          if (comparison.exact) {
            isUnchanged = true
          }
        }

        if (isUnchanged) {
          recomputationResults.push({
            objectiveId,
            status: 'unchanged',
            previousRecordId: previousRecord.id,
            previousBestTrajectoryLabel: previousStrategy?.bestTrajectory?.label ?? null,
            bestTrajectoryLabel: newStrategy.bestTrajectory?.label ?? null,
          })
        } else {
          recordsToCreate.push({
            objectiveId,
            previousRecordId: previousRecord.id,
            newStrategy,
            ctx,
            intentRecordId: objectiveIntentRecord.id,
            intentVersion: objectiveIntentRecord.version,
          })
        }
      } catch (err) {
        recomputationResults.push({
          objectiveId,
          status: 'failed',
          previousRecordId: previousRecord.id,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }

    // === PHASE 3: Atomically persist snapshot + all new DecisionRecords ===
    // (one transaction — if any DB write fails, the whole thing rolls back)
    const txResult = await db.$transaction(async (tx) => {
      // 1. Create the immutable MobilityStateSnapshot
      const snapshot = await tx.mobilityStateSnapshot.create({
        data: {
          personId: person!.id,
          version: newVersion,
          state: updatedState as any,
          source: 'USER_CONFIRMED',
        },
      })

      // 2. For each objective that needs a new record: supersede old + create new
      const createdRecords: Array<{ objectiveId: string; recordId: string }> = []
      for (const { objectiveId, previousRecordId, newStrategy, ctx, intentRecordId, intentVersion } of recordsToCreate) {
        // Supersede the previous ACTIVE for this objective
        await tx.decisionRecord.updateMany({
          where: { userId, planStatus: 'ACTIVE', objectiveId },
          data: { planStatus: 'SUPERSEDED', uniqueActiveObjectiveKey: null },
        })

        // Create the new ACTIVE record — provenance uses THIS objective's
        // intentRecordId + intentVersion, NOT the person-wide latest.
        const newRecord = await tx.decisionRecord.create({
          data: {
            personId: person!.id,
            userId,
            stateVersion: newVersion,
            mobilityStateSnapshotId: snapshot.id,
            intentVersion,
            intentRecordId,
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
              mobilityStateVersion: newVersion,
              mobilityStateSnapshotId: snapshot.id,
              intentVersion,
              intentRecordId,
              objectiveId,
              objectiveVersion: 1,
            } as any,
            uniqueActiveObjectiveKey: `${userId}:${objectiveId}`,
            previousRecordId,
            changeReason: 'USER_PROFILE_CHANGED',
          },
        })

        createdRecords.push({ objectiveId, recordId: newRecord.id })
      }

      return { snapshot, createdRecords }
    })

    // === PHASE 4: Build the response with explicit per-objective status ===
    const results: ObjectiveRecomputationResult[] = []
    const recordMap = new Map(txResult.createdRecords.map((r) => [r.objectiveId, r.recordId]))

    for (const { objectiveId, previousRecordId, newStrategy, ctx } of recordsToCreate) {
      results.push({
        objectiveId,
        status: 'updated',
        recordId: recordMap.get(objectiveId),
        previousRecordId,
        bestTrajectoryLabel: newStrategy.bestTrajectory?.label ?? null,
        previousBestTrajectoryLabel: (activeByObjective.get(objectiveId)?.strategySnapshot as any)?.bestTrajectory?.label ?? null,
      })
    }
    results.push(...recomputationResults.filter((r) => r.status !== 'updated'))

    const strategyImpact: StrategyImpact = {
      totalObjectives: activeByObjective.size,
      updatedObjectives: results.filter((r) => r.status === 'updated').length,
      unchangedObjectives: results.filter((r) => r.status === 'unchanged').length,
      failedObjectives: results.filter((r) => r.status === 'failed').length,
      results,
    }

    // Determine the HTTP status:
    // - 200 if all objectives succeeded (updated or unchanged)
    // - 207 (Multi-Status) if some objectives failed but the profile was saved
    // - The profile snapshot is ALWAYS saved (it's immutable) — we never roll
    //   back the snapshot due to a strategy failure.
    const hasFailures = strategyImpact.failedObjectives > 0
    const httpStatus = hasFailures ? 207 : 200

    return NextResponse.json({
      snapshotId: txResult.snapshot.id,
      stateVersion: newVersion,
      updatedState,
      source: 'USER_CONFIRMED',
      strategyImpact,
    }, { status: httpStatus })
  } catch (err: any) {
    if (err?.code === 'P2002') {
      return NextResponse.json(
        { error: 'A concurrent profile update is in progress. Please retry.' },
        { status: 409 },
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
