'use client'

// Wayfinder — Strategy Explanation Panel (N0.6)
//
// Shows the user "Why this strategy?" with a deterministic causal chain:
//   Objective → Need → Blocker → Capability → Action → Expected Outcome
//
// The explanation is fully deterministic — no LLM in the reasoning path.
// Progressive disclosure: shows the summary first, then the causal chain,
// then assumptions, then rejected alternatives.

import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import {
  Lightbulb, Target, Lock, Key, CheckCircle2, AlertCircle,
  ArrowRight, TrendingDown, FileQuestion,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { StrategyExplanation } from '@/lib/strategy/decision-graph'

interface StrategyExplanationPanelProps {
  explanation: StrategyExplanation | null
  className?: string
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

  const conf = confidenceStyle[explanation.confidence] ?? confidenceStyle.unknown

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
              Deterministic reasoning chain — no AI guesses.
            </p>
          </div>
        </div>
        <Badge variant="outline" className={cn('gap-1 text-[10px] font-medium', conf.cls)}>
          {conf.label}
        </Badge>
      </div>

      {/* Summary */}
      <p className="mb-3 text-sm text-foreground/90">{explanation.summary}</p>

      {/* Causal chain */}
      {explanation.causalChain.length > 0 && (
        <>
          <Separator className="my-3 bg-border/40" />
          <p className="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Reasoning chain
          </p>
          <div className="space-y-2">
            {explanation.causalChain.map((step, i) => (
              <div key={i} className="flex items-start gap-2">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-medium text-primary">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium">{step.label}</p>
                  <p className="text-[11px] text-muted-foreground">{step.description}</p>
                  {step.reasoning && (
                    <p className="mt-0.5 text-[10px] text-muted-foreground italic">{step.reasoning}</p>
                  )}
                </div>
                {i < explanation.causalChain.length - 1 && (
                  <ArrowRight className="mt-1 h-3 w-3 shrink-0 text-muted-foreground/40" />
                )}
              </div>
            ))}
          </div>
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
