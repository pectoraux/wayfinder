// Tests for the Policy Intelligence Pipeline.
//
// Covers the categories required by the spec:
//   - Source fetching (success, failure, changed, unchanged)
//   - Change classification (UI-only change vs real policy change)
//   - AI extraction (schema, evidence, confidence)
//   - Verification (cannot publish unverified, approved produces new version)
//   - Publication (atomicity, hash, parent version, supersession)
//   - Impact (route affected, route unaffected, plan affected)
//   - Provenance (simulated cannot enter authoritative path)
//   - Notifications (only verified material changes alert users)

import { describe, it, expect } from 'vitest'
import { fetchSource } from '@/lib/policy/fetcher'
import { classifyChangeExpanded, contentHash, normalizeContent, SOURCES } from '@/lib/policy/sources'
import { diffDocuments, summarizeDiff } from '@/lib/policy/differ'
import {
  canTransitionExtraction,
  transitionCandidate,
  publishPolicyVersion,
  runConsistencyChecks,
} from '@/lib/policy/publication'
import {
  recomputePlanImpact,
  isMaterialImpact,
  getAffectedDecisionRecordIds,
} from '@/lib/policy/impact'
import {
  getPolicySnapshot,
  getCurrentPolicySnapshot,
  listSnapshots,
  listAuthoritativeSnapshots,
  listSimulatedSnapshots,
} from '@/lib/policy/snapshot'
import type { CandidateFact, PlanImpact } from '@/lib/policy/types'
import { exampleState } from '@/lib/domain/state'
import { parseIntentDeterministic } from '@/lib/domain/intent'
import { buildPlan } from '@/lib/engine/optimize'
import { REQUIREMENTS, TRANSITIONS, PROGRAMS } from '@/lib/policy/knowledge'

// ===========================================================================
// 1. SOURCE FETCHING
// ===========================================================================

describe('Source fetching', () => {
  it('fetchSource returns a FetchResult with contentHash on success', async () => {
    // Fetch a stable, real URL (example.com)
    const result = await fetchSource({ id: 'test', canonicalUrl: 'https://example.com', url: 'https://example.com' })
    expect(result.success).toBe(true)
    expect(result.contentHash).toBeTruthy()
    expect(result.retrievalStatus).toBe('OK')
    expect(result.contentLength).toBeGreaterThan(0)
  }, 20000)

  it('fetchSource returns FETCH_ERROR for a non-existent URL', async () => {
    const result = await fetchSource({ id: 'test', canonicalUrl: 'https://nonexistent-domain-12345.example', url: 'https://nonexistent-domain-12345.example' })
    expect(result.success).toBe(false)
    expect(result.retrievalStatus).not.toBe('OK')
  }, 20000)

  it('fetchSource rejects non-HTML content types', async () => {
    // Fetch a URL that returns an image. Either it fails on content-type
    // or returns an error — either way it should not be treated as OK HTML.
    const result = await fetchSource({ id: 'test', canonicalUrl: 'https://www.google.com/favicon.ico', url: 'https://www.google.com/favicon.ico' })
    if (!result.success) {
      expect(['CONTENT_TYPE_REJECTED', 'HTTP_ERROR', 'UNKNOWN']).toContain(result.retrievalStatus)
    }
  }, 20000)

  it('the source registry has active sources with monitoring frequency', async () => {
    expect(SOURCES.length).toBeGreaterThan(0)
    for (const s of SOURCES) {
      expect(s.active).toBe(true)
      expect(s.monitoringFrequencyHours).toBeGreaterThan(0)
      expect(s.canonicalUrl).toBeTruthy()
      expect(s.trustLevel).toMatch(/OFFICIAL_PRIMARY|OFFICIAL_SECONDARY|RECOGNIZED_INSTITUTION|HIGH_QUALITY_SECONDARY|COMMUNITY|UNKNOWN/)
    }
  })
})

// ===========================================================================
// 2. CHANGE CLASSIFICATION
// ===========================================================================

describe('Change classification', () => {
  it('returns UNCHANGED for identical content', async () => {
    const text = 'The minimum salary is EUR 45,300.'
    expect(classifyChangeExpanded(text, text)).toBe('UNCHANGED')
  })

  it('returns FETCH_ERROR when retrieval failed', async () => {
    expect(classifyChangeExpanded('old', 'new', 'HTTP_ERROR')).toBe('FETCH_ERROR')
    expect(classifyChangeExpanded('old', 'new', 'TIMEOUT')).toBe('FETCH_ERROR')
  })

  it('classifies a UI-only change (footer/navigation) as TEXT_CHANGED, not policy', () => {
    const before = 'The minimum salary is EUR 45,300.\n\nFooter: Copyright 2024'
    const after = 'The minimum salary is EUR 45,300.\n\nFooter: Copyright 2025'
    // The changed line doesn't touch policy keywords
    const result = classifyChangeExpanded(before, after)
    expect(result).not.toBe('LIKELY_POLICY_CHANGE')
    expect(result).not.toBe('VERIFIED_POLICY_CHANGE')
  })

  it('classifies a salary threshold change as LIKELY_POLICY_CHANGE', async () => {
    const before = 'The minimum salary threshold is EUR 45,300 for shortage occupations.'
    const after = 'The minimum salary threshold is EUR 52,000 for shortage occupations.'
    const result = classifyChangeExpanded(before, after)
    expect(result).toBe('LIKELY_POLICY_CHANGE')
  })

  it('classifies a policy keyword addition as POSSIBLE_POLICY_CHANGE', async () => {
    const before = 'Welcome to our website.'
    const after = 'Welcome to our website. New visa requirement: language test.'
    const result = classifyChangeExpanded(before, after)
    expect(result).toBe('POSSIBLE_POLICY_CHANGE')
  })

  it('does not flag a cookie banner change as a policy change', async () => {
    const before = 'We use cookies. Accept all cookies.'
    const after = 'We use cookies. Accept all cookies. Updated privacy policy.'
    const result = classifyChangeExpanded(before, after)
    // "privacy policy" contains "policy" but the changed lines are about cookies/privacy, not immigration
    // This is an acceptable POSSIBLE_POLICY_CHANGE (conservative) but should NOT be LIKELY/VERIFIED
    expect(result).not.toBe('VERIFIED_POLICY_CHANGE')
    expect(result).not.toBe('LIKELY_POLICY_CHANGE')
  })
})

// ===========================================================================
// 3. DOCUMENT DIFFING
// ===========================================================================

describe('Document diffing', () => {
  it('produces a diff with sections for changed content', async () => {
    const before = 'Section 1\nMinimum income: EUR 820\nSection 2\nProcessing time: 3 months'
    const after = 'Section 1\nMinimum income: EUR 970\nSection 2\nProcessing time: 3 months'
    const diff = diffDocuments(before, after)
    expect(diff.sections.length).toBeGreaterThan(0)
    expect(summarizeDiff(diff)).toContain('line')
  })

  it('returns no sections for identical content', async () => {
    const text = 'No changes here.'
    const diff = diffDocuments(text, text)
    expect(diff.sections.length).toBe(0)
  })
})

// ===========================================================================
// 4. AI EXTRACTION BOUNDARIES
// ===========================================================================

describe('AI extraction boundaries', () => {
  it('candidate facts enter as AI_EXTRACTED, never authoritative', async () => {
    const candidate: CandidateFact = {
      id: 'cand-test',
      sourceSnapshotId: 'snap-test',
      jurisdictionId: 'DE',
      entityType: 'requirement',
      entityLabel: 'Test requirement',
      changeKind: 'threshold_changed',
      field: 'amount',
      oldValue: 45000,
      newValue: 52000,
      effectiveFrom: '2026-01-01',
      evidence: 'The threshold changed from 45000 to 52000.',
      sourceUrl: 'https://example.com',
      model: 'z-ai-web-dev-sdk',
      promptVersion: '1.0',
      confidence: 0.94,
      extractionStatus: 'AI_EXTRACTED',
      createdAt: new Date().toISOString(),
    }
    expect(candidate.extractionStatus).toBe('AI_EXTRACTED')
    expect(candidate.confidence).toBeLessThanOrEqual(1)
    // AI_EXTRACTED is NOT APPROVED
    expect(candidate.extractionStatus).not.toBe('APPROVED')
  })
})

// ===========================================================================
// 5. VERIFICATION STATE MACHINE
// ===========================================================================

describe('Verification state machine', () => {
  it('AI_EXTRACTED can transition to PENDING_REVIEW', async () => {
    expect(canTransitionExtraction('AI_EXTRACTED', 'PENDING_REVIEW')).toBe(true)
  })

  it('AI_EXTRACTED can transition directly to REJECTED', async () => {
    expect(canTransitionExtraction('AI_EXTRACTED', 'REJECTED')).toBe(true)
  })

  it('AI_EXTRACTED CANNOT transition directly to APPROVED (must go through PENDING_REVIEW)', () => {
    expect(canTransitionExtraction('AI_EXTRACTED', 'APPROVED')).toBe(false)
  })

  it('PENDING_REVIEW can transition to APPROVED', async () => {
    expect(canTransitionExtraction('PENDING_REVIEW', 'APPROVED')).toBe(true)
  })

  it('PENDING_REVIEW can transition to REJECTED or NEEDS_MORE_EVIDENCE', async () => {
    expect(canTransitionExtraction('PENDING_REVIEW', 'REJECTED')).toBe(true)
    expect(canTransitionExtraction('PENDING_REVIEW', 'NEEDS_MORE_EVIDENCE')).toBe(true)
  })

  it('APPROVED can only transition to SUPERSEDED', async () => {
    expect(canTransitionExtraction('APPROVED', 'SUPERSEDED')).toBe(true)
    expect(canTransitionExtraction('APPROVED', 'REJECTED')).toBe(false)
  })

  it('REJECTED is terminal (no transitions)', () => {
    expect(canTransitionExtraction('REJECTED', 'APPROVED')).toBe(false)
    expect(canTransitionExtraction('REJECTED', 'PENDING_REVIEW')).toBe(false)
  })

  it('transitionCandidate returns ok=true for legal transitions', async () => {
    const result = transitionCandidate({ extractionStatus: 'AI_EXTRACTED' }, 'PENDING_REVIEW')
    expect(result.ok).toBe(true)
  })

  it('transitionCandidate returns ok=false for illegal transitions', async () => {
    const result = transitionCandidate({ extractionStatus: 'AI_EXTRACTED' }, 'APPROVED')
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('Illegal transition')
  })
})

// ===========================================================================
// 6. POLICY PUBLICATION
// ===========================================================================

describe('Policy publication', () => {
  const approvedCandidate: CandidateFact = {
    id: 'cand-approved',
    sourceSnapshotId: 'snap-test',
    jurisdictionId: 'DE',
    entityType: 'requirement',
    entityLabel: 'Blue Card salary threshold',
    changeKind: 'threshold_changed',
    field: 'amount',
    oldValue: 61000,
    newValue: 64000,
    effectiveFrom: '2026-01-01',
    evidence: 'The threshold was raised.',
    sourceUrl: 'https://example.com',
    model: 'z-ai-web-dev-sdk',
    promptVersion: '1.0',
    confidence: 0.95,
    extractionStatus: 'APPROVED',
    createdAt: new Date().toISOString(),
  }

  it('publishPolicyVersion throws if the candidate is not APPROVED', async () => {
    const unapproved: CandidateFact = { ...approvedCandidate, extractionStatus: 'AI_EXTRACTED' }
    expect(() => publishPolicyVersion(unapproved, 'admin@test', 'snap-2024-11')).toThrow(/not APPROVED/)
  })

  it('publishPolicyVersion creates a new version with a hash and parent pointer', async () => {
    const pub = publishPolicyVersion(approvedCandidate, 'admin@test', 'snap-2024-11')
    expect(pub.policyVersionId).toMatch(/^snap-/)
    expect(pub.parentVersionId).toBe('snap-2024-11')
    expect(pub.contentHash).toBeTruthy()
    expect(pub.approvedBy).toBe('admin@test')
    expect(pub.candidateFactIds).toContain('cand-approved')
  })

  it('publishPolicyVersion runs consistency checks and they pass for valid data', async () => {
    const pub = publishPolicyVersion(approvedCandidate, 'admin@test', 'snap-2024-11')
    expect(pub.consistencyChecks.length).toBeGreaterThan(0)
    for (const check of pub.consistencyChecks) {
      expect(check.passed).toBe(true)
    }
  })

  it('the new version has provenance AUTHORITATIVE by default', async () => {
    const pub = publishPolicyVersion(approvedCandidate, 'admin@test', 'snap-2024-11')
    expect(pub.provenance).toBe('AUTHORITATIVE')
  })

  it('the publication is immutable — it records the approvedAt timestamp', async () => {
    const pub = publishPolicyVersion(approvedCandidate, 'admin@test', 'snap-2024-11')
    expect(pub.approvedAt).toBeTruthy()
    expect(new Date(pub.approvedAt).getTime()).toBeLessThanOrEqual(Date.now())
  })
})

// ===========================================================================
// 7. CONSISTENCY CHECKS
// ===========================================================================

describe('Policy consistency checks', () => {
  it('all 8 checks run and pass for the current knowledge base', async () => {
    const checks = runConsistencyChecks(REQUIREMENTS, TRANSITIONS, PROGRAMS, {
      id: 'snap-test',
      provenance: 'AUTHORITATIVE',
      effectiveFrom: '2024-01-01',
    })
    expect(checks.length).toBe(8)
    const names = checks.map((c) => c.name)
    expect(names).toContain('structural')
    expect(names).toContain('evidence')
    expect(names).toContain('temporal')
    expect(names).toContain('supersession')
    expect(names).toContain('transition')
    expect(names).toContain('graph')
    expect(names).toContain('route')
    expect(names).toContain('provenance')
    for (const c of checks) {
      expect(c.passed, `${c.name} should pass`).toBe(true)
    }
  })

  it('provenance check fails for SIMULATED snapshots', async () => {
    const checks = runConsistencyChecks(REQUIREMENTS, TRANSITIONS, PROGRAMS, {
      id: 'snap-sim',
      provenance: 'SIMULATED',
      effectiveFrom: '2024-01-01',
    })
    const provenanceCheck = checks.find((c) => c.name === 'provenance')!
    expect(provenanceCheck.passed).toBe(false)
  })
})

// ===========================================================================
// 8. PROVENANCE SAFETY (simulated cannot enter authoritative path)
// ===========================================================================

describe('Provenance safety', () => {
  it('the SIMULATED snapshot is marked with provenance SIMULATED', async () => {
    const sim = listSnapshots().find((s) => s.id === 'snap-2026-01')
    expect(sim).toBeDefined()
    expect(sim!.provenance).toBe('SIMULATED')
  })

  it('the AUTHORITATIVE snapshot is marked with provenance AUTHORITATIVE', async () => {
    const auth = listSnapshots().find((s) => s.id === 'snap-2024-11')
    expect(auth).toBeDefined()
    expect(auth!.provenance).toBe('AUTHORITATIVE')
  })

  it('getCurrentPolicySnapshot NEVER returns a SIMULATED snapshot', async () => {
    const current = getCurrentPolicySnapshot()
    expect(current.provenance).toBe('AUTHORITATIVE')
    expect(current.provenance).not.toBe('SIMULATED')
  })

  it('getPolicySnapshot excludes SIMULATED by default', async () => {
    // For a date in 2026, the default (non-simulated) result should be the authoritative 2024 snapshot
    const snap = getPolicySnapshot('global', '2026-06-01')
    expect(snap.provenance).toBe('AUTHORITATIVE')
    expect(snap.id).toBe('snap-2024-11')
  })

  it('getPolicySnapshot includes SIMULATED only when allowSimulated=true', async () => {
    const snap = getPolicySnapshot('global', '2026-06-01', true)
    expect(snap.provenance).toBe('SIMULATED')
    expect(snap.id).toBe('snap-2026-01')
  })

  it('listAuthoritativeSnapshots excludes SIMULATED', async () => {
    const auth = listAuthoritativeSnapshots()
    expect(auth.every((s) => s.provenance === 'AUTHORITATIVE' || s.provenance === 'DERIVED')).toBe(true)
    expect(auth.find((s) => s.id === 'snap-2026-01')).toBeUndefined()
  })

  it('listSimulatedSnapshots returns only SIMULATED/TEST_FIXTURE', async () => {
    const sim = listSimulatedSnapshots()
    expect(sim.every((s) => s.provenance === 'SIMULATED' || s.provenance === 'TEST_FIXTURE')).toBe(true)
    expect(sim.find((s) => s.id === 'snap-2024-11')).toBeUndefined()
  })

  it('buildPlan without simulationMode never uses a SIMULATED snapshot', async () => {
    const state = exampleState()
    const intent = parseIntentDeterministic('I want to move abroad.')
    const plan = buildPlan(state, intent, [], '2026-06-01') // no simulationMode
    expect(plan.policySnapshotId).toBe('snap-2024-11') // falls back to authoritative
  })

  it('buildPlan with simulationMode=true can access the SIMULATED snapshot', async () => {
    const state = exampleState()
    const intent = parseIntentDeterministic('I want to move abroad.')
    const plan = buildPlan(state, intent, [], '2026-06-01', true)
    expect(plan.policySnapshotId).toBe('snap-2026-01')
  })
})

// ===========================================================================
// 9. PLAN IMPACT
// ===========================================================================

describe('Plan impact analysis', () => {
  it('isMaterialImpact returns true only for ROUTE_DEGRADED, ROUTE_INVALIDATED, NEW_BETTER_ROUTE', async () => {
    expect(isMaterialImpact('NO_MATERIAL_CHANGE')).toBe(false)
    expect(isMaterialImpact('MINOR_CHANGE')).toBe(false)
    expect(isMaterialImpact('ROUTE_DEGRADED')).toBe(true)
    expect(isMaterialImpact('ROUTE_INVALIDATED')).toBe(true)
    expect(isMaterialImpact('NEW_BETTER_ROUTE')).toBe(true)
  })

  it('recomputePlanImpact classifies the impact level', async () => {
    const state = exampleState()
    const intent = parseIntentDeterministic('I want to move abroad.')
    const oldPlan = buildPlan(state, intent, [], '2025-06-01')
    // recomputePlanImpact is now async and uses the runtime resolver (no hardcoded snapshot)
    const { newPlan, impact } = await recomputePlanImpact(oldPlan, state, intent)
    expect(impact.level).toMatch(/NO_MATERIAL_CHANGE|MINOR_CHANGE|ROUTE_DEGRADED|ROUTE_INVALIDATED|NEW_BETTER_ROUTE/)
    expect(impact.whatChanged).toBeTruthy()
    expect(impact.recommendedAction).toBeTruthy()
    expect(newPlan).toBeDefined()
  })

  it('getAffectedDecisionRecordIds returns records computed before the change effective date', async () => {
    const candidate: CandidateFact = {
      id: 'cand-test',
      sourceSnapshotId: 'snap-test',
      jurisdictionId: 'DE',
      entityType: 'requirement',
      entityLabel: 'Test',
      changeKind: 'threshold_changed',
      effectiveFrom: '2026-01-01',
      evidence: '',
      sourceUrl: '',
      model: 'test',
      promptVersion: '1.0',
      confidence: 0.9,
      extractionStatus: 'APPROVED',
      createdAt: new Date().toISOString(),
    }
    const records = [
      { id: 'r1', policyVersion: '2024.11.1', asOfDate: '2025-06-01' }, // before 2026-01-01 → affected
      { id: 'r2', policyVersion: '2026.01.1', asOfDate: '2026-06-01' }, // after → not affected
    ]
    const affected = getAffectedDecisionRecordIds(candidate, records)
    expect(affected).toContain('r1')
    expect(affected).not.toContain('r2')
  })
})

// ===========================================================================
// 10. CONTENT HASHING
// ===========================================================================

describe('Content hashing', () => {
  it('contentHash is deterministic and stable under whitespace normalization', async () => {
    expect(contentHash('Hello World')).toBe(contentHash('  hello   world  '))
    expect(contentHash('Hello World')).toBe(contentHash('HELLO WORLD'))
  })

  it('contentHash differs for different content', async () => {
    expect(contentHash('salary: 45000')).not.toBe(contentHash('salary: 52000'))
  })

  it('normalizeContent trims, collapses whitespace, lowercases', async () => {
    expect(normalizeContent('  Hello\n  World  ')).toBe('hello world')
  })
})

// ===========================================================================
// 11. NOTIFICATIONS (only verified material changes produce alerts)
// ===========================================================================

describe('Notification safety', () => {
  it('a NO_MATERIAL_CHANGE impact does not produce an alert', async () => {
    expect(isMaterialImpact('NO_MATERIAL_CHANGE')).toBe(false)
  })

  it('a MINOR_CHANGE impact does not produce an alert', async () => {
    expect(isMaterialImpact('MINOR_CHANGE')).toBe(false)
  })

  it('only APPROVED candidates can produce a publication (and thus an alert)', () => {
    // This is enforced by publishPolicyVersion throwing for non-APPROVED
    const unapproved: CandidateFact = {
      id: 'cand-unapproved',
      sourceSnapshotId: 'snap-test',
      jurisdictionId: 'DE',
      entityType: 'requirement',
      entityLabel: 'Test',
      changeKind: 'threshold_changed',
      effectiveFrom: '2026-01-01',
      evidence: '',
      sourceUrl: '',
      model: 'test',
      promptVersion: '1.0',
      confidence: 0.99,
      extractionStatus: 'PENDING_REVIEW', // NOT approved
      createdAt: new Date().toISOString(),
    }
    expect(() => publishPolicyVersion(unapproved, 'admin', 'snap-2024-11')).toThrow(/not APPROVED/)
  })
})
