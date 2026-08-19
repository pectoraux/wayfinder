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
  /** Provenance: is this authoritative law or a simulated scenario?
   *  SIMULATED/TEST_FIXTURE snapshots are NEVER used by default for user
   *  recommendations, eligibility decisions, or current-policy displays. */
  provenance: PolicyProvenance
  /** Human changelog. */
  notes: string
  /** Parent version this one supersedes (for the publication chain). */
  parentVersionId?: string
  /** The entities belonging to this snapshot. */
  programIds: string[]
  requirementIds: string[]
  transitionIds: string[]
  evidenceIds: string[]
}

/** Provenance classification — the most important safety field in the system.
 *  Only AUTHORITATIVE snapshots may be used for user-facing current policy. */
export type PolicyProvenance =
  | 'AUTHORITATIVE'     // real, verified, currently-in-force law
  | 'DERIVED'           // derived from authoritative sources but not itself primary law
  | 'SIMULATED'         // hypothetical projection for testing/demonstration
  | 'TEST_FIXTURE'      // synthetic data for automated tests

// ===========================================================================
// 7. SOURCE + SOURCE SNAPSHOT (ingestion abstraction)
// ===========================================================================

export type SourceType =
  | 'GOVERNMENT_PAGE'
  | 'LEGISLATION'
  | 'REGULATION'
  | 'OFFICIAL_PORTAL'
  | 'EMBASSY'
  | 'CONSULATE'
  | 'OFFICIAL_FORM'
  | 'POLICY_MANUAL'
  | 'OFFICIAL_DATA'

/** Source trust model. Deliberately categorical, not a fake numeric score. */
export type SourceTrustLevel =
  | 'OFFICIAL_PRIMARY'        // the primary legal authority (e.g. IRCC, BAMF, the statute itself)
  | 'OFFICIAL_SECONDARY'      // an official body re-explaining primary law (e.g. Make it in Germany)
  | 'RECOGNIZED_INSTITUTION'  // a body with statutory recognition (e.g. ZAB, Tech Nation)
  | 'HIGH_QUALITY_SECONDARY'  // reputable but not the authority (e.g. a law firm summary)
  | 'COMMUNITY'               // user-contributed, needs verification
  | 'UNKNOWN'

/** Legacy alias for backwards compat with existing code. */
export type TrustLevel = 'authoritative' | 'official' | 'corroborated' | 'secondary'

export interface Source {
  id: string
  jurisdictionId: string
  sourceType: SourceType
  /** The publishing authority, e.g. "BAMF", "IRCC". */
  authority: string
  /** Human-readable name of the source. */
  name: string
  /** Canonical URL — the stable, deduplicated URL for this source. */
  canonicalUrl: string
  /** Legacy alias for canonicalUrl. */
  url: string
  /** How content is retrieved. */
  retrievalMethod: 'manual' | 'http_fetch' | 'api'
  /** Categorical trust level (NOT a fake numeric score). */
  trustLevel: SourceTrustLevel
  /** Is this source actively monitored? */
  active: boolean
  /** How often to poll this source, in hours. */
  monitoringFrequencyHours: number
  /** Last time a fetch was attempted (success or failure). */
  lastCheckedAt?: string
  /** Last time a fetch successfully returned content. */
  lastSuccessfulFetchAt?: string
  /** Link to the Evidence record(s) derived from this source. */
  evidenceIds: string[]
}

export type RetrievalStatus =
  | 'OK'
  | 'HTTP_ERROR'
  | 'TIMEOUT'
  | 'CONTENT_TYPE_REJECTED'
  | 'PARSE_ERROR'
  | 'REDIRECT_LOOP'
  | 'BLOCKED'
  | 'UNKNOWN'

export interface SourceSnapshot {
  id: string
  sourceId: string
  retrievedAt: string
  /** SHA-256 of the retrieved content (or normalized representation). */
  contentHash: string
  /** MIME type of the retrieved content. */
  contentType: string
  /** Byte length of the retrieved content. */
  contentLength: number
  /** Whether the fetch succeeded. */
  retrievalStatus: RetrievalStatus
  /** HTTP status code (if applicable). */
  statusCode?: number
  /** Where the raw content is stored (object storage path / inline). */
  rawStorageLocation: string
  /** Legacy alias. */
  contentLocation: string
  /** Version of the parser/normalizer used. */
  parserVersion: string
  /** Diff vs the previous snapshot, if any. */
  changeType?: ChangeClassification
  /** Human-readable diff summary (before/after context). */
  diffSummary?: string
  /** The actual content (for small sources; large ones use rawStorageLocation). */
  content?: string
}

/** Expanded change classification (8 levels).
 *  Mechanical: UNCHANGED, TEXT_CHANGED, STRUCTURAL_CHANGED, FETCH_ERROR.
 *  AI-assisted: POSSIBLE_POLICY_CHANGE, LIKELY_POLICY_CHANGE.
 *  Human-verified: VERIFIED_POLICY_CHANGE. */
export type ChangeClassification =
  | 'UNCHANGED'
  | 'TEXT_CHANGED'
  | 'STRUCTURAL_CHANGED'
  | 'POSSIBLE_POLICY_CHANGE'
  | 'LIKELY_POLICY_CHANGE'
  | 'VERIFIED_POLICY_CHANGE'
  | 'FETCH_ERROR'

/** A human-readable document diff with context. */
export interface DocumentDiff {
  before: string
  after: string
  /** Changed sections with surrounding context. */
  sections: DiffSection[]
}

export interface DiffSection {
  heading?: string
  before: string
  after: string
  /** Line-level changes. */
  lines: { type: 'context' | 'added' | 'removed'; text: string }[]
}

/** Result of a single source fetch. */
export interface FetchResult {
  success: boolean
  content: string
  contentHash: string
  retrievedAt: string
  statusCode?: number
  contentType?: string
  contentLength: number
  retrievalStatus: RetrievalStatus
  error?: string
  finalUrl?: string
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

// ===========================================================================
// 11. CANDIDATE FACTS (AI-extracted, pending human verification)
// ===========================================================================

/** What kind of entity a candidate fact refers to. */
export type CandidateEntityType =
  | 'requirement'
  | 'program'
  | 'transition'
  | 'status'

/** What kind of change the candidate proposes. */
export type CandidateChangeKind =
  | 'threshold_changed'
  | 'requirement_added'
  | 'requirement_removed'
  | 'program_opened'
  | 'program_suspended'
  | 'program_closed'
  | 'transition_changed'
  | 'application_deadline_changed'
  | 'work_rights_changed'
  | 'family_rights_changed'
  | 'physical_presence_requirement_changed'
  | 'processing_time_changed'

/** A candidate fact extracted from a source snapshot by the AI. Enters as
 *  AI_EXTRACTED and CANNOT become authoritative until a human approves it. */
export interface CandidateFact {
  id: string
  /** The source snapshot this candidate was extracted from. */
  sourceSnapshotId: string
  jurisdictionId: string
  entityType: CandidateEntityType
  /** The normalized entity id this candidate refers to (if known). */
  entityId?: string
  /** Human label of the affected entity. */
  entityLabel: string
  changeKind: CandidateChangeKind
  /** The field that changed (e.g. "amount", "effectiveFrom"). */
  field?: string
  oldValue?: unknown
  newValue?: unknown
  effectiveFrom?: string
  effectiveTo?: string
  /** Evidence excerpt from the source. */
  evidence: string
  /** The source URL this candidate was derived from. */
  sourceUrl: string
  /** AI model that produced this candidate. */
  model: string
  /** Version of the extraction prompt. */
  promptVersion: string
  /** Model confidence 0..1. NOT legal certainty — labeled as model confidence. */
  confidence: number
  /** Current review status. */
  extractionStatus: ExtractionStatus
  /** AI's plain-language interpretation of what changed. */
  aiInterpretation?: string
  createdAt: string
  /** Admin who reviewed, if any. */
  reviewedBy?: string
  reviewedAt?: string
  /** Reason for rejection / needs-evidence, if applicable. */
  reviewNote?: string
}

/** The verification state machine. Only APPROVED may modify authoritative
 *  policy. The transition rules are enforced in extraction.ts. */
export type ExtractionStatus =
  | 'AI_EXTRACTED'
  | 'PENDING_REVIEW'
  | 'APPROVED'
  | 'REJECTED'
  | 'NEEDS_MORE_EVIDENCE'
  | 'DUPLICATE'
  | 'SUPERSEDED'

// ===========================================================================
// 12. POLICY PUBLICATION
// ===========================================================================

/** A record of a policy version publication — the output of approving a
 *  candidate fact. Never mutates an existing published version. */
export interface PolicyPublication {
  id: string
  /** The new policy version id created by this publication. */
  policyVersionId: string
  /** The parent version this one supersedes. */
  parentVersionId: string
  /** The candidate fact(s) that triggered this publication. */
  candidateFactIds: string[]
  /** The admin who approved the publication. */
  approvedBy: string
  approvedAt: string
  /** Content hash of the new version. */
  contentHash: string
  /** Provenance of the new version. */
  provenance: PolicyProvenance
  /** Consistency check results (all must pass for publication). */
  consistencyChecks: ConsistencyCheckResult[]
  /** Human changelog. */
  notes: string
}

export interface ConsistencyCheckResult {
  name: string
  passed: boolean
  /** Error details if failed. */
  details?: string
}

// ===========================================================================
// 13. ADMIN AUDIT
// ===========================================================================

export type AdminAction =
  | 'APPROVE_CANDIDATE'
  | 'REJECT_CANDIDATE'
  | 'REQUEST_MORE_EVIDENCE'
  | 'MARK_DUPLICATE'
  | 'MARK_SOURCE_UNRELIABLE'
  | 'PUBLISH_POLICY_VERSION'
  | 'ALTER_SOURCE_MONITORING'
  | 'MARK_SOURCE_TRUSTED'

export interface AdminAuditRecord {
  id: string
  adminId: string
  adminEmail: string
  action: AdminAction
  /** Entity id the action targets (candidate id, source id, etc.). */
  entityId: string
  entityType: string
  /** Before/after state for the action. */
  before?: unknown
  after?: unknown
  timestamp: string
  reason?: string
}

// ===========================================================================
// 14. PLAN IMPACT (recomputation after a verified policy change)
// ===========================================================================

export type PlanImpactLevel =
  | 'NO_MATERIAL_CHANGE'
  | 'MINOR_CHANGE'
  | 'ROUTE_DEGRADED'
  | 'ROUTE_INVALIDATED'
  | 'NEW_BETTER_ROUTE'

export interface PlanImpact {
  level: PlanImpactLevel
  /** The user-facing explanation. */
  whatChanged: string
  whyItMatters: string
  whatHappensToPlan: string
  alternativesOpened: string[]
  alternativesClosed: string[]
  recommendedAction: string
  /** Decision record id of the affected plan. */
  decisionRecordId?: string
}

// ===========================================================================
// 15. POLICY WATCHLIST
// ===========================================================================

export interface PolicyWatchlistEntry {
  id: string
  userId: string
  /** What the user is watching: a country, program, or route. */
  watchType: 'country' | 'program' | 'route'
  watchId: string
  watchLabel: string
  createdAt: string
}
