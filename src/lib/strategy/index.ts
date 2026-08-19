// Wayfinder — Strategy Assembler
//
// Combines all intelligence modules into a single Strategy output:
//   trajectories + blockers + actions + profile analysis + intent frontier
//   + alternative intents + preference questions + uncertainty

import type { MobilityState, Intent, Route } from '@/lib/domain/types'
import type { Strategy, Trajectory, IntentFrontier, ObjectiveTrajectory, PreferenceQuestion, UncertaintyAssessment } from './types'
import type { CanonicalPlanningContext } from './planning-context'
import { STRATEGY_ENGINE_VERSION } from './planning-context'
import { buildTrajectories } from './trajectory'
import { analyzeBlockers } from './blockers'
import { buildActionPlan } from './actions'
import { analyzeProfile } from './profile'
import { generateRoutes, compositeUtility } from '@/lib/engine/routes'
import { rankRoutes } from '@/lib/engine/optimize'
import type { Preference } from '@/lib/domain/types'

/** Build the full strategy output from the user's state + intent + canonical context. */
export function buildStrategy(
  state: MobilityState,
  intent: Intent,
  routes: Route[],
  context?: CanonicalPlanningContext,
): Strategy {
  // 1. Build trajectories
  const trajectories = buildTrajectories(routes, state, intent)
  const viableTrajectories = trajectories.filter((t) => t.viable)
  const bestTrajectory = viableTrajectories[0] ?? trajectories[0]

  // 2. Analyze blockers on the best trajectory's source route
  const bestRoute = routes.find((r) => r.id === bestTrajectory?.sourceRouteId) ?? routes[0]
  const blockers = bestRoute ? analyzeBlockers(bestRoute, state) : []
  const allUnlocks = blockers.flatMap((b) => b.unlocks)

  // 3. Build action plan
  const actionPlan = buildActionPlan(bestTrajectory, blockers)

  // 4. Profile analysis
  const profileAnalysis = analyzeProfile(state, intent, routes)

  // 5. Intent frontier
  const intentFrontier = buildIntentFrontier(routes, intent, trajectories)

  // 6. Alternative intents (enhanced — derived from profile + opportunity set)
  const alternativeIntents = discoverEnhancedAlternativeIntents(state, intent, routes, profileAnalysis)

  // 7. Preference questions
  const preferenceQuestions = generatePreferenceQuestions(intent, routes, state)

  // 8. Uncertainty assessment
  const uncertainties = assessUncertainty(bestRoute, state)

  // 9. Strategy explanation
  const explanation = buildExplanation(bestTrajectory, blockers, profileAnalysis, intent)

  return {
    state,
    intent,
    bestTrajectory,
    alternativeTrajectories: trajectories.slice(1, 5),
    blockers,
    unlocks: allUnlocks,
    actionPlan,
    profileAnalysis,
    intentFrontier,
    alternativeIntents,
    preferenceQuestions,
    uncertainties,
    highestLeverageChange: profileAnalysis.highestLeverageChange,
    explanation,
    generatedAt: new Date().toISOString(),
    policyContext: context ? {
      baseSnapshotId: context.policyContext.baseSnapshotId,
      activeOverlayIds: context.policyContext.activeOverlayIds,
      runtimeVersionId: context.policyContext.runtimeVersionId,
      runtimeHash: context.policyContext.runtimeHash,
      asOf: context.policyContext.asOf,
      simulationMode: context.policyContext.simulationMode,
    } : undefined,
    strategyEngineVersion: STRATEGY_ENGINE_VERSION,
  }
}

/** Build the intent frontier: for each objective, the best trajectory. */
function buildIntentFrontier(routes: Route[], intent: Intent, trajectories: Trajectory[]): IntentFrontier {
  const objectives: { objective: string; label: string; priorities: Preference[] }[] = [
    { objective: 'income', label: 'Maximize income', priorities: [{ kind: 'income_priority', weight: 0.5 }, { kind: 'mobility_priority', weight: 0.2 }, { kind: 'safety_priority', weight: 0.1 }] },
    { objective: 'residence', label: 'Best residence trajectory', priorities: [{ kind: 'safety_priority', weight: 0.3 }, { kind: 'citizenship_priority', weight: 0.2 }, { kind: 'family_stability', weight: 0.2 }] },
    { objective: 'citizenship', label: 'Fastest citizenship', priorities: [{ kind: 'citizenship_priority', weight: 0.5 }, { kind: 'mobility_priority', weight: 0.2 }] },
    { objective: 'entrepreneurship', label: 'Best for founders', priorities: [{ kind: 'entrepreneurship', weight: 0.4 }, { kind: 'mobility_priority', weight: 0.2 }, { kind: 'income_priority', weight: 0.15 }] },
    { objective: 'mobility', label: 'Maximize global mobility', priorities: [{ kind: 'mobility_priority', weight: 0.4 }, { kind: 'citizenship_priority', weight: 0.25 }] },
    { objective: 'cost', label: 'Lowest cost', priorities: [{ kind: 'income_priority', weight: 0.1 }, { kind: 'safety_priority', weight: 0.15 }] },
  ]

  const points: ObjectiveTrajectory[] = objectives.map((obj) => {
    const altIntent: Intent = { ...intent, priorities: obj.priorities }
    const ranked = rankRoutes(routes, altIntent)
    const bestRoute = ranked[0]
    const bestTrajectory = trajectories.find((t) => t.sourceRouteId === bestRoute?.id) ?? trajectories[0]

    return {
      objective: obj.objective,
      objectiveLabel: obj.label,
      bestTrajectoryId: bestTrajectory?.id ?? '',
      bestTrajectoryLabel: bestTrajectory?.label ?? '',
      cost: bestRoute?.totalCostUSD ?? 0,
      timeMonths: bestTrajectory?.totalMonths ?? 0,
      risk: bestRoute?.risk ?? 'medium',
      optionality: bestTrajectory?.downstreamOptionality ?? 0,
      isStated: obj.objective === intent.statedGoal,
    }
  })

  // Find distinct strategies (genuinely different best routes)
  const distinctRouteIds = new Set(points.map((p) => p.bestTrajectoryId))
  const distinctStrategies = points.filter((p) => distinctRouteIds.has(p.bestTrajectoryId))

  return { points, distinctStrategies: Array.from(new Set(points.map((p) => p.bestTrajectoryId))).map((id) => points.find((p) => p.bestTrajectoryId === id)!).filter(Boolean) }
}

/** Enhanced alternative intent discovery — dynamic, based on profile + opportunity set. */
function discoverEnhancedAlternativeIntents(
  state: MobilityState,
  intent: Intent,
  routes: Route[],
  profile: ReturnType<typeof analyzeProfile>,
): { title: string; rationale: string; tradeoffs: string[]; mayBeSuperior: boolean }[] {
  const alternatives: { title: string; rationale: string; tradeoffs: string[]; mayBeSuperior: boolean }[] = []
  const baselineBest = rankRoutes(routes, intent)[0]
  const baselineUtility = baselineBest ? compositeUtility(baselineBest.scores, intent) : 0

  // Dynamic alternatives based on what the profile analysis reveals
  if (profile.highestLeverageChange) {
    const change = profile.highestLeverageChange
    alternatives.push({
      title: `Optimize for: ${change.label}`,
      rationale: `The single change that expands your mobility frontier most is ${change.label.toLowerCase()}. ${change.description} This would open ${change.newRoutesOpened} new route(s).`,
      tradeoffs: ['Requires personal investment (time/effort)', 'May delay relocation by months'],
      mayBeSuperior: change.newRoutesOpened > 0,
    })
  }

  // If the user has remote income, suggest the D7 / digital nomad path
  if (state.remoteWorkEligible.value === true && intent.statedGoal !== 'remote_work_abroad') {
    const d7Route = routes.find((r) => r.entryPathwayId.includes('d7') || r.entryPathwayId.includes('virtual'))
    if (d7Route && d7Route.id !== baselineBest?.id) {
      alternatives.push({
        title: 'Use your remote income for a low-friction entry',
        rationale: 'Your remote work capability opens routes that don\'t require employer sponsorship — potentially faster and cheaper entry.',
        tradeoffs: ['May not lead directly to PR', 'Income must be recurring and demonstrable'],
        mayBeSuperior: true,
      })
    }
  }

  // If the user is a founder, suggest startup visa paths
  if ((state.founderStatus.value === 'aspiring' || state.founderStatus.value === 'active_founder') && intent.statedGoal !== 'start_company_abroad') {
    const startupRoute = routes.find((r) => r.entryPathwayId.includes('startup'))
    if (startupRoute && startupRoute.id !== baselineBest?.id) {
      alternatives.push({
        title: 'Pursue a founder/startup visa route',
        rationale: 'Your founder status opens dedicated startup visa pathways that may offer better long-term optionality than a skilled-worker route.',
        tradeoffs: ['Requires a qualifying business plan', 'Incubator/endorsement may be needed'],
        mayBeSuperior: true,
      })
    }
  }

  // If the user's best route has a long timeline, suggest faster alternatives
  if (baselineBest && baselineBest.totalMonths > 48) {
    const fasterRoute = routes.find((r) => r.totalMonths < baselineBest.totalMonths && r.eligibility.status !== 'ineligible')
    if (fasterRoute) {
      alternatives.push({
        title: `Consider a faster route: ${fasterRoute.label}`,
        rationale: `Your current best route takes ~${Math.round(baselineBest.totalMonths / 12)} years. ${fasterRoute.label} reaches a similar destination in ~${Math.round(fasterRoute.totalMonths / 12)} years.`,
        tradeoffs: ['May have lower long-term optionality', 'Different country may have different culture/language'],
        mayBeSuperior: false,
      })
    }
  }

  // If the user cares about citizenship, suggest the fastest citizenship path
  if (intent.priorities.some((p) => p.kind === 'citizenship_priority' && p.weight > 0.15)) {
    const citRoute = routes.find((r) => r.futureOptions.some((f) => f.toLowerCase().includes('citizenship')))
    if (citRoute && citRoute.id !== baselineBest?.id) {
      alternatives.push({
        title: `Optimize for citizenship: ${citRoute.label}`,
        rationale: 'If citizenship is a priority, this route offers a faster or more certain path to a second passport.',
        tradeoffs: ['May require language learning', 'May have lower immediate income'],
        mayBeSuperior: true,
      })
    }
  }

  return alternatives
}

/** Generate high-value preference questions that change the decision frontier. */
function generatePreferenceQuestions(intent: Intent, routes: Route[], state: MobilityState): PreferenceQuestion[] {
  const questions: PreferenceQuestion[] = []

  // Q1: Income vs residence tradeoff
  const hasHighIncomeRoute = routes.some((r) => r.scores.economicUpside > 70)
  const hasStrongResidenceRoute = routes.some((r) => r.scores.longTermResidence > 70)
  if (hasHighIncomeRoute && hasStrongResidenceRoute) {
    questions.push({
      id: 'pq-income-vs-residence',
      question: 'Would you trade 20% of income for a much stronger path to permanent residence?',
      dimension: 'income_priority vs safety_priority',
      rationale: 'Your highest-income route and your strongest-residence route are different. Your answer changes which one ranks first.',
      options: [
        { label: 'Yes, residence matters more', value: 'residence', implications: 'Boosts safety_priority and citizenship_priority; may shift best route.' },
        { label: 'No, income matters more', value: 'income', implications: 'Keeps income_priority high; current ranking likely unchanged.' },
        { label: 'They\'re equally important', value: 'balanced', implications: 'Maintains current balanced ranking.' },
      ],
      affectedRouteIds: routes.filter((r) => r.scores.economicUpside > 70 || r.scores.longTermResidence > 70).map((r) => r.id),
    })
  }

  // Q2: Speed vs optionality
  const fastRoute = routes.find((r) => r.totalMonths < 24)
  const highOptionalityRoute = routes.find((r) => r.scores.optionality > 60)
  if (fastRoute && highOptionalityRoute && fastRoute.id !== highOptionalityRoute.id) {
    questions.push({
      id: 'pq-speed-vs-optionality',
      question: 'Is your priority to move quickly, or maximize long-term options?',
      dimension: 'speed vs optionality',
      rationale: 'The fastest route and the highest-optionality route are different. This affects whether you optimize for entry speed or future flexibility.',
      options: [
        { label: 'Move quickly', value: 'speed', implications: 'Favors routes with faster processing times.' },
        { label: 'Maximize options', value: 'optionality', implications: 'Favors routes with more downstream transitions.' },
      ],
      affectedRouteIds: [fastRoute.id, highOptionalityRoute.id],
    })
  }

  // Q3: Study-first question (if user has bachelor's but not master's)
  if (state.education.value === 'bachelors' && intent.statedGoal !== 'study_and_stay') {
    const studyBenefitRoutes = routes.filter((r) => r.eligibility.conditions.some((c) => c.toLowerCase().includes('master') || c.toLowerCase().includes('education')))
    if (studyBenefitRoutes.length > 0) {
      questions.push({
        id: 'pq-study-first',
        question: 'Would you consider studying first if it materially improves your future mobility?',
        dimension: 'education_value',
        rationale: 'A master\'s degree could unlock additional routes and improve your points score. This changes whether education routes enter your frontier.',
        options: [
          { label: 'Yes, I\'d study', value: 'study', implications: 'Opens education-based routes with post-study work rights.' },
          { label: 'No, I want to work directly', value: 'work', implications: 'Keeps focus on skilled-worker and entrepreneur routes.' },
        ],
        affectedRouteIds: studyBenefitRoutes.map((r) => r.id),
      })
    }
  }

  return questions.slice(0, 3) // max 3 questions
}

/** Assess per-dimension uncertainty. */
function assessUncertainty(bestRoute: Route | undefined, _state: MobilityState): UncertaintyAssessment[] {
  if (!bestRoute) return []
  return [
    {
      dimension: 'Legal eligibility',
      confidence: bestRoute.eligibility.status === 'eligible' ? 'HIGH' : bestRoute.eligibility.status === 'conditional' ? 'MEDIUM' : 'LOW',
      reason: bestRoute.eligibility.status === 'eligible'
        ? 'All hard requirements pass against the current policy snapshot.'
        : `${bestRoute.eligibility.conditions.length} condition(s) remain to be verified.`,
    },
    {
      dimension: 'Processing time',
      confidence: 'MEDIUM',
      reason: 'Processing times vary by consulate, season, and application complexity. Estimates are planning approximations.',
    },
    {
      dimension: 'Policy stability',
      confidence: bestRoute.risk === 'low' ? 'HIGH' : bestRoute.risk === 'medium' ? 'MEDIUM' : 'LOW',
      reason: bestRoute.risk === 'low' ? 'This route has low historical policy volatility.' : 'This route has experienced policy changes.',
    },
    {
      dimension: 'Real-world approval outcome',
      confidence: 'UNKNOWN',
      reason: 'Wayfinder cannot predict individual approval decisions. Eligibility ≠ approval. Individual circumstances, documentation quality, and consular discretion all affect outcomes.',
    },
  ]
}

/** Build the deterministic strategy explanation. */
function buildExplanation(
  bestTrajectory: Trajectory | undefined,
  blockers: ReturnType<typeof analyzeBlockers>,
  profile: ReturnType<typeof analyzeProfile>,
  intent: Intent,
): string {
  if (!bestTrajectory) return 'No viable trajectory found for your current profile.'

  const parts: string[] = []

  // Why this trajectory
  parts.push(`Your best trajectory is ${bestTrajectory.label}.`)
  if (bestTrajectory.viable) {
    parts.push('This trajectory is currently viable — you meet the entry requirements.')
  } else {
    const userBlockers = blockers.filter((b) => b.category === 'USER_CONTROLLED')
    const thirdPartyBlockers = blockers.filter((b) => b.category === 'THIRD_PARTY')
    if (userBlockers.length > 0) parts.push(`${userBlockers.length} blocker(s) are within your control.`)
    if (thirdPartyBlockers.length > 0) parts.push(`${thirdPartyBlockers.length} blocker(s) require a third party (employer, incubator, etc.).`)
  }

  // Optionality
  if (bestTrajectory.downstreamOptionality > 2) {
    parts.push(`This trajectory preserves ${bestTrajectory.downstreamOptionality} downstream options — high optionality.`)
  }

  // Profile insight
  if (profile.highestLeverageChange) {
    parts.push(`The single change that would expand your frontier most: ${profile.highestLeverageChange.label}.`)
  }

  // Time horizon
  parts.push(`Total estimated time to destination: ~${Math.round(bestTrajectory.totalMonths / 12)} years.`)

  return parts.join(' ')
}
