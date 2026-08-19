// Wayfinder — Core Domain Types
//
// The central entity is NOT "User". It is MobilityState: a snapshot of a
// person's real-world state at a point in time. Migration is modelled as a
// graph of legal state transitions. Every legally significant claim is
// traceable to Evidence.
//
// Pipeline: evidence → structured facts → policy evaluation → route
// optimization → explanation. The LLM never becomes the source of truth.

// ============================================================================
// 0. SHARED PRIMITIVES
// ============================================================================

/** ISO-3166-1 alpha-2 country code. */
export type CountryCode = string

/** How confident we are in a fact or assertion. */
export type Confidence = 'high' | 'medium' | 'low' | 'unknown'

/** Verification status for any extracted or claimed fact. */
export type VerificationStatus =
  | 'verified_by_source' // confirmed against an authoritative source
  | 'confirmed_by_user' // user asserted it; not independently verified
  | 'extracted' // extracted from a document, not yet confirmed
  | 'inferred' // inferred from other facts
  | 'unknown'

/** A single fact about the user, with provenance + verification. */
export interface UserFact<T = unknown> {
  value: T
  status: VerificationStatus
  /** Where this fact came from (intake question id, document id, inference). */
  provenance: string
  /** Free-text note, e.g. "user was unsure" */
  note?: string
}

// ============================================================================
// 1. MOBILITY STATE — the central entity
// ============================================================================

export interface MobilityState {
  /** Schema version for forward-compat. */
  schemaVersion: 1
  capturedAt: string // ISO date

  // --- Identity & nationality ---
  age: UserFact<number | null>
  nationalities: UserFact<CountryCode[]> // passports held
  currentCountry: UserFact<CountryCode>
  currentResidenceStatus: UserFact<string | null> // e.g. "citizen", "work_permit"

  // --- Human capital ---
  education: UserFact<EducationLevel | null>
  degrees: UserFact<Degree[]>
  occupation: UserFact<string | null> // SOC-style label, free text
  occupationCategory: UserFact<OccupationCategory | null>
  yearsExperience: UserFact<number | null>
  credentialRecognizedIn: UserFact<CountryCode[]> // jurisdictions that recognize the degree

  // --- Economic ---
  annualIncomeUSD: UserFact<number | null>
  savingsUSD: UserFact<number | null>
  investableCapitalUSD: UserFact<number | null>
  remoteWorkEligible: UserFact<boolean | null> // can work remotely across borders
  employerSponsorshipLikely: UserFact<boolean | null>

  // --- Entrepreneurship ---
  founderStatus: UserFact<FounderStatus | null>
  businessStage: UserFact<BusinessStage | null>

  // --- Languages (CEFR scale) ---
  languages: UserFact<LanguageProficiency[]>

  // --- Family ---
  hasSpouse: UserFact<boolean | null>
  hasChildren: UserFact<boolean | null>
  dependentsCount: UserFact<number | null>
  spouseNationality: UserFact<CountryCode | null>

  // --- Preferences & constraints ---
  constraints: Constraint[]
  preferences: Preference[]
  riskTolerance: UserFact<RiskTolerance | null>

  // --- Travel / immigration history ---
  priorImmigrationHistory: UserFact<PriorStatus[]>

  // --- Documents available ---
  documents: DocumentHeld[]
}

export type EducationLevel =
  | 'secondary'
  | 'diploma'
  | 'bachelors'
  | 'masters'
  | 'phd'
  | 'other'

export interface Degree {
  level: EducationLevel
  field: string
  country: CountryCode // where issued
  institution?: string
  year?: number
}

export type OccupationCategory =
  | 'software_it'
  | 'engineering'
  | 'finance'
  | 'healthcare'
  | 'education'
  | 'creative'
  | 'trades'
  | 'other'

export type FounderStatus = 'not_founder' | 'aspiring' | 'active_founder'

export type BusinessStage =
  | 'none'
  | 'idea'
  | 'pre_revenue'
  | 'revenue'
  | 'funded'

export interface LanguageProficiency {
  language: string // ISO 639-1 e.g. "en", "de", "pt"
  cefr: 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2' | 'native'
}

export type RiskTolerance = 'conservative' | 'balanced' | 'aggressive'

export interface PriorStatus {
  country: CountryCode
  status: string
  from: string
  to?: string
}

export interface Constraint {
  kind:
    | 'budget_max'
    | 'time_horizon_months'
    | 'family_must_accompany'
    | 'cannot_leave_country'
    | 'region_preference'
    | 'language_required'
    | 'must_keep_remote_job'
    | 'other'
  value: string
  rationale?: string
}

export interface Preference {
  kind:
    | 'income_priority'
    | 'safety_priority'
    | 'education_value'
    | 'citizenship_priority'
    | 'mobility_priority'
    | 'family_stability'
    | 'entrepreneurship'
    | 'climate'
    | 'culture'
    | 'other'
  weight: number // 0..1
  note?: string
}

export interface DocumentHeld {
  type:
    | 'passport'
    | 'degree_certificate'
    | 'transcript'
    | 'employment_letter'
    | 'cv'
    | 'bank_statement'
    | 'business_registration'
    | 'tax_return'
    | 'language_certificate'
    | 'marriage_certificate'
    | 'other'
  status: VerificationStatus
  note?: string
}

// ============================================================================
// 2. INTENT
// ============================================================================

/** What the user is trying to make possible, in structured form. */
export interface Intent {
  rawInput: string
  /** The explicitly stated primary objective. */
  statedGoal: IntentGoal
  /** What success actually looks like to the user. */
  desiredOutcomes: IntentOutcome[]
  /** Time horizon in months. */
  timeHorizonMonths: number | null
  /** Stated constraints, mirrored from mobility state if relevant. */
  constraints: Constraint[]
  /** Priorities as weights 0..1. */
  priorities: Preference[]
  riskTolerance: RiskTolerance
  /** Objectives the user did NOT state but which their wording implies. */
  implicitObjectives: ImplicitObjective[]
  /** How sure we are about the parsed intent. */
  confidence: Confidence
}

export type IntentGoal =
  | 'move_abroad_general'
  | 'earn_more'
  | 'study_and_stay'
  | 'start_company_abroad'
  | 'safer_life_for_family'
  | 'spend_years_abroad'
  | 'second_citizenship'
  | 'maximize_mobility'
  | 'maximize_income'
  | 'remote_work_abroad'
  | 'other'

export interface IntentOutcome {
  outcome:
    | 'residence'
    | 'permanent_residence'
    | 'citizenship'
    | 'employment'
    | 'higher_income'
    | 'company_formation'
    | 'education'
    | 'family_safety'
    | 'travel_freedom'
    | 'optionality'
  horizon: 'near' | 'mid' | 'long' // <1y, 1-3y, 3y+
}

export interface ImplicitObjective {
  objective: string
  evidence: string // why we inferred it from the raw input
  weight: number // 0..1
}

// ============================================================================
// 3. KNOWLEDGE BASE — countries, pathways, evidence, enablers
// ============================================================================

export interface Country {
  code: CountryCode
  name: string
  region: 'EU' | 'EEA' | 'North America' | 'Middle East' | 'Oceania' | 'Asia' | 'Africa' | 'LATAM' | 'UK'
  /** Passport-strength signal: number of destinations accessible visa-free. */
  passportMobilityScore: number // 0..100
  /** Whether the country permits dual citizenship (relevant for long-term planning). */
  dualCitizenship: 'permitted' | 'restricted' | 'prohibited'
  currency: string
  notes?: string
}

/** A legal immigration pathway (visa / permit / status). */
export interface Pathway {
  id: string
  countryCode: CountryCode
  countryName: string
  name: string
  category: PathwayCategory
  /** Short tagline for cards. */
  tagline: string
  /** What this pathway leads to. */
  leadsTo: PathwayDestination
  /** The entry requirements, evaluated deterministically. */
  requirements: Requirement[]
  /** The downstream transitions unlocked once entry status is achieved. */
  downstream: Transition[]
  /** Estimated total cost in USD (fees + required show-money, not living costs). */
  estimatedCostUSD: number
  /** Application processing time in months. */
  processingTimeMonths: number
  /** How long the entry status is valid (months). */
  validityMonths: number
  /** Is a third-party enabler required by law/policy? */
  requiresThirdParty: boolean
  /** Evidence supporting this pathway's rules. */
  evidenceIds: string[]
  /** Risk / stability notes. */
  riskNotes?: string
  /** Whether this pathway is part of a shortage / priority list. */
  shortageOccupationFriendly?: boolean
  /** Effective date of these rules. */
  effectiveFrom: string
  effectiveTo?: string
  /** The policy version this pathway belongs to. */
  policyVersion: string
}

export type PathwayCategory =
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

export type PathwayDestination =
  | 'temporary_residence'
  | 'work_residence'
  | 'permanent_residence'
  | 'citizenship_eligible'

/** A deterministic eligibility requirement. Evaluated by the policy engine. */
export interface Requirement {
  id: string
  /** Human label, e.g. "Recognized bachelor's degree". */
  label: string
  /** The kind of predicate the policy engine runs. */
  kind: RequirementKind
  /** Parameters for the predicate (typed loosely, interpreted by engine). */
  params: Record<string, unknown>
  /** Evidence that backs this requirement. */
  evidenceIds: string[]
  /** Whether a legitimate enabler can satisfy this if missing. */
  enablerAddressable: boolean
  /** How critical: hard = blocks eligibility; soft = reduces score. */
  criticality: 'hard' | 'soft'
}

export type RequirementKind =
  | 'min_age' // params: { max }
  | 'max_age' // params: { max }
  | 'occupation_in' // params: { categories: OccupationCategory[] }
  | 'shortage_occupation' // params: { country }
  | 'min_salary_usd' // params: { amount, reduced_for_shortage?: amount }
  | 'min_education' // params: { level: EducationLevel }
  | 'degree_recognized' // params: { in: CountryCode }
  | 'min_savings_usd' // params: { amount }
  | 'min_passive_income_usd_monthly' // params: { amount }
  | 'min_investable_capital_usd' // params: { amount }
  | 'language_cefr' // params: { language, level }
  | 'language_or' // params: { alternatives: {language,level}[] }
  | 'remote_work_capable' // params: {}
  | 'has_employer_offer' // params: {}
  | 'employer_sponsorship' // params: {}
  | 'business_plan' // params: {}
  | 'designated_incubator_support' // params: {}
  | 'endorsement_body' // params: { body }
  | 'settlement_funds_usd' // params: { amount }
  | 'min_years_experience' // params: { years }
  | 'points_threshold' // params: { system, min }
  | 'clean_criminal_record' // params: {}
  | 'health_insurance' // params: {}

/** A legal state transition downstream of an entry pathway. */
export interface Transition {
  id: string
  from: string // status label
  to: string // status label
  /** Months typically required between from and to. */
  durationMonths: number
  /** Conditions that must hold to make the transition. */
  conditions: string[]
  evidenceIds: string[]
  /** Whether this transition is reversible. */
  reversible: boolean
}

// ============================================================================
// 4. EVIDENCE
// ============================================================================

export interface Evidence {
  id: string
  /** What kind of source. */
  kind: 'government' | 'legislation' | 'embassy' | 'official_portal' | 'institution' | 'secondary'
  /** Display title. */
  title: string
  /** The jurisdiction this evidence applies to. */
  jurisdiction: CountryCode | 'EU' | 'multiple'
  /** The authoritative publisher. */
  publisher: string
  /** URL of the source. */
  url: string
  /** When the source was published / last updated (best known). */
  publishedAt?: string
  /** When the rule described becomes effective. */
  effectiveFrom?: string
  /** Excerpt of the exact relevant text. */
  excerpt: string
  /** The specific location within the source (section, page, heading). */
  location?: string
  /** How the excerpt was obtained. */
  extractionMethod: 'manual_curated' | 'machine_extracted'
  /** Verification status of the evidence itself. */
  verification: 'official' | 'corroborated' | 'unverified'
  /** Supersession chain. */
  supersedes?: string
  supersededBy?: string
}

// ============================================================================
// 5. POLICY — versioning for reproducibility
// ============================================================================

export interface PolicyVersion {
  /** Semantic version of the knowledge base. */
  version: string
  /** ISO date this snapshot was curated. */
  curatedAt: string
  /** Short hash of the policy contents, for ledger references. */
  hash: string
  /** Human changelog. */
  notes: string
}

// ============================================================================
// 6. ELIGIBILITY RESULT (policy engine output)
// ============================================================================

export interface EligibilityResult {
  pathwayId: string
  /** true / false / conditional (conditional = eligible if listed conditions met). */
  status: 'eligible' | 'conditional' | 'ineligible'
  /** Requirements that passed. */
  satisfied: RequirementEval[]
  /** Requirements that failed (blockers). */
  failed: RequirementEval[]
  /** Requirements we could not evaluate due to missing data. */
  unknown: RequirementEval[]
  /** Conditions that, if met, would make a conditional route eligible. */
  conditions: string[]
  /** All blockers (failed hard requirements), with addressing options. */
  blockers: Blocker[]
  /** Overall confidence in the determination. */
  confidence: Confidence
  /** Evidence referenced. */
  evidenceIds: string[]
}

export interface RequirementEval {
  requirement: Requirement
  passed: boolean | null // null = could not evaluate
  reason: string
  /** If failed/unknown, what the user would need. */
  needed?: string
}

export interface Blocker {
  requirementId: string
  label: string
  reason: string
  /** Legitimate ways to address the blocker (enabler-based, never fraudulent). */
  addressableVia: EnablerAddressal[]
}

export interface EnablerAddressal {
  kind: 'employer_offer' | 'sponsor' | 'incubator' | 'university' | 'investor' | 'language_cert' | 'credential_recognition' | 'settlement_funds' | 'business_formation' | 'endorsement' | 'documentation'
  label: string
  description: string
  /** Enabler node ids that could provide this. */
  enablerIds: string[]
  legitimacy: 'required' | 'legally_valid' | 'supportive' | 'not_relevant'
}

// ============================================================================
// 7. ROUTES — sequences of legal state transitions
// ============================================================================

export interface Route {
  id: string
  label: string
  countryCode: CountryCode
  countryName: string
  entryPathwayId: string
  steps: RouteStep[]
  eligibility: EligibilityResult
  scores: RouteScores
  paretoOptimal: boolean
  totalMonths: number
  totalCostUSD: number
  thirdPartyDependencies: number
  reversible: boolean
  futureOptions: string[]
  risk: 'low' | 'medium' | 'high'
  evidenceIds: string[]
}

export interface RouteStep {
  order: number
  status: string
  description: string
  durationMonths: number
  conditions: string[]
  evidenceIds: string[]
  blocked: boolean
  blockerLabels?: string[]
}

export interface RouteScores {
  economicUpside: number // 0..100
  immigrationProbability: number // 0..100
  speed: number // 0..100
  affordability: number // 0..100
  longTermResidence: number // 0..100
  citizenshipProspect: number // 0..100
  familyUtility: number // 0..100
  mobilityUpside: number // 0..100
  optionality: number // 0..100
  reversibility: number // 0..100
  riskAdjusted: number // 0..100
}

// ============================================================================
// 8. FRONTIER
// ============================================================================

export interface FrontierPoint {
  routeId: string
  label: string
  dimensions: RouteScores
  paretoOptimal: boolean
}

export interface MobilityFrontier {
  points: FrontierPoint[]
  paretoDimensions: (keyof RouteScores)[]
  paretoOptimalRouteIds: string[]
}

// ============================================================================
// 9. ENABLERS & MARKETPLACE
// ============================================================================

export interface Enabler {
  id: string
  name: string
  kind: EnablerKind
  countryCode: CountryCode
  satisfies: EnablerAddressal['kind'][]
  description: string
  enablerGets: string
  preconditions: string[]
  legitimacy: 'required' | 'legally_valid' | 'supportive'
  evidenceIds?: string[]
}

export type EnablerKind =
  | 'employer'
  | 'university'
  | 'incubator'
  | 'accelerator'
  | 'investor'
  | 'professional_body'
  | 'endorsement_body'
  | 'language_provider'
  | 'credential_evaluator'
  | 'law_firm'
  | 'community_org'

export interface EnablerMatch {
  enabler: Enabler
  addresses: string
  rationale: string
  relationship: string
  whatUserGets: string
  whatEnablerGets: string
  consentRequired: true
  consentGranted: boolean
}

// ============================================================================
// 10. RECOMMENDATION & PLAN
// ============================================================================

export interface AlternativeIntent {
  goal: IntentGoal
  title: string
  rationale: string
  betterSatisfies: string[]
  tradeoffs: string[]
  bestRouteId?: string
  mayBeSuperior: boolean
}

export interface Recommendation {
  bestRouteId: string
  rationale: string[]
  primaryBlocker?: string
  unlocks: string[]
  nextAction: string
  sensitivityAssumptions: string[]
  intentMayBeSuboptimal: boolean
}

export interface MobilityPlan {
  generatedAt: string
  asOfDate: string
  policyVersion: string
  policyHash: string
  /** The normalized policy snapshot this plan was computed against. */
  policySnapshotId?: string
  /** The runtime policy version (base + overlays). */
  runtimePolicyVersion?: string
  /** The runtime policy hash (base + overlays + asOf). */
  runtimePolicyHash?: string
  /** The active overlay publication ids this plan was computed with. */
  activeOverlayIds?: string[]
  state: MobilityState
  intent: Intent
  routes: Route[]
  frontier: MobilityFrontier
  recommendation: Recommendation
  alternativeIntents: AlternativeIntent[]
  enablerMatches: EnablerMatch[]
  scenarios: ScenarioResult[]
  evidenceIds: string[]
  confidence: Confidence
}

// ============================================================================
// 11. COUNTERFACTUAL
// ============================================================================

export interface ScenarioResult {
  id: string
  label: string
  deltaDescription: string
  modifiedState: MobilityState
  bestRouteId: string
  scoreDelta: Partial<RouteScores>
  newlyEligibleRouteIds: string[]
  newlyBlockedRouteIds: string[]
  summary: string
}

// ============================================================================
// 12. DECISION LEDGER
// ============================================================================

export interface DecisionLedgerEntry {
  id: string
  personId: string
  createdAt: string
  asOfDate: string
  policyVersion: string
  policyHash: string
  stateVersion: number
  intentVersion: number
  plan: MobilityPlan
}
