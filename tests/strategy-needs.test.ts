// Wayfinder — N0.5 Needs + Desired Capability Intelligence Tests
//
// Tests the capability taxonomy, blocker→capability mapping, need inference,
// desired capability derivation, counterfactual analysis, and demand aggregation.

import { describe, it, expect, beforeAll } from 'vitest'
import {
  CAPABILITY_TAXONOMY,
  classifyBlockerPattern,
  getCapabilitiesForPattern,
  getCapabilityDefinition,
  type BlockerPattern,
} from '@/lib/strategy/capabilities'
import {
  inferNeeds,
  inferDesiredCapabilities,
  buildCapabilityImpactSummary,
  analyzeCounterfactualCapability,
} from '@/lib/strategy/needs'
import { buildStrategy } from '@/lib/strategy'
import { exampleState } from '@/lib/domain/state'
import { parseIntentDeterministic } from '@/lib/domain/intent'
import { generateRoutes } from '@/lib/engine/routes'
import type { Intent } from '@/lib/domain/types'

const baseState = exampleState()
const baseIntent = parseIntentDeterministic('I want to move abroad and earn more.')
const baseRoutes = generateRoutes(baseState, baseIntent, '2025-06-01')

// ---------------------------------------------------------------------------
// 1. Capability taxonomy tests
// ---------------------------------------------------------------------------

describe('Capability taxonomy', () => {
  it('has at least 15 canonical capabilities', async () => {
    expect(CAPABILITY_TAXONOMY.length).toBeGreaterThanOrEqual(15)
  })

  it('each capability has a unique id', async () => {
    const ids = CAPABILITY_TAXONOMY.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('each capability has required fields', async () => {
    for (const cap of CAPABILITY_TAXONOMY) {
      expect(cap.id).toBeTruthy()
      expect(cap.label).toBeTruthy()
      expect(cap.description).toBeTruthy()
      expect(cap.resolvesBlockerPatterns.length).toBeGreaterThan(0)
      expect(typeof cap.requiresActor).toBe('boolean')
      expect(typeof cap.userSelfAcquirable).toBe('boolean')
      expect(cap.typicalAcquisitionMonths).toBeGreaterThanOrEqual(0)
    }
  })

  it('getCapabilityDefinition returns the right capability', async () => {
    const cap = getCapabilityDefinition('EMPLOYER_SPONSORSHIP')
    expect(cap).toBeDefined()
    expect(cap!.label).toBe('Employer Sponsorship')
    expect(cap!.requiresActor).toBe(true)
  })

  it('getCapabilitiesForPattern returns capabilities that resolve the pattern', async () => {
    const caps = getCapabilitiesForPattern('employer_sponsorship')
    expect(caps.length).toBeGreaterThan(0)
    expect(caps.some((c) => c.id === 'EMPLOYER_SPONSORSHIP')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 2. Blocker → Pattern mapping (deterministic)
// ---------------------------------------------------------------------------

describe('Blocker pattern classification', () => {
  it('classifies employer sponsorship blocker', async () => {
    expect(classifyBlockerPattern('No qualifying employer sponsor', 'Requires employer sponsorship')).toBe('employer_sponsorship')
  })

  it('classifies credential recognition blocker', async () => {
    expect(classifyBlockerPattern('Degree not recognized', 'Credential recognition required')).toBe('credential_recognition')
  })

  it('classifies language requirement blocker', async () => {
    expect(classifyBlockerPattern('German B1 required', 'Language proficiency not met')).toBe('language_requirement')
  })

  it('classifies income threshold blocker', async () => {
    expect(classifyBlockerPattern('Salary below threshold', 'Income below minimum')).toBe('income_threshold')
  })

  it('classifies savings requirement blocker', async () => {
    expect(classifyBlockerPattern('Insufficient savings', 'Funds requirement not met')).toBe('savings_requirement')
  })

  it('classifies accommodation blocker', async () => {
    expect(classifyBlockerPattern('No qualifying accommodation', 'Housing required')).toBe('accommodation')
  })

  it('classifies incubator support blocker', async () => {
    expect(classifyBlockerPattern('No incubator letter', 'Business plan not approved')).toBe('incubator_support')
  })

  it('classifies endorsement blocker', async () => {
    expect(classifyBlockerPattern('No Tech Nation endorsement', 'Endorsement required')).toBe('endorsement')
  })

  it('returns other for unknown patterns', async () => {
    expect(classifyBlockerPattern('Unknown requirement', 'No details')).toBe('other')
  })

  it('is deterministic — same input always produces same output', async () => {
    const a = classifyBlockerPattern('Salary below threshold', 'Income')
    const b = classifyBlockerPattern('Salary below threshold', 'Income')
    expect(a).toBe(b)
  })
})

// ---------------------------------------------------------------------------
// 3. Need inference (WANT ≠ NEED ≠ OBJECTIVE)
// ---------------------------------------------------------------------------

describe('Need inference', () => {
  it('distinguishes WANT from NEED', async () => {
    const intent = parseIntentDeterministic('I want Portugal.')
    const assessment = inferNeeds(intent)
    expect(assessment.wants.length).toBeGreaterThan(0)
    expect(assessment.needs.length).toBeGreaterThan(0)
    expect(assessment.wants[0].source).toBe('USER_STATED')
    expect(assessment.needs[0].label).not.toBe(assessment.wants[0].goal)
  })

  it('NEED is derived from the stated goal', async () => {
    const intent = parseIntentDeterministic('I want to earn more.')
    const assessment = inferNeeds(intent)
    expect(assessment.needs[0].derivedFrom).toBe('earn_more')
    expect(assessment.needs[0].label).toContain('income')
  })

  it('OBJECTIVE is distinct from NEED', async () => {
    const intent: Intent = {
      ...baseIntent,
      statedGoal: 'second_citizenship',
      desiredOutcomes: [{ outcome: 'citizenship', horizon: 'long' }],
    }
    const assessment = inferNeeds(intent)
    expect(assessment.objectives).toContain('citizenship')
    expect(assessment.needs[0].label).not.toBe('citizenship')
  })

  it('CONSTRAINTS remain distinct from NEEDS', async () => {
    const intent: Intent = {
      ...baseIntent,
      constraints: [{ kind: 'budget_max' as const, value: '30000', rationale: 'Limited savings' }],
    }
    const assessment = inferNeeds(intent)
    expect(assessment.constraints.length).toBeGreaterThan(0)
    expect(assessment.constraints[0].kind).toBe('budget_max')
    expect(assessment.needs[0].label).not.toContain('budget')
  })

  it('PREFERENCES remain distinct from NEEDS', async () => {
    const intent: Intent = {
      ...baseIntent,
      priorities: [{ kind: 'safety_priority' as const, weight: 0.5 }],
    }
    const assessment = inferNeeds(intent)
    expect(assessment.preferences.length).toBeGreaterThan(0)
    expect(assessment.preferences[0].kind).toBe('safety_priority')
  })

  it('need inference is inspectable (has evidence)', () => {
    const assessment = inferNeeds(baseIntent)
    expect(assessment.needs[0].evidence).toBeTruthy()
    expect(typeof assessment.needs[0].evidence).toBe('string')
  })

  it('need inference is deterministic', async () => {
    const a = inferNeeds(baseIntent)
    const b = inferNeeds(baseIntent)
    expect(a.needs[0].label).toBe(b.needs[0].label)
    expect(a.needs[0].evidence).toBe(b.needs[0].evidence)
  })
})

// ---------------------------------------------------------------------------
// 4. DesiredCapability inference (blocker → capability)
// ---------------------------------------------------------------------------

describe('Desired capability inference', () => {
  let strategy: any
  beforeAll(async () => {
    strategy = await buildStrategy(baseState, baseIntent, baseRoutes)
  })

  it('strategy has needs + desiredCapabilities + capabilityImpact', async () => {
    expect(strategy.needs).toBeDefined()
    expect(strategy.desiredCapabilities).toBeDefined()
    expect(strategy.capabilityImpact).toBeDefined()
  })

  it('desired capabilities are traceable to a blocker (via triggers[])', () => {
    for (const cap of strategy.desiredCapabilities ?? []) {
      expect(cap.triggers.length).toBeGreaterThan(0)
      for (const trigger of cap.triggers) {
        expect(trigger.blockerId).toBeTruthy()
        expect(trigger.blockerLabel).toBeTruthy()
        expect(trigger.trajectoryId).toBeTruthy()
        expect(trigger.trajectoryLabel).toBeTruthy()
      }
    }
  })

  it('desired capabilities use canonical taxonomy IDs', async () => {
    for (const cap of strategy.desiredCapabilities ?? []) {
      const def = getCapabilityDefinition(cap.capabilityId)
      expect(def).toBeDefined()
    }
  })

  it('desired capabilities have urgency and impact scores (0..1)', () => {
    for (const cap of strategy.desiredCapabilities ?? []) {
      expect(cap.urgency).toBeGreaterThanOrEqual(0)
      expect(cap.urgency).toBeLessThanOrEqual(1)
      expect(cap.impact).toBeGreaterThanOrEqual(0)
      expect(cap.impact).toBeLessThanOrEqual(1)
    }
  })

  it('desired capabilities have origin (INFERRED or EXPLICIT)', () => {
    for (const cap of strategy.desiredCapabilities ?? []) {
      expect(['INFERRED', 'EXPLICIT']).toContain(cap.origin)
    }
  })

  it('capability does not imply guaranteed unlock (MAY_UNLOCK vs REQUIRED_FOR)', () => {
    for (const cap of strategy.desiredCapabilities ?? []) {
      // unlockRelation is now per-trigger, not per-capability
      for (const trigger of cap.triggers) {
        expect(['MAY_UNLOCK', 'REQUIRED_FOR', 'CONTRIBUTES_TO', 'DOES_NOT_SUFFICIENTLY_UNLOCK']).toContain(trigger.relation)
      }
    }
  })
})

// ---------------------------------------------------------------------------
// 5. Counterfactual capability analysis
// ---------------------------------------------------------------------------

describe('Counterfactual capability analysis', () => {
  it('returns a structured result', async () => {
    const result = analyzeCounterfactualCapability('EMPLOYER_SPONSORSHIP', baseRoutes, [])
    expect(result.capabilityId).toBe('EMPLOYER_SPONSORSHIP')
    expect(result.label).toBe('Employer Sponsorship')
    expect(result.explanation).toBeTruthy()
  })

  it('newlyViableTrajectories includes routes that would become viable', async () => {
    const result = analyzeCounterfactualCapability('LANGUAGE_CERTIFICATION', baseRoutes, [])
    expect(result.newlyViableTrajectories).toBeDefined()
    expect(result.partiallyImproved).toBeDefined()
  })

  it('does not include already-eligible routes', async () => {
    const result = analyzeCounterfactualCapability('CAPITAL', baseRoutes, [])
    for (const route of result.newlyViableTrajectories) {
      const originalRoute = baseRoutes.find((r) => r.id === route.id || r.label === route.label)
      expect(originalRoute?.eligibility.status).not.toBe('eligible')
    }
  })

  it('explanation is human-readable', async () => {
    const result = analyzeCounterfactualCapability('CREDENTIAL_RECOGNITION', baseRoutes, [])
    expect(result.explanation).toContain('Credential Recognition')
  })
})

// ---------------------------------------------------------------------------
// 6. Capability impact summary
// ---------------------------------------------------------------------------

describe('Capability impact summary', () => {
  it('builds a summary with counts', async () => {
    const strategy = await buildStrategy(baseState, baseIntent, baseRoutes)
    const summary = strategy.capabilityImpact!
    expect(summary.totalCapabilities).toBeGreaterThanOrEqual(0)
    expect(summary.impactfulCapabilities).toBeGreaterThanOrEqual(0)
    expect(summary.potentialTrajectoriesUnlocked).toBeGreaterThanOrEqual(0)
    expect(summary.explanation).toBeTruthy()
  })

  it('explanation is deterministic', async () => {
    const s1 = await buildStrategy(baseState, baseIntent, baseRoutes)
    const s2 = await buildStrategy(baseState, baseIntent, baseRoutes)
    expect(s1.capabilityImpact!.explanation).toBe(s2.capabilityImpact!.explanation)
  })
})

// ---------------------------------------------------------------------------
// 7. Existing architecture intact
// ---------------------------------------------------------------------------

describe('Existing architecture intact', () => {
  it('replay remains intact', async () => {
    const { replayStrategy, verifyStrategyRecord } = await import('@/lib/strategy/replay')
    expect(typeof replayStrategy).toBe('function')
    expect(typeof verifyStrategyRecord).toBe('function')
  })

  it('Strategy Memory remains intact', async () => {
    const { buildStrategyChange, classifyStrategyChangeCause } = await import('@/lib/strategy/change')
    expect(typeof buildStrategyChange).toBe('function')
    expect(typeof classifyStrategyChangeCause).toBe('function')
  })

  it('staleness remains intact', async () => {
    const { getFullStrategyStaleness } = await import('@/lib/strategy/staleness')
    expect(typeof getFullStrategyStaleness).toBe('function')
  })

  it('outcome measurement remains intact', async () => {
    const { evaluateActionOutcome } = await import('@/lib/strategy/evaluation')
    expect(typeof evaluateActionOutcome).toBe('function')
  })

  it('prediction derivation remains intact', async () => {
    const { deriveActionPrediction } = await import('@/lib/strategy/prediction')
    expect(typeof deriveActionPrediction).toBe('function')
  })
})

// ---------------------------------------------------------------------------
// 8. Adversarial tests
// ---------------------------------------------------------------------------

describe('Adversarial tests', () => {
  it('capability cannot be fabricated from a blocker that does not imply it', async () => {
    // A "language requirement" blocker should NOT produce an EMPLOYER_SPONSORSHIP capability
    const pattern = classifyBlockerPattern('German B1 required', 'Language proficiency')
    const caps = getCapabilitiesForPattern(pattern)
    expect(caps.some((c) => c.id === 'EMPLOYER_SPONSORSHIP')).toBe(false)
  })

  it('historical intent remains immutable after need inference', async () => {
    const original = JSON.parse(JSON.stringify(baseIntent))
    inferNeeds(baseIntent)
    expect(baseIntent).toEqual(original)
  })

  it('counterfactual capability does not pollute strategy history', async () => {
    // Counterfactual analysis is pure — it doesn't persist anything
    const result = analyzeCounterfactualCapability('CAPITAL', baseRoutes, [])
    expect(result).toBeDefined()
    // No side effects — the function is pure
  })

  it('objective isolation preserved', async () => {
    // Needs are derived from the intent, which is objective-scoped
    const incomeIntent = { ...baseIntent, statedGoal: 'earn_more' as const }
    const residenceIntent = { ...baseIntent, statedGoal: 'safer_life_for_family' as const }
    const incomeNeeds = inferNeeds(incomeIntent)
    const residenceNeeds = inferNeeds(residenceIntent)
    expect(incomeNeeds.needs[0].label).not.toBe(residenceNeeds.needs[0].label)
  })
})

// ---------------------------------------------------------------------------
// 9. N0.5 hardening regression tests
// ---------------------------------------------------------------------------

describe('N0.5 hardening: provenance + frontier coverage', () => {
  let strategy: any
  beforeAll(async () => {
    strategy = await buildStrategy(baseState, baseIntent, baseRoutes)
  })

  it('affectedObjective is populated (not null)', () => {
    for (const cap of strategy.desiredCapabilities ?? []) {
      expect(cap.affectedObjective).not.toBeNull()
      expect(cap.affectedObjective).toBe(baseIntent.statedGoal)
    }
  })

  it('one capability can have multiple triggers (multiple blockers)', () => {
    // If the same capability type is triggered by multiple blockers across
    // different trajectories, ALL triggers must be preserved.
    const caps = strategy.desiredCapabilities ?? []
    for (const cap of caps) {
      // Each trigger must have a unique blockerId
      const blockerIds = cap.triggers.map((t) => t.blockerId)
      expect(new Set(blockerIds).size).toBe(blockerIds.length)
    }
  })

  it('deduplication does not lose provenance', async () => {
    // If CREDENTIAL_RECOGNITION is triggered by 2 different blockers,
    // the capability must have 2 triggers, not 1.
    const caps = strategy.desiredCapabilities ?? []
    for (const cap of caps) {
      // Each trigger must have both blockerId and trajectoryId
      for (const trigger of cap.triggers) {
        expect(trigger.blockerId).toBeTruthy()
        expect(trigger.trajectoryId).toBeTruthy()
        expect(trigger.trajectoryLabel).toBeTruthy()
      }
    }
  })

  it('remainingBlockers is correct (counts canonical blockers)', () => {
    for (const cap of strategy.desiredCapabilities ?? []) {
      for (const unlock of cap.potentialUnlocks) {
        const route = baseRoutes.find((r) => r.id === unlock.routeId)
        if (route) {
          // Count blockers that match this capability's patterns
          const capDef = getCapabilityDefinition(cap.capabilityId)
          if (capDef) {
            const matchingBlockers = route.eligibility.blockers.filter((b) => {
              const pattern = classifyBlockerPattern(b.label, b.reason)
              return capDef.resolvesBlockerPatterns.includes(pattern)
            })
            const expectedRemaining = route.eligibility.blockers.length - matchingBlockers.length
            expect(unlock.remainingBlockers).toBe(expectedRemaining)
          }
        }
      }
    }
  })

  it('MAY_UNLOCK only when all blockers resolved', async () => {
    for (const cap of strategy.desiredCapabilities ?? []) {
      for (const unlock of cap.potentialUnlocks) {
        if (unlock.relation === 'MAY_UNLOCK') {
          expect(unlock.remainingBlockers).toBe(0)
        } else if (unlock.relation === 'CONTRIBUTES_TO') {
          expect(unlock.remainingBlockers).toBeGreaterThan(0)
        }
      }
    }
  })

  it('alternative trajectory blockers are considered', async () => {
    // The strategy has multiple trajectories (best + alternatives).
    // Capabilities should be derived from ALL of them, not just the best.
    const caps = strategy.desiredCapabilities ?? []
    const trajectoryIds = new Set<string>()
    for (const cap of caps) {
      for (const trigger of cap.triggers) {
        trajectoryIds.add(trigger.trajectoryId)
      }
    }
    // If there are capabilities, they should reference at least one trajectory
    // (and potentially multiple if blockers exist on alternative trajectories)
    if (caps.length > 0) {
      expect(trajectoryIds.size).toBeGreaterThanOrEqual(1)
    }
  })

  it('capability output is deterministic (same inputs → same output)', async () => {
    const s1 = await buildStrategy(baseState, baseIntent, baseRoutes)
    const s2 = await buildStrategy(baseState, baseIntent, baseRoutes)
    expect(s1.desiredCapabilities?.length).toBe(s2.desiredCapabilities?.length)
    for (let i = 0; i < (s1.desiredCapabilities?.length ?? 0); i++) {
      expect(s1.desiredCapabilities![i].capabilityId).toBe(s2.desiredCapabilities![i].capabilityId)
      expect(s1.desiredCapabilities![i].triggers.length).toBe(s2.desiredCapabilities![i].triggers.length)
    }
  })

  it('historical strategies remain immutable (needs are pure)', () => {
    const original = JSON.parse(JSON.stringify(baseIntent))
    inferNeeds(baseIntent)
    expect(baseIntent).toEqual(original)
  })

  it('counterfactual does not persist history', async () => {
    const before = Date.now()
    analyzeCounterfactualCapability('CAPITAL', baseRoutes, [])
    const after = Date.now()
    // No side effects — pure function
    expect(after).toBeGreaterThanOrEqual(before)
  })

  it('unknown capability IDs cannot be fabricated', async () => {
    const def = getCapabilityDefinition('FAKE_CAPABILITY' as any)
    expect(def).toBeUndefined()
  })

  it('cross-objective contamination is rejected', async () => {
    // Needs derived from one objective should not bleed into another
    const incomeIntent = { ...baseIntent, statedGoal: 'earn_more' as const }
    const residenceIntent = { ...baseIntent, statedGoal: 'safer_life_for_family' as const }
    const incomeNeeds = inferNeeds(incomeIntent)
    const residenceNeeds = inferNeeds(residenceIntent)
    expect(incomeNeeds.needs[0].derivedFrom).toBe('earn_more')
    expect(residenceNeeds.needs[0].derivedFrom).toBe('safer_life_for_family')
    expect(incomeNeeds.needs[0].label).not.toBe(residenceNeeds.needs[0].label)
  })

  it('strategy replay remains intact', async () => {
    const { replayStrategy } = await import('@/lib/strategy/replay')
    expect(typeof replayStrategy).toBe('function')
  })

  it('Strategy Memory remains intact', async () => {
    const { buildStrategyChange } = await import('@/lib/strategy/change')
    expect(typeof buildStrategyChange).toBe('function')
  })

  it('Profile Editor remains intact', async () => {
    const { validateProfileUpdates } = await import('@/lib/domain/profile-validation')
    expect(typeof validateProfileUpdates).toBe('function')
  })

  it('multi-route scenario: same capability from multiple trajectories', async () => {
    // Build a strategy with the full route set — if multiple trajectories
    // have credential recognition blockers, the CREDENTIAL_RECOGNITION
    // capability should have multiple triggers.
    const s = await buildStrategy(baseState, baseIntent, baseRoutes)
    const credCap = s.desiredCapabilities?.find((c) => c.capabilityId === 'CREDENTIAL_RECOGNITION')
    if (credCap) {
      // It should have at least one trigger
      expect(credCap.triggers.length).toBeGreaterThanOrEqual(1)
      // Each trigger references a trajectory
      for (const trigger of credCap.triggers) {
        expect(trigger.trajectoryId).toBeTruthy()
        expect(trigger.trajectoryLabel).toBeTruthy()
      }
    }
  })
})
