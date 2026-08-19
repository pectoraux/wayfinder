// POST /api/intent/parse
// Converts free-form intent text into a structured Intent. LLM-backed with a
// deterministic fallback — never blocks on model failure.

import { NextResponse } from 'next/server'
import { parseIntentWithLLM } from '@/lib/ai/intent-parser'
import type { Intent } from '@/lib/domain/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const rawInput: string = body?.rawInput
    if (!rawInput || typeof rawInput !== 'string') {
      return NextResponse.json({ error: 'rawInput (string) is required' }, { status: 400 })
    }
    const { intent, source } = await parseIntentWithLLM(rawInput)
    return NextResponse.json({ intent, source })
  } catch (err) {
    console.error('[/api/intent/parse]', err)
    return NextResponse.json({ error: 'Failed to parse intent' }, { status: 500 })
  }
}

export async function GET() {
  return NextResponse.json({ ok: true, endpoint: '/api/intent/parse', method: 'POST' })
}
