'use client'

// Wayfinder — Interactive Action Plan Section
//
// "What to do next" — displays recommended actions grouped by timeframe.
// Each action has interactive lifecycle controls:
//   NOT_STARTED → [Start]
//   IN_PROGRESS → [Mark complete] [Mark blocked]
//   BLOCKED → [Resume]
//   COMPLETE → ✓ Completed
//
// State-changing actions (degree recognition, language cert, etc.) show a
// confirmation dialog before updating the user's MobilityState.

import { useState, useEffect } from 'react'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import {
  Zap, Clock, DollarSign, Lock, ArrowUpRight, Calendar, CheckCircle2,
  Flame, AlertTriangle, Link2, Target, Sparkles, ListChecks, ArrowRight,
  Play, XCircle, Loader2, ChevronDown, ChevronUp,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useWayfinder } from '@/components/wayfinder/store'
import type {
  ActionPlan,
  Action,
  ActionTimeframe,
  BlockerAnalysis,
} from '@/lib/strategy/types'
import type { MobilityState } from '@/lib/domain/types'

type ActionStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETE' | 'BLOCKED' | 'CANCELLED'

// Actions that can change the user's mobility state when completed
const STATE_CHANGING_ACTIONS = [
  'credential', 'recognition', 'degree', 'language', 'german', 'english',
  'employer', 'offer', 'income', 'savings', 'business', 'founder',
]

function isStateChanging(action: Action): boolean {
  const text = (action.title + ' ' + action.description).toLowerCase()
  return STATE_CHANGING_ACTIONS.some((k) => text.includes(k))
}

/** Determine what state field an action changes and build the updated state. */
function buildStateChange(action: Action, currentState: MobilityState): { field: string; newValue: unknown; updatedState: MobilityState } | null {
  const text = (action.title + ' ' + action.description).toLowerCase()
  const updated: MobilityState = JSON.parse(JSON.stringify(currentState))

  if (text.includes('degree') && text.includes('recogn')) {
    const cur = updated.credentialRecognizedIn.value
    if (!cur.includes('DE')) {
      updated.credentialRecognizedIn = { ...updated.credentialRecognizedIn, value: [...cur, 'DE'] }
      return { field: 'credentialRecognizedIn', newValue: 'DE', updatedState: updated }
    }
  }
  if (text.includes('german') && (text.includes('b1') || text.includes('language'))) {
    const existing = updated.languages.value.find((l) => l.language === 'de')
    if (!existing || existing.cefr === 'A1' || existing.cefr === 'A2') {
      updated.languages = {
        ...updated.languages,
        value: [...updated.languages.value.filter((l) => l.language !== 'de'), { language: 'de', cefr: 'B1' }],
      }
      return { field: 'languages', newValue: 'de-B1', updatedState: updated }
    }
  }
  if (text.includes('employer') || text.includes('offer')) {
    updated.employerSponsorshipLikely = { ...updated.employerSponsorshipLikely, value: true }
    return { field: 'employerSponsorshipLikely', newValue: true, updatedState: updated }
  }
  if (text.includes('business') || text.includes('founder')) {
    updated.founderStatus = { ...updated.founderStatus, value: 'active_founder' }
    updated.businessStage = { ...updated.businessStage, value: 'pre_revenue' }
    return { field: 'founderStatus', newValue: 'active_founder', updatedState: updated }
  }

  return null
}

// ---------------------------------------------------------------------------
// Timeframe metadata
// ---------------------------------------------------------------------------

type IconType = React.ComponentType<{ className?: string }>
const TIMEFRAME_ORDER: ActionTimeframe[] = ['7_DAYS', '30_DAYS', '90_DAYS', '6_MONTHS', 'ONGOING']
const TIMEFRAME_META: Record<ActionTimeframe, { label: string; cls: string; Icon: IconType }> = {
  '7_DAYS': { label: 'This week', cls: 'border-emerald-500/40 text-emerald-700 dark:text-emerald-400 bg-emerald-500/5', Icon: Flame },
  '30_DAYS': { label: 'This month', cls: 'border-blue-500/40 text-blue-700 dark:text-blue-300 bg-blue-500/5', Icon: Calendar },
  '90_DAYS': { label: 'This quarter', cls: 'border-amber-500/40 text-amber-700 dark:text-amber-400 bg-amber-500/5', Icon: Calendar },
  '6_MONTHS': { label: 'Next 6 months', cls: 'border-orange-500/40 text-orange-700 dark:text-orange-400 bg-orange-500/5', Icon: Calendar },
  'ONGOING': { label: 'Ongoing', cls: 'border-muted-foreground/40 text-muted-foreground bg-muted/20', Icon: ArrowRight },
}

function formatUsd(n?: number): string {
  if (n == null || !Number.isFinite(n)) return '—'
  if (n === 0) return 'Free'
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`
  return `$${n.toLocaleString()}`
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface ActionPlanSectionProps {
  plan: ActionPlan
  blockers?: BlockerAnalysis[]
  className?: string
}

export function ActionPlanSection({ plan, blockers, className }: ActionPlanSectionProps) {
  if (!plan) return <ActionPlanSectionSkeleton className={className} />

  const actions = plan.actions ?? []
  const highestLeverageId = plan.highestLeverageAction?.id

  const groups: { timeframe: ActionTimeframe; items: Action[] }[] = TIMEFRAME_ORDER
    .map((tf) => ({ timeframe: tf, items: actions.filter((a) => a.timeframe === tf) }))
    .filter((g) => g.items.length > 0)

  const knownTimeframes = new Set<ActionTimeframe>(TIMEFRAME_ORDER)
  const others = actions.filter((a) => !knownTimeframes.has(a.timeframe))
  if (others.length > 0) groups.push({ timeframe: 'ONGOING', items: others })

  const blockerMap = new Map<string, BlockerAnalysis>()
  for (const b of blockers ?? []) blockerMap.set(b.blockerId, b)

  return (
    <Card className={cn('wf-panel border-border/60 bg-card/60 p-4 sm:p-5', className)}>
      <div className="mb-3 flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/15 text-primary">
          <Zap className="h-4 w-4" />
        </span>
        <div>
          <h3 className="text-sm font-semibold leading-tight">What to do next</h3>
          <p className="text-[11px] text-muted-foreground">
            {plan.summary || `${actions.length} action${actions.length === 1 ? '' : 's'} sequenced by impact.`}
          </p>
        </div>
      </div>

      {actions.length === 0 ? (
        <EmptyState />
      ) : (
        <ScrollArea className="wf-scroll max-h-[42rem] pr-3">
          <div className="space-y-4">
            {groups.map((group) => {
              const meta = TIMEFRAME_META[group.timeframe] ?? TIMEFRAME_META.ONGOING
              return (
                <div key={group.timeframe}>
                  <div className="mb-2 flex items-center gap-2">
                    <span className={cn('inline-flex h-5 items-center gap-1 rounded-md border px-1.5 text-[10px] font-semibold uppercase tracking-wider', meta.cls)}>
                      <meta.Icon className="h-2.5 w-2.5" />
                      {meta.label}
                    </span>
                    <span className="text-[10px] text-muted-foreground">{group.items.length} action{group.items.length === 1 ? '' : 's'}</span>
                    <div className="h-px flex-1 bg-border/40" />
                  </div>
                  <div className="space-y-2">
                    {group.items.map((a) => (
                      <InteractiveActionCard
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
// Interactive Action Card
// ---------------------------------------------------------------------------

function InteractiveActionCard({
  action,
  isHighestLeverage,
  blockerMap,
}: {
  action: Action
  isHighestLeverage: boolean
  blockerMap: Map<string, BlockerAnalysis>
}) {
  const updateActionStatus = useWayfinder((s) => s.updateActionStatus)
  const mobilityState = useWayfinder((s) => s.mobilityState)
  const [status, setStatus] = useState<ActionStatus>('NOT_STARTED')
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [showStateDialog, setShowStateDialog] = useState(false)

  // Load persisted status from the DB
  useEffect(() => {
    let cancelled = false
    fetch('/api/actions')
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (cancelled || !data?.actions) return
        const existing = data.actions.find((a: any) => a.actionId === action.id)
        if (existing) setStatus(existing.status as ActionStatus)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [action.id])

  const pct = Math.max(0, Math.min(100, Math.round((action.impact ?? 0) * 100)))
  const addressedBlocker = action.addressesBlockerId ? blockerMap.get(action.addressesBlockerId) : undefined
  const stateChanging = isStateChanging(action)

  const handleStart = async () => {
    setLoading(true)
    setStatus('IN_PROGRESS')
    await updateActionStatus(action.id, 'IN_PROGRESS')
    setLoading(false)
  }

  const handleComplete = async () => {
    if (stateChanging && mobilityState) {
      setShowStateDialog(true)
    } else {
      setLoading(true)
      setStatus('COMPLETE')
      await updateActionStatus(action.id, 'COMPLETE')
      setLoading(false)
    }
  }

  const handleConfirmStateChange = async () => {
    if (!mobilityState) return
    const change = buildStateChange(action, mobilityState)
    setLoading(true)
    setStatus('COMPLETE')
    setShowStateDialog(false)
    await updateActionStatus(action.id, 'COMPLETE', change ?? undefined)
    setLoading(false)
  }

  const handleBlock = async () => {
    setLoading(true)
    setStatus('BLOCKED')
    await updateActionStatus(action.id, 'BLOCKED', undefined)
    setLoading(false)
  }

  const handleResume = async () => {
    setLoading(true)
    setStatus('IN_PROGRESS')
    await updateActionStatus(action.id, 'IN_PROGRESS')
    setLoading(false)
  }

  // Check dependencies
  const depsIncomplete = action.dependsOn && action.dependsOn.length > 0

  return (
    <>
      <div
        className={cn(
          'rounded-xl border p-3 transition-colors',
          isHighestLeverage
            ? 'border-amber-500/50 bg-amber-500/[0.05] ring-1 ring-amber-500/20'
            : 'border-border/60 bg-card/50 hover:bg-card',
          status === 'COMPLETE' && 'opacity-70',
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
                {status === 'COMPLETE' && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />}
                {action.title}
                {isHighestLeverage && (
                  <span className="rounded bg-amber-500/15 px-1 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400">
                    Highest leverage
                  </span>
                )}
              </p>
              {action.description && (
                <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{action.description}</p>
              )}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {action.timeSensitive && status !== 'COMPLETE' && (
              <Badge variant="outline" className="gap-1 border-destructive/40 bg-destructive/5 text-[9px] font-medium text-destructive">
                <AlertTriangle className="h-2.5 w-2.5" /> Urgent
              </Badge>
            )}
            <button
              onClick={() => setExpanded((e) => !e)}
              className="rounded-md p-1 text-muted-foreground hover:bg-muted"
              aria-label={expanded ? 'Collapse' : 'Expand'}
            >
              {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>

        {/* Impact bar */}
        <div className="mt-2.5">
          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1"><Target className="h-2.5 w-2.5" /> Impact on viability</span>
            <span className="font-medium text-foreground/80">{pct}%</span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className={cn('h-full rounded-full', pct >= 75 ? 'bg-emerald-500' : pct >= 50 ? 'bg-primary' : pct >= 25 ? 'bg-amber-500' : 'bg-muted-foreground/60')}
              style={{ width: `${Math.max(2, pct)}%` }}
            />
          </div>
        </div>

        {/* Meta strip */}
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-border/40 pt-2">
          {action.estimatedCostUSD != null && (
            <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
              <DollarSign className="h-2.5 w-2.5" /> {formatUsd(action.estimatedCostUSD)}
            </span>
          )}
          {addressedBlocker && (
            <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
              <Link2 className="h-2.5 w-2.5" /> Addresses: <span className="font-medium text-foreground/80">{addressedBlocker.label}</span>
            </span>
          )}
          {action.trajectoryStep != null && (
            <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
              <ArrowUpRight className="h-2.5 w-2.5" /> Step {action.trajectoryStep}
            </span>
          )}
          {action.reversible && (
            <Badge variant="outline" className="gap-1 text-[9px] font-normal border-emerald-500/30 text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="h-2 w-2" /> Reversible
            </Badge>
          )}
          {depsIncomplete && (
            <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
              <Lock className="h-2.5 w-2.5" /> Depends on {action.dependsOn!.length} action{action.dependsOn!.length > 1 ? 's' : ''}
            </span>
          )}
        </div>

        {/* Expanded details */}
        {expanded && (
          <div className="mt-2 space-y-1 border-t border-border/40 pt-2 text-[11px] text-muted-foreground">
            {addressedBlocker && (
              <p><span className="font-medium text-foreground/80">Why it matters:</span> Resolves "{addressedBlocker.label}" — {addressedBlocker.reason}</p>
            )}
            {stateChanging && (
              <p className="text-amber-700 dark:text-amber-400">
                <Sparkles className="mr-1 inline h-2.5 w-2.5" />
                Completing this action may change your profile and open new routes.
              </p>
            )}
          </div>
        )}

        {/* Action buttons — based on status */}
        <div className="mt-2.5 flex flex-wrap gap-2">
          {status === 'NOT_STARTED' && (
            <Button size="sm" disabled={loading || depsIncomplete} onClick={handleStart} className="gap-1.5 text-xs">
              {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
              Start
            </Button>
          )}
          {status === 'IN_PROGRESS' && (
            <>
              <Button size="sm" disabled={loading} onClick={handleComplete} className="gap-1.5 text-xs">
                {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                Mark complete
              </Button>
              <Button size="sm" variant="outline" disabled={loading} onClick={handleBlock} className="gap-1.5 text-xs">
                <XCircle className="h-3 w-3" /> Mark blocked
              </Button>
            </>
          )}
          {status === 'BLOCKED' && (
            <Button size="sm" variant="outline" disabled={loading} onClick={handleResume} className="gap-1.5 text-xs">
              <Play className="h-3 w-3" /> Resume
            </Button>
          )}
          {status === 'COMPLETE' && (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="h-3.5 w-3.5" /> Completed
            </span>
          )}
          {status === 'CANCELLED' && (
            <span className="text-xs text-muted-foreground">Cancelled</span>
          )}
        </div>
      </div>

      {/* State change confirmation dialog */}
      <Dialog open={showStateDialog} onOpenChange={setShowStateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Did this change actually happen?</DialogTitle>
            <DialogDescription>
              Completing "{action.title}" may update your mobility profile. Confirm to create a new state snapshot and recompute your strategy.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs">
            <p className="font-medium text-amber-700 dark:text-amber-400">This will:</p>
            <ul className="mt-1 space-y-0.5 text-muted-foreground">
              <li>• Create a new immutable MobilityStateSnapshot</li>
              <li>• Recompute your strategy against the updated profile</li>
              <li>• Show you new routes that may have opened</li>
            </ul>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowStateDialog(false)}>Not yet</Button>
            <Button onClick={handleConfirmStateChange} className="gap-1.5">
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
              Yes, update my profile
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

// ---------------------------------------------------------------------------
// Skeleton + Empty State
// ---------------------------------------------------------------------------

function EmptyState() {
  return (
    <div className="rounded-lg border border-dashed border-border/60 bg-background/30 px-4 py-8 text-center">
      <div className="mx-auto mb-2 flex h-9 w-9 items-center justify-center rounded-full bg-muted/50">
        <ListChecks className="h-4 w-4 text-muted-foreground" />
      </div>
      <p className="text-sm font-medium">No actions to take</p>
      <p className="mx-auto mt-1 max-w-xs text-xs text-muted-foreground">
        Your trajectory is executable today — no blockers to resolve.
      </p>
    </div>
  )
}

export function ActionPlanSectionSkeleton({ className }: { className?: string }) {
  return (
    <Card className={cn('wf-panel border-border/60 bg-card/60 p-4', className)}>
      <div className="mb-3 flex items-center gap-2">
        <div className="h-8 w-8 animate-pulse rounded-lg bg-muted" />
        <div>
          <div className="h-3.5 w-28 animate-pulse rounded bg-muted" />
          <div className="mt-1 h-2.5 w-44 animate-pulse rounded bg-muted" />
        </div>
      </div>
      <div className="space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i}>
            <div className="mb-2 h-5 w-20 animate-pulse rounded bg-muted" />
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
