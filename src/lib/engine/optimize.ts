// Wayfinder Optimization — recommendation, alternative-intent discovery,
// and the top-level plan assembly.
//
// Deterministic. The LLM opportunity/explanation agents run LATER to refine
// wording and surface nuance, but the ranking, blockers, and alternative
// intents here are produced by code over the engine outputs.

import type {
  AlternativeIntent,
  Intent,
  IntentGoal,
  MobilityState,
  MobilityPlan,
  Preference,
  Recommendation,
  Route,
  ScenarioResult,
} from '@/lib/domain/types'
import { POLICY_VERSION } from '@/lib/knowledge/policy-version'
import { getPolicySnapshot } from '@/lib/policy/snapshot'
import { computeFrontier } from './frontier'
import { compositeUtility, generateRoutes } from './routes'
import { runScenario, type ScenarioSpec } from './simulate'

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

export function rankRoutes(routes: Route[], intent: Intent): Route[] {
  const statusRank: Record<Route['eligibility']['status'], number> = {
    eligible: 0,
    conditional: 1,
    ineligible: 2,
  }
  return [...routes].sort((a, b) => {
    const sr = statusRank[a.eligibility.status] - statusRank[b.eligibility.status]
    if (sr !== 0) return sr
    const pareto = (b.paretoOptimal ? 1 : 0) - (a.paretoOptimal ? 1 : 0)
    if (pareto !== 0) return pareto
    return compositeUtility(b.scores, intent) - compositeUtility(a.scores, intent)
  })
}

// ---------------------------------------------------------------------------
// Recommendation
// ---------------------------------------------------------------------------

function topDimensions(scores: Route['scores'], n = 3): string[] {
  const entries = Object.entries(scores) as [keyof Route['scores'], number][]
  return entries
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k, v]) => `${labelFor(k)} ${v}`)
}

function labelFor(k: keyof Route['scores']): string {
  const m: Record<keyof Route['scores'], string> = {
    economicUpside: 'Economic upside',
    immigrationProbability: 'Immigration probability',
    speed: 'Speed',
    affordability: 'Affordability',
    longTermResidence: 'Long-term residence',
    citizenshipProspect: 'Citizenship prospect',
    familyUtility: 'Family utility',
    mobilityUpside: 'Mobility upside',
    optionality: 'Optionality',
    reversibility: 'Reversibility',
    riskAdjusted: 'Risk-adjusted',
  }
  return m[k]
}

function buildRecommendation(
  state: MobilityState,
  intent: Intent,
  ranked: Route[],
  alternativeIntents: AlternativeIntent[],
): Recommendation {
  const best = ranked[0]
  const rationale: string[] = []

  rationale.push(`Ranked first on composite utility under your stated priorities.`)
  rationale.push(...topDimensions(best.scores).map((d) => `Strong on: ${d}.`))
  if (best.paretoOptimal) {
    rationale.push(`Pareto-optimal — no other route improves on it without a trade-off.`)
  }
  if (best.eligibility.status === 'eligible') {
    rationale.push(`All hard requirements currently pass; this route is actionable now.`)
  } else if (best.eligibility.status === 'conditional') {
    rationale.push(`Conditional: ${best.eligibility.conditions.length} item(s) to confirm or secure.`)
  }

  const primaryBlocker = best.eligibility.blockers[0]
  const unlocks = primaryBlocker?.addressableVia.map((a) => a.label) ?? []
  const nextAction = primaryBlocker
    ? `${primaryBlocker.label}: ${primaryBlocker.addressableVia[0]?.description ?? 'address the requirement'}`
    : `Begin ${best.label}: gather documents and submit the application.`

  // Sensitivity assumptions — which facts, if changed, would alter the ranking
  const sensitivityAssumptions: string[] = []
  const second = ranked[1]
  if (second) {
    const gap = compositeUtility(best.scores, intent) - compositeUtility(second.scores, intent)
    if (gap < 6) {
      sensitivityAssumptions.push(`The margin over ${second.label} is small (~${gap.toFixed(1)} pts); a change in salary, language, or savings could swap the ranking.`)
    }
  }
  if (state.annualIncomeUSD.value != null && state.annualIncomeUSD.value < 61000) {
    sensitivityAssumptions.push(`If your maximum achievable offer salary is below ~$49k (shortage rate), Germany Blue Card falls out of reach.`)
  }
  if (!state.languages.value.some((l) => l.language === 'de')) {
    sensitivityAssumptions.push(`Adding German B2/C1 unlocks Chancenkarte points and the 21-month Blue Card PR fast-track.`)
  }

  const intentMayBeSuboptimal = alternativeIntents.some((a) => a.mayBeSuperior)

  return {
    bestRouteId: best.id,
    rationale,
    primaryBlocker: primaryBlocker?.label,
    unlocks,
    nextAction,
    sensitivityAssumptions,
    intentMayBeSuboptimal,
  }
}

// ---------------------------------------------------------------------------
// Alternative-intent discovery (deterministic seed; LLM refines wording)
// ---------------------------------------------------------------------------

const ALT_INTENT_TEMPLATES: { goal: IntentGoal; title: string; rationale: string; betterSatisfies: string[]; tradeoffs: string[]; priorities: Preference[] }[] = [
  {
    goal: 'maximize_income',
    title: 'Maximize near-term income (not just residence)',
    rationale: 'You are a high-earning remote software engineer. Optimizing for the largest near-term income step can outperform optimizing for the fastest entry.',
    betterSatisfies: ['income_priority', 'mobility_priority'],
    tradeoffs: ['May delay permanent residence by 1–2 years', 'Higher tax burden than some routes'],
    priorities: [
      { kind: 'income_priority', weight: 0.4 },
      { kind: 'mobility_priority', weight: 0.2 },
      { kind: 'safety_priority', weight: 0.15 },
      { kind: 'citizenship_priority', weight: 0.1 },
      { kind: 'family_stability', weight: 0.1 },
      { kind: 'entrepreneurship', weight: 0.05 },
    ],
  },
  {
    goal: 'second_citizenship',
    title: 'Optimize for the fastest second citizenship',
    rationale: 'A second passport compounds your mobility. Portugal and Canada offer 5-year citizenship clocks; Germany now offers 5/3-year naturalization.',
    betterSatisfies: ['citizenship_priority', 'mobility_priority'],
    tradeoffs: ['Longer horizon before payoff', 'Language requirement (PT A2 / DE B1)'],
    priorities: [
      { kind: 'citizenship_priority', weight: 0.4 },
      { kind: 'mobility_priority', weight: 0.25 },
      { kind: 'safety_priority', weight: 0.15 },
      { kind: 'income_priority', weight: 0.1 },
      { kind: 'family_stability', weight: 0.05 },
      { kind: 'entrepreneurship', weight: 0.05 },
    ],
  },
  {
    goal: 'maximize_mobility',
    title: 'Maximize global mobility & optionality',
    rationale: 'A second citizenship from a high-mobility country (DE/PT/CA passport ≈ 90+ visa-free) compounds every future option.',
    betterSatisfies: ['mobility_priority', 'citizenship_priority'],
    tradeoffs: ['Requires longer commitment', 'May forgo the highest immediate income'],
    priorities: [
      { kind: 'mobility_priority', weight: 0.4 },
      { kind: 'citizenship_priority', weight: 0.25 },
      { kind: 'income_priority', weight: 0.15 },
      { kind: 'safety_priority', weight: 0.2 },
    ],
  },
  {
    goal: 'safer_life_for_family',
    title: 'Optimize for family safety & stability',
    rationale: 'If family stability weighs more than income, a direct-to-PR route (Canada Express Entry) reduces status uncertainty.',
    betterSatisfies: ['safety_priority', 'family_stability'],
    tradeoffs: ['Lower immediate income than UAE/Germany', 'Higher settlement-funds requirement'],
    priorities: [
      { kind: 'safety_priority', weight: 0.35 },
      { kind: 'family_stability', weight: 0.25 },
      { kind: 'citizenship_priority', weight: 0.2 },
      { kind: 'income_priority', weight: 0.1 },
      { kind: 'mobility_priority', weight: 0.1 },
    ],
  },
]

export function discoverAlternativeIntents(
  state: MobilityState,
  intent: Intent,
  routes: Route[],
): AlternativeIntent[] {
  const baselineBest = rankRoutes(routes, intent)[0]
  const baselineUtility = baselineBest ? compositeUtility(baselineBest.scores, intent) : 0

  return ALT_INTENT_TEMPLATES.map((tpl) => {
    const altIntent: Intent = { ...intent, statedGoal: tpl.goal, priorities: tpl.priorities as Preference[] }
    const altRanked = rankRoutes(routes, altIntent)
    const altBest = altRanked[0]
    if (!altBest) {
      return { goal: tpl.goal, title: tpl.title, rationale: tpl.rationale, betterSatisfies: tpl.betterSatisfies, tradeoffs: tpl.tradeoffs, mayBeSuperior: false }
    }
    const altUtility = compositeUtility(altBest.scores, altIntent)
    // Superior if the best route under the alternative scores materially higher
    // under the user's OWN priorities than the baseline best, OR if a different
    // route becomes best and it dominates on mobility/citizenship.
    const margin = altUtility - baselineUtility
    const mayBeSuperior = margin > 4 || (altBest.id !== baselineBest?.id && altBest.scores.mobilityUpside > (baselineBest?.scores.mobilityUpside ?? 0) + 5)

    return {
      goal: tpl.goal,
      title: tpl.title,
      rationale: tpl.rationale,
      betterSatisfies: tpl.betterSatisfies,
      tradeoffs: tpl.tradeoffs,
      bestRouteId: altBest.id,
      mayBeSuperior,
    }
  }).filter((a) => a.goal !== intent.statedGoal)
}

// ---------------------------------------------------------------------------
// Top-level plan assembly
// ---------------------------------------------------------------------------

export function buildPlan(
  state: MobilityState,
  intent: Intent,
  scenarios: ScenarioSpec[] = [],
  asOfDate?: string | Date,
): MobilityPlan {
  const routes = generateRoutes(state, intent, asOfDate)
  const frontier = computeFrontier(routes, intent)
  const ranked = rankRoutes(routes, intent)
  const alternativeIntents = discoverAlternativeIntents(state, intent, routes)
  const recommendation = buildRecommendation(state, intent, ranked, alternativeIntents)

  const scenarioResults: ScenarioResult[] = scenarios.map((spec) => runScenario(state, intent, spec, asOfDate))

  const evidenceIds = Array.from(new Set(routes.flatMap((r) => r.evidenceIds)))

  let confidence: MobilityPlan['confidence'] = 'medium'
  if (routes.every((r) => r.eligibility.status === 'ineligible')) confidence = 'low'
  else if (ranked[0]?.eligibility.status === 'eligible') confidence = 'high'

  // Resolve the policy snapshot used, for reproducibility
  const effectiveAsOf = asOfDate ?? new Date().toISOString()
  const snapshot = getPolicySnapshot('global', effectiveAsOf)

  return {
    generatedAt: new Date().toISOString(),
    asOfDate: effectiveAsOf,
    policyVersion: snapshot.version,
    policyHash: snapshot.hash,
    policySnapshotId: snapshot.id,
    state,
    intent,
    routes: ranked,
    frontier,
    recommendation,
    alternativeIntents,
    enablerMatches: [], // populated by the enabler matcher in buildFullPlan
    scenarios: scenarioResults,
    evidenceIds,
    confidence,
  }
}
