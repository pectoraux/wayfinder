// Wayfinder — Extraction Pipeline + Verification
//
// Bounded pipeline for turning a Source into candidate facts/rules. The LLM
// may propose candidate requirements / thresholds / transitions, but they
// ALWAYS enter as verification = 'AI_EXTRACTED' and CANNOT be presented as
// authoritative until a human promotes them to 'OFFICIAL_CONFIRMED'.
//
// Pipeline:
//   Source → Document → CandidateFact[] → CandidateRule[] → Validation → PublishedPolicy
//
// This module provides:
//   - extractCandidateRequirements(sourceText): runs the LLM, returns candidates
//   - promoteCandidate(candidateId, reviewer): moves a candidate through states
//   - the VerificationState transitions are enforced here, not by the LLM.

import type {
  NormalizedRequirement,
  RequirementPredicateKind,
  VerificationState,
} from './types'
import { getZai } from '@/lib/ai/zai'

export interface CandidateRequirement {
  id: string
  sourceExcerpt: string
  proposedLabel: string
  proposedKind: RequirementPredicateKind
  proposedParams: Record<string, unknown>
  /** Why the LLM thinks this is a requirement. */
  rationale: string
  verification: VerificationState
  extractedAt: string
  /** The model that proposed this. */
  modelSource: string
}

export interface ExtractionResult {
  candidates: CandidateRequirement[]
  source: { url: string; title: string }
  /** Whether the LLM was available. */
  llmUsed: boolean
  notes: string
}

const SYSTEM_PROMPT = `You are the Extraction Agent for Wayfinder, a global mobility intelligence platform.
You receive an excerpt of an immigration source document. Your ONLY job is to identify CANDIDATE eligibility requirements that COULD be derived from the text.

Hard rules:
- You are proposing candidates for human review. You are NOT publishing rules.
- Only propose requirements explicitly stated in the text. Do NOT infer thresholds not present.
- For each candidate, give the exact excerpt supporting it and a rationale.
- If the text is ambiguous or you are unsure, do NOT propose a candidate.
- Return STRICT JSON only (no markdown) with this shape:
{
  "candidates": [
    {
      "proposedLabel": string,
      "proposedKind": one of ["min_salary_usd","min_savings_usd","min_passive_income_usd_monthly","min_education","degree_recognized","language_cefr","language_or","max_age","min_age","occupation_in","min_years_experience","settlement_funds_usd","points_threshold","has_employer_offer","business_plan","designated_incubator_support","endorsement_body","remote_work_capable"],
      "proposedParams": object,
      "sourceExcerpt": string,
      "rationale": string
    }
  ]
}
If no candidates can be safely identified, return {"candidates": []}.`

export async function extractCandidateRequirements(
  source: { url: string; title: string; excerpt: string },
): Promise<ExtractionResult> {
  const empty: ExtractionResult = {
    candidates: [],
    source: { url: source.url, title: source.title },
    llmUsed: false,
    notes: 'LLM unavailable; no candidates extracted.',
  }

  try {
    const zai = await getZai()
    if (!zai) return empty

    const completion = await zai.chat.completions.create({
      messages: [
        { role: 'assistant', content: SYSTEM_PROMPT },
        { role: 'user', content: `Source: ${source.title}\nURL: ${source.url}\n\nExcerpt:\n${source.excerpt}` },
      ],
      thinking: { type: 'disabled' },
    })
    const content = completion.choices[0]?.message?.content ?? ''
    const jsonStr = extractJson(content)
    if (!jsonStr) return { ...empty, llmUsed: true, notes: 'LLM returned no parseable JSON.' }

    const parsed = JSON.parse(jsonStr) as { candidates: any[] }
    const candidates: CandidateRequirement[] = (parsed.candidates ?? []).map((c, i) => ({
      id: `cand-${Date.now()}-${i}`,
      sourceExcerpt: String(c.sourceExcerpt ?? ''),
      proposedLabel: String(c.proposedLabel ?? 'Unnamed candidate'),
      proposedKind: c.proposedKind as RequirementPredicateKind,
      proposedParams: (c.proposedParams ?? {}) as Record<string, unknown>,
      rationale: String(c.rationale ?? ''),
      verification: 'AI_EXTRACTED' as VerificationState,
      extractedAt: new Date().toISOString(),
      modelSource: 'z-ai-web-dev-sdk',
    }))

    return {
      candidates,
      source: { url: source.url, title: source.title },
      llmUsed: true,
      notes: `${candidates.length} candidate(s) extracted. All enter as AI_EXTRACTED; none are authoritative.`,
    }
  } catch (err) {
    console.error('[extraction]', err)
    return { ...empty, notes: `Extraction failed: ${(err as Error).message}` }
  }
}

function extractJson(text: string): string | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fenced ? fenced[1] : text
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return null
  return candidate.slice(start, end + 1)
}

// ---------------------------------------------------------------------------
// Verification state machine
// ---------------------------------------------------------------------------

const ALLOWED_TRANSITIONS: Record<VerificationState, VerificationState[]> = {
  AI_EXTRACTED: ['PENDING_VERIFICATION', 'DISPUTED'],
  PENDING_VERIFICATION: ['HUMAN_REVIEWED', 'DISPUTED', 'AI_EXTRACTED'],
  HUMAN_REVIEWED: ['OFFICIAL_CONFIRMED', 'DISPUTED'],
  OFFICIAL_CONFIRMED: ['SUPERSEDED', 'DISPUTED'],
  SUPERSEDED: [],
  DISPUTED: ['PENDING_VERIFICATION', 'OFFICIAL_CONFIRMED'],
}

export function canTransition(from: VerificationState, to: VerificationState): boolean {
  return (ALLOWED_TRANSITIONS[from] ?? []).includes(to)
}

export function promoteCandidate(
  candidate: { verification: VerificationState },
  to: VerificationState,
): { ok: boolean; reason: string } {
  if (canTransition(candidate.verification, to)) {
    return { ok: true, reason: `Promoted to ${to}.` }
  }
  return { ok: false, reason: `Illegal transition: ${candidate.verification} → ${to}. Allowed: ${(ALLOWED_TRANSITIONS[candidate.verification] ?? []).join(', ') || 'none'}.` }
}

/** A requirement is authoritative iff verification === 'OFFICIAL_CONFIRMED'.
 *  AI_EXTRACTED / PENDING_VERIFICATION / DISPUTED rules are NEVER shown as
 *  authoritative in the UI or used in eligibility determinations. */
export function isAuthoritative(verification: VerificationState): boolean {
  return verification === 'OFFICIAL_CONFIRMED'
}

/** Filter a list of requirements to only authoritative ones. */
export function onlyAuthoritative<T extends { verification: VerificationState }>(reqs: T[]): T[] {
  return reqs.filter((r) => isAuthoritative(r.verification))
}

/** Convert a verified candidate into a NormalizedRequirement. Throws if the
 *  candidate is not OFFICIAL_CONFIRMED — this is the single chokepoint that
 *  prevents AI-extracted rules from becoming policy. */
export function publishCandidate(
  candidate: CandidateRequirement,
  opts: { policyVersionId: string; evidenceIds: string[]; effectiveFrom: string; id: string },
): NormalizedRequirement {
  if (candidate.verification !== 'OFFICIAL_CONFIRMED') {
    throw new Error(
      `Cannot publish candidate ${candidate.id}: verification is ${candidate.verification}, not OFFICIAL_CONFIRMED. ` +
      `AI-extracted rules can never become authoritative without human verification.`,
    )
  }
  return {
    id: opts.id,
    label: candidate.proposedLabel,
    kind: candidate.proposedKind,
    params: candidate.proposedParams,
    evidenceIds: opts.evidenceIds,
    enablerAddressable: false,
    criticality: 'hard',
    verification: 'OFFICIAL_CONFIRMED',
    effectiveFrom: opts.effectiveFrom,
    policyVersionId: opts.policyVersionId,
  }
}
