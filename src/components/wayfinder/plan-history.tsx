'use client'

// Wayfinder — Plan History Timeline
//
// Fetches /api/plans/history and renders a vertical timeline of plan
// versions. Each entry shows: date, best route label, trigger (intake
// vs POLICY_CHANGE vs edit/counterfactual), and status (ACTIVE/SUPERSEDED).
// The active plan is highlighted; clicking an old plan opens it read-only
// via the onSelectPlan callback.

import { useCallback, useEffect, useState } from 'react'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  History, RefreshCw, AlertTriangle, Compass, GitBranch, CheckCircle2,
  Archive, UserPlus, FileEdit, Sparkles, Eye, Clock,
} from 'lucide-react'
import { cn } from '@/lib/utils'

export interface PlanHistoryEntry {
  id: string
  createdAt: string
  trigger: string
  planStatus: string
  policyVersion: string
  runtimePolicyVersion?: string | null
  previousRecordId?: string | null
  policyPublicationId?: string | null
  bestRouteLabel: string
  bestRouteId: string
  asOfDate: string
}

interface PlanHistoryProps {
  /** Controlled selection. If omitted, the component manages its own. */
  selectedRecordId?: string | null
  /** Fired when the user clicks an entry. */
  onSelectPlan?: (recordId: string, entry: PlanHistoryEntry) => void
  className?: string
}

type IconType = React.ComponentType<{ className?: string }>

const TRIGGER_STYLE: Record<string, { label: string; cls: string; Icon: IconType }> = {
  intake: {
    label: 'Intake',
    cls: 'border-blue-500/40 text-blue-700 dark:text-blue-300 bg-blue-500/5',
    Icon: UserPlus,
  },
  edit: {
    label: 'Profile edit',
    cls: 'border-border/60 text-muted-foreground bg-background/40',
    Icon: FileEdit,
  },
  POLICY_CHANGE: {
    label: 'Policy change',
    cls: 'border-amber-500/40 text-amber-700 dark:text-amber-400 bg-amber-500/5',
    Icon: GitBranch,
  },
  counterfactual: {
    label: 'Counterfactual',
    cls: 'border-violet-500/40 text-violet-700 dark:text-violet-300 bg-violet-500/5',
    Icon: Sparkles,
  },
}

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

function triggerMeta(trigger: string) {
  return (
    TRIGGER_STYLE[trigger] ?? {
      label: trigger ?? 'Unknown',
      cls: 'border-border/60 text-muted-foreground bg-background/40',
      Icon: History,
    }
  )
}

function statusMeta(status: string) {
  return (
    STATUS_STYLE[status] ?? {
      label: status ?? 'Unknown',
      cls: 'border-border/60 text-muted-foreground bg-background/40',
      Icon: Archive,
    }
  )
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleString(undefined, {
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

function shortVersion(v?: string | null): string {
  if (!v) return '—'
  return v.length > 18 ? v.slice(0, 18) + '…' : v
}

export function PlanHistory({
  selectedRecordId,
  onSelectPlan,
  className,
}: PlanHistoryProps) {
  const [entries, setEntries] = useState<PlanHistoryEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [internalSelected, setInternalSelected] = useState<string | null>(null)

  const selectedId = selectedRecordId ?? internalSelected

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/plans/history', { cache: 'no-store' })
      if (res.status === 401) {
        setError('Sign in to view your plan history.')
        setEntries([])
        return
      }
      if (!res.ok) {
        throw new Error(`Failed to load history (${res.status})`)
      }
      const data = (await res.json()) as { plans?: PlanHistoryEntry[] }
      const plans = data.plans ?? []
      setEntries(plans)
      // Default selection: the active plan, or the newest entry.
      setInternalSelected((prev) => {
        if (prev) return prev
        const active = plans.find((p) => p.planStatus === 'ACTIVE')
        return (active ?? plans[0])?.id ?? null
      })
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unknown error')
      setEntries([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const handleSelect = (entry: PlanHistoryEntry) => {
    setInternalSelected(entry.id)
    onSelectPlan?.(entry.id, entry)
  }

  const activeCount = entries.filter((e) => e.planStatus === 'ACTIVE').length
  const policyChangeCount = entries.filter((e) => e.trigger === 'POLICY_CHANGE').length

  return (
    <Card className={cn('border-border/60 bg-card/60 p-4 wf-panel', className)}>
      {/* Header */}
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/15 text-primary">
            <History className="h-4 w-4" />
          </span>
          <div>
            <h3 className="text-sm font-semibold leading-tight">Plan history</h3>
            <p className="text-[11px] text-muted-foreground">
              Every saved version of your plan, newest first.
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
        <ScrollArea className="wf-scroll max-h-[34rem] pr-3">
          <ol className="relative">
            {/* vertical rail */}
            <div
              aria-hidden
              className="absolute bottom-2 left-[11px] top-2 w-px bg-gradient-to-b from-primary/40 via-border/60 to-transparent"
            />
            {entries.map((entry) => {
              const t = triggerMeta(entry.trigger)
              const s = statusMeta(entry.planStatus)
              const isSelected = entry.id === selectedId
              const isActive = entry.planStatus === 'ACTIVE'
              const isPolicy = entry.trigger === 'POLICY_CHANGE'
              return (
                <li
                  key={entry.id}
                  className="relative pl-7 pb-3 last:pb-0"
                >
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
                    {isActive && (
                      <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                    )}
                  </span>

                  <button
                    type="button"
                    onClick={() => handleSelect(entry)}
                    className={cn(
                      'w-full rounded-xl border p-3 text-left transition-all',
                      isSelected
                        ? 'border-primary bg-primary/5 ring-1 ring-primary/20'
                        : isActive
                          ? 'border-primary/30 bg-primary/[0.03] hover:bg-primary/[0.06]'
                          : 'border-border/60 bg-card/50 hover:border-border hover:bg-card',
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <Compass
                          className={cn(
                            'h-3.5 w-3.5 shrink-0',
                            isActive ? 'text-primary' : 'text-muted-foreground',
                          )}
                        />
                        <p className="truncate text-sm font-semibold">
                          {entry.bestRouteLabel || 'Unknown route'}
                        </p>
                      </div>
                      <Badge
                        variant="outline"
                        className={cn('shrink-0 gap-1 text-[10px] font-medium', s.cls)}
                      >
                        <s.Icon className="h-2.5 w-2.5" />
                        {s.label}
                      </Badge>
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <Badge
                        variant="outline"
                        className={cn('gap-1 text-[10px] font-normal', t.cls)}
                      >
                        <t.Icon className="h-2.5 w-2.5" />
                        {t.label}
                      </Badge>
                      <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                        <Clock className="h-2.5 w-2.5" />
                        {formatDate(entry.createdAt)}
                      </span>
                      <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                        <GitBranch className="h-2.5 w-2.5" />
                        v{shortVersion(entry.runtimePolicyVersion ?? entry.policyVersion)}
                      </span>
                    </div>

                    {/* Footer action */}
                    <div className="mt-2 flex items-center justify-between border-t border-border/40 pt-2">
                      <span className="text-[10px] text-muted-foreground">
                        {isSelected ? 'Viewing' : isActive ? 'Current plan' : 'Superseded'}
                      </span>
                      <span
                        className={cn(
                          'inline-flex items-center gap-1 text-[11px] font-medium',
                          isSelected ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
                        )}
                      >
                        <Eye className="h-3 w-3" />
                        {isSelected ? 'Selected' : 'View'}
                      </span>
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
        <div
          key={i}
          className="relative pl-7"
        >
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

function EmptyState() {
  return (
    <div className="rounded-lg border border-dashed border-border/60 bg-background/30 px-4 py-8 text-center">
      <div className="mx-auto mb-2 flex h-9 w-9 items-center justify-center rounded-full bg-muted/50">
        <History className="h-4 w-4 text-muted-foreground" />
      </div>
      <p className="text-sm font-medium">No saved plans yet</p>
      <p className="mx-auto mt-1 max-w-xs text-xs text-muted-foreground">
        Save your current plan to the decision ledger and each version will appear here —
        including policy-triggered recomputations.
      </p>
    </div>
  )
}

export default PlanHistory
