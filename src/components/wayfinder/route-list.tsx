'use client'

import type { Route } from '@/lib/domain/types'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Crown, Lock, AlertCircle, CheckCircle2, Clock, DollarSign } from 'lucide-react'
import { cn } from '@/lib/utils'

const STATUS_STYLE: Record<Route['eligibility']['status'], { label: string; cls: string; Icon: React.ComponentType<{ className?: string }> }> = {
  eligible: { label: 'Eligible', cls: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400', Icon: CheckCircle2 },
  conditional: { label: 'Conditional', cls: 'bg-amber-500/15 text-amber-700 dark:text-amber-400', Icon: AlertCircle },
  ineligible: { label: 'Blocked', cls: 'bg-destructive/15 text-destructive', Icon: Lock },
}

const COUNTRY_FLAG: Record<string, string> = {
  DE: '🇩🇪', PT: '🇵🇹', CA: '🇨🇦', EE: '🇪🇪', UK: '🇬🇧', AE: '🇦🇪', KE: '🇰🇪',
}

export function RouteList({
  routes,
  activeRouteId,
  bestRouteId,
  onSelect,
}: {
  routes: Route[]
  activeRouteId: string | null
  bestRouteId: string
  onSelect: (id: string) => void
}) {
  return (
    <ScrollArea className="wf-scroll max-h-[40rem] pr-2">
      <div className="space-y-2">
        {routes.map((r) => {
          const st = STATUS_STYLE[r.eligibility.status]
          const isActive = r.id === activeRouteId
          const isBest = r.id === bestRouteId
          return (
            <button
              key={r.id}
              onClick={() => onSelect(r.id)}
              className={cn(
                'w-full rounded-xl border p-3 text-left transition-all',
                isActive
                  ? 'border-primary bg-primary/5 ring-1 ring-primary/20'
                  : 'border-border/60 bg-card/50 hover:border-border hover:bg-card',
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="text-lg leading-none">{COUNTRY_FLAG[r.countryCode] ?? '🏳️'}</span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{r.countryName}</p>
                    <p className="truncate text-xs text-muted-foreground">{r.steps[1]?.status ?? r.label.split('·')[1]?.trim()}</p>
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  {isBest && (
                    <Badge className="gap-1 bg-primary/15 text-[10px] font-medium text-primary">
                      <Crown className="h-2.5 w-2.5" /> Best
                    </Badge>
                  )}
                  {r.paretoOptimal && !isBest && (
                    <Badge variant="outline" className="text-[10px] font-normal text-primary">Pareto</Badge>
                  )}
                </div>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <Badge variant="outline" className={cn('gap-1 text-[10px] font-normal', st.cls)}>
                  <st.Icon className="h-2.5 w-2.5" />
                  {st.label}
                </Badge>
                <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                  <Clock className="h-2.5 w-2.5" /> {Math.round(r.totalMonths / 12)}y to goal
                </span>
                <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                  <DollarSign className="h-2.5 w-2.5" /> {r.totalCostUSD >= 1000 ? `${(r.totalCostUSD / 1000).toFixed(1)}k` : r.totalCostUSD}
                </span>
                {r.eligibility.blockers.length > 0 && (
                  <span className="text-[10px] text-destructive/80">
                    {r.eligibility.blockers.length} blocker{r.eligibility.blockers.length > 1 ? 's' : ''}
                  </span>
                )}
              </div>

              {/* mini score bars */}
              <div className="mt-2 flex gap-1">
                {(['economicUpside', 'immigrationProbability', 'citizenshipProspect'] as const).map((k) => (
                  <div key={k} className="flex-1">
                    <div className="h-1 overflow-hidden rounded-full bg-muted">
                      <div
                        className={cn('h-full rounded-full', isActive ? 'bg-primary' : 'bg-primary/50')}
                        style={{ width: `${r.scores[k]}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </button>
          )
        })}
      </div>
    </ScrollArea>
  )
}
