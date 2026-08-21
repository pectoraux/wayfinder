// GET /api/mobile/contract
// Returns the generated OpenAPI 3.1 spec for the mobile API.
//
// This is a PUBLIC endpoint — the contract contains no secrets.
// The Android repository consumes this spec to generate Kotlin models.

import { NextResponse } from 'next/server'
import { generateOpenApiSpec } from '@/lib/mobile-contract/openapi'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const spec = generateOpenApiSpec()
  return NextResponse.json(spec, {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=300', // cache for 5 minutes
    },
  })
}
