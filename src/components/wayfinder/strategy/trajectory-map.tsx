'use client'

// Wayfinder — Trajectory Map
//
// A vertical timeline visualization of a multi-step Trajectory.
//
// Step 0 renders as a "YOU ARE HERE" origin node. Each subsequent step shows
// its status, country flag, duration, key requirements, and (when blocked)
// a red lock icon + blocker labels. The final step shows downstream
// optionality. Clicking a step is a no-op for now — this is purely visual.
//
// The Trajectory type comes from '@/lib/strategy/types'.

import {
  Card,
} from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  MapPin, Lock, Flag, Shield, CircleDot, ArrowRight, Network,
  Clock, CheckCircle2, AlertTriangle, Sparkles, Compass,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Trajectory, TrajectoryStep } from '@/lib/strategy/types'

// ---------------------------------------------------------------------------
// Country flag emoji lookup (extends route-list.tsx conventions)
// ---------------------------------------------------------------------------

const COUNTRY_FLAG: Record<string, string> = {
  DE: '🇩🇪', PT: '🇵🇹', CA: '🇨🇦', EE: '🇪🇪', UK: '🇬🇧', AE: '🇦🇪', KE: '🇰🇪',
  FR: '🇫🇷', NL: '🇳🇱', ES: '🇪🇸', US: '🇺🇸', AU: '🇦🇺', IE: '🇮🇪',
}

function flagFor(code: string): string {
  if (COUNTRY_FLAG[code]) return COUNTRY_FLAG[code]
  // Fall back to regional indicator letters if a 2-letter ISO code is given.
  if (code && code.length === 2 && /^[A-Za-z]{2}$/.test(code)) {
    const A = 0x1f1e6
    const base = 'A'.charCodeAt(0)
    const upper = code.toUpperCase()
    return String.fromCodePoint(A + (upper.charCodeAt(0) - base)) +
      String.fromCodePoint(A + (upper.charCodeAt(1) - base))
  }
  return '🏳️'
}

// ---------------------------------------------------------------------------
// Format helpers
// ---------------------------------------------------------------------------

function formatDuration(months: number): string {
  if (!Number.isFinite(months) || months <= 0) return 'start'
  if (months < 12) return `${Math.round(months)} mo`
  const y = Math.floor(months / 12)
  const m = Math.round(months % 12)
  return m === 0 ? `${y} yr` : `${y} yr ${m} mo`
}

function cumulativeMonths(steps: TrajectoryStep[], upToIndex: number): number {
  let total = 0
  for (let i = 0; i <= upToIndex && i < steps.length; i++) {
    total += steps[i]?.durationMonths ?? 0
  }
  return total
}

// ---------------------------------------------------------------------------
// Node classification
// ---------------------------------------------------------------------------

type StepKind = 'origin' | 'entry' | 'pr' | 'citizenship' | 'intermediate'

function classifyStep(step: TrajectoryStep, index: number, total: number): StepKind {
  if (index === 0) return 'origin'
  if (index === total - 1) {
    if (/citizenship|passport/i.test(step.status)) return 'citizenship'
    if (/permanent|settlement|ilr|indefinite/i.test(step.status)) return 'pr'
  }
  if (/citizenship|passport/i.test(step.status)) return 'citizenship'
  if (/permanent|settlement|ilr|indefinite/i.test(step.status)) return 'pr'
  if (index === 1) return 'entry'
  return 'intermediate'
}

const STEP_VISUAL: Record<StepKind, { color: string; ring: string; Icon: React.ComponentType<{ className?: string }> }> = {
  origin: { color: 'text-chart-5', ring: 'border-chart-5/50 bg-chart-5/10', Icon: MapPin },
  entry: { color: 'text-primary', ring: 'border-primary/50 bg-primary/10', Icon: CircleDot },
  intermediate: { color: 'text-primary', ring: 'border-primary/40 bg-primary/5', Icon: CircleDot },
  pr: { color: 'text-chart-4', ring: 'border-chart-4/50 bg-chart-4/10', Icon: Shield },
  citizenship: { color: 'text-amber-600 dark:text-amber-400', ring: 'border-amber-500/50 bg-amber-500/10', Icon: Flag },
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface TrajectoryMapProps {
  trajectory: Trajectory
  className?: string
}

export function TrajectoryMap({ trajectory, className }: TrajectoryMapProps) {
  if (!trajectory) {
    return <TrajectoryMapSkeleton className={className} />
  }

  const steps = trajectory.steps ?? []
  if (steps.length === 0) {
    return (
      <Card className={cn('border-border/60 bg-card/60 p-4 wf-panel', className)}>
        <EmptyState message="This trajectory has no steps." />
      </Card>
    )
  }

  const lastIndex = steps.length - 1
  const blockedCount = steps.filter((s) => s.blocked).length

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
            <h3 className="text-sm font-semibold leading-tight">Trajectory map</h3>
            <p className="text-[11px] text-muted-foreground">
              {trajectory.label}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="outline" className="gap-1 text-[10px] font-normal text-muted-foreground">
            <MapPin className="h-2.5 w-2.5" />
            {steps.length} steps
          </Badge>
          {trajectory.multiCountry && (
            <Badge variant="outline" className="gap-1 text-[10px] font-normal text-muted-foreground">
              <Network className="h-2.5 w-2.5" />
              {trajectory.countries.length} countries
            </Badge>
          )}
          {blockedCount > 0 && (
            <Badge
              variant="outline"
              className="gap-1 border-destructive/40 bg-destructive/5 text-[10px] font-normal text-destructive"
            >
              <Lock className="h-2.5 w-2.5" />
              {blockedCount} blocked
            </Badge>
          )}
        </div>
      </div>

      {/* Vertical timeline */}
      <ol className="relative">
        {/* rail */}
        <div
          aria-hidden
          className="absolute bottom-3 left-[15px] top-3 w-px bg-gradient-to-b from-chart-5/40 via-primary/40 to-amber-500/40"
        />

        {steps.map((step, i) => {
          const kind = classifyStep(step, i, steps.length)
          const visual = STEP_VISUAL[kind]
          const isOrigin = i === 0
          const isFinal = i === lastIndex
          const Icon = visual.Icon
          const cum = cumulativeMonths(steps, i)
          const isBlocked = step.blocked

          return (
            <li
              key={`${step.order}-${i}`}
              className="relative pl-10 pb-4 last:pb-0"
            >
              {/* Node */}
              <span
                aria-hidden
                className={cn(
                  'absolute left-[5px] top-[6px] flex h-5 w-5 items-center justify-center rounded-full border-2 bg-background',
                  isBlocked
                    ? 'border-destructive bg-destructive/10'
                    : visual.ring,
                )}
              >
                {isBlocked ? (
                  <Lock className="h-2.5 w-2.5 text-destructive" />
                ) : (
                  <Icon className={cn('h-2.5 w-2.5', visual.color)} />
                )}
              </span>

              {/* Step body */}
              <button
                type="button"
                disabled
                aria-label={`Step ${i + 1}: ${step.status}`}
                className={cn(
                  'w-full rounded-xl border p-3 text-left transition-colors',
                  isOrigin
                    ? 'border-chart-5/40 bg-chart-5/[0.04]'
                    : isBlocked
                      ? 'border-destructive/40 bg-destructive/[0.03]'
                      : isFinal
                        ? 'border-amber-500/40 bg-amber-500/[0.04]'
                        : 'border-border/60 bg-card/50 hover:bg-card',
                )}
              >
                {/* Top row: status + flag + badges */}
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    {!isOrigin && (
                      <span className="text-base leading-none">
                        {flagFor(step.countryCode)}
                      </span>
                    )}
                    <div className="min-w-0">
                      <p className="flex items-center gap-1.5 text-sm font-semibold leading-tight">
                        {isOrigin ? (
                          <>
                            <span className="rounded bg-chart-5/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-chart-5">
                              You are here
                            </span>
                          </>
                        ) : (
                          <span className="truncate">{step.status}</span>
                        )}
                      </p>
                      {!isOrigin && (
                        <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                          {step.countryName}
                          {step.programName ? ` · ${step.programName}` : ''}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-1">
                    {isOrigin ? (
                      <Badge variant="outline" className="gap-1 text-[9px] font-normal text-muted-foreground">
                        <MapPin className="h-2.5 w-2.5" />
                        Current
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="gap-1 text-[10px] font-normal text-muted-foreground">
                        <Clock className="h-2.5 w-2.5" />
                        {formatDuration(step.durationMonths)}
                      </Badge>
                    )}
                    {isFinal && trajectory.downstreamOptionality > 0 && (
                      <Badge
                        variant="outline"
                        className="gap-1 border-amber-500/40 bg-amber-500/5 text-[10px] font-medium text-amber-700 dark:text-amber-400"
                      >
                        <Network className="h-2.5 w-2.5" />
                        {trajectory.downstreamOptionality} after
                      </Badge>
                    )}
                    {isBlocked && (
                      <Badge
                        variant="outline"
                        className="gap-1 border-destructive/40 bg-destructive/5 text-[10px] font-medium text-destructive"
                      >
                        <Lock className="h-2.5 w-2.5" />
                        Blocked
                      </Badge>
                    )}
                  </div>
                </div>

                {/* Description */}
                {!isOrigin && step.description && (
                  <p className="mt-1.5 text-[11px] leading-snug text-foreground/80">
                    {step.description}
                  </p>
                )}

                {/* Cumulative time hint */}
                {!isOrigin && cum > 0 && (
                  <p className="mt-1 inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                    <ArrowRight className="h-2.5 w-2.5" />
                    Cumulative: ~{formatDuration(cum)}
                  </p>
                )}

                {/* Requirements */}
                {!isOrigin && step.requirements.length > 0 && (
                  <div className="mt-2 border-t border-border/40 pt-2">
                    <p className="text-[9px] font-medium uppercase tracking-wider text-muted-foreground">
                      Requirements
                    </p>
                    <ul className="mt-1 space-y-0.5">
                      {step.requirements.slice(0, 4).map((r, j) => (
                        <li key={j} className="flex items-start gap-1 text-[11px] text-foreground/75">
                          <CheckCircle2 className="mt-0.5 h-2.5 w-2.5 shrink-0 text-primary/70" />
                          <span className="min-w-0">{r}</span>
                        </li>
                      ))}
                      {step.requirements.length > 4 && (
                        <li className="text-[10px] text-muted-foreground">
                          +{step.requirements.length - 4} more
                        </li>
                      )}
                    </ul>
                  </div>
                )}

                {/* Blocker labels */}
                {isBlocked && step.blockerLabels && step.blockerLabels.length > 0 && (
                  <div className="mt-2 rounded-lg border border-destructive/30 bg-destructive/5 px-2 py-1.5">
                    <p className="flex items-center gap-1 text-[9px] font-medium uppercase tracking-wider text-destructive">
                      <AlertTriangle className="h-2.5 w-2.5" />
                      Blockers
                    </p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {step.blockerLabels.map((b, j) => (
                        <span
                          key={j}
                          className="rounded border border-destructive/30 bg-background/60 px-1.5 py-0.5 text-[10px] text-destructive"
                        >
                          {b}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Final step optionality footer */}
                {isFinal && trajectory.downstreamOptionality > 0 && !isBlocked && (
                  <div className="mt-2 flex items-center gap-1.5 border-t border-amber-500/30 pt-2">
                    <Sparkles className="h-3 w-3 text-amber-600 dark:text-amber-400" />
                    <span className="text-[10px] text-amber-700 dark:text-amber-400">
                      {trajectory.downstreamOptionality} downstream options unlocked at this status.
                    </span>
                  </div>
                )}
              </button>
            </li>
          )
        })}
      </ol>

      {/* Legend */}
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border/40 pt-2 text-[10px] text-muted-foreground">
        <LegendDot color="border-chart-5 bg-chart-5/20" label="Current" />
        <LegendDot color="border-primary bg-primary/20" label="Entry / Intermediate" />
        <LegendDot color="border-chart-4 bg-chart-4/20" label="Permanent residence" />
        <LegendDot color="border-amber-500 bg-amber-500/20" label="Citizenship" />
        <LegendDot color="border-destructive bg-destructive/20" label="Blocked step" />
      </div>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn('inline-block h-2.5 w-2.5 rounded-full border', color)} />
      {label}
    </span>
  )
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border/60 bg-background/30 px-4 py-8 text-center">
      <div className="mx-auto mb-2 flex h-9 w-9 items-center justify-center rounded-full bg-muted/50">
        <MapPin className="h-4 w-4 text-muted-foreground" />
      </div>
      <p className="text-sm font-medium">{message}</p>
    </div>
  )
}

export function TrajectoryMapSkeleton({ className }: { className?: string }) {
  return (
    <Card className={cn('wf-panel border-border/60 bg-card/60 p-4', className)}>
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 animate-pulse rounded-lg bg-muted" />
          <div>
            <div className="h-3.5 w-24 animate-pulse rounded bg-muted" />
            <div className="mt-1 h-2.5 w-32 animate-pulse rounded bg-muted" />
          </div>
        </div>
        <div className="h-4 w-20 animate-pulse rounded bg-muted" />
      </div>
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="relative pl-8">
            <div className="absolute left-[5px] top-[6px] h-5 w-5 rounded-full border-2 border-muted bg-muted/50" />
            <div className="rounded-xl border border-border/60 bg-card/50 p-3">
              <div className="flex items-center justify-between">
                <div className="h-3.5 w-32 animate-pulse rounded bg-muted" />
                <div className="h-4 w-16 animate-pulse rounded bg-muted" />
              </div>
              <div className="mt-2 h-2.5 w-48 animate-pulse rounded bg-muted" />
            </div>
          </div>
        ))}
      </div>
    </Card>
  )
}

export default TrajectoryMap
