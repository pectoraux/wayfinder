'use client'

// Wayfinder — Plan Diff View
//
// POSTs { oldRecordId, newRecordId } to /api/plans/diff and renders a
// structured before/after comparison: best route change, eligibility
// changes, score changes, cost changes, timeline changes, new blockers,
// resolved blockers.
//
// The diff is deterministic (computed by src/lib/policy/plan-diff.ts).
// No LLM is involved in computing the diff; this component only renders it.

import { useCallback, useEffect, useState } from 'react'
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import {
  GitCompareArrows, RefreshCw, AlertTriangle, ArrowRight, Crown, Lock,
  CheckCircle2, XCircle, TrendingUp, TrendingDown, Minus, DollarSign,
  Clock, ShieldAlert, ShieldCheck, X, GitBranch, FileText,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { PlanDiff } from '@/lib/policy/types'

interface PlanSideMeta {
  recordId: string
  createdAt: string
  bestRoute?: string
  policyVersion: string
}

interface PlanDiffResponse {
  diff: PlanDiff
  oldPlan: PlanSideMeta
  newPlan: PlanSideMeta
}

interface PlanDiffViewProps {
  oldRecordId: string
  newRecordId: string
  onClose?: () => void
  className?: string
}

type IconType = React.ComponentType<{ className?: string }>

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function formatUsd(n: number): string {
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`
  return `$${n}`
}

function formatSignedUsd(delta: number): string {
  const sign = delta > 0 ? '+' : ''
  return `${sign}${formatUsd(Math.abs(delta))}`.replace('$', delta < 0 ? '-$' : '$')
}

function formatMonths(n: number): string {
  if (n <= 0) return '0mo'
  if (n < 12) return `${n}mo`
  const y = Math.floor(n / 12)
  const m = n % 12
  return m === 0 ? `${y}y` : `${y}y ${m}mo`
}

function formatSignedMonths(delta: number): string {
  const sign = delta > 0 ? '+' : ''
  return `${sign}${formatMonths(Math.abs(delta))}`
}

function prettyField(field: string): string {
  // economicUpside → "Economic upside"
  return field
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (c) => c.toUpperCase())
    .trim()
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

function shortVersion(v?: string): string {
  if (!v) return '—'
  return v.length > 20 ? v.slice(0, 20) + '…' : v
}

// ---------------------------------------------------------------------------
// Status pill helpers (mirror route-list.tsx conventions)
// ---------------------------------------------------------------------------

const STATUS_LABEL: Record<string, string> = {
  eligible: 'Eligible',
  conditional: 'Conditional',
  ineligible: 'Blocked',
}

function statusTone(status: string): string {
  if (status === 'eligible') return 'border-emerald-500/40 text-emerald-700 dark:text-emerald-400 bg-emerald-500/5'
  if (status === 'conditional') return 'border-amber-500/40 text-amber-700 dark:text-amber-400 bg-amber-500/5'
  return 'border-destructive/40 text-destructive bg-destructive/5'
}

function deltaTone(delta: number, higherIsBetter = true): { cls: string; Icon: IconType } {
  if (delta === 0) return { cls: 'text-muted-foreground', Icon: Minus }
  const positive = higherIsBetter ? delta > 0 : delta < 0
  return positive
    ? { cls: 'text-emerald-700 dark:text-emerald-400', Icon: TrendingUp }
    : { cls: 'text-destructive', Icon: TrendingDown }
}

// ===========================================================================
// Component
// ===========================================================================

export function PlanDiffView({
  oldRecordId,
  newRecordId,
  onClose,
  className,
}: PlanDiffViewProps) {
  const [data, setData] = useState<PlanDiffResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!oldRecordId || !newRecordId || oldRecordId === newRecordId) {
      setData(null)
      setError(null)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/plans/diff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldRecordId, newRecordId }),
      })
      if (res.status === 401) {
        setError('Sign in to compare plans.')
        setData(null)
        return
      }
      if (res.status === 403) {
        setError('You can only compare your own saved plans.')
        setData(null)
        return
      }
      if (res.status === 404) {
        setError('One of these plan versions could not be found.')
        setData(null)
        return
      }
      if (!res.ok) {
        throw new Error(`Failed to compute diff (${res.status})`)
      }
      const json = (await res.json()) as PlanDiffResponse
      setData(json)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unknown error')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [oldRecordId, newRecordId])

  useEffect(() => {
    void load()
  }, [load])

  const diff = data?.diff
  const hasAnyChange = !!diff && (
    diff.bestRouteChanged ||
    diff.routesOpened.length > 0 ||
    diff.routesClosed.length > 0 ||
    diff.eligibilityChanges.length > 0 ||
    diff.scoreChanges.length > 0 ||
    diff.costChanges.length > 0 ||
    diff.timelineChanges.length > 0 ||
    diff.newBlockers.length > 0 ||
    diff.resolvedBlockers.length > 0
  )

  return (
    <Card className={cn('border-border/60 bg-card/70 wf-panel overflow-hidden', className)}>
      {/* Topo header */}
      <div className="wf-topo relative border-b border-border/50">
        <div className="absolute inset-0 bg-background/60" />
        <div className="relative flex items-start justify-between gap-3 px-5 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/15 text-primary">
              <GitCompareArrows className="h-5 w-5" />
            </div>
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Plan diff · deterministic
              </p>
              <h2 className="text-lg font-semibold leading-tight">
                What changed between versions
              </h2>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              size="sm"
              variant="ghost"
              className="h-7 gap-1 px-2 text-[11px]"
              onClick={() => void load()}
              disabled={loading || !oldRecordId || !newRecordId || oldRecordId === newRecordId}
            >
              <RefreshCw className={cn('h-3 w-3', loading && 'animate-spin')} />
              Recompute
            </Button>
            {onClose && (
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                onClick={onClose}
                aria-label="Close diff"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>
      </div>

      <CardContent className="space-y-4 p-5 sm:p-6">
        {/* Before / After strip */}
        {data && (
          <BeforeAfterStrip oldPlan={data.oldPlan} newPlan={data.newPlan} />
        )}

        {/* Body */}
        {loading ? (
          <DiffSkeleton />
        ) : error ? (
          <ErrorState message={error} onRetry={() => void load()} />
        ) : !diff ? (
          <div className="rounded-lg border border-dashed border-border/60 bg-background/30 px-4 py-8 text-center text-sm text-muted-foreground">
            Select two plan versions to compare.
          </div>
        ) : !hasAnyChange ? (
          <NoChangesState />
        ) : (
          <div className="space-y-4">
            {/* Best route change callout */}
            <BestRouteCallout diff={diff} />

            {/* Routes opened / closed summary */}
            {(diff.routesOpened.length > 0 || diff.routesClosed.length > 0) && (
              <RoutesOpenedClosed diff={diff} />
            )}

            {/* Eligibility changes */}
            {diff.eligibilityChanges.length > 0 && (
              <DiffSection
                title="Eligibility changes"
                icon={Lock}
                count={diff.eligibilityChanges.length}
                tone="neutral"
              >
                <div className="space-y-1.5">
                  {diff.eligibilityChanges.map((c) => (
                    <div
                      key={`${c.routeId}-${c.oldStatus}-${c.newStatus}`}
                      className="flex items-center justify-between gap-2 rounded-lg border border-border/50 bg-background/40 px-3 py-2"
                    >
                      <span className="truncate text-xs font-medium">{c.label}</span>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <Badge variant="outline" className={cn('text-[10px] font-normal', statusTone(c.oldStatus))}>
                          {STATUS_LABEL[c.oldStatus] ?? c.oldStatus}
                        </Badge>
                        <ArrowRight className="h-3 w-3 text-muted-foreground" />
                        <Badge variant="outline" className={cn('text-[10px] font-normal', statusTone(c.newStatus))}>
                          {STATUS_LABEL[c.newStatus] ?? c.newStatus}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </DiffSection>
            )}

            {/* Score changes */}
            {diff.scoreChanges.length > 0 && (
              <DiffSection
                title="Score changes"
                icon={TrendingUp}
                count={diff.scoreChanges.length}
                tone="neutral"
              >
                <div className="space-y-1.5">
                  {diff.scoreChanges.map((c, i) => {
                    const dt = deltaTone(c.delta, true)
                    return (
                      <div
                        key={`${c.routeId}-${c.field}-${i}`}
                        className="flex items-center justify-between gap-2 rounded-lg border border-border/50 bg-background/40 px-3 py-2"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-medium">{c.label}</p>
                          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                            {prettyField(c.field)}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <span className="font-mono text-xs text-muted-foreground">{c.oldValue}</span>
                          <ArrowRight className="h-3 w-3 text-muted-foreground" />
                          <span className="font-mono text-xs font-semibold">{c.newValue}</span>
                          <span className={cn('inline-flex items-center gap-0.5 text-[11px] font-medium tabular-nums', dt.cls)}>
                            <dt.Icon className="h-3 w-3" />
                            {c.delta > 0 ? '+' : ''}{c.delta}
                          </span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </DiffSection>
            )}

            {/* Cost changes */}
            {diff.costChanges.length > 0 && (
              <DiffSection
                title="Cost changes"
                icon={DollarSign}
                count={diff.costChanges.length}
                tone="neutral"
              >
                <div className="space-y-1.5">
                  {diff.costChanges.map((c, i) => {
                    const dt = deltaTone(c.delta, false) // lower cost is better
                    return (
                      <div
                        key={`${c.routeId}-${i}`}
                        className="flex items-center justify-between gap-2 rounded-lg border border-border/50 bg-background/40 px-3 py-2"
                      >
                        <span className="truncate text-xs font-medium">{c.label}</span>
                        <div className="flex shrink-0 items-center gap-2">
                          <span className="font-mono text-xs text-muted-foreground">{formatUsd(c.oldValue)}</span>
                          <ArrowRight className="h-3 w-3 text-muted-foreground" />
                          <span className="font-mono text-xs font-semibold">{formatUsd(c.newValue)}</span>
                          <span className={cn('inline-flex items-center gap-0.5 text-[11px] font-medium tabular-nums', dt.cls)}>
                            <dt.Icon className="h-3 w-3" />
                            {formatSignedUsd(c.delta)}
                          </span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </DiffSection>
            )}

            {/* Timeline changes */}
            {diff.timelineChanges.length > 0 && (
              <DiffSection
                title="Timeline changes"
                icon={Clock}
                count={diff.timelineChanges.length}
                tone="neutral"
              >
                <div className="space-y-1.5">
                  {diff.timelineChanges.map((c, i) => {
                    const dt = deltaTone(c.delta, false) // shorter is better
                    return (
                      <div
                        key={`${c.routeId}-${i}`}
                        className="flex items-center justify-between gap-2 rounded-lg border border-border/50 bg-background/40 px-3 py-2"
                      >
                        <span className="truncate text-xs font-medium">{c.label}</span>
                        <div className="flex shrink-0 items-center gap-2">
                          <span className="font-mono text-xs text-muted-foreground">{formatMonths(c.oldMonths)}</span>
                          <ArrowRight className="h-3 w-3 text-muted-foreground" />
                          <span className="font-mono text-xs font-semibold">{formatMonths(c.newMonths)}</span>
                          <span className={cn('inline-flex items-center gap-0.5 text-[11px] font-medium tabular-nums', dt.cls)}>
                            <dt.Icon className="h-3 w-3" />
                            {formatSignedMonths(c.delta)}
                          </span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </DiffSection>
            )}

            {/* New + resolved blockers, side by side */}
            <div className="grid gap-4 sm:grid-cols-2">
              {diff.newBlockers.length > 0 && (
                <DiffSection
                  title="New blockers"
                  icon={ShieldAlert}
                  count={diff.newBlockers.length}
                  tone="destructive"
                >
                  <div className="space-y-1.5">
                    {diff.newBlockers.map((b, i) => (
                      <div
                        key={`${b.routeId}-${i}`}
                        className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2"
                      >
                        <p className="truncate text-xs font-medium">{b.label}</p>
                        <p className="mt-0.5 flex items-center gap-1 text-[11px] text-destructive">
                          <Lock className="h-2.5 w-2.5" />
                          {b.blocker}
                        </p>
                      </div>
                    ))}
                  </div>
                </DiffSection>
              )}

              {diff.resolvedBlockers.length > 0 && (
                <DiffSection
                  title="Resolved blockers"
                  icon={ShieldCheck}
                  count={diff.resolvedBlockers.length}
                  tone="primary"
                >
                  <div className="space-y-1.5">
                    {diff.resolvedBlockers.map((b, i) => (
                      <div
                        key={`${b.routeId}-${i}`}
                        className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2"
                      >
                        <p className="truncate text-xs font-medium">{b.label}</p>
                        <p className="mt-0.5 flex items-center gap-1 text-[11px] text-emerald-700 dark:text-emerald-400">
                          <CheckCircle2 className="h-2.5 w-2.5" />
                          {b.blocker}
                        </p>
                      </div>
                    ))}
                  </div>
                </DiffSection>
              )}
            </div>

            <Separator />

            <p className="text-[10px] text-muted-foreground">
              Computed deterministically by{' '}
              <code className="font-mono">diffPlans()</code>. The LLM never calculates this diff —
              it may only summarize it afterward.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ===========================================================================
// Sub-components
// ===========================================================================

function BeforeAfterStrip({ oldPlan, newPlan }: { oldPlan: PlanSideMeta; newPlan: PlanSideMeta }) {
  return (
    <div className="grid gap-2 sm:grid-cols-[1fr_auto_1fr] sm:items-stretch">
      <SideCard label="From" meta={oldPlan} tone="muted" />
      <div className="flex items-center justify-center">
        <div className="flex h-8 w-8 items-center justify-center rounded-full border border-border/60 bg-background">
          <ArrowRight className="h-4 w-4 text-muted-foreground" />
        </div>
      </div>
      <SideCard label="To" meta={newPlan} tone="primary" />
    </div>
  )
}

function SideCard({
  label,
  meta,
  tone,
}: {
  label: string
  meta: PlanSideMeta
  tone: 'muted' | 'primary'
}) {
  const isPrimary = tone === 'primary'
  return (
    <div
      className={cn(
        'rounded-lg border p-3',
        isPrimary
          ? 'border-primary/30 bg-primary/5'
          : 'border-border/60 bg-background/40',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className={cn('text-[10px] font-medium uppercase tracking-wider', isPrimary ? 'text-primary' : 'text-muted-foreground')}>
          {label}
        </span>
        <Badge variant="outline" className="gap-1 text-[10px] font-normal">
          <GitBranch className="h-2.5 w-2.5" />
          v{shortVersion(meta.policyVersion)}
        </Badge>
      </div>
      <p className="mt-1.5 truncate text-sm font-semibold">
        {meta.bestRoute ?? 'Unknown route'}
      </p>
      <p className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
        <Clock className="h-2.5 w-2.5" />
        {formatDateShort(meta.createdAt)}
      </p>
      <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
        {meta.recordId}
      </p>
    </div>
  )
}

function BestRouteCallout({ diff }: { diff: PlanDiff }) {
  if (!diff.bestRouteChanged) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2.5">
        <Crown className="h-4 w-4 shrink-0 text-primary" />
        <div className="min-w-0">
          <p className="text-sm font-medium">Best route unchanged</p>
          <p className="truncate text-[11px] text-muted-foreground">
            Recommendation stayed on <span className="font-medium text-foreground">{diff.newBestRoute ?? '—'}</span>.
          </p>
        </div>
      </div>
    )
  }
  return (
    <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-4 py-3">
      <div className="flex items-start gap-2.5">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-amber-500/15 text-amber-700 dark:text-amber-400">
          <Crown className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
            Best route changed
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded-md border border-border/60 bg-background/60 px-2 py-1 font-medium">
              {diff.previousBestRoute ?? '—'}
            </span>
            <ArrowRight className="h-3.5 w-3.5 text-amber-700 dark:text-amber-400" />
            <span className="rounded-md border border-primary/30 bg-primary/10 px-2 py-1 font-semibold text-primary">
              {diff.newBestRoute ?? '—'}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

function RoutesOpenedClosed({ diff }: { diff: PlanDiff }) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 bg-background/30 px-3 py-2.5">
      {diff.routesOpened.length > 0 && (
        <div className="flex items-center gap-1.5">
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-700 dark:text-emerald-400" />
          <span className="text-[11px] text-muted-foreground">
            <span className="font-semibold text-foreground">{diff.routesOpened.length}</span>
            {' '}route{diff.routesOpened.length !== 1 ? 's' : ''} opened
          </span>
          <div className="flex flex-wrap gap-1">
            {diff.routesOpened.slice(0, 4).map((id) => (
              <Badge key={id} variant="outline" className="border-emerald-500/40 text-[9px] font-normal text-emerald-700 dark:text-emerald-400">
                {id.replace('route-', '')}
              </Badge>
            ))}
            {diff.routesOpened.length > 4 && (
              <span className="text-[10px] text-muted-foreground">+{diff.routesOpened.length - 4} more</span>
            )}
          </div>
        </div>
      )}
      {diff.routesOpened.length > 0 && diff.routesClosed.length > 0 && (
        <Separator orientation="vertical" className="mx-1 h-4" />
      )}
      {diff.routesClosed.length > 0 && (
        <div className="flex items-center gap-1.5">
          <XCircle className="h-3.5 w-3.5 text-destructive" />
          <span className="text-[11px] text-muted-foreground">
            <span className="font-semibold text-foreground">{diff.routesClosed.length}</span>
            {' '}route{diff.routesClosed.length !== 1 ? 's' : ''} closed
          </span>
          <div className="flex flex-wrap gap-1">
            {diff.routesClosed.slice(0, 4).map((id) => (
              <Badge key={id} variant="outline" className="border-destructive/40 text-[9px] font-normal text-destructive">
                {id.replace('route-', '')}
              </Badge>
            ))}
            {diff.routesClosed.length > 4 && (
              <span className="text-[10px] text-muted-foreground">+{diff.routesClosed.length - 4} more</span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function DiffSection({
  title,
  icon: Icon,
  count,
  tone,
  children,
}: {
  title: string
  icon: IconType
  count: number
  tone: 'neutral' | 'destructive' | 'primary'
  children: React.ReactNode
}) {
  const toneCls = {
    neutral: 'text-primary bg-primary/10',
    destructive: 'text-destructive bg-destructive/10',
    primary: 'text-emerald-700 dark:text-emerald-400 bg-emerald-500/10',
  }[tone]
  return (
    <section className="rounded-xl border border-border/60 bg-card/40 p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={cn('flex h-6 w-6 items-center justify-center rounded', toneCls)}>
            <Icon className="h-3.5 w-3.5" />
          </span>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-foreground">
            {title}
          </h4>
        </div>
        <Badge variant="secondary" className="text-[10px] font-normal">{count}</Badge>
      </div>
      {children}
    </section>
  )
}

function DiffSkeleton() {
  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-[1fr_auto_1fr]">
        <div className="h-20 animate-pulse rounded-lg bg-muted" />
        <div className="hidden sm:block" />
        <div className="h-20 animate-pulse rounded-lg bg-muted" />
      </div>
      <div className="h-16 animate-pulse rounded-lg bg-muted" />
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="h-24 animate-pulse rounded-xl bg-muted" />
      ))}
    </div>
  )
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4">
      <div className="flex items-start gap-2.5">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-destructive">Couldn&apos;t compute the diff</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{message}</p>
          <Button
            size="sm"
            variant="outline"
            className="mt-2 h-7 gap-1 text-[11px]"
            onClick={onRetry}
          >
            <RefreshCw className="h-3 w-3" />
            Try again
          </Button>
        </div>
      </div>
    </div>
  )
}

function NoChangesState() {
  return (
    <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-5 text-center">
      <div className="mx-auto mb-2 flex h-9 w-9 items-center justify-center rounded-full bg-emerald-500/15">
        <FileText className="h-4 w-4 text-emerald-700 dark:text-emerald-400" />
      </div>
      <p className="text-sm font-medium">No material changes</p>
      <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
        The policy update did not affect your routes, scores, costs, timelines, or blockers.
        Your previous plan remains valid.
      </p>
    </div>
  )
}

export default PlanDiffView
