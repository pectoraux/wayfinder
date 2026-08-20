// Wayfinder — Server-Derived Action Predictions (N0.4b)
//
// This module derives prediction data from the EXACT historical strategy that
// generated a user action. The client NEVER provides prediction values —
// the server resolves them from the persisted DecisionRecord's strategy
// snapshot.
//
// DATA LINEAGE:
//   UserAction
//       ↓ (decisionRecordId)
//   DecisionRecord
//       ↓ (strategySnapshot)
//   Strategy
//       ↓ (actionPlan.actions)
//   Action (matched by actionId)
//       ↓
//   predictedEffect, predictedCostUSD, predictedDurationMonths, predictedBlockerResolved
//
// The prediction is frozen at the time of the historical DecisionRecord.
// It is NEVER recalculated from the current strategy.

import type { Strategy, Action } from '@/lib/strategy/types'
import type { ActionTimeframe } from '@/lib/strategy/types'

/** Convert an ActionTimeframe to an approximate month count for prediction. */
function timeframeToMonths(timeframe: ActionTimeframe): number | null {
  switch (timeframe) {
    case '7_DAYS': return 0.25
    case '30_DAYS': return 1
    case '90_DAYS': return 3
    case '6_MONTHS': return 6
    case 'ONGOING': return null // no prediction — ongoing
    default: return null
  }
}

/** The server-derived prediction for an action, extracted from the
 *  historical strategy snapshot. */
export interface ActionPrediction {
  /** The action's description (the predicted effect). */
  predictedEffect: string | null
  /** The action's estimated cost (predicted). */
  predictedCostUSD: number | null
  /** The action's timeframe converted to months (predicted). */
  predictedDurationMonths: number | null
  /** Whether the blocker this action addresses was predicted to be resolved. */
  predictedBlockerResolved: boolean | null
  /** The DecisionRecord ID this prediction was derived from. */
  decisionRecordId: string | null
}

/**
 * Derive the prediction for a specific action from a historical strategy
 * snapshot. Pure function — no I/O.
 *
 * @param strategy The historical strategy snapshot (from DecisionRecord.strategySnapshot)
 * @param actionId The actionId to find in the strategy's action plan
 * @param decisionRecordId The DecisionRecord ID (for provenance)
 */
export function deriveActionPrediction(
  strategy: Strategy | null,
  actionId: string,
  decisionRecordId: string | null,
): ActionPrediction {
  if (!strategy?.actionPlan?.actions) {
    return {
      predictedEffect: null,
      predictedCostUSD: null,
      predictedDurationMonths: null,
      predictedBlockerResolved: null,
      decisionRecordId,
    }
  }

  // Find the exact action in the historical strategy's action plan
  const action: Action | undefined = strategy.actionPlan.actions.find(
    (a) => a.id === actionId,
  )

  if (!action) {
    return {
      predictedEffect: null,
      predictedCostUSD: null,
      predictedDurationMonths: null,
      predictedBlockerResolved: null,
      decisionRecordId,
    }
  }

  // Derive predicted effect from the action's description
  const predictedEffect = action.description ?? null

  // Derive predicted cost from the action's estimatedCostUSD
  const predictedCostUSD = action.estimatedCostUSD ?? null

  // Derive predicted duration from the action's timeframe
  const predictedDurationMonths = timeframeToMonths(action.timeframe)

  // Derive predicted blocker resolution: if the action addresses a blocker,
  // the prediction is that completing this action will resolve that blocker.
  const predictedBlockerResolved = action.addressesBlockerId ? true : null

  return {
    predictedEffect,
    predictedCostUSD,
    predictedDurationMonths,
    predictedBlockerResolved,
    decisionRecordId,
  }
}

/**
 * Derive the prediction for a strategy outcome from a historical strategy
 * snapshot. Pure function — no I/O.
 *
 * @param strategy The historical strategy snapshot
 * @param decisionRecordId The DecisionRecord ID (for provenance)
 */
export function deriveStrategyPrediction(
  strategy: Strategy | null,
  decisionRecordId: string | null,
): {
  predictedTrajectoryViable: boolean | null
  predictedTimelineMonths: number | null
  predictedTotalCostUSD: number | null
  decisionRecordId: string | null
} {
  if (!strategy?.bestTrajectory) {
    return {
      predictedTrajectoryViable: null,
      predictedTimelineMonths: null,
      predictedTotalCostUSD: null,
      decisionRecordId,
    }
  }

  return {
    predictedTrajectoryViable: strategy.bestTrajectory.viable,
    predictedTimelineMonths: strategy.bestTrajectory.totalMonths ?? null,
    predictedTotalCostUSD: strategy.bestTrajectory.totalCostUSD ?? null,
    decisionRecordId,
  }
}
