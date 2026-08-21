// Tests for the Temporal Mobility Intelligence Layer.
//
// Covers the 8 categories required by the spec:
//   1. Temporal policy selection
//   2. Supersession
//   3. Eligibility across versions
//   4. Route validity (valid under A, invalid under B)
//   5. Policy diff
//   6. Historical decisions reproducibility
//   7. Evidence linkage
//   8. AI extraction boundaries

import { describe, it, expect } from 'vitest'
import {
  getPolicySnapshot,
  getCurrentPolicySnapshot,
  listSnapshots,
  comparePolicySnapshots,
  getProgramsInSnapshot,
  getRequirementsInSnapshot,
} from '@/lib/policy/snapshot'
import { buildGraph, findPaths, getNeighbors, getReachableStatuses, isRouteStillValid, getPolicyImpact } from '@/lib/graph/mobility-graph'
import { PROGRAMS, REQUIREMENTS, getRequirement, getSnapshot, SNAPSHOTS } from '@/lib/policy/knowledge'
import { exampleState } from '@/lib/domain/state'
import { parseIntentDeterministic } from '@/lib/domain/intent'
import { generateRoutes } from '@/lib/engine/routes'
import { rankRoutes } from '@/lib/engine/optimize'
import {
  extractCandidateRequirements,
  canTransition,
  isAuthoritative,
  onlyAuthoritative,
  promoteCandidate,
  publishCandidate,
  type CandidateRequirement,
} from '@/lib/policy/extraction'
import { buildPlan } from '@/lib/engine/optimize'
import { SOURCES, contentHash, detectSourceChange, classifyChange } from '@/lib/policy/sources'
import { EVIDENCE } from '@/lib/knowledge/evidence'

// ===========================================================================
// 1. TEMPORAL POLICY SELECTION
// ===========================================================================

describe('Temporal policy selection', () => {
  it('returns the current snapshot for a date in late 2024', async () => {
    const snap = getPolicySnapshot('global', '2024-12-15')
    expect(snap.id).toBe('snap-2024-11')
    expect(snap.status).toBe('current')
  })

  it('returns the 2026 SIMULATED snapshot for dates on/after 2026-01-01 ONLY when simulation is allowed', async () => {
    // By default, simulated snapshots are excluded — the authoritative 2024 snapshot is returned
    const snapDefault = getPolicySnapshot('global', '2026-06-15')
    expect(snapDefault.id).toBe('snap-2024-11') // falls back to latest authoritative
    expect(snapDefault.provenance).toBe('AUTHORITATIVE')

    // Only when allowSimulated is true does the 2026 snapshot become accessible
    const snapSim = getPolicySnapshot('global', '2026-06-15', true)
    expect(snapSim.id).toBe('snap-2026-01')
    expect(snapSim.provenance).toBe('SIMULATED')
  })

  it('returns the 2024 snapshot for dates between 2024-11-01 and 2026-01-01', async () => {
    const snap = getPolicySnapshot('global', '2025-08-18')
    expect(snap.id).toBe('snap-2024-11')
  })

  it('getCurrentPolicySnapshot returns the one marked current', async () => {
    const snap = getCurrentPolicySnapshot()
    expect(snap.status).toBe('current')
  })

  it('listSnapshots returns all snapshots, newest first', async () => {
    const list = listSnapshots()
    expect(list.length).toBeGreaterThanOrEqual(2)
    expect(new Date(list[0].publishedAt).getTime()).toBeGreaterThanOrEqual(new Date(list[1].publishedAt).getTime())
  })
})

// ===========================================================================
// 2. SUPERSESSION
// ===========================================================================

describe('Supersession', () => {
  it('the v2 Blue Card salary requirement supersedes the v1 one', async () => {
    const v1 = getRequirement('req-de-bc-salary-v1')
    const v2 = getRequirement('req-de-bc-salary-v2')
    expect(v1).toBeDefined()
    expect(v2).toBeDefined()
    expect(v2!.supersedesId).toBe('req-de-bc-salary-v1')
    expect(v1!.supersededById).toBeUndefined() // not backfilled, but the forward link exists
  })

  it('the v2 requirement has a higher threshold than v1', async () => {
    const v1 = getRequirement('req-de-bc-salary-v1')
    const v2 = getRequirement('req-de-bc-salary-v2')
    expect((v2!.params.amount as number)).toBeGreaterThan((v1!.params.amount as number))
  })

  it('the v2 Portugal D7 income requirement supersedes the v1 one', async () => {
    const v2 = getRequirement('req-pt-d7-income-v2')
    expect(v2!.supersedesId).toBe('req-pt-d7-income-v1')
    expect((v2!.params.amount as number)).toBeGreaterThan((getRequirement('req-pt-d7-income-v1')!.params.amount as number))
  })
})

// ===========================================================================
// 3. ELIGIBILITY ACROSS VERSIONS
// ===========================================================================

describe('Eligibility across policy versions', () => {
  // A non-shortage user earning $62,000 — passes the v1 general threshold
  // ($61k) but fails the v2 general threshold ($64k). Using a non-shortage
  // occupation avoids the reduced shortage rate.
  const stateAt62kNonShortage = (() => {
    const s = exampleState()
    s.annualIncomeUSD = { ...s.annualIncomeUSD, value: 62000 }
    s.credentialRecognizedIn = { ...s.credentialRecognizedIn, value: ['DE'] }
    // Use 'other' — qualifies for the Blue Card occupation list but is NOT on
    // the DE shortage list, so the general (not reduced) salary threshold applies.
    s.occupationCategory = { ...s.occupationCategory, value: 'other' }
    return s
  })()

  const intent = parseIntentDeterministic('I want to move to Germany.')

  it('under v1 (2025), the Blue Card salary requirement passes at $62k (general threshold $61k)', () => {
    const routes = generateRoutes(stateAt62kNonShortage, intent, '2025-06-01')
    const blueCard = routes.find((r) => r.entryPathwayId === 'de-blue-card')!
    expect(blueCard).toBeDefined()
    const salaryReq = blueCard.eligibility.satisfied.find((e) => e.requirement.kind === 'min_salary_usd')
    expect(salaryReq).toBeDefined()
    expect(salaryReq!.passed).toBe(true)
  })

  it('under v2 SIMULATED (2026), the Blue Card salary requirement fails at $62k (general threshold raised to $64k)', () => {
    // simulationMode: true is required to access the SIMULATED 2026 snapshot
    const routes = generateRoutes(stateAt62kNonShortage, intent, '2026-06-01', true)
    const blueCard = routes.find((r) => r.entryPathwayId === 'de-blue-card')!
    expect(blueCard).toBeDefined()
    // Under v2, $62k < $64k general threshold → NOT satisfied
    const satisfied = blueCard.eligibility.satisfied.find((e) => e.requirement.kind === 'min_salary_usd')
    expect(satisfied).toBeUndefined()
  })

  it('the same user faces a higher required threshold under v2 (SIMULATED) than v1', () => {
    const routesV1 = generateRoutes(stateAt62kNonShortage, intent, '2025-06-01')
    const routesV2 = generateRoutes(stateAt62kNonShortage, intent, '2026-06-01', true)
    const bcV1 = routesV1.find((r) => r.entryPathwayId === 'de-blue-card')!
    const bcV2 = routesV2.find((r) => r.entryPathwayId === 'de-blue-card')!
    // Under v1, $62k ≥ $61k general threshold → salary SATISFIED.
    // Under v2, $62k < $64k general threshold → salary UNKNOWN (needs a higher offer).
    const v1Salary = bcV1.eligibility.satisfied.find((e) => e.requirement.kind === 'min_salary_usd')
    expect(v1Salary).toBeDefined()
    expect(v1Salary!.passed).toBe(true)
    expect(v1Salary!.reason).toContain('61,000')
    const v2Salary = bcV2.eligibility.unknown.find((e) => e.requirement.kind === 'min_salary_usd')
    expect(v2Salary).toBeDefined()
    expect(v2Salary!.passed).toBeNull()
    expect(v2Salary!.reason).toContain('64,000')
    expect(v2Salary!.needed).toContain('64,000')
    // The requirement label itself reflects the changed threshold
    expect(v1Salary!.requirement.label).toContain('61k')
    expect(v2Salary!.requirement.label).toContain('64k')
  })
})

// ===========================================================================
// 4. ROUTE VALIDITY (valid under A, invalid under B)
// ===========================================================================

describe('Route invalidation', () => {
  const route = { entryPathwayId: 'ca-startup-visa', eligibility: { evidenceIds: [] } }

  it('CA Start-Up Visa is valid under v1 → v1 (no change)', () => {
    const inv = isRouteStillValid(route, 'snap-2024-11', 'snap-2024-11')
    expect(inv.valid).toBe(true)
    expect(inv.reasons).toHaveLength(0)
  })

  it('CA Start-Up Visa is INVALID under v1 → v2 (program suspended)', () => {
    const inv = isRouteStillValid(route, 'snap-2024-11', 'snap-2026-01')
    expect(inv.valid).toBe(false)
    expect(inv.reasons).toContain('PROGRAM_SUSPENDED')
    expect(inv.description).toMatch(/invalidated/i)
  })

  it('invalidation suggests alternative routes in the same jurisdiction', async () => {
    const inv = isRouteStillValid(route, 'snap-2024-11', 'snap-2026-01')
    expect(inv.alternativeRouteIds.length).toBeGreaterThan(0)
    expect(inv.alternativeRouteIds.some((id) => id.includes('express-entry'))).toBe(true)
  })

  it('the Blue Card route is invalid under v1 → v2 (threshold raised)', () => {
    const bcRoute = { entryPathwayId: 'de-blue-card', eligibility: { evidenceIds: [] } }
    const inv = isRouteStillValid(bcRoute, 'snap-2024-11', 'snap-2026-01')
    expect(inv.valid).toBe(false)
    expect(inv.reasons).toContain('THRESHOLD_RAISED')
  })
})

// ===========================================================================
// 5. POLICY DIFF
// ===========================================================================

describe('Policy diff engine', () => {
  const diff = comparePolicySnapshots('snap-2024-11', 'snap-2026-01')

  it('detects the Blue Card salary threshold change', async () => {
    const thresholdChanges = diff.changes.filter((c) => c.kind === 'THRESHOLD_CHANGED')
    expect(thresholdChanges.length).toBeGreaterThan(0)
    const bcChange = thresholdChanges.find((c) => c.entityLabel.includes('Salary'))
    expect(bcChange).toBeDefined()
    expect((bcChange!.oldValue as any).amount).toBe(61000)
    expect((bcChange!.newValue as any).amount).toBe(64000)
  })

  it('detects the CA Start-Up Visa program suspension', async () => {
    const suspensions = diff.changes.filter((c) => c.kind === 'PROGRAM_SUSPENDED')
    expect(suspensions.length).toBeGreaterThan(0)
    const suv = suspensions.find((c) => c.entityLabel.includes('Start-Up Visa'))
    expect(suv).toBeDefined()
  })

  it('detects the Portugal D7 income threshold change', async () => {
    const ptChange = diff.changes.find(
      (c) => c.kind === 'THRESHOLD_CHANGED' && c.entityLabel.includes('Recurring income'),
    )
    expect(ptChange).toBeDefined()
    expect((ptChange!.newValue as any).amount).toBeGreaterThan((ptChange!.oldValue as any).amount)
  })

  it('every change points to at least one evidence id', async () => {
    for (const c of diff.changes) {
      expect(c.evidenceIds.length).toBeGreaterThan(0)
    }
  })

  it('summary counts by kind are consistent with the changes array', async () => {
    for (const [kind, count] of Object.entries(diff.summary)) {
      expect(diff.changes.filter((c) => c.kind === kind).length).toBe(count)
    }
  })
})

// ===========================================================================
// 6. HISTORICAL DECISIONS REPRODUCIBILITY
// ===========================================================================

describe('Historical decision reproducibility', () => {
  it('a plan computed under v1 records the v1 snapshot id + hash', async () => {
    const state = exampleState()
    const intent = parseIntentDeterministic('I want to move abroad.')
    const plan = buildPlan(state, intent, [], '2025-06-01')
    expect(plan.policySnapshotId).toBe('snap-2024-11')
    expect(plan.policyVersion).toBe('2024.11.1')
    expect(plan.policyHash).toBe('wf-kb-0011')
    expect(plan.asOfDate).toBe('2025-06-01')
  })

  it('a plan computed under v2 (SIMULATED) records the v2 snapshot id + hash', () => {
    const state = exampleState()
    const intent = parseIntentDeterministic('I want to move abroad.')
    // simulationMode: true required to access SIMULATED snapshots
    const plan = buildPlan(state, intent, [], '2026-06-01', true)
    expect(plan.policySnapshotId).toBe('snap-2026-01')
    expect(plan.policyVersion).toBe('2026.01.1')
    expect(plan.policyHash).toBe('wf-kb-0012')
  })

  it('a plan computed under v2 WITHOUT simulation mode falls back to the authoritative v1 snapshot', async () => {
    const state = exampleState()
    const intent = parseIntentDeterministic('I want to move abroad.')
    // Without simulationMode, the SIMULATED 2026 snapshot is excluded
    const plan = buildPlan(state, intent, [], '2026-06-01')
    expect(plan.policySnapshotId).toBe('snap-2024-11') // falls back to authoritative
  })

  it('recomputing the same state+intent+asOf produces an identical plan (deterministic)', () => {
    const state = exampleState()
    const intent = parseIntentDeterministic('I want to move abroad.')
    const plan1 = buildPlan(state, intent, [], '2025-06-01')
    const plan2 = buildPlan(state, intent, [], '2025-06-01')
    expect(plan1.policySnapshotId).toBe(plan2.policySnapshotId)
    expect(plan1.routes.length).toBe(plan2.routes.length)
    expect(plan1.routes[0].id).toBe(plan2.routes[0].id)
  })

  it('a historical plan does not silently recompute against today\'s laws', async () => {
    // A plan saved with asOfDate=2025-06-01 used v1 rules. Even though v2 is
    // now in the knowledge base, recomputing with the same asOfDate still
    // returns v1 rules (because 2025-06-01 < 2026-01-01 effective date).
    const state = exampleState()
    const intent = parseIntentDeterministic('I want to move abroad.')
    const historicalPlan = buildPlan(state, intent, [], '2025-06-01')
    const recomputedPlan = buildPlan(state, intent, [], '2025-06-01')
    expect(historicalPlan.policySnapshotId).toBe(recomputedPlan.policySnapshotId)
    expect(historicalPlan.policySnapshotId).toBe('snap-2024-11')
  })
})

// ===========================================================================
// 7. EVIDENCE LINKAGE
// ===========================================================================

describe('Evidence linkage', () => {
  it('every published requirement has at least one evidence id', async () => {
    for (const req of REQUIREMENTS) {
      if (req.verification === 'OFFICIAL_CONFIRMED') {
        expect(req.evidenceIds.length).toBeGreaterThan(0)
      }
    }
  })

  it('every evidence id referenced by a requirement resolves to an Evidence record', async () => {
    for (const req of REQUIREMENTS) {
      for (const eid of req.evidenceIds) {
        expect(EVIDENCE.find((e) => e.id === eid), `evidence ${eid} not found for req ${req.id}`).toBeDefined()
      }
    }
  })

  it('every program in the current snapshot has evidence via its requirements', async () => {
    const currentPrograms = getProgramsInSnapshot('snap-2024-11')
    for (const p of currentPrograms) {
      const reqEv = p.requirementIds.flatMap((rid) => getRequirement(rid)?.evidenceIds ?? [])
      expect(reqEv.length, `program ${p.id} has no evidence`).toBeGreaterThan(0)
    }
  })

  it('every source in the source registry has at least one evidence id', async () => {
    for (const src of SOURCES) {
      expect(src.evidenceIds.length).toBeGreaterThan(0)
    }
  })
})

// ===========================================================================
// 8. AI EXTRACTION BOUNDARIES
// ===========================================================================

describe('AI extraction boundaries', () => {
  it('AI_EXTRACTED requirements are NOT authoritative', async () => {
    expect(isAuthoritative('AI_EXTRACTED')).toBe(false)
    expect(isAuthoritative('PENDING_VERIFICATION')).toBe(false)
    expect(isAuthoritative('DISPUTED')).toBe(false)
    expect(isAuthoritative('OFFICIAL_CONFIRMED')).toBe(true)
  })

  it('onlyAuthoritative filters out AI-extracted requirements', async () => {
    const reqs = [
      { id: '1', verification: 'OFFICIAL_CONFIRMED' as const },
      { id: '2', verification: 'AI_EXTRACTED' as const },
      { id: '3', verification: 'PENDING_VERIFICATION' as const },
    ]
    const auth = onlyAuthoritative(reqs)
    expect(auth).toHaveLength(1)
    expect(auth[0].id).toBe('1')
  })

  it('the verification state machine rejects illegal transitions', async () => {
    // AI_EXTRACTED → OFFICIAL_CONFIRMED is forbidden (must pass through PENDING + HUMAN_REVIEWED)
    expect(canTransition('AI_EXTRACTED', 'OFFICIAL_CONFIRMED')).toBe(false)
    expect(canTransition('AI_EXTRACTED', 'PENDING_VERIFICATION')).toBe(true)
    expect(canTransition('PENDING_VERIFICATION', 'HUMAN_REVIEWED')).toBe(true)
    expect(canTransition('HUMAN_REVIEWED', 'OFFICIAL_CONFIRMED')).toBe(true)
  })

  it('publishCandidate throws if the candidate is not OFFICIAL_CONFIRMED', async () => {
    const candidate: CandidateRequirement = {
      id: 'cand-test',
      sourceExcerpt: '...',
      proposedLabel: 'Test requirement',
      proposedKind: 'min_salary_usd',
      proposedParams: { amount: 50000 },
      rationale: 'test',
      verification: 'AI_EXTRACTED',
      extractedAt: new Date().toISOString(),
      modelSource: 'test',
    }
    expect(() =>
      publishCandidate(candidate, {
        policyVersionId: 'snap-2024-11',
        evidenceIds: ['ev-test'],
        effectiveFrom: '2024-01-01',
        id: 'req-test',
      }),
    ).toThrow(/not OFFICIAL_CONFIRMED/)
  })

  it('publishCandidate succeeds for an OFFICIAL_CONFIRMED candidate', async () => {
    const candidate: CandidateRequirement = {
      id: 'cand-test-2',
      sourceExcerpt: '...',
      proposedLabel: 'Test requirement',
      proposedKind: 'min_salary_usd',
      proposedParams: { amount: 50000 },
      rationale: 'test',
      verification: 'OFFICIAL_CONFIRMED',
      extractedAt: new Date().toISOString(),
      modelSource: 'test',
    }
    const req = publishCandidate(candidate, {
      policyVersionId: 'snap-2024-11',
      evidenceIds: ['ev-test'],
      effectiveFrom: '2024-01-01',
      id: 'req-test-2',
    })
    expect(req.verification).toBe('OFFICIAL_CONFIRMED')
    expect(req.id).toBe('req-test-2')
  })

  it('extractCandidateRequirements returns candidates with verification = AI_EXTRACTED', async () => {
    // This calls the LLM if available; if not, returns empty (no candidates).
    // Either way, no candidate is authoritative.
    const result = await extractCandidateRequirements({
      url: 'https://example.com/source',
      title: 'Test source',
      excerpt: 'Applicants must earn at least EUR 50,000 per year.',
    })
    for (const c of result.candidates) {
      expect(c.verification).toBe('AI_EXTRACTED')
      expect(isAuthoritative(c.verification)).toBe(false)
    }
  })
})

// ===========================================================================
// BONUS: MobilityGraph operations
// ===========================================================================

describe('MobilityGraph', () => {
  it('getNeighbors returns statuses reachable in one transition', async () => {
    const g = buildGraph('snap-2024-11')
    const neighbors = getNeighbors(g, 'de-blue-card-residence')
    expect(neighbors.map((s) => s.id)).toContain('de-settlement')
  })

  it('findPaths discovers current → PR → citizenship chains', async () => {
    const g = buildGraph('snap-2024-11')
    const paths = findPaths(g, 'de-blue-card-residence', 'de-citizenship')
    expect(paths.length).toBeGreaterThan(0)
    // The path should go blue-card → settlement → citizenship
    const firstPath = paths[0]
    expect(firstPath.length).toBe(2) // bc→settlement, settlement→citizenship
    expect(firstPath[0].fromStatusId).toBe('de-blue-card-residence')
    expect(firstPath[1].toStatusId).toBe('de-citizenship')
  })

  it('getReachableStatuses includes all downstream statuses', async () => {
    const g = buildGraph('snap-2024-11')
    const reachable = getReachableStatuses(g, 'de-blue-card-residence')
    expect(reachable.has('de-settlement')).toBe(true)
    expect(reachable.has('de-citizenship')).toBe(true)
  })

  it('UAE Virtual Work has no path to citizenship (terminal loop)', () => {
    const g = buildGraph('snap-2024-11')
    const reachable = getReachableStatuses(g, 'ae-virtual-work')
    // Only reaches itself (renew loop) — no citizenship
    const citizenshipReachable = Array.from(reachable).some((id) => id.includes('citizenship'))
    expect(citizenshipReachable).toBe(false)
  })
})

// ===========================================================================
// BONUS: Source change detection
// ===========================================================================

describe('Source change detection', () => {
  it('contentHash is stable for identical content', async () => {
    expect(contentHash('Hello World')).toBe(contentHash('Hello World'))
  })

  it('contentHash is stable under whitespace normalization', async () => {
    expect(contentHash('Hello   World')).toBe(contentHash('Hello World'))
    expect(contentHash('  hello world  ')).toBe(contentHash('HELLO WORLD'))
  })

  it('detectSourceChange returns UNCHANGED for identical hashes', async () => {
    const prev = { id: '1', sourceId: 's1', retrievedAt: '2024-01-01', contentHash: 'abc123', contentLocation: 'inline', changeType: 'UNCHANGED' }
    expect(detectSourceChange(prev, { contentHash: 'abc123' })).toBe('UNCHANGED')
    expect(detectSourceChange(prev, { contentHash: 'different' })).toBe('TEXT_CHANGED')
    expect(detectSourceChange(null, { contentHash: 'abc123' })).toBe('TEXT_CHANGED')
  })

  it('classifyChange flags policy-keyword+number changes as POSSIBLE_POLICY_CHANGE', async () => {
    const old = 'The minimum salary threshold is EUR 45,300.'
    const next = 'The minimum salary threshold is EUR 52,000.'
    expect(classifyChange(old, next)).toBe('POSSIBLE_POLICY_CHANGE')
  })

  it('classifyChange returns UNCHANGED for identical text', async () => {
    expect(classifyChange('same text', 'same text')).toBe('UNCHANGED')
  })
})

// ===========================================================================
// BONUS: Impact analysis
// ===========================================================================

describe('Impact analysis', () => {
  it('getPolicyImpact for a THRESHOLD_CHANGE returns affected routes', async () => {
    const diff = comparePolicySnapshots('snap-2024-11', 'snap-2026-01')
    const thresholdChange = diff.changes.find((c) => c.kind === 'THRESHOLD_CHANGED')!
    const impact = getPolicyImpact(thresholdChange, [])
    expect(impact.affectedRouteIds.length).toBeGreaterThan(0)
    expect(impact.summary).toContain('route')
  })

  it('getPolicyImpact for PROGRAM_SUSPENDED returns the program\'s transitions', async () => {
    const diff = comparePolicySnapshots('snap-2024-11', 'snap-2026-01')
    const suspension = diff.changes.find((c) => c.kind === 'PROGRAM_SUSPENDED')!
    const impact = getPolicyImpact(suspension, [])
    expect(impact.affectedTransitionIds.length).toBeGreaterThan(0)
  })
})
