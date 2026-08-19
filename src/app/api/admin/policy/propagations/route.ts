// GET /api/admin/policy/propagations
// Lists all policy propagation records with their status. ADMIN only.

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any)?.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const propagations = await db.policyPropagation.findMany({
    orderBy: { startedAt: 'desc' },
    take: 50,
    include: {
      publication: {
        select: { id: true, notes: true, status: true, approvedAt: true, jurisdictionId: true },
      },
    },
  })

  return NextResponse.json({ propagations })
}
