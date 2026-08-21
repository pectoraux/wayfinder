// Wayfinder — P4.0 Mobile Error Envelope
//
// Stable error contract for all mobile API responses. Never exposes:
//   - stack traces
//   - Prisma error messages
//   - internal type names
//   - database schema details
//   - internal module paths
//
// Every error includes a requestId for support correlation.

import { z } from './zod-extend'
import { randomUUID } from 'crypto'

// ---------------------------------------------------------------------------
// Error codes
// ---------------------------------------------------------------------------

export const MobileErrorCodeSchema = z.enum([
  'AUTH_REQUIRED',           // 401 — no/invalid token
  'AUTH_EXPIRED',             // 401 — access token expired (client should refresh)
  'AUTH_REFRESH_INVALID',     // 401 — refresh token invalid/expired/revoked
  'FORBIDDEN',                // 403 — authenticated but not authorized
  'NOT_FOUND',                // 404 — resource doesn't exist or not owned
  'VALIDATION_ERROR',         // 400 — request body invalid
  'CONFLICT',                 // 409 — idempotency conflict
  'RATE_LIMITED',             // 429 — too many requests
  'SERVER_ERROR',             // 500 — unexpected server failure
  'SERVICE_UNAVAILABLE',      // 503 — database unreachable
])

export type MobileErrorCode = z.infer<typeof MobileErrorCodeSchema>

// ---------------------------------------------------------------------------
// Error envelope
// ---------------------------------------------------------------------------

export const MobileApiErrorSchema = z.object({
  error: z.object({
    code: MobileErrorCodeSchema,
    message: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
    requestId: z.string(),
  }),
})

export type MobileApiError = z.infer<typeof MobileApiErrorSchema>

// ---------------------------------------------------------------------------
// HTTP status mapping
// ---------------------------------------------------------------------------

export const ERROR_CODE_TO_HTTP_STATUS: Record<MobileErrorCode, number> = {
  AUTH_REQUIRED: 401,
  AUTH_EXPIRED: 401,
  AUTH_REFRESH_INVALID: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_ERROR: 400,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  SERVER_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
}

// ---------------------------------------------------------------------------
// Error response builder
// ---------------------------------------------------------------------------

/**
 * Build a stable mobile API error response. The requestId is generated
 * automatically if not provided. The HTTP status is derived from the error code.
 */
export function mobileErrorResponse(
  code: MobileErrorCode,
  message: string,
  options?: {
    details?: Record<string, unknown>
    requestId?: string
    status?: number  // override the default status
  },
): Response {
  const status = options?.status ?? ERROR_CODE_TO_HTTP_STATUS[code]
  const requestId = options?.requestId ?? randomUUID()

  const body: MobileApiError = {
    error: {
      code,
      message,
      details: options?.details,
      requestId,
    },
  }

  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'X-Wayfinder-Request-Id': requestId,
    },
  })
}

/**
 * Uniform authentication failure message. Does not reveal:
 *   - whether the user exists
 *   - whether the email is registered
 *   - whether the password was wrong
 *
 * This prevents credential enumeration.
 */
export const UNIFORM_AUTH_FAILURE_MESSAGE = 'Invalid credentials'
