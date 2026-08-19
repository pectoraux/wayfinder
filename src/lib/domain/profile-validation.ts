// Wayfinder — Profile Update Validation (N0.3)
//
// Server-side validation for profile updates. The browser is NEVER the
// authoritative source — the server loads its latest MobilityStateSnapshot,
// validates the requested updates against the actual domain structure, and
// merges them onto the server state.
//
// This module defines:
//   1. The set of editable fields (only fields the strategy engine depends on).
//   2. Per-field validators (type + range checks).
//   3. A function to apply validated updates to a server-state MobilityState,
//      preserving USER_CONFIRMED provenance.
//
// Unknown fields are REJECTED (not silently ignored) so the client gets clear
// feedback that it sent something the server doesn't understand.

import type { MobilityState, UserFact, EducationLevel, OccupationCategory, FounderStatus, BusinessStage, LanguageProficiency, CountryCode } from '@/lib/domain/types'

// ---------------------------------------------------------------------------
// Editable field registry
// ---------------------------------------------------------------------------

/** The fields a user is allowed to edit via the ProfileEditor. */
export const EDITABLE_FIELDS = [
  // Identity
  'age',
  'nationalities',
  'currentCountry',
  'currentResidenceStatus',
  // Education
  'education',
  'credentialRecognizedIn',
  // Career
  'occupation',
  'occupationCategory',
  'yearsExperience',
  'annualIncomeUSD',
  'remoteWorkEligible',
  'employerSponsorshipLikely',
  // Capital
  'savingsUSD',
  'investableCapitalUSD',
  // Entrepreneurship
  'founderStatus',
  'businessStage',
  // Languages
  'languages',
  // Family
  'hasSpouse',
  'hasChildren',
  'dependentsCount',
  'spouseNationality',
  // Risk
  'riskTolerance',
] as const

export type EditableField = (typeof EDITABLE_FIELDS)[number]

// ---------------------------------------------------------------------------
// Validation result
// ---------------------------------------------------------------------------

export interface ValidationResult {
  valid: boolean
  errors: string[]
  /** The validated updates, typed and ready to merge. */
  validatedUpdates: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Per-field validators
// ---------------------------------------------------------------------------

const EDUCATION_LEVELS: EducationLevel[] = ['secondary', 'diploma', 'bachelors', 'masters', 'phd', 'other']
const OCCUPATION_CATEGORIES: OccupationCategory[] = ['software_it', 'engineering', 'finance', 'healthcare', 'education', 'creative', 'trades', 'other']
const FOUNDER_STATUSES: FounderStatus[] = ['not_founder', 'aspiring', 'active_founder']
const BUSINESS_STAGES: BusinessStage[] = ['none', 'idea', 'pre_revenue', 'revenue', 'funded']
const CEFR_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'native'] as const
const RISK_TOLERANCES = ['conservative', 'balanced', 'aggressive'] as const

function isString(v: unknown): v is string { return typeof v === 'string' }
function isNumber(v: unknown): v is number { return typeof v === 'number' && Number.isFinite(v) }
function isBoolean(v: unknown): v is boolean { return typeof v === 'boolean' }
function isStringArray(v: unknown): v is string[] { return Array.isArray(v) && v.every(isString) }

function validateField(field: string, value: unknown): string | null {
  switch (field) {
    case 'age':
      if (value == null || (isNumber(value) && value >= 0 && value < 150)) return null
      return 'age must be a number between 0 and 150 (or null)'
    case 'nationalities':
      if (isStringArray(value)) return null
      return 'nationalities must be an array of country codes'
    case 'currentCountry':
      if (isString(value) && value.length === 2) return null
      return 'currentCountry must be a 2-letter country code'
    case 'currentResidenceStatus':
      if (value == null || isString(value)) return null
      return 'currentResidenceStatus must be a string or null'
    case 'education':
      if (value == null || (isString(value) && EDUCATION_LEVELS.includes(value as EducationLevel))) return null
      return `education must be one of: ${EDUCATION_LEVELS.join(', ')} (or null)`
    case 'credentialRecognizedIn':
      if (isStringArray(value)) return null
      return 'credentialRecognizedIn must be an array of country codes'
    case 'occupation':
      if (value == null || isString(value)) return null
      return 'occupation must be a string or null'
    case 'occupationCategory':
      if (value == null || (isString(value) && OCCUPATION_CATEGORIES.includes(value as OccupationCategory))) return null
      return `occupationCategory must be one of: ${OCCUPATION_CATEGORIES.join(', ')} (or null)`
    case 'yearsExperience':
      if (value == null || (isNumber(value) && value >= 0 && value < 80)) return null
      return 'yearsExperience must be a number between 0 and 80 (or null)'
    case 'annualIncomeUSD':
    case 'savingsUSD':
    case 'investableCapitalUSD':
      if (value == null || (isNumber(value) && value >= 0)) return null
      return `${field} must be a non-negative number (or null)`
    case 'remoteWorkEligible':
    case 'employerSponsorshipLikely':
    case 'hasSpouse':
    case 'hasChildren':
      if (value == null || isBoolean(value)) return null
      return `${field} must be a boolean (or null)`
    case 'founderStatus':
      if (value == null || (isString(value) && FOUNDER_STATUSES.includes(value as FounderStatus))) return null
      return `founderStatus must be one of: ${FOUNDER_STATUSES.join(', ')} (or null)`
    case 'businessStage':
      if (value == null || (isString(value) && BUSINESS_STAGES.includes(value as BusinessStage))) return null
      return `businessStage must be one of: ${BUSINESS_STAGES.join(', ')} (or null)`
    case 'languages':
      if (!Array.isArray(value)) return 'languages must be an array'
      for (const lang of value) {
        if (!lang || typeof lang !== 'object') return 'each language must be an object'
        const l = lang as Record<string, unknown>
        if (!isString(l.language) || l.language.length !== 2) return 'language.language must be a 2-letter code'
        if (!isString(l.cefr) || !CEFR_LEVELS.includes(l.cefr as typeof CEFR_LEVELS[number])) return `language.cefr must be one of: ${CEFR_LEVELS.join(', ')}`
      }
      return null
    case 'dependentsCount':
      if (value == null || (isNumber(value) && value >= 0 && value < 50)) return null
      return 'dependentsCount must be a number between 0 and 50 (or null)'
    case 'spouseNationality':
      if (value == null || (isString(value) && value.length === 2)) return null
      return 'spouseNationality must be a 2-letter country code (or null)'
    case 'riskTolerance':
      if (value == null || (isString(value) && RISK_TOLERANCES.includes(value as typeof RISK_TOLERANCES[number]))) return null
      return `riskTolerance must be one of: ${RISK_TOLERANCES.join(', ')} (or null)`
    default:
      return `unknown field: ${field}`
  }
}

// ---------------------------------------------------------------------------
// Validate a full updates object
// ---------------------------------------------------------------------------

/**
 * Validate a profile updates object against the editable field registry.
 * Returns { valid, errors, validatedUpdates }.
 *
 * Unknown fields are REJECTED (not silently ignored) so the client gets
 * clear feedback. This prevents a malformed client from accidentally
 * overwriting fields it shouldn't touch (e.g. schemaVersion, capturedAt).
 */
export function validateProfileUpdates(updates: Record<string, unknown>): ValidationResult {
  const errors: string[] = []
  const validatedUpdates: Record<string, unknown> = {}

  for (const [field, value] of Object.entries(updates)) {
    // Reject unknown fields
    if (!EDITABLE_FIELDS.includes(field as EditableField)) {
      errors.push(`unknown field: ${field}`)
      continue
    }
    const err = validateField(field, value)
    if (err) {
      errors.push(err)
    } else {
      validatedUpdates[field] = value
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    validatedUpdates,
  }
}

// ---------------------------------------------------------------------------
// Apply validated updates to a server-state MobilityState
// ---------------------------------------------------------------------------

/**
 * Apply validated updates to a server-state MobilityState, returning a NEW
 * MobilityState. Preserves USER_CONFIRMED provenance on UserFact fields.
 * Never mutates the input state.
 *
 * This is the ONLY function that should be used to merge profile updates.
 * It enforces:
 *   - UserFact fields get value + status='confirmed_by_user' + provenance='user_edit'
 *   - Non-UserFact fields (constraints, preferences, documents) are NOT
 *     editable via this path (they're not in EDITABLE_FIELDS)
 */
export function applyValidatedUpdates(
  state: MobilityState,
  validatedUpdates: Record<string, unknown>,
): MobilityState {
  const updated: MobilityState = JSON.parse(JSON.stringify(state))

  for (const [key, value] of Object.entries(validatedUpdates)) {
    const current = (updated as any)[key]
    if (current && typeof current === 'object' && 'value' in current) {
      // UserFact field: update the value, mark as user-confirmed
      current.value = value
      current.status = 'confirmed_by_user'
      current.provenance = 'user_edit'
    } else {
      // Not a UserFact — shouldn't happen (EDITABLE_FIELDS only contains
      // UserFact fields), but handle gracefully.
      ;(updated as any)[key] = value
    }
  }

  updated.capturedAt = new Date().toISOString()
  return updated
}
