'use client'

// Wayfinder — Intent Frontier Section
//
// "Other ways you could optimize" — for each objective in the IntentFrontier,
// render a card showing the objective label, the best trajectory for that
// objective, cost / time / risk / optionality. The user's stated objective
// is highlighted. Alternative intents (from the strategy's
// alternativeIntents array) are rendered beneath as a secondary block.
//
// IntentFrontier comes from '@/lib/strategy/types'.

import {
  Card,
} from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import {
  Compass, Crown, Clock, DollarSign, ShieldAlert, Network,
  TrendingUp, Flag, Home, Rocket, Globe2, Wallet, Sparkles,
  Target, ArrowRight, CheckCircle2, AlertTriangle, Lightbulb,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type {
  IntentFrontier,
  ObjectiveTrajectory,
} from '@/lib/strategy/types'

// ---------------------------------------------------------------------------
// Objective visual metadata
// ---------------------------------------------------------------------------

type IconType = React.ComponentType<{ className?: string }>

const OBJECTIVE_META: Record<string, { label: string; Icon: IconType; tone: string }> = {
  income: {
    label: 'Maximize income',
    Icon: TrendingUp,
    tone: 'border-emerald-500/40 text-emerald-700 dark:text-emerald-400 bg-emerald-500/5',
  },
  residence: {
    label: 'Best residence trajectory',
    Icon: Home,
    tone: 'border-blue-500/40 text-blue-700 dark:text-blue-300 bg-blue-500/5',
  },
  citizenship: {
    label: 'Fastest citizenship',
    Icon: Flag,
    tone: 'border-amber-500/40 text-amber-700 dark:text-amber-400 bg-amber-500/5',
  },
  entrepreneurship: {
    label: 'Best for founders',
    Icon: Rocket,
    tone: 'border-orange-500/40 text-orange-700 dark:text-orange-400 bg-orange-500/5',
  },
  mobility: {
    label: 'Maximize global mobility',
    Icon: Globe2,
    tone: 'border-primary/40 text-primary bg-primary/5',
  },
  cost: {
    label: 'Lowest cost',
    Icon: Wallet,
    tone: 'border-muted-foreground/40 text-muted-foreground bg-muted/20',
  },
}

function objectiveMeta(objective: string): { label: string; Icon: IconType; tone: string } {
  return (
    OBJECTIVE_META[objective] ?? {
      label: objective.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      Icon: Target,
      tone: 'border-border/60 text-muted-foreground bg-background/40',
    }
  )
}

const RISK_STYLE: Record<string, string> = {
  low: 'border-emerald-500/40 text-emerald-700 dark:text-emerald-400 bg-emerald-500/5',
  medium: 'border-amber-500/40 text-amber-700 dark:text-amber-400 bg-amber-500/5',
  high: 'border-destructive/40 text-destructive bg-destructive/5',
}

// ---------------------------------------------------------------------------
// Format helpers
// ---------------------------------------------------------------------------

function formatUsd(n: number): string {
  if (!Number.isFinite(n)) return '—'
  if (n === 0) return 'Free'
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`
  return `$${n.toLocaleString()}`
}

function formatMonths(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '—'
  if (n < 12) return `${Math.round(n)} mo`
  const y = Math.floor(n / 12)
  const m = Math.round(n % 12)
  return m === 0 ? `${y} yr` : `${y} yr ${m} mo`
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface AlternativeIntent {
  title: string
  rationale: string
  tradeoffs: string[]
  mayBeSuperior: boolean
}

export interface IntentFrontierSectionProps {
  frontier: IntentFrontier
  /** Alternative intents from the strategy (may be omitted). */
  alternativeIntents?: AlternativeIntent[]
  className?: string
}

export function IntentFrontierSection({
  frontier,
  alternativeIntents,
  className,
}: IntentFrontierSectionProps) {
  if (!frontier) {
    return <IntentFrontierSectionSkeleton className={className} />
  }

  const points = frontier.points ?? []
  const distinct = frontier.distinctStrategies ?? []
  const distinctIds = new Set(distinct.map((p) => p.bestTrajectoryId))
  const stated = points.find((p) => p.isStated)

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
            <Compass className="h-4 w-4" />
          </span>
          <div>
            <h3 className="text-sm font-semibold leading-tight">
              Other ways you could optimize
            </h3>
            <p className="text-[11px] text-muted-foreground">
              {points.length === 0
                ? 'No objectives analyzed yet.'
                : `${points.length} objective${points.length === 1 ? '' : 's'} · ${distinct.length} distinct strateg${distinct.length === 1 ? 'y' : 'ies'}`}
            </p>
          </div>
        </div>
        {stated && (
          <Badge
            variant="outline"
            className="gap-1 border-primary/40 bg-primary/5 text-[10px] font-medium text-primary"
          >
            <Crown className="h-2.5 w-2.5" />
            Stated: {objectiveMeta(stated.objective).label}
          </Badge>
        )}
      </div>

      {/* Body */}
      {points.length === 0 ? (
        <EmptyState message="No intent frontier available for this strategy." />
      ) : (
        <>
          {/* Frontier grid */}
          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {points.map((p, i) => (
              <ObjectiveCard
                key={`${p.objective}-${i}`}
                point={p}
                isDistinct={distinctIds.has(p.bestTrajectoryId)}
              />
            ))}
          </div>

          {/* Alternative intents */}
          {alternativeIntents && alternativeIntents.length > 0 && (
            <>
              <Separator className="my-4 bg-border/50" />
              <div>
                <p className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  <Lightbulb className="h-3 w-3" />
                  Alternative intents worth considering
                </p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  Distinct framings of your goal — each may surface a different
                  best trajectory.
                </p>
                <ScrollArea className="wf-scroll mt-3 max-h-[28rem] pr-2">
                  <div className="space-y-2">
                    {alternativeIntents.map((ai, i) => (
                      <AlternativeIntentCard key={i} intent={ai} />
                    ))}
                  </div>
                </ScrollArea>
              </div>
            </>
          )}
        </>
      )}
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ObjectiveCard({
  point,
  isDistinct,
}: {
  point: ObjectiveTrajectory
  isDistinct: boolean
}) {
  const meta = objectiveMeta(point.objective)
  const isStated = point.isStated
  const riskCls = RISK_STYLE[point.risk ?? 'medium'] ?? RISK_STYLE.medium

  return (
    <div
      className={cn(
        'rounded-xl border p-3 transition-colors',
        isStated
          ? 'border-primary/60 bg-primary/[0.05] ring-1 ring-primary/20'
          : isDistinct
            ? 'border-border/60 bg-card/50 hover:bg-card'
            : 'border-border/40 bg-card/30',
      )}
    >
      {/* Objective label */}
      <div className="flex items-start justify-between gap-1.5">
        <Badge
          variant="outline"
          className={cn('gap-1 px-1.5 py-0 text-[10px] font-medium', meta.tone)}
        >
          <meta.Icon className="h-2.5 w-2.5" />
          {meta.label}
        </Badge>
        {isStated && (
          <Badge
            variant="outline"
            className="shrink-0 gap-0.5 border-primary/50 bg-primary/10 px-1 py-0 text-[9px] font-bold uppercase tracking-wider text-primary"
          >
            <Crown className="h-2 w-2" /> Yours
          </Badge>
        )}
      </div>

      {/* Best trajectory */}
      <p className="mt-2 text-[12px] font-semibold leading-tight">
        {point.bestTrajectoryLabel || '—'}
      </p>

      {/* Metric grid */}
      <div className="mt-2.5 grid grid-cols-2 gap-1.5">
        <Metric
          icon={<DollarSign className="h-2.5 w-2.5" />}
          label="Cost"
          value={formatUsd(point.cost)}
        />
        <Metric
          icon={<Clock className="h-2.5 w-2.5" />}
          label="Time"
          value={formatMonths(point.timeMonths)}
        />
        <Metric
          icon={<Network className="h-2.5 w-2.5" />}
          label="Optionality"
          value={`${point.optionality}`}
        />
        <Metric
          icon={<ShieldAlert className="h-2.5 w-2.5" />}
          label="Risk"
          value={(point.risk ?? 'medium').toString()}
          badgeClass={riskCls}
        />
      </div>

      {isDistinct && !isStated && (
        <p className="mt-2 inline-flex items-center gap-1 text-[9px] text-muted-foreground">
          <Sparkles className="h-2.5 w-2.5" />
          A genuinely distinct strategy
        </p>
      )}
    </div>
  )
}

function Metric({
  icon,
  label,
  value,
  badgeClass,
}: {
  icon: React.ReactNode
  label: string
  value: string
  badgeClass?: string
}) {
  return (
    <div className="rounded-md bg-background/40 px-1.5 py-1">
      <div className="flex items-center gap-1 text-[9px] font-medium uppercase tracking-wider text-muted-foreground">
        <span className="text-primary/70">{icon}</span>
        {label}
      </div>
      {badgeClass ? (
        <Badge
          variant="outline"
          className={cn(
            'mt-0.5 gap-0.5 px-1 py-0 text-[10px] font-medium capitalize',
            badgeClass,
          )}
        >
          {value}
        </Badge>
      ) : (
        <p className="mt-0.5 text-[11px] font-semibold leading-tight tabular-nums">
          {value}
        </p>
      )}
    </div>
  )
}

function AlternativeIntentCard({ intent }: { intent: AlternativeIntent }) {
  return (
    <div
      className={cn(
        'rounded-xl border p-3 transition-colors',
        intent.mayBeSuperior
          ? 'border-amber-500/40 bg-amber-500/[0.04]'
          : 'border-border/60 bg-card/50',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="flex min-w-0 items-center gap-1.5 text-[12px] font-semibold leading-tight">
          <Lightbulb
            className={cn(
              'h-3.5 w-3.5 shrink-0',
              intent.mayBeSuperior
                ? 'text-amber-600 dark:text-amber-400'
                : 'text-muted-foreground',
            )}
          />
          <span className="min-w-0">{intent.title}</span>
        </p>
        {intent.mayBeSuperior && (
          <Badge
            variant="outline"
            className="shrink-0 gap-0.5 border-amber-500/40 bg-amber-500/5 px-1 py-0 text-[9px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400"
          >
            <ArrowRight className="h-2 w-2" />
            May be superior
          </Badge>
        )}
      </div>

      {intent.rationale && (
        <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
          {intent.rationale}
        </p>
      )}

      {intent.tradeoffs && intent.tradeoffs.length > 0 && (
        <div className="mt-2 border-t border-border/40 pt-1.5">
          <p className="text-[9px] font-medium uppercase tracking-wider text-muted-foreground">
            Tradeoffs
          </p>
          <ul className="mt-1 space-y-0.5">
            {intent.tradeoffs.map((t, j) => (
              <li key={j} className="flex items-start gap-1 text-[10px] text-foreground/70">
                {intent.mayBeSuperior ? (
                  <AlertTriangle className="mt-0.5 h-2.5 w-2.5 shrink-0 text-amber-600 dark:text-amber-400" />
                ) : (
                  <CheckCircle2 className="mt-0.5 h-2.5 w-2.5 shrink-0 text-muted-foreground" />
                )}
                <span className="min-w-0">{t}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border/60 bg-background/30 px-4 py-8 text-center">
      <div className="mx-auto mb-2 flex h-9 w-9 items-center justify-center rounded-full bg-muted/50">
        <Compass className="h-4 w-4 text-muted-foreground" />
      </div>
      <p className="text-sm font-medium">{message}</p>
      <p className="mx-auto mt-1 max-w-xs text-xs text-muted-foreground">
        Generate a strategy to see how each objective (income, residence,
        citizenship, etc.) leads to a different best trajectory.
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

export function IntentFrontierSectionSkeleton({ className }: { className?: string }) {
  return (
    <Card className={cn('wf-panel border-border/60 bg-card/60 p-4', className)}>
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 animate-pulse rounded-lg bg-muted" />
          <div>
            <div className="h-3.5 w-44 animate-pulse rounded bg-muted" />
            <div className="mt-1 h-2.5 w-32 animate-pulse rounded bg-muted" />
          </div>
        </div>
        <div className="h-5 w-32 animate-pulse rounded bg-muted" />
      </div>
      <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-border/60 bg-card/50 p-3">
            <div className="h-5 w-24 animate-pulse rounded bg-muted" />
            <div className="mt-2 h-3.5 w-32 animate-pulse rounded bg-muted" />
            <div className="mt-2.5 grid grid-cols-2 gap-1.5">
              {Array.from({ length: 4 }).map((__, j) => (
                <div key={j} className="h-7 animate-pulse rounded bg-muted" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </Card>
  )
}

export default IntentFrontierSection
