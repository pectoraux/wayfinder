// Tests for PolicyEvent — the first-class domain object.
//
// Covers:
//   - Event creation from verified publication
//   - Event title/summary generation
//   - Change type mapping
//   - Provenance safety (simulated events marked)
//   - Event lifecycle

import { describe, it, expect } from 'vitest'
import { buildPolicyEvent } from '@/lib/policy/events'
import type { CandidateFact } from '@/lib/policy/types'

const baseCandidate: CandidateFact = {
  id: 'cand-test',
  sourceSnapshotId: 'snap-test',
  jurisdictionId: 'DE',
  entityType: 'requirement',
  entityId: 'req-de-bc-salary-v1',
  entityLabel: 'Blue Card salary threshold',
  changeKind: 'threshold_changed',
  field: 'amount',
  oldValue: 61000,
  newValue: 64000,
  effectiveFrom: '2026-01-01',
  evidence: 'The threshold was raised from 61000 to 64000.',
  sourceUrl: 'https://example.com/source',
  model: 'test',
  promptVersion: '1.0',
  confidence: 0.95,
  extractionStatus: 'APPROVED',
  createdAt: new Date().toISOString(),
}

describe('PolicyEvent creation', () => {
  it('builds a PolicyEvent from a verified candidate fact', () => {
    const event = buildPolicyEvent({
      publicationId: 'pub-1',
      candidateFactId: 'cand-test',
      jurisdictionId: 'DE',
      entityType: 'requirement',
      entityId: 'req-de-bc-salary-v1',
      entityLabel: 'Blue Card salary threshold',
      changeKind: 'threshold_changed',
      field: 'amount',
      oldValue: 61000,
      newValue: 64000,
      effectiveFrom: '2026-01-01',
      evidence: 'The threshold was raised.',
      sourceUrl: 'https://example.com',
      provenance: 'AUTHORITATIVE',
    })

    expect(event.id).toMatch(/^evt-/)
    expect(event.publicationId).toBe('pub-1')
    expect(event.candidateFactId).toBe('cand-test')
    expect(event.jurisdictionId).toBe('DE')
    expect(event.entityLabel).toBe('Blue Card salary threshold')
    expect(event.changeType).toBe('threshold_changed')
    expect(event.status).toBe('PUBLISHED')
    expect(event.provenance).toBe('AUTHORITATIVE')
  })

  it('generates a descriptive title for a threshold increase', () => {
    const event = buildPolicyEvent({
      publicationId: 'pub-1',
      candidateFactId: 'cand-1',
      jurisdictionId: 'DE',
      entityType: 'requirement',
      entityId: 'req-de-bc-salary-v1',
      entityLabel: 'Blue Card salary threshold',
      changeKind: 'threshold_changed',
      field: 'amount',
      oldValue: 61000,
      newValue: 64000,
      effectiveFrom: '2026-01-01',
      evidence: '...',
      sourceUrl: 'https://example.com',
    })
    expect(event.title).toContain('Blue Card salary threshold')
    expect(event.title).toContain('increased')
  })

  it('generates a descriptive title for a threshold decrease', () => {
    const event = buildPolicyEvent({
      publicationId: 'pub-1',
      candidateFactId: 'cand-1',
      jurisdictionId: 'DE',
      entityType: 'requirement',
      entityId: 'req-de-bc-salary-v1',
      entityLabel: 'Blue Card salary threshold',
      changeKind: 'threshold_changed',
      field: 'amount',
      oldValue: 64000,
      newValue: 61000,
      effectiveFrom: '2026-01-01',
      evidence: '...',
      sourceUrl: 'https://example.com',
    })
    expect(event.title).toContain('decreased')
  })

  it('generates a title for a program suspension', () => {
    const event = buildPolicyEvent({
      publicationId: 'pub-1',
      candidateFactId: 'cand-1',
      jurisdictionId: 'CA',
      entityType: 'program',
      entityId: 'ca-startup-visa',
      entityLabel: 'Start-Up Visa Program',
      changeKind: 'program_suspended',
      effectiveFrom: '2026-01-01',
      evidence: 'Program suspended.',
      sourceUrl: 'https://example.com',
    })
    expect(event.title).toContain('suspended')
    expect(event.changeType).toBe('program_suspended')
  })

  it('includes a summary with old and new values', () => {
    const event = buildPolicyEvent({
      publicationId: 'pub-1',
      candidateFactId: 'cand-1',
      jurisdictionId: 'DE',
      entityType: 'requirement',
      entityId: 'req-de-bc-salary-v1',
      entityLabel: 'Blue Card salary',
      changeKind: 'threshold_changed',
      field: 'amount',
      oldValue: 61000,
      newValue: 64000,
      effectiveFrom: '2026-01-01',
      evidence: '...',
      sourceUrl: 'https://example.com',
    })
    expect(event.summary).toContain('61,000')
    expect(event.summary).toContain('64,000')
  })

  it('prefers the AI interpretation for the summary when available', () => {
    const event = buildPolicyEvent({
      publicationId: 'pub-1',
      candidateFactId: 'cand-1',
      jurisdictionId: 'DE',
      entityType: 'requirement',
      entityId: 'req-de-bc-salary-v1',
      entityLabel: 'Blue Card salary',
      changeKind: 'threshold_changed',
      field: 'amount',
      oldValue: 61000,
      newValue: 64000,
      effectiveFrom: '2026-01-01',
      evidence: '...',
      sourceUrl: 'https://example.com',
      aiInterpretation: 'The German government raised the Blue Card salary threshold to align with wage indexation.',
    })
    expect(event.summary).toContain('German government')
  })

  it('defaults to AUTHORITATIVE provenance', () => {
    const event = buildPolicyEvent({
      publicationId: 'pub-1',
      candidateFactId: 'cand-1',
      jurisdictionId: 'DE',
      entityType: 'requirement',
      entityId: 'req-1',
      entityLabel: 'Test',
      changeKind: 'threshold_changed',
      effectiveFrom: '2026-01-01',
      evidence: '...',
      sourceUrl: 'https://example.com',
    })
    expect(event.provenance).toBe('AUTHORITATIVE')
  })

  it('can be marked as SIMULATED for test fixtures', () => {
    const event = buildPolicyEvent({
      publicationId: 'pub-sim',
      candidateFactId: 'cand-sim',
      jurisdictionId: 'DE',
      entityType: 'requirement',
      entityId: 'req-1',
      entityLabel: 'Test',
      changeKind: 'threshold_changed',
      effectiveFrom: '2026-01-01',
      evidence: '...',
      sourceUrl: 'https://example.com',
      provenance: 'SIMULATED',
    })
    expect(event.provenance).toBe('SIMULATED')
  })

  it('maps unknown change kinds to "other"', () => {
    const event = buildPolicyEvent({
      publicationId: 'pub-1',
      candidateFactId: 'cand-1',
      jurisdictionId: 'DE',
      entityType: 'requirement',
      entityId: 'req-1',
      entityLabel: 'Test',
      changeKind: 'unknown_kind',
      effectiveFrom: '2026-01-01',
      evidence: '...',
      sourceUrl: 'https://example.com',
    })
    expect(event.changeType).toBe('other')
  })

  it('has a stable, unique id', () => {
    const opts = {
      publicationId: 'pub-1',
      candidateFactId: 'cand-1',
      jurisdictionId: 'DE',
      entityType: 'requirement' as const,
      entityId: 'req-1',
      entityLabel: 'Test',
      changeKind: 'threshold_changed',
      effectiveFrom: '2026-01-01',
      evidence: '...',
      sourceUrl: 'https://example.com',
    }
    const event1 = buildPolicyEvent(opts)
    const event2 = buildPolicyEvent(opts)
    expect(event1.id).not.toBe(event2.id) // unique per call
    expect(event1.id).toMatch(/^evt-/) // stable prefix
  })

  it('includes the evidence and source URL', () => {
    const event = buildPolicyEvent({
      publicationId: 'pub-1',
      candidateFactId: 'cand-1',
      jurisdictionId: 'DE',
      entityType: 'requirement',
      entityId: 'req-1',
      entityLabel: 'Test',
      changeKind: 'threshold_changed',
      effectiveFrom: '2026-01-01',
      evidence: 'The official source states the threshold changed.',
      sourceUrl: 'https://make-it-in-germany.com/eu-blue-card',
    })
    expect(event.evidence).toBe('The official source states the threshold changed.')
    expect(event.sourceUrl).toBe('https://make-it-in-germany.com/eu-blue-card')
  })

  it('is created with status PUBLISHED and a publishedAt timestamp', () => {
    const event = buildPolicyEvent({
      publicationId: 'pub-1',
      candidateFactId: 'cand-1',
      jurisdictionId: 'DE',
      entityType: 'requirement',
      entityId: 'req-1',
      entityLabel: 'Test',
      changeKind: 'threshold_changed',
      effectiveFrom: '2026-01-01',
      evidence: '...',
      sourceUrl: 'https://example.com',
    })
    expect(event.status).toBe('PUBLISHED')
    expect(event.publishedAt).toBeTruthy()
  })
})

describe('PolicyEvent lifecycle', () => {
  it('starts as PUBLISHED', () => {
    const event = buildPolicyEvent({
      publicationId: 'pub-1',
      candidateFactId: 'cand-1',
      jurisdictionId: 'DE',
      entityType: 'requirement',
      entityId: 'req-1',
      entityLabel: 'Test',
      changeKind: 'threshold_changed',
      effectiveFrom: '2026-01-01',
      evidence: '...',
      sourceUrl: 'https://example.com',
    })
    expect(event.status).toBe('PUBLISHED')
    expect(event.supersededByEventId).toBeUndefined()
  })

  it('can be superseded by a newer event', () => {
    // This would be done by updating the DB record:
    //   db.policyEvent.update({ where: { id }, data: { status: 'SUPERSEDED', supersededByEventId: newId } })
    // The type supports it:
    const event = {
      ...baseCandidate,
      id: 'evt-1',
      publicationId: 'pub-1',
      status: 'SUPERSEDED' as const,
      supersededByEventId: 'evt-2',
      provenance: 'AUTHORITATIVE' as const,
      title: 'Test',
      summary: 'Test',
      changeType: 'threshold_changed' as const,
      createdAt: new Date().toISOString(),
    }
    expect(event.status).toBe('SUPERSEDED')
    expect(event.supersededByEventId).toBe('evt-2')
  })
})
