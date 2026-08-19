// Wayfinder — Profile Value Analyzer
//
// Analyzes the user's mobility profile to identify:
//   1. Highest-leverage current assets (what's most valuable about the user)
//   2. Biggest gaps (what's missing that would expand the frontier)
//   3. The single highest-leverage change ("The one thing I would change")
//
// Uses counterfactual analysis: for each potential state change, recompute the
// route set and measure how many new routes become viable.

import type { MobilityState, Intent, Route } from '@/lib/domain/types'
import type { ProfileAnalysis, ProfileAsset, ProfileGap } from './types'
import { generateRoutes } from '@/lib/engine/routes'
import { exampleState } from '@/lib/domain/state'
import { parseIntentDeterministic } from '@/lib/domain/intent'

/** Analyze the user's profile for asset value and gaps. */
export function analyzeProfile(
  state: MobilityState,
  intent: Intent,
  currentRoutes: Route[],
): ProfileAnalysis {
  // 1. Identify assets
  const assets = identifyAssets(state, currentRoutes)
  // 2. Identify gaps
  const gaps = identifyGaps(state, currentRoutes)
  // 3. Find the highest-leverage change via counterfactual analysis
  const highestLeverage = findHighestLeverageChange(state, intent, currentRoutes)

  // 4. Count current viable trajectories
  const currentViable = currentRoutes.filter((r) => r.eligibility.status !== 'ineligible').length

  // 5. Count post-change viable trajectories
  let postChangeViable = currentViable
  if (highestLeverage?.scenarioId) {
    const modifiedState = applyScenario(state, highestLeverage.scenarioId)
    if (modifiedState) {
      const modifiedRoutes = generateRoutes(modifiedState, intent, '2025-06-01')
      postChangeViable = modifiedRoutes.filter((r) => r.eligibility.status !== 'ineligible').length
    }
  }

  return {
    topAssets: assets.slice(0, 5),
    topGaps: gaps.slice(0, 5),
    highestLeverageChange: highestLeverage,
    currentViableTrajectories: currentViable,
    postChangeViableTrajectories: postChangeViable,
  }
}

/** Identify the user's highest-leverage assets. */
function identifyAssets(state: MobilityState, routes: Route[]): ProfileAsset[] {
  const assets: ProfileAsset[] = []

  // Software occupation is highly leveraged
  if (state.occupationCategory.value === 'software_it') {
    assets.push({
      attribute: 'occupation',
      label: 'Software / IT occupation',
      leverage: 0.9,
      benefitsRoutes: routes.filter((r) => r.shortageOccupationFriendly).map((r) => r.id),
      rare: false,
    })
  }

  // Remote work capability
  if (state.remoteWorkEligible.value === true) {
    assets.push({
      attribute: 'remote_work',
      label: 'Remote work capability',
      leverage: 0.7,
      benefitsRoutes: routes.filter((r) => r.entryPathwayId.includes('d7') || r.entryPathwayId.includes('virtual')).map((r) => r.id),
      rare: true,
    })
  }

  // English language
  const english = state.languages.value.find((l) => l.language === 'en')
  if (english && (english.cefr === 'native' || english.cefr === 'C1' || english.cefr === 'C2')) {
    assets.push({
      attribute: 'english',
      label: 'Native/fluent English',
      leverage: 0.6,
      benefitsRoutes: routes.filter((r) => r.countryCode === 'CA' || r.countryCode === 'UK').map((r) => r.id),
      rare: false,
    })
  }

  // Bachelor's degree
  if (state.education.value === 'bachelors' || state.education.value === 'masters' || state.education.value === 'phd') {
    assets.push({
      attribute: 'education',
      label: `${state.education.value} degree`,
      leverage: 0.7,
      benefitsRoutes: routes.filter((r) => r.entryPathwayId.includes('blue-card') || r.entryPathwayId.includes('express')).map((r) => r.id),
      rare: false,
    })
  }

  // Savings
  const savings = state.savingsUSD.value ?? 0
  if (savings >= 11000) {
    assets.push({
      attribute: 'savings',
      label: `Savings ($${savings.toLocaleString()})`,
      leverage: 0.5,
      benefitsRoutes: routes.filter((r) => r.entryPathwayId.includes('d7') || r.entryPathwayId.includes('express')).map((r) => r.id),
      rare: savings >= 40000,
    })
  }

  // Income
  const income = state.annualIncomeUSD.value ?? 0
  if (income >= 49000) {
    assets.push({
      attribute: 'income',
      label: `Income ($${income.toLocaleString()}/yr)`,
      leverage: 0.8,
      benefitsRoutes: routes.filter((r) => r.entryPathwayId.includes('blue-card')).map((r) => r.id),
      rare: income >= 70000,
    })
  }

  // Young age
  const age = state.age.value
  if (age != null && age <= 35) {
    assets.push({
      attribute: 'age',
      label: `Age (${age}) — under 35`,
      leverage: 0.4,
      benefitsRoutes: routes.filter((r) => r.entryPathwayId.includes('chancenkarte') || r.entryPathwayId.includes('express')).map((r) => r.id),
      rare: false,
    })
  }

  // Sort by leverage
  return assets.sort((a, b) => b.leverage - a.leverage)
}

/** Identify the user's biggest gaps. */
function identifyGaps(state: MobilityState, routes: Route[]): ProfileGap[] {
  const gaps: ProfileGap[] = []

  // Degree recognition
  const deRecognized = state.credentialRecognizedIn.value.includes('DE')
  if (!deRecognized) {
    const affectedRoutes = routes.filter((r) =>
      r.eligibility.blockers.some((b) => b.label.toLowerCase().includes('degree') || b.label.toLowerCase().includes('recognized')),
    )
    if (affectedRoutes.length > 0) {
      gaps.push({
        attribute: 'degree_recognition_de',
        label: 'Degree recognition in Germany',
        frontierExpansion: 0.6,
        unlocksRoutes: affectedRoutes.map((r) => r.id),
        userActionable: true,
      })
    }
  }

  // German language
  const german = state.languages.value.find((l) => l.language === 'de')
  if (!german || german.cefr === 'A1' || german.cefr === 'A2') {
    gaps.push({
      attribute: 'german_language',
      label: 'German language (B1+)',
      frontierExpansion: 0.4,
      unlocksRoutes: routes.filter((r) => r.countryCode === 'DE').map((r) => r.id),
      userActionable: true,
    })
  }

  // Employer offer
  const hasOfferBlocker = routes.some((r) =>
    r.eligibility.blockers.some((b) => b.label.toLowerCase().includes('employer') || b.label.toLowerCase().includes('offer')),
  )
  if (hasOfferBlocker) {
    gaps.push({
      attribute: 'employer_offer',
      label: 'Qualifying employer offer',
      frontierExpansion: 0.7,
      unlocksRoutes: routes.filter((r) =>
        r.eligibility.blockers.some((b) => b.label.toLowerCase().includes('employer') || b.label.toLowerCase().includes('offer')),
      ).map((r) => r.id),
      userActionable: true,
    })
  }

  // Incubator support
  const hasIncubatorBlocker = routes.some((r) =>
    r.eligibility.blockers.some((b) => b.label.toLowerCase().includes('incubator') || b.label.toLowerCase().includes('support')),
  )
  if (hasIncubatorBlocker) {
    gaps.push({
      attribute: 'incubator_support',
      label: 'Designated incubator support',
      frontierExpansion: 0.5,
      unlocksRoutes: routes.filter((r) =>
        r.eligibility.blockers.some((b) => b.label.toLowerCase().includes('incubator') || b.label.toLowerCase().includes('support')),
      ).map((r) => r.id),
      userActionable: true,
    })
  }

  // Endorsement
  const hasEndorsementBlocker = routes.some((r) =>
    r.eligibility.blockers.some((b) => b.label.toLowerCase().includes('endorsement')),
  )
  if (hasEndorsementBlocker) {
    gaps.push({
      attribute: 'endorsement',
      label: 'Tech Nation endorsement',
      frontierExpansion: 0.4,
      unlocksRoutes: routes.filter((r) =>
        r.eligibility.blockers.some((b) => b.label.toLowerCase().includes('endorsement')),
      ).map((r) => r.id),
      userActionable: true,
    })
  }

  return gaps.sort((a, b) => b.frontierExpansion - a.frontierExpansion)
}

/** Find the single highest-leverage change via counterfactual analysis. */
function findHighestLeverageChange(
  state: MobilityState,
  intent: Intent,
  currentRoutes: Route[],
): ProfileAnalysis['highestLeverageChange'] | undefined {
  const currentViable = currentRoutes.filter((r) => r.eligibility.status !== 'ineligible').length
  const currentEligible = currentRoutes.filter((r) => r.eligibility.status === 'eligible').length

  const scenarios = [
    { id: 'sc-degree-de', label: 'Get degree recognized in Germany', description: 'Obtain official credential recognition from ZAB/Anabin.' },
    { id: 'sc-learn-german', label: 'Learn German to B1', description: 'Achieve B1 (CEFR) German through a certified course.' },
    { id: 'sc-income-up', label: 'Raise income by 30%', description: 'Increase your annual income by 30%.' },
    { id: 'sc-masters', label: 'Get a master\'s degree', description: 'Upgrade your education to a master\'s degree.' },
    { id: 'sc-savings-2x', label: 'Double your savings', description: 'Accumulate twice your current savings.' },
    { id: 'sc-start-business', label: 'Start a business', description: 'Become an active founder with a pre-revenue venture.' },
  ]

  let bestChange: ProfileAnalysis['highestLeverageChange'] | undefined
  let maxExpansion = 0

  for (const sc of scenarios) {
    const modifiedState = applyScenario(state, sc.id)
    if (!modifiedState) continue

    const modifiedRoutes = generateRoutes(modifiedState, intent, '2025-06-01')
    const newViable = modifiedRoutes.filter((r) => r.eligibility.status !== 'ineligible').length
    const newEligible = modifiedRoutes.filter((r) => r.eligibility.status === 'eligible').length

    // Count both newly viable routes AND newly eligible routes
    const newlyOpened = newViable - currentViable
    const newlyEligible = newEligible - currentEligible
    const expansionScore = newlyOpened + newlyEligible * 0.5 // eligible improvements count half

    if (expansionScore > maxExpansion) {
      maxExpansion = expansionScore
      bestChange = {
        label: sc.label,
        description: sc.description,
        newRoutesOpened: newlyOpened,
        scenarioId: sc.id,
      }
    }
  }

  // If no change opens new routes, still identify the highest-leverage change
  // as the one that improves the most routes from conditional to eligible
  if (!bestChange && maxExpansion === 0) {
    // Fall back: find the scenario that resolves the most blockers
    let bestSc = scenarios[0]
    let maxBlockersResolved = 0
    for (const sc of scenarios) {
      const modifiedState = applyScenario(state, sc.id)
      if (!modifiedState) continue
      const modifiedRoutes = generateRoutes(modifiedState, intent, '2025-06-01')
      const currentBlockers = currentRoutes.reduce((sum, r) => sum + r.eligibility.blockers.length, 0)
      const modifiedBlockers = modifiedRoutes.reduce((sum, r) => sum + r.eligibility.blockers.length, 0)
      const resolved = currentBlockers - modifiedBlockers
      if (resolved > maxBlockersResolved) {
        maxBlockersResolved = resolved
        bestSc = sc
      }
    }
    if (maxBlockersResolved > 0) {
      bestChange = {
        label: bestSc.label,
        description: bestSc.description,
        newRoutesOpened: 0,
        scenarioId: bestSc.id,
      }
    }
  }

  return bestChange
}

/** Apply a counterfactual scenario to the user's state. */
function applyScenario(state: MobilityState, scenarioId: string): MobilityState | null {
  const s: MobilityState = JSON.parse(JSON.stringify(state))

  switch (scenarioId) {
    case 'sc-degree-de':
      s.credentialRecognizedIn = { ...s.credentialRecognizedIn, value: Array.from(new Set([...s.credentialRecognizedIn.value, 'DE'])) }
      return s
    case 'sc-learn-german':
      if (!s.languages.value.some((l) => l.language === 'de')) {
        s.languages = { ...s.languages, value: [...s.languages.value, { language: 'de', cefr: 'B1' }] }
      }
      return s
    case 'sc-income-up':
      s.annualIncomeUSD = { ...s.annualIncomeUSD, value: Math.round((s.annualIncomeUSD.value ?? 0) * 1.3) }
      return s
    case 'sc-masters':
      s.education = { ...s.education, value: 'masters' }
      return s
    case 'sc-savings-2x':
      s.savingsUSD = { ...s.savingsUSD, value: (s.savingsUSD.value ?? 0) * 2 }
      return s
    case 'sc-start-business':
      s.founderStatus = { ...s.founderStatus, value: 'active_founder' }
      s.businessStage = { ...s.businessStage, value: 'pre_revenue' }
      return s
    default:
      return null
  }
}
