// Wayfinder — Source Registry + Change Detection
//
// A Source is an authoritative origin of immigration information. Each Evidence
// record in the knowledge base is derived from a Source. When a Source's
// content changes, we detect it via content-hash diff and classify the change
// as TEXT_CHANGED / POSSIBLE_POLICY_CHANGE / VERIFIED_POLICY_CHANGE.
//
// Sources live in code (curated registry) AND in the DB (PolicySource table)
// so retrieval history is persisted. The DB stores SourceSnapshots; the code
// registry holds the canonical metadata.

import type { Source, SourceSnapshot, SourceType, TrustLevel, ChangeClassification } from '@/lib/policy/types'
import { createHash } from 'crypto'
import { EVIDENCE } from '@/lib/knowledge/evidence'

// ---------------------------------------------------------------------------
// Curated source registry (derived from the evidence records)
// ---------------------------------------------------------------------------

function evidenceSourceType(evidenceKind: string): SourceType {
  switch (evidenceKind) {
    case 'government': return 'GOVERNMENT_PAGE'
    case 'legislation': return 'LEGISLATION'
    case 'embassy': return 'EMBASSY'
    case 'official_portal': return 'POLICY_MANUAL'
    case 'institution': return 'OFFICIAL_DATA'
    default: return 'GOVERNMENT_PAGE'
  }
}

function evidenceTrust(verification: string): TrustLevel {
  switch (verification) {
    case 'official': return 'authoritative'
    case 'corroborated': return 'corroborated'
    default: return 'secondary'
  }
}

/** Build the source registry from the curated EVIDENCE records. Each unique
 *  URL becomes a Source; multiple evidence records from the same URL share
 *  a Source. Sources default to active=true with monitoringFrequencyHours=168
 *  (weekly) unless overridden. */
export const SOURCES: Source[] = (() => {
  const byUrl = new Map<string, Source>()
  let idx = 0
  for (const ev of EVIDENCE) {
    if (!byUrl.has(ev.url)) {
      idx++
      byUrl.set(ev.url, {
        id: `src-${idx}`,
        jurisdictionId: ev.jurisdiction as string,
        sourceType: evidenceSourceType(ev.kind),
        authority: ev.publisher,
        name: ev.title,
        canonicalUrl: ev.url,
        url: ev.url,
        retrievalMethod: 'http_fetch',
        trustLevel: evidenceTrustLevel(ev.verification),
        active: true,
        monitoringFrequencyHours: 168, // weekly by default
        lastCheckedAt: ev.publishedAt,
        lastSuccessfulFetchAt: ev.publishedAt,
        evidenceIds: [ev.id],
      })
    } else {
      byUrl.get(ev.url)!.evidenceIds.push(ev.id)
    }
  }
  return Array.from(byUrl.values())
})()

function evidenceTrustLevel(verification: string): Source['trustLevel'] {
  switch (verification) {
    case 'official': return 'OFFICIAL_PRIMARY'
    case 'corroborated': return 'OFFICIAL_SECONDARY'
    default: return 'HIGH_QUALITY_SECONDARY'
  }
}

export function getSource(id: string): Source | undefined {
  return SOURCES.find((s) => s.id === id)
}

export function getSourceByUrl(url: string): Source | undefined {
  return SOURCES.find((s) => s.url === url)
}

// ---------------------------------------------------------------------------
// Content hashing + change detection
// ---------------------------------------------------------------------------

/** Normalize content for stable hashing: trim, collapse whitespace, lowercase. */
export function normalizeContent(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toLowerCase()
}

/** SHA-256 of normalized content. */
export function contentHash(text: string): string {
  return createHash('sha256').update(normalizeContent(text)).digest('hex').slice(0, 16)
}

export type ChangeKind = 'UNCHANGED' | 'TEXT_CHANGED' | 'POSSIBLE_POLICY_CHANGE' | 'VERIFIED_POLICY_CHANGE'

/** Legacy 4-level change detection (kept for backwards compat). */
export function detectSourceChange(previous: SourceSnapshot | null, current: Pick<SourceSnapshot, 'contentHash'>): ChangeKind {
  if (!previous) return 'TEXT_CHANGED'
  if (previous.contentHash === current.contentHash) return 'UNCHANGED'
  return 'TEXT_CHANGED'
}

/** Expanded 7-level change classification (the new standard).
 *  - Mechanical: UNCHANGED, TEXT_CHANGED, STRUCTURAL_CHANGED, FETCH_ERROR
 *  - AI-assisted: POSSIBLE_POLICY_CHANGE, LIKELY_POLICY_CHANGE
 *  - Human-verified: VERIFIED_POLICY_CHANGE */
export function classifyChangeExpanded(
  oldText: string,
  newText: string,
  retrievalStatus: 'OK' | 'HTTP_ERROR' | 'TIMEOUT' | 'CONTENT_TYPE_REJECTED' | 'PARSE_ERROR' | 'REDIRECT_LOOP' | 'BLOCKED' | 'UNKNOWN' = 'OK',
): ChangeClassification {
  if (retrievalStatus !== 'OK') return 'FETCH_ERROR'
  if (normalizeContent(oldText) === normalizeContent(newText)) return 'UNCHANGED'

  // Detect structural changes (HTML structure changed without text change)
  const oldTagCount = (oldText.match(/<\/?[a-z][^>]*>/gi) ?? []).length
  const newTagCount = (newText.match(/<\/?[a-z][^>]*>/gi) ?? []).length
  const structuralChange = Math.abs(oldTagCount - newTagCount) > 10

  // Policy keyword detection
  const policyKeywords = [
    'salary', 'threshold', 'minimum', 'income', 'requirement', 'eligib',
    'points', 'fee', 'valid', 'expire', 'effective', 'permanent', 'citizenship',
    'residence', 'visa', 'permit', 'sponsor', 'endorse', 'blue card',
    'chancenkarte', 'express entry', 'start-up visa', 'startup visa',
    'global talent', 'd7', 'd2', 'naturaliz', 'settlement', 'ilr',
  ]
  const newLower = newText.toLowerCase()
  const oldLower = oldText.toLowerCase()

  // Number changes near policy keywords
  const touchesNumbers = /\d{3,}/.test(newText) && /\d{3,}/.test(oldText)
  const touchesPolicy = policyKeywords.some((k) => newLower.includes(k))

  // Check if the changed lines contain policy keywords (not just any text)
  const oldLines = new Set(oldText.split('\n').map((l) => l.trim()))
  const changedLines = newText.split('\n').filter((l) => !oldLines.has(l.trim()))
  const changedTouchesPolicy = changedLines.some((l) =>
    policyKeywords.some((k) => l.toLowerCase().includes(k)),
  )

  if (touchesNumbers && touchesPolicy && changedTouchesPolicy) return 'LIKELY_POLICY_CHANGE'
  if (touchesPolicy && changedTouchesPolicy) return 'POSSIBLE_POLICY_CHANGE'
  if (structuralChange) return 'STRUCTURAL_CHANGED'
  return 'TEXT_CHANGED'
}

/** Legacy classifyChange (4-level) — kept for existing tests. */
export function classifyChange(oldText: string, newText: string): ChangeKind {
  if (normalizeContent(oldText) === normalizeContent(newText)) return 'UNCHANGED'
  const policyKeywords = [
    'salary', 'threshold', 'minimum', 'income', 'requirement', 'eligib',
    'points', 'fee', 'valid', 'expire', 'effective', 'permanent', 'citizenship',
    'residence', 'visa', 'permit', 'sponsor', 'endorse',
  ]
  const oldLower = oldText.toLowerCase()
  const newLower = newText.toLowerCase()
  const touchesNumbers = /\d{3,}/.test(newText) && /\d{3,}/.test(oldText)
  const touchesPolicy = policyKeywords.some((k) => newLower.includes(k))
  if (touchesNumbers && touchesPolicy) return 'POSSIBLE_POLICY_CHANGE'
  if (touchesPolicy) return 'POSSIBLE_POLICY_CHANGE'
  return 'TEXT_CHANGED'
}

/** Record a source snapshot in the DB. */
export async function recordSourceSnapshot(
  sourceId: string,
  content: string,
  contentLocation: string = 'inline',
  db: { sourceSnapshot: { create: (data: any) => Promise<any> } },
): Promise<SourceSnapshot> {
  const hash = contentHash(content)
  return db.sourceSnapshot.create({
    data: {
      sourceId,
      contentHash: hash,
      contentLocation,
      changeType: 'UNCHANGED',
    },
  }) as unknown as SourceSnapshot
}
