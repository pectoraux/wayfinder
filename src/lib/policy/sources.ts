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

import type { Source, SourceSnapshot, SourceType, TrustLevel } from '@/lib/policy/types'
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
 *  a Source. */
export const SOURCES: Source[] = (() => {
  const byUrl = new Map<string, Source>()
  for (const ev of EVIDENCE) {
    if (!byUrl.has(ev.url)) {
      byUrl.set(ev.url, {
        id: `src-${byUrl.size + 1}`,
        jurisdictionId: ev.jurisdiction as string,
        sourceType: evidenceSourceType(ev.kind),
        authority: ev.publisher,
        url: ev.url,
        retrievalMethod: 'manual',
        lastChecked: ev.publishedAt,
        trustLevel: evidenceTrust(ev.verification),
        evidenceIds: [ev.id],
      })
    } else {
      byUrl.get(ev.url)!.evidenceIds.push(ev.id)
    }
  }
  return Array.from(byUrl.values())
})()

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

/** Compare two source snapshots by content hash. */
export function detectSourceChange(previous: SourceSnapshot | null, current: Pick<SourceSnapshot, 'contentHash'>): ChangeKind {
  if (!previous) return 'TEXT_CHANGED'
  if (previous.contentHash === current.contentHash) return 'UNCHANGED'
  return 'TEXT_CHANGED'
}

/** Classify a text change as possibly policy-relevant using simple heuristics.
 *  This is deliberately conservative: it flags changes that touch numbers,
 *  dates, or policy keywords. A human must confirm before it becomes
 *  VERIFIED_POLICY_CHANGE. */
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
