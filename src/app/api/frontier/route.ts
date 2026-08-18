// GET /api/frontier
// Returns the curated knowledge base summary: countries, pathways, evidence,
// enablers, and policy version. Lets the UI render the mobility graph and
// evidence explorer without duplicating the knowledge base on the client.

import { NextResponse } from 'next/server'
import { COUNTRIES } from '@/lib/knowledge/countries'
import { PATHWAYS } from '@/lib/knowledge/pathways'
import { EVIDENCE } from '@/lib/knowledge/evidence'
import { ENABLERS } from '@/lib/knowledge/enablers'
import { POLICY_VERSION } from '@/lib/knowledge/policy-version'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json({
    policyVersion: POLICY_VERSION,
    countries: COUNTRIES,
    pathways: PATHWAYS.map((p) => ({
      id: p.id,
      countryCode: p.countryCode,
      countryName: p.countryName,
      name: p.name,
      category: p.category,
      tagline: p.tagline,
      leadsTo: p.leadsTo,
      estimatedCostUSD: p.estimatedCostUSD,
      processingTimeMonths: p.processingTimeMonths,
      validityMonths: p.validityMonths,
      requiresThirdParty: p.requiresThirdParty,
      shortageOccupationFriendly: p.shortageOccupationFriendly,
      downstream: p.downstream.map((t) => ({ from: t.from, to: t.to, durationMonths: t.durationMonths })),
      requirementCount: p.requirements.length,
      evidenceIds: p.evidenceIds,
      riskNotes: p.riskNotes,
      effectiveFrom: p.effectiveFrom,
    })),
    evidence: EVIDENCE,
    enablers: ENABLERS,
  })
}
