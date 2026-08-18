// Wayfinder Policy Engine — deterministic eligibility evaluation.
//
// evaluatePathway(state, pathway) returns an EligibilityResult with NO LLM
// involvement. Every requirement is a typed predicate evaluated against the
// user's MobilityState. Missing data yields "unknown" (conditional) rather
// than a guess. The LLM is only used downstream to EXPLAIN these results.

import type {
  Blocker,
  CountryCode,
  EducationLevel,
  EligibilityResult,
  EnablerAddressal,
  MobilityState,
  Pathway,
  Requirement,
  RequirementEval,
  UserFact,
} from '@/lib/domain/types'
import { getEnablersForAddressal } from '@/lib/knowledge/enablers'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function fact<T>(value: T, provenance: string, status: UserFact['status'] = 'confirmed_by_user'): UserFact<T> {
  return { value, status, provenance }
}

const EDUCATION_RANK: Record<EducationLevel, number> = {
  secondary: 1,
  diploma: 2,
  bachelors: 3,
  masters: 4,
  phd: 5,
  other: 0,
}

const CEFR_RANK: Record<string, number> = {
  A1: 1, A2: 2, B1: 3, B2: 4, C1: 5, C2: 6, native: 7,
}

/** Occupations treated as shortage-occupations per jurisdiction. */
const SHORTAGE: Record<string, string[]> = {
  DE: ['software_it', 'engineering', 'healthcare'],
  CA: ['software_it', 'engineering', 'healthcare', 'finance'],
}

export function isShortage(category: string | null, countryCode: CountryCode): boolean {
  if (!category) return false
  return (SHORTAGE[countryCode] ?? []).includes(category)
}

function getLanguage(state: MobilityState, language: string) {
  return state.languages.value.find((l) => l.language.toLowerCase() === language.toLowerCase())
}

// ---------------------------------------------------------------------------
// Per-requirement evaluation
// ---------------------------------------------------------------------------

interface EvalOutput {
  passed: boolean | null
  reason: string
  needed?: string
  addressal?: EnablerAddressal['kind']
}

function evaluateRequirement(req: Requirement, state: MobilityState): EvalOutput {
  const p = req.params as Record<string, any>

  switch (req.kind) {
    case 'max_age': {
      const age = state.age.value
      if (age == null) return { passed: null, reason: 'Age not provided', needed: `Be under ${p.max}` }
      if (age <= p.max) return { passed: true, reason: `Age ${age} ≤ ${p.max}` }
      return { passed: false, reason: `Age ${age} exceeds ${p.max}` }
    }

    case 'min_age': {
      const age = state.age.value
      if (age == null) return { passed: null, reason: 'Age not provided', needed: `Be at least ${p.min}` }
      if (age >= p.min) return { passed: true, reason: `Age ${age} ≥ ${p.min}` }
      return { passed: false, reason: `Age ${age} below ${p.min}` }
    }

    case 'occupation_in': {
      const cat = state.occupationCategory.value
      if (!cat) return { passed: null, reason: 'Occupation category not specified', needed: 'Provide your occupation' }
      if (p.categories.includes(cat)) return { passed: true, reason: `Occupation "${cat}" is qualifying` }
      return { passed: false, reason: `Occupation "${cat}" is not on the qualifying list` }
    }

    case 'shortage_occupation': {
      const cat = state.occupationCategory.value
      const country = p.country as CountryCode
      if (isShortage(cat, country)) return { passed: true, reason: `${cat} is a shortage occupation in ${country}` }
      if (!cat) return { passed: null, reason: 'Occupation not specified' }
      return { passed: false, reason: 'Not a shortage occupation (standard threshold applies)' }
    }

    case 'min_salary_usd': {
      const income = state.annualIncomeUSD.value
      const cat = state.occupationCategory.value
      const country = (p as any).country ?? ''
      const shortage = isShortage(cat, country) || isShortage(cat, 'DE')
      const threshold = shortage && p.reduced_for_shortage ? p.reduced_for_shortage : p.amount
      if (income != null && income >= threshold) {
        return { passed: true, reason: `Current income $${income.toLocaleString()} ≥ threshold $${threshold.toLocaleString()}${shortage ? ' (shortage rate)' : ''}` }
      }
      return {
        passed: null,
        reason: income != null ? `Current income $${income.toLocaleString()} below $${threshold.toLocaleString()}` : 'Income not provided',
        needed: `Secure a qualifying offer ≥ $${threshold.toLocaleString()}/yr${shortage ? ' (shortage rate)' : ''}`,
        addressal: 'employer_offer',
      }
    }

    case 'min_education': {
      const edu = state.education.value
      if (!edu) return { passed: null, reason: 'Education not provided', needed: `Hold a ${p.level}` }
      if (EDUCATION_RANK[edu] >= EDUCATION_RANK[p.level as EducationLevel]) {
        return { passed: true, reason: `${edu} meets ${p.level} minimum` }
      }
      return { passed: false, reason: `${edu} below required ${p.level}` }
    }

    case 'degree_recognized': {
      const inCountry = p.in as CountryCode
      if (state.degrees.value.length === 0) {
        return { passed: false, reason: 'No degree recorded', needed: `Obtain a recognized degree (assessed in ${inCountry})` }
      }
      if (state.credentialRecognizedIn.value.includes(inCountry)) {
        return { passed: true, reason: `Degree recognized in ${inCountry}` }
      }
      return {
        passed: null,
        reason: `Recognition in ${inCountry} not yet established`,
        needed: `Credential assessment for ${inCountry}`,
        addressal: 'credential_recognition',
      }
    }

    case 'min_savings_usd': {
      const s = state.savingsUSD.value
      if (s == null) return { passed: null, reason: 'Savings not provided', needed: `Show ≥ $${p.amount.toLocaleString()} in savings` }
      if (s >= p.amount) return { passed: true, reason: `Savings $${s.toLocaleString()} ≥ $${p.amount.toLocaleString()}` }
      return { passed: false, reason: `Savings $${s.toLocaleString()} below $${p.amount.toLocaleString()}`, needed: `Accumulate ≥ $${p.amount.toLocaleString()}` }
    }

    case 'min_passive_income_usd_monthly': {
      const income = state.annualIncomeUSD.value
      const remote = state.remoteWorkEligible.value
      const monthly = income != null ? income / 12 : null
      if (monthly != null && monthly >= p.amount && remote !== false) {
        return { passed: true, reason: `Recurring income ~$${Math.round(monthly).toLocaleString()}/mo ≥ $${p.amount}/mo${remote ? ' (remote-eligible)' : ''}` }
      }
      return {
        passed: null,
        reason: monthly != null ? `Income ~$${Math.round(monthly).toLocaleString()}/mo below $${p.amount}/mo` : 'Income not provided',
        needed: `Demonstrate recurring income ≥ $${p.amount}/mo`,
      }
    }

    case 'min_investable_capital_usd': {
      const cap = state.investableCapitalUSD.value ?? state.savingsUSD.value
      if (cap == null) return { passed: null, reason: 'Capital not provided', needed: `Show ≥ $${p.amount.toLocaleString()} investable` }
      if (cap >= p.amount) return { passed: true, reason: `Capital $${cap.toLocaleString()} ≥ $${p.amount.toLocaleString()}` }
      return { passed: false, reason: `Capital $${cap.toLocaleString()} below $${p.amount.toLocaleString()}` }
    }

    case 'language_cefr': {
      const lang = getLanguage(state, p.language)
      if (!lang) return { passed: null, reason: `No ${p.language.toUpperCase()} recorded`, needed: `${p.language.toUpperCase()} at ${p.level}`, addressal: 'language_cert' }
      if (CEFR_RANK[lang.cefr] >= CEFR_RANK[p.level]) return { passed: true, reason: `${p.language.toUpperCase()} ${lang.cefr} ≥ ${p.level}` }
      return { passed: false, reason: `${p.language.toUpperCase()} ${lang.cefr} below ${p.level}`, needed: `Reach ${p.language.toUpperCase()} ${p.level}`, addressal: 'language_cert' }
    }

    case 'language_or': {
      const alts = p.alternatives as { language: string; level: string }[]
      for (const a of alts) {
        const lang = getLanguage(state, a.language)
        if (lang && CEFR_RANK[lang.cefr] >= CEFR_RANK[a.level]) {
          return { passed: true, reason: `${a.language.toUpperCase()} ${lang.cefr} ≥ ${a.level}` }
        }
      }
      return {
        passed: null,
        reason: `No qualifying language at required level (${alts.map((a) => `${a.language.toUpperCase()} ${a.level}`).join(' / ')})`,
        needed: `Reach ${alts.map((a) => `${a.language.toUpperCase()} ${a.level}`).join(' or ')}`,
        addressal: 'language_cert',
      }
    }

    case 'remote_work_capable': {
      const r = state.remoteWorkEligible.value
      if (r === true) return { passed: true, reason: 'Remote work confirmed' }
      if (r === false) return { passed: false, reason: 'Not remote-eligible' }
      return { passed: null, reason: 'Remote eligibility not specified' }
    }

    case 'has_employer_offer':
    case 'employer_sponsorship': {
      // We never assert the user has a live offer from state alone — this is the
      // canonical "conditional" requirement, addressable via the employer enabler.
      return {
        passed: null,
        reason: 'No binding employer offer on record',
        needed: 'Secure a qualifying employer offer',
        addressal: 'employer_offer',
      }
    }

    case 'business_plan': {
      const fs = state.founderStatus.value
      const bs = state.businessStage.value
      if (fs === 'active_founder' || bs === 'revenue' || bs === 'funded' || bs === 'pre_revenue' || bs === 'idea' || fs === 'aspiring') {
        return { passed: true, reason: `Founder status (${fs ?? bs}) supports a qualifying plan` }
      }
      return { passed: null, reason: 'No founder intent recorded', needed: 'Develop an innovative business plan', addressal: 'business_formation' }
    }

    case 'designated_incubator_support': {
      return {
        passed: null,
        reason: 'No Letter of Support / incubator hosting on record',
        needed: 'Secure support from a designated incubator',
        addressal: 'designated_incubator_support',
      }
    }

    case 'endorsement_body': {
      return {
        passed: null,
        reason: `No ${p.body} endorsement on record`,
        needed: `Obtain endorsement from ${p.body}`,
        addressal: 'endorsement',
      }
    }

    case 'settlement_funds_usd': {
      const s = state.savingsUSD.value
      if (s == null) return { passed: null, reason: 'Settlement funds not provided', needed: `Show ≥ $${p.amount.toLocaleString()}` }
      if (s >= p.amount) return { passed: true, reason: `Funds $${s.toLocaleString()} ≥ $${p.amount.toLocaleString()}` }
      return { passed: false, reason: `Funds $${s.toLocaleString()} below $${p.amount.toLocaleString()}` }
    }

    case 'min_years_experience': {
      const y = state.yearsExperience.value
      if (y == null) return { passed: null, reason: 'Experience not provided', needed: `≥ ${p.years} year(s)` }
      if (y >= p.years) return { passed: true, reason: `${y} years ≥ ${p.years}` }
      return { passed: false, reason: `${y} years below ${p.years}` }
    }

    case 'points_threshold': {
      const result = computePoints(p.system, p.min, state)
      return result
    }

    case 'clean_criminal_record':
      return { passed: true, reason: 'Assumed clear (verify at application)' }

    case 'health_insurance':
      return { passed: true, reason: 'Arranged at application stage' }

    default:
      return { passed: null, reason: `Unsupported requirement kind: ${req.kind}` }
  }
}

// ---------------------------------------------------------------------------
// Points systems (Chancenkarte + FSW 67-point grid approximation)
// ---------------------------------------------------------------------------

function computePoints(system: string, min: number, state: MobilityState): EvalOutput {
  if (system === 'chancenkarte') {
    let pts = 0
    const breakdown: string[] = []
    const edu = state.education.value
    if (edu && EDUCATION_RANK[edu] >= EDUCATION_RANK.bachelors) { pts += 4; breakdown.push('degree +4') }
    const de = getLanguage(state, 'de')
    const en = getLanguage(state, 'en')
    if (de && CEFR_RANK[de.cefr] >= CEFR_RANK.C1) { pts += 3; breakdown.push('German C1 +3') }
    else if (de && CEFR_RANK[de.cefr] >= CEFR_RANK.B2) { pts += 2; breakdown.push('German B2 +2') }
    if (en && CEFR_RANK[en.cefr] >= CEFR_RANK.B2) { pts += 1; breakdown.push('English B2 +1') }
    const age = state.age.value
    if (age != null && age < 35) { pts += 2; breakdown.push('age <35 +2') }
    const y = state.yearsExperience.value
    if (y != null && y >= 2) { pts += 2; breakdown.push('experience ≥2y +2') }
    if (pts >= min) return { passed: true, reason: `${pts} points (${breakdown.join(', ')}) ≥ ${min}` }
    return { passed: null, reason: `${pts} points below ${min} (${breakdown.join(', ')})`, needed: `Reach ${min} points (e.g. add German B2/C1)`, addressal: 'language_cert' }
  }

  if (system === 'fsw-crs') {
    // Approximation of the FSW 67-point selection grid. Honest about being an
    // estimate; CRS pool competitiveness (the draw cutoff) is a separate signal.
    let pts = 0
    const breakdown: string[] = []

    // Education (max 25)
    const edu = state.education.value
    const eduPts = edu === 'phd' ? 25 : edu === 'masters' ? 23 : edu === 'bachelors' ? 21 : edu === 'diploma' ? 19 : 5
    pts += eduPts; breakdown.push(`education ${eduPts}`)

    // Language (max 24 first lang at CLB9+)
    const en = getLanguage(state, 'en')
    let langPts = 0
    if (en) {
      langPts = CEFR_RANK[en.cefr] >= CEFR_RANK.C1 ? 24 : CEFR_RANK[en.cefr] >= CEFR_RANK.B2 ? 16 : CEFR_RANK[en.cefr] >= CEFR_RANK.B1 ? 8 : 4
    }
    pts += langPts; breakdown.push(`language ${langPts}`)

    // Age (max 12, 18-35 full)
    const age = state.age.value
    let agePts = 0
    if (age != null) {
      if (age >= 18 && age <= 35) agePts = 12
      else if (age <= 45) agePts = Math.max(0, 12 - (age - 35))
    }
    pts += agePts; breakdown.push(`age ${agePts}`)

    // Experience (max 15)
    const y = state.yearsExperience.value
    let expPts = 0
    if (y != null) {
      expPts = y >= 6 ? 15 : y >= 4 ? 13 : y >= 2 ? 11 : y >= 1 ? 9 : 0
    }
    pts += expPts; breakdown.push(`experience ${expPts}`)

    // Arranged employment (0 by default)
    // Adaptability (0-10): assume 0 unless strong signals
    const adaptPts = 0
    pts += adaptPts; breakdown.push(`adaptability ${adaptPts}`)

    if (pts >= min) return { passed: true, reason: `≈${pts}/100 FSW grid ≥ ${min} (${breakdown.join(', ')}). CRS pool cutoff is a separate, draw-dependent signal.` }
    return {
      passed: null,
      reason: `≈${pts}/100 FSW grid below ${min} (${breakdown.join(', ')}). Boosting language to C1 (+8) or securing arranged employment (+10) clears the bar.`,
      needed: `Reach ${min} FSW points (language C1 or arranged employment)`,
      addressal: 'language_cert',
    }
  }

  return { passed: null, reason: `Unknown points system: ${system}` }
}

// ---------------------------------------------------------------------------
// Addressal: map a failed/unknown requirement to legitimate enabler options
// ---------------------------------------------------------------------------

function buildAddressal(kind: EnablerAddressal['kind'], countryCode: CountryCode, label: string): EnablerAddressal {
  const enablers = getEnablersForAddressal(kind, countryCode)
  const kindLabel: Record<EnablerAddressal['kind'], string> = {
    employer_offer: 'Employer offer',
    sponsor: 'Sponsor',
    incubator: 'Designated incubator',
    university: 'University',
    investor: 'Investor',
    language_cert: 'Language certification',
    credential_recognition: 'Credential recognition',
    settlement_funds: 'Settlement funds',
    business_formation: 'Business formation',
    endorsement: 'Endorsement body',
    documentation: 'Documentation',
  }
  return {
    kind,
    label: kindLabel[kind],
    description: `Legitimate path to satisfy: ${label}`,
    enablerIds: enablers.map((e) => e.id),
    legitimacy: enablers.some((e) => e.legitimacy === 'required') ? 'required' : 'legally_valid',
  }
}

// ---------------------------------------------------------------------------
// Main: evaluate a full pathway
// ---------------------------------------------------------------------------

export function evaluatePathway(state: MobilityState, pathway: Pathway): EligibilityResult {
  const satisfied: RequirementEval[] = []
  const failed: RequirementEval[] = []
  const unknown: RequirementEval[] = []
  const blockers: Blocker[] = []
  const evidenceIds = new Set<string>(pathway.evidenceIds)
  const conditions: string[] = []

  for (const req of pathway.requirements) {
    const out = evaluateRequirement(req, state)
    req.evidenceIds.forEach((id) => evidenceIds.add(id))
    const evalEntry: RequirementEval = {
      requirement: req,
      passed: out.passed,
      reason: out.reason,
      needed: out.needed,
    }

    if (out.passed === true) {
      satisfied.push(evalEntry)
    } else if (out.passed === false) {
      failed.push(evalEntry)
      if (req.criticality === 'hard') {
        const addressals: EnablerAddressal[] = []
        if (out.addressal) addressals.push(buildAddressal(out.addressal, pathway.countryCode, req.label))
        blockers.push({
          requirementId: req.id,
          label: req.label,
          reason: out.reason,
          addressableVia: addressals,
        })
      }
    } else {
      unknown.push(evalEntry)
      if (req.criticality === 'hard' && out.needed) {
        conditions.push(out.needed)
        const addressals: EnablerAddressal[] = []
        if (out.addressal) addressals.push(buildAddressal(out.addressal, pathway.countryCode, req.label))
        blockers.push({
          requirementId: req.id,
          label: req.label,
          reason: out.reason,
          addressableVia: addressals,
        })
      }
    }
  }

  const hardFailed = failed.filter((e) => e.requirement.criticality === 'hard').length
  const hardUnknown = unknown.filter((e) => e.requirement.criticality === 'hard').length

  let status: EligibilityResult['status']
  let confidence: EligibilityResult['confidence']
  if (hardFailed > 0) {
    status = 'ineligible'
    confidence = 'high'
  } else if (hardUnknown > 0) {
    status = 'conditional'
    confidence = hardUnknown > 1 ? 'low' : 'medium'
  } else {
    status = 'eligible'
    confidence = 'high'
  }

  return {
    pathwayId: pathway.id,
    status,
    satisfied,
    failed,
    unknown,
    conditions,
    blockers,
    confidence,
    evidenceIds: Array.from(evidenceIds),
  }
}
