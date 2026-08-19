// GET /api/route-stability?routeId=route-de-blue-card
// Returns the historical policy stability indicator for a route: the number of
// material policy changes affecting it in the past 24 months, using actual
// historical records (policy publications + snapshot history).
//
// Does NOT predict the future — explicitly labeled as a historical indicator.

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { SNAPSHOTS } from '@/lib/policy/knowledge'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const routeId = url.searchParams.get('routeId')
  if (!routeId) {
    return NextResponse.json({ error: 'routeId is required' }, { status: 400 })
  }

  // Extract the pathway id from the route id (route-de-blue-card → de-blue-card)
  const pathwayId = routeId.replace(/^route-/, '')

  // Count material changes from DB publications (real verified changes)
  let dbChangeCount = 0
  let dbChanges: { date: string; description: string; status: string }[] = []
  try {
    const publications = await db.policyPublication.findMany({
      where: { status: { in: ['PUBLISHED', 'SUPERSEDED', 'ROLLED_BACK'] } },
      orderBy: { approvedAt: 'desc' },
      take: 50,
    })
    // Filter to publications that affect this pathway (by checking the overlay)
    for (const pub of publications) {
      if (!pub.overlay) continue
      try {
        const overlay = JSON.parse(pub.overlay)
        const affects = overlay.changes?.some(
          (c: any) => c.entityId === pathwayId || c.entityLabel?.toLowerCase().includes(pathwayId.split('-').pop() ?? ''),
        )
        if (affects) {
          dbChangeCount++
          dbChanges.push({
            date: pub.approvedAt.toISOString().slice(0, 7),
            description: pub.notes,
            status: pub.status,
          })
        }
      } catch { /* skip malformed */ }
    }
  } catch (e) {
    console.warn('[route-stability] DB unavailable, using code snapshot history only:', e)
  }

  // Count from the code knowledge base snapshot history (the v1 → v2 changes)
  const codeChanges: { date: string; description: string }[] = []
  for (const snap of SNAPSHOTS) {
    if (snap.provenance === 'SIMULATED' || snap.provenance === 'TEST_FIXTURE') continue
    // The v2 snapshot's notes mention changes; we check if this pathway is affected
    if (snap.notes.toLowerCase().includes(pathwayId.split('-')[1] ?? '')) {
      codeChanges.push({
        date: snap.effectiveFrom.slice(0, 7),
        description: snap.notes.slice(0, 100),
      })
    }
  }

  const totalChanges = dbChangeCount + codeChanges.length
  const twentyFourMonthsAgo = new Date()
  twentyFourMonthsAgo.setMonth(twentyFourMonthsAgo.getMonth() - 24)
  const recentChanges = [...dbChanges, ...codeChanges].filter(
    (c) => new Date(c.date + '-01').getTime() >= twentyFourMonthsAgo.getTime(),
  )

  // Stability label
  let stabilityLabel: string
  if (recentChanges.length === 0) stabilityLabel = 'Stable'
  else if (recentChanges.length <= 1) stabilityLabel = 'Low historical volatility'
  else if (recentChanges.length <= 3) stabilityLabel = 'Moderate historical volatility'
  else stabilityLabel = 'High historical volatility'

  const hasInsufficientHistory = totalChanges === 0 && dbChangeCount === 0

  return NextResponse.json({
    routeId,
    pathwayId,
    materialChanges24Months: recentChanges.length,
    stabilityLabel,
    hasInsufficientHistory,
    changes: [...dbChanges, ...codeChanges].slice(0, 10),
    disclaimer: 'This is a historical indicator, not a prediction of future policy changes.',
  })
}
