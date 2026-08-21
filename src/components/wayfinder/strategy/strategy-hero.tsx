'use client'

// Wayfinder — Strategy Hero
//
// The primary "Your best current strategy" hero section.
//
// Renders the user's best trajectory as a single cartographic panel:
// heading, destination status, time / cost / countries, optionality,
// reversibility, the key blocker (if any), per-dimension confidence
// indicators, the deterministic explanation prose, and a provenance /
// simulation warning when the underlying policy snapshot is simulated.
//
// The Strategy type comes from '@/lib/strategy/types'. All numbers shown
// here are deterministic engine outputs — no LLM in the data path.

import {
  Card,
} from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import {
  Compass, Flag, Clock, DollarSign, Globe2, Network, Undo2, Lock,
  AlertTriangle, Sparkles, ShieldCheck, ShieldAlert, HelpCircle,
  CheckCircle2, Info, FileText, FlaskConical,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type {
  Strategy,
  BlockerAnalysis,
  ConfidenceLevel,
} from '@/lib/strategy/types'

// ---------------------------------------------------------------------------
// Format helpers
// ---------------------------------------------------------------------------

function formatUsd(n: number): string {
  if (!Number.isFinite(n)) return '—'
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`
  return `$${n}`
}

function formatYears(months: number): string {
  if (!Number.isFinite(months) || months <= 0) return '—'
  const y = Math.round((months / 12) * 10) / 10
  if (y < 1) return `${Math.round(months)} mo`
  return `${y} yr`
}

function formatDateShort(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

// ---------------------------------------------------------------------------
// Visual metadata tables
// ---------------------------------------------------------------------------

type IconType = React.ComponentType<{ className?: string }>

const CONFIDENCE_STYLE: Record<ConfidenceLevel, { label: string; cls: string; Icon: IconType }> = {
  HIGH: {
    label: 'High',
    cls: 'border-emerald-500/40 text-emerald-700 dark:text-emerald-400 bg-emerald-500/5',
    Icon: CheckCircle2,
  },
  MEDIUM: {
    label: 'Medium',
    cls: 'border-amber-500/40 text-amber-700 dark:text-amber-400 bg-amber-500/5',
    Icon: ShieldCheck,
  },
  LOW: {
    label: 'Low',
    cls: 'border-orange-500/40 text-orange-700 dark:text-orange-400 bg-orange-500/5',
    Icon: ShieldAlert,
  },
  UNKNOWN: {
    label: 'Unknown',
    cls: 'border-muted-foreground/40 text-muted-foreground bg-muted/20',
    Icon: HelpCircle,
  },
}

const REVERSIBILITY_STYLE: Record<string, { label: string; cls: string; Icon: IconType }> = {
  high: {
    label: 'Highly reversible',
    cls: 'border-emerald-500/40 text-emerald-700 dark:text-emerald-400 bg-emerald-500/5',
    Icon: Undo2,
  },
  medium: {
    label: 'Partially reversible',
    cls: 'border-amber-500/40 text-amber-700 dark:text-amber-400 bg-amber-500/5',
    Icon: Undo2,
  },
  low: {
    label: 'Low reversibility',
    cls: 'border-orange-500/40 text-orange-700 dark:text-orange-400 bg-orange-500/5',
    Icon: Lock,
  },
}

const RISK_STYLE: Record<string, string> = {
  low: 'border-emerald-500/40 text-emerald-700 dark:text-emerald-400 bg-emerald-500/5',
  medium: 'border-amber-500/40 text-amber-700 dark:text-amber-400 bg-amber-500/5',
  high: 'border-destructive/40 text-destructive bg-destructive/5',
}

const CATEGORY_STYLE: Record<string, { label: string; cls: string; Icon: IconType }> = {
  USER_CONTROLLED: {
    label: 'In your control',
    cls: 'border-emerald-500/40 text-emerald-700 dark:text-emerald-400 bg-emerald-500/5',
    Icon: Sparkles,
  },
  THIRD_PARTY: {
    label: 'Needs a third party',
    cls: 'border-amber-500/40 text-amber-700 dark:text-amber-400 bg-amber-500/5',
    Icon: Network,
  },
  EXTERNAL: {
    label: 'External process',
    cls: 'border-blue-500/40 text-blue-700 dark:text-blue-300 bg-blue-500/5',
    Icon: Globe2,
  },
  POLICY_DEPENDENT: {
    label: 'Policy-dependent',
    cls: 'border-orange-700/40 text-orange-700 dark:text-orange-400 bg-orange-700/5',
    Icon: FileText,
  },
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface StrategyHeroProps {
  strategy: Strategy
  /** When the underlying policy snapshot was loaded in simulation mode. */
  simulationMode?: boolean
  /** Optional provenance label (e.g. "snap-2024-11 AUTHORITATIVE"). */
  provenanceLabel?: string
  className?: string
}

export function StrategyHero({
  strategy,
  simulationMode = false,
  provenanceLabel,
  className,
}: StrategyHeroProps) {
  if (!strategy) {
    return <StrategyHeroSkeleton className={className} />
  }

  const t = strategy.bestTrajectory
  const blockers = strategy.blockers
  const primaryBlocker: BlockerAnalysis | undefined = blockers[0]
  const reversibilityMeta =
    REVERSIBILITY_STYLE[t?.reversibility ?? 'medium'] ?? REVERSIBILITY_STYLE.medium
  const riskCls = RISK_STYLE[t?.risk ?? 'medium'] ?? RISK_STYLE.medium

  return (
    <Card
      className={cn(
        'wf-panel relative overflow-hidden border-border/60 bg-card/60',
        className,
      )}
    >
      {/* Cartographic topographic backdrop */}
      <div className="wf-topo pointer-events-none absolute inset-0 opacity-40" aria-hidden />

      <div className="relative p-5 sm:p-6">
        {/* Eyebrow */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            <Compass className="h-3.5 w-3.5 text-primary" />
            Your global mobility strategy
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
            {provenanceLabel && (
              <Badge
                variant="outline"
                className="gap-1 text-[10px] font-normal text-muted-foreground"
              >
                <FileText className="h-2.5 w-2.5" />
                {provenanceLabel}
              </Badge>
            )}
            <Badge
              variant="outline"
              className="gap-1 text-[10px] font-normal text-muted-foreground"
            >
              <Clock className="h-2.5 w-2.5" />
              {formatDateShort(strategy.generatedAt)}
            </Badge>
          </div>
        </div>

        {/* Heading + destination */}
        <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-xl font-semibold leading-tight tracking-tight sm:text-2xl">
              {t?.label ?? 'No viable trajectory yet'}
            </h2>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <Badge
                variant="outline"
                className="gap-1 border-primary/40 bg-primary/5 text-[11px] font-medium text-primary"
              >
                <Flag className="h-3 w-3" />
                {t?.destinationStatus ?? '—'}
              </Badge>
              {t?.viable ? (
                <Badge
                  variant="outline"
                  className="gap-1 border-emerald-500/40 bg-emerald-500/5 text-[11px] font-medium text-emerald-700 dark:text-emerald-400"
                >
                  <CheckCircle2 className="h-3 w-3" /> Viable now
                </Badge>
              ) : (
                <Badge
                  variant="outline"
                  className="gap-1 border-amber-500/40 bg-amber-500/5 text-[11px] font-medium text-amber-700 dark:text-amber-400"
                >
                  <Lock className="h-3 w-3" /> Blocked
                </Badge>
              )}
              {t?.multiCountry && (
                <Badge
                  variant="outline"
                  className="gap-1 text-[11px] font-normal text-muted-foreground"
                >
                  <Globe2 className="h-2.5 w-2.5" /> Multi-country
                </Badge>
              )}
            </div>
          </div>
        </div>

        {/* Metric strip */}
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <MetricCell
            icon={<Clock className="h-3.5 w-3.5" />}
            label="Duration"
            value={formatYears(t?.totalMonths ?? 0)}
            hint={t ? `${Math.round(t.totalMonths)} months` : undefined}
          />
          <MetricCell
            icon={<DollarSign className="h-3.5 w-3.5" />}
            label="Cost"
            value={formatUsd(t?.totalCostUSD ?? 0)}
            hint={t ? `${t.totalCostUSD.toLocaleString()} USD` : undefined}
          />
          <MetricCell
            icon={<Globe2 className="h-3.5 w-3.5" />}
            label="Countries"
            value={t ? `${t.countries.length}` : '—'}
            hint={t ? t.countries.join(' · ') : undefined}
          />
          <MetricCell
            icon={<Network className="h-3.5 w-3.5" />}
            label="Optionality"
            value={t ? `${t.downstreamOptionality}` : '—'}
            hint="Downstream transitions"
          />
        </div>

        {/* Secondary strip: reversibility + risk */}
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Badge
            variant="outline"
            className={cn('gap-1 text-[10px] font-normal', reversibilityMeta.cls)}
          >
            <reversibilityMeta.Icon className="h-2.5 w-2.5" />
            {reversibilityMeta.label}
          </Badge>
          <Badge variant="outline" className={cn('gap-1 text-[10px] font-normal capitalize', riskCls)}>
            <ShieldAlert className="h-2.5 w-2.5" />
            {t?.risk ?? 'medium'} risk
          </Badge>
          {t?.rationale && (
            <span className="text-[10px] text-muted-foreground">· {t.rationale}</span>
          )}
        </div>

        <Separator className="my-4 bg-border/50" />

        {/* Two-column body */}
        <div className="grid gap-4 lg:grid-cols-5">
          {/* Explanation (deterministic prose) */}
          <div className="lg:col-span-3">
            <p className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              <Info className="h-3 w-3" />
              Why this trajectory
            </p>
            <p className="mt-1.5 text-sm leading-relaxed text-foreground/90">
              {typeof strategy.explanation === 'string'
                ? strategy.explanation
                : strategy.explanation?.summary || 'No explanation available.'}
            </p>

            {/* Confidence indicators */}
            <p className="mt-4 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              <ShieldCheck className="h-3 w-3" />
              Confidence
            </p>
            <div className="mt-1.5 grid gap-1.5 sm:grid-cols-2">
              {strategy.uncertainties.length === 0 ? (
                <p className="text-xs text-muted-foreground">No confidence assessments available.</p>
              ) : (
                strategy.uncertainties.map((u) => {
                  const meta =
                    CONFIDENCE_STYLE[u.confidence] ?? CONFIDENCE_STYLE.UNKNOWN
                  return (
                    <div
                      key={u.dimension}
                      className="rounded-lg border border-border/50 bg-background/40 px-2.5 py-1.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-[11px] font-medium">{u.dimension}</span>
                        <Badge
                          variant="outline"
                          className={cn('gap-1 px-1.5 py-0 text-[9px] font-medium', meta.cls)}
                        >
                          <meta.Icon className="h-2.5 w-2.5" />
                          {meta.label}
                        </Badge>
                      </div>
                      {u.reason && (
                        <p className="mt-1 text-[10px] leading-snug text-muted-foreground">
                          {u.reason}
                        </p>
                      )}
                    </div>
                  )
                })
              )}
            </div>
          </div>

          {/* Key blocker */}
          <div className="lg:col-span-2">
            <p className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              <Lock className="h-3 w-3" />
              Key blocker
            </p>
            {primaryBlocker ? (
              <BlockerCallout blocker={primaryBlocker} />
            ) : (
              <div className="mt-1.5 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3">
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                  <div>
                    <p className="text-sm font-medium text-emerald-800 dark:text-emerald-300">
                      No blockers — this trajectory is executable today
                    </p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      All hard requirements pass against the current policy snapshot.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Highest-leverage change preview */}
            {strategy.highestLeverageChange && (
              <div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
                <p className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-amber-700 dark:text-amber-400">
                  <Sparkles className="h-3 w-3" />
                  Highest-leverage change
                </p>
                <p className="mt-1 text-sm font-semibold text-foreground/90">
                  {strategy.highestLeverageChange.label}
                </p>
                <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                  {strategy.highestLeverageChange.description}
                </p>
                <p className="mt-1.5 text-[10px] text-amber-700 dark:text-amber-400">
                  +{strategy.highestLeverageChange.newRoutesOpened} new route
                  {strategy.highestLeverageChange.newRoutesOpened === 1 ? '' : 's'} opened
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Provenance / simulation warning */}
        {simulationMode && (
          <div className="mt-4 rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2">
            <div className="flex items-start gap-2">
              <FlaskConical className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <div className="min-w-0">
                <p className="text-[11px] font-semibold text-amber-800 dark:text-amber-300">
                  Simulation mode — not production policy
                </p>
                <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground">
                  This strategy was computed against a simulated policy snapshot.
                  Do not act on it. Switch to an authoritative snapshot before
                  making real-world decisions.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function MetricCell({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode
  label: string
  value: string
  hint?: string
}) {
  return (
    <div
      className="rounded-xl border border-border/50 bg-background/40 px-3 py-2"
      title={hint}
    >
      <div className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        <span className="text-primary">{icon}</span>
        {label}
      </div>
      <p className="mt-0.5 text-base font-semibold leading-tight">{value}</p>
      {hint && (
        <p className="mt-0.5 truncate text-[10px] text-muted-foreground">{hint}</p>
      )}
    </div>
  )
}

function BlockerCallout({ blocker }: { blocker: BlockerAnalysis }) {
  const meta =
    CATEGORY_STYLE[blocker.category] ?? CATEGORY_STYLE.EXTERNAL
  return (
    <div className="mt-1.5 rounded-xl border border-border/60 bg-background/40 p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold leading-tight">{blocker.label}</p>
        <Badge
          variant="outline"
          className={cn('shrink-0 gap-1 px-1.5 py-0 text-[9px] font-medium', meta.cls)}
        >
          <meta.Icon className="h-2.5 w-2.5" />
          {meta.label}
        </Badge>
      </div>
      <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
        {blocker.reason}
      </p>
      {blocker.estimatedResolutionMonths != null && (
        <p className="mt-1.5 inline-flex items-center gap-1 text-[10px] text-muted-foreground">
          <Clock className="h-2.5 w-2.5" />
          Est. resolution: ~{Math.round(blocker.estimatedResolutionMonths)} mo
        </p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

export function StrategyHeroSkeleton({ className }: { className?: string }) {
  return (
    <Card
      className={cn(
        'wf-panel border-border/60 bg-card/60 p-5 sm:p-6',
        className,
      )}
    >
      <div className="flex items-center justify-between">
        <div className="h-3 w-44 animate-pulse rounded bg-muted" />
        <div className="h-3 w-28 animate-pulse rounded bg-muted" />
      </div>
      <div className="mt-3 h-6 w-72 animate-pulse rounded bg-muted" />
      <div className="mt-2 flex gap-1.5">
        <div className="h-5 w-24 animate-pulse rounded bg-muted" />
        <div className="h-5 w-16 animate-pulse rounded bg-muted" />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-border/40 bg-background/30 p-3">
            <div className="h-2.5 w-12 animate-pulse rounded bg-muted" />
            <div className="mt-1.5 h-4 w-16 animate-pulse rounded bg-muted" />
          </div>
        ))}
      </div>
      <div className="mt-4 h-px w-full bg-border/40" />
      <div className="mt-4 space-y-2">
        <div className="h-3 w-full animate-pulse rounded bg-muted" />
        <div className="h-3 w-5/6 animate-pulse rounded bg-muted" />
        <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
      </div>
    </Card>
  )
}

export default StrategyHero
