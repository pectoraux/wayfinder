// Wayfinder AI — Intent Parser (Intake Agent)
//
// Converts free-form user intent into a structured Intent object. Uses the LLM
// for natural-language understanding, then VALIDATES the output against the
// Intent schema. If the model is unavailable or returns invalid JSON, we fall
// back to the deterministic parser. The engine never depends on the model.
//
// z-ai-web-dev-sdk is backend-only.

import ZAI from 'z-ai-web-dev-sdk'
import type { Intent, IntentGoal } from '@/lib/domain/types'
import { parseIntentDeterministic, defaultPriorities } from '@/lib/domain/intent'

const SYSTEM_PROMPT = `You are the Intake Agent for Wayfinder, a global mobility intelligence platform.
Your ONLY job is to convert a user's free-form statement of intent into a structured JSON object.
You do NOT give immigration advice. You do NOT invent facts. You only classify intent.

Return STRICT JSON only (no markdown, no prose) matching exactly this shape:
{
  "statedGoal": one of ["move_abroad_general","earn_more","study_and_stay","start_company_abroad","safer_life_for_family","spend_years_abroad","second_citizenship","maximize_mobility","maximize_income","remote_work_abroad","other"],
  "desiredOutcomes": [ { "outcome": one of ["residence","permanent_residence","citizenship","employment","higher_income","company_formation","education","family_safety","travel_freedom","optionality"], "horizon": "near"|"mid"|"long" } ],
  "timeHorizonMonths": number | null,
  "implicitObjectives": [ { "objective": string, "evidence": string, "weight": 0..1 } ],
  "priorityWeights": { "income_priority":0..1, "safety_priority":0..1, "citizenship_priority":0..1, "mobility_priority":0..1, "family_stability":0..1, "entrepreneurship":0..1, "education_value":0..1 },
  "riskTolerance": "conservative"|"balanced"|"aggressive",
  "confidence": "high"|"medium"|"low"
}

Rules:
- Infer implicit objectives from the user's wording (e.g. "freedom to travel" -> mobility; "eventually" -> long-term optionality).
- timeHorizonMonths: convert "within a year"->12, "three years"->36, "eventually"->60, unknown->null.
- priorityWeights should sum to roughly 1.0; weight the dimensions the user emphasizes.
- Output JSON only.`

const VALID_GOALS: IntentGoal[] = [
  'move_abroad_general', 'earn_more', 'study_and_stay', 'start_company_abroad',
  'safer_life_for_family', 'spend_years_abroad', 'second_citizenship',
  'maximize_mobility', 'maximize_income', 'remote_work_abroad', 'other',
]

interface ParsedIntent {
  statedGoal: IntentGoal
  desiredOutcomes: Intent['desiredOutcomes']
  timeHorizonMonths: number | null
  implicitObjectives: Intent['implicitObjectives']
  priorityWeights: Record<string, number>
  riskTolerance: Intent['riskTolerance']
  confidence: Intent['confidence']
}

function extractJson(text: string): string | null {
  // Strip code fences if present, then find the first {...} block.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fenced ? fenced[1] : text
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return null
  return candidate.slice(start, end + 1)
}

function validateParsed(obj: any): obj is ParsedIntent {
  if (!obj || typeof obj !== 'object') return false
  if (!VALID_GOALS.includes(obj.statedGoal)) return false
  if (!Array.isArray(obj.desiredOutcomes)) return false
  if (!Array.isArray(obj.implicitObjectives)) return false
  if (typeof obj.priorityWeights !== 'object' || obj.priorityWeights === null) return false
  return true
}

export async function parseIntentWithLLM(rawInput: string): Promise<{ intent: Intent; source: 'llm' | 'fallback' }> {
  const fallback = parseIntentDeterministic(rawInput)

  try {
    const zai = await ZAI.create()
    const completion = await zai.chat.completions.create({
      messages: [
        { role: 'assistant', content: SYSTEM_PROMPT },
        { role: 'user', content: rawInput },
      ],
      thinking: { type: 'disabled' },
    })

    const content = completion.choices[0]?.message?.content ?? ''
    const jsonStr = extractJson(content)
    if (!jsonStr) return { intent: fallback, source: 'fallback' }

    let parsed: any
    try {
      parsed = JSON.parse(jsonStr)
    } catch {
      return { intent: fallback, source: 'fallback' }
    }

    if (!validateParsed(parsed)) return { intent: fallback, source: 'fallback' }

    // Merge LLM understanding with deterministic safety: keep rawInput,
    // constraints, and ensure priorities are well-formed.
    const priorities = defaultPriorities(parsed.statedGoal).map((p) => ({
      ...p,
      weight: parsed.priorityWeights[p.kind] != null
        ? Math.max(0, Math.min(1, parsed.priorityWeights[p.kind]))
        : p.weight,
    }))

    const intent: Intent = {
      rawInput,
      statedGoal: parsed.statedGoal,
      desiredOutcomes: parsed.desiredOutcomes,
      timeHorizonMonths: parsed.timeHorizonMonths ?? null,
      constraints: fallback.constraints,
      priorities,
      riskTolerance: parsed.riskTolerance ?? 'balanced',
      implicitObjectives: parsed.implicitObjectives,
      confidence: parsed.confidence ?? 'medium',
    }

    return { intent, source: 'llm' }
  } catch (err) {
    console.error('[intent-parser] LLM failed, using deterministic fallback:', err)
    return { intent: fallback, source: 'fallback' }
  }
}
