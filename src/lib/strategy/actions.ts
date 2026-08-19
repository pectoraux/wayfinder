// Wayfinder — Action Planner
//
// Turns blocker analysis + trajectory steps into a sequenced action plan.
// Actions are ordered by: impact on route viability, time sensitivity,
// dependency unlock, and reversibility.

import type { Trajectory, BlockerAnalysis, Action, ActionPlan, ActionTimeframe } from './types'

/** Build an action plan from a trajectory and its blockers. */
export function buildActionPlan(trajectory: Trajectory, blockers: BlockerAnalysis[]): ActionPlan {
  const actions: Action[] = []
  let actionIdx = 0

  // For each blocker, create one or more actions
  for (const blocker of blockers) {
    for (const unlock of blocker.unlocks) {
      const timeframe = timeframeFromMonths(unlock.estimatedMonths ?? 3)
      const impact = calculateImpact(blocker, trajectory)
      const timeSensitive = isTimeSensitive(blocker, trajectory)
      const dependsOn = findDependencies(blocker, blockers)

      actions.push({
        id: `act-${actionIdx++}`,
        title: unlock.label,
        description: unlock.description,
        timeframe,
        addressesBlockerId: blocker.blockerId,
        trajectoryStep: trajectory.steps.findIndex((s) => s.blockerLabels?.some((bl) => bl === blocker.label)) + 1,
        impact,
        timeSensitive,
        estimatedCostUSD: estimateCost(unlock.kind),
        reversible: isReversible(unlock.kind),
        dependsOn: dependsOn.length > 0 ? dependsOn : undefined,
      })
    }
  }

  // Add a "re-evaluate" action if there are blockers
  if (actions.length > 0) {
    actions.push({
      id: `act-${actionIdx++}`,
      title: 'Re-evaluate your route',
      description: 'After completing the above actions, re-run your mobility plan to see how your frontier has expanded.',
      timeframe: '90_DAYS',
      impact: 0.5,
      timeSensitive: false,
      reversible: true,
    })
  }

  // Sort by impact (desc), then time sensitivity (desc), then timeframe (asc)
  actions.sort((a, b) => {
    if (b.impact !== a.impact) return b.impact - a.impact
    if (b.timeSensitive !== a.timeSensitive) return b.timeSensitive ? 1 : -1
    return timeframeOrder(a.timeframe) - timeframeOrder(b.timeframe)
  })

  // The highest-leverage action is the one with the highest impact
  const highestLeverageAction = actions[0]

  const summary = actions.length === 0
    ? 'No blockers detected — you can proceed directly with your application.'
    : `${actions.length} action(s) to clear blockers and advance your trajectory. Start with: ${highestLeverageAction?.title ?? 'the first action'}.`

  return { actions, highestLeverageAction, summary }
}

function timeframeFromMonths(months: number): ActionTimeframe {
  if (months <= 1) return '7_DAYS'
  if (months <= 3) return '30_DAYS'
  if (months <= 6) return '90_DAYS'
  return '6_MONTHS'
}

function timeframeOrder(tf: ActionTimeframe): number {
  const order: Record<ActionTimeframe, number> = {
    '7_DAYS': 0, '30_DAYS': 1, '90_DAYS': 2, '6_MONTHS': 3, 'ONGOING': 4,
  }
  return order[tf] ?? 5
}

function calculateImpact(blocker: BlockerAnalysis, trajectory: Trajectory): number {
  // Higher impact if the blocker is on an early step and hard to resolve
  const stepImpact = blocker.difficulty === 'very_hard' ? 0.9 : blocker.difficulty === 'hard' ? 0.7 : blocker.difficulty === 'moderate' ? 0.5 : 0.3
  const trajectoryBoost = trajectory.viable ? 0.1 : 0.2 // more impactful if trajectory is currently blocked
  return Math.min(1, stepImpact + trajectoryBoost)
}

function isTimeSensitive(blocker: BlockerAnalysis, trajectory: Trajectory): boolean {
  // Time-sensitive if the blocker is on the first step (blocking entry)
  const firstStep = trajectory.steps[1]
  return firstStep?.blockerLabels?.includes(blocker.label) ?? false
}

function findDependencies(blocker: BlockerAnalysis, allBlockers: BlockerAnalysis[]): string[] {
  // If this blocker requires credential recognition first, and another blocker
  // is about the degree, this depends on that
  const deps: string[] = []
  if (blocker.label.toLowerCase().includes('employer') || blocker.label.toLowerCase().includes('offer')) {
    const degreeBlocker = allBlockers.find((b) => b.label.toLowerCase().includes('degree') || b.label.toLowerCase().includes('credential'))
    if (degreeBlocker) deps.push(degreeBlocker.blockerId)
  }
  return deps
}

function estimateCost(kind: string): number {
  const costs: Record<string, number> = {
    credential_recognition: 200,
    language_cert: 300,
    employer_offer: 0,
    incubator_support: 0,
    endorsement: 700,
    savings: 0,
    education: 15000,
    business_formation: 500,
    documentation: 100,
    policy_change: 0,
  }
  return costs[kind] ?? 0
}

function isReversible(kind: string): boolean {
  const irreversible = ['education', 'business_formation']
  return !irreversible.includes(kind)
}
