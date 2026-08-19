// Wayfinder — Strategy Staleness Engine
//
// Determines whether a stored/active strategy is still current by comparing the
// runtime policy hash, mobility state version, intent version, and strategy
// engine version against the current values.
//
// Returns a structured staleness assessment — never a vague boolean.
//
// The rules are deterministic:
//   strategy.runtimeHash        !== currentPolicyHash     → STALE_POLICY
//   strategy.mobilityStateVersion !== currentStateVersion → STALE_PROFILE
//   strategy.intentVersion      !== currentIntentVersion  → STALE_INTENT
//   strategy.strategyEngineVersion !== currentEngineVersion → STALE_ENGINE
//
// Multiple mismatches → STALE_MULTIPLE.
// No mismatch → CURRENT.
//
// Never infer staleness from timestamps when exact versions are available.

import { STRATEGY_ENGINE_VERSION } from '@/lib/strategy/planning-context'
import { getCurrentPolicySnapshot } from '@/lib/policy/snapshot'
import type { Strategy } from '@/lib/strategy/types'

export type StalenessReason =
  | 'CURRENT'
  | 'STALE_POLICY'
  | 'STALE_PROFILE'
  | 'STALE_INTENT'
  | 'STALE_ENGINE'
  | 'STALE_MULTIPLE'

/**
 * Per-dimension mismatch flags. True = stale on that dimension.
 * This is the structured surface the UI renders against — never collapse to
 * a single boolean.
 */
export interface StalenessDimensions {
  policy: boolean
  profile: boolean
  intent: boolean
  engine: boolean
}

export interface StalenessAssessment {
  status: StalenessReason
  reasons: string[]
  /** Per-dimension flags. Useful for the UI to render specific banners. */
  dimensions: StalenessDimensions
  /** Human-readable explanation for the UI. */
  explanation: string
  /** Whether recalculation is recommended. */
  shouldRecalculate: boolean
}

/** Human-readable labels for each stale dimension (for the UI). */
export const STALENESS_LABELS: Record<Exclude<StalenessReason, 'CURRENT' | 'STALE_MULTIPLE'>, string> = {
  STALE_POLICY: 'Immigration policy changed',
  STALE_PROFILE: 'Your profile changed',
  STALE_INTENT: 'Your priorities changed',
  STALE_ENGINE: "Wayfinder's strategy engine changed",
}

const REASON_TEXT: Record<Exclude<StalenessReason, 'CURRENT' | 'STALE_MULTIPLE'>, string> = {
  STALE_POLICY: 'Immigration policy changed since this strategy was calculated.',
  STALE_PROFILE: 'Your profile changed since this strategy was calculated.',
  STALE_INTENT: 'Your priorities changed since this strategy was calculated.',
  STALE_ENGINE: "Wayfinder's strategy engine has been updated.",
}

/**
 * Build a StalenessAssessment from a set of per-dimension mismatch flags.
 * Pure function — no I/O. Used by both the client and server staleness checks
 * so they always agree on status derivation.
 */
export function deriveStalenessStatus(dimensions: StalenessDimensions): StalenessAssessment {
  const mismatchedDims: Exclude<StalenessReason, 'CURRENT' | 'STALE_MULTIPLE'>[] = []
  if (dimensions.policy) mismatchedDims.push('STALE_POLICY')
  if (dimensions.profile) mismatchedDims.push('STALE_PROFILE')
  if (dimensions.intent) mismatchedDims.push('STALE_INTENT')
  if (dimensions.engine) mismatchedDims.push('STALE_ENGINE')

  if (mismatchedDims.length === 0) {
    return {
      status: 'CURRENT',
      reasons: [],
      dimensions,
      explanation: 'This strategy is current.',
      shouldRecalculate: false,
    }
  }

  if (mismatchedDims.length === 1) {
    const dim = mismatchedDims[0]
    return {
      status: dim,
      reasons: [REASON_TEXT[dim]],
      dimensions,
      explanation: REASON_TEXT[dim],
      shouldRecalculate: true,
    }
  }

  const reasons = mismatchedDims.map((d) => REASON_TEXT[d])
  return {
    status: 'STALE_MULTIPLE',
    reasons,
    dimensions,
    explanation: reasons.join(' + '),
    shouldRecalculate: true,
  }
}

/**
 * Assess whether a stored strategy is stale by comparing its metadata
 * against the current runtime policy + engine version (client-side variant).
 *
 * State and intent version checks require the current values from the DB —
 * they are skipped here and performed server-side in getFullStrategyStaleness.
 *
 * @param strategy The stored strategy to check
 * @param currentStateVersion The user's current mobility state version
 * @param currentIntentVersion The user's current intent version
 * @returns Structured staleness assessment
 */
export function getStrategyStaleness(
  strategy: Strategy,
  currentStateVersion?: number,
  currentIntentVersion?: number,
): StalenessAssessment {
  const currentPolicy = getCurrentPolicySnapshot()
  const strategyPolicyHash = strategy.policyContext?.runtimeHash
  const strategyEngineVersion = strategy.strategyEngineVersion

  const dimensions: StalenessDimensions = {
    policy: Boolean(strategyPolicyHash) && strategyPolicyHash !== currentPolicy.hash,
    profile: currentStateVersion != null
      && strategy.mobilityStateVersion != null
      && strategy.mobilityStateVersion !== currentStateVersion,
    intent: currentIntentVersion != null
      && strategy.intentVersion != null
      && strategy.intentVersion !== currentIntentVersion,
    engine: Boolean(strategyEngineVersion) && strategyEngineVersion !== STRATEGY_ENGINE_VERSION,
  }

  return deriveStalenessStatus(dimensions)
}

/**
 * Full staleness check including state and intent versions (server-side).
 *
 * Compares ALL FOUR dimensions:
 *   strategy.policyContext.runtimeHash  !== currentPolicyHash     → STALE_POLICY
 *   strategy.mobilityStateVersion      !== currentStateVersion    → STALE_PROFILE
 *   strategy.intentVersion             !== currentIntentVersion   → STALE_INTENT
 *   strategy.strategyEngineVersion     !== currentEngineVersion   → STALE_ENGINE
 *
 * Multiple mismatches → STALE_MULTIPLE.
 * No mismatch → CURRENT.
 *
 * Never infer staleness from timestamps when exact versions are available.
 */
export function getFullStrategyStaleness(
  strategy: Strategy,
  currentPolicyHash: string,
  currentStateVersion: number,
  currentIntentVersion: number,
  currentEngineVersion: string,
): StalenessAssessment {
  const dimensions: StalenessDimensions = {
    policy: strategy.policyContext?.runtimeHash != null
      && strategy.policyContext.runtimeHash !== currentPolicyHash,
    profile: strategy.mobilityStateVersion != null
      && strategy.mobilityStateVersion !== currentStateVersion,
    intent: strategy.intentVersion != null
      && strategy.intentVersion !== currentIntentVersion,
    engine: strategy.strategyEngineVersion != null
      && strategy.strategyEngineVersion !== currentEngineVersion,
  }

  return deriveStalenessStatus(dimensions)
}
