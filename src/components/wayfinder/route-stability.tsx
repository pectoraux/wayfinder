'use client'

import { useEffect, useState } from 'react'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from '@/components/ui/collapsible'
import {
  ShieldCheck,
  TrendingUp,
  TrendingDown,
  Activity,
  ChevronDown,
  Loader2,
  AlertTriangle,
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface StabilityChange {
  date: string
  description?: string
  status?: string
}

interface StabilityResponse {
  routeId: string
  pathwayId: string
  materialChanges24Months: number
  stabilityLabel: string
  hasInsufficientHistory: boolean
  changes: StabilityChange[]
  disclaimer: string
}

interface RouteStabilityProps {
  routeId: string
  className?: string
}

/**
 * Calm, compact policy-stability widget for a route.
 * Fetches GET /api/route-stability?routeId=... and renders:
 *   - "Policy stability" header
 *   - label (Stable / Low / Moderate / High volatility)
 *   - count of material changes in the past 24 months
 *   - expandable "Recent policy history" list
 *   - disclaimer: historical indicator only — not a prediction
 * If insufficient history exists, shows "Not enough historical policy data."
 */
export function RouteStability({ routeId, className }: RouteStabilityProps) {
  const [data, setData] = useState<StabilityResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!routeId) return
    let cancelled = false
    // Defer the synchronous state reset to a microtask so we don't trigger a
    // cascading render inside the effect body.
    Promise.resolve().then(() => {
      if (!cancelled) {
        setLoading(true)
        setError(null)
      }
    })
    fetch(`/api/route-stability?routeId=${encodeURIComponent(routeId)}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json() as Promise<StabilityResponse>
      })
      .then((d) => {
        if (!cancelled) setData(d)
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [routeId])

  return (
    <Card
      className={cn(
        'border-border/60 bg-card/70 p-4 wf-panel',
        className,
      )}
    >
      {/* header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Activity className="h-3.5 w-3.5 text-primary" />
          <h4 className="text-xs font-semibold tracking-wide text-foreground/90">
            Policy stability
          </h4>
        </div>
        {loading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
      </div>

      {/* body */}
      <div className="mt-2.5">
        {error ? (
          <div className="flex items-center gap-1.5 text-[11px] text-destructive">
            <AlertTriangle className="h-3 w-3" />
            <span>Couldn&apos;t load stability data.</span>
          </div>
        ) : loading ? (
          <div className="space-y-1.5">
            <div className="h-3.5 w-32 animate-pulse rounded bg-muted" />
            <div className="h-3 w-48 animate-pulse rounded bg-muted/70" />
          </div>
        ) : data?.hasInsufficientHistory ? (
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <ShieldCheck className="h-3 w-3 text-emerald-500" />
            <span>Not enough historical policy data.</span>
          </div>
        ) : data ? (
          <StabilityBody data={data} open={open} onOpenChange={setOpen} />
        ) : null}
      </div>

      {/* disclaimer — always visible when we have a meaningful result */}
      {!loading && !error && data && !data.hasInsufficientHistory && (
        <p className="mt-3 border-t border-border/50 pt-2 text-[10px] italic text-muted-foreground">
          Historical indicator only — not a prediction.
        </p>
      )}
    </Card>
  )
}

function StabilityBody({
  data,
  open,
  onOpenChange,
}: {
  data: StabilityResponse
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const tone = stabilityTone(data.stabilityLabel)
  const Icon = tone.icon
  const count = data.materialChanges24Months

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge
          variant="outline"
          className={cn('gap-1 text-[10px] font-medium', tone.cls)}
        >
          <Icon className="h-2.5 w-2.5" />
          {data.stabilityLabel}
        </Badge>
        <span className="text-[11px] text-muted-foreground">
          {count === 0
            ? 'No material changes'
            : `${count} material ${count === 1 ? 'change' : 'changes'}`}
          {' '}in 24 months
        </span>
      </div>

      {/* expandable recent history */}
      {data.changes.length > 0 && (
        <Collapsible open={open} onOpenChange={onOpenChange}>
          <CollapsibleTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 gap-1 px-1.5 text-[11px] text-muted-foreground hover:text-foreground"
            >
              <ChevronDown
                className={cn(
                  'h-3 w-3 transition-transform',
                  open && 'rotate-180',
                )}
              />
              {open ? 'Hide' : 'View'} recent policy history
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <ScrollArea className="wf-scroll max-h-44 pr-2">
              <ol className="mt-1.5 space-y-1.5">
                {data.changes.map((c, i) => (
                  <li
                    key={`${c.date}-${i}`}
                    className="rounded-md border border-border/50 bg-background/40 px-2 py-1.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] font-medium tabular-nums text-muted-foreground">
                        {c.date}
                      </span>
                      {c.status && (
                        <Badge
                          variant="outline"
                          className="h-3.5 px-1 text-[9px] font-normal capitalize"
                        >
                          {c.status.toLowerCase()}
                        </Badge>
                      )}
                    </div>
                    {c.description && (
                      <p className="mt-0.5 text-[11px] leading-snug text-foreground/80">
                        {c.description}
                      </p>
                    )}
                  </li>
                ))}
              </ol>
            </ScrollArea>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  )
}

function stabilityTone(label: string): {
  cls: string
  icon: typeof ShieldCheck
} {
  const l = label.toLowerCase()
  if (l.startsWith('stable')) {
    return {
      cls: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
      icon: ShieldCheck,
    }
  }
  if (l.startsWith('low')) {
    return {
      cls: 'border-primary/40 bg-primary/10 text-primary',
      icon: TrendingUp,
    }
  }
  if (l.startsWith('moderate')) {
    return {
      cls: 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400',
      icon: TrendingDown,
    }
  }
  // high volatility
  return {
    cls: 'border-destructive/40 bg-destructive/10 text-destructive',
    icon: AlertTriangle,
  }
}
