// Wayfinder — P4.0 Unified Authentication Principal Resolution
//
// Resolves the authenticated principal from EITHER:
//   - NextAuth session cookie (web client)
//   - Authorization: Bearer <mobile JWT> (mobile client)
//
// Both mechanisms produce the same AuthenticatedPrincipal type, so
// downstream authorization logic is shared — no duplicate authorization
// architecture.
//
// WEB:
//   NextAuth session cookie → getToken() → { id, role, ... }
//
// MOBILE:
//   Authorization: Bearer <token> → verifyAccessToken() → { sub, role, ... }
//
// The principal's userId is the canonical identity. Resource ownership
// checks use this userId — the client can NEVER override it.

import { getToken } from 'next-auth/jwt'
import type { NextRequest } from 'next/server'
import { verifyAccessToken } from '@/lib/mobile-auth'

// ---------------------------------------------------------------------------
// Principal type
// ---------------------------------------------------------------------------

export type AuthMechanism = 'web' | 'mobile'

export interface AuthenticatedPrincipal {
  authenticated: boolean
  userId?: string
  role?: string
  mechanism?: AuthMechanism
  /** For mobile: the device ID from the JWT (metadata only, not authorization). */
  deviceId?: string | null
}

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------

/**
 * Resolve the authenticated principal from a Next.js request.
 *
 * Checks in order:
 *   1. Mobile Bearer token (Authorization: Bearer <jwt>)
 *   2. NextAuth session cookie (web)
 *
 * Returns { authenticated: true, ... } if either mechanism succeeds.
 * Returns { authenticated: false } if neither succeeds.
 *
 * The caller (middleware or route handler) uses the returned principal's
 * userId for resource ownership checks. The client can NEVER override
 * this — it is derived from the verified token, not the request body.
 */
export async function resolveAuthenticatedPrincipal(
  req: Request | NextRequest,
): Promise<AuthenticatedPrincipal> {
  // 1. Try mobile Bearer token
  const authHeader = req.headers.get('authorization')
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7)
    const result = await verifyAccessToken(token)

    if (result.valid && result.payload) {
      return {
        authenticated: true,
        userId: result.payload.sub,
        role: result.payload.role,
        mechanism: 'mobile',
        deviceId: result.payload.deviceId,
      }
    }

    // If a Bearer token was present but invalid, return unauthenticated.
    // Do NOT fall through to web auth — the client intended mobile auth
    // and the token is bad.
    return { authenticated: false }
  }

  // 2. Try NextAuth session cookie (web)
  //    getToken reads the next-auth.session-token cookie.
  const nextAuthToken = await getToken({
    req: req as NextRequest,
    secret: process.env.NEXTAUTH_SECRET,
  })

  if (nextAuthToken && nextAuthToken.id) {
    return {
      authenticated: true,
      userId: nextAuthToken.id as string,
      role: nextAuthToken.role as string,
      mechanism: 'web',
    }
  }

  // Neither mechanism succeeded
  return { authenticated: false }
}

/**
 * Get the authenticated user ID from a Next.js API route request.
 *
 * Checks BOTH:
 *   1. Mobile Bearer token (Authorization: Bearer <jwt>)
 *   2. NextAuth session cookie (via getServerSession)
 *
 * Returns the userId if authenticated, null otherwise.
 *
 * This is the canonical way for API route handlers to resolve identity.
 * It replaces the pattern of calling getServerSession directly, which
 * only checks the web cookie and would reject valid mobile Bearer tokens.
 */
export async function getAuthenticatedUserId(req: Request): Promise<string | null> {
  const principal = await resolveAuthenticatedPrincipal(req)
  return principal.authenticated ? (principal.userId ?? null) : null
}

/**
 * Get the authenticated principal from a Next.js API route request.
 * Throws a 401-ready response if not authenticated.
 *
 * Usage in route handlers:
 *   const principal = await requireAuthenticatedPrincipal(req)
 *   // if we reach here, principal.userId is guaranteed
 *   const userId = principal.userId!
 */
export async function requireAuthenticatedPrincipal(req: Request): Promise<AuthenticatedPrincipal> {
  const principal = await resolveAuthenticatedPrincipal(req)
  if (!principal.authenticated) {
    throw new UnauthenticatedError()
  }
  return principal
}

/** Thrown when authentication is required but not present. */
export class UnauthenticatedError extends Error {
  constructor() {
    super('Unauthorized')
    this.name = 'UnauthenticatedError'
  }
}

/**
 * Verify resource ownership. Returns true if the resource belongs to the
 * authenticated principal. Returns false otherwise.
 *
 * Callers should return 404 (not 403) when this returns false, to avoid
 * leaking resource existence.
 */
export function verifyOwnership(
  resourceUserId: string,
  principal: AuthenticatedPrincipal,
): boolean {
  if (!principal.authenticated || !principal.userId) return false
  return resourceUserId === principal.userId
}
