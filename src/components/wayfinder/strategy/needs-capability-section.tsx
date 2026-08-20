'use client'

// Wayfinder — Needs + Capability Intelligence Section (N0.5 hardened)
//
// Shows the user:
//   - What they want (their stated goal)
//   - What they need (inferred underlying need)
//   - What is blocking them
//   - What capability would remove the blocker
//   - What routes that capability could unlock
//
// N0.5 hardening: shows ALL triggers (multiple trajectories can trigger
// the same capability), with progressive disclosure.

import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import {
  Target, Key, TrendingUp, Compass, CheckCircle2, User, Users,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { NeedAssessment, DesiredCapability, CapabilityImpactSummary } from '@/lib/strategy/needs'

interface NeedsCapabilitySectionProps {
  needs: NeedAssessment | null
  desiredCapabilities: DesiredCapability[]
  capabilityImpact: CapabilityImpactSummary | null
  className?: string
}

export function NeedsCapabilitySection({
  needs,
  desiredCapabilities,
  capabilityImpact,
  className,
}: NeedsCapabilitySectionProps) {
  if (!needs && desiredCapabilities.length === 0) return null

  return (
    <Card className={cn('wf-panel border-border/60 bg-card/60 p-4 sm:p-5', className)}>
      {/* Header */}
      <div className="mb-3 flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/15 text-primary">
          <Target className="h-4 w-4" />
        </span>
        <div>
          <h3 className="text-sm font-semibold leading-tight">What you need</h3>
          <p className="text-[11px] text-muted-foreground">
            Wayfinder's analysis of your wants, needs, and blockers.
          </p>
        </div>
      </div>

      {/* WANT vs NEED */}
      {needs && (
        <div className="mb-3 grid gap-2 sm:grid-cols-2">
          <div className="rounded-lg border border-border/50 bg-background/40 p-3">
            <p className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              <Compass className="h-3 w-3" />
              You want
            </p>
            <p className="mt-1 text-sm font-medium">{needs.wants[0]?.expression?.slice(0, 100) ?? needs.wants[0]?.goal ?? '—'}</p>
          </div>
          <div className="rounded-lg border border-primary/30 bg-primary/[0.03] p-3">
            <p className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-primary">
              <Target className="h-3 w-3" />
              What you actually need
            </p>
            <p className="mt-1 text-sm font-medium">{needs.needs[0]?.label ?? '—'}</p>
            {needs.needs[0]?.evidence && (
              <p className="mt-1 text-[11px] text-muted-foreground">{needs.needs[0].evidence}</p>
            )}
          </div>
        </div>
      )}

      {/* Desired Capabilities */}
      {desiredCapabilities.length > 0 && (
        <>
          <Separator className="my-3 bg-border/40" />
          <p className="mb-2 flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            <Key className="h-3 w-3" />
            Missing capabilities
          </p>
          <div className="space-y-2">
            {desiredCapabilities.map((cap) => (
              <CapabilityCard key={cap.capabilityId} cap={cap} />
            ))}
          </div>
        </>
      )}

      {/* Impact Summary */}
      {capabilityImpact && capabilityImpact.totalCapabilities > 0 && (
        <>
          <Separator className="my-3 bg-border/40" />
          <div className="rounded-lg border border-primary/20 bg-primary/[0.02] p-3">
            <p className="flex items-center gap-1.5 text-[11px] font-medium text-primary">
              <TrendingUp className="h-3.5 w-3.5" />
              {capabilityImpact.explanation}
            </p>
          </div>
        </>
      )}
    </Card>
  )
}

function CapabilityCard({ cap }: { cap: DesiredCapability }) {
  return (
    <div className="rounded-lg border border-border/60 bg-background/30 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold">{cap.label}</p>
          {/* N0.5 hardening: show ALL triggers, not just the first */}
          <div className="mt-1 space-y-0.5">
            {cap.triggers.slice(0, 3).map((trigger, i) => (
              <p key={i} className="text-[11px] text-muted-foreground">
                Blocks: {trigger.blockerLabel} ({trigger.trajectoryLabel})
              </p>
            ))}
            {cap.triggers.length > 3 && (
              <p className="text-[10px] text-muted-foreground">+{cap.triggers.length - 3} more</p>
            )}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <Badge
            variant="outline"
            className={cn(
              'gap-1 text-[9px] font-medium',
              cap.requiresActor
                ? 'border-amber-500/40 text-amber-700 dark:text-amber-400 bg-amber-500/5'
                : 'border-emerald-500/40 text-emerald-700 dark:text-emerald-400 bg-emerald-500/5'
            )}
          >
            {cap.requiresActor ? <Users className="h-2.5 w-2.5" /> : <User className="h-2.5 w-2.5" />}
            {cap.requiresActor ? 'Needs actor' : 'Self-acquirable'}
          </Badge>
          {cap.origin === 'EXPLICIT' && (
            <Badge variant="outline" className="text-[9px] font-normal border-primary/30 text-primary">
              You requested
            </Badge>
          )}
        </div>
      </div>

      {/* Potential unlocks */}
      {cap.potentialUnlocks.length > 0 && (
        <div className="mt-2">
          <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Could unlock
          </p>
          <div className="mt-1 space-y-0.5">
            {cap.potentialUnlocks.slice(0, 3).map((unlock) => (
              <div key={unlock.routeId} className="flex items-center gap-1.5 text-[11px]">
                <span className="truncate text-foreground/80">{unlock.routeLabel}</span>
                {unlock.remainingBlockers > 0 ? (
                  <Badge variant="outline" className="text-[9px] font-normal border-amber-500/30 text-amber-700 dark:text-amber-400">
                    +{unlock.remainingBlockers} more blocker{unlock.remainingBlockers !== 1 ? 's' : ''}
                  </Badge>
                ) : (
                  <CheckCircle2 className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
                )}
              </div>
            ))}
            {cap.potentialUnlocks.length > 3 && (
              <p className="text-[10px] text-muted-foreground">
                +{cap.potentialUnlocks.length - 3} more
              </p>
            )}
          </div>
        </div>
      )}

      {/* Urgency + Impact bars */}
      <div className="mt-2 flex items-center gap-3">
        <div className="flex-1">
          <div className="flex items-center justify-between text-[9px] text-muted-foreground">
            <span>Urgency</span>
            <span>{Math.round(cap.urgency * 100)}%</span>
          </div>
          <div className="mt-0.5 h-1 rounded-full bg-muted">
            <div className="h-full rounded-full bg-amber-500/60" style={{ width: `${cap.urgency * 100}%` }} />
          </div>
        </div>
        <div className="flex-1">
          <div className="flex items-center justify-between text-[9px] text-muted-foreground">
            <span>Impact</span>
            <span>{Math.round(cap.impact * 100)}%</span>
          </div>
          <div className="mt-0.5 h-1 rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary/60" style={{ width: `${cap.impact * 100}%` }} />
          </div>
        </div>
      </div>
    </div>
  )
}

export default NeedsCapabilitySection
