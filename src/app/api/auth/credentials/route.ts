// POST /api/auth/credentials
// Mobile authentication endpoint. Exchanges email + password for a
// short-lived access JWT + rotating refresh token.
//
// P4.0 SECURITY:
//   - Uniform failure response (no credential enumeration)
//   - Rate limited (in-memory, per-IP + per-email)
//   - Refresh token stored hashed (SHA-256, never plaintext)
//   - Access token is a signed JWT with iss/aud/sub/iat/exp
//   - Does NOT touch the web NextAuth flow

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { verifyPassword } from '@/lib/auth-helpers'
import { signAccessToken, createMobileSession } from '@/lib/mobile-auth'
import {
  MobileLoginRequestSchema,
  UNIFORM_AUTH_FAILURE_MESSAGE,
  mobileErrorResponse,
} from '@/lib/mobile-contract'
import { rateLimit, type RateLimitResult } from '@/lib/mobile-contract/rate-limiter'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  // Rate limit: per-IP + per-email
  const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  const rateLimitKey = `login:${clientIp}`

  const rateLimitResult = rateLimit(rateLimitKey, 10, 60_000) // 10 attempts per 60s per IP
  if (!rateLimitResult.allowed) {
    return mobileErrorResponse('RATE_LIMITED', 'Too many login attempts. Please try again later.', {
      details: { retryAfterSeconds: Math.ceil((rateLimitResult.resetAt - Date.now()) / 1000) },
    })
  }

  try {
    const body = await req.json()

    // Validate request against the Zod schema
    const parseResult = MobileLoginRequestSchema.safeParse(body)
    if (!parseResult.success) {
      return mobileErrorResponse('VALIDATION_ERROR', 'Invalid request body', {
        details: { issues: parseResult.error.issues.map((i) => ({ path: i.path, message: i.message })) },
      })
    }

    const { email, password, deviceId } = parseResult.data
    const normalizedEmail = email.trim().toLowerCase()

    // Look up the user
    const user = await db.user.findUnique({ where: { email: normalizedEmail } })

    // Uniform failure: don't reveal whether the email exists
    if (!user || !user.passwordHash) {
      return mobileErrorResponse('AUTH_REQUIRED', UNIFORM_AUTH_FAILURE_MESSAGE)
    }

    // Verify password
    const passwordValid = await verifyPassword(password, user.passwordHash)
    if (!passwordValid) {
      return mobileErrorResponse('AUTH_REQUIRED', UNIFORM_AUTH_FAILURE_MESSAGE)
    }

    // Issue access token
    const { token: accessToken, expiresIn } = await signAccessToken(
      user.id,
      user.role,
      deviceId,
    )

    // Create refresh session
    const { refreshToken } = await createMobileSession(user.id, deviceId)

    return NextResponse.json({
      accessToken,
      refreshToken,
      expiresIn,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    })
  } catch (err) {
    console.error('[/api/auth/credentials]', err)
    return mobileErrorResponse('SERVER_ERROR', 'Authentication failed')
  }
}
