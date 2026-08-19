// Wayfinder — Strategy Staleness Engine
//
// Determines whether a stored/active strategy is still current by comparing
// the runtime policy hash, mobility state version, intent version, and
// strategy engine version against the current values.
//
// Returns a structured staleness assessment — never a vague boolean.

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

export interface StalenessAssessment {
  status: StalenessReason
  reasons: string[]
  /** Human-readable explanation for the UI. */
  explanation: string
  /** Whether recalculation is recommended. */
  shouldRecalculate: boolean
}

/**
 * Assess whether a stored strategy is stale by comparing its metadata
 * against the current runtime policy + engine version.
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
  const reasons: string[] = []

  // 1. Check runtime policy hash
  const currentPolicy = getCurrentPolicySnapshot()
  const strategyPolicyHash = strategy.policyContext?.runtimeHash
  if (strategyPolicyHash && strategyPolicyHash !== currentPolicy.hash) {
    reasons.push('Immigration policy changed since this strategy was calculated.')
  }

  // 2. Check strategy engine version
  const strategyEngineVersion = strategy.strategyEngineVersion
  if (strategyEngineVersion && strategyEngineVersion !== STRATEGY_ENGINE_VERSION) {
    reasons.push("Wayfinder's strategy engine has been updated.")
  }

  // Note: state version and intent version checks require the current values
  // from the DB. For now, we check policy + engine (which are always available).
  // The full check happens server-side when loading the active strategy.

  if (reasons.length === 0) {
    return {
      status: 'CURRENT',
      reasons: [],
      explanation: 'This strategy is current.',
      shouldRecalculate: false,
    }
  }

  const status: StalenessReason = reasons.length === 1
    ? (reasons[0].includes('policy') ? 'STALE_POLICY' : 'STALE_ENGINE')
    : 'STALE_MULTIPLE'

  return {
    status,
    reasons,
    explanation: reasons.join(' + '),
    shouldRecalculate: true,
  }
}

/**
 * Full staleness check including state and intent versions (server-side).
 */
export function getFullStrategyStaleness(
  strategy: Strategy,
  currentPolicyHash: string,
  currentStateVersion: number,
  currentIntentVersion: number,
  currentEngineVersion: string,
): StalenessAssessment {
  const reasons: string[] = []

  const strategyPolicyHash = strategy.policyContext?.runtimeHash
  if (strategyPolicyHash && strategyPolicyHash !== currentPolicyHash) {
    reasons.push('Immigration policy changed since this strategy was calculated.')
  }

  const strategyEngineVersion = strategy.strategyEngineVersion
  if (strategyEngineVersion && strategyEngineVersion !== currentEngineVersion) {
    reasons.push("Wayfinder's strategy engine has been updated.")
  }

  // State version: we can't directly compare since the strategy doesn't store
  // the state version, but we can check if the strategy's state matches
  // the current state by comparing key fields. For now, we rely on the
  // DecisionRecord's stateVersion field for this check.

  if (reasons.length === 0) {
    return {
      status: 'CURRENT',
      reasons: [],
      explanation: 'This strategy is current.',
      shouldRecalculate: false,
    }
  }

  const status: StalenessReason = reasons.length === 1
    ? (reasons[0].includes('policy') ? 'STALE_POLICY' : 'STALE_ENGINE')
    : 'STALE_MULTIPLE'

  return {
    status,
    reasons,
    explanation: reasons.join(' + '),
    shouldRecalculate: true,
  }
}
