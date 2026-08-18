// Wayfinder Knowledge Base — Countries

import type { Country } from '@/lib/domain/types'

export const COUNTRIES: Country[] = [
  {
    code: 'KE',
    name: 'Kenya',
    region: 'Africa',
    passportMobilityScore: 42,
    dualCitizenship: 'permitted',
    currency: 'KES',
    notes: 'Dual citizenship permitted since 2010 constitution. Common origin for skilled-worker mobility.',
  },
  {
    code: 'DE',
    name: 'Germany',
    region: 'EU',
    passportMobilityScore: 94,
    dualCitizenship: 'permitted',
    currency: 'EUR',
    notes: '2024 citizenship reform shortened naturalization to 5/3 years and broadly permits dual citizenship. Strong Blue Card + Chancenkarte routes.',
  },
  {
    code: 'PT',
    name: 'Portugal',
    region: 'EU',
    passportMobilityScore: 91,
    dualCitizenship: 'permitted',
    currency: 'EUR',
    notes: '5-year residence-to-citizenship path; attractive for remote workers (D7) and founders (D2/Startup Visa).',
  },
  {
    code: 'CA',
    name: 'Canada',
    region: 'North America',
    passportMobilityScore: 93,
    dualCitizenship: 'permitted',
    currency: 'CAD',
    notes: 'Express Entry grants PR directly; Start-Up Visa offers PR for entrepreneurs via designated incubators.',
  },
  {
    code: 'EE',
    name: 'Estonia',
    region: 'EU',
    passportMobilityScore: 92,
    dualCitizenship: 'restricted',
    currency: 'EUR',
    notes: 'Digital-first administration; Startup Visa path for founders. Citizenship requires 8 years residence + B1 Estonian.',
  },
  {
    code: 'UK',
    name: 'United Kingdom',
    region: 'UK',
    passportMobilityScore: 90,
    dualCitizenship: 'permitted',
    currency: 'GBP',
    notes: 'Global Talent visa (Tech Nation endorsement) leads to ILR in 3-5 years. Left EU in 2020.',
  },
  {
    code: 'AE',
    name: 'United Arab Emirates',
    region: 'Middle East',
    passportMobilityScore: 84,
    dualCitizenship: 'prohibited',
    currency: 'AED',
    notes: 'Virtual Working Program for remote workers; no direct PR/citizenship path for most residents. Tax-free income.',
  },
]

export function getCountry(code: string): Country | undefined {
  return COUNTRIES.find((c) => c.code === code)
}
