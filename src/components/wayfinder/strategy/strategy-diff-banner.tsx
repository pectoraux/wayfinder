'use client'

// Wayfinder — Strategy Diff Banner
//
// Shows a prominent banner when the strategy has changed (after a preference
// answer or state change). Displays old vs new best trajectory and why.
// Auto-dismisses after a few seconds or on user click.

import { useEffect, useState } from 'react'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ArrowRight, X, TrendingUp, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface StrategyDiff {
  previousLabel: string
  newLabel: string
  reason: string
  newRoutes?: number
  resolvedBlockers?: number
}

export function StrategyDiffBanner({ diff, onDismiss }: { diff: StrategyDiff | null; onDismiss: () => void }) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (diff) {
      Promise.resolve().then(() => setVisible(true))
      const timer = setTimeout(() => {
        setVisible(false)
        onDismiss()
      }, 12000)
      return () => clearTimeout(timer)
    }
  }, [diff, onDismiss])

  if (!diff || !visible) return null

  return (
    <Card className="mb-6 border-primary/40 bg-primary/[0.05] p-4 wf-panel animate-in fade-in slide-in-from-top-2 duration-300">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
            <Sparkles className="h-4 w-4" />
          </span>
          <div>
            <p className="text-sm font-semibold text-primary">Your strategy changed</p>
            <div className="mt-2 flex items-center gap-2 text-sm">
              <span className="rounded-md bg-muted/50 px-2 py-0.5 text-xs text-muted-foreground line-through">
                {diff.previousLabel}
              </span>
              <ArrowRight className="h-3.5 w-3.5 text-primary" />
              <span className="rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                {diff.newLabel}
              </span>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">{diff.reason}</p>
            {(diff.newRoutes || diff.resolvedBlockers) && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {diff.newRoutes != null && diff.newRoutes > 0 && (
                  <Badge className="gap-1 bg-emerald-500/15 text-[10px] font-medium text-emerald-700 dark:text-emerald-400">
                    <TrendingUp className="h-2.5 w-2.5" /> +{diff.newRoutes} new route{diff.newRoutes !== 1 ? 's' : ''}
                  </Badge>
                )}
                {diff.resolvedBlockers != null && diff.resolvedBlockers > 0 && (
                  <Badge className="gap-1 bg-emerald-500/15 text-[10px] font-medium text-emerald-700 dark:text-emerald-400">
                    {diff.resolvedBlockers} blocker{diff.resolvedBlockers !== 1 ? 's' : ''} resolved
                  </Badge>
                )}
              </div>
            )}
          </div>
        </div>
        <button
          onClick={() => { setVisible(false); onDismiss() }}
          className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Dismiss"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </Card>
  )
}
