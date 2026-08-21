// Wayfinder — P4.0 OpenAPI 3.1 Generator
//
// Generates a deterministic OpenAPI 3.1 document from the Zod schemas
// defined in src/lib/mobile-contract/.
//
// The generated spec is published at GET /api/mobile/contract.
// The Android repository consumes this spec to generate Kotlin models.
//
// No manual duplication. No drift. The Zod schema is the single source of truth.

import { OpenAPIRegistry, OpenApiGeneratorV3 } from '@asteasolutions/zod-to-openapi'
import {
  MobileLoginRequestSchema,
  MobileLoginResponseSchema,
  MobileRefreshRequestSchema,
  MobileRefreshResponseSchema,
  MobileLogoutRequestSchema,
  MobileLogoutResponseSchema,
  MobileApiErrorSchema,
  MobileUserSchema,
} from '@/lib/mobile-contract'

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const registry = new OpenAPIRegistry()

// Register schemas
registry.register('MobileUser', MobileUserSchema)
registry.register('MobileLoginRequest', MobileLoginRequestSchema)
registry.register('MobileLoginResponse', MobileLoginResponseSchema)
registry.register('MobileRefreshRequest', MobileRefreshRequestSchema)
registry.register('MobileRefreshResponse', MobileRefreshResponseSchema)
registry.register('MobileLogoutRequest', MobileLogoutRequestSchema)
registry.register('MobileLogoutResponse', MobileLogoutResponseSchema)
registry.register('MobileApiError', MobileApiErrorSchema)

// Register security scheme (Bearer token)
const bearerAuth = registry.registerComponent('securitySchemes', 'bearerAuth', {
  type: 'http',
  scheme: 'bearer',
  bearerFormat: 'JWT',
  description: 'Mobile access JWT (short-lived, 15 min). Obtain via POST /api/auth/credentials.',
})

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

// POST /api/auth/credentials
registry.registerPath({
  method: 'post',
  path: '/api/auth/credentials',
  tags: ['Authentication'],
  description: 'Exchange email + password for a short-lived access JWT + rotating refresh token.',
  request: {
    body: {
      content: { 'application/json': { schema: MobileLoginRequestSchema } },
    },
  },
  responses: {
    200: {
      description: 'Authentication successful',
      content: { 'application/json': { schema: MobileLoginResponseSchema } },
    },
    401: {
      description: 'Invalid credentials (uniform failure — no enumeration)',
      content: { 'application/json': { schema: MobileApiErrorSchema } },
    },
    429: {
      description: 'Rate limited',
      content: { 'application/json': { schema: MobileApiErrorSchema } },
    },
  },
})

// POST /api/auth/refresh
registry.registerPath({
  method: 'post',
  path: '/api/auth/refresh',
  tags: ['Authentication'],
  description: 'Rotate a refresh token. Revokes the old token, issues a new access + refresh token pair.',
  request: {
    body: {
      content: { 'application/json': { schema: MobileRefreshRequestSchema } },
    },
  },
  responses: {
    200: {
      description: 'Token rotation successful',
      content: { 'application/json': { schema: MobileRefreshResponseSchema } },
    },
    401: {
      description: 'Invalid or expired refresh token',
      content: { 'application/json': { schema: MobileApiErrorSchema } },
    },
  },
})

// POST /api/auth/logout
registry.registerPath({
  method: 'post',
  path: '/api/auth/logout',
  tags: ['Authentication'],
  description: 'Revoke a refresh token (logout current session). Idempotent.',
  request: {
    body: {
      content: { 'application/json': { schema: MobileLogoutRequestSchema } },
    },
  },
  responses: {
    200: {
      description: 'Logout successful',
      content: { 'application/json': { schema: MobileLogoutResponseSchema } },
    },
  },
})

// GET /api/health
registry.registerPath({
  method: 'get',
  path: '/api/health',
  tags: ['System'],
  description: 'Public health check. Returns deployment commit, DB status, and environment.',
  security: [],
  responses: {
    200: {
      description: 'Health status',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              commitSha: { type: 'string' },
              dbConnected: { type: 'boolean' },
              environment: { type: 'string' },
            },
          },
        },
      },
    },
  },
})

// NOTE: The mobile-protected endpoints (profile, strategy, outcomes, etc.)
// are listed here for contract completeness. They require Bearer auth.
// Their full DTO schemas will be added in a follow-up as the mobile contract
// expands. For P4.0, the auth endpoints + health are the minimal contract.

const protectedPaths = [
  { path: '/api/profile', method: 'get' as const, tag: 'Profile', desc: 'Get the authenticated user\'s profile' },
  { path: '/api/profile', method: 'post' as const, tag: 'Profile', desc: 'Update the authenticated user\'s profile' },
  { path: '/api/strategy/adopt', method: 'get' as const, tag: 'Strategy', desc: 'Get the active strategy' },
  { path: '/api/strategy/adopt', method: 'post' as const, tag: 'Strategy', desc: 'Adopt a strategy' },
  { path: '/api/strategy/{id}/explanation', method: 'get' as const, tag: 'Strategy', desc: 'Get strategy explanation' },
  { path: '/api/strategy/{id}/outcomes', method: 'get' as const, tag: 'Outcomes', desc: 'Get all expected + observed outcomes' },
  { path: '/api/strategy/{id}/outcome', method: 'post' as const, tag: 'Outcomes', desc: 'Submit a strategy-level observed outcome' },
  { path: '/api/strategy/history', method: 'get' as const, tag: 'Strategy', desc: 'Get strategy history' },
  { path: '/api/actions', method: 'get' as const, tag: 'Actions', desc: 'List user actions' },
  { path: '/api/actions/{id}/outcome', method: 'post' as const, tag: 'Outcomes', desc: 'Submit an action-level observed outcome' },
]

for (const p of protectedPaths) {
  registry.registerPath({
    method: p.method,
    path: p.path,
    tags: [p.tag],
    description: p.desc,
    security: [{ [bearerAuth.name]: [] }],
    responses: {
      200: { description: 'Success' },
      401: {
        description: 'Authentication required',
        content: { 'application/json': { schema: MobileApiErrorSchema } },
      },
      404: {
        description: 'Resource not found or not owned',
        content: { 'application/json': { schema: MobileApiErrorSchema } },
      },
    },
  })
}

// ---------------------------------------------------------------------------
// Generate
// ---------------------------------------------------------------------------

const generator = new OpenApiGeneratorV3(registry.definitions)

export function generateOpenApiSpec(): Record<string, unknown> {
  const spec = generator.generateDocument({
    openapi: '3.1.0',
    info: {
      title: 'Wayfinder Mobile API',
      version: '1.0.0',
      description: 'Stable API contract for the Wayfinder Android client. The server is the canonical authority for all strategy, graph, provenance, and outcome intelligence. The mobile client is a thin consumer.',
      contact: {
        name: 'Wayfinder',
      },
    },
    servers: [
      { url: 'https://wayfinder-one.vercel.app', description: 'Production' },
    ],
  })

  return spec as unknown as Record<string, unknown>
}
