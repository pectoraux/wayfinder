'use client'

// Wayfinder — Blocker Section
//
// "What's blocking you?" — for each BlockerAnalysis, render:
//   - Blocker label + reason
//   - Category badge (USER_CONTROLLED=emerald, THIRD_PARTY=amber,
//     EXTERNAL=blue, POLICY_DEPENDENT=rust)
//   - Difficulty badge
//   - Estimated resolution time
//   - "What would unlock it?" — list of UnlockOptions with labels,
//     descriptions, user-actionable badge, estimated months
//
// BlockerAnalysis / UnlockOption come from '@/lib/strategy/types'.

import {
  Card,
} from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import {
  Lock, AlertTriangle, ShieldCheck, Clock, Sparkles, Network, Globe2,
  FileText, KeyRound, CheckCircle2, User, Building2, Languages,
  GraduationCap, Briefcase, Scale, ShieldQuestion, Handshake,
  FlaskConical, Landmark, FileCheck2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type {
  BlockerAnalysis,
  BlockerCategory,
  UnlockOption,
} from '@/lib/strategy/types'

// ---------------------------------------------------------------------------
// Category + difficulty metadata
// ---------------------------------------------------------------------------

type IconType = React.ComponentType<{ className?: string }>

const CATEGORY_STYLE: Record<BlockerCategory, { label: string; cls: string; Icon: IconType; hint: string }> = {
  USER_CONTROLLED: {
    label: 'In your control',
    cls: 'border-emerald-500/40 text-emerald-700 dark:text-emerald-400 bg-emerald-500/5',
    Icon: Sparkles,
    hint: 'You can resolve this yourself.',
  },
  THIRD_PARTY: {
    label: 'Third party',
    cls: 'border-amber-500/40 text-amber-700 dark:text-amber-400 bg-amber-500/5',
    Icon: Network,
    hint: 'Requires an external actor (employer, incubator, endorsement).',
  },
  EXTERNAL: {
    label: 'External',
    cls: 'border-blue-500/40 text-blue-700 dark:text-blue-300 bg-blue-500/5',
    Icon: Globe2,
    hint: 'Depends on an external process (credential recognition, processing time).',
  },
  POLICY_DEPENDENT: {
    label: 'Policy-dependent',
    cls: 'border-orange-700/40 text-orange-700 dark:text-orange-400 bg-orange-700/5',
    Icon: FileText,
    hint: 'Depends on policy decisions (program suspension, quota changes).',
  },
}

const DIFFICULTY_STYLE: Record<string, { label: string; cls: string }> = {
  easy: {
    label: 'Easy',
    cls: 'border-emerald-500/40 text-emerald-700 dark:text-emerald-400 bg-emerald-500/5',
  },
  moderate: {
    label: 'Moderate',
    cls: 'border-blue-500/40 text-blue-700 dark:text-blue-300 bg-blue-500/5',
  },
  hard: {
    label: 'Hard',
    cls: 'border-amber-500/40 text-amber-700 dark:text-amber-400 bg-amber-500/5',
  },
  very_hard: {
    label: 'Very hard',
    cls: 'border-destructive/40 text-destructive bg-destructive/5',
  },
}

const UNLOCK_ICON: Record<UnlockOption['kind'], IconType> = {
  credential_recognition: ShieldCheck,
  language_cert: Languages,
  employer_offer: Briefcase,
  incubator_support: Building2,
  endorsement: ShieldQuestion,
  savings: Scale,
  education: GraduationCap,
  business_formation: FlaskConical,
  documentation: FileCheck2,
  policy_change: Landmark,
}

const UNLOCK_KIND_LABEL: Record<UnlockOption['kind'], string> = {
  credential_recognition: 'Credential recognition',
  language_cert: 'Language certificate',
  employer_offer: 'Employer offer',
  incubator_support: 'Incubator support',
  endorsement: 'Endorsement',
  savings: 'Savings',
  education: 'Education',
  business_formation: 'Business formation',
  documentation: 'Documentation',
  policy_change: 'Policy change',
}

// ---------------------------------------------------------------------------
// Format helpers
// ---------------------------------------------------------------------------

function formatMonths(m?: number): string {
  if (m == null || !Number.isFinite(m)) return '—'
  if (m <= 0) return 'immediate'
  if (m < 12) return `~${Math.round(m)} mo`
  const y = Math.floor(m / 12)
  const rem = Math.round(m % 12)
  return rem === 0 ? `~${y} yr` : `~${y} yr ${rem} mo`
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface BlockerSectionProps {
  blockers: BlockerAnalysis[]
  className?: string
}

export function BlockerSection({ blockers, className }: BlockerSectionProps) {
  if (!blockers) {
    return <BlockerSectionSkeleton className={className} />
  }

  const userControlled = blockers.filter((b) => b.category === 'USER_CONTROLLED').length
  const thirdParty = blockers.filter((b) => b.category === 'THIRD_PARTY').length
  const external = blockers.filter((b) => b.category === 'EXTERNAL').length
  const policyDep = blockers.filter((b) => b.category === 'POLICY_DEPENDENT').length

  return (
    <Card
      className={cn(
        'wf-panel border-border/60 bg-card/60 p-4 sm:p-5',
        className,
      )}
    >
      {/* Header */}
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-destructive/15 text-destructive">
            <Lock className="h-4 w-4" />
          </span>
          <div>
            <h3 className="text-sm font-semibold leading-tight">What&apos;s blocking you?</h3>
            <p className="text-[11px] text-muted-foreground">
              {blockers.length === 0
                ? 'No blockers — your trajectory is executable.'
                : `${blockers.length} blocker${blockers.length === 1 ? '' : 's'} between you and your destination.`}
            </p>
          </div>
        </div>
        {blockers.length > 0 && (
          <div className="flex flex-wrap items-center gap-1">
            {userControlled > 0 && (
              <Badge variant="outline" className="gap-1 text-[9px] font-normal border-emerald-500/40 text-emerald-700 dark:text-emerald-400">
                <Sparkles className="h-2.5 w-2.5" /> {userControlled} you
              </Badge>
            )}
            {thirdParty > 0 && (
              <Badge variant="outline" className="gap-1 text-[9px] font-normal border-amber-500/40 text-amber-700 dark:text-amber-400">
                <Network className="h-2.5 w-2.5" /> {thirdParty} 3rd-party
              </Badge>
            )}
            {external > 0 && (
              <Badge variant="outline" className="gap-1 text-[9px] font-normal border-blue-500/40 text-blue-700 dark:text-blue-300">
                <Globe2 className="h-2.5 w-2.5" /> {external} external
              </Badge>
            )}
            {policyDep > 0 && (
              <Badge variant="outline" className="gap-1 text-[9px] font-normal border-orange-700/40 text-orange-700 dark:text-orange-400">
                <FileText className="h-2.5 w-2.5" /> {policyDep} policy
              </Badge>
            )}
          </div>
        )}
      </div>

      {/* Body */}
      {blockers.length === 0 ? (
        <EmptyState />
      ) : (
        <ScrollArea className="wf-scroll max-h-[40rem] pr-3">
          <div className="space-y-3">
            {blockers.map((b, i) => (
              <BlockerCard key={b.blockerId ?? i} blocker={b} />
            ))}
          </div>
        </ScrollArea>
      )}
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function BlockerCard({ blocker }: { blocker: BlockerAnalysis }) {
  const cat = CATEGORY_STYLE[blocker.category] ?? CATEGORY_STYLE.EXTERNAL
  const diff = DIFFICULTY_STYLE[blocker.difficulty] ?? DIFFICULTY_STYLE.moderate
  const hasUnlocks = blocker.unlocks.length > 0

  return (
    <div className="rounded-xl border border-border/60 bg-card/50 p-3">
      {/* Header row */}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold leading-tight">{blocker.label}</p>
          <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
            {blocker.reason}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <Badge
            variant="outline"
            className={cn('gap-1 text-[10px] font-medium', cat.cls)}
            title={cat.hint}
          >
            <cat.Icon className="h-2.5 w-2.5" />
            {cat.label}
          </Badge>
          <Badge
            variant="outline"
            className={cn('text-[9px] font-normal', diff.cls)}
          >
            {diff.label}
          </Badge>
        </div>
      </div>

      {/* Meta strip: resolution time + user action / third-party role */}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {blocker.estimatedResolutionMonths != null && (
          <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
            <Clock className="h-2.5 w-2.5" />
            Est. resolution: {formatMonths(blocker.estimatedResolutionMonths)}
          </span>
        )}
        {blocker.userAction && (
          <span className="inline-flex items-center gap-1 text-[10px] text-emerald-700 dark:text-emerald-400">
            <User className="h-2.5 w-2.5" />
            You: {blocker.userAction}
          </span>
        )}
        {blocker.thirdPartyRole && (
          <span className="inline-flex items-center gap-1 text-[10px] text-amber-700 dark:text-amber-400">
            <Handshake className="h-2.5 w-2.5" />
            They: {blocker.thirdPartyRole}
          </span>
        )}
      </div>

      {/* Unlocks */}
      {hasUnlocks && (
        <>
          <Separator className="my-3 bg-border/40" />
          <div>
            <p className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              <KeyRound className="h-3 w-3" />
              What would unlock it
            </p>
            <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
              {blocker.unlocks.map((u, j) => (
                <UnlockCard key={j} unlock={u} />
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function UnlockCard({ unlock }: { unlock: UnlockOption }) {
  const Icon = UNLOCK_ICON[unlock.kind] ?? KeyRound
  const kindLabel = UNLOCK_KIND_LABEL[unlock.kind] ?? unlock.kind.replace(/_/g, ' ')
  return (
    <div className="rounded-lg border border-border/50 bg-background/40 p-2.5">
      <div className="flex items-start justify-between gap-1.5">
        <div className="flex min-w-0 items-start gap-1.5">
          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded bg-primary/10 text-primary">
            <Icon className="h-3 w-3" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-[11px] font-semibold leading-tight">{unlock.label}</p>
            <p className="text-[9px] uppercase tracking-wider text-muted-foreground">
              {kindLabel}
            </p>
          </div>
        </div>
        {unlock.userActionable && (
          <Badge
            variant="outline"
            className="shrink-0 gap-0.5 border-emerald-500/40 bg-emerald-500/5 px-1 py-0 text-[9px] font-medium text-emerald-700 dark:text-emerald-400"
          >
            <User className="h-2 w-2" /> You
          </Badge>
        )}
      </div>
      {unlock.description && (
        <p className="mt-1 text-[10px] leading-snug text-muted-foreground">
          {unlock.description}
        </p>
      )}
      {unlock.estimatedMonths != null && (
        <p className="mt-1 inline-flex items-center gap-1 text-[9px] text-muted-foreground">
          <Clock className="h-2 w-2" />
          {formatMonths(unlock.estimatedMonths)}
        </p>
      )}
    </div>
  )
}

function EmptyState() {
  return (
    <div className="rounded-lg border border-dashed border-emerald-500/40 bg-emerald-500/[0.03] px-4 py-8 text-center">
      <div className="mx-auto mb-2 flex h-9 w-9 items-center justify-center rounded-full bg-emerald-500/10">
        <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
      </div>
      <p className="text-sm font-medium text-emerald-800 dark:text-emerald-300">
        Nothing is blocking you
      </p>
      <p className="mx-auto mt-1 max-w-xs text-xs text-muted-foreground">
        All hard requirements pass against the current policy snapshot. You can
        start executing today.
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

export function BlockerSectionSkeleton({ className }: { className?: string }) {
  return (
    <Card className={cn('wf-panel border-border/60 bg-card/60 p-4', className)}>
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 animate-pulse rounded-lg bg-muted" />
          <div>
            <div className="h-3.5 w-32 animate-pulse rounded bg-muted" />
            <div className="mt-1 h-2.5 w-44 animate-pulse rounded bg-muted" />
          </div>
        </div>
        <div className="h-4 w-20 animate-pulse rounded bg-muted" />
      </div>
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-border/60 bg-card/50 p-3">
            <div className="flex items-center justify-between">
              <div className="h-3.5 w-40 animate-pulse rounded bg-muted" />
              <div className="h-5 w-20 animate-pulse rounded bg-muted" />
            </div>
            <div className="mt-2 h-2.5 w-72 animate-pulse rounded bg-muted" />
            <div className="mt-3 h-px w-full bg-border/40" />
            <div className="mt-3 grid gap-1.5 sm:grid-cols-2">
              <div className="h-16 animate-pulse rounded-lg bg-muted" />
              <div className="h-16 animate-pulse rounded-lg bg-muted" />
            </div>
          </div>
        ))}
      </div>
    </Card>
  )
}

export default BlockerSection
