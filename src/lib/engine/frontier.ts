// Wayfinder Frontier — Pareto-optimal trajectory space.
//
// We do NOT reduce every route to one score. The frontier is the set of
// non-dominated routes across the dimensions the user cares about. Routes on
// the frontier cannot be improved in one dimension without sacrificing another.

import type { MobilityFrontier, Route, RouteScores } from '@/lib/domain/types'
import type { Intent } from '@/lib/domain/types'

/** Dimensions where "higher is better" — used for Pareto dominance. */
const ALL_DIMS: (keyof RouteScores)[] = [
  'economicUpside',
  'immigrationProbability',
  'speed',
  'affordability',
  'longTermResidence',
  'citizenshipProspect',
  'familyUtility',
  'mobilityUpside',
  'optionality',
  'reversibility',
  'riskAdjusted',
]

/** Pick the dimensions to dominate on, based on stated priorities. Falls back
 *  to a sensible default set (probability + upside + residence + citizenship). */
export function selectParetoDimensions(intent: Intent): (keyof RouteScores)[] {
  const dims = new Set<keyof RouteScores>(['immigrationProbability', 'longTermResidence'])
  for (const p of intent.priorities) {
    switch (p.kind) {
      case 'income_priority': dims.add('economicUpside'); break
      case 'mobility_priority': dims.add('mobilityUpside'); break
      case 'citizenship_priority': dims.add('citizenshipProspect'); break
      case 'safety_priority': dims.add('riskAdjusted'); break
      case 'family_stability': dims.add('familyUtility'); break
      case 'entrepreneurship': dims.add('optionality'); break
      case 'education_value': dims.add('longTermResidence'); break
    }
  }
  if (dims.size < 3) {
    dims.add('economicUpside')
    dims.add('citizenshipProspect')
  }
  return Array.from(dims)
}

function dominates(a: RouteScores, b: RouteScores, dims: (keyof RouteScores)[]): boolean {
  // a dominates b if a >= b on all dims and strictly > on at least one
  let strictlyGreater = false
  for (const d of dims) {
    if (a[d] < b[d]) return false
    if (a[d] > b[d]) strictlyGreater = true
  }
  return strictlyGreater
}

export function computeFrontier(routes: Route[], intent: Intent): MobilityFrontier {
  const dims = selectParetoDimensions(intent)
  const eligibleRoutes = routes.filter((r) => r.eligibility.status !== 'ineligible')

  const paretoOptimalRouteIds: string[] = []

  for (const r of eligibleRoutes) {
    let dominated = false
    for (const other of eligibleRoutes) {
      if (other.id === r.id) continue
      if (dominates(other.scores, r.scores, dims)) {
        dominated = true
        break
      }
    }
    if (!dominated) paretoOptimalRouteIds.push(r.id)
  }

  const points = routes.map((r) => ({
    routeId: r.id,
    label: r.label,
    dimensions: r.scores,
    paretoOptimal: paretoOptimalRouteIds.includes(r.id),
  }))

  // Mark paretoOptimal on routes (mutate for convenience)
  for (const r of routes) {
    r.paretoOptimal = paretoOptimalRouteIds.includes(r.id)
  }

  return { points, paretoDimensions: dims, paretoOptimalRouteIds }
}
