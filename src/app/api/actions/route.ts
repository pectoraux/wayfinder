// /api/actions
// GET  — list the user's actions
// POST — create/sync actions from a strategy's action plan
//
// N0.7 HARDENING (architectural invariant):
//   The client provides an action CREATION INTENT only — NEVER authoritative
//   historical strategy state. The canonical chain is:
//
//     Authenticated User
//         ↓
//     UserAction
//         ↓
//     DecisionRecord (resolved server-side by decisionRecordId)
//         ↓
//     Immutable historical strategy snapshot (from the record, NOT the body)
//         ↓
//     Historical DecisionGraph (from the snapshot)
//         ↓
//     Prediction (server-derived)
//         ↓
//     Expected ActionOutcome (immutable)
//
//   A forged strategy submitted by the client has ZERO effect on the expected
//   outcome. The `strategy` field is NOT accepted from the request body.

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { deriveActionPrediction } from '@/lib/strategy/prediction'
import {
  deriveOutcomeTypeFromGraph,
  deriveConfidenceLevel,
  deriveExpectedByDate,
  validateGraphNodeLinkage,
} from '@/lib/strategy/outcome-intelligence'
import { buildDecisionGraph } from '@/lib/strategy/decision-graph'
import type { ActionPlan, Strategy } from '@/lib/strategy/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const userId = (session.user as any).id
  if (!userId) return NextResponse.json({ actions: [] })

  const actions = await db.userAction.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: 50,
  })

  return NextResponse.json({ actions })
}

// POST — sync actions from a strategy's action plan
// Body: { actionPlan, strategyEngineVersion?, runtimePolicyHash?, decisionRecordId? }
//
// NOTE: The actionPlan field is the only client-provided strategy-derived
// content used — and it is used ONLY to know which actions to create
// (titles/descriptions for the UserAction rows). The PREDICTION data for
// expected outcomes is ALWAYS resolved server-side from the DecisionRecord's
// historical strategy snapshot.
export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const userId = (session.user as any).id
  if (!userId) return NextResponse.json({ error: 'No user id' }, { status: 400 })

  try {
    const body = await req.json()
    const { actionPlan, strategyEngineVersion, runtimePolicyHash, decisionRecordId } = body as {
      actionPlan: ActionPlan
      strategyEngineVersion?: string
      runtimePolicyHash?: string
      decisionRecordId?: string
    }

    if (!actionPlan?.actions) {
      return NextResponse.json({ error: 'actionPlan is required' }, { status: 400 })
    }

    // N0.7 HARDENING: Resolve the historical strategy + graph SERVER-SIDE.
    // The client CANNOT provide a strategy. We resolve it from the
    // DecisionRecord identified by decisionRecordId, verifying ownership.
    let historicalStrategy: Strategy | null = null
    let historicalGraph: ReturnType<typeof buildDecisionGraph> | null = null
    let historicalAdoptionDate: Date | null = null

    if (decisionRecordId) {
      // Verify the DecisionRecord belongs to this user
      const record = await db.decisionRecord.findFirst({
        where: { id: decisionRecordId, userId },
      })
      if (record?.strategySnapshot) {
        historicalStrategy = record.strategySnapshot as unknown as Strategy
        historicalAdoptionDate = record.createdAt
        // Reconstruct the historical DecisionGraph from the snapshot
        historicalGraph = buildDecisionGraph(historicalStrategy)
      }
    }

    // Upsert each action (create if doesn't exist, don't overwrite status if already exists)
    const results: Awaited<ReturnType<typeof db.userAction.findUnique>>[] = []
    for (const action of actionPlan.actions) {
      const existing = await db.userAction.findUnique({
        where: { userId_actionId: { userId, actionId: action.id } },
      })

      if (!existing) {
        const created = await db.userAction.create({
          data: {
            userId,
            actionId: action.id,
            title: action.title,
            description: action.description,
            status: 'NOT_STARTED',
            strategyEngineVersion: strategyEngineVersion ?? null,
            runtimePolicyHash: runtimePolicyHash ?? null,
            // N0.4b: link this action to the exact DecisionRecord that
            // generated its prediction. This is how the server derives
            // prediction provenance for outcome tracking.
            decisionRecordId: decisionRecordId ?? null,
          },
        })
        results.push(created)

        // N0.7: Auto-create an expected ActionOutcome for this action.
        // ALL prediction data is resolved SERVER-SIDE from the historical
        // strategy snapshot. The client cannot influence any predicted value.
        if (decisionRecordId && historicalStrategy) {
          try {
            const prediction = deriveActionPrediction(
              historicalStrategy,
              action.id,
              decisionRecordId,
            )

            // Outcome type derived from the GRAPH, not text. Falls back to
            // UNKNOWN when the graph does not provide a causal relationship.
            const outcomeType = historicalGraph
              ? deriveOutcomeTypeFromGraph(historicalGraph, action.id)
              : 'UNKNOWN'

            // Confidence is qualitative (HIGH/MEDIUM/LOW/UNKNOWN), never a
            // fabricated probability.
            const confidenceLevel = deriveConfidenceLevel(historicalStrategy)

            // Expected date derives from the IMMUTABLE historical adoption
            // timestamp, NOT new Date().
            const expectedByDate = historicalAdoptionDate
              ? deriveExpectedByDate(action, historicalAdoptionDate)
              : null

            // Validate graph node linkage: the action's graph node must exist
            // in the historical graph.
            const actionGraphNodeId = `action-${hashId(action.id)}`
            const graphLinkage = historicalGraph
              ? validateGraphNodeLinkage(historicalGraph, actionGraphNodeId, 'ACTION')
              : { valid: false, reason: 'NO_HISTORICAL_GRAPH' as const }

            await db.actionOutcome.create({
              data: {
                userId,
                userActionId: created.id,
                decisionRecordId: prediction.decisionRecordId,
                outcomeType,
                // graphNodeId is only set if the node actually exists in the
                // historical graph. Never fabricated.
                graphNodeId: graphLinkage.valid ? actionGraphNodeId : null,
                expectedByDate,
                confidenceLevel,
                evaluationStatus: 'UNKNOWN',
                // Predicted fields (immutable — from the historical strategy)
                predictedEffect: prediction.predictedEffect,
                predictedDurationMonths: prediction.predictedDurationMonths,
                predictedCostUSD: prediction.predictedCostUSD,
                predictedBlockerResolved: prediction.predictedBlockerResolved,
                // No actual fields yet — these are filled when reality is known
                // Provenance — system-derived at creation time
                status: 'UNKNOWN',
                provenance: 'SYSTEM_DERIVED',
                idempotencyKey: `${userId}:${decisionRecordId}:expected:action:${action.id}`,
              },
            })
          } catch (outcomeErr) {
            // If expected outcome creation fails due to idempotency key conflict,
            // that's OK — it means the expected outcome already exists.
            // We don't fail the action sync for this.
            if ((outcomeErr as any)?.code !== 'P2002') {
              throw outcomeErr
            }
          }
        }
      } else {
        // Update title/description but preserve status + decisionRecordId
        // if the existing action already has one (don't overwrite provenance)
        if (!existing.decisionRecordId && decisionRecordId) {
          const updated = await db.userAction.update({
            where: { id: existing.id },
            data: { decisionRecordId },
          })
          results.push(updated)
        } else {
          results.push(existing)
        }
      }
    }

    return NextResponse.json({ actions: results })
  } catch (err) {
    console.error('[/api/actions POST]', err)
    return NextResponse.json({ error: 'Failed to sync actions' }, { status: 500 })
  }
}

/** Deterministic hash (mirrors decision-graph.ts hashString). */
function hashId(id: string): string {
  let hash = 0
  for (let i = 0; i < id.length; i++) {
    const char = id.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash |= 0
  }
  return Math.abs(hash).toString(36)
}
