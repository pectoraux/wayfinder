// POST /api/auth/logout
// Revokes a refresh token (current session logout).
//
// P4.0 SECURITY:
//   - Revokes the refresh token in the DB (sets revokedAt)
//   - Idempotent: returns { revoked: true } even if the token was already revoked
//   - Does NOT require an access token (logout should work even if the access
//     token is expired)

import { NextResponse } from 'next/server'
import { revokeRefreshToken } from '@/lib/mobile-auth'
import {
  MobileLogoutRequestSchema,
  mobileErrorResponse,
} from '@/lib/mobile-contract'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  try {
    const body = await req.json()

    const parseResult = MobileLogoutRequestSchema.safeParse(body)
    if (!parseResult.success) {
      return mobileErrorResponse('VALIDATION_ERROR', 'Invalid request body', {
        details: { issues: parseResult.error.issues.map((i) => ({ path: i.path, message: i.message })) },
      })
    }

    // Revoke the refresh token. Idempotent — returns true even if already revoked.
    await revokeRefreshToken(parseResult.data.refreshToken)

    return NextResponse.json({ revoked: true })
  } catch (err) {
    console.error('[/api/auth/logout]', err)
    return mobileErrorResponse('SERVER_ERROR', 'Logout failed')
  }
}
