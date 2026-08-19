// Wayfinder — Trajectory Engine
//
// Turns single-program routes into multi-step legal trajectories. A trajectory
// spans the full path: current state → entry status → intermediate statuses →
// final destination (PR / citizenship). It can also model multi-country paths.
//
// The trajectory engine uses the existing MobilityGraph to discover downstream
// transitions and calculate optionality (how many future options remain).

import type { Route, MobilityState, Intent, CountryCode } from '@/lib/domain/types'
import type { Trajectory, TrajectoryStep } from './types'
import { buildGraph, getTransitions, getReachableStatuses } from '@/lib/graph/mobility-graph'
import { getCountry } from '@/lib/knowledge/countries'
import { COUNTRIES } from '@/lib/knowledge/countries'

/** Build trajectories from routes. Each route becomes a trajectory with its
 *  downstream transitions expanded into steps. */
export function buildTrajectories(routes: Route[], state: MobilityState, intent: Intent): Trajectory[] {
  const trajectories: Trajectory[] = []

  for (const route of routes) {
    if (route.eligibility.status === 'ineligible') continue

    const trajectory = routeToTrajectory(route, state, intent)
    if (trajectory) trajectories.push(trajectory)
  }

  // Also discover cross-country trajectories (e.g., EU entry → PR → citizenship
  // in a different EU country). For now, we model these as extensions of
  // existing trajectories that end in PR or citizenship.
  const crossCountry = discoverCrossCountryTrajectories(trajectories, state, intent)
  trajectories.push(...crossCountry)

  return trajectories
}

/** Convert a single route into a multi-step trajectory. */
function routeToTrajectory(route: Route, state: MobilityState, _intent: Intent): Trajectory | null {
  const steps: TrajectoryStep[] = []
  const blockedSet = new Set(route.eligibility.blockers.map((b) => b.requirementId))

  // Step 0: Current state
  steps.push({
    order: 0,
    countryCode: state.currentCountry.value as CountryCode,
    countryName: getCountry(state.currentCountry.value)?.name ?? state.currentCountry.value,
    status: 'Current state',
    description: `Apply for ${route.label.split('·')[1]?.trim() ?? route.label} from your current country.`,
    durationMonths: route.steps[0]?.durationMonths ?? 0,
    requirements: route.steps[0]?.conditions ?? [],
    evidenceIds: route.steps[0]?.evidenceIds ?? [],
    blocked: false,
  })

  // Step 1+: Route steps
  for (let i = 1; i < route.steps.length; i++) {
    const rs = route.steps[i]
    const isBlocked = rs.blocked
    const step: TrajectoryStep = {
      order: i,
      countryCode: route.countryCode as CountryCode,
      countryName: route.countryName,
      status: rs.status,
      description: rs.description,
      durationMonths: rs.durationMonths,
      requirements: rs.conditions,
      evidenceIds: rs.evidenceIds,
      blocked: isBlocked,
      blockerLabels: rs.blockerLabels,
    }
    steps.push(step)
  }

  // Calculate optionality: how many downstream statuses are reachable from the
  // final step's status?
  const finalStep = steps[steps.length - 1]
  let downstreamOptionality = 0
  try {
    const graph = buildGraph('snap-2024-11')
    const finalStatusId = statusLabelToId(finalStep.status, route.countryCode)
    if (finalStatusId) {
      const reachable = getReachableStatuses(graph, finalStatusId)
      downstreamOptionality = reachable.size
    }
  } catch {
    // Graph may not have this status — optionality = 0
  }

  // Calculate totals
  const totalMonths = steps.reduce((sum, s) => sum + s.durationMonths, 0)
  const totalCostUSD = route.totalCostUSD
  const countries = Array.from(new Set(steps.map((s) => s.countryCode)))
  const multiCountry = countries.length > 1

  // Reversibility: if all steps are reversible, high; if any is not, low
  const anyIrreversible = route.steps.some((s, i) => i > 0 && !s.conditions?.some((c) => c.includes('reversible')))
  const reversibility = anyIrreversible ? 'low' : route.reversible ? 'high' : 'medium'

  const viable = !steps[1]?.blocked

  return {
    id: `traj-${route.id}`,
    label: route.label,
    steps,
    totalMonths,
    totalCostUSD,
    countries,
    multiCountry,
    destinationStatus: finalStep.status,
    downstreamOptionality,
    reversibility,
    risk: route.risk,
    sourceRouteId: route.id,
    viable,
    rationale: buildTrajectoryRationale(route, downstreamOptionality, viable),
  }
}

/** Discover cross-country trajectories (e.g., EU entry → later move to another
 *  EU country). These are built by extending trajectories that end in PR. */
function discoverCrossCountryTrajectories(
  trajectories: Trajectory[],
  _state: MobilityState,
  _intent: Intent,
): Trajectory[] {
  const crossCountry: Trajectory[] = []

  for (const traj of trajectories) {
    // Only extend trajectories that reach PR or citizenship
    if (!/permanent|settlement|ilr|citizenship/i.test(traj.destinationStatus)) continue

    // Find other countries in the same region (EU → EU, etc.)
    const originCountry = getCountry(traj.countries[0])
    if (!originCountry) continue

    const sameRegion = COUNTRIES.filter(
      (c) => c.code !== traj.countries[0] && c.region === originCountry.region && c.code !== 'KE',
    )

    for (const dest of sameRegion.slice(0, 2)) {
      // Create a cross-country extension: after PR in country A, the user
      // gains mobility within the region (e.g., EU freedom of movement)
      const extendedSteps = [...traj.steps]
      extendedSteps.push({
        order: traj.steps.length,
        countryCode: dest.code as CountryCode,
        countryName: dest.name,
        status: 'Regional mobility (post-PR)',
        description: `After obtaining permanent residence in ${originCountry.name}, EU freedom of movement enables residence in ${dest.name} without a separate visa.`,
        durationMonths: 0,
        requirements: ['Permanent residence in origin country'],
        evidenceIds: [],
        blocked: false,
      })

      crossCountry.push({
        ...traj,
        id: `${traj.id}-x-${dest.code}`,
        label: `${traj.label} → ${dest.name} (post-PR mobility)`,
        steps: extendedSteps,
        countries: [...traj.countries, dest.code as CountryCode],
        multiCountry: true,
        destinationStatus: 'Regional mobility',
        downstreamOptionality: traj.downstreamOptionality + 3, // more options after cross-country move
        rationale: `After PR in ${originCountry.name}, you gain ${originCountry.region === 'EU' ? 'EU freedom of movement' : 'regional mobility'}, opening ${dest.name} without a separate visa.`,
        viable: traj.viable,
      })
    }
  }

  return crossCountry
}

/** Map a status label (e.g. "Settlement permit (PR)") to a status id. */
function statusLabelToId(label: string, countryCode: string): string | null {
  const lower = label.toLowerCase()
  if (lower.includes('citizenship')) return `${countryCode.toLowerCase()}-citizenship`
  if (lower.includes('permanent') || lower.includes('settlement') || lower.includes('ilr')) return `${countryCode.toLowerCase()}-settlement`
  if (lower.includes('blue card')) return 'de-blue-card-residence'
  if (lower.includes('chancenkarte')) return 'de-chancenkarte'
  if (lower.includes('d7')) return 'pt-d7-residence'
  if (lower.includes('d2') || lower.includes('startup')) return 'pt-startup-residence'
  if (lower.includes('express entry') || lower.includes('landed')) return 'ca-pr'
  if (lower.includes('startup visa') && countryCode === 'CA') return 'ca-pr'
  if (lower.includes('global talent')) return 'uk-global-talent'
  if (lower.includes('ilr')) return 'uk-ilr'
  if (lower.includes('virtual work')) return 'ae-virtual-work'
  if (lower.includes('startup') && countryCode === 'EE') return 'ee-startup-residence'
  return null
}

function buildTrajectoryRationale(route: Route, optionality: number, viable: boolean): string {
  const parts: string[] = []
  if (route.paretoOptimal) parts.push('Pareto-optimal — no other route improves on it without a trade-off.')
  if (route.eligibility.status === 'eligible') parts.push('All hard requirements currently pass — actionable now.')
  else if (route.eligibility.status === 'conditional') parts.push(`${route.eligibility.conditions.length} condition(s) to clear before this route is viable.`)
  if (optionality > 2) parts.push(`${optionality} downstream options after the initial step — high optionality.`)
  if (optionality === 0) parts.push('Limited downstream options after the initial step.')
  if (!viable) parts.push('Currently blocked — see blocker analysis for unlocks.')
  return parts.join(' ') || 'A viable mobility trajectory.'
}
