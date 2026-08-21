// /api/actions
// GET  — list the user's actions
// POST — create/sync actions from a strategy

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { deriveActionPrediction } from '@/lib/strategy/prediction'
import { deriveOutcomeTypeFromAction, deriveOutcomeConfidence, deriveExpectedByDate } from '@/lib/strategy/outcome-intelligence'
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
// Body: { actionPlan: ActionPlan, strategyEngineVersion, runtimePolicyHash }
export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const userId = (session.user as any).id
  if (!userId) return NextResponse.json({ error: 'No user id' }, { status: 400 })

  try {
    const body = await req.json()
    const { actionPlan, strategyEngineVersion, runtimePolicyHash, decisionRecordId, strategy } = body as {
      actionPlan: ActionPlan
      strategyEngineVersion?: string
      runtimePolicyHash?: string
      decisionRecordId?: string
      strategy?: Strategy
    }

    if (!actionPlan?.actions) {
      return NextResponse.json({ error: 'actionPlan is required' }, { status: 400 })
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
        // This is the IMMUTABLE prediction frozen at action-creation time.
        // It records what Wayfinder expected this action to achieve, so
        // later observations can be compared against it.
        if (decisionRecordId) {
          try {
            const prediction = deriveActionPrediction(strategy ?? null, action.id, decisionRecordId)
            const outcomeType = deriveOutcomeTypeFromAction(action)
            const confidence = strategy ? deriveOutcomeConfidence(strategy) : null
            const expectedByDate = deriveExpectedByDate(action, new Date())

            await db.actionOutcome.create({
              data: {
                userId,
                userActionId: created.id,
                decisionRecordId: prediction.decisionRecordId,
                outcomeType,
                expectedByDate: expectedByDate,
                confidence: confidence,
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
