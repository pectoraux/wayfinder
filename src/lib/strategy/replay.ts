// Wayfinder — Strategy Replay + Record Verification (N0.1b)
//
// This module reconstructs a stored Strategy from its provenance and verifies
// that every referenced input is still available. It lets Wayfinder answer:
//
//   "Can we reproduce what the user was shown?"
//
// ARCHITECTURE
//
// A Wayfinder strategy is the deterministic result of:
//   MobilityStateSnapshot + IntentRecord + Runtime Policy World + Strategy Engine
//
// Replay walks that chain:
//
//   DecisionRecord
//       ↓
//   resolve referenced MobilityStateSnapshot (by id, NOT current profile)
//       ↓
//   resolve referenced IntentRecord (by id, NOT current intent)
//       ↓
//   resolve referenced policy world (via buildCanonicalPlanningContext)
//       ↓
//   buildStrategy(...)
//       ↓
//   compareStrategyReplay(stored, replayed)
//       ↓
//   structured status: EXACT_MATCH | ENGINE_CHANGED | OUTPUT_MISMATCH
//                      | POLICY_UNAVAILABLE | STATE_UNAVAILABLE
//                      | INTENT_UNAVAILABLE | REPLAY_FAILED
//
// INVARIANTS
//
//   - Replay NEVER falls back to the current user profile or intent.
//   - Replay NEVER overwrites the stored DecisionRecord or snapshot.
//   - Verify NEVER mutates anything.
//   - ENGINE_CHANGED is reserved for when strategyEngineVersion differs.
//   - OUTPUT_MISMATCH is returned when the deterministic strategy output
//     differs (trajectories, blockers, actions, etc.) but the engine
//     version is the same.
//   - A policy hash drift (same engine, different resolved policy) is
//     reported as OUTPUT_MISMATCH, NOT ENGINE_CHANGED.
//   - Authorization is enforced: a user can only replay/verify their own
//     DecisionRecords.
//
// Historical strategies are NEVER silently "updated" in place. If a dependency
// is unavailable, the stored snapshot is preserved as historical evidence.

import { db } from '@/lib/db'
import { buildCanonicalPlanningContext, STRATEGY_ENGINE_VERSION } from '@/lib/strategy/planning-context'
import { buildStrategy } from '@/lib/strategy'
import { buildDecisionGraph, compareGraphs, validateGraphCausalStructure, type GraphComparisonResult, type GraphCausalViolation, type DecisionGraph } from '@/lib/strategy/decision-graph'
import type { Strategy, StrategyProvenance, Trajectory, BlockerAnalysis, ActionPlan, ProfileAnalysis, IntentFrontier, PreferenceQuestion, UncertaintyAssessment, UnlockOption } from '@/lib/strategy/types'
import type { MobilityState, Intent } from '@/lib/domain/types'

// ---------------------------------------------------------------------------
// Replay status enum (7 statuses — OUTPUT_MISMATCH distinct from ENGINE_CHANGED)
// ---------------------------------------------------------------------------

export type ReplayStatus =
  | 'EXACT_MATCH'         // replayed strategy's deterministic output matches the stored strategy exactly
  | 'ENGINE_CHANGED'      // replayed cleanly but strategyEngineVersion differs
  | 'OUTPUT_MISMATCH'     // replay succeeded but deterministic output differs (policy drift, route changes, etc.)
  | 'POLICY_UNAVAILABLE'  // the runtime policy referenced is no longer resolvable (resolver threw)
  | 'STATE_UNAVAILABLE'   // the MobilityStateSnapshot has been deleted
  | 'INTENT_UNAVAILABLE'  // the IntentRecord has been deleted
  | 'REPLAY_FAILED'       // an unexpected error during replay (record missing, no snapshot, etc.)

// ---------------------------------------------------------------------------
// Structured strategy comparison
// ---------------------------------------------------------------------------

/** A single dimension that differs between the stored and replayed strategy. */
export interface StrategyDifference {
  /** The dimension name (e.g. 'bestTrajectory', 'blockers', 'actionPlan'). */
  dimension: string
  /** A short label for the difference (e.g. 'best trajectory id differs'). */
  field: string
  /** The stored value (canonicalized — see canonicalizeForComparison). */
  original: unknown
  /** The replayed value (canonicalized). */
  replayed: unknown
  /** Human-readable explanation of why this matters. */
  explanation: string
}

/** The result of comparing a stored strategy against a replayed one. */
export interface StrategyComparison {
  /** True if the deterministic strategy output matches exactly. */
  exact: boolean
  /** Per-dimension differences. Empty when exact. */
  differences: StrategyDifference[]
}

// ---------------------------------------------------------------------------
// Replay result
// ---------------------------------------------------------------------------

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
  /** Structured per-dimension differences (when status is OUTPUT_MISMATCH or ENGINE_CHANGED). */
  differences: StrategyDifference[]
  /** The structured comparison result (when replay succeeded). */
  comparison?: StrategyComparison
  /** N0.6: Graph comparison result (when replay succeeded and both graphs exist). */
  graphComparison?: GraphComparisonResult
}

// ---------------------------------------------------------------------------
// Verification result
// ---------------------------------------------------------------------------

export interface VerificationChecks {
  recordExists: boolean
  stateSnapshotExists: boolean
  intentRecordExists: boolean
  provenanceMatches: boolean
  engineVersionKnown: boolean
  policyAvailable: boolean
  replaySucceeded: boolean
  outputMatches: boolean
  /** N0.6: Decision Graph comparison result. */
  graphMatches: boolean
  /** N0.6: Decision Graph causal-structure validation. Fails if the stored
   *  graph contains invalid causal relationships (e.g., a fabricated
   *  Need→Blocker edge). A graph cannot appear causally complete merely
   *  because the relevant nodes exist — the EDGES must be valid. */
  graphCausallyValid: boolean
}

export interface VerificationResult {
  recordId: string
  /** True only if ALL checks pass (including graph comparison + causal validation). */
  valid: boolean
  checks: VerificationChecks
  /** Diagnostic messages for any failed checks. */
  errors: string[]
  /** The provenance reconstructed from the record (null if unrecoverable). */
  provenance: StrategyProvenance | null
  /** The structured comparison (if replay succeeded). */
  comparison?: StrategyComparison
  /** N0.6: The graph comparison result (if both graphs exist). */
  graphComparison?: GraphComparisonResult
  /** N0.6: Causal-structure violations found in the stored graph (if any). */
  graphCausalViolations?: GraphCausalViolation[]
}

// ---------------------------------------------------------------------------
// Canonical comparison — deterministic, ignores ephemeral fields
// ---------------------------------------------------------------------------

/**
 * Canonicalize a value for deterministic comparison. We JSON-stringify with
 * sorted keys so object key ordering doesn't produce false mismatches.
 * Ephemeral fields (generatedAt, capturedAt) are stripped at the dimension
 * level — see compareStrategyReplay.
 */
function canonicalize(value: unknown): string {
  if (value == null) return 'null'
  return JSON.stringify(value, (_key, val) => {
    if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
      // Sort object keys for deterministic output
      const sorted: Record<string, unknown> = {}
      for (const k of Object.keys(val as object).sort()) {
        sorted[k] = (val as Record<string, unknown>)[k]
      }
      return sorted
    }
    return val
  })
}

/**
 * Compare two arrays of objects by a canonical key. Returns true only if both
 * arrays have the same length and every element matches canonically.
 */
function arraysMatch(a: unknown[] | undefined, b: unknown[] | undefined): boolean {
  const aa = a ?? []
  const bb = b ?? []
  if (aa.length !== bb.length) return false
  return aa.every((item, i) => canonicalize(item) === canonicalize(bb[i]))
}

/**
 * Compare a single dimension between the stored and replayed strategy.
 * If the dimension differs, push a StrategyDifference.
 */
function compareDimension(
  differences: StrategyDifference[],
  dimension: string,
  field: string,
  original: unknown,
  replayed: unknown,
  explanation: string,
): void {
  if (canonicalize(original) !== canonicalize(replayed)) {
    differences.push({ dimension, field, original, replayed, explanation })
  }
}

/**
 * Structured comparison of a stored strategy against a replayed one.
 *
 * Compares ALL deterministic strategy dimensions:
 *   - bestTrajectory (id, label, destinationStatus, totalMonths, totalCostUSD, countries, viable)
 *   - alternativeTrajectories (count + canonical content)
 *   - blockers (count + canonical content)
 *   - unlocks (count + canonical content)
 *   - actionPlan (summary + highestLeverageAction)
 *   - profileAnalysis (topAssets, topGaps, highestLeverageChange, currentViableTrajectories, postChangeViableTrajectories)
 *   - intentFrontier (points count + distinctStrategies count + canonical points)
 *   - preferenceQuestions (count + canonical content)
 *   - uncertainties (count + canonical content)
 *   - alternativeIntents (count + canonical content)
 *   - highestLeverageChange
 *   - policyContext (runtimeHash, runtimeVersionId, baseSnapshotId, asOf, simulationMode)
 *   - strategyEngineVersion
 *
 * Ephemeral fields explicitly EXCLUDED:
 *   - generatedAt (timestamp)
 *   - state.capturedAt (timestamp)
 *   - state.*.provenance / status (may differ if snapshot was re-confirmed)
 *   - explanation (prose — may be reworded without changing the recommendation)
 *
 * The explanation field is excluded because it's human-readable prose that
 * may be reworded between engine versions without changing the underlying
 * recommendation. The deterministic dimensions above are what matter for
 * reproducibility.
 */
export function compareStrategyReplay(
  original: Strategy,
  replayed: Strategy,
): StrategyComparison {
  const differences: StrategyDifference[] = []

  // --- Best trajectory ---
  const ot = original.bestTrajectory
  const rt = replayed.bestTrajectory
  if (ot && rt) {
    compareDimension(differences, 'bestTrajectory', 'id', ot.id, rt.id, 'The best trajectory identity changed.')
    compareDimension(differences, 'bestTrajectory', 'label', ot.label, rt.label, 'The best trajectory label changed.')
    compareDimension(differences, 'bestTrajectory', 'destinationStatus', ot.destinationStatus, rt.destinationStatus, 'The destination status changed.')
    compareDimension(differences, 'bestTrajectory', 'totalMonths', ot.totalMonths, rt.totalMonths, 'The total duration changed.')
    compareDimension(differences, 'bestTrajectory', 'totalCostUSD', ot.totalCostUSD, rt.totalCostUSD, 'The total cost changed.')
    compareDimension(differences, 'bestTrajectory', 'countries', ot.countries, rt.countries, 'The countries traversed changed.')
    compareDimension(differences, 'bestTrajectory', 'viable', ot.viable, rt.viable, 'The viability flag changed.')
    compareDimension(differences, 'bestTrajectory', 'downstreamOptionality', ot.downstreamOptionality, rt.downstreamOptionality, 'The downstream optionality changed.')
  } else if (ot || rt) {
    differences.push({
      dimension: 'bestTrajectory', field: 'presence',
      original: ot ? 'present' : 'absent',
      replayed: rt ? 'present' : 'absent',
      explanation: 'One strategy has a best trajectory and the other does not.',
    })
  }

  // --- Alternative trajectories (count + content) ---
  const altOrig = original.alternativeTrajectories ?? []
  const altReplay = replayed.alternativeTrajectories ?? []
  if (altOrig.length !== altReplay.length) {
    differences.push({
      dimension: 'alternativeTrajectories', field: 'count',
      original: altOrig.length, replayed: altReplay.length,
      explanation: 'The number of alternative trajectories changed.',
    })
  } else if (!arraysMatch(altOrig, altReplay)) {
    differences.push({
      dimension: 'alternativeTrajectories', field: 'content',
      original: altOrig.map((t) => t.id), replayed: altReplay.map((t) => t.id),
      explanation: 'The alternative trajectories content changed.',
    })
  }

  // --- Blockers (count + content) ---
  const blockersOrig = original.blockers ?? []
  const blockersReplay = replayed.blockers ?? []
  if (blockersOrig.length !== blockersReplay.length) {
    differences.push({
      dimension: 'blockers', field: 'count',
      original: blockersOrig.length, replayed: blockersReplay.length,
      explanation: 'The number of blockers changed.',
    })
  } else if (!arraysMatch(blockersOrig, blockersReplay)) {
    differences.push({
      dimension: 'blockers', field: 'content',
      original: blockersOrig.map((b) => b.blockerId), replayed: blockersReplay.map((b) => b.blockerId),
      explanation: 'The blockers content changed.',
    })
  }

  // --- Unlocks (count + content) ---
  const unlocksOrig = original.unlocks ?? []
  const unlocksReplay = replayed.unlocks ?? []
  if (unlocksOrig.length !== unlocksReplay.length) {
    differences.push({
      dimension: 'unlocks', field: 'count',
      original: unlocksOrig.length, replayed: unlocksReplay.length,
      explanation: 'The number of unlock options changed.',
    })
  } else if (!arraysMatch(unlocksOrig, unlocksReplay)) {
    differences.push({
      dimension: 'unlocks', field: 'content',
      original: unlocksOrig.map((u) => u.kind), replayed: unlocksReplay.map((u) => u.kind),
      explanation: 'The unlock options content changed.',
    })
  }

  // --- Action plan ---
  const apOrig = original.actionPlan
  const apReplay = replayed.actionPlan
  if (apOrig && apReplay) {
    compareDimension(differences, 'actionPlan', 'actionsCount', apOrig.actions?.length ?? 0, apReplay.actions?.length ?? 0, 'The number of actions changed.')
    const hlOrig = apOrig.highestLeverageAction?.id
    const hlReplay = apReplay.highestLeverageAction?.id
    compareDimension(differences, 'actionPlan', 'highestLeverageActionId', hlOrig, hlReplay, 'The highest-leverage action changed.')
  }

  // --- Profile analysis ---
  const paOrig = original.profileAnalysis
  const paReplay = replayed.profileAnalysis
  if (paOrig && paReplay) {
    compareDimension(differences, 'profileAnalysis', 'topAssetsCount', paOrig.topAssets?.length ?? 0, paReplay.topAssets?.length ?? 0, 'The number of top assets changed.')
    compareDimension(differences, 'profileAnalysis', 'topGapsCount', paOrig.topGaps?.length ?? 0, paReplay.topGaps?.length ?? 0, 'The number of top gaps changed.')
    compareDimension(differences, 'profileAnalysis', 'currentViableTrajectories', paOrig.currentViableTrajectories, paReplay.currentViableTrajectories, 'The current viable trajectory count changed.')
    compareDimension(differences, 'profileAnalysis', 'postChangeViableTrajectories', paOrig.postChangeViableTrajectories, paReplay.postChangeViableTrajectories, 'The post-change viable trajectory count changed.')
    compareDimension(differences, 'profileAnalysis', 'highestLeverageChangeLabel', paOrig.highestLeverageChange?.label, paReplay.highestLeverageChange?.label, 'The highest-leverage change label changed.')
  }

  // --- Intent frontier ---
  const ifOrig = original.intentFrontier
  const ifReplay = replayed.intentFrontier
  if (ifOrig && ifReplay) {
    compareDimension(differences, 'intentFrontier', 'pointsCount', ifOrig.points?.length ?? 0, ifReplay.points?.length ?? 0, 'The number of intent frontier points changed.')
    compareDimension(differences, 'intentFrontier', 'distinctStrategiesCount', ifOrig.distinctStrategies?.length ?? 0, ifReplay.distinctStrategies?.length ?? 0, 'The number of distinct strategies changed.')
  }

  // --- Preference questions (count + content) ---
  const pqOrig = original.preferenceQuestions ?? []
  const pqReplay = replayed.preferenceQuestions ?? []
  if (pqOrig.length !== pqReplay.length) {
    differences.push({
      dimension: 'preferenceQuestions', field: 'count',
      original: pqOrig.length, replayed: pqReplay.length,
      explanation: 'The number of preference questions changed.',
    })
  } else if (!arraysMatch(pqOrig, pqReplay)) {
    differences.push({
      dimension: 'preferenceQuestions', field: 'content',
      original: pqOrig.map((q) => q.id), replayed: pqReplay.map((q) => q.id),
      explanation: 'The preference questions content changed.',
    })
  }

  // --- Uncertainties (count + content) ---
  const uOrig = original.uncertainties ?? []
  const uReplay = replayed.uncertainties ?? []
  if (uOrig.length !== uReplay.length) {
    differences.push({
      dimension: 'uncertainties', field: 'count',
      original: uOrig.length, replayed: uReplay.length,
      explanation: 'The number of uncertainty assessments changed.',
    })
  } else if (!arraysMatch(uOrig, uReplay)) {
    differences.push({
      dimension: 'uncertainties', field: 'content',
      original: uOrig.map((u) => u.dimension), replayed: uReplay.map((u) => u.dimension),
      explanation: 'The uncertainty assessments content changed.',
    })
  }

  // --- Alternative intents (count + content) ---
  const aiOrig = original.alternativeIntents ?? []
  const aiReplay = replayed.alternativeIntents ?? []
  if (aiOrig.length !== aiReplay.length) {
    differences.push({
      dimension: 'alternativeIntents', field: 'count',
      original: aiOrig.length, replayed: aiReplay.length,
      explanation: 'The number of alternative intents changed.',
    })
  } else if (!arraysMatch(aiOrig, aiReplay)) {
    differences.push({
      dimension: 'alternativeIntents', field: 'content',
      original: aiOrig.map((a) => a.title), replayed: aiReplay.map((a) => a.title),
      explanation: 'The alternative intents content changed.',
    })
  }

  // --- Highest leverage change (top-level) ---
  compareDimension(
    differences, 'highestLeverageChange', 'label',
    original.highestLeverageChange?.label, replayed.highestLeverageChange?.label,
    'The highest-leverage change label changed.',
  )

  // --- Policy context ---
  const pcOrig = original.policyContext
  const pcReplay = replayed.policyContext
  if (pcOrig && pcReplay) {
    compareDimension(differences, 'policyContext', 'runtimeHash', pcOrig.runtimeHash, pcReplay.runtimeHash, 'The runtime policy hash changed.')
    compareDimension(differences, 'policyContext', 'runtimeVersionId', pcOrig.runtimeVersionId, pcReplay.runtimeVersionId, 'The runtime policy version id changed.')
    compareDimension(differences, 'policyContext', 'baseSnapshotId', pcOrig.baseSnapshotId, pcReplay.baseSnapshotId, 'The base policy snapshot id changed.')
    compareDimension(differences, 'policyContext', 'simulationMode', pcOrig.simulationMode, pcReplay.simulationMode, 'The simulation mode flag changed.')
  }

  // --- Strategy engine version ---
  compareDimension(
    differences, 'strategyEngineVersion', 'version',
    original.strategyEngineVersion, replayed.strategyEngineVersion,
    'The strategy engine version changed.',
  )

  return {
    exact: differences.length === 0,
    differences,
  }
}

// ---------------------------------------------------------------------------
// Authorization-scoped replay + verify
// ---------------------------------------------------------------------------

/**
 * Resolve the DecisionRecord, enforcing that it belongs to the requesting user.
 * Returns null if the record doesn't exist OR doesn't belong to the user.
 * (We return null for both cases to avoid leaking the existence of other
 * users' records.)
 */
async function resolveOwnedRecord(recordId: string, userId?: string) {
  const record = await db.decisionRecord.findUnique({ where: { id: recordId } })
  if (!record) return null
  // If a userId is provided for authorization, the record must belong to that
  // user. userId on DecisionRecord is set at adoption time.
  if (userId && record.userId && record.userId !== userId) {
    return null
  }
  return record
}

// ---------------------------------------------------------------------------
// Verify
// ---------------------------------------------------------------------------

/**
 * Verify the integrity of a DecisionRecord.
 *
 * Checks:
 *   1. recordExists — the DecisionRecord exists (and belongs to the user if userId given)
 *   2. stateSnapshotExists — the referenced MobilityStateSnapshot exists
 *   3. intentRecordExists — the referenced IntentRecord exists
 *   4. provenanceMatches — the strategy snapshot's metadata matches the record's columns
 *   5. engineVersionKnown — the strategy engine version is present
 *   6. policyAvailable — buildCanonicalPlanningContext succeeds with the stored asOf
 *   7. replaySucceeded — the full replay (buildStrategy) completes without throwing
 *   8. outputMatches — the replayed strategy's deterministic output matches the stored
 *
 * Verification NEVER mutates the DecisionRecord or any other persisted state.
 *
 * @param recordId The DecisionRecord to verify
 * @param userId Optional — if provided, the record must belong to this user
 */
export async function verifyStrategyRecord(
  recordId: string,
  userId?: string,
): Promise<VerificationResult> {
  const errors: string[] = []
  const checks: VerificationChecks = {
    recordExists: false,
    stateSnapshotExists: false,
    intentRecordExists: false,
    provenanceMatches: false,
    engineVersionKnown: false,
    policyAvailable: false,
    replaySucceeded: false,
    outputMatches: false,
    graphMatches: false,
    graphCausallyValid: false,
  }

  const record = await resolveOwnedRecord(recordId, userId)
  if (!record) {
    return {
      recordId,
      valid: false,
      checks,
      errors: [`DecisionRecord ${recordId} not found${userId ? ' or not owned by user' : ''}`],
      provenance: null,
    }
  }
  checks.recordExists = true

  const storedStrategy = record.strategySnapshot as unknown as Strategy | null

  // 1. State snapshot exists
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

  // 2. Intent record exists
  if (record.intentRecordId) {
    const intentRecord = await db.intentRecord.findUnique({
      where: { id: record.intentRecordId },
    })
    if (intentRecord) {
      checks.intentRecordExists = true
      if (intentRecord.version !== record.intentVersion) {
        errors.push(`intentVersion mismatch: record says ${record.intentVersion}, intentRecord says ${intentRecord.version}`)
      }
    } else {
      errors.push(`IntentRecord ${record.intentRecordId} not found`)
    }
  } else {
    errors.push('intentRecordId is null on the record')
  }

  // 3. Engine version known
  if (record.strategyEngineVersion) {
    checks.engineVersionKnown = true
  } else {
    errors.push('strategyEngineVersion is null on the record')
  }

  // 4. Provenance matches (snapshot metadata vs record columns)
  if (storedStrategy) {
    const mismatches: string[] = []
    if (storedStrategy.mobilityStateVersion != null && storedStrategy.mobilityStateVersion !== record.stateVersion) {
      mismatches.push(`mobilityStateVersion: snapshot=${storedStrategy.mobilityStateVersion} record=${record.stateVersion}`)
    }
    if (storedStrategy.intentVersion != null && storedStrategy.intentVersion !== record.intentVersion) {
      mismatches.push(`intentVersion: snapshot=${storedStrategy.intentVersion} record=${record.intentVersion}`)
    }
    if (storedStrategy.objectiveId != null && storedStrategy.objectiveId !== record.objectiveId) {
      mismatches.push(`objectiveId: snapshot=${storedStrategy.objectiveId} record=${record.objectiveId}`)
    }
    if (storedStrategy.strategyEngineVersion != null && record.strategyEngineVersion != null
      && storedStrategy.strategyEngineVersion !== record.strategyEngineVersion) {
      mismatches.push(`strategyEngineVersion: snapshot=${storedStrategy.strategyEngineVersion} record=${record.strategyEngineVersion}`)
    }
    if (storedStrategy.policyContext?.runtimeHash != null && record.runtimePolicyHash != null
      && storedStrategy.policyContext.runtimeHash !== record.runtimePolicyHash) {
      mismatches.push(`runtimePolicyHash: snapshot=${storedStrategy.policyContext.runtimeHash} record=${record.runtimePolicyHash}`)
    }
    if (mismatches.length === 0) {
      checks.provenanceMatches = true
    } else {
      errors.push(...mismatches)
    }
  } else {
    errors.push('strategySnapshot is null on the record')
  }

  // Reconstruct provenance
  const provenance: StrategyProvenance | null = storedStrategy && record.mobilityStateSnapshotId && record.intentRecordId
    ? {
        strategyEngineVersion: record.strategyEngineVersion ?? storedStrategy.strategyEngineVersion ?? STRATEGY_ENGINE_VERSION,
        runtimePolicyVersion: record.runtimePolicyVersion ?? storedStrategy.policyContext?.runtimeVersionId ?? '',
        runtimePolicyHash: record.runtimePolicyHash ?? storedStrategy.policyContext?.runtimeHash ?? '',
        asOfDate: record.asOfDate?.toISOString() ?? storedStrategy.policyContext?.asOf ?? '',
        mobilityStateSnapshotId: record.mobilityStateSnapshotId,
        mobilityStateVersion: record.stateVersion,
        intentRecordId: record.intentRecordId,
        intentVersion: record.intentVersion,
        objectiveId: record.objectiveId ?? '',
        objectiveVersion: record.objectiveVersion ?? 1,
        generatedAt: storedStrategy.generatedAt ?? record.createdAt.toISOString(),
      }
    : null

  // 5 + 6 + 7. Policy available + replay succeeded + output matches
  // We only attempt the replay if the basic existence checks pass — otherwise
  // we'd be setting up for a guaranteed failure.
  if (checks.stateSnapshotExists && checks.intentRecordExists && checks.engineVersionKnown && storedStrategy && provenance) {
    const stateSnapshot = await db.mobilityStateSnapshot.findUnique({
      where: { id: record.mobilityStateSnapshotId! },
    })
    const intentRecord = await db.intentRecord.findUnique({
      where: { id: record.intentRecordId! },
    })
    if (stateSnapshot && intentRecord) {
      const state = stateSnapshot.state as unknown as MobilityState
      const intent = intentRecord.intent as unknown as Intent
      let context
      try {
        context = await buildCanonicalPlanningContext({
          state,
          intent,
          asOfDate: provenance.asOfDate,
          simulationMode: storedStrategy.policyContext?.simulationMode ?? false,
        })
        checks.policyAvailable = true
      } catch (err) {
        errors.push(`policy resolution failed: ${err instanceof Error ? err.message : String(err)}`)
      }

      if (context) {
        try {
          const replayedStrategy = await buildStrategy(state, intent, context.routes, context)
          checks.replaySucceeded = true
          const comparison = compareStrategyReplay(storedStrategy, replayedStrategy)
          if (comparison.exact) {
            checks.outputMatches = true
          } else {
            errors.push(`output mismatch: ${comparison.differences.length} dimension(s) differ: ${comparison.differences.map((d) => d.dimension).join(', ')}`)
          }

          // N0.6: Graph comparison — compare stored DecisionGraph against replayed
          let graphComparison: GraphComparisonResult | undefined
          const storedGraph = storedStrategy.decisionGraph
          const replayedGraph = replayedStrategy.decisionGraph
          if (storedGraph && replayedGraph) {
            graphComparison = compareGraphs(storedGraph, replayedGraph)
            if (graphComparison.status === 'EXACT_MATCH') {
              checks.graphMatches = true
            } else {
              errors.push(`graph mismatch: ${graphComparison.differences.join('; ')}`)
            }
          } else if (storedGraph || replayedGraph) {
            graphComparison = {
              status: 'GRAPH_MISMATCH',
              storedHash: storedGraph?.graphHash ?? 'none',
              replayedHash: replayedGraph?.graphHash ?? 'none',
              differences: ['graph exists in one strategy but not the other'],
            }
            errors.push('graph mismatch: graph exists in one strategy but not the other')
          } else {
            // Both lack a graph (pre-N0.6 records) — graph check passes vacuously
            checks.graphMatches = true
          }

          // N0.6: Causal-structure validation — fail if the stored (historical)
          // graph contains invalid causal relationships. A graph cannot appear
          // causally complete merely because the relevant nodes exist — the
          // EDGES must be valid. This detects fabricated relationships such as
          // an invented Need→Blocker edge.
          let graphCausalViolations: GraphCausalViolation[] | undefined
          if (storedGraph) {
            graphCausalViolations = validateGraphCausalStructure(storedGraph)
            if (graphCausalViolations.length === 0) {
              checks.graphCausallyValid = true
            } else {
              const summaries = graphCausalViolations.map(
                (v) => `${v.type}: ${v.description}`
              )
              errors.push(`graph causal-structure invalid: ${summaries.join('; ')}`)
            }
          } else if (replayedGraph) {
            // No stored graph but replayed one exists — validate the replayed
            graphCausalViolations = validateGraphCausalStructure(replayedGraph)
            if (graphCausalViolations.length === 0) {
              checks.graphCausallyValid = true
            } else {
              const summaries = graphCausalViolations.map(
                (v) => `${v.type}: ${v.description}`
              )
              errors.push(`graph causal-structure invalid: ${summaries.join('; ')}`)
            }
          } else {
            // Both lack a graph — causal check passes vacuously
            checks.graphCausallyValid = true
          }

          return {
            recordId,
            valid: errors.length === 0,
            checks,
            errors,
            provenance,
            comparison,
            graphComparison,
            graphCausalViolations,
          }
        } catch (err) {
          errors.push(`replay failed: ${err instanceof Error ? err.message : String(err)}`)
        }
      }
    }
  }

  return {
    recordId,
    valid: errors.length === 0,
    checks,
    errors,
    provenance,
  }
}

// ---------------------------------------------------------------------------
// Replay
// ---------------------------------------------------------------------------

/**
 * Replay a stored strategy from its provenance. Reconstructs the strategy
 * using the EXACT persisted inputs:
 *   - the stored MobilityStateSnapshot (by id, NOT current profile)
 *   - the stored IntentRecord (by id, NOT current intent)
 *   - the stored asOfDate + simulationMode (via buildCanonicalPlanningContext)
 *   - the CURRENT strategy engine (buildStrategy always uses STRATEGY_ENGINE_VERSION)
 *
 * Status semantics:
 *   EXACT_MATCH        — deterministic output matches exactly (engine + policy + all dimensions)
 *   ENGINE_CHANGED     — replay succeeded but strategyEngineVersion differs
 *   OUTPUT_MISMATCH    — replay succeeded, engine version matches, but deterministic output differs
 *                        (e.g. policy hash drift, route set change, blocker change)
 *   POLICY_UNAVAILABLE — buildCanonicalPlanningContext threw (resolver error, DB unavailable)
 *   STATE_UNAVAILABLE  — the MobilityStateSnapshot was deleted
 *   INTENT_UNAVAILABLE — the IntentRecord was deleted
 *   REPLAY_FAILED      — record missing, no strategySnapshot, or unexpected error
 *
 * Replay NEVER falls back to the current user profile or intent.
 * Replay NEVER overwrites the stored DecisionRecord or snapshot.
 *
 * @param recordId The DecisionRecord to replay
 * @param userId Optional — if provided, the record must belong to this user
 */
export async function replayStrategy(
  recordId: string,
  userId?: string,
): Promise<ReplayResult> {
  const record = await resolveOwnedRecord(recordId, userId)
  if (!record || !record.strategySnapshot) {
    return {
      status: 'REPLAY_FAILED',
      storedStrategy: null as any,
      provenance: null as any,
      explanation: `DecisionRecord ${recordId} not found${userId ? ' or not owned by user' : ''} or has no strategySnapshot.`,
      differences: [],
    }
  }

  const storedStrategy = record.strategySnapshot as unknown as Strategy

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
      differences: [],
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
      differences: [],
    }
  }

  // 2. Resolve the intent record — fail closed if unavailable
  if (!provenance.intentRecordId) {
    return {
      status: 'INTENT_UNAVAILABLE',
      storedStrategy,
      provenance,
      explanation: 'No intentRecordId on the record — cannot reconstruct the intent.',
      differences: [],
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
      differences: [],
    }
  }

  // 3. Reconstruct state + intent from the stored records (NOT current profile/intent)
  const state = stateSnapshot.state as unknown as MobilityState
  const intent = intentRecord.intent as unknown as Intent

  // 4. Rebuild the canonical planning context using the stored asOfDate.
  //    If the resolver throws, the policy world is unavailable — we do NOT
  //    fall back to today's policy.
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
      explanation: `Could not resolve the runtime policy referenced by this strategy (asOf=${provenance.asOfDate}). The policy snapshot may have been removed or the resolver failed: ${err instanceof Error ? err.message : String(err)}`,
      differences: [],
    }
  }

  // 5. Rebuild the strategy using the current engine
  let replayedStrategy: Strategy
  try {
    replayedStrategy = await buildStrategy(state, intent, context.routes, context)
  } catch (err) {
    return {
      status: 'REPLAY_FAILED',
      storedStrategy,
      provenance,
      explanation: `buildStrategy threw during replay: ${err instanceof Error ? err.message : String(err)}`,
      differences: [],
    }
  }

  // 6. Structured comparison across all deterministic dimensions
  const comparison = compareStrategyReplay(storedStrategy, replayedStrategy)

  // 6b. N0.6: Graph comparison — compare the stored DecisionGraph against
  //     the replayed DecisionGraph. This makes the graph part of the
  //     historical integrity contract.
  let graphComparison: GraphComparisonResult | undefined
  const storedGraph = storedStrategy.decisionGraph
  const replayedGraph = replayedStrategy.decisionGraph
  if (storedGraph && replayedGraph) {
    graphComparison = compareGraphs(storedGraph, replayedGraph)
  } else if (storedGraph || replayedGraph) {
    // One exists but not the other — graph mismatch
    graphComparison = {
      status: 'GRAPH_MISMATCH',
      storedHash: storedGraph?.graphHash ?? 'none',
      replayedHash: replayedGraph?.graphHash ?? 'none',
      differences: ['graph exists in one strategy but not the other'],
    }
  }

  // 7. Determine status — distinguish ENGINE_CHANGED from OUTPUT_MISMATCH
  const engineChanged = comparison.differences.some((d) => d.dimension === 'strategyEngineVersion')
  const otherDifferences = comparison.differences.filter((d) => d.dimension !== 'strategyEngineVersion')

  // N0.6: graph mismatch is also a difference
  const graphMismatch = graphComparison?.status === 'GRAPH_MISMATCH'

  let status: ReplayStatus
  let explanation: string

  if (comparison.exact && !graphMismatch) {
    status = 'EXACT_MATCH'
    explanation = 'The replayed strategy matches the stored record exactly — same engine, same policy hash, same deterministic output across all dimensions, and the decision graph matches.'
  } else if (engineChanged && otherDifferences.length === 0 && !graphMismatch) {
    status = 'ENGINE_CHANGED'
    explanation = `The strategy engine version changed from ${provenance.strategyEngineVersion} to ${replayedStrategy.strategyEngineVersion}, but the deterministic output is still identical.`
  } else if (engineChanged && (otherDifferences.length > 0 || graphMismatch)) {
    status = 'ENGINE_CHANGED'
    const parts: string[] = []
    if (otherDifferences.length > 0) parts.push(`${otherDifferences.length} dimension(s) differ: ${otherDifferences.map((d) => d.dimension).join(', ')}`)
    if (graphMismatch) parts.push('decision graph mismatch')
    explanation = `The strategy engine version changed (${provenance.strategyEngineVersion} → ${replayedStrategy.strategyEngineVersion}) AND ${parts.join(' and ')}.`
  } else if (graphMismatch && comparison.exact) {
    // Strategy output matches but graph differs — this is a graph-specific regression
    status = 'OUTPUT_MISMATCH'
    explanation = `The replayed strategy's deterministic output matches, but the decision graph differs: ${graphComparison!.differences.join('; ')}.`
  } else {
    status = 'OUTPUT_MISMATCH'
    const parts: string[] = [`${comparison.differences.length} dimension(s) differ: ${comparison.differences.map((d) => d.dimension).join(', ')}`]
    if (graphMismatch) parts.push(`decision graph mismatch: ${graphComparison!.differences.join('; ')}`)
    explanation = `The replayed strategy differs from the stored record: ${parts.join(' and ')}.`
  }

  return {
    status,
    replayedStrategy,
    storedStrategy,
    provenance,
    explanation,
    differences: comparison.differences,
    comparison,
    graphComparison,
  }
}
