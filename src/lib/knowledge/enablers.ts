// Wayfinder Knowledge Base — Enablers
//
// Enablers are legitimate third parties who can satisfy a missing dependency
// in a legal route (employer, university, incubator, endorsement body, etc.).
// Per the safety rule, we ONLY model REQUIRED, LEGALLY VALID, or SUPPORTIVE
// relationships. We never model sham employment, fake marriages, nominee
// arrangements, or any relationship whose sole purpose is to circumvent law.

import type { Enabler } from '@/lib/domain/types'

export const ENABLERS: Enabler[] = [
  {
    id: 'en-employer-de-tech',
    name: 'German tech employers (Blue Card sponsors)',
    kind: 'employer',
    countryCode: 'DE',
    satisfies: ['employer_offer', 'sponsor'],
    description:
      'German employers hiring non-EU skilled workers can sponsor an EU Blue Card or skilled-worker residence. IT, engineering, and data roles are commonly on the shortage list, lowering the salary threshold.',
    enablerGets: 'A qualified skilled worker填补 a documented shortage; faster hiring than domestic-only sourcing.',
    preconditions: [
      'User must have a recognized degree or equivalent qualification',
      'Standard recruitment interview and job fit assessment',
      'Employment contract meeting the threshold salary',
    ],
    legitimacy: 'required',
    evidenceIds: ['ev-de-bc-makeit'],
  },
  {
    id: 'en-incubator-ca-designated',
    name: 'IRCC designated business incubators (Canada Start-Up Visa)',
    kind: 'incubator',
    countryCode: 'CA',
    satisfies: ['designated_incubator_support', 'business_formation'],
    description:
      'A designated Canadian business incubator can issue a Letter of Support for the Start-Up Visa, provided the founding team and venture pass the incubator\'s own admissions process. This is the legally required enabler for the SUV route.',
    enablerGets: 'A promising venture joins its cohort; the incubator may take standard program equity per its published terms.',
    preconditions: [
      'Founding team presents a qualifying, innovative business idea',
      'Admission to the incubator program (competitive)',
      'Letter of Support issued only after acceptance',
    ],
    legitimacy: 'required',
    evidenceIds: ['ev-ca-suv-ircc'],
  },
  {
    id: 'en-incubator-pt-iapmei',
    name: 'IAPMEI-certified incubators (Portugal Startup Visa)',
    kind: 'incubator',
    countryCode: 'PT',
    satisfies: ['designated_incubator_support', 'business_formation'],
    description:
      'IAPMEI certifies Portuguese incubators that host foreign founders under the Startup Visa. Founders may either incorporate independently and seek IAPMEI project certification, or join a certified incubator.',
    enablerGets: 'A vetted international founder joins the incubator; standard incubation terms apply.',
    preconditions: ['Innovative, scalable business project', 'Incubator admissions process'],
    legitimacy: 'required',
    evidenceIds: ['ev-pt-startup-iapmei'],
  },
  {
    id: 'en-endorsement-uk-technation',
    name: 'Tech Nation endorsement (UK Global Talent)',
    kind: 'endorsement_body',
    countryCode: 'UK',
    satisfies: ['endorsement'],
    description:
      'Tech Nation is the Home Office endorsing body for the digital technology pathway of the Global Talent visa. Endorsement requires evidence of innovation and impact in digital technology.',
    enablerGets: 'Endorsement of genuinely exceptional talent strengthens the UK digital ecosystem; Tech Nation does not employ the applicant.',
    preconditions: [
      'Documented evidence of innovation as a founder or senior contributor',
      'Evidence of recognition beyond the applicant\'s own company',
      'Mandatory + optional criteria both satisfied',
    ],
    legitimacy: 'required',
    evidenceIds: ['ev-uk-gt-technation', 'ev-uk-gt-govuk'],
  },
  {
    id: 'en-credential-zab',
    name: 'ZAB / Anabin credential recognition (Germany)',
    kind: 'credential_evaluator',
    countryCode: 'DE',
    satisfies: ['credential_recognition', 'documentation'],
    description:
      'The ZAB (Central Office for Foreign Education) provides individual statements of comparability; the Anabin database lists degree-level recognition. A recognized degree is required for the Blue Card and Chancenkarte.',
    enablerGets: 'Standard statutory fee for the assessment service.',
    preconditions: ['Original degree certificate and transcript', 'Translation if not in German/English'],
    legitimacy: 'required',
    evidenceIds: ['ev-de-degree-anabin'],
  },
  {
    id: 'en-language-goethe',
    name: 'Goethe-Institut / language certification providers',
    kind: 'language_provider',
    countryCode: 'DE',
    satisfies: ['language_cert'],
    description:
      'Goethe-Institut (and equivalents like telc, ÖSD) issue the German language certificates (A1–C2) that satisfy Blue Card fast-track PR, Chancenkarte points, and naturalization requirements.',
    enablerGets: 'Standard course and examination fees.',
    preconditions: ['Enrollment in a course or registration for an exam at an accredited center'],
    legitimacy: 'legally_valid',
  },
  {
    id: 'en-language-capa',
    name: 'CAPLE / Cervantes language certification (PT)',
    kind: 'language_provider',
    countryCode: 'PT',
    satisfies: ['language_cert'],
    description:
      'CAPLE issues the CIPLE (A2) Portuguese certificate that satisfies the Portuguese citizenship language requirement.',
    enablerGets: 'Examination fees.',
    preconditions: ['Registration for the CIPLE examination at a recognized center'],
    legitimacy: 'legally_valid',
    evidenceIds: ['ev-pt-citizenship'],
  },
  {
    id: 'en-credential-wes',
    name: 'WES / IQAS Educational Credential Assessment (Canada)',
    kind: 'credential_evaluator',
    countryCode: 'CA',
    satisfies: ['credential_recognition', 'documentation'],
    description:
      'A designated ECA provider (e.g. WES, IQAS) evaluates foreign degrees against Canadian standards. Required for Express Entry and points under the CRS.',
    enablerGets: 'Standard assessment fee.',
    preconditions: ['Original degree documents', 'Direct verification from the issuing institution'],
    legitimacy: 'required',
    evidenceIds: ['ev-ca-ee-ircc'],
  },
  {
    id: 'en-employer-ca-tech',
    name: 'Canadian tech employers (LMIA-exempt & arranged employment)',
    kind: 'employer',
    countryCode: 'CA',
    satisfies: ['employer_offer'],
    description:
      'A Canadian employer offer can add 50–200 CRS points (arranged employment) or provide an LMIA-supported pathway. Tech roles commonly qualify for facilitated processing.',
    enablerGets: 'A skilled worker to fill a vacant role.',
    preconditions: ['Standard hiring process', 'Offer meeting provincial wage requirements'],
    legitimacy: 'legally_valid',
    evidenceIds: ['ev-ca-ee-crs'],
  },
  {
    id: 'en-law-general',
    name: 'Regulated immigration counsel (escalation layer)',
    kind: 'law_firm',
    countryCode: 'multiple',
    satisfies: ['documentation'],
    description:
      'For high-stakes or ambiguous cases Wayfinder escalates to a regulated immigration lawyer/specialist who can validate, annotate, and add evidence. This is the expert-in-the-loop layer — not a substitute for the deterministic engine.',
    enablerGets: 'Professional fee for legal advice and case management.',
    preconditions: ['User consents to share the structured case brief', 'Engagement letter'],
    legitimacy: 'supportive',
    evidenceIds: ['ev-system-disclaimer'],
  },
]

export function getEnabler(id: string): Enabler | undefined {
  return ENABLERS.find((e) => e.id === id)
}

export function getEnablersForAddressal(
  kind: Enabler['satisfies'][number],
  countryCode?: string,
): Enabler[] {
  return ENABLERS.filter(
    (e) =>
      e.satisfies.includes(kind) &&
      (e.countryCode === 'multiple' || !countryCode || e.countryCode === countryCode),
  )
}
