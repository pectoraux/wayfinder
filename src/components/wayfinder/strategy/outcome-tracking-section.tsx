'use client'

// Wayfinder — Outcome Tracking Section (N0.7)
//
// Shows the user "What happened?" after a strategy was adopted.
// Displays:
//   - Expected outcomes (what Wayfinder predicted)
//   - Observed outcomes (what actually happened)
//   - Evaluations (ACHIEVED / PARTIALLY_ACHIEVED / NOT_ACHIEVED / UNKNOWN)
//   - Confidence (how confident Wayfinder was)
//
// CRITICAL: User-entered observations are NEVER presented as government-verified
// facts. The UI clearly distinguishes USER_CONFIRMED from EXTERNALLY_VERIFIED.

import { useState } from 'react'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import {
  CheckCircle2, Clock, XCircle, HelpCircle, Target, TrendingUp,
  ChevronDown, ChevronRight, ShieldCheck, ShieldAlert,
} from 'lucide-react'
import { cn } from '@/lib/utils'

// ---------------------------------------------------------------------------
// Types (mirrors the API response shape)
// ---------------------------------------------------------------------------

interface OutcomeRecord {
  id: string
  outcomeType: string
  graphNodeId?: string | null
  expectedByDate?: string | null
  confidence?: number | null
  evaluationStatus: string
  predictedEffect?: string | null
  actualEffect?: string | null
  predictedDurationMonths?: number | null
  actualDurationMonths?: number | null
  predictedCostUSD?: number | null
  actualCostUSD?: number | null
  predictedBlockerResolved?: boolean | null
  actualBlockerResolved?: boolean | null
  status: string
  provenance: string
  notes?: string | null
  createdAt: string
}

interface Evaluation {
  status: 'ACHIEVED' | 'PARTIALLY_ACHIEVED' | 'NOT_ACHIEVED' | 'UNKNOWN'
  explanation: string
  expectedOutcomeId: string
  basedOnUserReport: boolean
  dimensions: Array<{
    name: string
    status: string
    variance?: number
  }>
}

interface ActionOutcomeGroup {
  action: { id: string; actionId: string; title: string; status: string }
  expected: OutcomeRecord | null
  observed: OutcomeRecord[]
  evaluation: Evaluation | null
}

interface OutcomeTrackingSectionProps {
  decisionRecordId: string
  className?: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const EVALUATION_STYLE = {
  ACHIEVED: {
    label: 'Achieved',
    icon: CheckCircle2,
    cls: 'border-emerald-500/40 text-emerald-700 dark:text-emerald-400 bg-emerald-500/5',
  },
  PARTIALLY_ACHIEVED: {
    label: 'Partially achieved',
    icon: Clock,
    cls: 'border-amber-500/40 text-amber-700 dark:text-amber-400 bg-amber-500/5',
  },
  NOT_ACHIEVED: {
    label: 'Not achieved',
    icon: XCircle,
    cls: 'border-red-500/40 text-red-700 dark:text-red-400 bg-red-500/5',
  },
  UNKNOWN: {
    label: 'Pending',
    icon: HelpCircle,
    cls: 'border-muted-foreground/40 text-muted-foreground bg-muted/20',
  },
} as const

const OUTCOME_TYPE_LABEL: Record<string, string> = {
  ELIGIBILITY_OPENED: 'Eligibility opened',
  ROUTE_UNLOCKED: 'Route unlocked',
  APPLICATION_SUBMITTED: 'Application submitted',
  APPLICATION_APPROVED: 'Application approved',
  RESIDENCE_GRANTED: 'Residence granted',
  CITIZENSHIP_GRANTED: 'Citizenship granted',
  CREDENTIAL_RECOGNIZED: 'Credential recognized',
  LANGUAGE_ACHIEVED: 'Language achieved',
  CAPABILITY_ACQUIRED: 'Capability acquired',
  EMPLOYMENT_GAINED: 'Employment gained',
  INCOME_CHANGED: 'Income changed',
  DOCUMENT_OBTAINED: 'Document obtained',
  OTHER: 'Other',
}

const PROVENANCE_STYLE = {
  USER_REPORTED: { label: 'User-reported', icon: ShieldAlert, cls: 'text-amber-600 dark:text-amber-400' },
  USER_CONFIRMED: { label: 'User-reported', icon: ShieldAlert, cls: 'text-amber-600 dark:text-amber-400' },
  SYSTEM_DERIVED: { label: 'System', icon: ShieldCheck, cls: 'text-muted-foreground' },
  SYSTEM_EVENT: { label: 'System event', icon: ShieldCheck, cls: 'text-muted-foreground' },
  EXTERNAL_VERIFICATION: { label: 'Verified', icon: ShieldCheck, cls: 'text-emerald-600 dark:text-emerald-400' },
  EXTERNALLY_VERIFIED: { label: 'Verified', icon: ShieldCheck, cls: 'text-emerald-600 dark:text-emerald-400' },
  DOCUMENT: { label: 'Document', icon: ShieldCheck, cls: 'text-blue-600 dark:text-blue-400' },
  POLICY_EVENT: { label: 'Policy event', icon: ShieldCheck, cls: 'text-muted-foreground' },
} as const

function formatDate(dateStr?: string | null): string {
  if (!dateStr) return '—'
  try {
    return new Date(dateStr).toLocaleDateString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
    })
  } catch {
    return dateStr
  }
}

function formatConfidence(conf?: number | null): string {
  if (conf == null) return '—'
  const pct = Math.round(conf * 100)
  if (pct >= 70) return `${pct}% (high)`
  if (pct >= 40) return `${pct}% (medium)`
  return `${pct}% (low)`
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function OutcomeTrackingSection({ decisionRecordId, className }: OutcomeTrackingSectionProps) {
  const [expanded, setExpanded] = useState(false)
  const [data, setData] = useState<{
    strategyOutcome: { expected: OutcomeRecord | null; observed: OutcomeRecord[]; evaluation: Evaluation | null }
    actionOutcomes: ActionOutcomeGroup[]
    summary: { totalExpected: number; totalObserved: number; achieved: number; partiallyAchieved: number; notAchieved: number; unknown: number }
  } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function loadOutcomes() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/strategy/${decisionRecordId}/outcomes`)
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Failed to load outcomes')
      }
      const json = await res.json()
      setData(json)
      setExpanded(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card className={cn('wf-panel border-border/60 bg-card/60 p-4 sm:p-5', className)}>
      {/* Header */}
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/15 text-primary">
            <Target className="h-4 w-4" />
          </span>
          <div>
            <h3 className="text-sm font-semibold leading-tight">What happened?</h3>
            <p className="text-[11px] text-muted-foreground">
              Track expected vs observed outcomes.
            </p>
          </div>
        </div>
        {data && (
          <Badge variant="outline" className="gap-1 text-[10px] font-medium">
            <TrendingUp className="h-3 w-3" />
            {data.summary.totalObserved}/{data.summary.totalExpected} observed
          </Badge>
        )}
      </div>

      {/* Toggle button */}
      {!data && (
        <Button
          variant="outline"
          size="sm"
          onClick={loadOutcomes}
          disabled={loading}
          className="w-full"
        >
          {loading ? 'Loading…' : 'Show outcome tracking'}
        </Button>
      )}

      {error && (
        <p className="text-[11px] text-red-600 dark:text-red-400">{error}</p>
      )}

      {/* Summary stats */}
      {data && (
        <>
          <div className="mb-3 grid grid-cols-4 gap-2">
            <SummaryStat label="Achieved" value={data.summary.achieved} cls="text-emerald-600 dark:text-emerald-400" />
            <SummaryStat label="Partial" value={data.summary.partiallyAchieved} cls="text-amber-600 dark:text-amber-400" />
            <SummaryStat label="Missed" value={data.summary.notAchieved} cls="text-red-600 dark:text-red-400" />
            <SummaryStat label="Pending" value={data.summary.unknown} cls="text-muted-foreground" />
          </div>

          {/* Expand/collapse toggle */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setExpanded(!expanded)}
            className="w-full text-[11px]"
          >
            {expanded ? <ChevronDown className="mr-1 h-3 w-3" /> : <ChevronRight className="mr-1 h-3 w-3" />}
            {expanded ? 'Hide details' : 'Show details'}
          </Button>

          {expanded && (
            <div className="mt-3 max-h-96 space-y-3 overflow-y-auto pr-1">
              {/* Strategy-level outcome */}
              {data.strategyOutcome.expected && (
                <OutcomeCard
                  title="Strategy outcome"
                  expected={data.strategyOutcome.expected}
                  observed={data.strategyOutcome.observed}
                  evaluation={data.strategyOutcome.evaluation}
                />
              )}

              {/* Action-level outcomes */}
              {data.actionOutcomes.map((group) => (
                <OutcomeCard
                  key={group.action.id}
                  title={group.action.title}
                  expected={group.expected}
                  observed={group.observed}
                  evaluation={group.evaluation}
                />
              ))}

              {data.actionOutcomes.length === 0 && !data.strategyOutcome.expected && (
                <p className="py-4 text-center text-[11px] text-muted-foreground">
                  No expected outcomes recorded for this strategy.
                </p>
              )}
            </div>
          )}

          <p className="mt-2 text-[10px] italic text-muted-foreground">
            User-reported observations are not government-verified facts.
          </p>
        </>
      )}
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SummaryStat({ label, value, cls }: { label: string; value: number; cls: string }) {
  return (
    <div className="rounded-lg border border-border/40 bg-background/40 p-2 text-center">
      <p className={cn('text-lg font-bold', cls)}>{value}</p>
      <p className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</p>
    </div>
  )
}

function OutcomeCard({
  title,
  expected,
  observed,
  evaluation,
}: {
  title: string
  expected: OutcomeRecord | null
  observed: OutcomeRecord[]
  evaluation: Evaluation | null
}) {
  const status = evaluation?.status ?? 'UNKNOWN'
  const style = EVALUATION_STYLE[status] ?? EVALUATION_STYLE.UNKNOWN
  const Icon = style.icon
  const latestObserved = observed[observed.length - 1]

  return (
    <div className="rounded-lg border border-border/50 bg-background/40 p-3">
      {/* Title + evaluation badge */}
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium leading-tight">{title}</p>
          {expected?.outcomeType && (
            <Badge variant="outline" className="mt-0.5 bg-primary/5 text-[9px] font-medium text-primary">
              {OUTCOME_TYPE_LABEL[expected.outcomeType] ?? expected.outcomeType}
            </Badge>
          )}
        </div>
        <Badge variant="outline" className={cn('gap-1 text-[9px] font-medium', style.cls)}>
          <Icon className="h-3 w-3" />
          {style.label}
        </Badge>
      </div>

      {/* Expected vs Observed */}
      <div className="space-y-1.5">
        {/* Expected */}
        {expected && (
          <div className="flex items-start gap-1.5">
            <span className="mt-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Expected:
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] text-foreground/90">
                {expected.predictedEffect ?? '—'}
              </p>
              {expected.expectedByDate && (
                <p className="text-[10px] text-muted-foreground">
                  by {formatDate(expected.expectedByDate)}
                </p>
              )}
            </div>
          </div>
        )}

        {/* Observed */}
        {latestObserved && (
          <div className="flex items-start gap-1.5">
            <span className="mt-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Observed:
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] text-foreground/90">
                {latestObserved.actualEffect ?? '—'}
              </p>
              <p className="text-[10px] text-muted-foreground">
                {formatDate(latestObserved.createdAt)}
              </p>
            </div>
          </div>
        )}

        {/* Confidence */}
        {expected?.confidence != null && (
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Confidence:
            </span>
            <span className="text-[10px] text-muted-foreground">
              {formatConfidence(expected.confidence)}
            </span>
          </div>
        )}

        {/* Provenance */}
        {latestObserved && (
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Source:
            </span>
            {(() => {
              const prov = PROVENANCE_STYLE[latestObserved.provenance as keyof typeof PROVENANCE_STYLE]
              if (!prov) return null
              const ProvIcon = prov.icon
              return (
                <span className={cn('flex items-center gap-0.5 text-[10px]', prov.cls)}>
                  <ProvIcon className="h-2.5 w-2.5" />
                  {prov.label}
                </span>
              )
            })()}
          </div>
        )}
      </div>

      {/* Evaluation explanation */}
      {evaluation && evaluation.status !== 'UNKNOWN' && (
        <>
          <Separator className="my-2 bg-border/30" />
          <p className="text-[10px] italic text-muted-foreground">
            {evaluation.explanation}
          </p>
          {evaluation.basedOnUserReport && (
            <p className="mt-0.5 text-[9px] text-amber-600 dark:text-amber-400">
              Based on user-reported data — not independently verified.
            </p>
          )}
        </>
      )}
    </div>
  )
}

export default OutcomeTrackingSection
