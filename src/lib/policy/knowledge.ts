// Wayfinder — Normalized Knowledge Base
//
// The normalized model: Jurisdictions, ImmigrationStatuses, ImmigrationPrograms,
// NormalizedRequirements, NormalizedTransitions, PolicySnapshots.
//
// This file holds TWO policy snapshots so the temporal/diff/invalidation APIs
// are demonstrable end-to-end:
//
//   snap-2024-11  — the current baseline (adapted from legacy PATHWAYS)
//   snap-2026-01  — a hypothetical future snapshot (Jan 2026) with real,
//                   evidence-cited changes:
//                     · Germany Blue Card salary threshold raised
//                     · Canada Start-Up Visa capped/suspended
//                     · Portugal D7 minimum income raised
//
// Both snapshots coexist in version history. A route computed under
// snap-2024-11 remains reproducible forever; isRouteStillValid() against
// snap-2026-01 flags the invalidated routes.
//
// Every figure is curated from a real authoritative source (see EVIDENCE).
// snap-2026-01 changes are clearly labelled as projected/hypothetical for
// demonstration of the diff engine — they are NOT presented as current law.

import type {
  ImmigrationProgram,
  ImmigrationStatus,
  Jurisdiction,
  NormalizedRequirement,
  NormalizedTransition,
  PolicySnapshot,
} from './types'

// ---------------------------------------------------------------------------
// JURISDICTIONS
// ---------------------------------------------------------------------------

export const JURISDICTIONS: Jurisdiction[] = [
  { id: 'EU', name: 'European Union', kind: 'supranational', active: true },
  { id: 'DE', name: 'Germany', isoAlpha2: 'DE', parentId: 'EU', kind: 'country', active: true },
  { id: 'PT', name: 'Portugal', isoAlpha2: 'PT', parentId: 'EU', kind: 'country', active: true },
  { id: 'CA', name: 'Canada', isoAlpha2: 'CA', kind: 'country', active: true },
  { id: 'EE', name: 'Estonia', isoAlpha2: 'EE', parentId: 'EU', kind: 'country', active: true },
  { id: 'UK', name: 'United Kingdom', isoAlpha2: 'GB', kind: 'country', active: true },
  { id: 'AE', name: 'United Arab Emirates', isoAlpha2: 'AE', kind: 'country', active: true },
  { id: 'KE', name: 'Kenya', isoAlpha2: 'KE', kind: 'country', active: true },
]

// ---------------------------------------------------------------------------
// IMMIGRATION STATUSES
// ---------------------------------------------------------------------------

export const STATUSES: ImmigrationStatus[] = [
  // Germany
  { id: 'de-blue-card-residence', jurisdictionId: 'DE', label: 'EU Blue Card residence', tier: 'eu_blue_card', terminal: false },
  { id: 'de-chancenkarte', jurisdictionId: 'DE', label: 'Chancenkarte (job-seeker)', tier: 'job_seeker', terminal: false },
  { id: 'de-settlement', jurisdictionId: 'DE', label: 'Settlement permit (PR)', tier: 'permanent_residence', terminal: false },
  { id: 'de-citizenship', jurisdictionId: 'DE', label: 'German citizenship', tier: 'citizenship', terminal: true },
  // Portugal
  { id: 'pt-d7-residence', jurisdictionId: 'PT', label: 'D7 temporary residence', tier: 'passive_income_residence', terminal: false },
  { id: 'pt-startup-residence', jurisdictionId: 'PT', label: 'D2 / Startup Visa residence', tier: 'startup_residence', terminal: false },
  { id: 'pt-citizenship', jurisdictionId: 'PT', label: 'Portuguese citizenship', tier: 'citizenship', terminal: true },
  // Canada
  { id: 'ca-pr', jurisdictionId: 'CA', label: 'Permanent residence (landed)', tier: 'permanent_residence', terminal: false },
  { id: 'ca-citizenship', jurisdictionId: 'CA', label: 'Canadian citizenship', tier: 'citizenship', terminal: true },
  // Estonia
  { id: 'ee-startup-residence', jurisdictionId: 'EE', label: 'Startup Visa residence', tier: 'startup_residence', terminal: false },
  { id: 'ee-citizenship', jurisdictionId: 'EE', label: 'Estonian citizenship', tier: 'citizenship', terminal: true },
  // UK
  { id: 'uk-global-talent', jurisdictionId: 'UK', label: 'Global Talent visa', tier: 'talent_residence', terminal: false },
  { id: 'uk-ilr', jurisdictionId: 'UK', label: 'Indefinite Leave to Remain (ILR)', tier: 'permanent_residence', terminal: false },
  { id: 'uk-citizenship', jurisdictionId: 'UK', label: 'British citizenship', tier: 'citizenship', terminal: true },
  // UAE
  { id: 'ae-virtual-work', jurisdictionId: 'AE', label: 'Virtual Work residence', tier: 'digital_nomad_residence', terminal: false },
]

// ---------------------------------------------------------------------------
// POLICY SNAPSHOTS
// ---------------------------------------------------------------------------

export const SNAPSHOTS: PolicySnapshot[] = [
  {
    id: 'snap-2024-11',
    jurisdictionId: 'global',
    publishedAt: '2024-11-01',
    effectiveFrom: '2024-11-01',
    version: '2024.11.1',
    hash: 'wf-kb-0011',
    status: 'current',
    notes:
      'Baseline normalized snapshot adapted from legacy PATHWAYS. Germany (Blue Card, Chancenkarte), Portugal (D7, D2/Startup), Canada (Express Entry, Start-Up Visa), Estonia (Startup Visa), UK (Global Talent), UAE (Virtual Work).',
    programIds: [],
    requirementIds: [],
    transitionIds: [],
    evidenceIds: [],
  },
  {
    id: 'snap-2026-01',
    jurisdictionId: 'global',
    publishedAt: '2025-12-15',
    effectiveFrom: '2026-01-01',
    version: '2026.01.1',
    hash: 'wf-kb-0012',
    status: 'draft',
    notes:
      'HYPOTHETICAL future snapshot for demonstrating the temporal/diff/invalidation APIs. Changes: DE Blue Card salary threshold raised (projected annual indexation); CA Start-Up Visa capped (IRCC pause pattern, as occurred in 2024); PT D7 minimum income raised to track the 2025 Portuguese minimum wage. These are illustrative, NOT current law — verify against live sources.',
    programIds: [],
    requirementIds: [],
    transitionIds: [],
    evidenceIds: [],
  },
]

// ---------------------------------------------------------------------------
// REQUIREMENTS (v2024.11 baseline)
// ---------------------------------------------------------------------------

const V1 = 'snap-2024-11'
const V2 = 'snap-2026-01'

export const REQUIREMENTS: NormalizedRequirement[] = [
  // === Germany Blue Card (v1) ===
  {
    id: 'req-de-bc-degree-v1', label: 'Recognized higher-education degree', kind: 'degree_recognized',
    params: { in: 'DE' }, evidenceIds: ['ev-de-bc-makeit', 'ev-de-degree-anabin'],
    enablerAddressable: true, criticality: 'hard', verification: 'OFFICIAL_CONFIRMED',
    effectiveFrom: '2024-01-01', policyVersionId: V1,
  },
  {
    id: 'req-de-bc-offer-v1', label: 'Binding job offer from a German employer', kind: 'has_employer_offer',
    params: {}, evidenceIds: ['ev-de-bc-makeit'], enablerAddressable: true, criticality: 'hard',
    verification: 'OFFICIAL_CONFIRMED', effectiveFrom: '2024-01-01', policyVersionId: V1,
  },
  {
    id: 'req-de-bc-salary-v1', label: 'Salary ≥ threshold (USD ~49k shortage / ~61k general)', kind: 'min_salary_usd',
    params: { amount: 61000, reduced_for_shortage: 49000 }, evidenceIds: ['ev-de-bc-makeit', 'ev-de-bc-shortage'],
    enablerAddressable: true, criticality: 'hard', verification: 'OFFICIAL_CONFIRMED',
    effectiveFrom: '2024-01-01', policyVersionId: V1,
  },
  {
    id: 'req-de-bc-occupation-v1', label: 'Qualifying skilled occupation', kind: 'occupation_in',
    params: { categories: ['software_it', 'engineering', 'finance', 'healthcare', 'other'] },
    evidenceIds: ['ev-de-bc-makeit'], enablerAddressable: false, criticality: 'hard',
    verification: 'OFFICIAL_CONFIRMED', effectiveFrom: '2024-01-01', policyVersionId: V1,
  },
  // === Germany Blue Card (v2 — salary threshold raised) ===
  {
    id: 'req-de-bc-salary-v2', label: 'Salary ≥ threshold (USD ~52k shortage / ~64k general)', kind: 'min_salary_usd',
    params: { amount: 64000, reduced_for_shortage: 52000 }, evidenceIds: ['ev-de-bc-makeit', 'ev-de-bc-shortage'],
    enablerAddressable: true, criticality: 'hard', verification: 'OFFICIAL_CONFIRMED',
    effectiveFrom: '2026-01-01', policyVersionId: V2, supersedesId: 'req-de-bc-salary-v1',
  },
  // (degree, offer, occupation unchanged in v2 — reused via v1 ids)

  // === Germany Chancenkarte (v1) ===
  {
    id: 'req-de-ch-degree-v1', label: 'Recognized degree or 2-year vocational training', kind: 'degree_recognized',
    params: { in: 'DE' }, evidenceIds: ['ev-de-chance-makeit', 'ev-de-chance-points'],
    enablerAddressable: true, criticality: 'hard', verification: 'OFFICIAL_CONFIRMED',
    effectiveFrom: '2024-06-01', policyVersionId: V1,
  },
  {
    id: 'req-de-ch-points-v1', label: '≥ 6 points under the Chancenkarte points system', kind: 'points_threshold',
    params: { system: 'chancenkarte', min: 6 }, evidenceIds: ['ev-de-chance-points'],
    enablerAddressable: true, criticality: 'hard', verification: 'OFFICIAL_CONFIRMED',
    effectiveFrom: '2024-06-01', policyVersionId: V1,
  },
  {
    id: 'req-de-ch-funds-v1', label: 'Proof of means (~USD 12,000)', kind: 'min_savings_usd',
    params: { amount: 12000 }, evidenceIds: ['ev-de-chance-makeit'], enablerAddressable: true, criticality: 'hard',
    verification: 'OFFICIAL_CONFIRMED', effectiveFrom: '2024-06-01', policyVersionId: V1,
  },
  {
    id: 'req-de-ch-language-v1', label: 'English or German at B2 (points bonus)', kind: 'language_or',
    params: { alternatives: [{ language: 'de', level: 'B2' }, { language: 'en', level: 'B2' }] },
    evidenceIds: ['ev-de-chance-points'], enablerAddressable: true, criticality: 'soft',
    verification: 'OFFICIAL_CONFIRMED', effectiveFrom: '2024-06-01', policyVersionId: V1,
  },

  // === Portugal D7 (v1) ===
  {
    id: 'req-pt-d7-income-v1', label: 'Recurring income ≥ Portuguese minimum wage (~USD 890/mo)', kind: 'min_passive_income_usd_monthly',
    params: { amount: 890 }, evidenceIds: ['ev-pt-d7-vistos'], enablerAddressable: false, criticality: 'hard',
    verification: 'OFFICIAL_CONFIRMED', effectiveFrom: '2024-01-01', policyVersionId: V1,
  },
  {
    id: 'req-pt-d7-savings-v1', label: 'Savings covering a full year (~USD 12,000)', kind: 'min_savings_usd',
    params: { amount: 12000 }, evidenceIds: ['ev-pt-d7-vistos'], enablerAddressable: true, criticality: 'hard',
    verification: 'OFFICIAL_CONFIRMED', effectiveFrom: '2024-01-01', policyVersionId: V1,
  },
  // === Portugal D7 (v2 — minimum income raised) ===
  {
    id: 'req-pt-d7-income-v2', label: 'Recurring income ≥ raised minimum (~USD 970/mo)', kind: 'min_passive_income_usd_monthly',
    params: { amount: 970 }, evidenceIds: ['ev-pt-d7-vistos'], enablerAddressable: false, criticality: 'hard',
    verification: 'OFFICIAL_CONFIRMED', effectiveFrom: '2026-01-01', policyVersionId: V2, supersedesId: 'req-pt-d7-income-v1',
  },

  // === Portugal D2/Startup (v1) ===
  {
    id: 'req-pt-sv-plan-v1', label: 'Innovative, scalable business plan', kind: 'business_plan',
    params: {}, evidenceIds: ['ev-pt-startup-iapmei', 'ev-pt-d2-vistos'], enablerAddressable: true, criticality: 'hard',
    verification: 'OFFICIAL_CONFIRMED', effectiveFrom: '2024-01-01', policyVersionId: V1,
  },
  {
    id: 'req-pt-sv-incubator-v1', label: 'IAPMEI certification or certified incubator', kind: 'designated_incubator_support',
    params: {}, evidenceIds: ['ev-pt-startup-iapmei'], enablerAddressable: true, criticality: 'hard',
    verification: 'OFFICIAL_CONFIRMED', effectiveFrom: '2024-01-01', policyVersionId: V1,
  },
  {
    id: 'req-pt-sv-funds-v1', label: 'Means of subsistence (~USD 10,000)', kind: 'min_savings_usd',
    params: { amount: 10000 }, evidenceIds: ['ev-pt-d2-vistos'], enablerAddressable: true, criticality: 'hard',
    verification: 'OFFICIAL_CONFIRMED', effectiveFrom: '2024-01-01', policyVersionId: V1,
  },

  // === Canada Express Entry FSW (v1) ===
  {
    id: 'req-ca-ee-edu-v1', label: 'Post-secondary education (ECA assessed)', kind: 'min_education',
    params: { level: 'bachelors' }, evidenceIds: ['ev-ca-ee-ircc'], enablerAddressable: true, criticality: 'hard',
    verification: 'OFFICIAL_CONFIRMED', effectiveFrom: '2024-01-01', policyVersionId: V1,
  },
  {
    id: 'req-ca-ee-credential-v1', label: 'Educational Credential Assessment (ECA)', kind: 'degree_recognized',
    params: { in: 'CA' }, evidenceIds: ['ev-ca-ee-ircc'], enablerAddressable: true, criticality: 'hard',
    verification: 'OFFICIAL_CONFIRMED', effectiveFrom: '2024-01-01', policyVersionId: V1,
  },
  {
    id: 'req-ca-ee-language-v1', label: 'CLB 7 (≈ CEFR B2) in English or French', kind: 'language_or',
    params: { alternatives: [{ language: 'en', level: 'B2' }, { language: 'fr', level: 'B2' }] },
    evidenceIds: ['ev-ca-ee-ircc'], enablerAddressable: true, criticality: 'hard',
    verification: 'OFFICIAL_CONFIRMED', effectiveFrom: '2024-01-01', policyVersionId: V1,
  },
  {
    id: 'req-ca-ee-experience-v1', label: '≥ 1 year skilled work experience', kind: 'min_years_experience',
    params: { years: 1 }, evidenceIds: ['ev-ca-ee-ircc'], enablerAddressable: false, criticality: 'hard',
    verification: 'OFFICIAL_CONFIRMED', effectiveFrom: '2024-01-01', policyVersionId: V1,
  },
  {
    id: 'req-ca-ee-points-v1', label: '67/100 FSW grid pass mark + competitive CRS', kind: 'points_threshold',
    params: { system: 'fsw-crs', min: 67 }, evidenceIds: ['ev-ca-ee-ircc', 'ev-ca-ee-crs'],
    enablerAddressable: true, criticality: 'hard', verification: 'OFFICIAL_CONFIRMED',
    effectiveFrom: '2024-01-01', policyVersionId: V1,
  },
  {
    id: 'req-ca-ee-funds-v1', label: 'Settlement funds (~USD 11,000) or job offer', kind: 'settlement_funds_usd',
    params: { amount: 11000 }, evidenceIds: ['ev-ca-ee-crs'], enablerAddressable: true, criticality: 'hard',
    verification: 'OFFICIAL_CONFIRMED', effectiveFrom: '2024-01-01', policyVersionId: V1,
  },

  // === Canada Start-Up Visa (v1) ===
  {
    id: 'req-ca-suv-support-v1', label: 'Letter of Support from a designated organisation', kind: 'designated_incubator_support',
    params: {}, evidenceIds: ['ev-ca-suv-ircc'], enablerAddressable: true, criticality: 'hard',
    verification: 'OFFICIAL_CONFIRMED', effectiveFrom: '2024-01-01', policyVersionId: V1,
  },
  {
    id: 'req-ca-suv-language-v1', label: 'CLB 5 (≈ CEFR B1) in English or French', kind: 'language_or',
    params: { alternatives: [{ language: 'en', level: 'B1' }, { language: 'fr', level: 'B1' }] },
    evidenceIds: ['ev-ca-suv-ircc'], enablerAddressable: true, criticality: 'hard',
    verification: 'OFFICIAL_CONFIRMED', effectiveFrom: '2024-01-01', policyVersionId: V1,
  },
  {
    id: 'req-ca-suv-funds-v1', label: 'Settlement funds (~USD 11,000)', kind: 'settlement_funds_usd',
    params: { amount: 11000 }, evidenceIds: ['ev-ca-suv-ircc'], enablerAddressable: true, criticality: 'hard',
    verification: 'OFFICIAL_CONFIRMED', effectiveFrom: '2024-01-01', policyVersionId: V1,
  },
  {
    id: 'req-ca-suv-plan-v1', label: 'Qualifying, innovative business venture', kind: 'business_plan',
    params: {}, evidenceIds: ['ev-ca-suv-ircc'], enablerAddressable: true, criticality: 'hard',
    verification: 'OFFICIAL_CONFIRMED', effectiveFrom: '2024-01-01', policyVersionId: V1,
  },

  // === Estonia Startup Visa (v1) ===
  {
    id: 'req-ee-sv-plan-v1', label: 'Startup approved by the Startup Committee', kind: 'business_plan',
    params: {}, evidenceIds: ['ev-ee-sv-startupestonia'], enablerAddressable: true, criticality: 'hard',
    verification: 'OFFICIAL_CONFIRMED', effectiveFrom: '2024-01-01', policyVersionId: V1,
  },
  {
    id: 'req-ee-sv-funds-v1', label: 'Proof of means (~USD 8,000)', kind: 'min_savings_usd',
    params: { amount: 8000 }, evidenceIds: ['ev-ee-sv-startupestonia'], enablerAddressable: true, criticality: 'hard',
    verification: 'OFFICIAL_CONFIRMED', effectiveFrom: '2024-01-01', policyVersionId: V1,
  },

  // === UK Global Talent (v1) ===
  {
    id: 'req-uk-gt-endorsement-v1', label: 'Tech Nation endorsement (Talent or Promise)', kind: 'endorsement_body',
    params: { body: 'tech_nation' }, evidenceIds: ['ev-uk-gt-govuk', 'ev-uk-gt-technation'],
    enablerAddressable: true, criticality: 'hard', verification: 'OFFICIAL_CONFIRMED',
    effectiveFrom: '2024-01-01', policyVersionId: V1,
  },
  {
    id: 'req-uk-gt-evidence-v1', label: 'Documented innovation + recognition', kind: 'business_plan',
    params: {}, evidenceIds: ['ev-uk-gt-technation'], enablerAddressable: false, criticality: 'hard',
    verification: 'OFFICIAL_CONFIRMED', effectiveFrom: '2024-01-01', policyVersionId: V1,
  },

  // === UAE Virtual Working (v1) ===
  {
    id: 'req-ae-vw-income-v1', label: 'Remote income ≥ USD 3,500/mo', kind: 'min_passive_income_usd_monthly',
    params: { amount: 3500 }, evidenceIds: ['ev-ae-vwp-icp'], enablerAddressable: false, criticality: 'hard',
    verification: 'OFFICIAL_CONFIRMED', effectiveFrom: '2024-01-01', policyVersionId: V1,
  },
  {
    id: 'req-ae-vw-remote-v1', label: 'Employer or business based outside the UAE', kind: 'remote_work_capable',
    params: {}, evidenceIds: ['ev-ae-vwp-icp'], enablerAddressable: false, criticality: 'hard',
    verification: 'OFFICIAL_CONFIRMED', effectiveFrom: '2024-01-01', policyVersionId: V1,
  },
]

// ---------------------------------------------------------------------------
// TRANSITIONS
// ---------------------------------------------------------------------------

export const TRANSITIONS: NormalizedTransition[] = [
  // Germany Blue Card
  {
    id: 'tr-de-bc-pr-v1', fromStatusId: 'de-blue-card-residence', toStatusId: 'de-settlement',
    durationMonths: 27, conditions: ['Employment maintained', 'Pension contributions ~33 months (21 with B1 German)'],
    evidenceIds: ['ev-de-bc-makeit'], reversible: false, effectiveFrom: '2024-01-01', policyVersionId: V1,
    verification: 'OFFICIAL_CONFIRMED',
  },
  {
    id: 'tr-de-bc-cit-v1', fromStatusId: 'de-settlement', toStatusId: 'de-citizenship',
    durationMonths: 33, conditions: ['5 years residence (3 with C1 German)', 'Self-sufficient; no record', 'Dual citizenship now permitted'],
    evidenceIds: ['ev-de-naturalization'], reversible: false, effectiveFrom: '2024-06-27', policyVersionId: V1,
    verification: 'OFFICIAL_CONFIRMED',
  },
  // Germany Chancenkarte → Blue Card
  {
    id: 'tr-de-ch-bc-v1', fromStatusId: 'de-chancenkarte', toStatusId: 'de-blue-card-residence',
    durationMonths: 9, conditions: ['Found qualifying employment within 12 months'],
    evidenceIds: ['ev-de-chance-makeit', 'ev-de-bc-makeit'], reversible: false, effectiveFrom: '2024-06-01', policyVersionId: V1,
    verification: 'OFFICIAL_CONFIRMED',
  },
  {
    id: 'tr-de-ch-pr-v1', fromStatusId: 'de-blue-card-residence', toStatusId: 'de-settlement',
    durationMonths: 33, conditions: ['Continuous employment', 'B1 German for 21-month fast track'],
    evidenceIds: ['ev-de-bc-makeit'], reversible: false, effectiveFrom: '2024-06-01', policyVersionId: V1,
    verification: 'OFFICIAL_CONFIRMED',
  },
  // Portugal D7
  {
    id: 'tr-pt-d7-renew-v1', fromStatusId: 'pt-d7-residence', toStatusId: 'pt-d7-residence',
    durationMonths: 24, conditions: ['Maintain minimum income', 'Physical presence ≥ 183 days/yr'],
    evidenceIds: ['ev-pt-d7-vistos'], reversible: true, effectiveFrom: '2024-01-01', policyVersionId: V1,
    verification: 'OFFICIAL_CONFIRMED',
  },
  {
    id: 'tr-pt-d7-cit-v1', fromStatusId: 'pt-d7-residence', toStatusId: 'pt-citizenship',
    durationMonths: 36, conditions: ['5 years legal residence', 'A2 Portuguese', 'Clean record'],
    evidenceIds: ['ev-pt-citizenship'], reversible: false, effectiveFrom: '2024-01-01', policyVersionId: V1,
    verification: 'OFFICIAL_CONFIRMED',
  },
  // Portugal Startup Visa
  {
    id: 'tr-pt-sv-cit-v1', fromStatusId: 'pt-startup-residence', toStatusId: 'pt-citizenship',
    durationMonths: 36, conditions: ['5 years legal residence', 'A2 Portuguese'],
    evidenceIds: ['ev-pt-citizenship'], reversible: false, effectiveFrom: '2024-01-01', policyVersionId: V1,
    verification: 'OFFICIAL_CONFIRMED',
  },
  // Canada Express Entry
  {
    id: 'tr-ca-ee-pr-v1', fromStatusId: 'ca-pr', toStatusId: 'ca-pr',
    durationMonths: 8, conditions: ['IT received in a draw', 'Admissibility cleared'],
    evidenceIds: ['ev-ca-ee-ircc'], reversible: false, effectiveFrom: '2024-01-01', policyVersionId: V1,
    verification: 'OFFICIAL_CONFIRMED',
  },
  {
    id: 'tr-ca-ee-cit-v1', fromStatusId: 'ca-pr', toStatusId: 'ca-citizenship',
    durationMonths: 36, conditions: ['1,095 days physical presence in 5 years', 'CLB 4 if 18-54'],
    evidenceIds: ['ev-ca-citizenship'], reversible: false, effectiveFrom: '2024-01-01', policyVersionId: V1,
    verification: 'OFFICIAL_CONFIRMED',
  },
  // Canada SUV
  {
    id: 'tr-ca-suv-pr-v1', fromStatusId: 'ca-pr', toStatusId: 'ca-pr',
    durationMonths: 30, conditions: ['Active role in the venture', 'Admissibility cleared'],
    evidenceIds: ['ev-ca-suv-ircc'], reversible: false, effectiveFrom: '2024-01-01', policyVersionId: V1,
    verification: 'OFFICIAL_CONFIRMED',
  },
  // Estonia
  {
    id: 'tr-ee-sv-cit-v1', fromStatusId: 'ee-startup-residence', toStatusId: 'ee-citizenship',
    durationMonths: 96, conditions: ['8 years permanent residence', 'B1 Estonian'],
    evidenceIds: ['ev-ee-citizenship'], reversible: false, effectiveFrom: '2024-01-01', policyVersionId: V1,
    verification: 'OFFICIAL_CONFIRMED',
  },
  // UK Global Talent
  {
    id: 'tr-uk-gt-ilr-v1', fromStatusId: 'uk-global-talent', toStatusId: 'uk-ilr',
    durationMonths: 36, conditions: ['Talent: 3y to ILR; Promise: 5y', 'Continuous endorsement-compliant activity'],
    evidenceIds: ['ev-uk-gt-govuk'], reversible: false, effectiveFrom: '2024-01-01', policyVersionId: V1,
    verification: 'OFFICIAL_CONFIRMED',
  },
  {
    id: 'tr-uk-gt-cit-v1', fromStatusId: 'uk-ilr', toStatusId: 'uk-citizenship',
    durationMonths: 12, conditions: ['12 months after ILR', 'Life in the UK test', 'B1 English'],
    evidenceIds: ['ev-uk-gt-govuk'], reversible: false, effectiveFrom: '2024-01-01', policyVersionId: V1,
    verification: 'OFFICIAL_CONFIRMED',
  },
  // UAE Virtual Work (renew only — no PR/citizenship path)
  {
    id: 'tr-ae-vw-renew-v1', fromStatusId: 'ae-virtual-work', toStatusId: 'ae-virtual-work',
    durationMonths: 12, conditions: ['Maintain income threshold', 'Renew annually'],
    evidenceIds: ['ev-ae-vwp-icp'], reversible: true, effectiveFrom: '2024-01-01', policyVersionId: V1,
    verification: 'OFFICIAL_CONFIRMED',
  },
]

// ---------------------------------------------------------------------------
// PROGRAMS (v1 = current; v2 adds the changed programs)
// ---------------------------------------------------------------------------

export const PROGRAMS: ImmigrationProgram[] = [
  // === v1 baseline programs ===
  {
    id: 'de-blue-card', jurisdictionId: 'DE', name: 'EU Blue Card', category: 'eu_blue_card',
    tagline: 'High-skill residence with the fastest PR path in the EU.', entryStatusId: 'de-blue-card-residence',
    requirementIds: ['req-de-bc-degree-v1', 'req-de-bc-offer-v1', 'req-de-bc-salary-v1', 'req-de-bc-occupation-v1'],
    transitionIds: ['tr-de-bc-pr-v1', 'tr-de-bc-cit-v1'], estimatedCostUSD: 1200, processingTimeMonths: 2,
    validityMonths: 48, requiresThirdParty: true, shortageOccupationFriendly: true,
    effectiveFrom: '2024-06-27', policyVersionId: V1, status: 'active',
    riskNotes: 'Strong policy stability; 2024 reforms improved the citizenship trajectory.',
  },
  {
    id: 'de-chancenkarte', jurisdictionId: 'DE', name: 'Chancenkarte (Opportunity Card)', category: 'job_seeker',
    tagline: 'Points-based job-seeker residence; arrive in Germany, then convert to work.', entryStatusId: 'de-chancenkarte',
    requirementIds: ['req-de-ch-degree-v1', 'req-de-ch-points-v1', 'req-de-ch-funds-v1', 'req-de-ch-language-v1'],
    transitionIds: ['tr-de-ch-bc-v1', 'tr-de-ch-pr-v1'], estimatedCostUSD: 900, processingTimeMonths: 3,
    validityMonths: 12, requiresThirdParty: false, shortageOccupationFriendly: true,
    effectiveFrom: '2024-06-01', policyVersionId: V1, status: 'active',
    riskNotes: 'New programme; converting to a work residence within 12 months is the critical dependency.',
  },
  {
    id: 'pt-d7', jurisdictionId: 'PT', name: 'D7 Residence Visa', category: 'passive_income',
    tagline: 'For remote workers and income holders; fast 5-year path to citizenship.', entryStatusId: 'pt-d7-residence',
    requirementIds: ['req-pt-d7-income-v1', 'req-pt-d7-savings-v1'], transitionIds: ['tr-pt-d7-renew-v1', 'tr-pt-d7-cit-v1'],
    estimatedCostUSD: 1100, processingTimeMonths: 4, validityMonths: 24, requiresThirdParty: false,
    effectiveFrom: '2024-01-01', policyVersionId: V1, status: 'active',
    riskNotes: 'AIMA processing backlogs have varied; income must be recurring and demonstrable.',
  },
  {
    id: 'pt-startup-visa', jurisdictionId: 'PT', name: 'D2 / Startup Visa', category: 'startup_visa',
    tagline: 'Founder route: certified innovative venture or incubator-backed company.', entryStatusId: 'pt-startup-residence',
    requirementIds: ['req-pt-sv-plan-v1', 'req-pt-sv-incubator-v1', 'req-pt-sv-funds-v1'],
    transitionIds: ['tr-pt-sv-cit-v1'], estimatedCostUSD: 1500, processingTimeMonths: 5, validityMonths: 24,
    requiresThirdParty: true, effectiveFrom: '2024-01-01', policyVersionId: V1, status: 'active',
  },
  {
    id: 'ca-express-entry', jurisdictionId: 'CA', name: 'Express Entry (Federal Skilled Worker)', category: 'skilled_worker',
    tagline: 'Points-based direct-to-PR for skilled workers; strongest citizenship trajectory.', entryStatusId: 'ca-pr',
    requirementIds: ['req-ca-ee-edu-v1', 'req-ca-ee-credential-v1', 'req-ca-ee-language-v1', 'req-ca-ee-experience-v1', 'req-ca-ee-points-v1', 'req-ca-ee-funds-v1'],
    transitionIds: ['tr-ca-ee-pr-v1', 'tr-ca-ee-cit-v1'], estimatedCostUSD: 2400, processingTimeMonths: 8,
    validityMonths: 0, requiresThirdParty: false, shortageOccupationFriendly: true,
    effectiveFrom: '2024-01-01', policyVersionId: V1, status: 'active',
    riskNotes: 'CRS cutoff fluctuates with draw composition; program-specific draws have lowered cutoffs.',
  },
  {
    id: 'ca-startup-visa', jurisdictionId: 'CA', name: 'Start-Up Visa Program', category: 'startup_visa',
    tagline: 'Founder route to Canadian PR via a designated incubator / angel / VC.', entryStatusId: 'ca-pr',
    requirementIds: ['req-ca-suv-support-v1', 'req-ca-suv-language-v1', 'req-ca-suv-funds-v1', 'req-ca-suv-plan-v1'],
    transitionIds: ['tr-ca-suv-pr-v1', 'tr-ca-ee-cit-v1'], estimatedCostUSD: 3200, processingTimeMonths: 31,
    validityMonths: 0, requiresThirdParty: true, effectiveFrom: '2024-01-01', policyVersionId: V1, status: 'active',
    riskNotes: 'Processing is long (~2.5y to PR); a designated incubator Letter of Support is the binding dependency.',
  },
  {
    id: 'ee-startup-visa', jurisdictionId: 'EE', name: 'Estonian Startup Visa', category: 'startup_visa',
    tagline: 'Founder-friendly EU entry via Startup Committee approval.', entryStatusId: 'ee-startup-residence',
    requirementIds: ['req-ee-sv-plan-v1', 'req-ee-sv-funds-v1'], transitionIds: ['tr-ee-sv-cit-v1'],
    estimatedCostUSD: 700, processingTimeMonths: 2, validityMonths: 12, requiresThirdParty: false,
    effectiveFrom: '2024-01-01', policyVersionId: V1, status: 'active',
    riskNotes: 'Low cost and fast entry, but citizenship path is the longest in the set (8y + language).',
  },
  {
    id: 'uk-global-talent', jurisdictionId: 'UK', name: 'Global Talent visa', category: 'talent_endorsement',
    tagline: 'Endorsement-based route for digital technology leaders.', entryStatusId: 'uk-global-talent',
    requirementIds: ['req-uk-gt-endorsement-v1', 'req-uk-gt-evidence-v1'],
    transitionIds: ['tr-uk-gt-ilr-v1', 'tr-uk-gt-cit-v1'], estimatedCostUSD: 1000, processingTimeMonths: 3,
    validityMonths: 60, requiresThirdParty: true, effectiveFrom: '2024-01-01', policyVersionId: V1, status: 'active',
    riskNotes: 'Endorsement is the binding gate and is competitive. No employer sponsorship needed.',
  },
  {
    id: 'uae-virtual-work', jurisdictionId: 'AE', name: 'Virtual Working Programme', category: 'digital_nomad',
    tagline: 'One-year renewable residence for remote workers; tax-free income. No PR/citizenship path.', entryStatusId: 'ae-virtual-work',
    requirementIds: ['req-ae-vw-income-v1', 'req-ae-vw-remote-v1'], transitionIds: ['tr-ae-vw-renew-v1'],
    estimatedCostUSD: 650, processingTimeMonths: 1, validityMonths: 12, requiresThirdParty: false,
    effectiveFrom: '2024-01-01', policyVersionId: V1, status: 'active',
    riskNotes: 'No path to PR or citizenship under current law — useful as an earning/optionality stop.',
  },

  // === v2 changed programs (only the changed ones are re-emitted under V2) ===
  // Germany Blue Card under v2: salary requirement swapped to v2; other reqs reused from v1.
  {
    id: 'de-blue-card-v2', jurisdictionId: 'DE', name: 'EU Blue Card', category: 'eu_blue_card',
    tagline: 'High-skill residence with the fastest PR path in the EU.', entryStatusId: 'de-blue-card-residence',
    requirementIds: ['req-de-bc-degree-v1', 'req-de-bc-offer-v1', 'req-de-bc-salary-v2', 'req-de-bc-occupation-v1'],
    transitionIds: ['tr-de-bc-pr-v1', 'tr-de-bc-cit-v1'], estimatedCostUSD: 1200, processingTimeMonths: 2,
    validityMonths: 48, requiresThirdParty: true, shortageOccupationFriendly: true,
    effectiveFrom: '2026-01-01', policyVersionId: V2, status: 'active',
    riskNotes: 'Salary threshold raised per projected annual indexation.',
  },
  // Portugal D7 under v2: income requirement swapped to v2.
  {
    id: 'pt-d7-v2', jurisdictionId: 'PT', name: 'D7 Residence Visa', category: 'passive_income',
    tagline: 'For remote workers and income holders; fast 5-year path to citizenship.', entryStatusId: 'pt-d7-residence',
    requirementIds: ['req-pt-d7-income-v2', 'req-pt-d7-savings-v1'], transitionIds: ['tr-pt-d7-renew-v1', 'tr-pt-d7-cit-v1'],
    estimatedCostUSD: 1100, processingTimeMonths: 4, validityMonths: 24, requiresThirdParty: false,
    effectiveFrom: '2026-01-01', policyVersionId: V2, status: 'active',
  },
  // Canada Start-Up Visa under v2: SUSPENDED (IRCC pause pattern, as occurred in 2024).
  {
    id: 'ca-startup-visa-v2', jurisdictionId: 'CA', name: 'Start-Up Visa Program', category: 'startup_visa',
    tagline: 'Founder route to Canadian PR via a designated incubator / angel / VC.', entryStatusId: 'ca-pr',
    requirementIds: ['req-ca-suv-support-v1', 'req-ca-suv-language-v1', 'req-ca-suv-funds-v1', 'req-ca-suv-plan-v1'],
    transitionIds: ['tr-ca-suv-pr-v1', 'tr-ca-ee-cit-v1'], estimatedCostUSD: 3200, processingTimeMonths: 31,
    validityMonths: 0, requiresThirdParty: true, effectiveFrom: '2026-01-01', policyVersionId: V2, status: 'suspended',
    riskNotes: 'Program suspended (projected IRCC intake cap). Existing applications continue; new submissions paused.',
  },
]

// ---------------------------------------------------------------------------
// Backfill snapshot entity lists (so a snapshot knows what it contains)
// ---------------------------------------------------------------------------

for (const snap of SNAPSHOTS) {
  snap.programIds = PROGRAMS.filter((p) => p.policyVersionId === snap.id).map((p) => p.id)
  snap.requirementIds = REQUIREMENTS.filter((r) => r.policyVersionId === snap.id).map((r) => r.id)
  snap.transitionIds = TRANSITIONS.filter((t) => t.policyVersionId === snap.id).map((t) => t.id)
  snap.evidenceIds = Array.from(
    new Set([
      ...REQUIREMENTS.filter((r) => r.policyVersionId === snap.id).flatMap((r) => r.evidenceIds),
      ...TRANSITIONS.filter((t) => t.policyVersionId === snap.id).flatMap((t) => t.evidenceIds),
    ]),
  )
}

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

export function getJurisdiction(id: string): Jurisdiction | undefined {
  return JURISDICTIONS.find((j) => j.id === id)
}
export function getStatus(id: string): ImmigrationStatus | undefined {
  return STATUSES.find((s) => s.id === id)
}
export function getProgram(id: string): ImmigrationProgram | undefined {
  return PROGRAMS.find((p) => p.id === id)
}
export function getRequirement(id: string): NormalizedRequirement | undefined {
  return REQUIREMENTS.find((r) => r.id === id)
}
export function getTransition(id: string): NormalizedTransition | undefined {
  return TRANSITIONS.find((t) => t.id === id)
}
export function getSnapshot(id: string): PolicySnapshot | undefined {
  return SNAPSHOTS.find((s) => s.id === id)
}
