// POST /api/auth/refresh
// Rotates a refresh token: validates the old one, revokes it, issues a new
// access token + refresh token.
//
// P4.0 SECURITY:
//   - Refresh tokens are single-use (rotated on each call)
//   - Revoked/expired tokens are rejected
//   - Rate limited
//   - Replay detection: a previously-rotated token is NOT found in the DB
//     (it was revoked), so it returns NOT_FOUND. This is the replay signal.

import { NextResponse } from 'next/server'
import { rotateRefreshToken } from '@/lib/mobile-auth'
import {
  MobileRefreshRequestSchema,
  mobileErrorResponse,
} from '@/lib/mobile-contract'
import { rateLimit } from '@/lib/mobile-contract/rate-limiter'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  // Rate limit: per-IP
  const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  const rateLimitKey = `refresh:${clientIp}`

  const rateLimitResult = rateLimit(rateLimitKey, 30, 60_000) // 30 refreshes per 60s per IP
  if (!rateLimitResult.allowed) {
    return mobileErrorResponse('RATE_LIMITED', 'Too many refresh attempts. Please try again later.')
  }

  try {
    const body = await req.json()

    const parseResult = MobileRefreshRequestSchema.safeParse(body)
    if (!parseResult.success) {
      return mobileErrorResponse('VALIDATION_ERROR', 'Invalid request body', {
        details: { issues: parseResult.error.issues.map((i) => ({ path: i.path, message: i.message })) },
      })
    }

    const result = await rotateRefreshToken(parseResult.data.refreshToken)

    if (!result.success) {
      // Uniform failure for all refresh rejections
      return mobileErrorResponse('AUTH_REFRESH_INVALID', 'Invalid or expired refresh token')
    }

    return NextResponse.json({
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      expiresIn: result.expiresIn,
    })
  } catch (err) {
    console.error('[/api/auth/refresh]', err)
    return mobileErrorResponse('SERVER_ERROR', 'Token refresh failed')
  }
}
