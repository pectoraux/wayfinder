'use client'

// Wayfinder — Action Outcome Prompt (N0.4b)
//
// A lightweight inline prompt shown when a user has completed an action.
// Asks: "Did this work as expected?" with a structured flow.
//
// N0.4b: the UI asks ONLY "What actually happened?" The prediction is
// displayed read-only (fetched from the server). The client NEVER submits
// prediction values — only actual observations.

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { CheckCircle2, XCircle, Clock, AlertCircle, Loader2, FileText } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ActionOutcomePromptProps {
  userActionId: string
  actionTitle: string
  className?: string
  onRecorded?: () => void
}

type OutcomeResponse = 'YES' | 'PARTIALLY' | 'NO' | 'WAITING' | null
type SavingState = 'idle' | 'saving' | 'saved'

interface PredictionDisplay {
  predictedEffect: string | null
  predictedCostUSD: number | null
  predictedDurationMonths: number | null
}

export function ActionOutcomePrompt({
  userActionId,
  actionTitle,
  className,
  onRecorded,
}: ActionOutcomePromptProps) {
  const [response, setResponse] = useState<OutcomeResponse>(null)
  const [notes, setNotes] = useState('')
  const [actualDuration, setActualDuration] = useState('')
  const [actualCost, setActualCost] = useState('')
  const [saving, setSaving] = useState<SavingState>('idle')
  const [showDetails, setShowDetails] = useState(false)
  const [prediction, setPrediction] = useState<PredictionDisplay | null>(null)
  const [eventId] = useState(() => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)

  // Fetch the server-derived prediction (read-only display)
  useEffect(() => {
    if (!userActionId) return
    fetch(`/api/actions/${userActionId}/outcome`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data?.outcomes?.[0]) {
          setPrediction({
            predictedEffect: data.outcomes[0].predictedEffect,
            predictedCostUSD: data.outcomes[0].predictedCostUSD,
            predictedDurationMonths: data.outcomes[0].predictedDurationMonths,
          })
        }
      })
      .catch(() => {})
  }, [userActionId])

  const handleRecord = async () => {
    if (!response) return
    setSaving('saving')
    try {
      const actualEffect = response === 'YES' ? 'succeeded'
        : response === 'PARTIALLY' ? 'partially_succeeded'
        : response === 'NO' ? 'failed'
        : 'still_waiting'

      const body: Record<string, unknown> = {
        actualEffect,
        notes: notes || undefined,
        eventId, // idempotency — retries with same eventId return existing
      }
      if (actualDuration) body.actualDurationMonths = Number(actualDuration)
      if (actualCost) body.actualCostUSD = Number(actualCost)
      if (response === 'YES' || response === 'PARTIALLY') body.actualBlockerResolved = true
      if (response === 'NO') body.actualBlockerResolved = false

      const res = await fetch(`/api/actions/${userActionId}/outcome`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
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

      {/* Read-only prediction display */}
      {prediction?.predictedEffect && (
        <div className="mb-2 rounded-md bg-muted/30 px-2 py-1.5">
          <p className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            <FileText className="h-2.5 w-2.5" />
            Wayfinder predicted
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">{prediction.predictedEffect}</p>
          {(prediction.predictedDurationMonths || prediction.predictedCostUSD) && (
            <div className="mt-1 flex gap-3 text-[10px] text-muted-foreground">
              {prediction.predictedDurationMonths && (
                <span>~{prediction.predictedDurationMonths} mo</span>
              )}
              {prediction.predictedCostUSD && (
                <span>${prediction.predictedCostUSD.toLocaleString()}</span>
              )}
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        <OutcomeButton active={response === 'YES'} onClick={() => setResponse('YES')} icon={CheckCircle2} label="Yes" tone="emerald" />
        <OutcomeButton active={response === 'PARTIALLY'} onClick={() => setResponse('PARTIALLY')} icon={AlertCircle} label="Partially" tone="amber" />
        <OutcomeButton active={response === 'NO'} onClick={() => setResponse('NO')} icon={XCircle} label="No" tone="destructive" />
        <OutcomeButton active={response === 'WAITING'} onClick={() => setResponse('WAITING')} icon={Clock} label="Still waiting" tone="muted" />
      </div>

      {response && !showDetails && (
        <button onClick={() => setShowDetails(true)} className="mt-2 text-[11px] text-primary hover:underline">
          + Add details (time, cost, notes)
        </button>
      )}

      {showDetails && (
        <div className="mt-2 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-[10px] text-muted-foreground">Actual duration (months)</Label>
              <Input type="number" value={actualDuration} onChange={(e) => setActualDuration(e.target.value)} placeholder="4.5" className="h-7 text-xs" />
            </div>
            <div>
              <Label className="text-[10px] text-muted-foreground">Actual cost (USD)</Label>
              <Input type="number" value={actualCost} onChange={(e) => setActualCost(e.target.value)} placeholder="5000" className="h-7 text-xs" />
            </div>
          </div>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What happened?" className="min-h-[50px] text-xs" />
        </div>
      )}

      {response && (
        <Button size="sm" className="mt-2 gap-1.5 text-xs" onClick={handleRecord} disabled={saving === 'saving'}>
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
