// Wayfinder — Source Fetcher
//
// A safe, bounded HTTP fetcher for monitoring authoritative immigration sources.
// Implements: timeout, retries with exponential backoff, rate limiting,
// user-agent, content-type validation, redirect handling, content hashing.
//
// Never silently treats a failed fetch as an unchanged source: a FETCH_ERROR
// is recorded explicitly so an admin can investigate.

import type { FetchResult, RetrievalStatus, Source } from './types'
import { contentHash } from './sources'

const FETCH_TIMEOUT_MS = 15_000
const MAX_RETRIES = 2
const BACKOFF_MS = 1_000
const MAX_CONTENT_LENGTH = 2_000_000 // 2MB cap
const ALLOWED_CONTENT_TYPES = [
  'text/html',
  'text/plain',
  'application/json',
  'application/xml',
  'application/pdf',
]

// Simple in-process rate limiter: at most 1 request per 500ms per domain.
const lastRequestByDomain = new Map<string, number>()
const RATE_LIMIT_MS = 500

function getDomain(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

async function rateLimit(domain: string): Promise<void> {
  const last = lastRequestByDomain.get(domain) ?? 0
  const elapsed = Date.now() - last
  if (elapsed < RATE_LIMIT_MS) {
    await new Promise((r) => setTimeout(r, RATE_LIMIT_MS - elapsed))
  }
  lastRequestByDomain.set(domain, Date.now())
}

/**
 * Fetch a single source with timeout, retries, and content validation.
 * Returns a FetchResult describing what was retrieved. Never throws —
 * failures are captured as retrievalStatus = 'FETCH_ERROR' / 'TIMEOUT' / etc.
 */
export async function fetchSource(source: Pick<Source, 'id' | 'canonicalUrl' | 'url'>): Promise<FetchResult> {
  const url = source.canonicalUrl || source.url
  const domain = getDomain(url)
  const retrievedAt = new Date().toISOString()

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, BACKOFF_MS * attempt))
    }
    await rateLimit(domain)

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

    try {
      const res = await fetch(url, {
        signal: controller.signal,
        redirect: 'follow',
        headers: {
          'User-Agent': 'Wayfinder-Policy-Monitor/1.0 (mobility intelligence; +https://wayfinder.app)',
          'Accept': 'text/html,text/plain,application/json,application/pdf',
        },
      })

      clearTimeout(timeout)

      const contentType = res.headers.get('content-type') ?? ''
      const contentLengthHeader = parseInt(res.headers.get('content-length') ?? '0', 10)

      if (!res.ok) {
        if (attempt < MAX_RETRIES) continue
        return {
          success: false,
          content: '',
          contentHash: '',
          retrievedAt,
          statusCode: res.status,
          contentType,
          contentLength: 0,
          retrievalStatus: 'HTTP_ERROR',
          error: `HTTP ${res.status} ${res.statusText}`,
          finalUrl: res.url,
        }
      }

      // Content-type validation
      const ct = contentType.split(';')[0].trim().toLowerCase()
      if (!ALLOWED_CONTENT_TYPES.includes(ct)) {
        return {
          success: false,
          content: '',
          contentHash: '',
          retrievedAt,
          statusCode: res.status,
          contentType,
          contentLength: 0,
          retrievalStatus: 'CONTENT_TYPE_REJECTED',
          error: `Content type ${ct} not accepted for policy monitoring`,
          finalUrl: res.url,
        }
      }

      // Content length validation
      if (contentLengthHeader > MAX_CONTENT_LENGTH) {
        return {
          success: false,
          content: '',
          contentHash: '',
          retrievedAt,
          statusCode: res.status,
          contentType,
          contentLength: contentLengthHeader,
          retrievalStatus: 'CONTENT_TYPE_REJECTED',
          error: `Content too large (${contentLengthHeader} bytes > ${MAX_CONTENT_LENGTH})`,
          finalUrl: res.url,
        }
      }

      const content = await res.text()
      if (content.length > MAX_CONTENT_LENGTH) {
        // Truncate for safety but record the actual length
        const truncated = content.slice(0, MAX_CONTENT_LENGTH)
        return {
          success: true,
          content: truncated,
          contentHash: contentHash(truncated),
          retrievedAt,
          statusCode: res.status,
          contentType: ct,
          contentLength: content.length,
          retrievalStatus: 'OK',
          finalUrl: res.url,
        }
      }

      return {
        success: true,
        content,
        contentHash: contentHash(content),
        retrievedAt,
        statusCode: res.status,
        contentType: ct,
        contentLength: content.length,
        retrievalStatus: 'OK',
        finalUrl: res.url,
      }
    } catch (err) {
      clearTimeout(timeout)
      const isAbort = err instanceof Error && err.name === 'AbortError'
      const status: RetrievalStatus = isAbort ? 'TIMEOUT' : 'UNKNOWN'
      if (attempt < MAX_RETRIES) continue
      return {
        success: false,
        content: '',
        contentHash: '',
        retrievedAt,
        contentLength: 0,
        retrievalStatus: status,
        error: (err as Error).message,
      }
    }
  }

  // Should not reach here, but safety net
  return {
    success: false,
    content: '',
    contentHash: '',
    retrievedAt,
    contentLength: 0,
    retrievalStatus: 'UNKNOWN',
    error: 'Exhausted retries',
  }
}
