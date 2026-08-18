// POST /api/decision
// Persists a reproducible decision record. Stores the FULL computed plan as JSON
// plus the policy version + hash, so the recommendation can be reconstructed
// even after policy changes. Never overwrites historical records.

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { POLICY_VERSION } from '@/lib/knowledge/policy-version'
import type { MobilityPlan } from '@/lib/domain/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface DecisionBody {
  personId?: string
  plan: MobilityPlan
  stateVersion?: number
  intentVersion?: number
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as DecisionBody
    if (!body?.plan) {
      return NextResponse.json({ error: 'plan is required' }, { status: 400 })
    }

    let personId = body.personId
    if (!personId) {
      const person = await db.person.create({ data: {} })
      personId = person.id
    }

    const record = await db.decisionRecord.create({
      data: {
        personId,
        stateVersion: body.stateVersion ?? 1,
        intentVersion: body.intentVersion ?? 1,
        policyVersion: POLICY_VERSION.version,
        policyHash: POLICY_VERSION.hash,
        asOfDate: new Date(body.plan.asOfDate),
        plan: body.plan as any,
      },
    })

    return NextResponse.json({ id: record.id, personId, savedAt: record.createdAt })
  } catch (err) {
    console.error('[/api/decision]', err)
    return NextResponse.json({ error: 'Failed to save decision record' }, { status: 500 })
  }
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const personId = url.searchParams.get('personId')
    const where = personId ? { personId } : {}
    const records = await db.decisionRecord.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 20,
    })
    return NextResponse.json({ records })
  } catch (err) {
    console.error('[/api/decision GET]', err)
    return NextResponse.json({ error: 'Failed to fetch decision records' }, { status: 500 })
  }
}
