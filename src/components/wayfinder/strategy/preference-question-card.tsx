'use client'

// Wayfinder — Preference Question Card
//
// Displays the highest-impact preference question from the strategy.
// When the user answers, calls answerPreference() which:
//   1. POSTs to /api/strategy/preferences
//   2. Updates the intent in the store
//   3. Recomputes the strategy
//   4. The dashboard re-renders with the new strategy

import { useState } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Lightbulb, Loader2, X, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useWayfinder } from '@/components/wayfinder/store'
import type { PreferenceQuestion } from '@/lib/strategy/types'

export function PreferenceQuestionCard({ question }: { question: PreferenceQuestion }) {
  const answerPreference = useWayfinder((s) => s.answerPreference)
  const strategyLoading = useWayfinder((s) => s.strategyLoading)
  const [answered, setAnswered] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null)

  if (dismissed || answered) return null

  const handleAnswer = async (value: string) => {
    setSelectedAnswer(value)
    setAnswered(true)
    await answerPreference(question.id, value)
  }

  return (
    <Card className="border-primary/30 bg-primary/[0.03] p-4 wf-panel">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
          <Lightbulb className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wider text-primary">
                One thing that could change your recommendation
              </p>
              <p className="mt-1 text-sm font-medium leading-snug">{question.question}</p>
            </div>
            <button
              onClick={() => setDismissed(true)}
              className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="Dismiss question"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {question.rationale && (
            <p className="mt-1 text-[11px] text-muted-foreground">{question.rationale}</p>
          )}

          <div className="mt-3 flex flex-wrap gap-2">
            {question.options.map((opt) => (
              <Button
                key={opt.value}
                size="sm"
                variant={selectedAnswer === opt.value ? 'default' : 'outline'}
                disabled={strategyLoading}
                onClick={() => handleAnswer(opt.value)}
                className="gap-1.5 text-xs"
              >
                {strategyLoading && selectedAnswer === opt.value && (
                  <Loader2 className="h-3 w-3 animate-spin" />
                )}
                {opt.label}
              </Button>
            ))}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setDismissed(true)}
              className="text-xs text-muted-foreground"
            >
              Not now
            </Button>
          </div>

          {strategyLoading && (
            <p className="mt-2 flex items-center gap-1.5 text-[11px] text-primary">
              <Sparkles className="h-3 w-3 animate-pulse" />
              Recalculating your strategy…
            </p>
          )}
        </div>
      </div>
    </Card>
  )
}
