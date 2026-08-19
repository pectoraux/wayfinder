// Wayfinder — Policy Publication Propagation Job
//
// The idempotent job that runs AFTER a policy is published:
//   1. Find affected saved plans (DecisionRecords computed under the old policy)
//   2. Recompute each plan under the new runtime policy
//   3. Create a new plan version (DecisionRecord with trigger=POLICY_CHANGE)
//   4. Classify the impact (deterministic plan diff)
//   5. Create alerts for MATERIAL impacts (idempotent via idempotencyKey)
//   6. Update the PolicyPropagation record
//
// Idempotency: if the job runs twice, it does NOT create duplicate plan
// versions or alerts. The idempotencyKey on alerts prevents duplicates, and
// the plan version check (previousRecordId + policyPublicationId) prevents
// duplicate recomputations.
//
// This function is designed for migration to Temporal: it takes a
// publicationId, loads everything from the DB, and is resumable.

import type { PropagationResult, CandidateFact } from './types'
import { recomputePlanImpact, isMaterialImpact } from './impact'
import { severityForImpact } from './alerts'
import { buildPlanWithRuntimePolicy } from '@/lib/engine/optimize'
import type { MobilityPlan, MobilityState, Intent } from '@/lib/domain/types'

/**
 * Process a policy publication: find affected plans, recompute, create alerts.
 * Idempotent — safe to run multiple times.
 */
export async function processPolicyPublication(
  publicationId: string,
  opts: {
    candidateFactId?: string
    adminEmail?: string
  } = {},
): Promise<PropagationResult> {
  const { db } = await import('@/lib/db')

  let affectedPlans = 0
  let recomputedPlans = 0
  let alertsCreated = 0
  let failures = 0
  let errorSummary: string | undefined

  try {
    // 1. Load the publication
    const publication = await db.policyPublication.findUnique({ where: { id: publicationId } })
    if (!publication) {
      return {
        publicationId,
        status: 'FAILED',
        affectedPlans: 0,
        recomputedPlans: 0,
        alertsCreated: 0,
        failures: 1,
        errorSummary: 'Publication not found',
        wasNoOp: false,
      }
    }

    // Only process PUBLISHED publications
    if (publication.status !== 'PUBLISHED') {
      return {
        publicationId,
        status: 'COMPLETE',
        affectedPlans: 0,
        recomputedPlans: 0,
        alertsCreated: 0,
        failures: 0,
        wasNoOp: true, // not PUBLISHED — nothing to do
      }
    }

    // 2. Find the candidate fact (for the alert content)
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

    // 3. Find affected DecisionRecords (plans computed before this publication)
    // A plan is affected if it has a userId (owned by a real user) and was
    // computed under a policy version that predates this publication.
    const affectedRecords = await db.decisionRecord.findMany({
      where: {
        userId: { not: null },
        // Don't re-process plans that were already triggered by this publication
        NOT: { policyPublicationId: publicationId },
      },
      orderBy: { createdAt: 'desc' },
      take: 200, // cap per run for serverless safety
    })

    affectedPlans = affectedRecords.length

    // 4. For each affected plan, recompute + create alert
    for (const record of affectedRecords) {
      try {
        const oldPlan = record.plan as unknown as MobilityPlan
        const state = oldPlan.state
        const intent = oldPlan.intent

        if (!state || !intent) {
          failures++
          continue
        }

        // Check if we already recomputed this plan for this publication
        const existing = await db.decisionRecord.findFirst({
          where: {
            previousRecordId: record.id,
            policyPublicationId: publicationId,
          },
        })
        if (existing) {
          // Already recomputed — skip (idempotent)
          continue
        }

        // Recompute under the new runtime policy
        const { newPlan, impact } = await recomputePlanImpact(oldPlan, state, intent)
        recomputedPlans++

        // Save the new plan version (immutable — never overwrites the old one)
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
            update: {}, // no-op if it already exists
          })
          alertsCreated++
        }
      } catch (e) {
        console.error('[propagation] failed for record', record.id, e)
        failures++
      }
    }

    // 5. Process watchlist alerts (users watching affected programs without plans)
    if (candidate) {
      await processWatchlistAlerts(publicationId, candidate, db)
    }

    return {
      publicationId,
      status: 'COMPLETE',
      affectedPlans,
      recomputedPlans,
      alertsCreated,
      failures,
      errorSummary,
      wasNoOp: false,
    }
  } catch (e) {
    errorSummary = (e as Error).message
    return {
      publicationId,
      status: 'FAILED',
      affectedPlans,
      recomputedPlans,
      alertsCreated,
      failures: failures + 1,
      errorSummary,
      wasNoOp: false,
    }
  }
}

/** Generate watchlist alerts for users watching the affected program/country. */
async function processWatchlistAlerts(
  publicationId: string,
  candidate: CandidateFact,
  db: any,
): Promise<void> {
  // Find watchlist entries matching the candidate's jurisdiction or entity
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
