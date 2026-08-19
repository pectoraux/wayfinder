'use client'

// Wayfinder — ProfileEditor (N0.3 Authoritative Profile Editor)
//
// The authoritative interface for changing the MobilityStateSnapshot that
// drives Wayfinder's strategy engine.
//
// FLOW:
//   user edits → server validates → authoritative latest snapshot loaded →
//   new immutable snapshot → new state version → canonical strategy
//   recomputation → strategy diff → historical DecisionRecord → user sees
//   WHY strategy changed.
//
// The browser NEVER overwrites server state. The server loads its own
// authoritative latest snapshot, validates the updates, and merges them.
//
// After save, shows:
//   "Your profile changed"
//   "What changed" (which fields)
//   Strategy impact (if the strategy recomputed)

import { useState } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { Separator } from '@/components/ui/separator'
import {
  User, GraduationCap, Briefcase, DollarSign, Languages, Heart, Save, X,
  Loader2, CheckCircle2, AlertTriangle, ArrowRight, Sparkles,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { MobilityState } from '@/lib/domain/types'

interface ProfileEditorProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  currentState: MobilityState
  onSaved: (updatedState: MobilityState) => void
}

type SavingState = 'idle' | 'saving' | 'success' | 'error'

interface FieldUpdate {
  field: string
  oldValue: unknown
  newValue: unknown
}

export function ProfileEditor({ open, onOpenChange, currentState, onSaved }: ProfileEditorProps) {
  const [draft, setDraft] = useState<MobilityState>(currentState)
  const [saving, setSaving] = useState<SavingState>('idle')
  const [errors, setErrors] = useState<string[]>([])
  const [impact, setImpact] = useState<{
    changeReason: string | null
    bestTrajectoryLabel: string | null
    previousBestTrajectoryLabel: string | null
  } | null>(null)
  const [changedFields, setChangedFields] = useState<FieldUpdate[]>([])

  // Compute which fields changed (for the "what changed" summary)
  const computeChanges = (): FieldUpdate[] => {
    const changes: FieldUpdate[] = []
    const editableKeys = [
      'age', 'nationalities', 'currentCountry', 'currentResidenceStatus',
      'education', 'credentialRecognizedIn', 'occupation', 'occupationCategory',
      'yearsExperience', 'annualIncomeUSD', 'savingsUSD', 'investableCapitalUSD',
      'remoteWorkEligible', 'employerSponsorshipLikely', 'founderStatus',
      'businessStage', 'languages', 'hasSpouse', 'hasChildren',
      'dependentsCount', 'spouseNationality', 'riskTolerance',
    ]
    for (const key of editableKeys) {
      const oldVal = (currentState as any)[key]?.value
      const newVal = (draft as any)[key]?.value
      if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
        changes.push({ field: key, oldValue: oldVal, newValue: newVal })
      }
    }
    return changes
  }

  const handleSave = async () => {
    const changes = computeChanges()
    if (changes.length === 0) {
      onOpenChange(false)
      return
    }

    // Build the updates object (only changed fields)
    const updates: Record<string, unknown> = {}
    for (const change of changes) {
      updates[change.field] = change.newValue
    }

    setSaving('saving')
    setErrors([])
    try {
      const res = await fetch('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // currentState is a FALLBACK — the server uses its authoritative
        // latest snapshot as the base.
        body: JSON.stringify({ updates, currentState: draft }),
      })

      if (res.status === 409) {
        setErrors(['A concurrent update occurred. Please retry.'])
        setSaving('error')
        return
      }

      const data = await res.json()
      if (!res.ok) {
        setErrors(data.errors ?? [data.error ?? 'Update failed'])
        setSaving('error')
        return
      }

      if (data?.updatedState) {
        onSaved(data.updatedState)
        if (data.strategyImpact) {
          setImpact({
            changeReason: data.strategyImpact.changeReason,
            bestTrajectoryLabel: data.strategyImpact.bestTrajectoryLabel,
            previousBestTrajectoryLabel: data.strategyImpact.previousBestTrajectoryLabel,
          })
        }
        setChangedFields(changes)
        setSaving('success')
      }
    } catch (e) {
      console.error('profile save', e)
      setErrors(['Network error. Please retry.'])
      setSaving('error')
    }
  }

  const handleClose = () => {
    if (saving === 'saving') return
    onOpenChange(false)
  }

  // Helper to update a UserFact field's value
  const updateField = (key: keyof MobilityState, value: unknown) => {
    setDraft((prev) => {
      const next = JSON.parse(JSON.stringify(prev)) as MobilityState
      const fact = (next as any)[key] as { value: unknown; status: string; provenance: string }
      if (fact && typeof fact === 'object' && 'value' in fact) {
        fact.value = value
        fact.status = 'confirmed_by_user'
        fact.provenance = 'user_edit'
      }
      return next
    })
  }

  const factValue = <T,>(key: keyof MobilityState): T | null => {
    const fact = (draft as any)[key] as { value: T } | undefined
    return fact?.value ?? null
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <User className="h-5 w-5 text-primary" />
            Edit profile
          </DialogTitle>
          <p className="text-xs text-muted-foreground">
            Changes create a new immutable snapshot. The server is authoritative —
            your browser cannot overwrite newer server state.
          </p>
        </DialogHeader>

        {saving === 'success' ? (
          <SuccessView
            changedFields={changedFields}
            impact={impact}
            onClose={() => onOpenChange(false)}
          />
        ) : (
          <div className="space-y-5 py-2">
            {/* === IDENTITY === */}
            <ProfileSection icon={User} title="Identity">
              <FieldRow label="Age">
                <Input
                  type="number"
                  value={factValue<number>('age') ?? ''}
                  onChange={(e) => updateField('age', e.target.value ? Number(e.target.value) : null)}
                  placeholder="29"
                  className="h-8"
                />
              </FieldRow>
              <FieldRow label="Current country">
                <Input
                  value={factValue<string>('currentCountry') ?? ''}
                  onChange={(e) => updateField('currentCountry', e.target.value.toUpperCase().slice(0, 2))}
                  placeholder="KE"
                  className="h-8"
                  maxLength={2}
                />
              </FieldRow>
              <FieldRow label="Residence status">
                <Input
                  value={factValue<string>('currentResidenceStatus') ?? ''}
                  onChange={(e) => updateField('currentResidenceStatus', e.target.value || null)}
                  placeholder="citizen"
                  className="h-8"
                />
              </FieldRow>
            </ProfileSection>

            {/* === EDUCATION === */}
            <ProfileSection icon={GraduationCap} title="Education">
              <FieldRow label="Education level">
                <Select
                  value={factValue<string>('education') ?? ''}
                  onValueChange={(v) => updateField('education', v || null)}
                >
                  <SelectTrigger className="h-8"><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="secondary">Secondary</SelectItem>
                    <SelectItem value="diploma">Diploma</SelectItem>
                    <SelectItem value="bachelors">Bachelor's</SelectItem>
                    <SelectItem value="masters">Master's</SelectItem>
                    <SelectItem value="phd">PhD</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </FieldRow>
              <FieldRow label="Degree recognized in">
                <Input
                  value={(factValue<string[]>('credentialRecognizedIn') ?? []).join(', ')}
                  onChange={(e) => updateField('credentialRecognizedIn', e.target.value.split(',').map(s => s.trim().toUpperCase().slice(0, 2)).filter(Boolean))}
                  placeholder="DE, PT"
                  className="h-8"
                />
              </FieldRow>
            </ProfileSection>

            {/* === CAREER === */}
            <ProfileSection icon={Briefcase} title="Career">
              <FieldRow label="Occupation">
                <Input
                  value={factValue<string>('occupation') ?? ''}
                  onChange={(e) => updateField('occupation', e.target.value || null)}
                  placeholder="Software Engineer"
                  className="h-8"
                />
              </FieldRow>
              <FieldRow label="Years experience">
                <Input
                  type="number"
                  value={factValue<number>('yearsExperience') ?? ''}
                  onChange={(e) => updateField('yearsExperience', e.target.value ? Number(e.target.value) : null)}
                  placeholder="5"
                  className="h-8"
                />
              </FieldRow>
              <FieldRow label="Annual income (USD)">
                <Input
                  type="number"
                  value={factValue<number>('annualIncomeUSD') ?? ''}
                  onChange={(e) => updateField('annualIncomeUSD', e.target.value ? Number(e.target.value) : null)}
                  placeholder="70000"
                  className="h-8"
                />
              </FieldRow>
              <FieldRow label="Remote work eligible">
                <Select
                  value={factValue<boolean>('remoteWorkEligible') === true ? 'yes' : factValue<boolean>('remoteWorkEligible') === false ? 'no' : ''}
                  onValueChange={(v) => updateField('remoteWorkEligible', v === 'yes' ? true : v === 'no' ? false : null)}
                >
                  <SelectTrigger className="h-8"><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="yes">Yes</SelectItem>
                    <SelectItem value="no">No</SelectItem>
                  </SelectContent>
                </Select>
              </FieldRow>
            </ProfileSection>

            {/* === CAPITAL === */}
            <ProfileSection icon={DollarSign} title="Capital">
              <FieldRow label="Savings (USD)">
                <Input
                  type="number"
                  value={factValue<number>('savingsUSD') ?? ''}
                  onChange={(e) => updateField('savingsUSD', e.target.value ? Number(e.target.value) : null)}
                  placeholder="40000"
                  className="h-8"
                />
              </FieldRow>
              <FieldRow label="Investable capital (USD)">
                <Input
                  type="number"
                  value={factValue<number>('investableCapitalUSD') ?? ''}
                  onChange={(e) => updateField('investableCapitalUSD', e.target.value ? Number(e.target.value) : null)}
                  placeholder="0"
                  className="h-8"
                />
              </FieldRow>
            </ProfileSection>

            {/* === ENTREPRENEURSHIP === */}
            <ProfileSection icon={Sparkles} title="Entrepreneurship">
              <FieldRow label="Founder status">
                <Select
                  value={factValue<string>('founderStatus') ?? ''}
                  onValueChange={(v) => updateField('founderStatus', v || null)}
                >
                  <SelectTrigger className="h-8"><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="not_founder">Not a founder</SelectItem>
                    <SelectItem value="aspiring">Aspiring</SelectItem>
                    <SelectItem value="active_founder">Active founder</SelectItem>
                  </SelectContent>
                </Select>
              </FieldRow>
            </ProfileSection>

            {/* === LANGUAGES === */}
            <ProfileSection icon={Languages} title="Languages">
              <div className="space-y-2">
                {(factValue<{ language: string; cefr: string }[]>('languages') ?? []).map((lang, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Input
                      value={lang.language}
                      onChange={(e) => {
                        const langs = [...(factValue<{ language: string; cefr: string }[]>('languages') ?? [])]
                        langs[i] = { ...langs[i], language: e.target.value.toUpperCase().slice(0, 2) }
                        updateField('languages', langs)
                      }}
                      placeholder="en"
                      className="h-8 w-16"
                      maxLength={2}
                    />
                    <Select
                      value={lang.cefr}
                      onValueChange={(v) => {
                        const langs = [...(factValue<{ language: string; cefr: string }[]>('languages') ?? [])]
                        langs[i] = { ...langs[i], cefr: v }
                        updateField('languages', langs)
                      }}
                    >
                      <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'native'].map(l => (
                          <SelectItem key={l} value={l}>{l}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 px-2"
                      onClick={() => {
                        const langs = (factValue<{ language: string; cefr: string }[]>('languages') ?? []).filter((_, idx) => idx !== i)
                        updateField('languages', langs)
                      }}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1 text-xs"
                  onClick={() => {
                    const langs = [...(factValue<{ language: string; cefr: string }[]>('languages') ?? []), { language: '', cefr: 'B1' }]
                    updateField('languages', langs)
                  }}
                >
                  + Add language
                </Button>
              </div>
            </ProfileSection>

            {/* === FAMILY === */}
            <ProfileSection icon={Heart} title="Family">
              <FieldRow label="Has spouse">
                <Select
                  value={factValue<boolean>('hasSpouse') === true ? 'yes' : factValue<boolean>('hasSpouse') === false ? 'no' : ''}
                  onValueChange={(v) => updateField('hasSpouse', v === 'yes' ? true : v === 'no' ? false : null)}
                >
                  <SelectTrigger className="h-8"><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="yes">Yes</SelectItem>
                    <SelectItem value="no">No</SelectItem>
                  </SelectContent>
                </Select>
              </FieldRow>
              <FieldRow label="Dependents">
                <Input
                  type="number"
                  value={factValue<number>('dependentsCount') ?? ''}
                  onChange={(e) => updateField('dependentsCount', e.target.value ? Number(e.target.value) : null)}
                  placeholder="0"
                  className="h-8"
                />
              </FieldRow>
            </ProfileSection>

            {/* === ERRORS === */}
            {errors.length > 0 && (
              <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-destructive">Validation errors</p>
                    <ul className="mt-1 space-y-0.5">
                      {errors.map((e, i) => (
                        <li key={i} className="text-xs text-muted-foreground">{e}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {saving !== 'success' && (
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={handleClose} disabled={saving === 'saving'}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving === 'saving'} className="gap-2">
              {saving === 'saving' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {saving === 'saving' ? 'Saving…' : 'Save changes'}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ProfileSection({ icon: Icon, title, children }: { icon: React.ComponentType<{ className?: string }>; title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-1.5">
        <Icon className="h-3.5 w-3.5 text-primary" />
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</h4>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {children}
      </div>
    </div>
  )
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-[11px] text-muted-foreground">{label}</Label>
      {children}
    </div>
  )
}

function SuccessView({
  changedFields,
  impact,
  onClose,
}: {
  changedFields: FieldUpdate[]
  impact: {
    changeReason: string | null
    bestTrajectoryLabel: string | null
    previousBestTrajectoryLabel: string | null
  } | null
  onClose: () => void
}) {
  return (
    <div className="py-4">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">Your profile changed</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {changedFields.length} field{changedFields.length !== 1 ? 's' : ''} updated. A new immutable snapshot was created.
          </p>
        </div>
      </div>

      {/* What changed */}
      <div className="mt-4">
        <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">What changed</p>
        <div className="mt-1.5 space-y-1">
          {changedFields.map((c, i) => (
            <div key={i} className="flex items-center gap-2 text-xs">
              <Badge variant="outline" className="text-[10px] font-normal">{c.field}</Badge>
              <span className="text-muted-foreground line-through">{formatValue(c.oldValue)}</span>
              <ArrowRight className="h-3 w-3 text-primary" />
              <span className="font-medium text-foreground">{formatValue(c.newValue)}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Strategy impact */}
      {impact && impact.changeReason && (
        <>
          <Separator className="my-4" />
          <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
            <p className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-primary">
              <Sparkles className="h-3 w-3" />
              Strategy impact
            </p>
            <p className="mt-1 text-sm font-medium">
              Your strategy was recomputed because your profile changed.
            </p>
            {impact.previousBestTrajectoryLabel && impact.bestTrajectoryLabel && (
              <div className="mt-2 flex items-center gap-2 text-xs">
                <span className="text-muted-foreground line-through">{impact.previousBestTrajectoryLabel}</span>
                <ArrowRight className="h-3 w-3 text-primary" />
                <span className="font-medium text-primary">{impact.bestTrajectoryLabel}</span>
              </div>
            )}
            {impact.previousBestTrajectoryLabel === impact.bestTrajectoryLabel && impact.bestTrajectoryLabel && (
              <p className="mt-1 text-xs text-muted-foreground">
                Best trajectory unchanged ({impact.bestTrajectoryLabel}). The ranking may have shifted.
              </p>
            )}
          </div>
        </>
      )}

      <Button onClick={onClose} className="mt-4 w-full gap-2">
        <CheckCircle2 className="h-4 w-4" /> Done
      </Button>
    </div>
  )
}

function formatValue(v: unknown): string {
  if (v == null) return '—'
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  if (Array.isArray(v)) return v.join(', ') || '—'
  return String(v)
}

export default ProfileEditor
