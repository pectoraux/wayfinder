// Wayfinder — P4.0 In-Memory Rate Limiter
//
// LIMITATIONS (documented per P4.0 requirements):
//   - This is a per-instance in-memory rate limiter.
//   - On Vercel serverless, each function instance has its own memory.
//   - This provides BASIC protection against brute-force from a single IP
//     but is NOT a distributed rate limiter.
//   - Production-grade distributed rate limiting (Redis-backed) is a future
//     infrastructure task.
//
// The limiter is sufficient for P4.0's immediate goal: preventing rapid
// credential brute-force from a single client. It should not be relied upon
// for distributed attack protection.

interface RateLimitEntry {
  count: number
  resetAt: number
}

const store = new Map<string, RateLimitEntry>()

// Periodically clean up expired entries (every 5 minutes)
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000
let lastCleanup = Date.now()

function cleanup() {
  const now = Date.now()
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return
  lastCleanup = now
  for (const [key, entry] of store) {
    if (entry.resetAt < now) {
      store.delete(key)
    }
  }
}

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  resetAt: number
}

/**
 * Check rate limit for a key. Returns { allowed: true } if under the limit,
 * { allowed: false } if over.
 *
 * @param key Rate limit key (e.g., "login:192.168.1.1")
 * @param maxRequests Maximum requests in the window
 * @param windowMs Window size in milliseconds
 */
export function rateLimit(
  key: string,
  maxRequests: number,
  windowMs: number,
): RateLimitResult {
  cleanup()

  const now = Date.now()
  const resetAt = now + windowMs

  const entry = store.get(key)

  if (!entry || entry.resetAt < now) {
    // No entry or window expired — start fresh
    store.set(key, { count: 1, resetAt })
    return { allowed: true, remaining: maxRequests - 1, resetAt }
  }

  // Entry exists and window is active
  if (entry.count >= maxRequests) {
    return { allowed: false, remaining: 0, resetAt: entry.resetAt }
  }

  entry.count++
  return { allowed: true, remaining: maxRequests - entry.count, resetAt: entry.resetAt }
}
