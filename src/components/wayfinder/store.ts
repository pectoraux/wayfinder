'use client'

import { create } from 'zustand'
import type { Intent, MobilityPlan, MobilityState, Evidence } from '@/lib/domain/types'
import { exampleState } from '@/lib/domain/state'
import type { PlanNarrative } from '@/lib/ai/explanation'
import type { ScenarioResult, ScenarioSpec } from '@/lib/engine/simulate'
import type { Strategy } from '@/lib/strategy/types'

type Phase = 'home' | 'intake' | 'computing' | 'results'

interface WayfinderState {
  phase: Phase
  rawIntent: string
  intent: Intent | null
  intentSource: 'llm' | 'fallback' | null
  mobilityState: MobilityState | null
  plan: MobilityPlan | null
  narrative: PlanNarrative | null
  evidence: Evidence[]
  strategy: Strategy | null
  activeRouteId: string | null
  scenarios: ScenarioResult[]
  error: string | null
  isComputing: boolean
  strategyLoading: boolean
  strategyError: boolean
  asOfDate: string | null // ISO date for historical mode; null = today

  setPhase: (p: Phase) => void
  setRawIntent: (s: string) => void
  submitIntent: () => Promise<void>
  setMobilityState: (s: MobilityState) => void
  loadExample: () => void
  computePlan: () => Promise<void>
  runCounterfactual: (spec: ScenarioSpec) => Promise<void>
  setActiveRoute: (id: string) => void
  setAsOfDate: (d: string | null) => void
  reset: () => void
}

export const useWayfinder = create<WayfinderState>((set, get) => ({
  phase: 'home',
  rawIntent: '',
  intent: null,
  intentSource: null,
  mobilityState: null,
  plan: null,
  narrative: null,
  evidence: [],
  strategy: null,
  activeRouteId: null,
  scenarios: [],
  error: null,
  isComputing: false,
  strategyLoading: false,
  strategyError: false,
  asOfDate: null,

  setPhase: (p) => set({ phase: p }),
  setRawIntent: (s) => set({ rawIntent: s }),

  submitIntent: async () => {
    const rawIntent = get().rawIntent.trim()
    if (!rawIntent) {
      set({ error: 'Tell us what you are trying to make possible.' })
      return
    }
    set({ isComputing: true, error: null })
    try {
      const res = await fetch('/api/intent/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rawInput: rawIntent }),
      })
      if (!res.ok) throw new Error('Intent parse failed')
      const data = await res.json()
      set({ intent: data.intent, intentSource: data.source, phase: 'intake', isComputing: false })
    } catch (e) {
      set({ error: 'Could not parse your intent. Please try rephrasing.', isComputing: false })
    }
  },

  setMobilityState: (s) => set({ mobilityState: s }),

  loadExample: () => {
    set({
      rawIntent:
        'I am a 29-year-old software engineer from Kenya. I earn $70,000, have a bachelor\'s degree, $40,000 savings, work remotely, and want to move somewhere I can start a company, earn more, eventually obtain permanent residence, and keep the freedom to travel.',
      mobilityState: exampleState(),
      phase: 'home',
    })
  },

  computePlan: async () => {
    const { mobilityState, intent } = get()
    if (!mobilityState || !intent) {
      set({ error: 'Missing state or intent.' })
      return
    }
    set({ phase: 'computing', isComputing: true, error: null })
    try {
      const res = await fetch('/api/mobility/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: mobilityState, intent, asOfDate: get().asOfDate ?? undefined }),
      })
      if (!res.ok) throw new Error('Plan computation failed')
      const data = await res.json()
      const plan = data.plan as MobilityPlan
      set({
        plan,
        narrative: data.narrative,
        evidence: data.evidence ?? [],
        scenarios: plan.scenarios,
        activeRouteId: plan.recommendation.bestRouteId,
        phase: 'results',
        isComputing: false,
      })

      // Fetch the strategy (intelligence layer) — non-blocking but tracked
      set({ strategyLoading: true, strategyError: false, strategy: null })
      fetch('/api/strategy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: mobilityState, intent, asOfDate: get().asOfDate ?? undefined }),
      })
        .then((r) => r.ok ? r.json() : null)
        .then((d) => {
          if (d?.strategy) {
            set({ strategy: d.strategy as Strategy, strategyLoading: false })
          } else {
            set({ strategyLoading: false, strategyError: true })
          }
        })
        .catch(() => { set({ strategyLoading: false, strategyError: true }) })
    } catch (e) {
      set({ error: 'Could not build your mobility plan.', phase: 'results', isComputing: false })
    }
  },

  runCounterfactual: async (spec) => {
    const { mobilityState, intent } = get()
    if (!mobilityState || !intent) return
    try {
      const res = await fetch('/api/mobility/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: mobilityState, intent, modification: spec }),
      })
      if (!res.ok) throw new Error('Simulation failed')
      const data = await res.json()
      const result = data.scenario as ScenarioResult
      set((s) => ({
        scenarios: [...s.scenarios.filter((x) => x.id !== result.id), result],
      }))
    } catch (e) {
      console.error('counterfactual', e)
    }
  },

  setActiveRoute: (id) => set({ activeRouteId: id }),

  setAsOfDate: (d) => set({ asOfDate: d }),

  reset: () =>
    set({
      phase: 'home',
      rawIntent: '',
      intent: null,
      intentSource: null,
      mobilityState: null,
      plan: null,
      narrative: null,
      evidence: [],
      strategy: null,
      activeRouteId: null,
      scenarios: [],
      error: null,
      isComputing: false,
      strategyLoading: false,
      strategyError: false,
      asOfDate: null,
    }),
}))
