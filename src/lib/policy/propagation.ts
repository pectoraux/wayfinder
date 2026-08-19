// Wayfinder — Durable Policy Publication Propagation
//
// The idempotent, resumable job that runs AFTER a policy is published:
//   1. Find or create a PolicyPropagation record
//   2. Count total affected plans
//   3. Process a bounded batch using cursor-based pagination
//   4. For each plan: recompute → create new plan version → create alert
//   5. Persist the cursor (lastProcessedRecordId) after each record
//   6. If batch wasn't complete, return hasMore=true for the next invocation
//
// DURABILITY: the PolicyPropagation record persists across crashes, restarts,
// and timeouts. Resuming reads the cursor and continues from where it left off.
//
// IDEMPOTENCY: running 5 times produces the same final state as running once.
// Plan versions are checked via (previousRecordId + policyPublicationId) unique
// constraint. Alerts use idempotencyKey (userId|publicationId|planId|impactLevel).
//
// BATCH SIZE: configurable, defaults to 50 per invocation. The caller (HTTP
// route or cron) can call processPolicyPublication repeatedly until hasMore=false.

import type { PropagationResult, CandidateFact } from './types'
import { recomputePlanImpact, isMaterialImpact } from './impact'
import { severityForImpact } from './alerts'
import type { MobilityPlan } from '@/lib/domain/types'

const BATCH_SIZE = 50

/**
 * Process a policy publication: find affected plans, recompute, create alerts.
 * Idempotent and resumable — safe to run multiple times.
 *
 * @param publicationId  the published PolicyPublication to propagate
 * @param opts.batchSize max records to process per invocation (default 50)
 * @returns              PropagationResult with status + counts + hasMore
 */
export async function processPolicyPublication(
  publicationId: string,
  opts: {
    candidateFactId?: string
    adminEmail?: string
    batchSize?: number
  } = {},
): Promise<PropagationResult> {
  const { db } = await import('@/lib/db')
  const batchSize = opts.batchSize ?? BATCH_SIZE

  let recomputedPlans = 0
  let alertsCreated = 0
  let failures = 0
  let errorSummary: string | undefined
  let hasMore = false

  try {
    // 1. Load the publication
    const publication = await db.policyPublication.findUnique({ where: { id: publicationId } })
    if (!publication) {
      return {
        propagationId: 'none',
        publicationId,
        status: 'FAILED',
        totalAffectedPlans: 0,
        processedPlans: 0,
        recomputedPlans: 0,
        alertsCreated: 0,
        failures: 1,
        errorSummary: 'Publication not found',
        wasNoOp: false,
        hasMore: false,
      }
    }

    // Only process PUBLISHED publications
    if (publication.status !== 'PUBLISHED') {
      return {
        propagationId: 'none',
        publicationId,
        status: 'COMPLETE',
        totalAffectedPlans: 0,
        processedPlans: 0,
        recomputedPlans: 0,
        alertsCreated: 0,
        failures: 0,
        wasNoOp: true,
        hasMore: false,
      }
    }

    // 2. Find or create the PolicyPropagation record
    let propagation = await db.policyPropagation.findFirst({
      where: { publicationId },
      orderBy: { attempt: 'desc' },
    })

    if (!propagation) {
      // Count total affected plans (ACTIVE plans with a userId, not already recomputed for this publication)
      const totalAffected = await db.decisionRecord.count({
        where: {
          userId: { not: null },
          planStatus: 'ACTIVE',
          NOT: { policyPublicationId: publicationId },
        },
      })

      propagation = await db.policyPropagation.create({
        data: {
          publicationId,
          status: 'RUNNING',
          totalAffectedPlans: totalAffected,
        },
      })
    } else if (propagation.status === 'COMPLETE') {
      // Already complete — idempotent skip
      return {
        propagationId: propagation.id,
        publicationId,
        status: 'COMPLETE',
        totalAffectedPlans: propagation.totalAffectedPlans,
        processedPlans: propagation.processedPlans,
        recomputedPlans: propagation.recomputedPlans,
        alertsCreated: propagation.alertsCreated,
        failures: propagation.errorCount,
        wasNoOp: true,
        hasMore: false,
      }
    } else {
      // Resume: increment attempt, set RUNNING
      propagation = await db.policyPropagation.update({
        where: { id: propagation.id },
        data: {
          status: 'RUNNING',
          attempt: { increment: 1 },
        },
      })
    }

    // 3. Load the candidate fact (for alert content)
    let candidate: CandidateFact | null = null
    if (publication.candidateFactIds) {
      const ids = JSON.parse(publication.candidateFactIds) as string[]
      if (ids.length > 0) {
        const cf = await db.candidateFact.findUnique({ where: { id: ids[0] } })
        if (cf) {
          candidate = {
            id: cf.id,
            sourceSnapshotId: cf.sourceSnapshotId,
            jurisdictionId: cf.jurisdictionId,
            entityType: cf.entityType as any,
            entityId: cf.entityId ?? undefined,
            entityLabel: cf.entityLabel,
            changeKind: cf.changeKind as any,
            field: cf.field ?? undefined,
            oldValue: cf.oldValue ? JSON.parse(cf.oldValue) : undefined,
            newValue: cf.newValue ? JSON.parse(cf.newValue) : undefined,
            effectiveFrom: cf.effectiveFrom ?? undefined,
            effectiveTo: cf.effectiveTo ?? undefined,
            evidence: cf.evidence,
            sourceUrl: cf.sourceUrl,
            model: cf.model,
            promptVersion: cf.promptVersion,
            confidence: cf.confidence,
            extractionStatus: cf.extractionStatus as any,
            aiInterpretation: cf.aiInterpretation ?? undefined,
            createdAt: cf.createdAt.toISOString(),
          }
        }
      }
    }

    // 4. Cursor-based pagination: fetch a batch of affected records
    const cursor = propagation.lastProcessedRecordId
    const batch = await db.decisionRecord.findMany({
      where: {
        userId: { not: null },
        planStatus: 'ACTIVE',
        NOT: { policyPublicationId: publicationId },
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      orderBy: { id: 'asc' }, // deterministic ordering by id (cuid is sortable)
      take: batchSize + 1, // fetch one extra to check if there are more
    })

    hasMore = batch.length > batchSize
    const recordsToProcess = hasMore ? batch.slice(0, batchSize) : batch

    // 5. Process each record
    for (const record of recordsToProcess) {
      try {
        const oldPlan = record.plan as unknown as MobilityPlan
        const state = oldPlan.state
        const intent = oldPlan.intent

        if (!state || !intent) {
          failures++
          await updatePropagationCursor(db, propagation.id, record.id)
          continue
        }

        // Check if we already recomputed this plan for this publication (idempotent)
        const existing = await db.decisionRecord.findFirst({
          where: {
            previousRecordId: record.id,
            policyPublicationId: publicationId,
          },
        })
        if (existing) {
          // Already recomputed — skip but advance cursor
          await updatePropagationCursor(db, propagation.id, record.id)
          continue
        }

        // Recompute under the new runtime policy (simulationMode=false — production)
        const { newPlan, impact } = await recomputePlanImpact(oldPlan, state, intent)
        recomputedPlans++

        // Mark the OLD plan as SUPERSEDED
        await db.decisionRecord.update({
          where: { id: record.id },
          data: { planStatus: 'SUPERSEDED' },
        })

        // Save the new plan version (ACTIVE, immutable)
        await db.decisionRecord.create({
          data: {
            personId: record.personId,
            stateVersion: record.stateVersion,
            intentVersion: record.intentVersion,
            policyVersion: newPlan.policyVersion,
            policyHash: newPlan.policyHash,
            runtimePolicyVersion: newPlan.runtimePolicyVersion ?? null,
            runtimePolicyHash: newPlan.runtimePolicyHash ?? null,
            asOfDate: new Date(newPlan.asOfDate),
            plan: newPlan as any,
            userId: record.userId,
            trigger: 'POLICY_CHANGE',
            policyPublicationId: publicationId,
            previousRecordId: record.id,
            planStatus: 'ACTIVE',
          },
        })

        // Create an alert if the impact is material
        if (isMaterialImpact(impact.level) && candidate) {
          const severity = severityForImpact(impact.level)
          const idempotencyKey = `${record.userId}|${publicationId}|${record.id}|${impact.level}`
          const title = buildAlertTitle(impact.level, candidate.entityLabel)

          await db.policyAlert.upsert({
            where: { idempotencyKey },
            create: {
              userId: record.userId!,
              decisionRecordId: record.id,
              policyPublicationId: publicationId,
              policyChangeId: candidate.id,
              impactLevel: impact.level,
              severity,
              title,
              whatChanged: impact.whatChanged,
              whyItMatters: impact.whyItMatters,
              recommendedAction: impact.recommendedAction,
              alternativeRoutes: JSON.stringify(impact.alternativesOpened),
              body: `${impact.whatChanged}\n\n${impact.whyItMatters}\n\n${impact.recommendedAction}`,
              idempotencyKey,
            },
            update: {},
          })
          alertsCreated++
        }

        // Advance the cursor after each successful record
        await updatePropagationCursor(db, propagation.id, record.id)
      } catch (e) {
        console.error('[propagation] failed for record', record.id, e)
        failures++
        // Advance cursor even on failure — don't get stuck on one record
        await updatePropagationCursor(db, propagation.id, record.id)
      }
    }

    // 6. Process watchlist alerts (users watching affected programs without plans)
    if (candidate) {
      await processWatchlistAlerts(publicationId, candidate, db)
    }

    // 7. Update propagation status
    const newProcessed = propagation.processedPlans + recordsToProcess.length
    const newRecomputed = propagation.recomputedPlans + recomputedPlans
    const newAlerts = propagation.alertsCreated + alertsCreated
    const newErrors = propagation.errorCount + failures

    const finalStatus = !hasMore
      ? (failures > 0 ? 'PARTIAL' : 'COMPLETE')
      : 'RUNNING'

    const updated = await db.policyPropagation.update({
      where: { id: propagation.id },
      data: {
        status: finalStatus,
        processedPlans: newProcessed,
        recomputedPlans: newRecomputed,
        alertsCreated: newAlerts,
        errorCount: newErrors,
        errorSummary: failures > 0 ? `${failures} plan(s) failed processing` : null,
        completedAt: !hasMore ? new Date() : null,
      },
    })

    return {
      propagationId: propagation.id,
      publicationId,
      status: finalStatus as PropagationResult['status'],
      totalAffectedPlans: propagation.totalAffectedPlans,
      processedPlans: newProcessed,
      recomputedPlans: newRecomputed,
      alertsCreated: newAlerts,
      failures: newErrors,
      errorSummary: failures > 0 ? `${failures} plan(s) failed` : undefined,
      wasNoOp: false,
      hasMore,
    }
  } catch (e) {
    errorSummary = (e as Error).message
    return {
      propagationId: 'error',
      publicationId,
      status: 'FAILED',
      totalAffectedPlans: 0,
      processedPlans: 0,
      recomputedPlans,
      alertsCreated,
      failures: failures + 1,
      errorSummary,
      wasNoOp: false,
      hasMore: false,
    }
  }
}

/** Update the cursor after processing a record. */
async function updatePropagationCursor(db: any, propagationId: string, recordId: string): Promise<void> {
  await db.policyPropagation.update({
    where: { id: propagationId },
    data: {
      lastProcessedRecordId: recordId,
      lastProcessedAt: new Date(),
    },
  })
}

/** Generate watchlist alerts for users watching the affected program/country. */
async function processWatchlistAlerts(
  publicationId: string,
  candidate: CandidateFact,
  db: any,
): Promise<void> {
  const watchType = candidate.entityType === 'program' ? 'program' : 'country'
  const watchId = candidate.entityId ?? candidate.jurisdictionId

  const watchers = await db.policyWatchlist.findMany({
    where: {
      OR: [
        { watchType: 'country', watchId: candidate.jurisdictionId },
        { watchType: 'program', watchId: watchId },
      ],
    },
  })

  for (const w of watchers) {
    const idempotencyKey = `${w.userId}|${publicationId}|watchlist|${watchType}`
    await db.policyAlert.upsert({
      where: { idempotencyKey },
      create: {
        userId: w.userId,
        policyPublicationId: publicationId,
        policyChangeId: candidate.id,
        impactLevel: 'MINOR_CHANGE',
        severity: 'NOTICE',
        title: `Policy change: ${candidate.entityLabel}`,
        whatChanged: candidate.aiInterpretation ?? `A policy change was detected for ${candidate.entityLabel}.`,
        whyItMatters: `You are watching ${w.watchLabel}, which was affected by a verified policy change.`,
        recommendedAction: 'Review the updated policy details.',
        body: `A verified policy change affects ${candidate.entityLabel}, which you are watching.`,
        idempotencyKey,
      },
      update: {},
    })
  }
}

function buildAlertTitle(level: string, entityLabel: string): string {
  switch (level) {
    case 'ROUTE_INVALIDATED': return `Your ${entityLabel} route changed`
    case 'ROUTE_DEGRADED': return `Your ${entityLabel} route requirements tightened`
    case 'NEW_BETTER_ROUTE': return `A better route emerged after a policy update`
    default: return `Policy update: ${entityLabel}`
  }
}
