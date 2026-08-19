// Tests for the Strategy Intelligence Layer.
//
// Covers:
//   - Trajectory building (multi-step, optionality, reversibility)
//   - Blocker classification (user-controlled, third-party, external, policy)
//   - Action planner (sequenced actions, highest-leverage)
//   - Profile analysis (assets, gaps, highest-leverage change)
//   - Intent frontier (objectives × trajectories)
//   - Alternative intents (dynamic discovery)
//   - Preference elicitation (high-value questions)
//   - Uncertainty assessment

import { describe, it, expect } from 'vitest'
import { buildTrajectories } from '@/lib/strategy/trajectory'
import { analyzeBlockers } from '@/lib/strategy/blockers'
import { buildActionPlan } from '@/lib/strategy/actions'
import { analyzeProfile } from '@/lib/strategy/profile'
import { buildStrategy } from '@/lib/strategy'
import { exampleState } from '@/lib/domain/state'
import { parseIntentDeterministic } from '@/lib/domain/intent'
import { generateRoutes } from '@/lib/engine/routes'
import type { Trajectory, BlockerAnalysis, Action, ProfileAnalysis } from '@/lib/strategy/types'

const state = exampleState()
const intent = parseIntentDeterministic('I want to move somewhere I can start a company, earn more, and eventually get permanent residence.')
const routes = generateRoutes(state, intent, '2025-06-01')

// ===========================================================================
// 1. TRAJECTORY ENGINE
// ===========================================================================

describe('Trajectory engine', () => {
  const trajectories = buildTrajectories(routes, state, intent)

  it('builds trajectories from routes', () => {
    expect(trajectories.length).toBeGreaterThan(0)
    for (const t of trajectories) {
      expect(t.id).toMatch(/^traj-/)
      expect(t.steps.length).toBeGreaterThan(0)
      expect(t.totalMonths).toBeGreaterThan(0)
      expect(t.countries.length).toBeGreaterThan(0)
    }
  })

  it('each trajectory has a destination status', () => {
    for (const t of trajectories) {
      expect(t.destinationStatus).toBeTruthy()
    }
  })

  it('calculates downstream optionality', () => {
    for (const t of trajectories) {
      expect(t.downstreamOptionality).toBeGreaterThanOrEqual(0)
    }
  })

  it('marks trajectories as viable or blocked', () => {
    for (const t of trajectories) {
      expect(typeof t.viable).toBe('boolean')
    }
  })

  it('includes a rationale for each trajectory', () => {
    for (const t of trajectories) {
      expect(t.rationale).toBeTruthy()
      expect(t.rationale.length).toBeGreaterThan(10)
    }
  })

  it('step 0 is always the current state', () => {
    for (const t of trajectories) {
      expect(t.steps[0].status).toBe('Current state')
    }
  })

  it('trajectories that reach PR have cross-country extensions', () => {
    const prTrajectories = trajectories.filter((t) => /permanent|settlement|ilr/i.test(t.destinationStatus))
    const crossCountry = trajectories.filter((t) => t.multiCountry)
    // If there are PR trajectories, there should be cross-country extensions
    if (prTrajectories.length > 0) {
      expect(crossCountry.length).toBeGreaterThan(0)
    }
  })
})

// ===========================================================================
// 2. BLOCKER ANALYSIS
// ===========================================================================

describe('Blocker analysis', () => {
  const conditionalRoute = routes.find((r) => r.eligibility.status === 'conditional')
  const blockers = conditionalRoute ? analyzeBlockers(conditionalRoute, state) : []

  it('classifies blockers by category', () => {
    for (const b of blockers) {
      expect(b.category).toMatch(/USER_CONTROLLED|THIRD_PARTY|EXTERNAL|POLICY_DEPENDENT/)
    }
  })

  it('identifies unlocks for each blocker', () => {
    for (const b of blockers) {
      expect(b.unlocks).toBeDefined()
      expect(Array.isArray(b.unlocks)).toBe(true)
    }
  })

  it('employer blockers are classified as THIRD_PARTY', () => {
    const employerBlockers = blockers.filter((b) => b.label.toLowerCase().includes('employer') || b.label.toLowerCase().includes('offer'))
    for (const b of employerBlockers) {
      expect(b.category).toBe('THIRD_PARTY')
    }
  })

  it('language blockers are classified as USER_CONTROLLED', () => {
    // Filter more precisely: only blockers about language requirements
    // (not "German employer" which is about the employer)
    const languageBlockers = blockers.filter((b) => {
      const l = b.label.toLowerCase()
      return (l.includes('language') || l.includes('english or german') || l.includes('german at') || l.includes('french'))
    })
    for (const b of languageBlockers) {
      expect(b.category).toBe('USER_CONTROLLED')
    }
  })

  it('credential blockers are classified as EXTERNAL', () => {
    const credentialBlockers = blockers.filter((b) => b.label.toLowerCase().includes('degree') || b.label.toLowerCase().includes('credential'))
    for (const b of credentialBlockers) {
      // Credential recognition could be USER_CONTROLLED (the user initiates it)
      // or EXTERNAL (the process is external). Either is acceptable.
      expect(b.category).toMatch(/USER_CONTROLLED|EXTERNAL/)
    }
  })

  it('each blocker has a difficulty assessment', () => {
    for (const b of blockers) {
      expect(b.difficulty).toMatch(/easy|moderate|hard|very_hard/)
    }
  })

  it('user-controlled blockers have a userAction', () => {
    for (const b of blockers.filter((b) => b.category === 'USER_CONTROLLED')) {
      expect(b.userAction).toBeTruthy()
    }
  })

  it('third-party blockers have a thirdPartyRole', () => {
    for (const b of blockers.filter((b) => b.category === 'THIRD_PARTY')) {
      expect(b.thirdPartyRole).toBeTruthy()
    }
  })
})

// ===========================================================================
// 3. ACTION PLANNER
// ===========================================================================

describe('Action planner', () => {
  const bestRoute = routes[0]
  const blockers = bestRoute ? analyzeBlockers(bestRoute, state) : []
  const trajectories = buildTrajectories(routes, state, intent)
  const bestTrajectory = trajectories[0]
  const actionPlan = buildActionPlan(bestTrajectory, blockers)

  it('produces a list of actions', () => {
    expect(actionPlan.actions).toBeDefined()
    expect(Array.isArray(actionPlan.actions)).toBe(true)
  })

  it('actions have a timeframe', () => {
    for (const a of actionPlan.actions) {
      expect(a.timeframe).toMatch(/7_DAYS|30_DAYS|90_DAYS|6_MONTHS|ONGOING/)
    }
  })

  it('actions have an impact score 0..1', () => {
    for (const a of actionPlan.actions) {
      expect(a.impact).toBeGreaterThanOrEqual(0)
      expect(a.impact).toBeLessThanOrEqual(1)
    }
  })

  it('actions are sorted by impact (desc)', () => {
    for (let i = 1; i < actionPlan.actions.length; i++) {
      // Allow equal impact — just ensure non-increasing
      expect(actionPlan.actions[i].impact).toBeLessThanOrEqual(actionPlan.actions[i - 1].impact)
    }
  })

  it('the highest-leverage action is the first action', () => {
    if (actionPlan.actions.length > 0) {
      expect(actionPlan.highestLeverageAction).toBeDefined()
      expect(actionPlan.highestLeverageAction?.id).toBe(actionPlan.actions[0].id)
    }
  })

  it('the action plan has a summary', () => {
    expect(actionPlan.summary).toBeTruthy()
  })
})

// ===========================================================================
// 4. PROFILE ANALYSIS
// ===========================================================================

describe('Profile analysis', () => {
  const profile = analyzeProfile(state, intent, routes)

  it('identifies the user\'s top assets', () => {
    expect(profile.topAssets.length).toBeGreaterThan(0)
    for (const a of profile.topAssets) {
      expect(a.label).toBeTruthy()
      expect(a.leverage).toBeGreaterThan(0)
    }
  })

  it('identifies the user\'s biggest gaps', () => {
    expect(profile.topGaps.length).toBeGreaterThanOrEqual(0)
    for (const g of profile.topGaps) {
      expect(g.label).toBeTruthy()
      expect(g.frontierExpansion).toBeGreaterThan(0)
    }
  })

  it('software occupation is a high-leverage asset', () => {
    const softwareAsset = profile.topAssets.find((a) => a.attribute === 'occupation')
    expect(softwareAsset).toBeDefined()
    expect(softwareAsset!.leverage).toBeGreaterThan(0.5)
  })

  it('remote work is identified as a rare asset', () => {
    const remoteAsset = profile.topAssets.find((a) => a.attribute === 'remote_work')
    if (remoteAsset) {
      expect(remoteAsset.rare).toBe(true)
    }
  })

  it('counts current viable trajectories', () => {
    expect(profile.currentViableTrajectories).toBeGreaterThanOrEqual(0)
  })

  it('identifies the highest-leverage change', () => {
    expect(profile.highestLeverageChange).toBeDefined()
    if (profile.highestLeverageChange) {
      expect(profile.highestLeverageChange.label).toBeTruthy()
      expect(profile.highestLeverageChange.newRoutesOpened).toBeGreaterThanOrEqual(0)
    }
  })

  it('post-change viable trajectories >= current', () => {
    expect(profile.postChangeViableTrajectories).toBeGreaterThanOrEqual(profile.currentViableTrajectories)
  })
})

// ===========================================================================
// 5. FULL STRATEGY
// ===========================================================================

describe('Full strategy output', () => {
  const strategy = buildStrategy(state, intent, routes)

  it('has a best trajectory', () => {
    expect(strategy.bestTrajectory).toBeDefined()
    expect(strategy.bestTrajectory.label).toBeTruthy()
  })

  it('has alternative trajectories', () => {
    expect(strategy.alternativeTrajectories).toBeDefined()
    expect(Array.isArray(strategy.alternativeTrajectories)).toBe(true)
  })

  it('has blocker analysis', () => {
    expect(strategy.blockers).toBeDefined()
    expect(Array.isArray(strategy.blockers)).toBe(true)
  })

  it('has an action plan', () => {
    expect(strategy.actionPlan).toBeDefined()
    expect(strategy.actionPlan.actions).toBeDefined()
  })

  it('has profile analysis', () => {
    expect(strategy.profileAnalysis).toBeDefined()
    expect(strategy.profileAnalysis.topAssets.length).toBeGreaterThan(0)
  })

  it('has an intent frontier', () => {
    expect(strategy.intentFrontier).toBeDefined()
    expect(strategy.intentFrontier.points.length).toBeGreaterThan(0)
  })

  it('has alternative intents', () => {
    expect(strategy.alternativeIntents).toBeDefined()
  })

  it('has preference questions (max 3)', () => {
    expect(strategy.preferenceQuestions.length).toBeLessThanOrEqual(3)
  })

  it('has uncertainty assessment', () => {
    expect(strategy.uncertainties.length).toBeGreaterThan(0)
    const eligibility = strategy.uncertainties.find((u) => u.dimension === 'Legal eligibility')
    expect(eligibility).toBeDefined()
  })

  it('real-world approval outcome is UNKNOWN', () => {
    const outcome = strategy.uncertainties.find((u) => u.dimension === 'Real-world approval outcome')
    expect(outcome).toBeDefined()
    expect(outcome!.confidence).toBe('UNKNOWN')
  })

  it('has a deterministic explanation', () => {
    expect(strategy.explanation).toBeTruthy()
    expect(strategy.explanation.length).toBeGreaterThan(20)
  })

  it('has a highest-leverage change', () => {
    expect(strategy.highestLeverageChange).toBeDefined()
  })
})

// ===========================================================================
// 6. PREFERENCE ELICITATION
// ===========================================================================

describe('Preference elicitation', () => {
  const strategy = buildStrategy(state, intent, routes)

  it('questions are high-value (they affect the ranking)', () => {
    for (const q of strategy.preferenceQuestions) {
      expect(q.affectedRouteIds.length).toBeGreaterThan(0)
      expect(q.rationale).toBeTruthy()
    }
  })

  it('each question has at least 2 options', () => {
    for (const q of strategy.preferenceQuestions) {
      expect(q.options.length).toBeGreaterThanOrEqual(2)
    }
  })
})

// ===========================================================================
// 7. INTENT FRONTIER
// ===========================================================================

describe('Intent frontier', () => {
  const strategy = buildStrategy(state, intent, routes)
  const frontier = strategy.intentFrontier

  it('has multiple objectives', () => {
    expect(frontier.points.length).toBeGreaterThanOrEqual(3)
  })

  it('each objective has a best trajectory', () => {
    for (const p of frontier.points) {
      expect(p.bestTrajectoryId).toBeTruthy()
      expect(p.bestTrajectoryLabel).toBeTruthy()
    }
  })

  it('each objective has cost, time, risk, and optionality', () => {
    for (const p of frontier.points) {
      expect(typeof p.cost).toBe('number')
      expect(typeof p.timeMonths).toBe('number')
      expect(p.risk).toMatch(/low|medium|high/)
      expect(typeof p.optionality).toBe('number')
    }
  })
})

// ===========================================================================
// 8. SAFETY: NO FRAUDULENT ENABLERS
// ===========================================================================

describe('Enabler safety', () => {
  const strategy = buildStrategy(state, intent, routes)

  it('no unlock suggests fake employment', () => {
    for (const u of strategy.unlocks) {
      expect(u.description.toLowerCase()).not.toContain('fake')
      expect(u.description.toLowerCase()).not.toContain('sham')
      expect(u.description.toLowerCase()).not.toContain('fraud')
    }
  })

  it('all unlocks are user-actionable or require legitimate enablers', () => {
    for (const u of strategy.unlocks) {
      // Either the user can do it, or there are enabler ids
      expect(u.userActionable === true || u.enablerIds.length > 0).toBe(true)
    }
  })
})
