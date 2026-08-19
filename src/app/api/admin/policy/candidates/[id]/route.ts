// POST /api/admin/policy/candidates/[id]
// Review a candidate: approve / reject / request more evidence / mark duplicate.
// ADMIN only. Creates an audit record. If approved, publishes a new policy version.

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { transitionCandidate, publishPolicyVersion } from '@/lib/policy/publication'
import type { CandidateFact } from '@/lib/policy/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface ReviewBody {
  action: 'APPROVE' | 'REJECT' | 'REQUEST_MORE_EVIDENCE' | 'MARK_DUPLICATE'
  reason?: string
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any)?.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const body = (await req.json()) as ReviewBody

  const candidate = await db.candidateFact.findUnique({ where: { id } })
  if (!candidate) {
    return NextResponse.json({ error: 'Candidate not found' }, { status: 404 })
  }

  // Map the action to a target extraction status
  const targetStatus: Record<ReviewBody['action'], string> = {
    APPROVE: 'APPROVED',
    REJECT: 'REJECTED',
    REQUEST_MORE_EVIDENCE: 'NEEDS_MORE_EVIDENCE',
    MARK_DUPLICATE: 'DUPLICATE',
  }
  const to = targetStatus[body.action]

  // Check the transition is legal
  const transition = transitionCandidate({ extractionStatus: candidate.extractionStatus }, to)
  if (!transition.ok) {
    return NextResponse.json({ error: transition.reason }, { status: 400 })
  }

  const before = { extractionStatus: candidate.extractionStatus }
  const after = { extractionStatus: to }

  // Update the candidate
  const updated = await db.candidateFact.update({
    where: { id },
    data: {
      extractionStatus: to,
      reviewedBy: session.user?.email ?? 'unknown',
      reviewedAt: new Date(),
      reviewNote: body.reason,
    },
  })

  // Audit record
  await db.adminAuditRecord.create({
    data: {
      adminId: (session.user as any).id ?? 'unknown',
      adminEmail: session.user?.email ?? 'unknown',
      action: body.action === 'APPROVE' ? 'APPROVE_CANDIDATE' :
              body.action === 'REJECT' ? 'REJECT_CANDIDATE' :
              body.action === 'REQUEST_MORE_EVIDENCE' ? 'REQUEST_MORE_EVIDENCE' : 'MARK_DUPLICATE',
      entityId: id,
      entityType: 'CandidateFact',
      before: JSON.stringify(before),
      after: JSON.stringify(after),
      reason: body.reason,
    },
  })

  // If approved, publish a new policy version
  let publication = null
  if (body.action === 'APPROVE') {
    try {
      const candidateForPublication: CandidateFact = {
        id: candidate.id,
        sourceSnapshotId: candidate.sourceSnapshotId,
        jurisdictionId: candidate.jurisdictionId,
        entityType: candidate.entityType as any,
        entityId: candidate.entityId ?? undefined,
        entityLabel: candidate.entityLabel,
        changeKind: candidate.changeKind as any,
        field: candidate.field ?? undefined,
        oldValue: candidate.oldValue ? JSON.parse(candidate.oldValue) : undefined,
        newValue: candidate.newValue ? JSON.parse(candidate.newValue) : undefined,
        effectiveFrom: candidate.effectiveFrom ?? undefined,
        effectiveTo: candidate.effectiveTo ?? undefined,
        evidence: candidate.evidence,
        sourceUrl: candidate.sourceUrl,
        model: candidate.model,
        promptVersion: candidate.promptVersion,
        confidence: candidate.confidence,
        extractionStatus: 'APPROVED',
        aiInterpretation: candidate.aiInterpretation ?? undefined,
        createdAt: candidate.createdAt.toISOString(),
        reviewedBy: session.user?.email ?? undefined,
        reviewedAt: new Date().toISOString(),
        reviewNote: body.reason ?? undefined,
      }

      publication = publishPolicyVersion(
        candidateForPublication,
        session.user?.email ?? 'unknown',
        'snap-2024-11',
        { notes: body.reason, provenance: 'AUTHORITATIVE' },
      )

      // Persist the publication record
      await db.policyPublication.create({
        data: {
          policyVersionId: publication.policyVersionId,
          parentVersionId: publication.parentVersionId,
          candidateFactIds: JSON.stringify(publication.candidateFactIds),
          approvedBy: publication.approvedBy,
          contentHash: publication.contentHash,
          provenance: publication.provenance,
          consistencyChecks: JSON.stringify(publication.consistencyChecks),
          notes: publication.notes,
        },
      })

      await db.adminAuditRecord.create({
        data: {
          adminId: (session.user as any).id ?? 'unknown',
          adminEmail: session.user?.email ?? 'unknown',
          action: 'PUBLISH_POLICY_VERSION',
          entityId: publication.id,
          entityType: 'PolicyPublication',
          after: JSON.stringify({ policyVersionId: publication.policyVersionId, hash: publication.contentHash }),
          reason: body.reason,
        },
      })
    } catch (e) {
      return NextResponse.json({
        error: 'Candidate approved but publication failed',
        details: (e as Error).message,
        candidate: updated,
      }, { status: 500 })
    }
  }

  return NextResponse.json({ candidate: updated, publication })
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any)?.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const { id } = await params
  const candidate = await db.candidateFact.findUnique({
    where: { id },
    include: { sourceSnapshot: true },
  })
  if (!candidate) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ candidate })
}
