// Tests for the corrected runtime policy overlay system.
//
// These tests verify the FIXES applied in this milestone:
//   - No hardcoded snap-2026-01 in production paths
//   - No simulationMode=true in production impact analysis
//   - Base-aware overlay application + validation
//   - Plan diff (deterministic)
//   - Overlay validation (oldValue mismatch rejected)
//   - Hash correctness (resolved state, not just ids)
//   - Replay reproducibility

import { describe, it, expect } from 'vitest'
import {
  resolveRuntimePolicy,
  validateOverlayAgainstBase,
  runtimePolicyHash,
  applyOverlays,
} from '@/lib/policy/runtime-resolver'
import { diffPlans, summarizePlanDiff } from '@/lib/policy/plan-diff'
import { replayDecision, plansMatch } from '@/lib/policy/replay'
import { buildPlan } from '@/lib/engine/optimize'
import { exampleState } from '@/lib/domain/state'
import { parseIntentDeterministic } from '@/lib/domain/intent'
import { REQUIREMENTS, PROGRAMS, TRANSITIONS } from '@/lib/policy/knowledge'
import { getRequirementsInSnapshot } from '@/lib/policy/snapshot'
import type { PolicyOverlay } from '@/lib/policy/types'

// ===========================================================================
// 1. NO HARDCODED SNAPSHOTS IN PRODUCTION PATHS
// ===========================================================================

describe('No hardcoded snapshots in production paths', () => {
  it('resolveRuntimePolicy never returns snap-2026-01 by default (SIMULATED excluded)', async () => {
    const snap = await resolveRuntimePolicy({ asOf: '2026-06-01', overlays: [] })
    expect(snap.baseSnapshotId).not.toBe('snap-2026-01')
    expect(snap.provenance).toBe('AUTHORITATIVE')
  })

  it('resolveRuntimePolicy returns snap-2026-01 only with simulationMode=true', async () => {
    const snap = await resolveRuntimePolicy({ asOf: '2026-06-01', simulationMode: true, overlays: [] })
    expect(snap.baseSnapshotId).toBe('snap-2026-01')
    expect(snap.provenance).toBe('SIMULATED')
  })
})

// ===========================================================================
// 2. BASE-AWARE OVERLAY VALIDATION
// ===========================================================================

describe('Base-aware overlay validation', () => {
  it('accepts an overlay with correct oldValue', () => {
    const overlay: PolicyOverlay = {
      id: 'o', publicationId: 'p', parentPolicyVersion: 'snap-2024-11',
      jurisdictionId: 'global', effectiveFrom: '2024-01-01', provenance: 'AUTHORITATIVE',
      changes: [{
        entityType: 'requirement', entityId: 'req-de-bc-salary-v1', entityLabel: 'salary',
        field: 'amount', oldValue: 61000, newValue: 70000,
      }],
      contentHash: 'h', createdAt: new Date().toISOString(),
    }
    const result = validateOverlayAgainstBase(overlay, REQUIREMENTS, PROGRAMS, TRANSITIONS)
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('rejects an overlay with incorrect oldValue', () => {
    const overlay: PolicyOverlay = {
      id: 'o', publicationId: 'p', parentPolicyVersion: 'snap-2024-11',
      jurisdictionId: 'global', effectiveFrom: '2024-01-01', provenance: 'AUTHORITATIVE',
      changes: [{
        entityType: 'requirement', entityId: 'req-de-bc-salary-v1', entityLabel: 'salary',
        field: 'amount', oldValue: 99999, newValue: 70000, // wrong oldValue
      }],
      contentHash: 'h', createdAt: new Date().toISOString(),
    }
    const result = validateOverlayAgainstBase(overlay, REQUIREMENTS, PROGRAMS, TRANSITIONS)
    expect(result.valid).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
    expect(result.errors[0]).toContain('oldValue')
  })

  it('rejects an overlay referencing a non-existent entity', () => {
    const overlay: PolicyOverlay = {
      id: 'o', publicationId: 'p', parentPolicyVersion: 'snap-2024-11',
      jurisdictionId: 'global', effectiveFrom: '2024-01-01', provenance: 'AUTHORITATIVE',
      changes: [{
        entityType: 'requirement', entityId: 'req-nonexistent', entityLabel: 'fake',
        field: 'amount', newValue: 70000,
      }],
      contentHash: 'h', createdAt: new Date().toISOString(),
    }
    const result = validateOverlayAgainstBase(overlay, REQUIREMENTS, PROGRAMS, TRANSITIONS)
    expect(result.valid).toBe(false)
    expect(result.errors[0]).toContain('not found')
  })

  it('accepts an overlay without oldValue (no validation check)', () => {
    const overlay: PolicyOverlay = {
      id: 'o', publicationId: 'p', parentPolicyVersion: 'snap-2024-11',
      jurisdictionId: 'global', effectiveFrom: '2024-01-01', provenance: 'AUTHORITATIVE',
      changes: [{
        entityType: 'requirement', entityId: 'req-de-bc-salary-v1', entityLabel: 'salary',
        field: 'amount', newValue: 70000, // no oldValue
      }],
      contentHash: 'h', createdAt: new Date().toISOString(),
    }
    const result = validateOverlayAgainstBase(overlay, REQUIREMENTS, PROGRAMS, TRANSITIONS)
    expect(result.valid).toBe(true)
  })
})

// ===========================================================================
// 3. HASH CORRECTNESS (resolved state, not just ids)
// ===========================================================================

describe('Hash correctness', () => {
  it('same resolved state → same hash', () => {
    const reqs = getRequirementsInSnapshot('snap-2024-11')
    const h1 = runtimePolicyHash('snap-2024-11', [], '2025-06-01', reqs, PROGRAMS, TRANSITIONS)
    const h2 = runtimePolicyHash('snap-2024-11', [], '2025-06-01', reqs, PROGRAMS, TRANSITIONS)
    expect(h1).toBe(h2)
  })

  it('different resolved requirements → different hash', () => {
    const reqs1 = getRequirementsInSnapshot('snap-2024-11')
    const reqs2 = reqs1.map((r) =>
      r.id === 'req-de-bc-salary-v1' ? { ...r, params: { ...r.params, amount: 99999 } } : r,
    )
    const h1 = runtimePolicyHash('snap-2024-11', [], '2025-06-01', reqs1, PROGRAMS, TRANSITIONS)
    const h2 = runtimePolicyHash('snap-2024-11', [], '2025-06-01', reqs2, PROGRAMS, TRANSITIONS)
    expect(h1).not.toBe(h2)
  })

  it('different overlay ids → different hash (even with same resolved state)', () => {
    const reqs = getRequirementsInSnapshot('snap-2024-11')
    const h1 = runtimePolicyHash('snap-2024-11', ['pub-1'], '2025-06-01', reqs, PROGRAMS, TRANSITIONS)
    const h2 = runtimePolicyHash('snap-2024-11', ['pub-2'], '2025-06-01', reqs, PROGRAMS, TRANSITIONS)
    expect(h1).not.toBe(h2)
  })
})

// ===========================================================================
// 4. PLAN DIFF
// ===========================================================================

describe('Plan diff', () => {
  it('produces no changes for identical plans', () => {
    const state = exampleState()
    const intent = parseIntentDeterministic('I want to move abroad.')
    const plan = buildPlan(state, intent, [], '2025-06-01')
    const diff = diffPlans(plan, plan)
    expect(diff.bestRouteChanged).toBe(false)
    expect(diff.routesOpened).toHaveLength(0)
    expect(diff.routesClosed).toHaveLength(0)
    expect(diff.newBlockers).toHaveLength(0)
  })

  it('detects a best-route change', () => {
    const state = exampleState()
    const intent = parseIntentDeterministic('I want to move abroad.')
    const plan1 = buildPlan(state, intent, [], '2025-06-01')
    // Modify the plan to simulate a different best route
    const plan2 = {
      ...plan1,
      recommendation: { ...plan1.recommendation, bestRouteId: 'route-fake' },
    }
    const diff = diffPlans(plan1, plan2)
    expect(diff.bestRouteChanged).toBe(true)
  })

  it('summarizes the diff', () => {
    const state = exampleState()
    const intent = parseIntentDeterministic('I want to move abroad.')
    const plan = buildPlan(state, intent, [], '2025-06-01')
    const diff = diffPlans(plan, plan)
    expect(summarizePlanDiff(diff)).toContain('No material changes')
  })
})

// ===========================================================================
// 5. REPLAY REPRODUCIBILITY
// ===========================================================================

describe('Decision replay', () => {
  it('replaying the same inputs produces a matching plan', async () => {
    const state = exampleState()
    const intent = parseIntentDeterministic('I want to move abroad.')
    const asOf = '2025-06-01'

    // Original plan
    const original = await replayDecision({ state, intent, asOfDate: asOf })

    // Replay
    const replayed = await replayDecision({ state, intent, asOfDate: asOf })

    // They should match
    const match = plansMatch(original, replayed)
    expect(match.match).toBe(true)
    expect(match.differences).toHaveLength(0)
  })

  it('replay produces the same policy hash', async () => {
    const state = exampleState()
    const intent = parseIntentDeterministic('I want to move abroad.')
    const original = await replayDecision({ state, intent, asOfDate: '2025-06-01' })
    const replayed = await replayDecision({ state, intent, asOfDate: '2025-06-01' })
    expect(replayed.runtimePolicyHash).toBe(original.runtimePolicyHash)
  })
})

// ===========================================================================
// 6. OVERLAY APPLICATION IMMUTABILITY
// ===========================================================================

describe('Overlay application immutability', () => {
  it('applyOverlays does not mutate the base arrays', () => {
    const originalReq = REQUIREMENTS.find((r) => r.id === 'req-de-bc-salary-v1')!
    const originalAmount = originalReq.params.amount

    const overlay: PolicyOverlay = {
      id: 'o', publicationId: 'p', parentPolicyVersion: 'snap-2024-11',
      jurisdictionId: 'global', effectiveFrom: '2024-01-01', provenance: 'AUTHORITATIVE',
      changes: [{
        entityType: 'requirement', entityId: 'req-de-bc-salary-v1', entityLabel: 'salary',
        field: 'amount', newValue: 99999,
      }],
      contentHash: 'h', createdAt: new Date().toISOString(),
    }
    applyOverlays([overlay], REQUIREMENTS, PROGRAMS, TRANSITIONS)

    // Original is unchanged
    expect(REQUIREMENTS.find((r) => r.id === 'req-de-bc-salary-v1')!.params.amount).toBe(originalAmount)
  })
})

// ===========================================================================
// 7. RESOLVER APPLIES OVERLAYS TO BASE SNAPSHOT ENTITIES (not global)
// ===========================================================================

describe('Base-snapshot-aware resolution', () => {
  it('the resolver loads base-snapshot-specific entities', async () => {
    const snap = await resolveRuntimePolicy({ asOf: '2025-06-01', overlays: [] })
    const baseReqs = getRequirementsInSnapshot(snap.baseSnapshotId)
    // The resolved requirements should match the base snapshot's requirements
    expect(snap.requirements.length).toBe(baseReqs.length)
  })

  it('an overlay applied to the 2024 base does not mix with 2026 entities', async () => {
    const overlay: PolicyOverlay = {
      id: 'o', publicationId: 'p', parentPolicyVersion: 'snap-2024-11',
      jurisdictionId: 'global', effectiveFrom: '2024-01-01', provenance: 'AUTHORITATIVE',
      changes: [{
        entityType: 'requirement', entityId: 'req-de-bc-salary-v1', entityLabel: 'salary',
        field: 'amount', oldValue: 61000, newValue: 70000,
      }],
      contentHash: 'h', createdAt: new Date().toISOString(),
    }
    const snap = await resolveRuntimePolicy({ asOf: '2025-06-01', overlays: [overlay] })
    // The base is 2024, not 2026
    expect(snap.baseSnapshotId).toBe('snap-2024-11')
    // The salary requirement has the overlay's value
    const salaryReq = snap.requirements.find((r) => r.id === 'req-de-bc-salary-v1')
    expect(salaryReq!.params.amount).toBe(70000)
    // The resolved requirements count matches the 2024 base (not the global array)
    const baseReqs = getRequirementsInSnapshot('snap-2024-11')
    expect(snap.requirements.length).toBe(baseReqs.length)
  })
})
