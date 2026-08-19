'use client'

// Wayfinder — Profile Analysis Section
//
// "What you have going for you" + "The one thing I would change".
//
// Renders:
//   - Top assets (ranked by leverage) with benefit count
//   - Top gaps (ranked by frontier expansion) with unlock count
//   - "THE HIGHEST-LEVERAGE CHANGE" highlight card: label, description,
//     "Before: N viable → After: M viable"
//   - Current vs post-change trajectory counts
//
// ProfileAnalysis comes from '@/lib/strategy/types'.

import {
  Card,
} from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import {
  Trophy, AlertCircle, Sparkles, TrendingUp, ArrowRight, Star,
  Target, Lock, User, Layers, Gauge, Award, Rocket,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type {
  ProfileAnalysis,
  ProfileAsset,
  ProfileGap,
} from '@/lib/strategy/types'

// ---------------------------------------------------------------------------
// Visual metadata
// ---------------------------------------------------------------------------

function leverageTone(value: number): { bar: string; label: string } {
  if (value >= 0.75) return { bar: 'bg-emerald-500', label: 'High leverage' }
  if (value >= 0.5) return { bar: 'bg-primary', label: 'Strong leverage' }
  if (value >= 0.25) return { bar: 'bg-amber-500', label: 'Moderate leverage' }
  return { bar: 'bg-muted-foreground/60', label: 'Marginal' }
}

function frontierTone(value: number): { bar: string; label: string } {
  if (value >= 0.75) return { bar: 'bg-amber-500', label: 'Frontier-opening' }
  if (value >= 0.5) return { bar: 'bg-primary', label: 'High expansion' }
  if (value >= 0.25) return { bar: 'bg-blue-500', label: 'Moderate expansion' }
  return { bar: 'bg-muted-foreground/60', label: 'Marginal' }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface ProfileAnalysisSectionProps {
  analysis: ProfileAnalysis
  className?: string
}

export function ProfileAnalysisSection({ analysis, className }: ProfileAnalysisSectionProps) {
  if (!analysis) {
    return <ProfileAnalysisSectionSkeleton className={className} />
  }

  const assets = analysis.topAssets ?? []
  const gaps = analysis.topGaps ?? []
  const change = analysis.highestLeverageChange
  const before = analysis.currentViableTrajectories ?? 0
  const after = analysis.postChangeViableTrajectories ?? 0
  const delta = Math.max(0, after - before)

  return (
    <div className={cn('space-y-4', className)}>
      {/* Two-column row: assets + gaps */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Assets */}
        <Card className="wf-panel border-border/60 bg-card/60 p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                <Trophy className="h-3.5 w-3.5" />
              </span>
              <div>
                <h3 className="text-sm font-semibold leading-tight">What you have going for you</h3>
                <p className="text-[11px] text-muted-foreground">
                  Top assets ranked by leverage
                </p>
              </div>
            </div>
            {assets.length > 0 && (
              <Badge variant="outline" className="gap-1 text-[10px] font-normal">
                <Star className="h-2.5 w-2.5" />
                {assets.length} asset{assets.length === 1 ? '' : 's'}
              </Badge>
            )}
          </div>

          {assets.length === 0 ? (
            <EmptyMiniState
              icon={<Trophy className="h-4 w-4" />}
              message="No assets recorded yet."
            />
          ) : (
            <ScrollArea className="wf-scroll max-h-[26rem] pr-2">
              <div className="space-y-2">
                {assets.map((a, i) => (
                  <AssetRow key={`${a.attribute}-${i}`} asset={a} rank={i + 1} />
                ))}
              </div>
            </ScrollArea>
          )}
        </Card>

        {/* Gaps */}
        <Card className="wf-panel border-border/60 bg-card/60 p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-500/15 text-amber-600 dark:text-amber-400">
                <AlertCircle className="h-3.5 w-3.5" />
              </span>
              <div>
                <h3 className="text-sm font-semibold leading-tight">The gaps that matter</h3>
                <p className="text-[11px] text-muted-foreground">
                  Top gaps ranked by frontier expansion
                </p>
              </div>
            </div>
            {gaps.length > 0 && (
              <Badge variant="outline" className="gap-1 text-[10px] font-normal">
                <Layers className="h-2.5 w-2.5" />
                {gaps.length} gap{gaps.length === 1 ? '' : 's'}
              </Badge>
            )}
          </div>

          {gaps.length === 0 ? (
            <EmptyMiniState
              icon={<AlertCircle className="h-4 w-4" />}
              message="No material gaps in your profile."
            />
          ) : (
            <ScrollArea className="wf-scroll max-h-[26rem] pr-2">
              <div className="space-y-2">
                {gaps.map((g, i) => (
                  <GapRow key={`${g.attribute}-${i}`} gap={g} rank={i + 1} />
                ))}
              </div>
            </ScrollArea>
          )}
        </Card>
      </div>

      {/* Highest-leverage change highlight */}
      {change && (
        <Card className="wf-panel relative overflow-hidden border-amber-500/40 bg-amber-500/[0.04] p-5">
          {/* Cartographic accent */}
          <div
            aria-hidden
            className="pointer-events-none absolute -right-12 -top-12 h-48 w-48 rounded-full bg-amber-500/10 blur-3xl"
          />
          <div className="relative">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-400">
                  <Sparkles className="h-4 w-4" />
                </span>
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-amber-700 dark:text-amber-400">
                    The one thing I would change
                  </p>
                  <h3 className="text-base font-semibold leading-tight">
                    {change.label}
                  </h3>
                </div>
              </div>
              {change.scenarioId && (
                <Badge
                  variant="outline"
                  className="gap-1 text-[10px] font-normal text-muted-foreground"
                >
                  <Target className="h-2.5 w-2.5" />
                  scenario: {change.scenarioId.length > 18
                    ? change.scenarioId.slice(0, 18) + '…'
                    : change.scenarioId}
                </Badge>
              )}
            </div>

            {change.description && (
              <p className="mt-2 text-sm leading-relaxed text-foreground/85">
                {change.description}
              </p>
            )}

            <Separator className="my-3 bg-amber-500/20" />

            {/* Before / after */}
            <div className="grid gap-2 sm:grid-cols-3">
              <CounterCell
                label="Viable trajectories now"
                value={before}
                tone="bg-background/40 border-border/60"
                Icon={Gauge}
              />
              <CounterCell
                label={`After: ${change.label.toLowerCase()}`}
                value={after}
                tone="bg-amber-500/10 border-amber-500/40 text-amber-700 dark:text-amber-400"
                Icon={Rocket}
              />
              <CounterCell
                label="New routes opened"
                value={change.newRoutesOpened}
                tone="bg-emerald-500/10 border-emerald-500/40 text-emerald-700 dark:text-emerald-400"
                Icon={TrendingUp}
                delta={delta > 0 ? `+${delta}` : undefined}
              />
            </div>

            {/* Visual transition */}
            <div className="mt-3 flex items-center justify-center gap-3 rounded-lg border border-border/40 bg-background/40 px-3 py-2.5">
              <BeforeAfterBadge label="Before" value={before} />
              <ArrowRight className="h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
              <BeforeAfterBadge label="After" value={after} highlight />
            </div>
          </div>
        </Card>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function AssetRow({ asset, rank }: { asset: ProfileAsset; rank: number }) {
  const pct = Math.max(0, Math.min(100, Math.round((asset.leverage ?? 0) * 100)))
  const tone = leverageTone(asset.leverage ?? 0)
  return (
    <div className="rounded-xl border border-border/60 bg-card/50 p-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2">
          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-[10px] font-bold text-emerald-700 dark:text-emerald-400">
            {rank}
          </span>
          <div className="min-w-0">
            <p className="truncate text-[12px] font-semibold leading-tight">{asset.label}</p>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {asset.attribute.replace(/_/g, ' ')}
            </p>
          </div>
        </div>
        {asset.rare && (
          <Badge
            variant="outline"
            className="shrink-0 gap-0.5 border-amber-500/40 bg-amber-500/5 px-1 py-0 text-[9px] font-medium text-amber-700 dark:text-amber-400"
          >
            <Star className="h-2 w-2" /> Rare
          </Badge>
        )}
      </div>

      <div className="mt-2 flex items-center gap-2">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
          <div
            className={cn('h-full rounded-full', tone.bar)}
            style={{ width: `${Math.max(2, pct)}%` }}
          />
        </div>
        <span className="w-8 shrink-0 text-right text-[10px] font-medium tabular-nums text-muted-foreground">
          {pct}%
        </span>
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
          <Award className="h-2.5 w-2.5" />
          {tone.label}
        </span>
        <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
          <Layers className="h-2.5 w-2.5" />
          Benefits {asset.benefitsRoutes.length} route{asset.benefitsRoutes.length === 1 ? '' : 's'}
        </span>
      </div>
    </div>
  )
}

function GapRow({ gap, rank }: { gap: ProfileGap; rank: number }) {
  const pct = Math.max(0, Math.min(100, Math.round((gap.frontierExpansion ?? 0) * 100)))
  const tone = frontierTone(gap.frontierExpansion ?? 0)
  return (
    <div className="rounded-xl border border-border/60 bg-card/50 p-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2">
          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-[10px] font-bold text-amber-700 dark:text-amber-400">
            {rank}
          </span>
          <div className="min-w-0">
            <p className="truncate text-[12px] font-semibold leading-tight">{gap.label}</p>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {gap.attribute.replace(/_/g, ' ')}
            </p>
          </div>
        </div>
        {gap.userActionable ? (
          <Badge
            variant="outline"
            className="shrink-0 gap-0.5 border-emerald-500/40 bg-emerald-500/5 px-1 py-0 text-[9px] font-medium text-emerald-700 dark:text-emerald-400"
          >
            <User className="h-2 w-2" /> You can fix
          </Badge>
        ) : (
          <Badge
            variant="outline"
            className="shrink-0 gap-0.5 border-muted-foreground/40 bg-muted/20 px-1 py-0 text-[9px] font-medium text-muted-foreground"
          >
            <Lock className="h-2 w-2" /> External
          </Badge>
        )}
      </div>

      <div className="mt-2 flex items-center gap-2">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
          <div
            className={cn('h-full rounded-full', tone.bar)}
            style={{ width: `${Math.max(2, pct)}%` }}
          />
        </div>
        <span className="w-8 shrink-0 text-right text-[10px] font-medium tabular-nums text-muted-foreground">
          {pct}%
        </span>
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
          <TrendingUp className="h-2.5 w-2.5" />
          {tone.label}
        </span>
        <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
          <Sparkles className="h-2.5 w-2.5" />
          Unlocks {gap.unlocksRoutes.length} route{gap.unlocksRoutes.length === 1 ? '' : 's'}
        </span>
      </div>
    </div>
  )
}

function CounterCell({
  label,
  value,
  tone,
  Icon,
  delta,
}: {
  label: string
  value: number
  tone: string
  Icon: React.ComponentType<{ className?: string }>
  delta?: string
}) {
  return (
    <div className={cn('rounded-xl border px-3 py-2.5', tone)}>
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        <Icon className="h-3 w-3 opacity-70" />
      </div>
      <p className="mt-1 text-2xl font-semibold tabular-nums leading-none">{value}</p>
      {delta && (
        <p className="mt-1 text-[10px] font-medium">{delta}</p>
      )}
    </div>
  )
}

function BeforeAfterBadge({
  label,
  value,
  highlight,
}: {
  label: string
  value: number
  highlight?: boolean
}) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span
        className={cn(
          'text-[10px] font-medium uppercase tracking-wider',
          highlight ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground',
        )}
      >
        {label}
      </span>
      <span
        className={cn(
          'text-xl font-semibold tabular-nums leading-none',
          highlight ? 'text-amber-700 dark:text-amber-400' : 'text-foreground/90',
        )}
      >
        {value}
      </span>
      <span className="text-[9px] text-muted-foreground">viable</span>
    </div>
  )
}

function EmptyMiniState({
  icon,
  message,
}: {
  icon: React.ReactNode
  message: string
}) {
  return (
    <div className="rounded-lg border border-dashed border-border/60 bg-background/30 px-4 py-6 text-center">
      <div className="mx-auto mb-1.5 flex h-8 w-8 items-center justify-center rounded-full bg-muted/40 text-muted-foreground">
        {icon}
      </div>
      <p className="text-xs text-muted-foreground">{message}</p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

export function ProfileAnalysisSectionSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn('space-y-4', className)}>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="wf-panel border-border/60 bg-card/60 p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="h-7 w-7 animate-pulse rounded-lg bg-muted" />
              <div>
                <div className="h-3.5 w-32 animate-pulse rounded bg-muted" />
                <div className="mt-1 h-2.5 w-24 animate-pulse rounded bg-muted" />
              </div>
            </div>
            <div className="h-4 w-16 animate-pulse rounded bg-muted" />
          </div>
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="rounded-xl border border-border/60 bg-card/50 p-2.5">
                <div className="h-3 w-32 animate-pulse rounded bg-muted" />
                <div className="mt-2 h-1.5 w-full animate-pulse rounded bg-muted" />
              </div>
            ))}
          </div>
        </Card>
        <Card className="wf-panel border-border/60 bg-card/60 p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="h-7 w-7 animate-pulse rounded-lg bg-muted" />
              <div>
                <div className="h-3.5 w-28 animate-pulse rounded bg-muted" />
                <div className="mt-1 h-2.5 w-28 animate-pulse rounded bg-muted" />
              </div>
            </div>
            <div className="h-4 w-16 animate-pulse rounded bg-muted" />
          </div>
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="rounded-xl border border-border/60 bg-card/50 p-2.5">
                <div className="h-3 w-32 animate-pulse rounded bg-muted" />
                <div className="mt-2 h-1.5 w-full animate-pulse rounded bg-muted" />
              </div>
            ))}
          </div>
        </Card>
      </div>
      <Card className="wf-panel border-amber-500/40 bg-amber-500/[0.04] p-5">
        <div className="flex items-center gap-2">
          <div className="h-9 w-9 animate-pulse rounded-xl bg-muted" />
          <div>
            <div className="h-2.5 w-32 animate-pulse rounded bg-muted" />
            <div className="mt-1.5 h-4 w-48 animate-pulse rounded bg-muted" />
          </div>
        </div>
        <div className="mt-3 space-y-2">
          <div className="h-3 w-full animate-pulse rounded bg-muted" />
          <div className="h-3 w-3/4 animate-pulse rounded bg-muted" />
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-16 animate-pulse rounded-xl bg-muted" />
          ))}
        </div>
      </Card>
    </div>
  )
}

export default ProfileAnalysisSection
