'use client'

// Wayfinder — Action Plan Section
//
// "What to do next" — takes an ActionPlan and groups actions by timeframe
// (7_DAYS, 30_DAYS, 90_DAYS, 6_MONTHS, ONGOING). Each action shows:
//   - Title + description
//   - Impact bar (0–100%)
//   - Time-sensitive badge if applicable
//   - Estimated cost
//   - Which blocker it addresses (resolved via the optional blockers map)
//   - The highest-leverage action is highlighted
//
// ActionPlan / Action come from '@/lib/strategy/types'.

import {
  Card,
} from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Zap, Clock, DollarSign, Lock, ArrowUpRight, Calendar, CheckCircle2,
  Flame, AlertTriangle, Link2, Target, Sparkles, ListChecks, ArrowRight,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type {
  ActionPlan,
  Action,
  ActionTimeframe,
  BlockerAnalysis,
} from '@/lib/strategy/types'

// ---------------------------------------------------------------------------
// Timeframe metadata
// ---------------------------------------------------------------------------

type IconType = React.ComponentType<{ className?: string }>

const TIMEFRAME_ORDER: ActionTimeframe[] = ['7_DAYS', '30_DAYS', '90_DAYS', '6_MONTHS', 'ONGOING']

const TIMEFRAME_META: Record<ActionTimeframe, { label: string; sublabel: string; cls: string; Icon: IconType }> = {
  '7_DAYS': {
    label: 'This week',
    sublabel: '7 days',
    cls: 'border-emerald-500/40 text-emerald-700 dark:text-emerald-400 bg-emerald-500/5',
    Icon: Flame,
  },
  '30_DAYS': {
    label: 'This month',
    sublabel: '30 days',
    cls: 'border-blue-500/40 text-blue-700 dark:text-blue-300 bg-blue-500/5',
    Icon: Calendar,
  },
  '90_DAYS': {
    label: 'This quarter',
    sublabel: '90 days',
    cls: 'border-amber-500/40 text-amber-700 dark:text-amber-400 bg-amber-500/5',
    Icon: Calendar,
  },
  '6_MONTHS': {
    label: 'Next 6 months',
    sublabel: '6 months',
    cls: 'border-orange-500/40 text-orange-700 dark:text-orange-400 bg-orange-500/5',
    Icon: Calendar,
  },
  'ONGOING': {
    label: 'Ongoing',
    sublabel: 'continuous',
    cls: 'border-muted-foreground/40 text-muted-foreground bg-muted/20',
    Icon: ArrowRight,
  },
}

// ---------------------------------------------------------------------------
// Format helpers
// ---------------------------------------------------------------------------

function formatUsd(n?: number): string {
  if (n == null || !Number.isFinite(n)) return '—'
  if (n === 0) return 'Free'
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`
  return `$${n.toLocaleString()}`
}

function impactTone(pct: number): string {
  if (pct >= 75) return 'bg-emerald-500'
  if (pct >= 50) return 'bg-primary'
  if (pct >= 25) return 'bg-amber-500'
  return 'bg-muted-foreground/60'
}

function impactLabel(pct: number): string {
  if (pct >= 75) return 'High impact'
  if (pct >= 50) return 'Medium impact'
  if (pct >= 25) return 'Low impact'
  return 'Marginal'
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface ActionPlanSectionProps {
  plan: ActionPlan
  /** Optional list of blockers so each action can show what it addresses. */
  blockers?: BlockerAnalysis[]
  className?: string
}

export function ActionPlanSection({ plan, blockers, className }: ActionPlanSectionProps) {
  if (!plan) {
    return <ActionPlanSectionSkeleton className={className} />
  }

  const actions = plan.actions ?? []
  const highestLeverageId = plan.highestLeverageAction?.id

  // Group actions by timeframe, preserving the canonical order.
  const groups: { timeframe: ActionTimeframe; items: Action[] }[] = TIMEFRAME_ORDER
    .map((tf) => ({ timeframe: tf, items: actions.filter((a) => a.timeframe === tf) }))
    .filter((g) => g.items.length > 0)

  // Capture any actions whose timeframe isn't in our canonical set.
  const knownTimeframes = new Set<ActionTimeframe>(TIMEFRAME_ORDER)
  const others = actions.filter((a) => !knownTimeframes.has(a.timeframe))
  if (others.length > 0) {
    groups.push({ timeframe: 'ONGOING', items: others })
  }

  const blockerMap = new Map<string, BlockerAnalysis>()
  for (const b of blockers ?? []) blockerMap.set(b.blockerId, b)

  return (
    <Card
      className={cn(
        'wf-panel border-border/60 bg-card/60 p-4 sm:p-5',
        className,
      )}
    >
      {/* Header */}
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/15 text-primary">
            <Zap className="h-4 w-4" />
          </span>
          <div>
            <h3 className="text-sm font-semibold leading-tight">What to do next</h3>
            <p className="text-[11px] text-muted-foreground">
              {plan.summary || `${actions.length} action${actions.length === 1 ? '' : 's'} sequenced by impact and time sensitivity.`}
            </p>
          </div>
        </div>
        {highestLeverageId && (
          <Badge
            variant="outline"
            className="gap-1 border-amber-500/40 bg-amber-500/5 text-[10px] font-medium text-amber-700 dark:text-amber-400"
          >
            <Sparkles className="h-2.5 w-2.5" />
            1 highest-leverage
          </Badge>
        )}
      </div>

      {/* Body */}
      {actions.length === 0 ? (
        <EmptyState />
      ) : groups.length === 0 ? (
        <EmptyState />
      ) : (
        <ScrollArea className="wf-scroll max-h-[42rem] pr-3">
          <div className="space-y-4">
            {groups.map((group) => {
              const meta = TIMEFRAME_META[group.timeframe] ?? TIMEFRAME_META.ONGOING
              return (
                <div key={group.timeframe}>
                  {/* Timeframe header */}
                  <div className="mb-2 flex items-center gap-2">
                    <span
                      className={cn(
                        'inline-flex h-5 items-center gap-1 rounded-md border px-1.5 text-[10px] font-semibold uppercase tracking-wider',
                        meta.cls,
                      )}
                    >
                      <meta.Icon className="h-2.5 w-2.5" />
                      {meta.label}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {group.items.length} action{group.items.length === 1 ? '' : 's'}
                    </span>
                    <div className="h-px flex-1 bg-border/40" />
                  </div>

                  {/* Action cards */}
                  <div className="space-y-2">
                    {group.items.map((a) => (
                      <ActionCard
                        key={a.id}
                        action={a}
                        isHighestLeverage={a.id === highestLeverageId}
                        blockerMap={blockerMap}
                      />
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </ScrollArea>
      )}
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ActionCard({
  action,
  isHighestLeverage,
  blockerMap,
}: {
  action: Action
  isHighestLeverage: boolean
  blockerMap: Map<string, BlockerAnalysis>
}) {
  const pct = Math.max(0, Math.min(100, Math.round((action.impact ?? 0) * 100)))
  const addressedBlocker = action.addressesBlockerId
    ? blockerMap.get(action.addressesBlockerId)
    : undefined

  return (
    <div
      className={cn(
        'rounded-xl border p-3 transition-colors',
        isHighestLeverage
          ? 'border-amber-500/50 bg-amber-500/[0.05] ring-1 ring-amber-500/20'
          : 'border-border/60 bg-card/50 hover:bg-card',
      )}
    >
      {/* Title row */}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2">
          {isHighestLeverage && (
            <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400">
              <Sparkles className="h-3 w-3" />
            </span>
          )}
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-sm font-semibold leading-tight">
              {action.title}
              {isHighestLeverage && (
                <span className="rounded bg-amber-500/15 px-1 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400">
                  Highest leverage
                </span>
              )}
            </p>
            {action.description && (
              <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                {action.description}
              </p>
            )}
          </div>
        </div>
        {action.timeSensitive && (
          <Badge
            variant="outline"
            className="shrink-0 gap-1 border-destructive/40 bg-destructive/5 text-[9px] font-medium text-destructive"
          >
            <AlertTriangle className="h-2.5 w-2.5" />
            Time-sensitive
          </Badge>
        )}
      </div>

      {/* Impact bar */}
      <div className="mt-2.5">
        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <Target className="h-2.5 w-2.5" />
            Impact on viability
          </span>
          <span className="font-medium text-foreground/80">{impactLabel(pct)} · {pct}%</span>
        </div>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className={cn('h-full rounded-full transition-all', impactTone(pct))}
            style={{ width: `${Math.max(2, pct)}%` }}
          />
        </div>
      </div>

      {/* Meta strip */}
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-border/40 pt-2">
        {action.estimatedCostUSD != null && (
          <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
            <DollarSign className="h-2.5 w-2.5" />
            {formatUsd(action.estimatedCostUSD)}
          </span>
        )}
        {addressedBlocker && (
          <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
            <Link2 className="h-2.5 w-2.5" />
            Addresses:{' '}
            <span className="font-medium text-foreground/80">{addressedBlocker.label}</span>
          </span>
        )}
        {action.trajectoryStep != null && (
          <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
            <ArrowUpRight className="h-2.5 w-2.5" />
            Step {action.trajectoryStep}
          </span>
        )}
        {action.reversible && (
          <Badge variant="outline" className="gap-1 text-[9px] font-normal border-emerald-500/30 text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="h-2 w-2" /> Reversible
          </Badge>
        )}
        {action.dependsOn && action.dependsOn.length > 0 && (
          <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
            <Lock className="h-2.5 w-2.5" />
            Depends on {action.dependsOn.length}
          </span>
        )}
      </div>
    </div>
  )
}

function EmptyState() {
  return (
    <div className="rounded-lg border border-dashed border-border/60 bg-background/30 px-4 py-8 text-center">
      <div className="mx-auto mb-2 flex h-9 w-9 items-center justify-center rounded-full bg-muted/50">
        <ListChecks className="h-4 w-4 text-muted-foreground" />
      </div>
      <p className="text-sm font-medium">No actions to take</p>
      <p className="mx-auto mt-1 max-w-xs text-xs text-muted-foreground">
        Your trajectory is executable today — no blockers to resolve, no
        sequencing required.
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

export function ActionPlanSectionSkeleton({ className }: { className?: string }) {
  return (
    <Card className={cn('wf-panel border-border/60 bg-card/60 p-4', className)}>
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 animate-pulse rounded-lg bg-muted" />
          <div>
            <div className="h-3.5 w-28 animate-pulse rounded bg-muted" />
            <div className="mt-1 h-2.5 w-44 animate-pulse rounded bg-muted" />
          </div>
        </div>
        <div className="h-4 w-24 animate-pulse rounded bg-muted" />
      </div>
      <div className="space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i}>
            <div className="mb-2 flex items-center gap-2">
              <div className="h-5 w-20 animate-pulse rounded bg-muted" />
              <div className="h-px flex-1 bg-border/40" />
            </div>
            <div className="space-y-2">
              {Array.from({ length: 2 }).map((__, j) => (
                <div key={j} className="rounded-xl border border-border/60 bg-card/50 p-3">
                  <div className="h-3.5 w-48 animate-pulse rounded bg-muted" />
                  <div className="mt-2 h-2.5 w-72 animate-pulse rounded bg-muted" />
                  <div className="mt-2.5 h-1.5 w-full animate-pulse rounded bg-muted" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Card>
  )
}

export default ActionPlanSection
