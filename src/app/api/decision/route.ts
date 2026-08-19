// POST /api/decision
// Persists a reproducible decision record. Stores the FULL computed plan as JSON
// plus the policy version + hash + runtime policy version/hash, so the
// recommendation can be reconstructed even after policy changes. Never overwrites.

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import type { MobilityPlan } from '@/lib/domain/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface DecisionBody {
  personId?: string
  plan: MobilityPlan
  stateVersion?: number
  intentVersion?: number
  userId?: string
  trigger?: string
  policyPublicationId?: string
  previousRecordId?: string
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as DecisionBody
    if (!body?.plan) {
      return NextResponse.json({ error: 'plan is required' }, { status: 400 })
    }

    // Get the authenticated user (for linking alerts to plans)
    const session = await getServerSession(authOptions)
    const userId = body.userId ?? (session?.user as any)?.id ?? null

    let personId = body.personId
    if (!personId) {
      const person = await db.person.create({ data: { userId: userId ?? undefined } })
      personId = person.id
    }

    // Mark previous ACTIVE plans for this user as SUPERSEDED
    if (userId) {
      await db.decisionRecord.updateMany({
        where: { userId, planStatus: 'ACTIVE' },
        data: { planStatus: 'SUPERSEDED' },
      })
    }

    const record = await db.decisionRecord.create({
      data: {
        personId,
        stateVersion: body.stateVersion ?? 1,
        intentVersion: body.intentVersion ?? 1,
        policyVersion: body.plan.policyVersion,
        policyHash: body.plan.policyHash,
        runtimePolicyVersion: body.plan.runtimePolicyVersion ?? null,
        runtimePolicyHash: body.plan.runtimePolicyHash ?? null,
        asOfDate: new Date(body.plan.asOfDate),
        plan: body.plan as any,
        userId,
        trigger: body.trigger ?? 'intake',
        planStatus: 'ACTIVE',
        policyPublicationId: body.policyPublicationId ?? null,
        previousRecordId: body.previousRecordId ?? null,
      },
    })

    return NextResponse.json({ id: record.id, personId, userId, savedAt: record.createdAt })
  } catch (err) {
    console.error('[/api/decision]', err)
    return NextResponse.json({ error: 'Failed to save decision record' }, { status: 500 })
  }
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const personId = url.searchParams.get('personId')
    const userId = url.searchParams.get('userId')
    const where: any = {}
    if (personId) where.personId = personId
    if (userId) where.userId = userId
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
