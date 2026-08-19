'use client'

// Wayfinder — Interactive Intent Frontier Section
//
// "Other ways you could optimize" — each objective card is now interactive.
// Clicking "Explore" computes the strategy for that objective and shows a
// comparison with the current strategy. The user can then "Make this my
// strategy" to adopt it.
//
// The active objective is highlighted. Explored objectives show a preview.
// Adoption calls adoptStrategy() which updates the intent + strategy in the
// store without destroying the old strategy.

import { useState } from 'react'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import {
  Compass, Crown, Clock, DollarSign, ShieldAlert, Network,
  TrendingUp, Flag, Home, Rocket, Globe2, Wallet, Sparkles,
  Target, ArrowRight, CheckCircle2, AlertTriangle, Lightbulb, Loader2,
  ArrowLeftRight,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useWayfinder } from '@/components/wayfinder/store'
import type { IntentFrontier, ObjectiveTrajectory, Strategy } from '@/lib/strategy/types'

type IconType = React.ComponentType<{ className?: string }>

const OBJECTIVE_META: Record<string, { label: string; Icon: IconType; tone: string }> = {
  income: { label: 'Maximize income', Icon: TrendingUp, tone: 'border-emerald-500/40 text-emerald-700 dark:text-emerald-400 bg-emerald-500/5' },
  residence: { label: 'Best residence trajectory', Icon: Home, tone: 'border-blue-500/40 text-blue-700 dark:text-blue-300 bg-blue-500/5' },
  citizenship: { label: 'Fastest citizenship', Icon: Flag, tone: 'border-amber-500/40 text-amber-700 dark:text-amber-400 bg-amber-500/5' },
  entrepreneurship: { label: 'Best for founders', Icon: Rocket, tone: 'border-orange-500/40 text-orange-700 dark:text-orange-400 bg-orange-500/5' },
  mobility: { label: 'Maximize global mobility', Icon: Globe2, tone: 'border-primary/40 text-primary bg-primary/5' },
  cost: { label: 'Lowest cost', Icon: Wallet, tone: 'border-muted-foreground/40 text-muted-foreground bg-muted/20' },
}

function objectiveMeta(objective: string) {
  return OBJECTIVE_META[objective] ?? {
    label: objective.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
    Icon: Target, tone: 'border-border/60 text-muted-foreground bg-background/40',
  }
}

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

const RISK_STYLE: Record<string, string> = {
  low: 'border-emerald-500/40 text-emerald-700 dark:text-emerald-400',
  medium: 'border-amber-500/40 text-amber-700 dark:text-amber-400',
  high: 'border-destructive/40 text-destructive',
}

export interface AlternativeIntent {
  title: string
  rationale: string
  tradeoffs: string[]
  mayBeSuperior: boolean
}

export interface IntentFrontierSectionProps {
  frontier: IntentFrontier
  alternativeIntents?: AlternativeIntent[]
  className?: string
}

export function IntentFrontierSection({ frontier, alternativeIntents, className }: IntentFrontierSectionProps) {
  const activeObjective = useWayfinder((s) => s.activeObjective)
  const exploredObjective = useWayfinder((s) => s.exploredObjective)
  const exploredStrategy = useWayfinder((s) => s.exploredStrategy)
  const exploreObjective = useWayfinder((s) => s.exploreObjective)
  const adoptStrategy = useWayfinder((s) => s.adoptStrategy)
  const clearExplored = useWayfinder((s) => s.clearExplored)
  const strategyLoading = useWayfinder((s) => s.strategyLoading)
  const currentStrategy = useWayfinder((s) => s.strategy)

  const [showAdoptDialog, setShowAdoptDialog] = useState(false)

  if (!frontier) return <IntentFrontierSectionSkeleton className={className} />

  const points = frontier.points ?? []
  const distinct = frontier.distinctStrategies ?? []
  const distinctIds = new Set(distinct.map((p) => p.bestTrajectoryId))

  const handleExplore = (objective: string) => {
    if (exploredObjective === objective) {
      clearExplored()
    } else {
      exploreObjective(objective)
    }
  }

  const handleAdopt = () => {
    if (exploredObjective) {
      adoptStrategy(exploredObjective)
      setShowAdoptDialog(false)
    }
  }

  return (
    <Card className={cn('wf-panel border-border/60 bg-card/60 p-4 sm:p-5', className)}>
      {/* Header */}
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/15 text-primary">
            <Compass className="h-4 w-4" />
          </span>
          <div>
            <h3 className="text-sm font-semibold leading-tight">Other ways you could optimize</h3>
            <p className="text-[11px] text-muted-foreground">
              {points.length === 0 ? 'No objectives analyzed yet.' : `${points.length} objectives · ${distinct.length} distinct strategies`}
            </p>
          </div>
        </div>
        {activeObjective && (
          <Badge variant="outline" className="gap-1 border-primary/40 bg-primary/5 text-[10px] font-medium text-primary">
            <Crown className="h-2.5 w-2.5" /> Active: {objectiveMeta(activeObjective).label}
          </Badge>
        )}
      </div>

      {/* Frontier grid */}
      {points.length === 0 ? (
        <EmptyState message="No intent frontier available for this strategy." />
      ) : (
        <>
          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {points.map((p, i) => {
              const isActive = activeObjective === p.objective || (!activeObjective && p.isStated)
              const isExplored = exploredObjective === p.objective
              return (
                <ObjectiveCard
                  key={`${p.objective}-${i}`}
                  point={p}
                  isDistinct={distinctIds.has(p.bestTrajectoryId)}
                  isActive={isActive}
                  isExplored={isExplored}
                  onExplore={() => handleExplore(p.objective)}
                  onAdopt={() => setShowAdoptDialog(true)}
                  loading={strategyLoading && isExplored}
                />
              )
            })}
          </div>

          {/* Explored strategy comparison */}
          {exploredStrategy && exploredObjective && currentStrategy && (
            <StrategyComparison
              currentStrategy={currentStrategy}
              exploredStrategy={exploredStrategy}
              exploredObjective={exploredObjective}
              onAdopt={() => setShowAdoptDialog(true)}
              onDismiss={clearExplored}
            />
          )}

          {/* Alternative intents */}
          {alternativeIntents && alternativeIntents.length > 0 && (
            <>
              <Separator className="my-4 bg-border/50" />
              <div>
                <p className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  <Lightbulb className="h-3 w-3" /> Alternative intents worth considering
                </p>
                <ScrollArea className="wf-scroll mt-3 max-h-[20rem] pr-2">
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

      {/* Adoption dialog */}
      <Dialog open={showAdoptDialog} onOpenChange={setShowAdoptDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Adopt this strategy?</DialogTitle>
            <DialogDescription>
              {exploredObjective && (
                <>You are about to optimize for <strong>{objectiveMeta(exploredObjective).label}</strong> instead of your current objective.</>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {exploredStrategy && currentStrategy && (
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="rounded-lg border border-border/50 bg-muted/30 p-2">
                  <p className="font-medium text-muted-foreground">Current</p>
                  <p className="mt-1 font-semibold">{currentStrategy.bestTrajectory.label}</p>
                </div>
                <div className="rounded-lg border border-primary/30 bg-primary/5 p-2">
                  <p className="font-medium text-primary">New</p>
                  <p className="mt-1 font-semibold">{exploredStrategy.bestTrajectory.label}</p>
                </div>
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              Your previous strategy will be preserved in history. You can switch back at any time.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAdoptDialog(false)}>Cancel</Button>
            <Button onClick={handleAdopt} className="gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Make this my strategy
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Interactive Objective Card
// ---------------------------------------------------------------------------

function ObjectiveCard({
  point,
  isDistinct,
  isActive,
  isExplored,
  onExplore,
  onAdopt,
  loading,
}: {
  point: ObjectiveTrajectory
  isDistinct: boolean
  isActive: boolean
  isExplored: boolean
  onExplore: () => void
  onAdopt: () => void
  loading: boolean
}) {
  const meta = objectiveMeta(point.objective)
  const riskCls = RISK_STYLE[point.risk ?? 'medium'] ?? RISK_STYLE.medium

  return (
    <div
      className={cn(
        'rounded-xl border p-3 transition-colors',
        isActive
          ? 'border-primary/60 bg-primary/[0.05] ring-1 ring-primary/20'
          : isExplored
            ? 'border-amber-500/50 bg-amber-500/[0.05] ring-1 ring-amber-500/20'
            : isDistinct
              ? 'border-border/60 bg-card/50 hover:bg-card'
              : 'border-border/40 bg-card/30',
      )}
    >
      {/* Objective label + status */}
      <div className="flex items-start justify-between gap-1.5">
        <Badge variant="outline" className={cn('gap-1 px-1.5 py-0 text-[10px] font-medium', meta.tone)}>
          <meta.Icon className="h-2.5 w-2.5" /> {meta.label}
        </Badge>
        {isActive ? (
          <Badge variant="outline" className="shrink-0 gap-0.5 border-primary/50 bg-primary/10 px-1 py-0 text-[9px] font-bold uppercase tracking-wider text-primary">
            <Crown className="h-2 w-2" /> Active
          </Badge>
        ) : isExplored ? (
          <Badge variant="outline" className="shrink-0 gap-0.5 border-amber-500/50 bg-amber-500/10 px-1 py-0 text-[9px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400">
            <Sparkles className="h-2 w-2" /> Exploring
          </Badge>
        ) : null}
      </div>

      {/* Best trajectory */}
      <p className="mt-2 text-[12px] font-semibold leading-tight">{point.bestTrajectoryLabel || '—'}</p>

      {/* Metrics */}
      <div className="mt-2.5 grid grid-cols-2 gap-1.5">
        <Metric icon={<DollarSign className="h-2.5 w-2.5" />} label="Cost" value={formatUsd(point.cost)} />
        <Metric icon={<Clock className="h-2.5 w-2.5" />} label="Time" value={formatMonths(point.timeMonths)} />
        <Metric icon={<ShieldAlert className="h-2.5 w-2.5" />} label="Risk" value={point.risk} valueCls={riskCls} />
        <Metric icon={<Network className="h-2.5 w-2.5" />} label="Options" value={String(point.optionality)} />
      </div>

      {/* Action button */}
      <div className="mt-2.5 border-t border-border/40 pt-2">
        {isActive ? (
          <span className="inline-flex items-center gap-1 text-[10px] font-medium text-primary">
            <CheckCircle2 className="h-3 w-3" /> Your current strategy
          </span>
        ) : (
          <Button
            size="sm"
            variant={isExplored ? 'default' : 'outline'}
            disabled={loading}
            onClick={onExplore}
            className="h-7 w-full gap-1.5 text-[10px]"
          >
            {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : isExplored ? <ArrowLeftRight className="h-3 w-3" /> : <Compass className="h-3 w-3" />}
            {isExplored ? 'Comparing' : 'Explore'}
          </Button>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Strategy Comparison
// ---------------------------------------------------------------------------

function StrategyComparison({
  currentStrategy,
  exploredStrategy,
  exploredObjective,
  onAdopt,
  onDismiss,
}: {
  currentStrategy: Strategy
  exploredStrategy: Strategy
  exploredObjective: string
  onAdopt: () => void
  onDismiss: () => void
}) {
  const meta = objectiveMeta(exploredObjective)
  const cur = currentStrategy.bestTrajectory
  const exp = exploredStrategy.bestTrajectory

  const dimensions = [
    { label: 'Trajectory', current: cur.label, explored: exp.label },
    { label: 'Duration', current: formatMonths(cur.totalMonths), explored: formatMonths(exp.totalMonths) },
    { label: 'Cost', current: formatUsd(cur.totalCostUSD), explored: formatUsd(exp.totalCostUSD) },
    { label: 'Optionality', current: String(cur.downstreamOptionality), explored: String(exp.downstreamOptionality) },
    { label: 'Reversibility', current: cur.reversibility, explored: exp.reversibility },
    { label: 'Risk', current: cur.risk, explored: exp.risk },
    { label: 'Blockers', current: String(currentStrategy.blockers.length), explored: String(exploredStrategy.blockers.length) },
  ]

  return (
    <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/[0.03] p-3">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className={cn('flex h-7 w-7 items-center justify-center rounded-lg border', meta.tone)}>
            <meta.Icon className="h-3.5 w-3.5" />
          </span>
          <div>
            <p className="text-xs font-semibold">If you optimize for {meta.label.toLowerCase()}</p>
            <p className="text-[10px] text-muted-foreground">Strategy comparison — deterministic</p>
          </div>
        </div>
        <button onClick={onDismiss} className="rounded-md p-1 text-muted-foreground hover:bg-muted" aria-label="Dismiss comparison">
          <span className="text-xs">✕</span>
        </button>
      </div>

      {/* Comparison table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border/40">
              <th className="py-1.5 pr-2 text-left text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Dimension</th>
              <th className="py-1.5 px-2 text-left text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Current</th>
              <th className="py-1.5 pl-2 text-left text-[10px] font-medium uppercase tracking-wider text-amber-700 dark:text-amber-400">Explored</th>
            </tr>
          </thead>
          <tbody>
            {dimensions.map((d) => (
              <tr key={d.label} className="border-b border-border/20">
                <td className="py-1.5 pr-2 font-medium text-muted-foreground">{d.label}</td>
                <td className="py-1.5 px-2">{d.current}</td>
                <td className="py-1.5 pl-2 font-medium">{d.explored}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Adopt button */}
      <div className="mt-3 flex justify-end">
        <Button size="sm" onClick={onAdopt} className="gap-1.5 text-xs">
          <CheckCircle2 className="h-3.5 w-3.5" />
          Make this my strategy
        </Button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function Metric({ icon, label, value, valueCls }: { icon: React.ReactNode; label: string; value: string; valueCls?: string }) {
  return (
    <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
      {icon}
      <span>{label}:</span>
      <span className={cn('font-medium text-foreground/80', valueCls)}>{value}</span>
    </div>
  )
}

function AlternativeIntentCard({ intent }: { intent: AlternativeIntent }) {
  return (
    <div className={cn(
      'rounded-lg border p-2.5',
      intent.mayBeSuperior ? 'border-amber-500/40 bg-amber-500/5' : 'border-border/50 bg-background/30',
    )}>
      <p className="text-xs font-semibold">{intent.title}</p>
      <p className="mt-0.5 text-[11px] text-muted-foreground">{intent.rationale}</p>
      {intent.tradeoffs.length > 0 && (
        <p className="mt-1 text-[10px] text-muted-foreground">Tradeoff: {intent.tradeoffs.join('; ')}</p>
      )}
      {intent.mayBeSuperior && (
        <Badge className="mt-1.5 bg-amber-500/15 text-[9px] font-medium text-amber-700 dark:text-amber-400">may be superior</Badge>
      )}
    </div>
  )
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border/60 bg-background/30 px-4 py-8 text-center">
      <Compass className="mx-auto mb-2 h-5 w-5 text-muted-foreground/50" />
      <p className="text-xs text-muted-foreground">{message}</p>
    </div>
  )
}

function IntentFrontierSectionSkeleton({ className }: { className?: string }) {
  return (
    <Card className={cn('wf-panel border-border/60 bg-card/60 p-4', className)}>
      <div className="mb-3 flex items-center gap-2">
        <div className="h-8 w-8 animate-pulse rounded-lg bg-muted" />
        <div>
          <div className="h-3.5 w-40 animate-pulse rounded bg-muted" />
          <div className="mt-1 h-2.5 w-32 animate-pulse rounded bg-muted" />
        </div>
      </div>
      <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-border/60 bg-card/50 p-3">
            <div className="h-4 w-24 animate-pulse rounded bg-muted" />
            <div className="mt-2 h-3 w-32 animate-pulse rounded bg-muted" />
            <div className="mt-2.5 grid grid-cols-2 gap-1.5">
              {Array.from({ length: 4 }).map((_, j) => (
                <div key={j} className="h-2.5 w-16 animate-pulse rounded bg-muted" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </Card>
  )
}

export default IntentFrontierSection
