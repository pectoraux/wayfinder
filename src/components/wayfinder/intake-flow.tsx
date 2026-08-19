'use client'

import { useState } from 'react'
import { useWayfinder } from '@/components/wayfinder/store'
import { buildStateFromIntake, type IntakeAnswers } from '@/lib/domain/state'
import type { EducationLevel, OccupationCategory, LanguageProficiency } from '@/lib/domain/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Card } from '@/components/ui/card'
import { ChevronLeft, ChevronRight, MapPin, GraduationCap, Wallet, Users, Sparkles } from 'lucide-react'
import { COUNTRIES } from '@/lib/knowledge/countries'

const STEPS = [
  { id: 0, title: 'Origin', icon: MapPin, hint: 'Where you start from shapes every route.' },
  { id: 1, title: 'Human capital', icon: GraduationCap, hint: 'Your degree, occupation, and languages.' },
  { id: 2, title: 'Economics', icon: Wallet, hint: 'Income, savings, and how you work.' },
  { id: 3, title: 'Review', icon: Users, hint: 'Confirm and build your plan.' },
] as const

const OCCUPATIONS: { value: OccupationCategory; label: string }[] = [
  { value: 'software_it', label: 'Software / IT' },
  { value: 'engineering', label: 'Engineering' },
  { value: 'finance', label: 'Finance' },
  { value: 'healthcare', label: 'Healthcare' },
  { value: 'education', label: 'Education' },
  { value: 'creative', label: 'Creative' },
  { value: 'trades', label: 'Trades' },
  { value: 'other', label: 'Other' },
]

const EDUCATION: { value: EducationLevel; label: string }[] = [
  { value: 'secondary', label: 'Secondary school' },
  { value: 'diploma', label: 'Diploma' },
  { value: 'bachelors', label: 'Bachelor\u2019s' },
  { value: 'masters', label: 'Master\u2019s' },
  { value: 'phd', label: 'PhD' },
]

const CEFR_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'native'] as const
const COMMON_LANGS = ['en', 'de', 'fr', 'pt', 'es'] as const

export function IntakeFlow() {
  const intent = useWayfinder((s) => s.intent)
  const intentSource = useWayfinder((s) => s.intentSource)
  const existingState = useWayfinder((s) => s.mobilityState)
  const setMobilityState = useWayfinder((s) => s.setMobilityState)
  const computePlan = useWayfinder((s) => s.computePlan)
  const isComputing = useWayfinder((s) => s.isComputing)

  const [step, setStep] = useState(0)
  const [answers, setAnswers] = useState<IntakeAnswers>(() => ({
    age: existingState?.age.value ?? undefined,
    nationality: existingState?.nationalities.value?.[0] ?? undefined,
    currentCountry: existingState?.currentCountry.value ?? undefined,
    education: existingState?.education.value ?? undefined,
    occupation: existingState?.occupation.value ?? undefined,
    occupationCategory: existingState?.occupationCategory.value ?? undefined,
    yearsExperience: existingState?.yearsExperience.value ?? undefined,
    annualIncomeUSD: existingState?.annualIncomeUSD.value ?? undefined,
    savingsUSD: existingState?.savingsUSD.value ?? undefined,
    remoteWorkEligible: existingState?.remoteWorkEligible.value ?? undefined,
    founderStatus: existingState?.founderStatus.value ?? undefined,
    languages: existingState?.languages.value ?? [{ language: 'en', cefr: 'native' }],
    hasSpouse: existingState?.hasSpouse.value ?? undefined,
    hasChildren: existingState?.hasChildren.value ?? undefined,
  }))

  const update = (patch: Partial<IntakeAnswers>) => setAnswers((a) => ({ ...a, ...patch }))

  const ready =
    answers.age != null &&
    answers.nationality &&
    answers.education &&
    answers.occupationCategory &&
    answers.annualIncomeUSD != null &&
    answers.savingsUSD != null

  const handleBuild = async () => {
    const state = buildStateFromIntake(answers)
    setMobilityState(state)
    await computePlan()
  }

  const StepIcon = STEPS[step].icon
  const canAdvance =
    step === 0
      ? answers.age != null && !!answers.nationality
      : step === 1
        ? !!answers.education && !!answers.occupationCategory
        : step === 2
          ? answers.annualIncomeUSD != null && answers.savingsUSD != null
          : ready

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      {/* parsed intent recap */}
      {intent && (
        <Card className="mb-6 border-border/60 bg-card/70 p-4 wf-panel">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Sparkles className="h-3.5 w-3.5" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Your intent
                </p>
                <Badge variant="secondary" className="text-[10px] font-normal">
                  {intentSource === 'llm' ? 'parsed by AI' : 'deterministic parse'}
                </Badge>
                <Badge variant="outline" className="text-[10px] font-normal">
                  {intent.statedGoal.replace(/_/g, ' ')}
                </Badge>
              </div>
              <p className="mt-1.5 text-sm italic text-foreground/80">&ldquo;{intent.rawInput}&rdquo;</p>
              {intent.implicitObjectives.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <span className="text-xs text-muted-foreground">Inferred:</span>
                  {intent.implicitObjectives.map((o) => (
                    <span key={o.objective} className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                      {o.objective}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </Card>
      )}

      {/* step header */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <StepIcon className="h-4 w-4" />
          </div>
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground">
              Step {step + 1} of {STEPS.length}
            </p>
            <h2 className="text-lg font-semibold">{STEPS[step].title}</h2>
          </div>
        </div>
        <p className="hidden max-w-[14rem] text-right text-xs text-muted-foreground sm:block">
          {STEPS[step].hint}
        </p>
      </div>

      {/* progress */}
      <div className="mb-6 flex gap-1.5">
        {STEPS.map((s) => (
          <div
            key={s.id}
            className={`h-1 flex-1 rounded-full transition-colors ${
              s.id <= step ? 'bg-primary' : 'bg-border'
            }`}
          />
        ))}
      </div>

      {/* step content */}
      <Card className="border-border/60 bg-card/70 p-5 wf-panel sm:p-6">
        {step === 0 && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Age">
              <Input
                type="number"
                value={answers.age ?? ''}
                onChange={(e) => update({ age: e.target.value ? Number(e.target.value) : undefined })}
                placeholder="29"
              />
            </Field>
            <Field label="Nationality (passport)">
              <Select value={answers.nationality} onValueChange={(v) => update({ nationality: v, currentCountry: answers.currentCountry ?? v })}>
                <SelectTrigger><SelectValue placeholder="Select country" /></SelectTrigger>
                <SelectContent className="max-h-72">
                  {COUNTRIES.map((c) => (
                    <SelectItem key={c.code} value={c.code}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Current country of residence" className="sm:col-span-2">
              <Select value={answers.currentCountry} onValueChange={(v) => update({ currentCountry: v })}>
                <SelectTrigger><SelectValue placeholder="Where do you live now?" /></SelectTrigger>
                <SelectContent className="max-h-72">
                  {COUNTRIES.map((c) => (
                    <SelectItem key={c.code} value={c.code}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
        )}

        {step === 1 && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Highest education">
              <Select value={answers.education ?? ''} onValueChange={(v) => update({ education: v as EducationLevel })}>
                <SelectTrigger><SelectValue placeholder="Select level" /></SelectTrigger>
                <SelectContent>
                  {EDUCATION.map((e) => (
                    <SelectItem key={e.value} value={e.value}>{e.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Occupation category">
              <Select value={answers.occupationCategory ?? ''} onValueChange={(v) => update({ occupationCategory: v as OccupationCategory })}>
                <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
                <SelectContent>
                  {OCCUPATIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Occupation (free text)" className="sm:col-span-2">
              <Input
                value={answers.occupation ?? ''}
                onChange={(e) => update({ occupation: e.target.value })}
                placeholder="e.g. Senior Software Engineer"
              />
            </Field>
            <Field label="Years of professional experience">
              <Input
                type="number"
                value={answers.yearsExperience ?? ''}
                onChange={(e) => update({ yearsExperience: e.target.value ? Number(e.target.value) : undefined })}
                placeholder="5"
              />
            </Field>
            <Field label="Languages" className="sm:col-span-2">
              <LanguagePicker
                value={answers.languages ?? []}
                onChange={(langs) => update({ languages: langs })}
              />
            </Field>
          </div>
        )}

        {step === 2 && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Annual income (USD)">
              <Input
                type="number"
                value={answers.annualIncomeUSD ?? ''}
                onChange={(e) => update({ annualIncomeUSD: e.target.value ? Number(e.target.value) : undefined })}
                placeholder="70000"
              />
            </Field>
            <Field label="Savings (USD)">
              <Input
                type="number"
                value={answers.savingsUSD ?? ''}
                onChange={(e) => update({ savingsUSD: e.target.value ? Number(e.target.value) : undefined })}
                placeholder="40000"
              />
            </Field>
            <Field label="Can you work remotely across borders?">
              <Select
                value={answers.remoteWorkEligible === undefined ? undefined : String(answers.remoteWorkEligible)}
                onValueChange={(v) => update({ remoteWorkEligible: v === 'true' })}
              >
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="true">Yes — remote-capable</SelectItem>
                  <SelectItem value="false">No — on-site only</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Founder status">
              <Select
                value={answers.founderStatus ?? ''}
                onValueChange={(v) => update({ founderStatus: v as IntakeAnswers['founderStatus'] })}
              >
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="not_founder">Not a founder</SelectItem>
                  <SelectItem value="aspiring">Aspiring founder</SelectItem>
                  <SelectItem value="active_founder">Active founder</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Family">
              <div className="flex gap-2">
                <ToggleChip active={answers.hasSpouse === true} onClick={() => update({ hasSpouse: !(answers.hasSpouse === true) })}>
                  Spouse
                </ToggleChip>
                <ToggleChip active={answers.hasChildren === true} onClick={() => update({ hasChildren: !(answers.hasChildren === true) })}>
                  Children
                </ToggleChip>
              </div>
            </Field>
          </div>
        )}

        {step === 3 && (
          <ReviewStep answers={answers} ready={ready} />
        )}
      </Card>

      {/* nav */}
      <div className="mt-5 flex items-center justify-between">
        <Button variant="ghost" size="sm" disabled={step === 0} onClick={() => setStep((s) => s - 1)} className="gap-1.5">
          <ChevronLeft className="h-4 w-4" /> Back
        </Button>
        {step < 3 ? (
          <Button size="sm" disabled={!canAdvance} onClick={() => setStep((s) => s + 1)} className="gap-1.5">
            Continue <ChevronRight className="h-4 w-4" />
          </Button>
        ) : (
          <Button size="sm" disabled={!ready || isComputing} onClick={handleBuild} className="gap-2">
            {isComputing ? 'Mapping routes…' : 'Build my mobility plan'}
            <Sparkles className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </div>
  )
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <Label className="mb-1.5 text-xs font-medium text-muted-foreground">{label}</Label>
      {children}
    </div>
  )
}

function ToggleChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg border px-3 py-1.5 text-xs transition-colors ${
        active ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-muted'
      }`}
    >
      {children}
    </button>
  )
}

function LanguagePicker({ value, onChange }: { value: LanguageProficiency[]; onChange: (v: LanguageProficiency[]) => void }) {
  const setLevel = (lang: string, cefr: string) => {
    const others = value.filter((l) => l.language !== lang)
    onChange([...others, { language: lang, cefr: cefr as LanguageProficiency['cefr'] }])
  }
  return (
    <div className="flex flex-wrap gap-2">
      {COMMON_LANGS.map((lang) => {
        const cur = value.find((l) => l.language === lang)
        return (
          <div key={lang} className="flex items-center gap-1.5">
            <Select value={cur?.cefr ?? ''} onValueChange={(v) => setLevel(lang, v)}>
              <SelectTrigger className="h-8 w-24 text-xs">
                <SelectValue placeholder={lang.toUpperCase()} />
              </SelectTrigger>
              <SelectContent>
                {CEFR_LEVELS.map((lv) => (
                  <SelectItem key={lv} value={lv} className="text-xs">{lang.toUpperCase()} · {lv}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )
      })}
    </div>
  )
}

function ReviewStep({ answers, ready }: { answers: IntakeAnswers; ready: boolean }) {
  const rows: [string, string | undefined][] = [
    ['Age', answers.age != null ? String(answers.age) : undefined],
    ['Nationality', answers.nationality ? COUNTRIES.find((c) => c.code === answers.nationality)?.name : undefined],
    ['Current country', answers.currentCountry ? COUNTRIES.find((c) => c.code === answers.currentCountry)?.name : undefined],
    ['Education', answers.education],
    ['Occupation', answers.occupation || answers.occupationCategory],
    ['Experience', answers.yearsExperience != null ? `${answers.yearsExperience} yrs` : undefined],
    ['Annual income', answers.annualIncomeUSD != null ? `$${answers.annualIncomeUSD.toLocaleString()}` : undefined],
    ['Savings', answers.savingsUSD != null ? `$${answers.savingsUSD.toLocaleString()}` : undefined],
    ['Remote work', answers.remoteWorkEligible === true ? 'Yes' : answers.remoteWorkEligible === false ? 'No' : undefined],
    ['Languages', answers.languages?.map((l) => `${l.language.toUpperCase()} ${l.cefr}`).join(', ')],
    ['Family', [answers.hasSpouse && 'spouse', answers.hasChildren && 'children'].filter(Boolean).join(', ') || 'single'],
  ]
  return (
    <div>
      <p className="mb-3 text-sm text-muted-foreground">
        We have what we need to evaluate {`8`} real pathways across 6 countries. Missing fields are
        treated as <em>unknown</em> — Wayfinder marks affected routes as <em>conditional</em> rather
        than guessing.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-center justify-between rounded-lg border border-border/50 bg-background/40 px-3 py-2">
            <span className="text-xs text-muted-foreground">{k}</span>
            <span className={`text-sm font-medium ${v ? 'text-foreground' : 'text-muted-foreground/60'}`}>
              {v || '— not provided'}
            </span>
          </div>
        ))}
      </div>
      {!ready && (
        <p className="mt-3 text-xs text-amber-600 dark:text-amber-500">
          Fill the required fields in steps 1–3 to build your plan.
        </p>
      )}
    </div>
  )
}
