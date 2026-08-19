// POST /api/admin/policy/propagation/[id]
// Resume a propagation that is RUNNING/PARTIAL/FAILED. ADMIN only.
// GET — return propagation status.

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { processPolicyPublication } from '@/lib/policy/propagation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any)?.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const { id } = await params
  const propagation = await db.policyPropagation.findUnique({
    where: { id },
    include: { publication: true },
  })
  if (!propagation) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ propagation })
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any)?.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const propagation = await db.policyPropagation.findUnique({ where: { id } })
  if (!propagation) {
    return NextResponse.json({ error: 'Propagation not found' }, { status: 404 })
  }

  // Resume: call processPolicyPublication which reads the cursor and continues
  const result = await processPolicyPublication(propagation.publicationId)

  // If there are more records, keep going (up to 5 batches per resume call)
  let finalResult = result
  let safety = 0
  while (finalResult.hasMore && safety < 5) {
    finalResult = await processPolicyPublication(propagation.publicationId)
    safety++
  }

  return NextResponse.json({ propagation: finalResult })
}
