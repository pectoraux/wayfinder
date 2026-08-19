// Wayfinder — MobilityState helpers.

import type {
  MobilityState,
  EducationLevel,
  OccupationCategory,
  LanguageProficiency,
  UserFact,
  CountryCode,
  RiskTolerance,
} from './types'
import { fact } from '@/lib/engine/policy'

export function emptyState(): MobilityState {
  const now = new Date().toISOString()
  return {
    schemaVersion: 1,
    capturedAt: now,
    age: fact<number | null>(null, 'intake'),
    nationalities: fact<CountryCode[]>([], 'intake'),
    currentCountry: fact<CountryCode>('', 'intake'),
    currentResidenceStatus: fact<string | null>(null, 'intake'),
    education: fact<EducationLevel | null>(null, 'intake'),
    degrees: fact([], 'intake'),
    occupation: fact<string | null>(null, 'intake'),
    occupationCategory: fact<OccupationCategory | null>(null, 'intake'),
    yearsExperience: fact<number | null>(null, 'intake'),
    credentialRecognizedIn: fact<CountryCode[]>([], 'intake'),
    annualIncomeUSD: fact<number | null>(null, 'intake'),
    savingsUSD: fact<number | null>(null, 'intake'),
    investableCapitalUSD: fact<number | null>(null, 'intake'),
    remoteWorkEligible: fact<boolean | null>(null, 'intake'),
    employerSponsorshipLikely: fact<boolean | null>(null, 'intake'),
    founderStatus: fact(null, 'intake'),
    businessStage: fact(null, 'intake'),
    languages: fact<LanguageProficiency[]>([], 'intake'),
    hasSpouse: fact<boolean | null>(null, 'intake'),
    hasChildren: fact<boolean | null>(null, 'intake'),
    dependentsCount: fact<number | null>(null, 'intake'),
    spouseNationality: fact<CountryCode | null>(null, 'intake'),
    constraints: [],
    preferences: [],
    riskTolerance: fact<RiskTolerance | null>(null, 'intake'),
    priorImmigrationHistory: fact([], 'intake'),
    documents: [{ type: 'passport', status: 'confirmed_by_user' }],
  }
}

/** The canonical demonstration profile (spec §37): a 29-year-old software
 *  engineer from Kenya earning $70k with a bachelor's and $40k savings. */
export function exampleState(): MobilityState {
  const s = emptyState()
  s.age = fact(29, 'intake')
  s.nationalities = fact(['KE'], 'intake')
  s.currentCountry = fact('KE', 'intake')
  s.currentResidenceStatus = fact('citizen', 'intake')
  s.education = fact<EducationLevel | null>('bachelors', 'intake')
  s.degrees = fact([{ level: 'bachelors', field: 'Computer Science', country: 'KE', year: 2018 }], 'intake')
  s.occupation = fact('Software Engineer', 'intake')
  s.occupationCategory = fact<OccupationCategory | null>('software_it', 'intake')
  s.yearsExperience = fact(5, 'intake')
  s.annualIncomeUSD = fact(70000, 'intake')
  s.savingsUSD = fact(40000, 'intake')
  s.investableCapitalUSD = fact(40000, 'intake')
  s.remoteWorkEligible = fact(true, 'intake')
  s.employerSponsorshipLikely = fact(null, 'intake')
  s.founderStatus = fact('aspiring', 'intake')
  s.businessStage = fact('idea', 'intake')
  s.languages = fact([{ language: 'en', cefr: 'native' }], 'intake')
  s.hasSpouse = fact(false, 'intake')
  s.hasChildren = fact(false, 'intake')
  s.dependentsCount = fact(0, 'intake')
  s.riskTolerance = fact<RiskTolerance | null>('balanced', 'intake')
  s.documents = [
    { type: 'passport', status: 'confirmed_by_user' },
    { type: 'degree_certificate', status: 'confirmed_by_user' },
    { type: 'employment_letter', status: 'confirmed_by_user' },
    { type: 'bank_statement', status: 'confirmed_by_user' },
  ]
  return s
}

/** Answers gathered during the progressive intake flow. */
export interface IntakeAnswers {
  age?: number
  nationality?: CountryCode
  currentCountry?: CountryCode
  education?: EducationLevel
  occupationCategory?: OccupationCategory
  occupation?: string
  yearsExperience?: number
  annualIncomeUSD?: number
  savingsUSD?: number
  remoteWorkEligible?: boolean
  founderStatus?: 'not_founder' | 'aspiring' | 'active_founder'
  languages?: LanguageProficiency[]
  hasSpouse?: boolean
  hasChildren?: boolean
}

export function buildStateFromIntake(answers: IntakeAnswers): MobilityState {
  const s = emptyState()
  if (answers.age != null) s.age = fact(answers.age, 'intake')
  if (answers.nationality) {
    s.nationalities = fact([answers.nationality], 'intake')
    s.currentCountry = fact(answers.currentCountry ?? answers.nationality, 'intake')
    s.currentResidenceStatus = fact('citizen', 'intake')
  }
  if (answers.currentCountry) s.currentCountry = fact(answers.currentCountry, 'intake')
  if (answers.education) {
    s.education = fact(answers.education, 'intake')
    s.degrees = fact([{ level: answers.education, field: '', country: s.currentCountry.value }], 'intake')
  }
  if (answers.occupation) s.occupation = fact(answers.occupation, 'intake')
  if (answers.occupationCategory) s.occupationCategory = fact(answers.occupationCategory, 'intake')
  if (answers.yearsExperience != null) s.yearsExperience = fact(answers.yearsExperience, 'intake')
  if (answers.annualIncomeUSD != null) s.annualIncomeUSD = fact(answers.annualIncomeUSD, 'intake')
  if (answers.savingsUSD != null) {
    s.savingsUSD = fact(answers.savingsUSD, 'intake')
    s.investableCapitalUSD = fact(answers.savingsUSD, 'intake')
  }
  if (answers.remoteWorkEligible != null) s.remoteWorkEligible = fact(answers.remoteWorkEligible, 'intake')
  if (answers.founderStatus) {
    s.founderStatus = fact(answers.founderStatus, 'intake')
    s.businessStage = fact(answers.founderStatus === 'not_founder' ? 'none' : 'idea', 'intake')
  }
  if (answers.languages) s.languages = fact(answers.languages, 'intake')
  if (answers.hasSpouse != null) s.hasSpouse = fact(answers.hasSpouse, 'intake')
  if (answers.hasChildren != null) s.hasChildren = fact(answers.hasChildren, 'intake')
  return s
}
