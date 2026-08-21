// Wayfinder — P4.0 Mobile Auth Contract (Zod runtime schemas)
//
// These schemas are the AUTHORITATIVE contract source:
//   Zod schema → inferred TypeScript type → OpenAPI → Android Kotlin models
//
// The same schema is used for:
//   - request validation
//   - response validation
//   - OpenAPI generation
//
// No manual duplication. No drift.

import { z } from './zod-extend'

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export const MobileUserRoleSchema = z.enum(['USER', 'ADMIN', 'DEMO'])
export type MobileUserRole = z.infer<typeof MobileUserRoleSchema>

export const MobileUserSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  name: z.string().nullable(),
  role: MobileUserRoleSchema,
})
export type MobileUserDTO = z.infer<typeof MobileUserSchema>

// ---------------------------------------------------------------------------
// POST /api/auth/credentials — login
// ---------------------------------------------------------------------------

export const MobileLoginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  deviceId: z.string().max(255).optional(),
})
export type MobileLoginRequest = z.infer<typeof MobileLoginRequestSchema>

export const MobileLoginResponseSchema = z.object({
  accessToken: z.string(),       // short-lived JWT (15 min)
  refreshToken: z.string(),      // opaque, rotating (30 days)
  expiresIn: z.number().int().positive(),  // seconds until accessToken expires
  user: MobileUserSchema,
})
export type MobileLoginResponse = z.infer<typeof MobileLoginResponseSchema>

// ---------------------------------------------------------------------------
// POST /api/auth/refresh — refresh access token
// ---------------------------------------------------------------------------

export const MobileRefreshRequestSchema = z.object({
  refreshToken: z.string().min(1),
})
export type MobileRefreshRequest = z.infer<typeof MobileRefreshRequestSchema>

export const MobileRefreshResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),      // new rotated refresh token
  expiresIn: z.number().int().positive(),
})
export type MobileRefreshResponse = z.infer<typeof MobileRefreshResponseSchema>

// ---------------------------------------------------------------------------
// POST /api/auth/logout — revoke refresh token
// ---------------------------------------------------------------------------

export const MobileLogoutRequestSchema = z.object({
  refreshToken: z.string().min(1),
})
export type MobileLogoutRequest = z.infer<typeof MobileLogoutRequestSchema>

export const MobileLogoutResponseSchema = z.object({
  revoked: z.boolean(),
})
export type MobileLogoutResponse = z.infer<typeof MobileLogoutResponseSchema>
