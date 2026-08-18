// Wayfinder AI — Explanation Agent
//
// Takes the deterministic MobilityPlan and produces cohesive, human-friendly
// narrative prose for the key result sections. The LLM does NOT change any
// fact, score, or ranking — it only renders the deterministic outputs into
// readable language. Falls back to assembled strings if the model is unavailable.

import ZAI from 'z-ai-web-dev-sdk'
import type { MobilityPlan, Route } from '@/lib/domain/types'

export interface PlanNarrative {
  whyBest: string
  blocker: string
  nextAction: string
  alternativeIntentNote: string
  uncertainty: string
}

const SYSTEM_PROMPT = `You are the Explanation Agent for Wayfinder, a global mobility intelligence platform.
You receive a JSON object describing a deterministic mobility plan (routes, scores, blockers, enablers, alternative intents) that was computed by code — NOT by you.
Your ONLY job is to render this into clear, calm, trustworthy prose for the user.

Hard rules:
- Do NOT invent any fact, number, route, requirement, or evidence not present in the input.
- Do NOT give legal advice or guarantee outcomes. Distinguish "the rules require" from "you may".
- Preserve all uncertainty signals. If a route is "conditional", say so.
- Be concise. Plain language. No marketing fluff. No emojis.
- Return STRICT JSON only (no markdown) with exactly these keys:
{
  "whyBest": string,            // 2-4 sentences: why the best route is ranked first
  "blocker": string,            // 1-2 sentences: the primary blocker + what it means
  "nextAction": string,         // 1 sentence: the single highest-value next action
  "alternativeIntentNote": string, // 1-2 sentences: whether the stated intent may be suboptimal
  "uncertainty": string         // 1 sentence: the key assumption that could change this
}`

function assembleFallback(plan: MobilityPlan): PlanNarrative {
  const best = plan.routes.find((r) => r.id === plan.recommendation.bestRouteId)
  const why = best
    ? `${best.label} ranks first${best.paretoOptimal ? ' and is Pareto-optimal' : ''}. ${plan.recommendation.rationale.slice(0, 2).join(' ')}`
    : plan.recommendation.rationale.join(' ')

  const blocker = plan.recommendation.primaryBlocker
    ? `The primary blocker is: ${plan.recommendation.primaryBlocker}. ${plan.recommendation.unlocks.length ? `Legitimate unlocks: ${plan.recommendation.unlocks.join(', ')}.` : ''}`
    : 'No hard blockers on the best route — it is actionable now.'

  const altNote = plan.recommendation.intentMayBeSuboptimal
    ? `Your stated intent may be suboptimal. We detected ${plan.alternativeIntents.filter((a) => a.mayBeSuperior).length} alternative objective(s) that may better fit your profile.`
    : 'Your stated intent aligns well with your profile; no superior alternative was detected.'

  return {
    whyBest: why,
    blocker,
    nextAction: plan.recommendation.nextAction,
    alternativeIntentNote: altNote,
    uncertainty: plan.recommendation.sensitivityAssumptions[0] ?? 'No material sensitivity identified.',
  }
}

function extractJson(text: string): string | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fenced ? fenced[1] : text
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return null
  return candidate.slice(start, end + 1)
}

/** Compress the plan to the fields the LLM needs (keep it small + non-sensitive). */
function planDigest(plan: MobilityPlan) {
  const best = plan.routes.find((r) => r.id === plan.recommendation.bestRouteId)
  const routes = plan.routes.slice(0, 5).map((r: Route) => ({
    label: r.label,
    status: r.eligibility.status,
    paretoOptimal: r.paretoOptimal,
    risk: r.risk,
    totalMonths: r.totalMonths,
    totalCostUSD: r.totalCostUSD,
    scores: r.scores,
    blockers: r.eligibility.blockers.map((b) => b.label),
    conditions: r.eligibility.conditions,
  }))
  return {
    intent: {
      statedGoal: plan.intent.statedGoal,
      desiredOutcomes: plan.intent.desiredOutcomes,
      implicitObjectives: plan.intent.implicitObjectives,
      timeHorizonMonths: plan.intent.timeHorizonMonths,
    },
    bestRouteId: plan.recommendation.bestRouteId,
    recommendation: plan.recommendation,
    alternativeIntents: plan.alternativeIntents,
    routes,
    bestRoute: best
      ? {
          label: best.label,
          status: best.eligibility.status,
          steps: best.steps.map((s) => ({ status: s.status, durationMonths: s.durationMonths, blocked: s.blocked })),
          scores: best.scores,
        }
      : null,
    confidence: plan.confidence,
  }
}

export async function generateNarrative(plan: MobilityPlan): Promise<PlanNarrative & { source: 'llm' | 'fallback' }> {
  const fallback = assembleFallback(plan)
  try {
    const zai = await ZAI.create()
    const completion = await zai.chat.completions.create({
      messages: [
        { role: 'assistant', content: SYSTEM_PROMPT },
        { role: 'user', content: JSON.stringify(planDigest(plan)) },
      ],
      thinking: { type: 'disabled' },
    })
    const content = completion.choices[0]?.message?.content ?? ''
    const jsonStr = extractJson(content)
    if (!jsonStr) return { ...fallback, source: 'fallback' }
    const parsed = JSON.parse(jsonStr)
    return {
      whyBest: typeof parsed.whyBest === 'string' ? parsed.whyBest : fallback.whyBest,
      blocker: typeof parsed.blocker === 'string' ? parsed.blocker : fallback.blocker,
      nextAction: typeof parsed.nextAction === 'string' ? parsed.nextAction : fallback.nextAction,
      alternativeIntentNote: typeof parsed.alternativeIntentNote === 'string' ? parsed.alternativeIntentNote : fallback.alternativeIntentNote,
      uncertainty: typeof parsed.uncertainty === 'string' ? parsed.uncertainty : fallback.uncertainty,
      source: 'llm',
    }
  } catch (err) {
    console.error('[explanation] LLM failed, using fallback:', err)
    return { ...fallback, source: 'fallback' }
  }
}
