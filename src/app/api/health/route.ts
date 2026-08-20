// GET /api/health
// Returns the deployment's running commit, version, build timestamp, and
// runtime policy version. This is the production health-check endpoint —
// it lets us verify which Git commit the live application is serving.
//
// Does NOT expose secrets. Only public metadata.

import { NextResponse } from 'next/server'
import { getCurrentPolicySnapshot } from '@/lib/policy/snapshot'
import { POLICY_VERSION } from '@/lib/knowledge/policy-version'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const snapshot = getCurrentPolicySnapshot()

  // Lightweight DB connectivity check — uses a model count rather than
  // $queryRaw because raw SQL syntax can vary between providers (SQLite vs
  // PostgreSQL) and some Neon pooled connections have issues with raw queries.
  let dbConnected: boolean | null = null
  try {
    const { db } = await import('@/lib/db')
    // Use a lightweight model query — this works reliably across SQLite + PostgreSQL
    await db.user.count({ take: 1 })
    dbConnected = true
  } catch {
    dbConnected = false
  }

  return NextResponse.json({
    app: 'wayfinder',
    version: process.env.npm_package_version ?? '0.3.0',
    // The commit SHA is injected at build time via VERCEL_GIT_COMMIT_SHA
    // (Vercel sets this automatically). For local dev, it's 'dev'.
    commitSha: process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.COMMIT_SHA ?? 'dev',
    commitMessage: process.env.VERCEL_GIT_COMMIT_MESSAGE ?? null,
    commitAuthor: process.env.VERCEL_GIT_COMMIT_AUTHOR_NAME ?? null,
    // Build/deploy metadata (Vercel sets these automatically)
    deploymentUrl: process.env.VERCEL_URL ?? null,
    environment: process.env.NODE_ENV ?? 'development',
    region: process.env.VERCEL_REGION ?? null,
    buildTimestamp: process.env.VERCEL_BUILD_TIMESTAMP ?? new Date().toISOString(),
    // Runtime policy version
    policyVersion: POLICY_VERSION.version,
    policyHash: POLICY_VERSION.hash,
    policySnapshotId: snapshot.id,
    policyProvenance: snapshot.provenance,
    dbConnected,
  })
}
