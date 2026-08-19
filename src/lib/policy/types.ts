// Wayfinder — Normalized Temporal Policy Model
//
// This module introduces the first-class entities the spec calls for:
//   Jurisdiction, ImmigrationProgram, ImmigrationStatus, NormalizedRequirement,
//   NormalizedTransition, PolicySnapshot, Source, SourceSnapshot.
//
// DESIGN PRINCIPLE: the normalized model is a SUPERSET of the legacy Pathway
// model. The legacy PATHWAYS array is adapted into normalized programs via
// src/lib/policy/normalize.ts. The existing route engine keeps working against
// Pathway; the new temporal/route-invalidation APIs work against the normalized
// model. Both coexist so the main product flow is never broken.
//
// Every legally significant field carries temporal metadata:
//   publishedAt  — when the rule was published by the authority
//   effectiveFrom — when the rule becomes legally operative
//   effectiveTo   — when it ceases to be operative (undefined = open-ended)
//   policyVersionId — which PolicySnapshot this rule belongs to
//   evidenceIds   — every rule traces to ≥1 Evidence record
//
// The LLM never produces these. They are curated. AI-extracted candidates
// enter with verification = 'AI_EXTRACTED' and CANNOT be presented as
// authoritative until promoted to 'OFFICIAL_CONFIRMED' by a human.

// ===========================================================================
// 1. JURISDICTION
// ===========================================================================

export interface Jurisdiction {
  /** Stable id, e.g. 'DE', 'DE-BY', 'EU'. */
  id: string
  name: string
  /** ISO 3166-1 alpha-2 for countries; ISO 3166-2 for subnationals. */
  isoAlpha2?: string
  /** Parent jurisdiction, e.g. 'DE-BY' → 'DE', 'DE' → 'EU'. */
  parentId?: string
  /** Kind of jurisdiction. */
  kind: 'country' | 'subnational' | 'supranational'
  active: boolean
}

// ===========================================================================
// 2. IMMIGRATION PROGRAM (normalized pathway)
// ===========================================================================

export type ProgramCategory =
  | 'skilled_worker'
  | 'eu_blue_card'
  | 'job_seeker'
  | 'entrepreneur'
  | 'startup_visa'
  | 'passive_income'
  | 'digital_nomad'
  | 'talent_endorsement'
  | 'student'
  | 'family'
  | 'investor'

/** The legal status a program leads to upon entry. */
export type EntryStatusKind =
  | 'temporary_residence'
  | 'work_residence'
  | 'permanent_residence'
  | 'citizenship_eligible'

export interface ImmigrationProgram {
  /** Stable id; matches legacy Pathway.id where adapted. */
  id: string
  jurisdictionId: string
  /** Display name, e.g. "EU Blue Card". */
  name: string
  category: ProgramCategory
  tagline: string
  /** The entry status this program grants. */
  entryStatusId: string
  /** Requirements for entry (deterministic predicates). */
  requirementIds: string[]
  /** Downstream transitions unlocked by achieving entry status. */
  transitionIds: string[]
  /** Cost (USD, fees + required funds excl. living). */
  estimatedCostUSD: number
  /** Application processing time (months). */
  processingTimeMonths: number
  /** Validity of entry status (months; 0 = direct to PR). */
  validityMonths: number
  /** Is a third-party enabler required by law/policy? */
  requiresThirdParty: boolean
  shortageOccupationFriendly?: boolean
  riskNotes?: string
  /** Temporal: when these program rules are effective. */
  effectiveFrom: string
  effectiveTo?: string
  /** Policy snapshot this program belongs to. */
  policyVersionId: string
  /** Status of the program itself (suspended programs stay in history). */
  status: 'active' | 'suspended' | 'closed'
}

// ===========================================================================
// 3. IMMIGRATION STATUS
// ===========================================================================

export type StatusTier =
  | 'current_state'
  | 'visitor'
  | 'student_residence'
  | 'temporary_work_residence'
  | 'eu_blue_card'
  | 'job_seeker'
  | 'startup_residence'
  | 'passive_income_residence'
  | 'digital_nomad_residence'
  | 'talent_residence'
  | 'family_residence'
  | 'permanent_residence'
  | 'citizenship'

export interface ImmigrationStatus {
  /** Stable id, e.g. 'de-blue-card-residence', 'de-settlement'. */
  id: string
  jurisdictionId: string
  /** Human label, e.g. "EU Blue Card residence". */
  label: string
  tier: StatusTier
  /** Is this a terminal status (citizenship)? */
  terminal: boolean
}

// ===========================================================================
// 4. NORMALIZED REQUIREMENT (typed predicate)
// ===========================================================================

/** Verification state for a structured fact/rule. */
export type VerificationState =
  | 'AI_EXTRACTED' // model proposed; NOT authoritative
  | 'PENDING_VERIFICATION' // queued for human review
  | 'HUMAN_REVIEWED' // a human checked it but no official source yet
  | 'OFFICIAL_CONFIRMED' // traced to an authoritative source
  | 'SUPERSEDED' // replaced by a newer rule (kept for history)
  | 'DISPUTED' // conflicting authoritative sources

/** The kind of deterministic predicate (mirrors legacy RequirementKind). */
export type RequirementPredicateKind =
  | 'max_age'
  | 'min_age'
  | 'occupation_in'
  | 'shortage_occupation'
  | 'min_salary_usd'
  | 'min_education'
  | 'degree_recognized'
  | 'min_savings_usd'
  | 'min_passive_income_usd_monthly'
  | 'min_investable_capital_usd'
  | 'language_cefr'
  | 'language_or'
  | 'remote_work_capable'
  | 'has_employer_offer'
  | 'employer_sponsorship'
  | 'business_plan'
  | 'designated_incubator_support'
  | 'endorsement_body'
  | 'settlement_funds_usd'
  | 'min_years_experience'
  | 'points_threshold'
  | 'clean_criminal_record'
  | 'health_insurance'

export interface NormalizedRequirement {
  id: string
  /** Human label. */
  label: string
  /** Predicate kind — interpreted by the policy engine. */
  kind: RequirementPredicateKind
  /** Typed parameters for the predicate. */
  params: Record<string, unknown>
  /** Evidence backing this requirement. */
  evidenceIds: string[]
  /** Can a legitimate enabler satisfy this if missing? */
  enablerAddressable: boolean
  /** hard = blocks eligibility; soft = reduces score. */
  criticality: 'hard' | 'soft'
  /** Verification state — AI_EXTRACTED rules are NEVER authoritative. */
  verification: VerificationState
  /** Temporal: when this requirement rule is effective. */
  effectiveFrom: string
  effectiveTo?: string
  policyVersionId: string
  /** Supersession chain. */
  supersedesId?: string
  supersededById?: string
}

// ===========================================================================
// 5. NORMALIZED TRANSITION (legal state transition)
// ===========================================================================

export interface NormalizedTransition {
  id: string
  /** Source status id. */
  fromStatusId: string
  /** Destination status id. */
  toStatusId: string
  /** Typical duration (months). */
  durationMonths: number
  /** Conditions that must hold. */
  conditions: string[]
  /** Evidence backing this transition rule. */
  evidenceIds: string[]
  /** Reversibility. */
  reversible: boolean
  /** Temporal. */
  effectiveFrom: string
  effectiveTo?: string
  policyVersionId: string
  verification: VerificationState
}

// ===========================================================================
// 6. POLICY SNAPSHOT (a coherent versioned slice of the policy world)
// ===========================================================================

export interface PolicySnapshot {
  /** Version id, e.g. 'de-2024.06' or 'global-2024.11.1'. */
  id: string
  /** Jurisdiction this snapshot covers ('global' for the whole KB). */
  jurisdictionId: string
  /** ISO date this snapshot was curated/published. */
  publishedAt: string
  /** ISO date the rules in this snapshot become effective. */
  effectiveFrom: string
  /** ISO date the rules cease (undefined = current). */
  effectiveTo?: string
  /** Semantic version label. */
  version: string
  /** Content hash over the rules in this snapshot (reproducibility). */
  hash: string
  /** Status of the snapshot. */
  status: 'current' | 'superseded' | 'draft'
  /** Human changelog. */
  notes: string
  /** The entities belonging to this snapshot. */
  programIds: string[]
  requirementIds: string[]
  transitionIds: string[]
  evidenceIds: string[]
}

// ===========================================================================
// 7. SOURCE + SOURCE SNAPSHOT (ingestion abstraction)
// ===========================================================================

export type SourceType =
  | 'GOVERNMENT_PAGE'
  | 'LEGISLATION'
  | 'REGULATION'
  | 'EMBASSY'
  | 'OFFICIAL_FORM'
  | 'POLICY_MANUAL'
  | 'OFFICIAL_DATA'

export type TrustLevel = 'authoritative' | 'official' | 'corroborated' | 'secondary'

export interface Source {
  id: string
  jurisdictionId: string
  sourceType: SourceType
  /** The publishing authority, e.g. "BAMF", "IRCC". */
  authority: string
  url: string
  /** How content is retrieved. */
  retrievalMethod: 'manual' | 'http_fetch' | 'api'
  lastChecked?: string
  trustLevel: TrustLevel
  /** Link to the Evidence record(s) derived from this source. */
  evidenceIds: string[]
}

export interface SourceSnapshot {
  id: string
  sourceId: string
  retrievedAt: string
  /** SHA-256 of the retrieved content (or normalized representation). */
  contentHash: string
  /** Where the raw content is stored (object storage path / inline). */
  contentLocation: string
  /** Diff vs the previous snapshot, if any. */
  changeType?: 'TEXT_CHANGED' | 'POSSIBLE_POLICY_CHANGE' | 'VERIFIED_POLICY_CHANGE' | 'UNCHANGED'
}

// ===========================================================================
// 8. POLICY DIFF
// ===========================================================================

export type PolicyChangeKind =
  | 'PROGRAM_ADDED'
  | 'PROGRAM_REMOVED'
  | 'PROGRAM_SUSPENDED'
  | 'PROGRAM_REOPENED'
  | 'PROGRAM_RENAMED'
  | 'REQUIREMENT_ADDED'
  | 'REQUIREMENT_REMOVED'
  | 'RULE_CHANGED'
  | 'THRESHOLD_CHANGED'
  | 'TRANSITION_ADDED'
  | 'TRANSITION_REMOVED'
  | 'EFFECTIVE_DATE_CHANGED'
  | 'EVIDENCE_UPDATED'

export interface PolicyChange {
  kind: PolicyChangeKind
  /** Entity id affected. */
  entityId: string
  /** Human label of the affected entity. */
  entityLabel: string
  /** Field that changed, for RULE_CHANGED / THRESHOLD_CHANGED. */
  field?: string
  /** Previous value (absent if added). */
  oldValue?: unknown
  /** New value (absent if removed). */
  newValue?: unknown
  /** When the new rule becomes effective. */
  effectiveFrom?: string
  /** Evidence backing the change. */
  evidenceIds: string[]
  /** Human summary. */
  summary: string
}

export interface PolicyDiff {
  fromSnapshotId: string
  toSnapshotId: string
  changes: PolicyChange[]
  /** Summary counts by kind. */
  summary: Record<PolicyChangeKind, number>
}

// ===========================================================================
// 9. ROUTE INVALIDATION
// ===========================================================================

export type InvalidationReason =
  | 'PROGRAM_SUSPENDED'
  | 'PROGRAM_CLOSED'
  | 'REQUIREMENT_REMOVED'
  | 'REQUIREMENT_CHANGED'
  | 'THRESHOLD_RAISED'
  | 'TRANSITION_REMOVED'
  | 'EFFECTIVE_DATE_PASSED'
  | 'POLICY_VERSION_OUTDATED'

export interface RouteInvalidation {
  valid: boolean
  reasons: InvalidationReason[]
  /** Human description. */
  description: string
  /** The specific entity ids that triggered invalidation. */
  affectedEntityIds: string[]
  /** Effective date of the invalidating change. */
  effectiveFrom?: string
  /** Alternative route ids still valid under the new policy. */
  alternativeRouteIds: string[]
}

// ===========================================================================
// 10. IMPACT ANALYSIS
// ===========================================================================

export interface PolicyImpact {
  policyChange: PolicyChange
  /** Route ids affected by this change. */
  affectedRouteIds: string[]
  /** Transition ids affected. */
  affectedTransitionIds: string[]
  /** Decision record ids affected (from the DB, may be empty if none saved). */
  affectedDecisionRecordIds: string[]
  /** Human summary. */
  summary: string
}
