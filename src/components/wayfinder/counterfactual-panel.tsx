'use client'

import { useState } from 'react'
import type { ScenarioResult, Route } from '@/lib/domain/types'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Play, TrendingUp, TrendingDown, Minus, FlaskConical, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { defaultScenarios } from '@/lib/engine/simulate'
import type { MobilityState, Intent } from '@/lib/domain/types'

const SCORE_LABEL: Record<string, string> = {
  economicUpside: 'Income',
  immigrationProbability: 'Probability',
  speed: 'Speed',
  affordability: 'Affordability',
  longTermResidence: 'Residence',
  citizenshipProspect: 'Citizenship',
  familyUtility: 'Family',
  mobilityUpside: 'Mobility',
  optionality: 'Optionality',
  reversibility: 'Reversible',
  riskAdjusted: 'Risk-adj',
}

export function CounterfactualPanel({
  state,
  intent,
  scenarios,
  routes,
  onRun,
}: {
  state: MobilityState
  intent: Intent
  scenarios: ScenarioResult[]
  routes: Route[]
  onRun: (specId: string) => Promise<void>
}) {
  const specs = defaultScenarios(state)
  const [running, setRunning] = useState<string | null>(null)

  const handleRun = async (specId: string) => {
    setRunning(specId)
    await onRun(specId)
    setRunning(null)
  }

  const routeLabel = (id: string) => routes.find((r) => r.id === id)?.label ?? id

  return (
    <div>
      <p className="mb-3 text-sm text-muted-foreground">
        Simulate a change to your situation. The deterministic engine recomputes every route and
        reports what shifts on the frontier. Nothing here is an LLM guess.
      </p>

      <div className="mb-4 flex flex-wrap gap-2">
        {specs.map((spec) => {
          const result = scenarios.find((s) => s.id === spec.id)
          const isRunning = running === spec.id
          return (
            <Button
              key={spec.id}
              variant={result ? 'default' : 'outline'}
              size="sm"
              disabled={isRunning}
              onClick={() => handleRun(spec.id)}
              className="gap-1.5 text-xs"
            >
              {isRunning ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
              {spec.label}
            </Button>
          )
        })}
      </div>

      <ScrollArea className="wf-scroll max-h-[26rem] pr-3">
        <div className="space-y-3">
          {scenarios.length === 0 && (
            <div className="rounded-lg border border-dashed border-border/60 p-6 text-center text-sm text-muted-foreground">
              <FlaskConical className="mx-auto mb-2 h-5 w-5 opacity-50" />
              Run a scenario above to see how your routes change.
            </div>
          )}
          {scenarios.map((sc) => {
            const deltas = Object.entries(sc.scoreDelta) as [string, number][]
            const hasImprovement = deltas.some(([, v]) => v > 0)
            const hasRegression = deltas.some(([, v]) => v < 0)
            return (
              <Card key={sc.id} className="border-border/60 bg-card/60 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">{sc.label}</p>
                    <p className="text-xs text-muted-foreground">{sc.deltaDescription}</p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    {hasImprovement && <TrendingUp className="h-4 w-4 text-emerald-500" />}
                    {hasRegression && <TrendingDown className="h-4 w-4 text-destructive" />}
                    {!hasImprovement && !hasRegression && <Minus className="h-4 w-4 text-muted-foreground" />}
                  </div>
                </div>
                <p className="mt-2 text-xs text-foreground/80">{sc.summary}</p>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] text-muted-foreground">Best route →</span>
                  <Badge variant="secondary" className="text-[10px] font-normal">{routeLabel(sc.bestRouteId)}</Badge>
                  {sc.newlyEligibleRouteIds.length > 0 && (
                    <Badge className="gap-1 bg-emerald-500/15 text-[10px] font-normal text-emerald-700 dark:text-emerald-400">
                      +{sc.newlyEligibleRouteIds.length} newly eligible
                    </Badge>
                  )}
                  {sc.newlyBlockedRouteIds.length > 0 && (
                    <Badge className="gap-1 bg-destructive/15 text-[10px] font-normal text-destructive">
                      −{sc.newlyBlockedRouteIds.length} blocked
                    </Badge>
                  )}
                </div>
                {deltas.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {deltas.map(([k, v]) => (
                      <span
                        key={k}
                        className={cn(
                          'rounded px-1.5 py-0.5 text-[10px] font-medium',
                          v > 0 ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' : 'bg-destructive/10 text-destructive',
                        )}
                      >
                        {SCORE_LABEL[k] ?? k} {v > 0 ? '+' : ''}{v}
                      </span>
                    ))}
                  </div>
                )}
              </Card>
            )
          })}
        </div>
      </ScrollArea>
    </div>
  )
}
