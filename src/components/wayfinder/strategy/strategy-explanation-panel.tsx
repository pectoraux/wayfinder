'use client'

// Wayfinder — Strategy Explanation Panel (N0.6 multi-branch)
//
// Shows the user "Why this strategy?" as MULTIPLE VERIFIED reasoning branches:
//
//   Branch 1 (Need provenance):
//     OBJECTIVE →(CAUSES)→ NEED
//
//   Branch 2 (Blocker resolution):
//     OBJECTIVE ←(BLOCKS)← BLOCKER ←(ADDRESSES)← CAPABILITY →(REQUIRES)→ ACTION →(LEADS_TO)→ OUTCOME
//
// Every consecutive node pair in every displayed branch has the EXACT
// corresponding graph edge (recorded as connectingEdge + edgeDirection).
// A missing edge truncates a branch — false causality is worse than an
// incomplete path. The explanation is fully deterministic — no LLM.

import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import {
  Lightbulb, ArrowRight, ArrowLeft, AlertCircle, TrendingDown,
  GitBranch,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type {
  StrategyExplanation,
  ExplanationPath,
  ExplanationStep,
} from '@/lib/strategy/decision-graph'

interface StrategyExplanationPanelProps {
  explanation: StrategyExplanation | null
  className?: string
}

const STEP_ICON: Record<ExplanationStep['type'], string> = {
  OBJECTIVE: '◎',
  NEED: '◇',
  BLOCKER: '⊘',
  CAPABILITY: '⚙',
  ACTION: '→',
  OUTCOME: '★',
  ASSUMPTION: '?',
  TRADEOFF: '⇄',
  ALTERNATIVE: '↔',
}

const EDGE_LABEL: Record<string, string> = {
  CAUSES: 'causes',
  BLOCKS: 'blocks',
  ADDRESSES: 'addresses',
  REQUIRES: 'requires',
  LEADS_TO: 'leads to',
  DEPENDS_ON: 'depends on',
  TRADEOFF_WITH: 'trades off',
  ALTERNATIVE_TO: 'alternative to',
  SATISFIES: 'satisfies',
}

const PATH_KIND_LABEL: Record<ExplanationPath['kind'], string> = {
  NEED_PROVENANCE: 'Need',
  BLOCKER_RESOLUTION: 'Blocker resolution',
  ACTION_OUTCOME: 'Action',
  ASSUMPTION: 'Assumption',
  TRADEOFF: 'Tradeoff',
  ALTERNATIVE: 'Alternative',
}

function StepRow({ step, isLast }: { step: ExplanationStep; isLast: boolean }) {
  return (
    <div className="flex items-start gap-2">
      <div className="flex flex-col items-center">
        <span
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary"
          aria-hidden
        >
          {STEP_ICON[step.type]}
        </span>
        {!isLast && <span className="my-0.5 w-px flex-1 bg-border/40" aria-hidden />}
      </div>
      <div className="min-w-0 flex-1 pb-1">
        <p className="text-xs font-medium leading-tight">{step.label}</p>
        <p className="text-[11px] text-muted-foreground">{step.description}</p>
        {step.reasoning && (
          <p className="mt-0.5 text-[10px] italic text-muted-foreground">{step.reasoning}</p>
        )}
      </div>
    </div>
  )
}

function PathBranch({ path }: { path: ExplanationPath }) {
  return (
    <div className="rounded-lg border border-border/50 bg-background/40 p-3">
      {/* Branch header */}
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Badge
            variant="outline"
            className="bg-primary/5 text-[9px] font-medium uppercase tracking-wider text-primary"
          >
            {PATH_KIND_LABEL[path.kind]}
          </Badge>
          <span className="text-[10px] text-muted-foreground">{path.label}</span>
        </div>
        {path.terminationReason === 'NO_FURTHER_VERIFIED_EDGE' && (
          <span
            className="text-[9px] italic text-muted-foreground"
            title="This branch terminated because no further verified graph edge exists. No causality was inferred."
          >
            end of proven path
          </span>
        )}
        {path.terminationReason === 'COMPLETE' && (
          <span
            className="text-[9px] italic text-emerald-600 dark:text-emerald-400"
            title="Every hop in this branch is backed by an exact graph edge."
          >
            verified
          </span>
        )}
      </div>

      {/* Steps with explicit edge labels */}
      <div className="space-y-0.5">
        {path.steps.map((step, i) => (
          <div key={i}>
            {/* Edge label between steps */}
            {i > 0 && step.connectingEdge && (
              <div className="ml-3 flex items-center gap-1 py-0.5 pl-3">
                {step.edgeDirection === 'reverse' ? (
                  <ArrowLeft className="h-3 w-3 shrink-0 text-muted-foreground/50" aria-hidden />
                ) : (
                  <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground/50" aria-hidden />
                )}
                <span className="text-[9px] uppercase tracking-wider text-muted-foreground/70">
                  {EDGE_LABEL[step.connectingEdge] ?? step.connectingEdge}
                </span>
              </div>
            )}
            <StepRow step={step} isLast={i === path.steps.length - 1} />
          </div>
        ))}
      </div>
    </div>
  )
}

export function StrategyExplanationPanel({
  explanation,
  className,
}: StrategyExplanationPanelProps) {
  if (!explanation) return null

  const confidenceStyle = {
    high: { label: 'High confidence', cls: 'border-emerald-500/40 text-emerald-700 dark:text-emerald-400 bg-emerald-500/5' },
    medium: { label: 'Medium confidence', cls: 'border-amber-500/40 text-amber-700 dark:text-amber-400 bg-amber-500/5' },
    low: { label: 'Low confidence', cls: 'border-orange-500/40 text-orange-700 dark:text-orange-400 bg-orange-500/5' },
    unknown: { label: 'Unknown confidence', cls: 'border-muted-foreground/40 text-muted-foreground bg-muted/20' },
  }

  const conf = confidenceStyle[explanation.overallConfidence] ?? confidenceStyle.unknown

  return (
    <Card className={cn('wf-panel border-border/60 bg-card/60 p-4 sm:p-5', className)}>
      {/* Header */}
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/15 text-primary">
            <Lightbulb className="h-4 w-4" />
          </span>
          <div>
            <h3 className="text-sm font-semibold leading-tight">Why this strategy?</h3>
            <p className="text-[11px] text-muted-foreground">
              Verified reasoning branches — no AI guesses.
            </p>
          </div>
        </div>
        <Badge variant="outline" className={cn('gap-1 text-[10px] font-medium', conf.cls)}>
          {conf.label}
        </Badge>
      </div>

      {/* Summary */}
      <p className="mb-3 text-sm text-foreground/90">{explanation.summary}</p>

      {/* Reasoning branches */}
      {explanation.paths.length > 0 && (
        <>
          <Separator className="my-3 bg-border/40" />
          <p className="mb-2 flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            <GitBranch className="h-3 w-3" />
            Reasoning branches ({explanation.paths.length})
          </p>
          <div className="max-h-96 space-y-2 overflow-y-auto pr-1">
            {explanation.paths.map((path) => (
              <PathBranch key={path.id} path={path} />
            ))}
          </div>
          <p className="mt-2 text-[10px] italic text-muted-foreground">
            Every hop is backed by an exact graph edge. A missing edge
            terminates a branch rather than inferring causality.
          </p>
        </>
      )}

      {/* Assumptions */}
      {explanation.assumptions.length > 0 && (
        <>
          <Separator className="my-3 bg-border/40" />
          <p className="mb-1.5 flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            <AlertCircle className="h-3 w-3" />
            Assumptions
          </p>
          <ul className="space-y-1">
            {explanation.assumptions.slice(0, 5).map((a, i) => (
              <li key={i} className="text-[11px] text-muted-foreground">
                • {a}
              </li>
            ))}
          </ul>
        </>
      )}

      {/* Rejected alternatives */}
      {explanation.rejectedAlternatives.length > 0 && (
        <>
          <Separator className="my-3 bg-border/40" />
          <p className="mb-1.5 flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            <TrendingDown className="h-3 w-3" />
            Alternatives considered
          </p>
          <div className="flex flex-wrap gap-1.5">
            {explanation.rejectedAlternatives.slice(0, 5).map((alt, i) => (
              <Badge key={i} variant="outline" className="text-[10px] font-normal text-muted-foreground">
                {alt}
              </Badge>
            ))}
          </div>
        </>
      )}

      {/* Graph stats */}
      {explanation.graph && (
        <>
          <Separator className="my-3 bg-border/40" />
          <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
            <span>{explanation.graph.nodes.length} reasoning nodes</span>
            <span>·</span>
            <span>{explanation.graph.edges.length} relationships</span>
            <span>·</span>
            <span>engine {explanation.graph.engineVersion}</span>
          </div>
        </>
      )}
    </Card>
  )
}

export default StrategyExplanationPanel
