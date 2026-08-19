'use client'

// Wayfinder — Strategy History Timeline (N0.2 Strategy Memory)
//
// Fetches /api/strategy/history and renders a vertical timeline of every
// strategy change for this user (+ optional objective filter). Each entry
// shows:
//   - date
//   - change cause (USER_PROFILE_CHANGED, POLICY_CHANGED, etc.)
//   - deterministic explanation
//   - best trajectory + destination
//   - provenance (state v, intent v, policy hash, engine)
//   - diff summary (what changed)
//   - actions: inspect, compare with current, replay, verify
//
// Historical entries are read-only. The timeline never mutates history.

import { useCallback, useEffect, useState } from 'react'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  History, RefreshCw, AlertTriangle, Compass, GitBranch, CheckCircle2,
  Archive, UserPlus, FileEdit, Sparkles, Eye, Clock, ShieldCheck, Cog,
  Layers, GitCompare, PlayCircle, FileSearch,
} from 'lucide-react'
import { cn } from '@/lib/utils'

export interface StrategyHistoryEntry {
  recordId: string
  createdAt: string
  planStatus: string
  objectiveId: string | null
  cause: string
  explanation: string
  previousRecordId: string | null
  stateVersion: number
  intentVersion: number
  runtimePolicyHash: string | null
  runtimePolicyVersion: string | null
  strategyEngineVersion: string | null
  mobilityStateSnapshotId: string | null
  intentRecordId: string | null
  policyPublicationId: string | null
  policyEventId: string | null
  bestTrajectoryLabel: string | null
  bestTrajectoryId: string | null
  destinationStatus: string | null
  totalMonths: number | null
  totalCostUSD: number | null
  blockersCount: number
  actionsCount: number
  diffSummary: {
    bestTrajectoryChanged: boolean
    blockersChanged: boolean
    actionPlanChanged: boolean
    policyContextChanged: boolean
    engineChanged: boolean
    profileAnalysisChanged: boolean
    intentFrontierChanged: boolean
    differencesCount: number
    differences: { dimension: string; field: string; explanation: string }[]
  }
  previousBestTrajectoryLabel: string | null
}

interface StrategyHistoryProps {
  objectiveId?: string | null
  className?: string
  onSelectRecord?: (recordId: string) => void
  selectedRecordId?: string | null
}

type IconType = React.ComponentType<{ className?: string }>

const CAUSE_STYLE: Record<string, { label: string; cls: string; Icon: IconType }> = {
  USER_PROFILE_CHANGED: {
    label: 'Profile changed',
    cls: 'border-violet-500/40 text-violet-700 dark:text-violet-300 bg-violet-500/5',
    Icon: FileEdit,
  },
  USER_INTENT_CHANGED: {
    label: 'Priorities changed',
    cls: 'border-teal-500/40 text-teal-700 dark:text-teal-300 bg-teal-500/5',
    Icon: SlidersHorizontal,
  },
  OBJECTIVE_CHANGED: {
    label: 'Objective changed',
    cls: 'border-blue-500/40 text-blue-700 dark:text-blue-300 bg-blue-500/5',
    Icon: Compass,
  },
  POLICY_CHANGED: {
    label: 'Policy changed',
    cls: 'border-amber-500/40 text-amber-700 dark:text-amber-400 bg-amber-500/5',
    Icon: GitBranch,
  },
  ENGINE_CHANGED: {
    label: 'Engine updated',
    cls: 'border-blue-500/40 text-blue-700 dark:text-blue-300 bg-blue-500/5',
    Icon: Cog,
  },
  MANUAL_ADOPTION: {
    label: 'Adopted',
    cls: 'border-primary/40 text-primary bg-primary/5',
    Icon: UserPlus,
  },
  RECOMPUTATION: {
    label: 'Recomputed',
    cls: 'border-border/60 text-muted-foreground bg-background/40',
    Icon: RefreshCw,
  },
  UNKNOWN: {
    label: 'Created',
    cls: 'border-border/60 text-muted-foreground bg-background/40',
    Icon: Sparkles,
  },
}

function causeMeta(cause: string) {
  return CAUSE_STYLE[cause] ?? CAUSE_STYLE.UNKNOWN
}

// Import SlidersHorizontal here to avoid circular import in the const above
import { SlidersHorizontal } from 'lucide-react'

const STATUS_STYLE: Record<string, { label: string; cls: string; Icon: IconType }> = {
  ACTIVE: {
    label: 'Active',
    cls: 'bg-primary/15 text-primary border-primary/30',
    Icon: CheckCircle2,
  },
  SUPERSEDED: {
    label: 'Superseded',
    cls: 'border-muted-foreground/40 text-muted-foreground bg-muted/30',
    Icon: Archive,
  },
  ARCHIVED: {
    label: 'Archived',
    cls: 'border-muted-foreground/40 text-muted-foreground bg-muted/30',
    Icon: Archive,
  },
}

function statusMeta(status: string) {
  return STATUS_STYLE[status] ?? STATUS_STYLE.SUPERSEDED
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
  } catch {
    return iso
  }
}

function formatDuration(months: number | null): string {
  if (months == null || !Number.isFinite(months)) return '—'
  const y = Math.round((months / 12) * 10) / 10
  return y < 1 ? `${Math.round(months)} mo` : `${y} yr`
}

function formatCost(usd: number | null): string {
  if (usd == null || !Number.isFinite(usd)) return '—'
  if (usd >= 1000) return `$${(usd / 1000).toFixed(1)}k`
  return `$${usd}`
}

function shortHash(hash: string | null): string {
  if (!hash) return '—'
  return hash.length > 12 ? hash.slice(0, 12) + '…' : hash
}

export function StrategyHistory({
  objectiveId,
  className,
  onSelectRecord,
  selectedRecordId,
}: StrategyHistoryProps) {
  const [entries, setEntries] = useState<StrategyHistoryEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const url = objectiveId
        ? `/api/strategy/history?objectiveId=${encodeURIComponent(objectiveId)}`
        : '/api/strategy/history'
      const res = await fetch(url, { cache: 'no-store' })
      if (res.status === 401) {
        setError('Sign in to view your strategy history.')
        setEntries([])
        return
      }
      if (!res.ok) throw new Error(`Failed to load history (${res.status})`)
      const data = await res.json()
      setEntries(data.history ?? [])
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unknown error')
      setEntries([])
    } finally {
      setLoading(false)
    }
  }, [objectiveId])

  useEffect(() => {
    void load()
  }, [load])

  const activeCount = entries.filter((e) => e.planStatus === 'ACTIVE').length
  const policyChangeCount = entries.filter((e) => e.cause === 'POLICY_CHANGED').length

  return (
    <Card className={cn('border-border/60 bg-card/60 p-4 wf-panel', className)}>
      {/* Header */}
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/15 text-primary">
            <History className="h-4 w-4" />
          </span>
          <div>
            <h3 className="text-sm font-semibold leading-tight">Strategy history</h3>
            <p className="text-[11px] text-muted-foreground">
              Every strategy change, with the deterministic cause.
            </p>
          </div>
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 gap-1 px-2 text-[11px]"
          onClick={() => void load()}
          disabled={loading}
        >
          <RefreshCw className={cn('h-3 w-3', loading && 'animate-spin')} />
          Refresh
        </Button>
      </div>

      {/* Summary strip */}
      {entries.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          <Badge variant="outline" className="text-[10px] font-normal">
            <History className="h-2.5 w-2.5" /> {entries.length} version{entries.length !== 1 ? 's' : ''}
          </Badge>
          {activeCount > 0 && (
            <Badge variant="outline" className="gap-1 text-[10px] font-normal border-primary/30 text-primary">
              <CheckCircle2 className="h-2.5 w-2.5" /> {activeCount} active
            </Badge>
          )}
          {policyChangeCount > 0 && (
            <Badge variant="outline" className="gap-1 text-[10px] font-normal border-amber-500/40 text-amber-700 dark:text-amber-400">
              <GitBranch className="h-2.5 w-2.5" /> {policyChangeCount} policy-triggered
            </Badge>
          )}
        </div>
      )}

      {/* Body */}
      {loading ? (
        <HistorySkeleton />
      ) : error ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : entries.length === 0 ? (
        <EmptyState />
      ) : (
        <ScrollArea className="wf-scroll max-h-[40rem] pr-3">
          <ol className="relative">
            {/* vertical rail */}
            <div
              aria-hidden
              className="absolute bottom-2 left-[11px] top-2 w-px bg-gradient-to-b from-primary/40 via-border/60 to-transparent"
            />
            {entries.map((entry) => {
              const c = causeMeta(entry.cause)
              const s = statusMeta(entry.planStatus)
              const isSelected = entry.recordId === selectedRecordId
              const isActive = entry.planStatus === 'ACTIVE'
              const isPolicy = entry.cause === 'POLICY_CHANGED'
              return (
                <li key={entry.recordId} className="relative pl-7 pb-3 last:pb-0">
                  {/* dot */}
                  <span
                    aria-hidden
                    className={cn(
                      'absolute left-[5px] top-[14px] flex h-3.5 w-3.5 items-center justify-center rounded-full border-2 bg-background',
                      isActive
                        ? 'border-primary bg-primary/20'
                        : isPolicy
                          ? 'border-amber-500/60 bg-amber-500/10'
                          : 'border-border bg-background',
                    )}
                  >
                    {isActive && <span className="h-1.5 w-1.5 rounded-full bg-primary" />}
                  </span>

                  <button
                    type="button"
                    onClick={() => onSelectRecord?.(entry.recordId)}
                    className={cn(
                      'w-full rounded-xl border p-3 text-left transition-all',
                      isSelected
                        ? 'border-primary bg-primary/5 ring-1 ring-primary/20'
                        : isActive
                          ? 'border-primary/30 bg-primary/[0.03] hover:bg-primary/[0.06]'
                          : 'border-border/60 bg-card/50 hover:border-border hover:bg-card',
                    )}
                  >
                    {/* Top row: trajectory + status */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <Compass className={cn('h-3.5 w-3.5 shrink-0', isActive ? 'text-primary' : 'text-muted-foreground')} />
                        <p className="truncate text-sm font-semibold">
                          {entry.bestTrajectoryLabel || 'Unknown trajectory'}
                        </p>
                      </div>
                      <Badge variant="outline" className={cn('shrink-0 gap-1 text-[10px] font-medium', s.cls)}>
                        <s.Icon className="h-2.5 w-2.5" />
                        {s.label}
                      </Badge>
                    </div>

                    {/* Cause + explanation */}
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <Badge variant="outline" className={cn('gap-1 text-[10px] font-medium', c.cls)}>
                        <c.Icon className="h-2.5 w-2.5" />
                        {c.label}
                      </Badge>
                      <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                        <Clock className="h-2.5 w-2.5" />
                        {formatDate(entry.createdAt)}
                      </span>
                    </div>
                    <p className="mt-1.5 text-[11px] leading-snug text-foreground/80">
                      {entry.explanation}
                    </p>

                    {/* Provenance strip */}
                    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
                      <span className="inline-flex items-center gap-0.5">
                        <FileEdit className="h-2.5 w-2.5" /> state v{entry.stateVersion}
                      </span>
                      <span className="inline-flex items-center gap-0.5">
                        <SlidersHorizontal className="h-2.5 w-2.5" /> intent v{entry.intentVersion}
                      </span>
                      <span className="inline-flex items-center gap-0.5">
                        <ShieldCheck className="h-2.5 w-2.5" /> {shortHash(entry.runtimePolicyHash)}
                      </span>
                      {entry.strategyEngineVersion && (
                        <span className="inline-flex items-center gap-0.5">
                          <Cog className="h-2.5 w-2.5" /> {entry.strategyEngineVersion}
                        </span>
                      )}
                    </div>

                    {/* Diff summary */}
                    {entry.diffSummary.differencesCount > 0 && (
                      <div className="mt-2 flex flex-wrap items-center gap-1">
                        {entry.diffSummary.bestTrajectoryChanged && (
                          <Badge variant="outline" className="text-[9px] font-normal border-blue-500/30 text-blue-700 dark:text-blue-300">
                            trajectory
                          </Badge>
                        )}
                        {entry.diffSummary.blockersChanged && (
                          <Badge variant="outline" className="text-[9px] font-normal border-amber-500/30 text-amber-700 dark:text-amber-400">
                            blockers
                          </Badge>
                        )}
                        {entry.diffSummary.actionPlanChanged && (
                          <Badge variant="outline" className="text-[9px] font-normal border-teal-500/30 text-teal-700 dark:text-teal-300">
                            actions
                          </Badge>
                        )}
                        {entry.diffSummary.policyContextChanged && (
                          <Badge variant="outline" className="text-[9px] font-normal border-amber-500/30 text-amber-700 dark:text-amber-400">
                            policy
                          </Badge>
                        )}
                        {entry.diffSummary.engineChanged && (
                          <Badge variant="outline" className="text-[9px] font-normal border-blue-500/30 text-blue-700 dark:text-blue-300">
                            engine
                          </Badge>
                        )}
                      </div>
                    )}

                    {/* Footer: actions */}
                    <div className="mt-2 flex items-center justify-between border-t border-border/40 pt-2">
                      <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                        <span>{formatDuration(entry.totalMonths)}</span>
                        <span>·</span>
                        <span>{formatCost(entry.totalCostUSD)}</span>
                        <span>·</span>
                        <span>{entry.blockersCount} blocker{entry.blockersCount !== 1 ? 's' : ''}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={(ev) => { ev.stopPropagation(); window.open(`/api/strategy/replay?recordId=${entry.recordId}`, '_blank') }}
                          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
                          title="Replay this strategy"
                        >
                          <PlayCircle className="h-3 w-3" /> Replay
                        </button>
                        <button
                          onClick={(ev) => { ev.stopPropagation(); window.open(`/api/strategy/replay?recordId=${entry.recordId}&mode=verify`, '_blank') }}
                          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
                          title="Verify this strategy"
                        >
                          <FileSearch className="h-3 w-3" /> Verify
                        </button>
                        {!isActive && (
                          <button
                            onClick={(ev) => { ev.stopPropagation(); window.open(`/api/strategy/compare?recordId=${entry.recordId}`, '_blank') }}
                            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-primary hover:bg-primary/10"
                            title="Compare with current"
                          >
                            <GitCompare className="h-3 w-3" /> Compare
                          </button>
                        )}
                      </div>
                    </div>
                  </button>
                </li>
              )
            })}
          </ol>
        </ScrollArea>
      )}
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Sub-states
// ---------------------------------------------------------------------------

function HistorySkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="relative pl-7">
          <div className="absolute left-[5px] top-[14px] h-3.5 w-3.5 rounded-full border-2 border-border bg-background" />
          <div className="rounded-xl border border-border/60 bg-card/50 p-3">
            <div className="flex items-center justify-between">
              <div className="h-3.5 w-40 animate-pulse rounded bg-muted" />
              <div className="h-4 w-16 animate-pulse rounded bg-muted" />
            </div>
            <div className="mt-2 flex gap-1.5">
              <div className="h-4 w-20 animate-pulse rounded bg-muted" />
              <div className="h-4 w-28 animate-pulse rounded bg-muted" />
            </div>
          </div>
        </div>
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
          <p className="text-sm font-medium text-destructive">Couldn&apos;t load history</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{message}</p>
          <Button size="sm" variant="outline" className="mt-2 h-7 gap-1 text-[11px]" onClick={onRetry}>
            <RefreshCw className="h-3 w-3" /> Try again
          </Button>
        </div>
      </div>
    </div>
  )
}

function EmptyState() {
  return (
    <div className="rounded-lg border border-dashed border-border/60 bg-background/30 px-4 py-8 text-center">
      <div className="mx-auto mb-2 flex h-9 w-9 items-center justify-center rounded-full bg-muted/50">
        <History className="h-4 w-4 text-muted-foreground" />
      </div>
      <p className="text-sm font-medium">No strategy history yet</p>
      <p className="mx-auto mt-1 max-w-xs text-xs text-muted-foreground">
        Adopt a strategy and each version will appear here — with the deterministic cause of every change.
      </p>
    </div>
  )
}

export default StrategyHistory
