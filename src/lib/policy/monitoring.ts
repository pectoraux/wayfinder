// Wayfinder — Policy Monitoring Job
//
// The scheduled monitoring workflow:
//   load active sources → fetch source → compare hash → create SourceSnapshot
//   → classify change → enqueue changed sources for extraction
//
// This runs BEHIND the request/response cycle (via Vercel cron or a future
// Temporal worker). The domain layer is clean so the storage/scheduling
// substrate can be swapped without changing this logic.

import { fetchSource } from './fetcher'
import { contentHash, normalizeContent, classifyChangeExpanded } from './sources'
import { diffDocuments, summarizeDiff } from './differ'
import { extractCandidateRequirements } from './extraction'
import type { ChangeClassification, FetchResult } from './types'
import { SOURCES } from './sources'

export interface MonitoringResult {
  sourceId: string
  sourceUrl: string
  fetched: boolean
  contentHash: string | null
  changeType: ChangeClassification | null
  diffSummary: string | null
  candidatesExtracted: number
  error?: string
}

/**
 * Run policy monitoring on all active sources. For each source:
 *  1. Fetch the current content
 *  2. Compare hash against the previous snapshot (if any)
 *  3. Classify the change
 *  4. If materially changed, run AI extraction to produce candidate facts
 *
 * Returns a summary per source. The DB persistence is handled by the caller
 * (the API route), so this function is pure and testable.
 */
export async function runPolicyMonitoring(
  sources: typeof SOURCES = SOURCES,
  previousSnapshots: Map<string, { contentHash: string; content: string }> = new Map(),
  options: { extractCandidates?: boolean } = {},
): Promise<MonitoringResult[]> {
  const { extractCandidates = true } = options
  const results: MonitoringResult[] = []

  for (const source of sources) {
    if (!source.active) {
      results.push({
        sourceId: source.id,
        sourceUrl: source.canonicalUrl,
        fetched: false,
        contentHash: null,
        changeType: null,
        diffSummary: null,
        candidatesExtracted: 0,
        error: 'Source inactive',
      })
      continue
    }

    const fetchResult = await fetchSource(source)
    if (!fetchResult.success) {
      results.push({
        sourceId: source.id,
        sourceUrl: source.canonicalUrl,
        fetched: false,
        contentHash: null,
        changeType: 'FETCH_ERROR',
        diffSummary: null,
        candidatesExtracted: 0,
        error: fetchResult.error,
      })
      continue
    }

    const prev = previousSnapshots.get(source.id)
    const oldContent = prev?.content ?? ''
    const newContent = fetchResult.content

    const changeType = classifyChangeExpanded(oldContent, newContent, fetchResult.retrievalStatus)
    const diffSummary = changeType === 'UNCHANGED' ? null : summarizeDiff(diffDocuments(oldContent, newContent))

    let candidatesExtracted = 0
    if (extractCandidates && (changeType === 'POSSIBLE_POLICY_CHANGE' || changeType === 'LIKELY_POLICY_CHANGE')) {
      // Run AI extraction on the changed content to produce candidate facts
      const extraction = await extractCandidateRequirements({
        url: source.canonicalUrl,
        title: source.name,
        excerpt: newContent.slice(0, 8000), // cap LLM input
      })
      candidatesExtracted = extraction.candidates.length
    }

    results.push({
      sourceId: source.id,
      sourceUrl: source.canonicalUrl,
      fetched: true,
      contentHash: fetchResult.contentHash,
      changeType,
      diffSummary,
      candidatesExtracted,
    })
  }

  return results
}

/**
 * Run monitoring on a single source (for the admin "fetch now" button).
 * Returns the fetch result + change classification.
 */
export async function monitorSingleSource(
  sourceId: string,
  previousContent?: string,
): Promise<{
  fetchResult: FetchResult
  changeType: ChangeClassification
  diffSummary: string | null
}> {
  const source = SOURCES.find((s) => s.id === sourceId)
  if (!source) throw new Error(`Source ${sourceId} not found`)

  const fetchResult = await fetchSource(source)
  if (!fetchResult.success) {
    return {
      fetchResult,
      changeType: 'FETCH_ERROR',
      diffSummary: fetchResult.error ?? null,
    }
  }

  const changeType = classifyChangeExpanded(previousContent ?? '', fetchResult.content, fetchResult.retrievalStatus)
  const diffSummary = changeType === 'UNCHANGED'
    ? null
    : summarizeDiff(diffDocuments(previousContent ?? '', fetchResult.content))

  return { fetchResult, changeType, diffSummary }
}
