// Wayfinder — P4.0 Mobile Authorization Middleware
//
// Verifies a Bearer access token and extracts the authenticated userId.
// Used by mobile-protected API routes to enforce server-derived authority.
//
// The client must NEVER submit userId, objectiveId, or any authorization-
// bearing field. The server derives authority from the verified JWT.

import { verifyAccessToken } from '@/lib/mobile-auth'
import { mobileErrorResponse } from '@/lib/mobile-contract/errors'

export interface MobileAuthResult {
  authenticated: boolean
  userId?: string
  role?: string
  response?: Response  // error response if not authenticated
}

/**
 * Verify the Authorization: Bearer <token> header from a mobile API request.
 *
 * Returns { authenticated: true, userId, role } if valid.
 * Returns { authenticated: false, response } if invalid (with the appropriate
 *   error response ready to return).
 */
export async function verifyMobileAuth(req: Request): Promise<MobileAuthResult> {
  const authHeader = req.headers.get('authorization')

  if (!authHeader) {
    return {
      authenticated: false,
      response: mobileErrorResponse('AUTH_REQUIRED', 'Authorization header is required'),
    }
  }

  if (!authHeader.startsWith('Bearer ')) {
    return {
      authenticated: false,
      response: mobileErrorResponse('AUTH_REQUIRED', 'Invalid authorization scheme. Use Bearer token.'),
    }
  }

  const token = authHeader.slice(7)

  const result = await verifyAccessToken(token)

  if (!result.valid) {
    if (result.reason === 'EXPIRED') {
      return {
        authenticated: false,
        response: mobileErrorResponse('AUTH_EXPIRED', 'Access token expired. Please refresh.'),
      }
    }
    // For all other invalid reasons (signature, issuer, audience, malformed),
    // return a uniform AUTH_REQUIRED to avoid leaking token details.
    return {
      authenticated: false,
      response: mobileErrorResponse('AUTH_REQUIRED', 'Invalid access token'),
    }
  }

  return {
    authenticated: true,
    userId: result.payload!.sub,
    role: result.payload!.role,
  }
}

/**
 * Verify resource ownership. Returns true if the resource belongs to the
 * authenticated user. Returns false otherwise (caller should return 404,
 * not 403, to avoid leaking resource existence).
 */
export function verifyOwnership(resourceUserId: string, authenticatedUserId: string): boolean {
  return resourceUserId === authenticatedUserId
}
