// POST /api/strategy/adopt
// Persists a strategy adoption. Saves the strategy + plan as a DecisionRecord
// with trigger=OBJECTIVE_ADOPT, marks previous ACTIVE plans for the same
// user+objective as SUPERSEDED, and stores the FULL canonical provenance:
//   - mobilityStateSnapshotId + mobilityStateVersion (from a real snapshot)
//   - intentRecordId + intentVersion (from a real IntentRecord)
//   - runtimePolicyVersion + runtimePolicyHash (from the strategy's policyContext)
//   - strategyEngineVersion
//   - objectiveId + objectiveVersion
//
// CRITICAL INTEGRITY RULES:
//   1. Adoption is TRANSACTIONAL. If the create fails, the supersede is rolled
//      back — the user is never left with zero active plans.
//   2. The state version comes from the user's LATEST MobilityStateSnapshot,
//      NOT from `DecisionRecord.count(...)`. If no snapshot exists, one is
//      created (version 1) inside the same transaction.
//   3. The intent version comes from the user's LATEST IntentRecord. If none
//      exists, one is created (version 1) inside the same transaction.
//      We never hardcode `intentVersion = 1`.
//   4. DB-level uniqueness is enforced via the `uniqueActiveObjectiveKey`
//      sentinel column (`${userId}:${objectiveId}` when ACTIVE, NULL otherwise).
//      Concurrent adoptions for the same user+objective will fail one of the
//      two transactions at the unique constraint, never producing two ACTIVEs.
//
// GET — returns the user's active strategy (from the most recent ACTIVE
// DecisionRecord that has a strategySnapshot) WITH the full structured
// staleness assessment + provenance. Used for page reload.
//
// Body (POST): { strategy, plan?, objectiveId, state, intent }
// Returns: { recordId, activePlanId, objectiveId, provenance }

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { Prisma } from '@prisma/client'
import { STRATEGY_ENGINE_VERSION } from '@/lib/strategy/planning-context'
import { resolveRuntimePolicy } from '@/lib/policy/runtime-resolver'
import { getFullStrategyStaleness } from '@/lib/strategy/staleness'
import { createExpectedOutcomes } from '@/lib/strategy/outcome-intelligence'
import type { Strategy, StrategyProvenance } from '@/lib/strategy/types'
import type { MobilityState, Intent, MobilityPlan } from '@/lib/domain/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface AdoptBody {
  strategy: Strategy
  plan?: MobilityPlan
  objectiveId: string
  state: MobilityState
  intent: Intent
}

// ---------------------------------------------------------------------------
// GET — the user's active strategy + structured staleness + full provenance
// ---------------------------------------------------------------------------

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const userId = (session.user as any).id
  if (!userId) return NextResponse.json({ strategy: null, objectiveId: null })

  try {
    // Find the most recent ACTIVE DecisionRecord with a strategySnapshot
    const record = await db.decisionRecord.findFirst({
      where: { userId, planStatus: 'ACTIVE', strategySnapshot: { not: Prisma.DbNull } },
      orderBy: { createdAt: 'desc' },
    })

    if (!record || !record.strategySnapshot) {
      return NextResponse.json({ strategy: null, objectiveId: null })
    }

    const strategy = record.strategySnapshot as unknown as Strategy

    // Resolve the CURRENT state + intent versions from their canonical stores.
    // These are what we compare the strategy's stored versions against.
    const currentStateSnapshot = await db.mobilityStateSnapshot.findFirst({
      where: { personId: record.personId },
      orderBy: { version: 'desc' },
    })
    const currentIntentRecord = await db.intentRecord.findFirst({
      where: { personId: record.personId },
      orderBy: { version: 'desc' },
    })

    const currentStateVersion = currentStateSnapshot?.version ?? record.stateVersion
    const currentIntentVersion = currentIntentRecord?.version ?? record.intentVersion

    // Resolve the current runtime policy using the SAME resolver the strategy
    // engine uses (resolveRuntimePolicy, not getCurrentPolicySnapshot). This
    // ensures we compare the strategy's runtime hash against the current
    // runtime hash — not against the base snapshot hash, which would always
    // differ and produce a false STALE_POLICY.
    const currentRuntimePolicy = await resolveRuntimePolicy({
      asOf: new Date().toISOString(),
      simulationMode: false,
    })
    const currentPolicyHash = currentRuntimePolicy.runtimeHash
    const currentEngineVersion = STRATEGY_ENGINE_VERSION

    // Run the full 4-dimension staleness check.
    const staleness = getFullStrategyStaleness(
      strategy,
      currentPolicyHash,
      currentStateVersion,
      currentIntentVersion,
      currentEngineVersion,
    )

    // Reconstruct the canonical provenance from the record + strategy snapshot.
    const provenance: StrategyProvenance = {
      strategyEngineVersion: record.strategyEngineVersion ?? strategy.strategyEngineVersion ?? STRATEGY_ENGINE_VERSION,
      runtimePolicyVersion: record.runtimePolicyVersion ?? strategy.policyContext?.runtimeVersionId ?? '',
      runtimePolicyHash: record.runtimePolicyHash ?? strategy.policyContext?.runtimeHash ?? '',
      asOfDate: record.asOfDate?.toISOString() ?? strategy.policyContext?.asOf ?? '',
      mobilityStateSnapshotId: record.mobilityStateSnapshotId ?? strategy.mobilityStateSnapshotId ?? '',
      mobilityStateVersion: record.stateVersion ?? strategy.mobilityStateVersion ?? 0,
      intentRecordId: record.intentRecordId ?? strategy.intentRecordId ?? '',
      intentVersion: record.intentVersion ?? strategy.intentVersion ?? 0,
      objectiveId: record.objectiveId ?? strategy.objectiveId ?? '',
      objectiveVersion: record.objectiveVersion ?? strategy.objectiveVersion ?? 1,
      generatedAt: strategy.generatedAt ?? record.createdAt.toISOString(),
    }

    return NextResponse.json({
      strategy,
      objectiveId: record.objectiveId,
      recordId: record.id,
      createdAt: record.createdAt.toISOString(),
      // Structured staleness — never collapse to a single boolean.
      staleness,
      // Backward-compat: isStale is still derived from the structured assessment.
      isStale: staleness.shouldRecalculate,
      // Full provenance surface.
      provenance,
      // Current values the staleness check compared against.
      current: {
        policyHash: currentPolicyHash,
        stateVersion: currentStateVersion,
        intentVersion: currentIntentVersion,
        engineVersion: currentEngineVersion,
      },
    })
  } catch (err) {
    console.error('[/api/strategy/adopt GET]', err)
    return NextResponse.json({ strategy: null, objectiveId: null })
  }
}

// ---------------------------------------------------------------------------
// POST — adopt a strategy (transactional)
// ---------------------------------------------------------------------------

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const userId = (session.user as any).id
  if (!userId) return NextResponse.json({ error: 'No user id' }, { status: 400 })

  try {
    const body = (await req.json()) as AdoptBody
    if (!body?.strategy || !body?.objectiveId) {
      return NextResponse.json({ error: 'strategy and objectiveId are required' }, { status: 400 })
    }

    // Provenance fields from the strategy snapshot
    const policyContext = body.strategy.policyContext
    const strategyEngineVersion = body.strategy.strategyEngineVersion ?? STRATEGY_ENGINE_VERSION
    const asOfDate = policyContext?.asOf ?? new Date().toISOString()

    // The full adoption is transactional. If anything fails, NOTHING is left
    // in a half-adopted state — the user's previous ACTIVE plan stays ACTIVE.
    const result = await db.$transaction(async (tx) => {
      // 1. Find or create a Person for this user
      let person = await tx.person.findFirst({ where: { userId } })
      if (!person) {
        person = await tx.person.create({ data: { userId } })
      }

      // 2. Locate the user's LATEST MobilityStateSnapshot. If none exists,
      //    create one from the body's `state` (version 1). We NEVER derive
      //    stateVersion from DecisionRecord.count(...).
      let stateSnapshot = await tx.mobilityStateSnapshot.findFirst({
        where: { personId: person.id },
        orderBy: { version: 'desc' },
      })
      if (!stateSnapshot) {
        stateSnapshot = await tx.mobilityStateSnapshot.create({
          data: {
            personId: person.id,
            version: 1,
            state: body.state as any,
            source: 'USER_CONFIRMED',
          },
        })
      }
      const mobilityStateVersion = stateSnapshot.version
      const mobilityStateSnapshotId = stateSnapshot.id

      // 3. Locate the user's LATEST IntentRecord. If none exists, create one
      //    from the body's `intent` (version 1). We NEVER hardcode
      //    intentVersion = 1.
      let intentRecord = await tx.intentRecord.findFirst({
        where: { personId: person.id },
        orderBy: { version: 'desc' },
      })

      // Determine whether the intent actually changed (different priorities or
      // statedGoal). If so, persist a NEW IntentRecord version rather than
      // reusing the old one. This keeps intent history honest.
      const intentChanged = intentRecord
        ? JSON.stringify((intentRecord.intent as any)?.priorities) !== JSON.stringify(body.intent.priorities)
          || (intentRecord.intent as any)?.statedGoal !== body.intent.statedGoal
          || (intentRecord.intent as any)?.rawInput !== body.intent.rawInput
        : true

      if (!intentRecord || intentChanged) {
        const newVersion = (intentRecord?.version ?? 0) + 1
        intentRecord = await tx.intentRecord.create({
          data: {
            personId: person.id,
            version: newVersion,
            rawInput: body.intent.rawInput,
            intent: body.intent as any,
          },
        })
      }
      const intentVersion = intentRecord.version
      const intentRecordId = intentRecord.id

      // 4. Find the PREVIOUS ACTIVE record for this user + objective BEFORE
      //    superseding it, so we can link previousRecordId + classify the
      //    change cause deterministically (N0.2 Strategy Memory).
      const previousActiveForObjective = await tx.decisionRecord.findFirst({
        where: { userId, planStatus: 'ACTIVE', objectiveId: body.objectiveId },
        orderBy: { createdAt: 'desc' },
      })

      // Also find the user's most-recent ACTIVE across ALL objectives, so we
      // can detect OBJECTIVE_CHANGED (switching from one objective to another).
      // This does NOT supersede the other objective's ACTIVE — objective
      // isolation is preserved. It only informs the changeReason classification.
      const previousActiveAnyObjective = await tx.decisionRecord.findFirst({
        where: { userId, planStatus: 'ACTIVE' },
        orderBy: { createdAt: 'desc' },
      })

      // Determine the deterministic change cause by comparing provenance.
      // Priority: same-objective changes first, then cross-objective switch.
      // If the user has an ACTIVE for a DIFFERENT objective and is adopting
      // a new objective, that's OBJECTIVE_CHANGED (the user switched focus).
      let changeReason: string
      let previousRecordId: string | null = null
      if (previousActiveForObjective) {
        // Same-objective transition — compare provenance fields.
        previousRecordId = previousActiveForObjective.id
        if (previousActiveForObjective.stateVersion !== mobilityStateVersion) {
          changeReason = 'USER_PROFILE_CHANGED'
        } else if (previousActiveForObjective.intentVersion !== intentVersion) {
          changeReason = 'USER_INTENT_CHANGED'
        } else if (previousActiveForObjective.runtimePolicyHash !== (policyContext?.runtimeHash ?? null)) {
          changeReason = 'POLICY_CHANGED'
        } else if (previousActiveForObjective.strategyEngineVersion !== strategyEngineVersion) {
          changeReason = 'ENGINE_CHANGED'
        } else {
          changeReason = 'MANUAL_ADOPTION'
        }
      } else if (previousActiveAnyObjective && previousActiveAnyObjective.objectiveId !== body.objectiveId) {
        // No previous ACTIVE for THIS objective, but the user has an ACTIVE for
        // a DIFFERENT objective. This is an objective switch → OBJECTIVE_CHANGED.
        // We link to the cross-objective previous record so the history timeline
        // can show the transition, but we do NOT supersede the other objective's
        // ACTIVE (objective isolation is preserved).
        changeReason = 'OBJECTIVE_CHANGED'
        previousRecordId = previousActiveAnyObjective.id
      } else {
        // First-ever strategy for this user → MANUAL_ADOPTION.
        changeReason = 'MANUAL_ADOPTION'
        previousRecordId = null
      }

      // Mark previous ACTIVE plans for this user + objective as SUPERSEDED.
      // This clears their uniqueActiveObjectiveKey sentinel so the new
      // record can claim it via the unique constraint.
      await tx.decisionRecord.updateMany({
        where: { userId, planStatus: 'ACTIVE', objectiveId: body.objectiveId },
        data: {
          planStatus: 'SUPERSEDED',
          uniqueActiveObjectiveKey: null,
        },
      })

      // 5. Resolve the objective version. For now, objectives are immutable
      //    per (userId, objectiveId) — version 1. Future: per-objective
      //    version records would let us bump this when the objective's
      //    definition changes.
      const objectiveVersion = 1

      // 6. Create the new ACTIVE record with the FULL canonical provenance +
      //    the change memory (previousRecordId + changeReason).
      //    The uniqueActiveObjectiveKey sentinel enforces "at most one ACTIVE
      //    per user + objective" at the DB level. A concurrent adoption would
      //    fail here with a unique constraint violation, which we surface as
      //    a 409.
      const record = await tx.decisionRecord.create({
        data: {
          personId: person.id,
          // REAL state + intent versions (not count + 1, not hardcoded 1)
          stateVersion: mobilityStateVersion,
          mobilityStateSnapshotId,
          intentVersion,
          intentRecordId,
          // Policy provenance
          policyVersion: policyContext?.baseSnapshotId ?? 'snap-2024-11',
          policyHash: policyContext?.runtimeHash ?? 'unknown',
          runtimePolicyVersion: policyContext?.runtimeVersionId ?? null,
          runtimePolicyHash: policyContext?.runtimeHash ?? null,
          asOfDate: new Date(asOfDate),
          plan: (body.plan ?? body.strategy) as any,
          userId,
          trigger: 'OBJECTIVE_ADOPT',
          planStatus: 'ACTIVE',
          strategyEngineVersion,
          // Objective provenance
          objectiveId: body.objectiveId,
          objectiveVersion,
          // Strategy snapshot (full JSON)
          strategySnapshot: {
            ...body.strategy,
            // Persist the canonical provenance INSIDE the strategy snapshot too,
            // so the snapshot is self-describing even if the DecisionRecord
            // columns are ever lost.
            mobilityStateVersion,
            mobilityStateSnapshotId,
            intentVersion,
            intentRecordId,
            objectiveId: body.objectiveId,
            objectiveVersion,
          } as any,
          // DB-level uniqueness sentinel
          uniqueActiveObjectiveKey: `${userId}:${body.objectiveId}`,
          // N0.2 Strategy Memory: link to the previous record + persist the
          // deterministic change cause so the history timeline can explain
          // WHY this strategy changed.
          previousRecordId,
          changeReason,
        },
      })

      // N0.7: Auto-create expected outcomes (strategy-level only — action-level
      // outcomes are created when UserActions are synced via /api/actions).
      // These are IMMUTABLE predictions frozen at adoption time. They are
      // append-only — never overwritten.
      //
      // The strategy passed here is body.strategy — this is the strategy the
      // user is adopting RIGHT NOW. It is NOT a client-supplied historical
      // strategy; it is the strategy computed by the engine + persisted in the
      // DecisionRecord we just created. The record.createdAt is the immutable
      // adoption timestamp.
      let expectedOutcomeCount = 0
      try {
        // Reconstruct the historical graph from the strategy being adopted.
        // This is the SAME strategy we just persisted — it is authoritative.
        const expectedRecords = createExpectedOutcomes({
          strategy: body.strategy,
          decisionRecordId: record.id,
          objectiveId: body.objectiveId,
          userId,
          adoptionDate: record.createdAt,
          graph: body.strategy.decisionGraph,
        })

        // Only create the STRATEGY-level expected outcome here (action-level
        // outcomes need a userActionId, which doesn't exist yet).
        for (const rec of expectedRecords) {
          if (rec.scope === 'STRATEGY') {
            await tx.strategyOutcome.create({
              data: {
                userId: rec.userId,
                decisionRecordId: rec.decisionRecordId,
                objectiveId: rec.objectiveId,
                outcomeType: rec.outcomeType,
                graphNodeId: rec.graphNodeId ?? null,
                // N0.7: qualitative confidence, never a fabricated probability
                confidenceLevel: rec.confidenceLevel ?? null,
                evaluationStatus: 'UNKNOWN',
                // Predicted fields (immutable)
                predictedTrajectoryViable: rec.predictedTrajectoryViable ?? null,
                predictedTimelineMonths: rec.predictedTimelineMonths ?? null,
                predictedTotalCostUSD: rec.predictedTotalCostUSD ?? null,
                // Provenance — system-derived at adoption time
                provenance: 'SYSTEM_DERIVED',
                idempotencyKey: rec.idempotencyKey,
              },
            })
            expectedOutcomeCount++
          }
        }
      } catch (expectedErr) {
        // If expected outcome creation fails due to idempotency key conflict,
        // that's OK — it means the expected outcome already exists (e.g., a
        // retry). We don't fail the whole adoption for this.
        if ((expectedErr as any)?.code !== 'P2002') {
          throw expectedErr
        }
      }

      return { record, provenance: {
        strategyEngineVersion,
        runtimePolicyVersion: policyContext?.runtimeVersionId ?? '',
        runtimePolicyHash: policyContext?.runtimeHash ?? '',
        asOfDate,
        mobilityStateSnapshotId,
        mobilityStateVersion,
        intentRecordId,
        intentVersion,
        objectiveId: body.objectiveId,
        objectiveVersion,
        generatedAt: body.strategy.generatedAt,
      } as StrategyProvenance, expectedOutcomeCount }
    })

    return NextResponse.json({
      recordId: result.record.id,
      activePlanId: result.record.id,
      objectiveId: body.objectiveId,
      provenance: result.provenance,
      expectedOutcomeCount: result.expectedOutcomeCount,
    })
  } catch (err: any) {
    // Detect the unique constraint violation on uniqueActiveObjectiveKey.
    // Prisma exposes this as code P2002.
    if (err?.code === 'P2002') {
      return NextResponse.json(
        { error: 'A strategy for this objective is already being adopted. Please refresh and try again.' },
        { status: 409 },
      )
    }
    console.error('[/api/strategy/adopt]', err)
    return NextResponse.json({ error: 'Failed to adopt strategy' }, { status: 500 })
  }
}
