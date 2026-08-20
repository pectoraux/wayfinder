'use client'

// Wayfinder — Action Outcome Prompt (N0.4)
//
// A lightweight inline prompt shown when a user has completed an action.
// Asks: "Did this work as expected?" with a structured flow.
//
// This is NOT a survey — it's a minimal outcome capture that feeds the
// prediction-vs-actual evaluation layer.

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { CheckCircle2, XCircle, Clock, AlertCircle, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ActionOutcomePromptProps {
  userActionId: string
  actionTitle: string
  /** The predicted effect (from the original strategy). */
  predictedEffect?: string | null
  className?: string
  onRecorded?: () => void
}

type OutcomeResponse = 'YES' | 'PARTIALLY' | 'NO' | 'WAITING' | null
type SavingState = 'idle' | 'saving' | 'saved'

export function ActionOutcomePrompt({
  userActionId,
  actionTitle,
  predictedEffect,
  className,
  onRecorded,
}: ActionOutcomePromptProps) {
  const [response, setResponse] = useState<OutcomeResponse>(null)
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState<SavingState>('idle')
  const [showNotes, setShowNotes] = useState(false)

  const handleRecord = async () => {
    if (!response) return
    setSaving('saving')
    try {
      const actualEffect = response === 'YES' ? 'succeeded'
        : response === 'PARTIALLY' ? 'partially_succeeded'
        : response === 'NO' ? 'failed'
        : 'still_waiting'

      const res = await fetch(`/api/actions/${userActionId}/outcome`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          predictedEffect: predictedEffect ?? null,
          actualEffect,
          status: response === 'WAITING' ? 'OBSERVED' : 'USER_REPORTED',
          provenance: 'USER_REPORTED',
          notes: notes || undefined,
        }),
      })
      if (res.ok) {
        setSaving('saved')
        onRecorded?.()
      } else {
        setSaving('idle')
      }
    } catch {
      setSaving('idle')
    }
  }

  if (saving === 'saved') {
    return (
      <div className={cn('flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2', className)}>
        <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
        <span className="text-xs text-emerald-700 dark:text-emerald-400">Outcome recorded</span>
      </div>
    )
  }

  return (
    <div className={cn('rounded-lg border border-border/60 bg-card/40 p-3', className)}>
      <p className="mb-2 text-xs font-medium text-foreground">
        Did this work as expected?
      </p>
      {predictedEffect && (
        <p className="mb-2 text-[11px] text-muted-foreground">
          Predicted: {predictedEffect}
        </p>
      )}
      <div className="flex flex-wrap gap-1.5">
        <OutcomeButton
          active={response === 'YES'}
          onClick={() => setResponse('YES')}
          icon={CheckCircle2}
          label="Yes"
          tone="emerald"
        />
        <OutcomeButton
          active={response === 'PARTIALLY'}
          onClick={() => setResponse('PARTIALLY')}
          icon={AlertCircle}
          label="Partially"
          tone="amber"
        />
        <OutcomeButton
          active={response === 'NO'}
          onClick={() => setResponse('NO')}
          icon={XCircle}
          label="No"
          tone="destructive"
        />
        <OutcomeButton
          active={response === 'WAITING'}
          onClick={() => setResponse('WAITING')}
          icon={Clock}
          label="Still waiting"
          tone="muted"
        />
      </div>
      {response && !showNotes && (
        <button
          onClick={() => setShowNotes(true)}
          className="mt-2 text-[11px] text-primary hover:underline"
        >
          + Add notes
        </button>
      )}
      {showNotes && (
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="What happened?"
          className="mt-2 min-h-[60px] text-xs"
        />
      )}
      {response && (
        <Button
          size="sm"
          className="mt-2 gap-1.5 text-xs"
          onClick={handleRecord}
          disabled={saving === 'saving'}
        >
          {saving === 'saving' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
          {saving === 'saving' ? 'Recording…' : 'Record outcome'}
        </Button>
      )}
    </div>
  )
}

function OutcomeButton({
  active, onClick, icon: Icon, label, tone,
}: {
  active: boolean
  onClick: () => void
  icon: React.ComponentType<{ className?: string }>
  label: string
  tone: 'emerald' | 'amber' | 'destructive' | 'muted'
}) {
  const toneCls = {
    emerald: 'border-emerald-500/40 text-emerald-700 dark:text-emerald-400 bg-emerald-500/5',
    amber: 'border-amber-500/40 text-amber-700 dark:text-amber-400 bg-amber-500/5',
    destructive: 'border-destructive/40 text-destructive bg-destructive/5',
    muted: 'border-muted-foreground/40 text-muted-foreground bg-muted/20',
  }[tone]

  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition-all',
        active ? toneCls : 'border-border/60 text-muted-foreground hover:border-border hover:bg-muted/30',
      )}
    >
      <Icon className="h-3 w-3" />
      {label}
    </button>
  )
}

export default ActionOutcomePrompt
