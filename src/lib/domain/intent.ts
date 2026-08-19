// Wayfinder — Intent helpers + deterministic fallback parser.
//
// The LLM intent parser (src/lib/ai/intent-parser.ts) produces a structured
// Intent from free-form text. If the LLM is unavailable or returns an invalid
// schema, this deterministic parser is the fallback — Wayfinder never blocks on
// a model failure.

import type {
  Constraint,
  Intent,
  IntentGoal,
  IntentOutcome,
  Preference,
  ImplicitObjective,
  RiskTolerance,
} from './types'

const KEYWORD_MAP: { keywords: string[]; goal: IntentGoal }[] = [
  { keywords: ['start a company', 'start company', 'founder', 'entrepreneur', 'startup', 'build a company'], goal: 'start_company_abroad' },
  { keywords: ['study', 'master', 'phd', 'degree abroad', 'university'], goal: 'study_and_stay' },
  { keywords: ['citizenship', 'second passport', 'second citizenship', 'naturaliz'], goal: 'second_citizenship' },
  { keywords: ['safer', 'safety', 'family', 'secure', 'stable life'], goal: 'safer_life_for_family' },
  { keywords: ['earn more', 'income', 'salary', 'maximize income', 'higher pay'], goal: 'earn_more' },
  { keywords: ['mobility', 'travel freedom', 'freedom to travel', 'visa-free'], goal: 'maximize_mobility' },
  { keywords: ['remote', 'remote work', 'digital nomad', 'work remotely'], goal: 'remote_work_abroad' },
  { keywords: ['three years', 'few years', 'spend years', 'years abroad'], goal: 'spend_years_abroad' },
  { keywords: ['move', 'relocate', 'immigrate', 'emigrate', 'move abroad', 'leave'], goal: 'move_abroad_general' },
]

function detectGoal(text: string): IntentGoal {
  const t = text.toLowerCase()
  for (const { keywords, goal } of KEYWORD_MAP) {
    if (keywords.some((k) => t.includes(k))) return goal
  }
  return 'other'
}

function detectOutcomes(text: string, goal: IntentGoal): IntentOutcome[] {
  const t = text.toLowerCase()
  const outcomes: IntentOutcome[] = []
  if (/permanent|pr\b|settle/.test(t)) outcomes.push({ outcome: 'permanent_residence', horizon: 'mid' })
  if (/citizenship|passport/.test(t)) outcomes.push({ outcome: 'citizenship', horizon: 'long' })
  if (/company|founder|startup|business/.test(t)) outcomes.push({ outcome: 'company_formation', horizon: 'near' })
  if (/earn|income|salary|money/.test(t)) outcomes.push({ outcome: 'higher_income', horizon: 'near' })
  if (/travel|mobility|freedom/.test(t)) outcomes.push({ outcome: 'travel_freedom', horizon: 'long' })
  if (/family|safe|safety/.test(t)) outcomes.push({ outcome: 'family_safety', horizon: 'near' })
  if (outcomes.length === 0) {
    // infer from goal
    const map: Record<IntentGoal, IntentOutcome['outcome']> = {
      earn_more: 'higher_income',
      maximize_income: 'higher_income',
      start_company_abroad: 'company_formation',
      study_and_stay: 'education',
      second_citizenship: 'citizenship',
      safer_life_for_family: 'family_safety',
      maximize_mobility: 'travel_freedom',
      remote_work_abroad: 'residence',
      spend_years_abroad: 'residence',
      move_abroad_general: 'residence',
      other: 'residence',
    }
    outcomes.push({ outcome: map[goal], horizon: 'mid' })
  }
  return outcomes
}

function detectTimeHorizon(text: string): number | null {
  const t = text.toLowerCase()
  const m = t.match(/(\d+)\s*(year|yr|month)/)
  if (m) {
    const n = parseInt(m[1], 10)
    return m[2].startsWith('year') ? n * 12 : n
  }
  if (/within a year|this year|quickly|fast|soon/.test(t)) return 12
  if (/eventually|long.?term|long run/.test(t)) return 60
  return null
}

function detectImplicitObjectives(text: string): ImplicitObjective[] {
  const t = text.toLowerCase()
  const out: ImplicitObjective[] = []
  if (/earn more|income|salary/.test(t)) out.push({ objective: 'Maximize income', evidence: 'income mentioned', weight: 0.7 })
  if (/freedom|travel|mobility/.test(t)) out.push({ objective: 'Preserve travel freedom', evidence: 'freedom mentioned', weight: 0.65 })
  if (/eventually|long.?term/.test(t)) out.push({ objective: 'Long-term optionality', evidence: 'eventually mentioned', weight: 0.6 })
  if (/company|founder|startup/.test(t)) out.push({ objective: 'Entrepreneurship', evidence: 'company mentioned', weight: 0.6 })
  if (/permanent|settle|citizenship/.test(t)) out.push({ objective: 'Permanent residence / citizenship', evidence: 'terminal status mentioned', weight: 0.55 })
  return out
}

export function defaultPriorities(goal: IntentGoal): Preference[] {
  const base: Preference[] = [
    { kind: 'income_priority', weight: 0.18 },
    { kind: 'safety_priority', weight: 0.12 },
    { kind: 'citizenship_priority', weight: 0.12 },
    { kind: 'mobility_priority', weight: 0.15 },
    { kind: 'family_stability', weight: 0.1 },
    { kind: 'entrepreneurship', weight: 0.08 },
    { kind: 'education_value', weight: 0.05 },
  ]
  const boost: Partial<Record<IntentGoal, Preference['kind']>> = {
    earn_more: 'income_priority',
    maximize_income: 'income_priority',
    start_company_abroad: 'entrepreneurship',
    study_and_stay: 'education_value',
    second_citizenship: 'citizenship_priority',
    safer_life_for_family: 'family_stability',
    maximize_mobility: 'mobility_priority',
    remote_work_abroad: 'mobility_priority',
    spend_years_abroad: 'safety_priority',
    move_abroad_general: 'mobility_priority',
  }
  const k = boost[goal]
  if (k) {
    const p = base.find((p) => p.kind === k)
    if (p) p.weight += 0.2
  }
  return base
}

export function parseIntentDeterministic(rawInput: string): Intent {
  const goal = detectGoal(rawInput)
  const outcomes = detectOutcomes(rawInput, goal)
  const horizon = detectTimeHorizon(rawInput)
  const implicit = detectImplicitObjectives(rawInput)
  const constraints: Constraint[] = []
  if (horizon) constraints.push({ kind: 'time_horizon_months', value: String(horizon) })

  return {
    rawInput,
    statedGoal: goal,
    desiredOutcomes: outcomes,
    timeHorizonMonths: horizon,
    constraints,
    priorities: defaultPriorities(goal),
    riskTolerance: 'balanced',
    implicitObjectives: implicit,
    confidence: implicit.length > 0 ? 'medium' : 'low',
  }
}
