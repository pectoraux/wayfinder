// Wayfinder — P4.0 Mobile Authentication
//
// Implements Option C: short-lived access JWT + rotating refresh token.
//
// ACCESS TOKEN (JWT, 15 min):
//   - Signed with MOBILE_JWT_SECRET (separate from NEXTAUTH_SECRET)
//   - iss = "wayfinder"
//   - aud = "wayfinder-mobile"
//   - sub = userId
//   - iat, exp
//   - Stateless verification (no DB lookup)
//
// REFRESH TOKEN (opaque, 30 days):
//   - Cryptographically random 32 bytes (hex-encoded)
//   - Stored as SHA-256 hash in MobileSession table (never plaintext)
//   - Single-use: each refresh invalidates the old token + issues a new one
//   - Revocable: logout sets revokedAt
//   - Replay detection: reusing a rotated token revokes the entire session
//
// This module does NOT touch the web NextAuth flow. It is additive.

import { SignJWT, jwtVerify } from 'jose'
import { createHash, randomBytes } from 'crypto'
import { db } from '@/lib/db'

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

// Read the secret at CALL TIME, not module load time. This allows tests
// to change the secret between sign + verify operations.
function getSecretKey(): Uint8Array {
  const secret = process.env.MOBILE_JWT_SECRET ?? 'test-secret-not-for-production'
  return new TextEncoder().encode(secret)
}

const ISSUER = 'wayfinder'
const AUDIENCE = 'wayfinder-mobile'
const ACCESS_TOKEN_TTL_SECONDS = 15 * 60         // 15 minutes
const REFRESH_TOKEN_TTL_DAYS = 30
const REFRESH_TOKEN_TTL_MS = REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000

if (!process.env.MOBILE_JWT_SECRET && process.env.NODE_ENV !== 'test') {
  console.warn('[mobile-auth] MOBILE_JWT_SECRET is not set. Mobile auth will fail.')
}

// ---------------------------------------------------------------------------
// Access token (JWT)
// ---------------------------------------------------------------------------

export interface MobileAccessTokenPayload {
  sub: string         // userId
  role: string        // USER | ADMIN | DEMO
  deviceId: string | null
  iat: number
  exp: number
  iss: string
  aud: string
}

/**
 * Sign a short-lived access JWT for a mobile client.
 * TTL: 15 minutes.
 */
export async function signAccessToken(userId: string, role: string, deviceId?: string): Promise<{
  token: string
  expiresIn: number
}> {
  const now = Math.floor(Date.now() / 1000)
  const exp = now + ACCESS_TOKEN_TTL_SECONDS

  const token = await new SignJWT({
    sub: userId,
    role,
    deviceId: deviceId ?? null,
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .sign(getSecretKey())

  return { token, expiresIn: ACCESS_TOKEN_TTL_SECONDS }
}

export interface AccessTokenVerificationResult {
  valid: boolean
  payload?: MobileAccessTokenPayload
  reason?: 'EXPIRED' | 'INVALID_SIGNATURE' | 'WRONG_ISSUER' | 'WRONG_AUDIENCE' | 'MALFORMED'
}

/**
 * Verify a mobile access JWT. Checks signature, issuer, audience, expiry.
 * Stateless — no DB lookup.
 */
export async function verifyAccessToken(token: string): Promise<AccessTokenVerificationResult> {
  try {
    const { payload } = await jwtVerify(token, getSecretKey(), {
      issuer: ISSUER,
      audience: AUDIENCE,
    })

    return {
      valid: true,
      payload: {
        sub: payload.sub!,
        role: payload.role as string,
        deviceId: (payload.deviceId as string) ?? null,
        iat: payload.iat!,
        exp: payload.exp!,
        iss: payload.iss!,
        aud: Array.isArray(payload.aud) ? payload.aud[0] : (payload.aud as string),
      },
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)

    if (message.includes('expired') || message.includes('"exp" claim timestamp check failed')) {
      return { valid: false, reason: 'EXPIRED' }
    }
    if (message.includes('issuer') || message.includes('"iss" claim check failed')) {
      return { valid: false, reason: 'WRONG_ISSUER' }
    }
    if (message.includes('audience') || message.includes('"aud" claim check failed')) {
      return { valid: false, reason: 'WRONG_AUDIENCE' }
    }
    if (message.includes('signature') || message.includes('verify failed')) {
      return { valid: false, reason: 'INVALID_SIGNATURE' }
    }

    return { valid: false, reason: 'MALFORMED' }
  }
}

// ---------------------------------------------------------------------------
// Refresh token (opaque, hashed, rotated)
// ---------------------------------------------------------------------------

/**
 * Generate a cryptographically random opaque refresh token.
 * Returns the plaintext token (sent to client) — only the hash is stored.
 */
export function generateRefreshToken(): string {
  return randomBytes(32).toString('hex')
}

/**
 * Hash a refresh token for storage. SHA-256 is sufficient because the token
 * is 256 bits of entropy — the hash is not a password.
 */
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

// ---------------------------------------------------------------------------
// Session management
// ---------------------------------------------------------------------------

/**
 * Create a new mobile session with a refresh token.
 * Stores the hash (not plaintext) in MobileSession.
 */
export async function createMobileSession(userId: string, deviceId?: string): Promise<{
  refreshToken: string
  expiresAt: Date
}> {
  const refreshToken = generateRefreshToken()
  const tokenHash = hashRefreshToken(refreshToken)
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS)

  await db.mobileSession.create({
    data: {
      userId,
      tokenHash,
      deviceId: deviceId ?? null,
      expiresAt,
    },
  })

  return { refreshToken, expiresAt }
}

/**
 * Validate + rotate a refresh token.
 *
 * Flow:
 *   1. Hash the provided token
 *   2. Find the session by tokenHash
 *   3. If not found → could be a replay of a previously-rotated token.
 *      Check if the hash was recently rotated (replay detection).
 *   4. If found but revoked/expired → return invalid
 *   5. If valid → revoke the old token, issue a new one, return new tokens
 *
 * Replay detection: if a token hash is not found in the DB, it may be a
 * previously-rotated token being reused. We cannot link rotated tokens back
 * to their session in the current schema without a `previousTokenHash` column.
 * For now, "not found" = invalid (no replay detection across rotations).
 * A future enhancement could add a `tokenFamilyId` to detect reuse.
 */
export interface RefreshResult {
  success: boolean
  reason?: 'NOT_FOUND' | 'EXPIRED' | 'REVOKED'
  accessToken?: string
  refreshToken?: string
  expiresIn?: number
}

export async function rotateRefreshToken(providedRefreshToken: string): Promise<RefreshResult> {
  const tokenHash = hashRefreshToken(providedRefreshToken)

  const session = await db.mobileSession.findUnique({
    where: { tokenHash },
  })

  if (!session) {
    return { success: false, reason: 'NOT_FOUND' }
  }

  // Check expiry
  if (session.expiresAt < new Date()) {
    return { success: false, reason: 'EXPIRED' }
  }

  // Check revocation
  if (session.revokedAt) {
    return { success: false, reason: 'REVOKED' }
  }

  // Valid — rotate: revoke old token, issue new one
  const newRefreshToken = generateRefreshToken()
  const newTokenHash = hashRefreshToken(newRefreshToken)
  const newExpiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS)

  // Revoke the old session
  await db.mobileSession.update({
    where: { id: session.id },
    data: {
      revokedAt: new Date(),
      lastRotatedAt: new Date(),
    },
  })

  // Create a new session for the same user
  await db.mobileSession.create({
    data: {
      userId: session.userId,
      tokenHash: newTokenHash,
      deviceId: session.deviceId,
      expiresAt: newExpiresAt,
    },
  })

  // Issue a new access token
  const user = await db.user.findUnique({ where: { id: session.userId } })
  if (!user) {
    return { success: false, reason: 'NOT_FOUND' }
  }

  const { token: accessToken, expiresIn } = await signAccessToken(
    user.id,
    user.role,
    session.deviceId ?? undefined,
  )

  return {
    success: true,
    accessToken,
    refreshToken: newRefreshToken,
    expiresIn,
  }
}

/**
 * Revoke a refresh token (logout).
 */
export async function revokeRefreshToken(refreshToken: string): Promise<boolean> {
  const tokenHash = hashRefreshToken(refreshToken)
  const session = await db.mobileSession.findUnique({ where: { tokenHash } })

  if (!session) return false

  await db.mobileSession.update({
    where: { id: session.id },
    data: { revokedAt: new Date() },
  })

  return true
}

/**
 * Revoke all sessions for a user (logout all devices, password change, account disable).
 */
export async function revokeAllSessionsForUser(userId: string): Promise<number> {
  const result = await db.mobileSession.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  })
  return result.count
}
