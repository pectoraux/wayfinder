// Wayfinder Counterfactual Engine — "What if?"
//
// Simulates a modified MobilityState, recomputes the plan, and reports what
// changed vs the baseline: newly eligible routes, newly blocked routes, and
// the score delta on the best route. Deterministic.

import type {
  MobilityState,
  Route,
  RouteScores,
  ScenarioResult,
  Intent,
} from '@/lib/domain/types'
import { generateRoutes, compositeUtility } from './routes'
import { rankRoutes } from './optimize'

// Re-export ScenarioResult so callers can import it from this module
// (it's defined in domain/types but historically imported from here).
export type { ScenarioResult } from '@/lib/domain/types'

export interface ScenarioSpec {
  id: string
  label: string
  deltaDescription: string
  /** Pure function returning a modified copy of the state. */
  modify: (s: MobilityState) => MobilityState
}

/** Deep clone helper that preserves the UserFact structure. */
export function cloneState(s: MobilityState): MobilityState {
  return JSON.parse(JSON.stringify(s))
}

export function runScenario(
  baselineState: MobilityState,
  intent: Intent,
  spec: ScenarioSpec,
  asOfDate?: string | Date,
  simulationMode: boolean = false,
): ScenarioResult {
  const modifiedState = spec.modify(cloneState(baselineState))

  const baselineRoutes = generateRoutes(baselineState, intent, asOfDate, simulationMode)
  const modifiedRoutes = generateRoutes(modifiedState, intent, asOfDate, simulationMode)

  const baselineBest = rankRoutes(baselineRoutes, intent)[0]
  const modifiedBest = rankRoutes(modifiedRoutes, intent)[0]

  const scoreDelta: Partial<RouteScores> = {}
  if (baselineBest && modifiedBest) {
    for (const k of Object.keys(baselineBest.scores) as (keyof RouteScores)[]) {
      const delta = modifiedBest.scores[k] - baselineBest.scores[k]
      if (delta !== 0) scoreDelta[k] = delta
    }
  }

  const newlyEligible = modifiedRoutes
    .filter((mr) => {
      const br = baselineRoutes.find((r) => r.id === mr.id)
      return br && br.eligibility.status !== 'eligible' && mr.eligibility.status === 'eligible'
    })
    .map((r) => r.id)

  const newlyBlocked = modifiedRoutes
    .filter((mr) => {
      const br = baselineRoutes.find((r) => r.id === mr.id)
      return br && br.eligibility.status !== 'ineligible' && mr.eligibility.status === 'ineligible'
    })
    .map((r) => r.id)

  // Summary
  const parts: string[] = []
  if (modifiedBest && baselineBest && modifiedBest.id !== baselineBest.id) {
    parts.push(`Best route shifts to ${modifiedBest.label}.`)
  } else if (modifiedBest) {
    const utilDelta = compositeUtility(modifiedBest.scores, intent) - (baselineBest ? compositeUtility(baselineBest.scores, intent) : 0)
    parts.push(`Best route stays ${modifiedBest.label}; composite utility ${utilDelta >= 0 ? '+' : ''}${utilDelta.toFixed(1)}.`)
  }
  if (newlyEligible.length) parts.push(`${newlyEligible.length} route(s) become newly eligible.`)
  if (newlyBlocked.length) parts.push(`${newlyBlocked.length} route(s) become blocked.`)

  // Insight: when nothing changed, explain WHY — usually the binding constraints
  // are third-party dependencies (employer offer, incubator, endorsement,
  // credential recognition) that personal upgrades don't address.
  if (parts.length === 1 && !newlyEligible.length && !newlyBlocked.length) {
    const thirdPartyBlockers = modifiedBest?.eligibility.blockers.filter((b) =>
      b.addressableVia.some((a) =>
        ['employer_offer', 'designated_incubator_support', 'endorsement', 'credential_recognition', 'sponsor'].includes(a.kind),
      ),
    ) ?? []
    if (thirdPartyBlockers.length > 0) {
      parts.push(`No shift — your binding constraints are ${thirdPartyBlockers.map((b) => b.label.toLowerCase()).join(', ')}, which a personal upgrade doesn't address. See the Enablers panel for legitimate unlocks.`)
    } else {
      parts.push(`No shift on the frontier — this change doesn't cross any eligibility threshold for your routes.`)
    }
  }

  return {
    id: spec.id,
    label: spec.label,
    deltaDescription: spec.deltaDescription,
    modifiedState,
    bestRouteId: modifiedBest?.id ?? '',
    scoreDelta,
    newlyEligibleRouteIds: newlyEligible,
    newlyBlockedRouteIds: newlyBlocked,
    summary: parts.join(' ') || 'No material change to the frontier.',
  }
}

/** Standard "What if?" scenarios offered to the user. */
export function defaultScenarios(state: MobilityState): ScenarioSpec[] {
  const scenarios: ScenarioSpec[] = []

  scenarios.push({
    id: 'sc-learn-german',
    label: 'If I learn German to B1',
    deltaDescription: 'Add German at B1 (CEFR) to your language profile.',
    modify: (s) => {
      const existing = s.languages.value.find((l) => l.language === 'de')
      if (existing && (existing.cefr === 'native' || cefrRank(existing.cefr) >= cefrRank('B1'))) return s
      s.languages = {
        ...s.languages,
        value: [...s.languages.value.filter((l) => l.language !== 'de'), { language: 'de', cefr: 'B1' }],
      }
      return s
    },
  })

  scenarios.push({
    id: 'sc-learn-german-c1',
    label: 'If I reach German C1',
    deltaDescription: 'Add German at C1 (CEFR) to your language profile.',
    modify: (s) => {
      s.languages = {
        ...s.languages,
        value: [...s.languages.value.filter((l) => l.language !== 'de'), { language: 'de', cefr: 'C1' }],
      }
      return s
    },
  })

  scenarios.push({
    id: 'sc-income-up',
    label: 'If I raise my income 30%',
    deltaDescription: `Increase annual income by 30% (from $${state.annualIncomeUSD.value ?? 0} to $${Math.round((state.annualIncomeUSD.value ?? 0) * 1.3)}).`,
    modify: (s) => {
      s.annualIncomeUSD = { ...s.annualIncomeUSD, value: Math.round((s.annualIncomeUSD.value ?? 0) * 1.3) }
      return s
    },
  })

  scenarios.push({
    id: 'sc-masters',
    label: 'If I get a master\'s degree',
    deltaDescription: 'Upgrade education to a master\'s degree.',
    modify: (s) => {
      s.education = { ...s.education, value: 'masters' }
      s.degrees = {
        ...s.degrees,
        value: [...s.degrees.value, { level: 'masters', field: 'Computer Science', country: s.currentCountry.value }],
      }
      return s
    },
  })

  scenarios.push({
    id: 'sc-savings-2x',
    label: 'If I double my savings',
    deltaDescription: 'Double available savings.',
    modify: (s) => {
      s.savingsUSD = { ...s.savingsUSD, value: (s.savingsUSD.value ?? 0) * 2 }
      return s
    },
  })

  scenarios.push({
    id: 'sc-start-business',
    label: 'If I start a business',
    deltaDescription: 'Become an active founder with a pre-revenue venture.',
    modify: (s) => {
      s.founderStatus = { ...s.founderStatus, value: 'active_founder' }
      s.businessStage = { ...s.businessStage, value: 'pre_revenue' }
      return s
    },
  })

  scenarios.push({
    id: 'sc-degree-recognized-de',
    label: 'If my degree is recognized in Germany',
    deltaDescription: 'Obtain official degree recognition in Germany (ZAB / Anabin).',
    modify: (s) => {
      const cur = s.credentialRecognizedIn.value
      s.credentialRecognizedIn = {
        ...s.credentialRecognizedIn,
        value: Array.from(new Set([...cur, 'DE'])),
      }
      return s
    },
  })

  return scenarios
}

function cefrRank(c: string): number {
  const r: Record<string, number> = { A1: 1, A2: 2, B1: 3, B2: 4, C1: 5, C2: 6, native: 7 }
  return r[c] ?? 0
}
