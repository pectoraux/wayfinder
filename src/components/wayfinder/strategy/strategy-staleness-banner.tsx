'use client'

// Wayfinder — Strategy Staleness Banner
//
// Surfaces the structured staleness assessment returned by GET /api/strategy/adopt.
// Each dimension is rendered distinctly — never collapsed to a single boolean:
//
//   STALE_POLICY   → "Immigration policy changed"
//   STALE_PROFILE  → "Your profile changed"
//   STALE_INTENT   → "Your priorities changed"
//   STALE_ENGINE   → "Wayfinder's strategy engine changed"
//   STALE_MULTIPLE → "Multiple inputs changed"
//
// When the strategy is CURRENT, no banner is shown.

import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  AlertTriangle, FileText, User, SlidersHorizontal, Cog, Layers, RefreshCw,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { StalenessAssessment, StalenessReason } from '@/lib/strategy/staleness'

type IconType = React.ComponentType<{ className?: string }>

const DIMENSION_STYLE: Record<
  'policy' | 'profile' | 'intent' | 'engine',
  { label: string; Icon: IconType; cls: string }
> = {
  policy: {
    label: 'Policy changed',
    Icon: FileText,
    cls: 'border-amber-500/40 text-amber-700 dark:text-amber-400 bg-amber-500/5',
  },
  profile: {
    label: 'Profile changed',
    Icon: User,
    cls: 'border-violet-500/40 text-violet-700 dark:text-violet-300 bg-violet-500/5',
  },
  intent: {
    label: 'Priorities changed',
    Icon: SlidersHorizontal,
    cls: 'border-teal-500/40 text-teal-700 dark:text-teal-300 bg-teal-500/5',
  },
  engine: {
    label: 'Engine updated',
    Icon: Cog,
    cls: 'border-blue-500/40 text-blue-700 dark:text-blue-300 bg-blue-500/5',
  },
}

const STATUS_LABEL: Record<Exclude<StalenessReason, 'CURRENT'>, string> = {
  STALE_POLICY: 'Immigration policy changed',
  STALE_PROFILE: 'Your profile changed',
  STALE_INTENT: 'Your priorities changed',
  STALE_ENGINE: "Wayfinder's strategy engine changed",
  STALE_MULTIPLE: 'Multiple inputs changed',
}

export interface StrategyStalenessBannerProps {
  assessment: StalenessAssessment | null
  onRecalculate?: () => void
  isRecalculating?: boolean
  className?: string
}

export function StrategyStalenessBanner({
  assessment,
  onRecalculate,
  isRecalculating = false,
  className,
}: StrategyStalenessBannerProps) {
  if (!assessment || assessment.status === 'CURRENT') return null

  const dims = assessment.dimensions
  const activeDims: ('policy' | 'profile' | 'intent' | 'engine')[] = []
  if (dims.policy) activeDims.push('policy')
  if (dims.profile) activeDims.push('profile')
  if (dims.intent) activeDims.push('intent')
  if (dims.engine) activeDims.push('engine')

  const isMultiple = assessment.status === 'STALE_MULTIPLE'

  return (
    <Card
      className={cn(
        'border-amber-500/40 bg-amber-500/[0.04] p-4 wf-panel',
        className,
      )}
      role="status"
      aria-live="polite"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-500/15 text-amber-700 dark:text-amber-400">
            {isMultiple ? <Layers className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
              {STATUS_LABEL[assessment.status]}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {assessment.explanation}
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {activeDims.map((d) => {
                const meta = DIMENSION_STYLE[d]
                return (
                  <Badge
                    key={d}
                    variant="outline"
                    className={cn('gap-1 text-[10px] font-medium', meta.cls)}
                  >
                    <meta.Icon className="h-2.5 w-2.5" />
                    {meta.label}
                  </Badge>
                )
              })}
            </div>
          </div>
        </div>
        {onRecalculate && (
          <Button
            variant="outline"
            size="sm"
            className="shrink-0 gap-1.5 text-xs"
            onClick={onRecalculate}
            disabled={isRecalculating}
          >
            <RefreshCw className={cn('h-3.5 w-3.5', isRecalculating && 'animate-spin')} />
            {isRecalculating ? 'Recalculating…' : 'Recalculate'}
          </Button>
        )}
      </div>
    </Card>
  )
}

export default StrategyStalenessBanner
