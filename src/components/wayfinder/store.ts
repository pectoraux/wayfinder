'use client'

import { create } from 'zustand'
import type { Intent, MobilityPlan, MobilityState, Evidence, Preference } from '@/lib/domain/types'
import { exampleState } from '@/lib/domain/state'
import type { PlanNarrative } from '@/lib/ai/explanation'
import type { ScenarioResult, ScenarioSpec } from '@/lib/engine/simulate'
import type { Strategy } from '@/lib/strategy/types'
import type { StalenessAssessment } from '@/lib/strategy/staleness'
import type { StrategyProvenance } from '@/lib/strategy/types'

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
  activeObjective: string | null // the objective the user has adopted
  exploredObjective: string | null // an objective being previewed (not yet adopted)
  exploredStrategy: Strategy | null // the strategy computed for the explored objective
  // Strategy provenance + staleness — surfaced from GET /api/strategy/adopt
  activeRecordId: string | null
  strategyProvenance: StrategyProvenance | null
  strategyStaleness: StalenessAssessment | null

  setPhase: (p: Phase) => void
  setRawIntent: (s: string) => void
  submitIntent: () => Promise<void>
  setMobilityState: (s: MobilityState) => void
  loadExample: () => void
  computePlan: () => Promise<void>
  runCounterfactual: (spec: ScenarioSpec) => Promise<void>
  setActiveRoute: (id: string) => void
  setAsOfDate: (d: string | null) => void
  answerPreference: (questionId: string, answer: string) => Promise<void>
  syncActions: () => Promise<void>
  updateActionStatus: (actionId: string, status: string, stateChange?: { field: string; newValue: unknown; updatedState: MobilityState }) => Promise<void>
  recomputeStrategy: () => Promise<void>
  exploreObjective: (objective: string) => Promise<void>
  adoptStrategy: (objective: string) => Promise<void>
  clearExplored: () => void
  loadActiveStrategy: () => Promise<void>
  updateProfile: (updates: Record<string, unknown>) => Promise<void>
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
  activeObjective: null,
  exploredObjective: null,
  exploredStrategy: null,
  activeRecordId: null,
  strategyProvenance: null,
  strategyStaleness: null,

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
            // Sync actions to the DB (non-blocking)
            get().syncActions()
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

  answerPreference: async (questionId, answer) => {
    const { mobilityState, intent, asOfDate } = get()
    if (!mobilityState || !intent) return
    set({ strategyLoading: true, strategyError: false })
    try {
      const res = await fetch('/api/strategy/preferences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          questionId, answer,
          currentIntent: intent,
          state: mobilityState,
          asOfDate: asOfDate ?? undefined,
        }),
      })
      if (!res.ok) throw new Error('Preference update failed')
      const data = await res.json()
      // Update intent + strategy in the store
      set({
        intent: data.updatedIntent,
        strategy: data.strategy,
        strategyLoading: false,
      })
    } catch {
      set({ strategyLoading: false, strategyError: true })
    }
  },

  syncActions: async () => {
    const { strategy } = get()
    if (!strategy?.actionPlan) return
    try {
      await fetch('/api/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actionPlan: strategy.actionPlan,
          strategyEngineVersion: strategy.strategyEngineVersion,
          runtimePolicyHash: strategy.policyContext?.runtimeHash,
        }),
      })
    } catch { /* non-blocking */ }
  },

  updateActionStatus: async (actionId, status, stateChange) => {
    try {
      const res = await fetch(`/api/actions/${actionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status,
          stateChange: stateChange ? {
            field: stateChange.field,
            oldValue: null,
            newValue: stateChange.newValue,
            updatedState: stateChange.updatedState,
          } : undefined,
        }),
      })
      if (!res.ok) return
      const data = await res.json()
      // If the action changed the user's state, recompute strategy
      if (data.stateChanged && stateChange?.updatedState) {
        set({ mobilityState: stateChange.updatedState })
        await get().recomputeStrategy()
      }
    } catch (e) {
      console.error('updateActionStatus', e)
    }
  },

  recomputeStrategy: async () => {
    const { mobilityState, intent, asOfDate } = get()
    if (!mobilityState || !intent) return
    set({ strategyLoading: true, strategyError: false })
    try {
      const res = await fetch('/api/strategy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: mobilityState, intent, asOfDate: asOfDate ?? undefined }),
      })
      if (!res.ok) throw new Error('Strategy recompute failed')
      const data = await res.json()
      set({ strategy: data.strategy, strategyLoading: false })
      // Sync actions from the new strategy
      await get().syncActions()
    } catch {
      set({ strategyLoading: false, strategyError: true })
    }
  },

  exploreObjective: async (objective) => {
    const { mobilityState, intent, asOfDate, strategy } = get()
    if (!mobilityState || !intent) return

    // If the explored objective matches the current active objective, just clear
    if (strategy && get().activeObjective === objective) {
      set({ exploredObjective: null, exploredStrategy: null })
      return
    }

    // Find the objective's priorities from the strategy's intent frontier
    const frontierPoint = strategy?.intentFrontier?.points?.find((p) => p.objective === objective)
    if (!frontierPoint) return

    // Build an intent with the explored objective's priorities
    const OBJECTIVE_PRIORITIES: Record<string, Preference[]> = {
      income: [{ kind: 'income_priority', weight: 0.5 }, { kind: 'mobility_priority', weight: 0.2 }, { kind: 'safety_priority', weight: 0.1 }],
      residence: [{ kind: 'safety_priority', weight: 0.3 }, { kind: 'citizenship_priority', weight: 0.2 }, { kind: 'family_stability', weight: 0.2 }],
      citizenship: [{ kind: 'citizenship_priority', weight: 0.5 }, { kind: 'mobility_priority', weight: 0.2 }],
      entrepreneurship: [{ kind: 'entrepreneurship', weight: 0.4 }, { kind: 'mobility_priority', weight: 0.2 }, { kind: 'income_priority', weight: 0.15 }],
      mobility: [{ kind: 'mobility_priority', weight: 0.4 }, { kind: 'citizenship_priority', weight: 0.25 }],
      cost: [{ kind: 'income_priority', weight: 0.1 }, { kind: 'safety_priority', weight: 0.15 }],
    }
    const exploredPriorities = OBJECTIVE_PRIORITIES[objective] ?? intent.priorities
    const exploredIntent: Intent = { ...intent, priorities: exploredPriorities }

    set({ exploredObjective: objective, strategyLoading: true })
    try {
      const res = await fetch('/api/strategy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: mobilityState, intent: exploredIntent, asOfDate: asOfDate ?? undefined }),
      })
      if (!res.ok) throw new Error('Explore failed')
      const data = await res.json()
      set({ exploredStrategy: data.strategy, strategyLoading: false })
    } catch {
      set({ strategyLoading: false, exploredObjective: null, exploredStrategy: null })
    }
  },

  adoptStrategy: async (objective) => {
    const { mobilityState, intent, asOfDate, exploredStrategy, strategy: currentStrategy, plan } = get()
    if (!mobilityState || !intent) return

    // Build the adopted intent with the new objective's priorities
    const OBJECTIVE_PRIORITIES: Record<string, Preference[]> = {
      income: [{ kind: 'income_priority', weight: 0.5 }, { kind: 'mobility_priority', weight: 0.2 }, { kind: 'safety_priority', weight: 0.1 }],
      residence: [{ kind: 'safety_priority', weight: 0.3 }, { kind: 'citizenship_priority', weight: 0.2 }, { kind: 'family_stability', weight: 0.2 }],
      citizenship: [{ kind: 'citizenship_priority', weight: 0.5 }, { kind: 'mobility_priority', weight: 0.2 }],
      entrepreneurship: [{ kind: 'entrepreneurship', weight: 0.4 }, { kind: 'mobility_priority', weight: 0.2 }, { kind: 'income_priority', weight: 0.15 }],
      mobility: [{ kind: 'mobility_priority', weight: 0.4 }, { kind: 'citizenship_priority', weight: 0.25 }],
      cost: [{ kind: 'income_priority', weight: 0.1 }, { kind: 'safety_priority', weight: 0.15 }],
    }
    const adoptedPriorities = OBJECTIVE_PRIORITIES[objective] ?? intent.priorities
    const adoptedIntent: Intent = { ...intent, priorities: adoptedPriorities }

    // Use the explored strategy if available
    const newStrategy = exploredStrategy ?? currentStrategy
    if (!newStrategy) return

    // Update client state immediately
    set({
      strategy: newStrategy,
      intent: adoptedIntent,
      activeObjective: objective,
      exploredObjective: null,
      exploredStrategy: null,
    })
    await get().syncActions()

    // Persist to the DB (non-blocking), then reload the active strategy so the
    // structured staleness + provenance are surfaced from the server.
    try {
      const res = await fetch('/api/strategy/adopt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          strategy: newStrategy,
          plan: plan ?? undefined,
          objectiveId: objective,
          state: mobilityState,
          intent: adoptedIntent,
        }),
      })
      if (res.ok) {
        const data = await res.json()
        if (data?.provenance) {
          set({
            activeRecordId: data.recordId ?? null,
            strategyProvenance: data.provenance ?? null,
            // A freshly-adopted strategy is always CURRENT — clear any stale banner.
            strategyStaleness: null,
          })
        }
      }
    } catch { /* non-blocking */ }
  },

  clearExplored: () => set({ exploredObjective: null, exploredStrategy: null }),

  loadActiveStrategy: async () => {
    try {
      const res = await fetch('/api/strategy/adopt')
      if (!res.ok) return
      const data = await res.json()
      if (data?.strategy) {
        set({
          strategy: data.strategy as Strategy,
          activeObjective: data.objectiveId ?? null,
          activeRecordId: data.recordId ?? null,
          strategyProvenance: data.provenance ?? null,
          strategyStaleness: data.staleness ?? null,
        })
      }
    } catch { /* non-blocking */ }
  },

  updateProfile: async (updates) => {
    const { mobilityState } = get()
    if (!mobilityState) return
    try {
      const res = await fetch('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // currentState is a FALLBACK for the first-ever profile. The server
        // uses its authoritative latest snapshot as the base for all
        // subsequent updates — it does NOT trust this client state blindly.
        body: JSON.stringify({ updates, currentState: mobilityState }),
      })
      if (res.status === 409) {
        // Concurrent update — reload the server-authoritative state and retry once.
        await get().loadActiveStrategy()
        return
      }
      if (!res.ok) return
      const data = await res.json()
      if (data?.updatedState) {
        set({ mobilityState: data.updatedState })
        await get().recomputeStrategy()
        // After a profile change, the previously-adopted strategy is now
        // STALE_PROFILE (at minimum). Reload the active-strategy endpoint to
        // surface the structured staleness banner.
        await get().loadActiveStrategy()
      }
    } catch (e) {
      console.error('updateProfile', e)
    }
  },

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
      activeObjective: null,
      exploredObjective: null,
      exploredStrategy: null,
      activeRecordId: null,
      strategyProvenance: null,
      strategyStaleness: null,
    }),
}))
