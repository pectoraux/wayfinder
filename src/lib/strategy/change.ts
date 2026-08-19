// Wayfinder — Strategy Memory: Change Classification + Diff (N0.2)
//
// This module builds the "memory" layer on top of the existing DecisionRecord
// ledger. It answers:
//
//   "Why did this person's strategy change, and what exactly changed?"
//
// ARCHITECTURE
//
// DecisionRecord remains the canonical historical strategy ledger. This module
// does NOT create a second persistence system. It provides:
//
//   1. StrategyChangeCause — a deterministic enum classifying WHY a strategy
//      transition happened (profile change, intent change, objective change,
//      policy change, engine change, manual adoption, recomputation, unknown).
//
//   2. buildStrategyChange(prev, next) — inspects two DecisionRecords and
//      deterministically classifies the cause + builds a structured diff.
//
//   3. StrategyDiff — a structured diff between two strategies, reusing
//      compareStrategyReplay (the N0.1b comparison infrastructure) so there
//      is ONE deterministic comparison code path, not two.
//
//   4. explainStrategyChange(change) — a deterministic human-readable
//      explanation of the cause. No LLM. The prose is generated from the
//      structured cause + diff, so it's always grounded in the actual data.
//
// DETERMINISM
//
// The cause is derived from comparing the two records' provenance fields:
//   - if stateVersion differs → USER_PROFILE_CHANGED
//   - else if intentVersion differs → USER_INTENT_CHANGED
//   - else if objectiveId differs → OBJECTIVE_CHANGED
//   - else if runtimePolicyHash differs → POLICY_CHANGED
//   - else if strategyEngineVersion differs → ENGINE_CHANGED
//   - else if trigger === 'OBJECTIVE_ADOPT' → MANUAL_ADOPTION
//   - else if trigger === 'POLICY_CHANGE' → POLICY_CHANGED
//   - else → RECOMPUTATION (or UNKNOWN if no previous record)
//
// The cause is NEVER inferred from timestamps.

import type { Strategy } from '@/lib/strategy/types'
import { compareStrategyReplay, type StrategyComparison } from '@/lib/strategy/replay'

// ---------------------------------------------------------------------------
// Strategy change cause enum
// ---------------------------------------------------------------------------

export type StrategyChangeCause =
  | 'USER_PROFILE_CHANGED'   // the user's MobilityStateSnapshot version changed
  | 'USER_INTENT_CHANGED'    // the user's IntentRecord version changed
  | 'OBJECTIVE_CHANGED'      // the objectiveId changed (e.g. income → residence)
  | 'POLICY_CHANGED'         // the runtime policy hash changed (verified policy event)
  | 'ENGINE_CHANGED'         // the strategy engine version changed
  | 'MANUAL_ADOPTION'        // the user manually adopted a strategy
  | 'RECOMPUTATION'          // recomputed with no input change (e.g. retry)
  | 'UNKNOWN'                // no previous record, or cause cannot be determined

export const STRATEGY_CHANGE_CAUSE_LABELS: Record<StrategyChangeCause, string> = {
  USER_PROFILE_CHANGED: 'Your profile changed',
  USER_INTENT_CHANGED: 'Your priorities changed',
  OBJECTIVE_CHANGED: 'Your objective changed',
  POLICY_CHANGED: 'Immigration policy changed',
  ENGINE_CHANGED: "Wayfinder's strategy engine changed",
  MANUAL_ADOPTION: 'You adopted a new strategy',
  RECOMPUTATION: 'Strategy was recomputed',
  UNKNOWN: 'Strategy created',
}

// ---------------------------------------------------------------------------
// Strategy diff (reuses compareStrategyReplay)
// ---------------------------------------------------------------------------

/**
 * A structured diff between two strategies. Reuses StrategyComparison from
 * the replay infrastructure so there is ONE deterministic comparison code
 * path. We add trajectory-specific + blocker-specific + action-specific
 * convenience views on top of the raw differences.
 */
export interface StrategyDiff {
  /** The full structured comparison from compareStrategyReplay. */
  comparison: StrategyComparison
  /** Convenience: did the best trajectory change? */
  bestTrajectoryChanged: boolean
  /** Convenience: did the blockers change (count or content)? */
  blockersChanged: boolean
  /** Convenience: did the action plan change? */
  actionPlanChanged: boolean
  /** Convenience: did the policy context change? */
  policyContextChanged: boolean
  /** Convenience: did the engine version change? */
  engineChanged: boolean
  /** Convenience: did the profile analysis change? */
  profileAnalysisChanged: boolean
  /** Convenience: did the intent frontier change? */
  intentFrontierChanged: boolean
}

// ---------------------------------------------------------------------------
// Strategy change record
// ---------------------------------------------------------------------------

/**
 * A complete description of a strategy transition: previous → next, with the
 * deterministic cause and the structured diff.
 */
export interface StrategyChange {
  /** The previous DecisionRecord id (null if this is the first strategy). */
  previousRecordId: string | null
  /** The new DecisionRecord id. */
  recordId: string
  /** The deterministic cause of the change. */
  cause: StrategyChangeCause
  /** The structured diff between the two strategies. */
  diff: StrategyDiff
  /** The previous strategy (null if no previous record). */
  previousStrategy: Strategy | null
  /** The new strategy. */
  newStrategy: Strategy
  /** When the new strategy was created (ISO). */
  changedAt: string
  /** The objective this change is scoped to. */
  objectiveId: string | null
}

// ---------------------------------------------------------------------------
// Lightweight record shape (avoids coupling to Prisma types)
// ---------------------------------------------------------------------------

/**
 * The minimal fields needed from a DecisionRecord to classify a change.
 * This decouples the change classifier from the Prisma client, making it
 * testable without a DB.
 */
export interface StrategyRecordSummary {
  id: string
  stateVersion: number
  intentVersion: number
  objectiveId: string | null
  runtimePolicyHash: string | null
  strategyEngineVersion: string | null
  trigger: string
  previousRecordId: string | null
  changeReason: string | null
  createdAt: Date | string
  strategySnapshot: unknown // the stored Strategy JSON
}

// ---------------------------------------------------------------------------
// Cause classification (deterministic)
// ---------------------------------------------------------------------------

/**
 * Classify the cause of a strategy transition by comparing the provenance
 * fields of the previous and next records. Pure function — no I/O.
 *
 * The classification order matters: we check the most specific causes first.
 * If multiple inputs changed, we report the most salient one (profile > intent
 * > objective > policy > engine). This matches the staleness dimension order.
 */
export function classifyStrategyChangeCause(
  prev: StrategyRecordSummary | null,
  next: StrategyRecordSummary,
): StrategyChangeCause {
  // No previous record — this is the first strategy for this objective/user.
  if (!prev) {
    if (next.trigger === 'OBJECTIVE_ADOPT') return 'MANUAL_ADOPTION'
    return 'UNKNOWN'
  }

  // Check the stored changeReason first (if it was set explicitly at write time,
  // trust it — it's the ground truth from the code that created the record).
  if (next.changeReason) {
    return next.changeReason as StrategyChangeCause
  }

  // Derive from provenance comparison
  if (next.stateVersion !== prev.stateVersion) return 'USER_PROFILE_CHANGED'
  if (next.intentVersion !== prev.intentVersion) return 'USER_INTENT_CHANGED'
  if (next.objectiveId !== prev.objectiveId) return 'OBJECTIVE_CHANGED'
  if (next.runtimePolicyHash !== prev.runtimePolicyHash) return 'POLICY_CHANGED'
  if (next.strategyEngineVersion !== prev.strategyEngineVersion) return 'ENGINE_CHANGED'
  if (next.trigger === 'OBJECTIVE_ADOPT') return 'MANUAL_ADOPTION'
  if (next.trigger === 'POLICY_CHANGE') return 'POLICY_CHANGED'

  // Inputs are identical but a new record was created — recomputation.
  return 'RECOMPUTATION'
}

// ---------------------------------------------------------------------------
// Diff construction (reuses compareStrategyReplay)
// ---------------------------------------------------------------------------

/**
 * Build a structured diff between two strategies. Reuses compareStrategyReplay
 * so there is ONE deterministic comparison code path. Adds convenience flags
 * for the UI.
 */
export function buildStrategyDiff(
  previous: Strategy | null,
  next: Strategy,
): StrategyDiff {
  // If there's no previous strategy, every dimension is "new" — we still run
  // the comparison (against a null stand-in) to produce a diff that shows
  // what the new strategy contains. compareStrategyReplay handles the
  // null-bestTrajectory case.
  const comparison = compareStrategyReplay(
    previous ?? ({} as Strategy),
    next,
  )

  const dims = comparison.differences.map((d) => d.dimension)
  return {
    comparison,
    bestTrajectoryChanged: dims.includes('bestTrajectory'),
    blockersChanged: dims.includes('blockers'),
    actionPlanChanged: dims.includes('actionPlan'),
    policyContextChanged: dims.includes('policyContext'),
    engineChanged: dims.includes('strategyEngineVersion'),
    profileAnalysisChanged: dims.includes('profileAnalysis'),
    intentFrontierChanged: dims.includes('intentFrontier'),
  }
}

// ---------------------------------------------------------------------------
// Strategy change construction
// ---------------------------------------------------------------------------

/**
 * Build a complete StrategyChange description from two records. This is the
 * core of the Strategy Memory layer.
 *
 * @param prev The previous DecisionRecord summary (null if first strategy)
 * @param next The new DecisionRecord summary
 */
export function buildStrategyChange(
  prev: StrategyRecordSummary | null,
  next: StrategyRecordSummary,
): StrategyChange {
  const cause = classifyStrategyChangeCause(prev, next)
  const previousStrategy = prev?.strategySnapshot as Strategy | null
  const newStrategy = next.strategySnapshot as Strategy
  const diff = buildStrategyDiff(previousStrategy, newStrategy)

  return {
    previousRecordId: prev?.id ?? null,
    recordId: next.id,
    cause,
    diff,
    previousStrategy,
    newStrategy,
    changedAt: typeof next.createdAt === 'string' ? next.createdAt : next.createdAt.toISOString(),
    objectiveId: next.objectiveId,
  }
}

// ---------------------------------------------------------------------------
// Deterministic explanation (no LLM)
// ---------------------------------------------------------------------------

/**
 * Generate a deterministic human-readable explanation of a strategy change.
 * The prose is grounded in the structured cause + diff — no LLM, no guessing.
 */
export function explainStrategyChange(change: StrategyChange): string {
  const causeLabel = STRATEGY_CHANGE_CAUSE_LABELS[change.cause]
  const { diff, newStrategy, previousStrategy } = change

  // First strategy — no previous
  if (!previousStrategy) {
    return `${causeLabel}. Your initial strategy is ${newStrategy.bestTrajectory?.label ?? 'unknown'}.`
  }

  const parts: string[] = [causeLabel + '.']

  // Trajectory change
  if (diff.bestTrajectoryChanged) {
    const prevLabel = previousStrategy.bestTrajectory?.label ?? 'unknown'
    const newLabel = newStrategy.bestTrajectory?.label ?? 'unknown'
    if (prevLabel !== newLabel) {
      parts.push(`Your best trajectory changed from ${prevLabel} to ${newLabel}.`)
    } else {
      parts.push(`Your best trajectory (${newLabel}) was updated.`)
    }
  }

  // Blockers change
  if (diff.blockersChanged) {
    const prevCount = previousStrategy.blockers?.length ?? 0
    const newCount = newStrategy.blockers?.length ?? 0
    if (newCount > prevCount) {
      parts.push(`${newCount - prevCount} new blocker(s) appeared.`)
    } else if (newCount < prevCount) {
      parts.push(`${prevCount - newCount} blocker(s) resolved.`)
    } else {
      parts.push('Your blockers changed.')
    }
  }

  // Action plan change
  if (diff.actionPlanChanged) {
    parts.push('Your action plan was updated.')
  }

  // Policy context change
  if (diff.policyContextChanged) {
    parts.push('The underlying policy context changed.')
  }

  // Engine change
  if (diff.engineChanged) {
    parts.push(`The strategy engine was upgraded.`)
  }

  return parts.join(' ')
}
