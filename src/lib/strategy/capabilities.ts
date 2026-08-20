// Wayfinder — Canonical Capability Taxonomy (N0.5)
//
// This is the controlled vocabulary for mobility capabilities. Every capability
// that Wayfinder can identify, desire, or eventually match to an actor is
// defined here. The taxonomy is extensible — new capabilities can be added
// without modifying core strategy logic.
//
// IMPORTANT: this is NOT the marketplace. This is the demand-intelligence
// vocabulary that lets Wayfinder say "you are missing capability X" and
// "capability X could unlock N trajectories."
//
// Each capability maps to:
//   - a canonical ID (stable, never changes)
//   - a human-readable label
//   - a description
//   - the blocker categories it can resolve
//   - whether it requires a third-party actor (vs user-self-acquirable)

// ---------------------------------------------------------------------------
// Capability type
// ---------------------------------------------------------------------------

export type CapabilityId =
  | 'EMPLOYER_SPONSORSHIP'
  | 'QUALIFYING_HOST'
  | 'FINANCIAL_GUARANTOR'
  | 'ADMISSION'
  | 'CREDENTIAL_RECOGNITION'
  | 'LANGUAGE_CERTIFICATION'
  | 'COMMUNITY_SUPPORT'
  | 'FAMILY_RELATIONSHIP'
  | 'CAPITAL'
  | 'ACCOMMODATION'
  | 'LEGAL_REPRESENTATION'
  | 'PROFESSIONAL_SUPPORT'
  | 'VERIFIED_REMOTE_INCOME'
  | 'BUSINESS_FORMATION_SUPPORT'
  | 'ENDORSEMENT'

// ---------------------------------------------------------------------------
// Capability definition
// ---------------------------------------------------------------------------

export interface CapabilityDefinition {
  id: CapabilityId
  label: string
  description: string
  /** Which blocker categories this capability can resolve. */
  resolvesBlockerPatterns: BlockerPattern[]
  /** Whether this capability requires a third-party actor to provide. */
  requiresActor: boolean
  /** Whether the user can self-acquire this (e.g., language cert, savings). */
  userSelfAcquirable: boolean
  /** Typical time to acquire (months). */
  typicalAcquisitionMonths: number
  /** Whether this is a legally required capability (vs supportive). */
  legitimacy: 'required' | 'legally_valid' | 'supportive'
}

export type BlockerPattern =
  | 'employer_sponsorship'
  | 'job_offer'
  | 'credential_recognition'
  | 'degree_recognition'
  | 'language_requirement'
  | 'income_threshold'
  | 'salary_threshold'
  | 'savings_requirement'
  | 'funds_requirement'
  | 'accommodation'
  | 'host_requirement'
  | 'guarantor'
  | 'financial_guarantee'
  | 'admission'
  | 'university_admission'
  | 'incubator_support'
  | 'business_plan'
  | 'business_formation'
  | 'endorsement'
  | 'community_support'
  | 'family_relationship'
  | 'legal_representation'
  | 'professional_support'
  | 'remote_income_verification'
  | 'program_suspended'
  | 'age_requirement'
  | 'points_threshold'
  | 'other'

// ---------------------------------------------------------------------------
// The canonical taxonomy
// ---------------------------------------------------------------------------

export const CAPABILITY_TAXONOMY: CapabilityDefinition[] = [
  {
    id: 'EMPLOYER_SPONSORSHIP',
    label: 'Employer Sponsorship',
    description: 'A qualifying employer willing to sponsor a work visa or residence permit.',
    resolvesBlockerPatterns: ['employer_sponsorship', 'job_offer'],
    requiresActor: true,
    userSelfAcquirable: false,
    typicalAcquisitionMonths: 3,
    legitimacy: 'required',
  },
  {
    id: 'QUALIFYING_HOST',
    label: 'Qualifying Host',
    description: 'A person or entity providing qualifying accommodation required for registration.',
    resolvesBlockerPatterns: ['accommodation', 'host_requirement'],
    requiresActor: true,
    userSelfAcquirable: false,
    typicalAcquisitionMonths: 1,
    legitimacy: 'required',
  },
  {
    id: 'FINANCIAL_GUARANTOR',
    label: 'Financial Guarantor',
    description: 'A person or institution providing a financial guarantee for the visa applicant.',
    resolvesBlockerPatterns: ['guarantor', 'financial_guarantee'],
    requiresActor: true,
    userSelfAcquirable: false,
    typicalAcquisitionMonths: 1,
    legitimacy: 'required',
  },
  {
    id: 'ADMISSION',
    label: 'University Admission',
    description: 'An admission offer from a recognized educational institution.',
    resolvesBlockerPatterns: ['admission', 'university_admission'],
    requiresActor: true,
    userSelfAcquirable: false,
    typicalAcquisitionMonths: 6,
    legitimacy: 'required',
  },
  {
    id: 'CREDENTIAL_RECOGNITION',
    label: 'Credential Recognition',
    description: 'Official recognition of a degree or professional qualification in the target jurisdiction.',
    resolvesBlockerPatterns: ['credential_recognition', 'degree_recognition'],
    requiresActor: true,
    userSelfAcquirable: false,
    typicalAcquisitionMonths: 2,
    legitimacy: 'required',
  },
  {
    id: 'LANGUAGE_CERTIFICATION',
    label: 'Language Certification',
    description: 'A recognized language proficiency certificate (CEFR level).',
    resolvesBlockerPatterns: ['language_requirement'],
    requiresActor: false,
    userSelfAcquirable: true,
    typicalAcquisitionMonths: 6,
    legitimacy: 'required',
  },
  {
    id: 'COMMUNITY_SUPPORT',
    label: 'Community Support',
    description: 'A support letter or community sponsorship from a recognized community organization.',
    resolvesBlockerPatterns: ['community_support'],
    requiresActor: true,
    userSelfAcquirable: false,
    typicalAcquisitionMonths: 2,
    legitimacy: 'legally_valid',
  },
  {
    id: 'FAMILY_RELATIONSHIP',
    label: 'Family Relationship',
    description: 'A qualifying family relationship in the target jurisdiction.',
    resolvesBlockerPatterns: ['family_relationship'],
    requiresActor: false,
    userSelfAcquirable: false,
    typicalAcquisitionMonths: 0,
    legitimacy: 'required',
  },
  {
    id: 'CAPITAL',
    label: 'Capital',
    description: 'Sufficient financial capital (savings, investments, or proof of funds).',
    resolvesBlockerPatterns: ['savings_requirement', 'funds_requirement', 'income_threshold', 'salary_threshold'],
    requiresActor: false,
    userSelfAcquirable: true,
    typicalAcquisitionMonths: 12,
    legitimacy: 'required',
  },
  {
    id: 'ACCOMMODATION',
    label: 'Accommodation',
    description: 'A qualifying residence or rental agreement in the target jurisdiction.',
    resolvesBlockerPatterns: ['accommodation'],
    requiresActor: false,
    userSelfAcquirable: true,
    typicalAcquisitionMonths: 1,
    legitimacy: 'required',
  },
  {
    id: 'LEGAL_REPRESENTATION',
    label: 'Legal Representation',
    description: 'A licensed immigration lawyer or representative for the application process.',
    resolvesBlockerPatterns: ['legal_representation'],
    requiresActor: true,
    userSelfAcquirable: false,
    typicalAcquisitionMonths: 1,
    legitimacy: 'supportive',
  },
  {
    id: 'PROFESSIONAL_SUPPORT',
    label: 'Professional Support',
    description: 'Professional services for document preparation, translation, or application filing.',
    resolvesBlockerPatterns: ['professional_support'],
    requiresActor: true,
    userSelfAcquirable: false,
    typicalAcquisitionMonths: 1,
    legitimacy: 'supportive',
  },
  {
    id: 'VERIFIED_REMOTE_INCOME',
    label: 'Verified Remote Income',
    description: 'Documented, recurring remote income that satisfies passive-income visa requirements.',
    resolvesBlockerPatterns: ['remote_income_verification', 'income_threshold'],
    requiresActor: false,
    userSelfAcquirable: true,
    typicalAcquisitionMonths: 3,
    legitimacy: 'required',
  },
  {
    id: 'BUSINESS_FORMATION_SUPPORT',
    label: 'Business Formation Support',
    description: 'Support from a designated incubator, accelerator, or business formation entity.',
    resolvesBlockerPatterns: ['incubator_support', 'business_plan', 'business_formation'],
    requiresActor: true,
    userSelfAcquirable: false,
    typicalAcquisitionMonths: 3,
    legitimacy: 'required',
  },
  {
    id: 'ENDORSEMENT',
    label: 'Endorsement',
    description: 'An endorsement from a recognized body (e.g., Tech Nation, endorsing agency).',
    resolvesBlockerPatterns: ['endorsement'],
    requiresActor: true,
    userSelfAcquirable: false,
    typicalAcquisitionMonths: 2,
    legitimacy: 'required',
  },
]

// ---------------------------------------------------------------------------
// Lookup utilities
// ---------------------------------------------------------------------------

/** Get a capability definition by ID. */
export function getCapabilityDefinition(id: CapabilityId): CapabilityDefinition | undefined {
  return CAPABILITY_TAXONOMY.find((c) => c.id === id)
}

/** Get all capabilities that can resolve a given blocker pattern. */
export function getCapabilitiesForPattern(pattern: BlockerPattern): CapabilityDefinition[] {
  return CAPABILITY_TAXONOMY.filter((c) => c.resolvesBlockerPatterns.includes(pattern))
}

// ---------------------------------------------------------------------------
// Blocker → Pattern mapping (deterministic)
// ---------------------------------------------------------------------------

/**
 * Map a blocker's label + reason to a canonical BlockerPattern.
 * This is the deterministic bridge between the existing blocker system
 * and the new capability taxonomy.
 *
 * The mapping is based on keyword matching — the same approach the existing
 * blocker analyzer uses (classifyBlocker in blockers.ts). We reuse the
 * same keywords for consistency.
 */
export function classifyBlockerPattern(blockerLabel: string, blockerReason: string): BlockerPattern {
  const l = blockerLabel.toLowerCase()
  const r = blockerReason.toLowerCase()
  const combined = `${l} ${r}`

  if (combined.includes('employer') || combined.includes('sponsorship') || combined.includes('job offer')) return 'employer_sponsorship'
  if (combined.includes('credential') || combined.includes('recognition') || combined.includes('degree')) return 'credential_recognition'
  if (combined.includes('language') || combined.includes('german') || combined.includes('english') || combined.includes('french') || combined.includes('portuguese')) return 'language_requirement'
  if (combined.includes('income') || combined.includes('salary') || combined.includes('passive income')) return 'income_threshold'
  if (combined.includes('savings') || combined.includes('funds') || combined.includes('settlement')) return 'savings_requirement'
  if (combined.includes('accommodation') || combined.includes('housing') || combined.includes('rent')) return 'accommodation'
  if (combined.includes('host')) return 'host_requirement'
  if (combined.includes('guarantor') || combined.includes('guarantee')) return 'guarantor'
  if (combined.includes('admission') || combined.includes('university') || combined.includes('school')) return 'admission'
  if (combined.includes('incubator') || combined.includes('business plan') || combined.includes('startup')) return 'incubator_support'
  if (combined.includes('endorsement') || combined.includes('tech nation')) return 'endorsement'
  if (combined.includes('community') || combined.includes('support letter')) return 'community_support'
  if (combined.includes('family') || combined.includes('spouse') || combined.includes('relative')) return 'family_relationship'
  if (combined.includes('legal') || combined.includes('lawyer') || combined.includes('attorney')) return 'legal_representation'
  if (combined.includes('professional') || combined.includes('consultant') || combined.includes('agency')) return 'professional_support'
  if (combined.includes('remote') || combined.includes('remote work') || combined.includes('remote income')) return 'remote_income_verification'
  if (combined.includes('business') || combined.includes('formation') || combined.includes('incorporation')) return 'business_formation'
  if (combined.includes('suspended') || combined.includes('program')) return 'program_suspended'
  if (combined.includes('age')) return 'age_requirement'
  if (combined.includes('points')) return 'points_threshold'

  return 'other'
}
