// Wayfinder — Z.ai SDK loader (env-var driven, Vercel-friendly).
//
// The z-ai-web-dev-sdk reads from a `.z-ai-config` JSON file by default. On
// Vercel there is no filesystem config, so we construct the client directly
// from environment variables. On local dev we fall back to ZAI.create() which
// reads the local .z-ai-config.
//
// If neither is available, getZai() returns null and the AI agents fall back to
// their deterministic paths — the app still works, just without LLM prose.

import ZAI from "z-ai-web-dev-sdk"
import type ZAIClient from "z-ai-web-dev-sdk"

let cached: ZAIClient | null | undefined

export async function getZai(): Promise<ZAIClient | null> {
  if (cached !== undefined) return cached

  // 1. Env-var driven (Vercel + any production runtime)
  const baseUrl = process.env.ZAI_BASE_URL
  const apiKey = process.env.ZAI_API_KEY
  if (baseUrl && apiKey) {
    try {
      cached = new (ZAI as any)({ baseUrl, apiKey }) as ZAIClient
      return cached
    } catch (e) {
      console.error("[zai] env-var construction failed:", e)
    }
  }

  // 2. Local dev: read the .z-ai-config file
  try {
    cached = await ZAI.create()
    return cached
  } catch (e) {
    console.warn("[zai] no config available; LLM agents will use deterministic fallback.")
    cached = null
    return null
  }
}
