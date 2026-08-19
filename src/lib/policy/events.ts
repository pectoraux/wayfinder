// Wayfinder — Policy Event Management
//
// Creates and manages PolicyEvent records — the canonical, user-facing
// representation of a verified policy change. Created when a PolicyPublication
// is published. Referenced by alerts, watchlists, route history, plan history,
// and the policy explorer.
//
// NEVER created directly from AI extraction — only from a verified publication.

import type { PolicyEvent, PolicyEventChangeType, PolicyProvenance } from './types'

/** Build a PolicyEvent from a published candidate fact + publication.
 *  This is the ONLY way a PolicyEvent is created. */
export function buildPolicyEvent(opts: {
  publicationId: string
  candidateFactId: string
  jurisdictionId: string
  entityType: 'requirement' | 'program' | 'transition' | 'status'
  entityId: string
  entityLabel: string
  changeKind: string
  field?: string
  oldValue?: unknown
  newValue?: unknown
  effectiveFrom?: string
  evidence: string
  sourceUrl: string
  aiInterpretation?: string
  provenance?: PolicyProvenance
  sourceSnapshotId?: string
}): PolicyEvent {
  const changeType = mapChangeKindToEventType(opts.changeKind)
  const title = buildEventTitle(opts.entityLabel, changeType, opts.field, opts.oldValue, opts.newValue)
  const summary = buildEventSummary(opts.entityLabel, changeType, opts.field, opts.oldValue, opts.newValue, opts.aiInterpretation)

  return {
    id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    publicationId: opts.publicationId,
    candidateFactId: opts.candidateFactId,
    jurisdictionId: opts.jurisdictionId,
    entityType: opts.entityType,
    entityId: opts.entityId,
    entityLabel: opts.entityLabel,
    changeType,
    title,
    summary,
    oldValue: opts.oldValue,
    newValue: opts.newValue,
    effectiveFrom: opts.effectiveFrom ?? new Date().toISOString(),
    sourceSnapshotId: opts.sourceSnapshotId,
    evidence: opts.evidence,
    sourceUrl: opts.sourceUrl,
    provenance: opts.provenance ?? 'AUTHORITATIVE',
    status: 'PUBLISHED',
    createdAt: new Date().toISOString(),
    publishedAt: new Date().toISOString(),
  }
}

function mapChangeKindToEventType(changeKind: string): PolicyEventChangeType {
  const map: Record<string, PolicyEventChangeType> = {
    threshold_changed: 'threshold_changed',
    requirement_added: 'requirement_added',
    requirement_removed: 'requirement_removed',
    program_opened: 'program_opened',
    program_suspended: 'program_suspended',
    program_closed: 'program_closed',
    transition_changed: 'transition_changed',
    application_deadline_changed: 'other',
    work_rights_changed: 'other',
    family_rights_changed: 'other',
    physical_presence_requirement_changed: 'other',
    processing_time_changed: 'processing_time_changed',
  }
  return map[changeKind] ?? 'other'
}

function buildEventTitle(
  entityLabel: string,
  changeType: PolicyEventChangeType,
  field?: string,
  oldValue?: unknown,
  newValue?: unknown,
): string {
  const direction = (() => {
    if (typeof oldValue === 'number' && typeof newValue === 'number') {
      return newValue > oldValue ? 'increased' : 'decreased'
    }
    return null
  })()

  switch (changeType) {
    case 'threshold_changed':
      return `${entityLabel} ${field ?? 'threshold'} ${direction ?? 'changed'}`
    case 'requirement_added':
      return `${entityLabel}: new requirement added`
    case 'requirement_removed':
      return `${entityLabel}: requirement removed`
    case 'program_opened':
      return `${entityLabel}: program opened`
    case 'program_suspended':
      return `${entityLabel}: program suspended`
    case 'program_closed':
      return `${entityLabel}: program closed`
    case 'processing_time_changed':
      return `${entityLabel}: processing time changed`
    default:
      return `${entityLabel}: policy updated`
  }
}

function buildEventSummary(
  entityLabel: string,
  changeType: PolicyEventChangeType,
  field?: string,
  oldValue?: unknown,
  newValue?: unknown,
  aiInterpretation?: string,
): string {
  // Prefer the AI interpretation if available (it's usually more descriptive)
  if (aiInterpretation) return aiInterpretation

  const oldStr = formatValue(oldValue)
  const newStr = formatValue(newValue)

  switch (changeType) {
    case 'threshold_changed':
      return `The ${field ?? 'threshold'} for ${entityLabel} changed from ${oldStr} to ${newStr}.`
    case 'requirement_added':
      return `A new requirement was added to ${entityLabel}.`
    case 'requirement_removed':
      return `A requirement was removed from ${entityLabel}.`
    case 'program_suspended':
      return `The ${entityLabel} program has been suspended. New applications may be paused.`
    case 'program_opened':
      return `The ${entityLabel} program is now accepting applications.`
    default:
      return `A policy change was detected for ${entityLabel}.`
  }
}

function formatValue(v: unknown): string {
  if (v == null) return '—'
  if (typeof v === 'number') return v.toLocaleString()
  return String(v)
}
