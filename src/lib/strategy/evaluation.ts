// Wayfinder — Deterministic Prediction-vs-Actual Evaluation (N0.4)
//
// This module evaluates the accuracy of Wayfinder's predictions against
// observed reality. It is the core analytical primitive for the "measured
// decision intelligence" layer.
//
// DESIGN PRINCIPLES:
//   - Deterministic — same inputs always produce the same result.
//   - Conservative — never invent precision. "Unknown" is a valid result.
//   - Structured — every evaluation produces a typed result with variance.
//   - No ML — this is measurement, not learning.
//
// The evaluator compares:
//   - Numeric predictions (timeline, cost) → exact variance
//   - Categorical predictions (viability, blocker resolution) → normalized comparison
//   - Qualitative predictions (effect descriptions) → categorical match
//
// Result statuses:
//   MATCHED            — prediction and actual agree
//   PARTIALLY_MATCHED  — prediction was partially correct
//   MISSED             — prediction was wrong
//   UNKNOWN            — actual is not yet known

// ---------------------------------------------------------------------------
// Evaluation result types
// ---------------------------------------------------------------------------

export type EvaluationStatus = 'MATCHED' | 'PARTIALLY_MATCHED' | 'MISSED' | 'UNKNOWN'

export interface NumericVariance {
  predicted: number
  actual: number
  /** (actual - predicted) — positive means actual was higher */
  delta: number
  /** |delta| / predicted — 0.0 means exact, 0.1 means 10% off */
  relativeDelta: number
}

export interface EvaluationResult {
  status: EvaluationStatus
  /** Human-readable explanation of the evaluation. */
  explanation: string
  /** Numeric variances (for numeric predictions). */
  numericVariances: NumericVariance[]
  /** Which dimensions were compared. */
  dimensionsCompared: string[]
}

// ---------------------------------------------------------------------------
// Numeric evaluation
// ---------------------------------------------------------------------------

/**
 * Evaluate a numeric prediction against an actual value.
 * Returns the variance + a MATCHED/PARTIALLY_MATCHED/MISSED status based
 * on the relative delta threshold.
 *
 * @param predicted The predicted value (from the original strategy)
 * @param actual The actual observed value
 * @param threshold The relative delta threshold for MATCHED (default 0.15 = 15%)
 * @param partialThreshold The threshold for PARTIALLY_MATCHED (default 0.40 = 40%)
 */
export function evaluateNumeric(
  predicted: number | null | undefined,
  actual: number | null | undefined,
  dimensionName: string,
  threshold = 0.15,
  partialThreshold = 0.40,
): { status: EvaluationStatus; variance: NumericVariance | null } {
  // If either value is unknown, we can't evaluate
  if (predicted == null || actual == null) {
    return { status: 'UNKNOWN', variance: null }
  }

  const delta = actual - predicted
  const relativeDelta = predicted !== 0 ? Math.abs(delta) / Math.abs(predicted) : Math.abs(delta)

  const variance: NumericVariance = {
    predicted,
    actual,
    delta,
    relativeDelta,
  }

  let status: EvaluationStatus
  if (relativeDelta <= threshold) {
    status = 'MATCHED'
  } else if (relativeDelta <= partialThreshold) {
    status = 'PARTIALLY_MATCHED'
  } else {
    status = 'MISSED'
  }

  return { status, variance }
}

// ---------------------------------------------------------------------------
// Boolean evaluation
// ---------------------------------------------------------------------------

/**
 * Evaluate a boolean prediction (e.g. "trajectory will be viable").
 * Returns MATCHED if both agree, MISSED if they disagree, UNKNOWN if
 * either is null.
 */
export function evaluateBoolean(
  predicted: boolean | null | undefined,
  actual: boolean | null | undefined,
): EvaluationStatus {
  if (predicted == null || actual == null) return 'UNKNOWN'
  return predicted === actual ? 'MATCHED' : 'MISSED'
}

// ---------------------------------------------------------------------------
// Categorical evaluation
// ---------------------------------------------------------------------------

/**
 * Evaluate a categorical prediction by normalizing both values and comparing.
 * Case-insensitive, trims whitespace, and treats null/undefined as UNKNOWN.
 */
export function evaluateCategorical(
  predicted: string | null | undefined,
  actual: string | null | undefined,
): EvaluationStatus {
  if (predicted == null || actual == null) return 'UNKNOWN'
  const normPredicted = predicted.trim().toLowerCase()
  const normActual = actual.trim().toLowerCase()
  if (normPredicted === normActual) return 'MATCHED'
  // Check for partial match (one contains the other)
  if (normPredicted.includes(normActual) || normActual.includes(normPredicted)) {
    return 'PARTIALLY_MATCHED'
  }
  return 'MISSED'
}

// ---------------------------------------------------------------------------
// Composite evaluation
// ---------------------------------------------------------------------------

/**
 * Composite evaluation result for an action outcome.
 * Compares predicted vs actual across all available dimensions.
 */
export interface ActionOutcomeEvaluation {
  overallStatus: EvaluationStatus
  dimensions: Array<{
    name: string
    status: EvaluationStatus
    variance?: NumericVariance
  }>
  explanation: string
}

/**
 * Evaluate an action outcome by comparing all predicted vs actual dimensions.
 * The overall status is the WORST dimension status (MISSED > PARTIALLY_MATCHED > MATCHED > UNKNOWN).
 */
export function evaluateActionOutcome(opts: {
  predictedEffect?: string | null
  actualEffect?: string | null
  predictedDurationMonths?: number | null
  actualDurationMonths?: number | null
  predictedCostUSD?: number | null
  actualCostUSD?: number | null
  predictedBlockerResolved?: boolean | null
  actualBlockerResolved?: boolean | null
}): ActionOutcomeEvaluation {
  const dimensions: ActionOutcomeEvaluation['dimensions'] = []

  // Effect comparison (categorical)
  if (opts.predictedEffect != null || opts.actualEffect != null) {
    const status = evaluateCategorical(opts.predictedEffect, opts.actualEffect)
    dimensions.push({ name: 'effect', status })
  }

  // Duration comparison (numeric)
  if (opts.predictedDurationMonths != null || opts.actualDurationMonths != null) {
    const { status, variance } = evaluateNumeric(opts.predictedDurationMonths, opts.actualDurationMonths, 'duration')
    dimensions.push({ name: 'duration', status, variance: variance ?? undefined })
  }

  // Cost comparison (numeric)
  if (opts.predictedCostUSD != null || opts.actualCostUSD != null) {
    const { status, variance } = evaluateNumeric(opts.predictedCostUSD, opts.actualCostUSD, 'cost')
    dimensions.push({ name: 'cost', status, variance: variance ?? undefined })
  }

  // Blocker resolution comparison (boolean)
  if (opts.predictedBlockerResolved != null || opts.actualBlockerResolved != null) {
    const status = evaluateBoolean(opts.predictedBlockerResolved, opts.actualBlockerResolved)
    dimensions.push({ name: 'blockerResolved', status })
  }

  // Overall status = worst dimension
  const overallStatus = computeOverallStatus(dimensions.map((d) => d.status))

  const explanation = buildExplanation(overallStatus, dimensions)

  return { overallStatus, dimensions, explanation }
}

/**
 * Composite evaluation result for a strategy outcome.
 */
export interface StrategyOutcomeEvaluation {
  overallStatus: EvaluationStatus
  dimensions: Array<{
    name: string
    status: EvaluationStatus
    variance?: NumericVariance
  }>
  explanation: string
}

/**
 * Evaluate a strategy outcome by comparing all predicted vs actual dimensions.
 */
export function evaluateStrategyOutcome(opts: {
  predictedTrajectoryViable?: boolean | null
  actualTrajectoryViable?: boolean | null
  predictedTimelineMonths?: number | null
  actualTimelineMonths?: number | null
  predictedTotalCostUSD?: number | null
  actualTotalCostUSD?: number | null
  strategyFollowed?: string | null
}): StrategyOutcomeEvaluation {
  const dimensions: StrategyOutcomeEvaluation['dimensions'] = []

  // Trajectory viability (boolean)
  if (opts.predictedTrajectoryViable != null || opts.actualTrajectoryViable != null) {
    const status = evaluateBoolean(opts.predictedTrajectoryViable, opts.actualTrajectoryViable)
    dimensions.push({ name: 'trajectoryViable', status })
  }

  // Timeline (numeric)
  if (opts.predictedTimelineMonths != null || opts.actualTimelineMonths != null) {
    const { status, variance } = evaluateNumeric(opts.predictedTimelineMonths, opts.actualTimelineMonths, 'timeline')
    dimensions.push({ name: 'timeline', status, variance: variance ?? undefined })
  }

  // Cost (numeric)
  if (opts.predictedTotalCostUSD != null || opts.actualTotalCostUSD != null) {
    const { status, variance } = evaluateNumeric(opts.predictedTotalCostUSD, opts.actualTotalCostUSD, 'cost')
    dimensions.push({ name: 'cost', status, variance: variance ?? undefined })
  }

  const overallStatus = computeOverallStatus(dimensions.map((d) => d.status))
  const explanation = buildExplanation(overallStatus, dimensions)

  return { overallStatus, dimensions, explanation }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STATUS_RANK: Record<EvaluationStatus, number> = {
  UNKNOWN: 0,
  MATCHED: 1,
  PARTIALLY_MATCHED: 2,
  MISSED: 3,
}

/**
 * Compute the overall status from a list of dimension statuses.
 * The overall status is the WORST (highest-rank) non-UNKNOWN status.
 * If ALL dimensions are UNKNOWN, the overall is UNKNOWN.
 */
function computeOverallStatus(statuses: EvaluationStatus[]): EvaluationStatus {
  const knownStatuses = statuses.filter((s) => s !== 'UNKNOWN')
  if (knownStatuses.length === 0) return 'UNKNOWN'
  return knownStatuses.reduce((worst, s) => STATUS_RANK[s] > STATUS_RANK[worst] ? s : worst)
}

function buildExplanation(overall: EvaluationStatus, dimensions: Array<{ name: string; status: EvaluationStatus; variance?: NumericVariance }>): string {
  if (overall === 'UNKNOWN') {
    return 'No actual observations recorded yet — evaluation is unknown.'
  }
  const matched = dimensions.filter((d) => d.status === 'MATCHED').map((d) => d.name)
  const partial = dimensions.filter((d) => d.status === 'PARTIALLY_MATCHED').map((d) => d.name)
  const missed = dimensions.filter((d) => d.status === 'MISSED').map((d) => d.name)

  const parts: string[] = []
  if (matched.length > 0) parts.push(`matched: ${matched.join(', ')}`)
  if (partial.length > 0) parts.push(`partially matched: ${partial.join(', ')}`)
  if (missed.length > 0) parts.push(`missed: ${missed.join(', ')}`)

  const prefix = overall === 'MATCHED' ? 'Prediction matched actual.' :
    overall === 'PARTIALLY_MATCHED' ? 'Prediction partially matched actual.' :
    'Prediction missed actual.'

  return `${prefix} ${parts.join('; ')}.`
}
