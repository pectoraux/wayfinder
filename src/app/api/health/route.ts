// GET /api/health
// Returns the deployment's running commit, version, build timestamp, and
// runtime policy version. This is the production health-check endpoint.
//
// N0.4b: the DB health check now distinguishes:
//   - DATABASE_UNREACHABLE: cannot connect to the database at all
//   - DATABASE_SCHEMA_INVALID: connected but the schema is missing tables
//   - DATABASE_HEALTHY: connected + schema is valid
//
// Does NOT expose secrets. Only public metadata.

import { NextResponse } from 'next/server'
import { getCurrentPolicySnapshot } from '@/lib/policy/snapshot'
import { POLICY_VERSION } from '@/lib/knowledge/policy-version'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface DbHealth {
  reachable: boolean
  schemaHealthy: boolean
  error: string | null
}

export async function GET() {
  const snapshot = getCurrentPolicySnapshot()

  // DB health check — distinguish connection failure from schema invalidity
  const dbHealth: DbHealth = { reachable: false, schemaHealthy: false, error: null }
  try {
    const { db } = await import('@/lib/db')
    // Probe 1: try a simple model query to check connectivity
    await db.user.count({ take: 1 })
    dbHealth.reachable = true

    // Probe 2: try a query against a N0.4 table to check schema health
    try {
      await db.strategyFeedback.count({ take: 1 })
      dbHealth.schemaHealthy = true
    } catch (schemaErr) {
      // Connected, but the N0.4 tables don't exist yet — schema is stale
      dbHealth.schemaHealthy = false
      dbHealth.error = 'SCHEMA_INVALID: N0.4 tables missing — run prisma db push against production'
    }
  } catch (connErr) {
    dbHealth.reachable = false
    dbHealth.schemaHealthy = false
    const msg = connErr instanceof Error ? connErr.message : String(connErr)
    // Classify the error
    if (msg.includes('connect') || msg.includes('ECONNREFUSED') || msg.includes('timeout') || msg.includes('Tenant') || msg.includes('pool')) {
      dbHealth.error = 'DATABASE_UNREACHABLE: cannot connect to database'
    } else if (msg.includes('does not exist') || msg.includes('relation') || msg.includes('table')) {
      dbHealth.reachable = true // connected but table missing
      dbHealth.schemaHealthy = false
      dbHealth.error = 'SCHEMA_INVALID: table does not exist'
    } else {
      dbHealth.error = `DATABASE_QUERY_FAILED: ${msg.slice(0, 200)}`
    }
  }

  return NextResponse.json({
    app: 'wayfinder',
    version: process.env.npm_package_version ?? '0.3.0',
    commitSha: process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.COMMIT_SHA ?? 'dev',
    commitMessage: process.env.VERCEL_GIT_COMMIT_MESSAGE ?? null,
    commitAuthor: process.env.VERCEL_GIT_COMMIT_AUTHOR_NAME ?? null,
    deploymentUrl: process.env.VERCEL_URL ?? null,
    environment: process.env.NODE_ENV ?? 'development',
    region: process.env.VERCEL_REGION ?? null,
    buildTimestamp: process.env.VERCEL_BUILD_TIMESTAMP ?? new Date().toISOString(),
    policyVersion: POLICY_VERSION.version,
    policyHash: POLICY_VERSION.hash,
    policySnapshotId: snapshot.id,
    policyProvenance: snapshot.provenance,
    // N0.4b: structured DB health
    db: dbHealth,
    // Backward-compat: dbConnected is true only when reachable + schemaHealthy
    dbConnected: dbHealth.reachable && dbHealth.schemaHealthy,
  })
}
