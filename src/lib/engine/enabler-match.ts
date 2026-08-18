// Wayfinder — Enabler matcher.
//
// Maps blockers (failed/unknown hard requirements) to legitimate enabler nodes.
// Honours the safety rule: only REQUIRED, LEGALLY VALID, or SUPPORTIVE
// relationships. Never models sham employment, fake marriages, nominee
// arrangements, or any relationship whose sole purpose is to circumvent law.

import type { EnablerMatch, MobilityPlan, Route } from '@/lib/domain/types'
import { getEnablersForAddressal } from '@/lib/knowledge/enablers'
import { getPathway } from '@/lib/knowledge/pathways'

export function matchEnablers(routes: Route[]): EnablerMatch[] {
  const matches: EnablerMatch[] = []
  const seen = new Set<string>()

  for (const route of routes) {
    if (route.eligibility.status === 'ineligible') continue
    const pathway = getPathway(route.entryPathwayId)
    if (!pathway) continue

    for (const blocker of route.eligibility.blockers) {
      for (const addr of blocker.addressableVia) {
        const enablers = getEnablersForAddressal(addr.kind, route.countryCode)
        for (const enabler of enablers) {
          const key = `${route.id}|${enabler.id}|${blocker.requirementId}`
          if (seen.has(key)) continue
          seen.add(key)
          matches.push({
            enabler,
            addresses: blocker.label,
            rationale: `${enabler.name} can satisfy "${blocker.label}" on the ${route.label} route.`,
            relationship: relationshipFor(enabler.kind),
            whatUserGets: `Progresses the "${blocker.label}" requirement on ${route.countryName}.`,
            whatEnablerGets: enabler.enablerGets,
            consentRequired: true,
            consentGranted: false,
          })
        }
      }
    }
  }

  return matches
}

function relationshipFor(kind: EnablerMatch['enabler']['kind']): string {
  switch (kind) {
    case 'employer': return 'Genuine employment (the role exists and the hire is real)'
    case 'incubator':
    case 'accelerator': return 'Incubation / acceleration of a real venture'
    case 'endorsement_body': return 'Independent endorsement of genuine talent'
    case 'credential_evaluator': return 'Statutory credential assessment'
    case 'language_provider': return 'Accredited language certification'
    case 'university': return 'Genuine enrolment in a program of study'
    case 'law_firm': return 'Professional legal advice (escalation layer)'
    default: return 'Legitimate professional relationship'
  }
}

/** Attach enabler matches to a plan. */
export function withEnablers(plan: MobilityPlan): MobilityPlan {
  return { ...plan, enablerMatches: matchEnablers(plan.routes) }
}
