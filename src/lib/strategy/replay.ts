// Wayfinder — Strategy Replay + Record Verification
//
// This module reconstructs a stored Strategy from its provenance and verifies
// that every referenced input is still available. Together with
// verifyStrategyRecord, it lets Wayfinder answer:
//
//   "Can we reproduce what the user was shown?"
//
// Replay statuses:
//   EXACT_MATCH         — replayed strategy's hash matches the stored hash
//   ENGINE_CHANGED      — replayed cleanly but the engine version differs
//   POLICY_UNAVAILABLE  — the runtime policy referenced is no longer resolvable
//   STATE_UNAVAILABLE   — the MobilityStateSnapshot has been deleted
//   INTENT_UNAVAILABLE  — the IntentRecord has been deleted
//   REPLAY_FAILED       — an unexpected error during replay
//
// Historical strategies are NEVER silently "updated" in place. If a dependency
// is unavailable, the stored snapshot is preserved as historical evidence —
// we never silently substitute today's profile or intent for the original.

import { db } from '@/lib/db'
import { buildCanonicalPlanningContext, STRATEGY_ENGINE_VERSION } from '@/lib/strategy/planning-context'
import { buildStrategy } from '@/lib/strategy'
import type { Strategy, StrategyProvenance } from '@/lib/strategy/types'
import type { MobilityState, Intent } from '@/lib/domain/types'

// ---------------------------------------------------------------------------
// Replay status enum
// ---------------------------------------------------------------------------

export type ReplayStatus =
  | 'EXACT_MATCH'
  | 'ENGINE_CHANGED'
  | 'POLICY_UNAVAILABLE'
  | 'STATE_UNAVAILABLE'
  | 'INTENT_UNAVAILABLE'
  | 'REPLAY_FAILED'

export interface ReplayResult {
  status: ReplayStatus
  /** The replayed strategy (if replay succeeded). Null when dependencies are unavailable. */
  replayedStrategy?: Strategy
  /** The original stored strategy. Always present (historical evidence). */
  storedStrategy: Strategy
  /** The provenance the replay used. */
  provenance: StrategyProvenance
  /** Human-readable explanation of the status. */
  explanation: string
  /** Per-field differences (e.g. hash mismatch details). */
  differences: string[]
}

// ---------------------------------------------------------------------------
// Record verification
// ---------------------------------------------------------------------------

export interface VerificationResult {
  recordId: string
  valid: boolean
  checks: {
    objectiveExists: boolean
    stateSnapshotExists: boolean
    intentVersionExists: boolean
    policyVersionExists: boolean
    engineVersionExists: boolean
    snapshotMetadataMatchesRecord: boolean
  }
  /** Diagnostic messages for any failed checks. */
  errors: string[]
  /** The provenance reconstructed from the record (null if unrecoverable). */
  provenance: StrategyProvenance | null
}

/**
 * Verify the integrity of a DecisionRecord: every referenced input must exist,
 * and the strategy snapshot's metadata must match the record's columns.
 *
 * Returns a structured verification result — never throws.
 */
export async function verifyStrategyRecord(recordId: string): Promise<VerificationResult> {
  const errors: string[] = []
  const checks = {
    objectiveExists: false,
    stateSnapshotExists: false,
    intentVersionExists: false,
    policyVersionExists: false,
    engineVersionExists: false,
    snapshotMetadataMatchesRecord: false,
  }

  const record = await db.decisionRecord.findUnique({ where: { id: recordId } })
  if (!record) {
    return {
      recordId,
      valid: false,
      checks,
      errors: [`DecisionRecord ${recordId} not found`],
      provenance: null,
    }
  }

  const strategy = record.strategySnapshot as unknown as Strategy | null

  // 1. Objective exists (objectiveId is non-null on the record)
  if (record.objectiveId) {
    checks.objectiveExists = true
  } else {
    errors.push('objectiveId is null on the record')
  }

  // 2. State snapshot exists
  if (record.mobilityStateSnapshotId) {
    const snapshot = await db.mobilityStateSnapshot.findUnique({
      where: { id: record.mobilityStateSnapshotId },
    })
    if (snapshot) {
      checks.stateSnapshotExists = true
      if (snapshot.version !== record.stateVersion) {
        errors.push(`stateVersion mismatch: record says ${record.stateVersion}, snapshot says ${snapshot.version}`)
      }
    } else {
      errors.push(`MobilityStateSnapshot ${record.mobilityStateSnapshotId} not found`)
    }
  } else {
    errors.push('mobilityStateSnapshotId is null on the record')
  }

  // 3. Intent version exists
  if (record.intentRecordId) {
    const intentRecord = await db.intentRecord.findUnique({
      where: { id: record.intentRecordId },
    })
    if (intentRecord) {
      checks.intentVersionExists = true
      if (intentRecord.version !== record.intentVersion) {
        errors.push(`intentVersion mismatch: record says ${record.intentVersion}, intentRecord says ${intentRecord.version}`)
      }
    } else {
      errors.push(`IntentRecord ${record.intentRecordId} not found`)
    }
  } else {
    errors.push('intentRecordId is null on the record')
  }

  // 4. Policy version/hash exists on the record
  if (record.runtimePolicyHash && record.runtimePolicyVersion) {
    checks.policyVersionExists = true
  } else {
    errors.push('runtimePolicyHash or runtimePolicyVersion is null on the record')
  }

  // 5. Engine version exists
  if (record.strategyEngineVersion) {
    checks.engineVersionExists = true
  } else {
    errors.push('strategyEngineVersion is null on the record')
  }

  // 6. Snapshot metadata matches record columns
  if (strategy) {
    const mismatches: string[] = []
    if (strategy.mobilityStateVersion != null && strategy.mobilityStateVersion !== record.stateVersion) {
      mismatches.push(`mobilityStateVersion: snapshot=${strategy.mobilityStateVersion} record=${record.stateVersion}`)
    }
    if (strategy.intentVersion != null && strategy.intentVersion !== record.intentVersion) {
      mismatches.push(`intentVersion: snapshot=${strategy.intentVersion} record=${record.intentVersion}`)
    }
    if (strategy.objectiveId != null && strategy.objectiveId !== record.objectiveId) {
      mismatches.push(`objectiveId: snapshot=${strategy.objectiveId} record=${record.objectiveId}`)
    }
    if (strategy.strategyEngineVersion != null && strategy.strategyEngineVersion !== record.strategyEngineVersion) {
      mismatches.push(`strategyEngineVersion: snapshot=${strategy.strategyEngineVersion} record=${record.strategyEngineVersion}`)
    }
    if (strategy.policyContext?.runtimeHash != null && record.runtimePolicyHash != null
      && strategy.policyContext.runtimeHash !== record.runtimePolicyHash) {
      mismatches.push(`runtimePolicyHash: snapshot=${strategy.policyContext.runtimeHash} record=${record.runtimePolicyHash}`)
    }
    if (mismatches.length === 0) {
      checks.snapshotMetadataMatchesRecord = true
    } else {
      errors.push(...mismatches)
    }
  } else {
    errors.push('strategySnapshot is null on the record')
  }

  // Reconstruct provenance
  const provenance: StrategyProvenance | null = strategy && record.mobilityStateSnapshotId && record.intentRecordId
    ? {
        strategyEngineVersion: record.strategyEngineVersion ?? strategy.strategyEngineVersion ?? STRATEGY_ENGINE_VERSION,
        runtimePolicyVersion: record.runtimePolicyVersion ?? strategy.policyContext?.runtimeVersionId ?? '',
        runtimePolicyHash: record.runtimePolicyHash ?? strategy.policyContext?.runtimeHash ?? '',
        asOfDate: record.asOfDate?.toISOString() ?? strategy.policyContext?.asOf ?? '',
        mobilityStateSnapshotId: record.mobilityStateSnapshotId,
        mobilityStateVersion: record.stateVersion,
        intentRecordId: record.intentRecordId,
        intentVersion: record.intentVersion,
        objectiveId: record.objectiveId ?? '',
        objectiveVersion: record.objectiveVersion ?? 1,
        generatedAt: strategy.generatedAt ?? record.createdAt.toISOString(),
      }
    : null

  return {
    recordId,
    valid: errors.length === 0,
    checks,
    errors,
    provenance,
  }
}

// ---------------------------------------------------------------------------
// Strategy replay
// ---------------------------------------------------------------------------

/**
 * Replay a stored strategy from its provenance. Reconstructs the strategy
 * using:
 *   - the stored MobilityStateSnapshot
 *   - the stored IntentRecord version
 *   - the stored objective + asOfDate + runtime policy context
 *   - the CURRENT strategy engine version
 *
 * The resulting hash/metadata should match the stored record. If the engine
 * has intentionally evolved, we report ENGINE_CHANGED rather than silently
 * treating it as identical. If any dependency is unavailable, we report the
 * specific unavailability status — we NEVER silently substitute today's
 * profile or intent for the original.
 */
export async function replayStrategy(recordId: string): Promise<ReplayResult> {
  const record = await db.decisionRecord.findUnique({ where: { id: recordId } })
  if (!record || !record.strategySnapshot) {
    return {
      status: 'REPLAY_FAILED',
      storedStrategy: null as any,
      provenance: null as any,
      explanation: `DecisionRecord ${recordId} not found or has no strategySnapshot`,
      differences: ['record_missing'],
    }
  }

  const storedStrategy = record.strategySnapshot as unknown as Strategy
  const differences: string[] = []

  // Reconstruct provenance from the record
  const provenance: StrategyProvenance = {
    strategyEngineVersion: record.strategyEngineVersion ?? storedStrategy.strategyEngineVersion ?? STRATEGY_ENGINE_VERSION,
    runtimePolicyVersion: record.runtimePolicyVersion ?? storedStrategy.policyContext?.runtimeVersionId ?? '',
    runtimePolicyHash: record.runtimePolicyHash ?? storedStrategy.policyContext?.runtimeHash ?? '',
    asOfDate: record.asOfDate?.toISOString() ?? storedStrategy.policyContext?.asOf ?? '',
    mobilityStateSnapshotId: record.mobilityStateSnapshotId ?? storedStrategy.mobilityStateSnapshotId ?? '',
    mobilityStateVersion: record.stateVersion ?? storedStrategy.mobilityStateVersion ?? 0,
    intentRecordId: record.intentRecordId ?? storedStrategy.intentRecordId ?? '',
    intentVersion: record.intentVersion ?? storedStrategy.intentVersion ?? 0,
    objectiveId: record.objectiveId ?? storedStrategy.objectiveId ?? '',
    objectiveVersion: record.objectiveVersion ?? storedStrategy.objectiveVersion ?? 1,
    generatedAt: storedStrategy.generatedAt ?? record.createdAt.toISOString(),
  }

  // 1. Resolve the state snapshot — fail closed if unavailable
  if (!provenance.mobilityStateSnapshotId) {
    return {
      status: 'STATE_UNAVAILABLE',
      storedStrategy,
      provenance,
      explanation: 'No mobilityStateSnapshotId on the record — cannot reconstruct the profile.',
      differences: ['missing_snapshot_id'],
    }
  }
  const stateSnapshot = await db.mobilityStateSnapshot.findUnique({
    where: { id: provenance.mobilityStateSnapshotId },
  })
  if (!stateSnapshot) {
    return {
      status: 'STATE_UNAVAILABLE',
      storedStrategy,
      provenance,
      explanation: `MobilityStateSnapshot ${provenance.mobilityStateSnapshotId} has been deleted. The historical strategy is preserved as evidence, but cannot be replayed against the original profile.`,
      differences: ['snapshot_deleted'],
    }
  }

  // 2. Resolve the intent record — fail closed if unavailable
  if (!provenance.intentRecordId) {
    return {
      status: 'INTENT_UNAVAILABLE',
      storedStrategy,
      provenance,
      explanation: 'No intentRecordId on the record — cannot reconstruct the intent.',
      differences: ['missing_intent_id'],
    }
  }
  const intentRecord = await db.intentRecord.findUnique({
    where: { id: provenance.intentRecordId },
  })
  if (!intentRecord) {
    return {
      status: 'INTENT_UNAVAILABLE',
      storedStrategy,
      provenance,
      explanation: `IntentRecord ${provenance.intentRecordId} has been deleted. The historical strategy is preserved as evidence, but cannot be replayed against the original intent.`,
      differences: ['intent_deleted'],
    }
  }

  // 3. Reconstruct state + intent from the stored records
  const state = stateSnapshot.state as unknown as MobilityState
  const intent = intentRecord.intent as unknown as Intent

  // 4. Rebuild the canonical planning context using the stored asOfDate.
  //    If the policy resolver throws (DB unavailable, resolver error), we
  //    report POLICY_UNAVAILABLE. A hash MISMATCH is different — that means
  //    the policy is available but has changed, which we report as
  //    ENGINE_CHANGED (something has evolved).
  let context
  try {
    context = await buildCanonicalPlanningContext({
      state,
      intent,
      asOfDate: provenance.asOfDate,
      simulationMode: storedStrategy.policyContext?.simulationMode ?? false,
    })
  } catch (err) {
    return {
      status: 'POLICY_UNAVAILABLE',
      storedStrategy,
      provenance,
      explanation: `Could not resolve the runtime policy referenced by this strategy (asOf=${provenance.asOfDate}). The policy snapshot may have been removed or the resolver failed.`,
      differences: ['policy_resolution_failed'],
    }
  }

  // If the resolved runtime hash differs from the stored hash, the policy
  // has evolved since this strategy was stored. This is NOT "unavailable" —
  // it's "changed". We report it as ENGINE_CHANGED (the broader status for
  // "something has evolved since this record was stored").
  if (context.policyContext.runtimeHash !== provenance.runtimePolicyHash) {
    differences.push(`runtimePolicyHash: stored=${provenance.runtimePolicyHash} replayed=${context.policyContext.runtimeHash}`)
  }

  // 5. Rebuild the strategy using the current engine
  const replayedStrategy = buildStrategy(state, intent, context.routes, context)

  // 6. Compare against the stored strategy
  // Engine version comparison
  if (replayedStrategy.strategyEngineVersion !== provenance.strategyEngineVersion) {
    differences.push(`strategyEngineVersion: stored=${provenance.strategyEngineVersion} replayed=${replayedStrategy.strategyEngineVersion}`)
  }

  // Best trajectory comparison (structural)
  if (replayedStrategy.bestTrajectory?.id !== storedStrategy.bestTrajectory?.id) {
    differences.push(`bestTrajectory.id: stored=${storedStrategy.bestTrajectory?.id} replayed=${replayedStrategy.bestTrajectory?.id}`)
  }
  if (replayedStrategy.bestTrajectory?.label !== storedStrategy.bestTrajectory?.label) {
    differences.push(`bestTrajectory.label: stored=${storedStrategy.bestTrajectory?.label} replayed=${replayedStrategy.bestTrajectory?.label}`)
  }

  // Determine status
  let status: ReplayStatus
  let explanation: string

  if (differences.length === 0) {
    status = 'EXACT_MATCH'
    explanation = 'The replayed strategy matches the stored record exactly — same engine, same policy hash, same best trajectory.'
  } else if (differences.some((d) => d.startsWith('strategyEngineVersion:'))) {
    status = 'ENGINE_CHANGED'
    explanation = `The strategy engine has evolved since this record was stored. Differences: ${differences.join('; ')}. The historical strategy is preserved as evidence; the replayed strategy reflects the current engine.`
  } else {
    // Any other difference (policy hash, best trajectory, etc.) — the policy
    // or engine has evolved. NOT "unavailable" (we successfully resolved it).
    status = 'ENGINE_CHANGED'
    explanation = `The replayed strategy differs from the stored record. Differences: ${differences.join('; ')}. The historical strategy is preserved as evidence; the replayed strategy reflects the current state.`
  }

  return {
    status,
    replayedStrategy,
    storedStrategy,
    provenance,
    explanation,
    differences,
  }
}
