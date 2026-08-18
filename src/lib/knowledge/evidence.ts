// Wayfinder Knowledge Base — Evidence
//
// Every legally significant claim is traceable to an Evidence record pointing at
// an authoritative source (government portal, legislation, official institution).
// These are manually curated excerpts of real, publicly available material.
// Figures are approximate for planning and are flagged where the user must verify
// against the live source. Wayfinder NEVER manufactures citations.

import type { Evidence } from '@/lib/domain/types'

export const EVIDENCE: Evidence[] = [
  // ---- Germany: EU Blue Card ----
  {
    id: 'ev-de-bc-makeit',
    kind: 'government',
    title: 'EU Blue Card — Make it in Germany',
    jurisdiction: 'DE',
    publisher: 'Federal Government / Make it in Germany',
    url: 'https://www.make-it-in-germany.com/en/visa/kinds-of-visa/eu-blue-card',
    publishedAt: '2024-01-01',
    effectiveFrom: '2024-01-01',
    excerpt:
      'The EU Blue Card is a residence title for graduates with a recognised degree who will take up employment in Germany commensurate with their qualification. In 2024 the salary threshold is EUR 45,300 for shortage occupations (STEM, IT, health) and EUR 56,400 otherwise. Holders can apply for a settlement permit (permanent residence) after 27 months with basic German (A1) or 21 months with sufficient German (B1).',
    location: 'EU Blue Card overview, requirements section',
    extractionMethod: 'manual_curated',
    verification: 'official',
  },
  {
    id: 'ev-de-bc-shortage',
    kind: 'legislation',
    title: 'BeschV § 2 — Reduced salary threshold for shortage occupations',
    jurisdiction: 'DE',
    publisher: 'Federal Office for Migration and Refugees (BAMF)',
    url: 'https://www.gesetze-im-internet.de/beschv_2013/__2.html',
    publishedAt: '2023-11-18',
    effectiveFrom: '2023-11-18',
    excerpt:
      'A lower gross annual salary threshold (two thirds of the regular threshold) applies for occupations in which there is a shortage of skilled workers. This includes scientists, mathematicians, engineers, IT specialists and certain medical professionals.',
    location: 'Beschäftigungsverordnung, § 2 Abs. 2',
    extractionMethod: 'manual_curated',
    verification: 'official',
  },
  {
    id: 'ev-de-degree-anabin',
    kind: 'official_portal',
    title: 'Anabin — Recognition of foreign degrees',
    jurisdiction: 'DE',
    publisher: 'ZAB (Central Office for Foreign Education)',
    url: 'https://anabin.kmk.org/no_cache/filter/suche.html',
    excerpt:
      'The Anabin database lists how foreign higher education qualifications are evaluated in Germany. A degree classified as "entspricht" (corresponds) to a German degree satisfies the Blue Card recognition requirement without a separate individual assessment.',
    location: 'Anabin degree database',
    extractionMethod: 'manual_curated',
    verification: 'official',
  },
  {
    id: 'ev-de-naturalization',
    kind: 'legislation',
    title: 'Staatsangehörigkeitsgesetz — Naturalization reform (2024)',
    jurisdiction: 'DE',
    publisher: 'Federal Ministry of the Interior',
    url: 'https://www.bmi.bund.de/shareddocs/gesetzeserlasse/nachrichten/de/2024/06/einbuergerungsreform.html',
    publishedAt: '2024-06-27',
    effectiveFrom: '2024-06-27',
    excerpt:
      'Under the reformed citizenship law (effective 27 June 2024), the general qualifying period for naturalization is reduced to 5 years (previously 8). With special integration achievements, including C1 German, it is reduced to 3 years. Dual citizenship is now generally permitted.',
    location: 'StAG reform announcement',
    extractionMethod: 'manual_curated',
    verification: 'official',
  },

  // ---- Germany: Chancenkarte (Opportunity Card) ----
  {
    id: 'ev-de-chance-makeit',
    kind: 'government',
    title: 'Chancenkarte (Opportunity Card) — Make it in Germany',
    jurisdiction: 'DE',
    publisher: 'Federal Government / Make it in Germany',
    url: 'https://www.make-it-in-germany.com/en/visa/kinds-of-visa/opportunity-card',
    publishedAt: '2024-05-31',
    effectiveFrom: '2024-06-01',
    excerpt:
      'From 1 June 2024, the Chancenkarte gives skilled workers a residence permit of up to one year to look for employment in Germany. It uses a points system requiring a minimum of 6 points from criteria including degree, language skills, age, professional experience, and connection to Germany. Holders may work up to 20 hours/week part-time and for trial work of up to 2 weeks.',
    location: 'Chancenkarte overview',
    extractionMethod: 'manual_curated',
    verification: 'official',
  },
  {
    id: 'ev-de-chance-points',
    kind: 'official_portal',
    title: 'Points criteria for the Chancenkarte',
    jurisdiction: 'DE',
    publisher: 'Federal Office for Migration and Refugees (BAMF)',
    url: 'https://www.bamf.de/EN/Themen/MigrationAufenthalt/Zuwanderungsrecht/Chancenkarte/chancenkarte-node.html',
    publishedAt: '2024-05-31',
    effectiveFrom: '2024-06-01',
    excerpt:
      'Points are awarded for: degree from a recognised institution (4 pts), very good German C1 (3 pts) / good German B2 (2 pts) / English B2 (1 pt), under 35 years of age (2 pts), at least 2 years professional experience in the last 5 years (2 pts), and prior stays in Germany or strong connection (1 pt). A minimum of 6 points is required.',
    location: 'Chancenkarte points table',
    extractionMethod: 'manual_curated',
    verification: 'official',
  },

  // ---- Portugal: D7 ----
  {
    id: 'ev-pt-d7-vistos',
    kind: 'government',
    title: 'D7 Visa — Residence Visa for passive income holders',
    jurisdiction: 'PT',
    publisher: 'Portuguese Immigration Service (AIMA) / Vistos.pt',
    url: 'https://vistos.mne.gov.pt/en/national-visas/general-information/types-of-visa/residence-visa-for-passive-income',
    publishedAt: '2023-01-01',
    excerpt:
      'The D7 residence visa is intended for applicants who obtain a regular passive income, sufficient to support their stay in Portugal. The minimum income reference is the Portuguese national minimum wage (EUR 820/month in 2024). Passive income may include pensions, rental income, dividends, interest, and stable recurring income. A NIF (tax number) and Portuguese bank account are required.',
    location: 'National visa — passive income',
    extractionMethod: 'manual_curated',
    verification: 'official',
  },
  {
    id: 'ev-pt-citizenship',
    kind: 'legislation',
    title: 'Lei da Nacionalidade — Portuguese nationality after 5 years',
    jurisdiction: 'PT',
    publisher: 'Portuguese Government',
    url: 'https://imigrante.sef.pt/en/askforcitizenship/',
    excerpt:
      'Foreigners resident in Portuguese territory may apply for Portuguese nationality after 5 years of legal residence counted from the date of the residence permit. An A2 level of Portuguese language knowledge is required.',
    location: 'Nationality Law (Lei n.º 37/81, art. 15)',
    extractionMethod: 'manual_curated',
    verification: 'official',
  },

  // ---- Portugal: D2 / Startup Visa ----
  {
    id: 'ev-pt-startup-iapmei',
    kind: 'institution',
    title: 'Startup Visa — IAPMEI',
    jurisdiction: 'PT',
    publisher: 'IAPMEI (Agency for Competitiveness and Innovation)',
    url: 'https://www.iapmei.pt/PROJETOS-E-FUNDOS/Iniciativas-em-Curso/Startup-Visa.aspx',
    publishedAt: '2023-01-01',
    excerpt:
      'The Startup Visa programme attributes a residence visa and permit to foreign entrepreneurs who intend to develop an innovative business project in Portugal, certified by IAPMEI. The project must be technology-based or innovative and applicants may either incorporate a new company in Portugal or join a certified incubator.',
    location: 'Startup Visa programme page',
    extractionMethod: 'manual_curated',
    verification: 'official',
  },
  {
    id: 'ev-pt-d2-vistos',
    kind: 'government',
    title: 'D2 Visa — Residence visa for entrepreneurs',
    jurisdiction: 'PT',
    publisher: 'Vistos.pt / AIMA',
    url: 'https://vistos.mne.gov.pt/en/national-visas/general-information/types-of-visa/residence-visa-for-entrepreneurs',
    excerpt:
      'The D2 residence visa is for entrepreneurs of any nationality who intend to undertake an investment activity in Portugal, including the creation of a company. Applicants must present a viable business plan and demonstrate means of subsistence.',
    location: 'National visa — entrepreneurs',
    extractionMethod: 'manual_curated',
    verification: 'official',
  },

  // ---- Canada: Express Entry (FSW) ----
  {
    id: 'ev-ca-ee-ircc',
    kind: 'government',
    title: 'Express Entry — Federal Skilled Worker Program',
    jurisdiction: 'CA',
    publisher: 'Immigration, Refugees and Citizenship Canada (IRCC)',
    url: 'https://www.canada.ca/en/immigration-refugees-citizenship/services/immigrate-canada/express-entry/eligibility/federal-skilled-workers.html',
    publishedAt: '2024-01-01',
    excerpt:
      'Federal Skilled Workers (FSWP) are assessed against a 100-point grid (67 minimum to qualify) covering language, education, experience, age, arranged employment and adaptability. Candidates are then ranked in the Express Entry pool by the Comprehensive Ranking System (CRS). Draws typically invite candidates above a CRS cutoff. An Educational Credential Assessment (ECA) and CLB 7 language are required.',
    location: 'FSWP eligibility',
    extractionMethod: 'manual_curated',
    verification: 'official',
  },
  {
    id: 'ev-ca-ee-crs',
    kind: 'official_portal',
    title: 'CRS — Comprehensive Ranking System',
    jurisdiction: 'CA',
    publisher: 'IRCC',
    url: 'https://www.canada.ca/en/immigration-refugees-citizenship/services/immigrate-canada/express-entry/submit-profile/rounds-invitations.html',
    excerpt:
      'CRS scores are assigned for core human capital (age, education, language, experience), spouse factors, skill transferability, and additional points (provincial nomination, job offer, Canadian education, French). Program-specific draws (e.g. STEM, healthcare) have occurred with lower cutoffs. Settlement funds of CAD 14,690 (single, 2024) or a valid job offer is required.',
    location: 'CRS / rounds of invitations',
    extractionMethod: 'manual_curated',
    verification: 'official',
  },

  // ---- Canada: Start-Up Visa ----
  {
    id: 'ev-ca-suv-ircc',
    kind: 'government',
    title: 'Start-up Visa Program',
    jurisdiction: 'CA',
    publisher: 'IRCC',
    url: 'https://www.canada.ca/en/immigration-refugees-citizenship/services/immigrate-canada/start-visa.html',
    publishedAt: '2024-01-01',
    excerpt:
      'The Start-up Visa Program targets immigrant entrepreneurs with the skills to build innovative businesses in Canada. Applicants must obtain a Letter of Support from a designated organisation (angel investor group, venture capital fund, or business incubator), meet CLB 5 language in English or French, and have sufficient settlement funds. Successful applicants receive permanent residence directly.',
    location: 'SUV eligibility',
    extractionMethod: 'manual_curated',
    verification: 'official',
  },
  {
    id: 'ev-ca-citizenship',
    kind: 'legislation',
    title: 'Citizenship Act — 3/5 year physical presence',
    jurisdiction: 'CA',
    publisher: 'IRCC',
    url: 'https://www.canada.ca/en/immigration-refugees-citizenship/services/canadian-citizenship/become-canadian-citizen/time-lived-canada.html',
    excerpt:
      'To be eligible for Canadian citizenship, an adult must have been physically present in Canada for at least 1,095 days (3 years) in the 5 years immediately before applying. Each day as a temporary resident counts as a half-day (max 365).',
    location: 'Citizenship physical presence calculator',
    extractionMethod: 'manual_curated',
    verification: 'official',
  },

  // ---- Estonia: Startup Visa ----
  {
    id: 'ev-ee-sv-startupestonia',
    kind: 'government',
    title: 'Startup Visa — Startup Estonia',
    jurisdiction: 'EE',
    publisher: 'Startup Estonia / Enterprise Estonia',
    url: 'https://startupestonia.ee/visa',
    publishedAt: '2023-01-01',
    excerpt:
      'The Estonian Startup Visa is for founders of foreign startups who wish to develop a location-independent startup in Estonia. Eligible startup ideas are approved by the Startup Committee against novelty, scalability, growth ambition and innovation criteria. The visa grants up to 1 year (renewable) with a path to a temporary residence permit for entrepreneurship.',
    location: 'Startup Visa programme',
    extractionMethod: 'manual_curated',
    verification: 'official',
  },
  {
    id: 'ev-ee-citizenship',
    kind: 'legislation',
    title: 'Estonian Citizenship — 8 year residence requirement',
    jurisdiction: 'EE',
    publisher: 'Police and Border Guard Board',
    url: 'https://www.politsei.ee/en/instructions/applying-for-estonian-citizenship-by-naturalisation/',
    excerpt:
      'To apply for Estonian citizenship by naturalisation, an applicant must have lived in Estonia on the basis of a permanent residence permit for at least 8 years, of which the last 3 must be permanent. A B1 Estonian language requirement applies.',
    location: 'Naturalisation requirements',
    extractionMethod: 'manual_curated',
    verification: 'official',
  },

  // ---- UK: Global Talent ----
  {
    id: 'ev-uk-gt-govuk',
    kind: 'government',
    title: 'Global Talent visa',
    jurisdiction: 'UK',
    publisher: 'GOV.UK',
    url: 'https://www.gov.uk/global-talent',
    publishedAt: '2024-01-01',
    excerpt:
      'The Global Talent visa is for individuals who can show they are a leader or emerging leader (Exceptional Promise) in academia, research, arts, culture or digital technology. Digital technology applicants are endorsed by Tech Nation. Holders can settle (Indefinite Leave to Remain) after 3 years (Talent) or 5 years (Promise) and naturalise after 1 additional year.',
    location: 'Global Talent overview',
    extractionMethod: 'manual_curated',
    verification: 'official',
  },
  {
    id: 'ev-uk-gt-technation',
    kind: 'institution',
    title: 'Tech Nation endorsement — digital technology',
    jurisdiction: 'UK',
    publisher: 'Tech Nation (Home Office endorsing body)',
    url: 'https://technation.io/visas-and-immigration/global-talent/',
    excerpt:
      'Tech Nation endorses applicants in the digital technology field for the Global Talent visa. Applicants must demonstrate either Exceptional Talent (established track record of innovation) or Exceptional Promise (potential to be a future leader). Mandatory criteria and optional criteria must both be evidenced through documented achievements, impact, and recognition.',
    location: 'Tech Nation endorsement guidance',
    extractionMethod: 'manual_curated',
    verification: 'official',
  },

  // ---- UAE: Virtual Working Program ----
  {
    id: 'ev-ae-vwp-icp',
    kind: 'government',
    title: 'Virtual Work Residence Visa / Remote Work Visa',
    jurisdiction: 'AE',
    publisher: 'Federal Authority for Identity and Citizenship (ICP) / Dubai DET',
    url: 'https://dubaivirtualwork.com/',
    publishedAt: '2023-01-01',
    excerpt:
      'The Virtual Working Programme grants a one-year residence permit to remote employees and business owners who work for foreign employers or own foreign companies. Applicants must show a monthly income of at least USD 3,500 (single) or USD 5,000 (with dependents). The permit is renewable but does not lead to permanent residence or citizenship under current UAE law.',
    location: 'Virtual Working Programme',
    extractionMethod: 'manual_curated',
    verification: 'official',
  },

  // ---- Cross-cutting: safety / honesty note ----
  {
    id: 'ev-system-disclaimer',
    kind: 'secondary',
    title: 'Wayfinder — Information accuracy disclaimer',
    jurisdiction: 'multiple',
    publisher: 'Wayfinder',
    url: '/about',
    excerpt:
      'Immigration policy changes frequently. Figures shown (salary thresholds, fees, timelines, points) are curated approximations intended for strategic planning, not legal advice. Every legally significant claim should be verified against the cited primary source before action. Wayfinder distinguishes law (what the source says), fact (what we know about you), eligibility (what rules imply), inference, strategy, and recommendation.',
    location: 'Trust principles',
    extractionMethod: 'manual_curated',
    verification: 'corroborated',
  },
]

export function getEvidence(id: string): Evidence | undefined {
  return EVIDENCE.find((e) => e.id === id)
}

export function getManyEvidence(ids: string[]): Evidence[] {
  return ids.map(getEvidence).filter((e): e is Evidence => Boolean(e))
}
