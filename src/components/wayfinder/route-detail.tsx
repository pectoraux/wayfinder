'use client'

import type { Route } from '@/lib/domain/types'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ScoreRadar } from '@/components/wayfinder/score-radar'
import { RouteMap } from '@/components/wayfinder/route-map'
import { EvidenceTrail } from '@/components/wayfinder/evidence-trail'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Clock, DollarSign, ShieldAlert, Unlock, ArrowRightCircle, FileCheck, Network } from 'lucide-react'
import type { Evidence } from '@/lib/domain/types'

const SCORE_ROWS: { key: keyof Route['scores']; label: string }[] = [
  { key: 'economicUpside', label: 'Economic upside' },
  { key: 'immigrationProbability', label: 'Immigration probability' },
  { key: 'speed', label: 'Speed' },
  { key: 'affordability', label: 'Affordability' },
  { key: 'longTermResidence', label: 'Long-term residence' },
  { key: 'citizenshipProspect', label: 'Citizenship prospect' },
  { key: 'familyUtility', label: 'Family utility' },
  { key: 'mobilityUpside', label: 'Mobility upside' },
  { key: 'optionality', label: 'Optionality' },
  { key: 'reversibility', label: 'Reversibility' },
  { key: 'riskAdjusted', label: 'Risk-adjusted' },
]

export function RouteDetail({
  route,
  evidence,
  compareTo,
}: {
  route: Route
  evidence: Evidence[]
  compareTo?: Route | null
}) {
  const elig = route.eligibility

  return (
    <div className="space-y-4">
      {/* header */}
      <Card className="border-border/60 bg-card/70 p-4 wf-panel">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold">{route.label}</h3>
            <p className="text-xs text-muted-foreground">{route.steps[1]?.description}</p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <StatusBadge status={elig.status} />
            <Badge variant="outline" className="gap-1 text-[10px] font-normal">
              <Clock className="h-2.5 w-2.5" /> {Math.round(route.totalMonths / 12)}y horizon
            </Badge>
            <Badge variant="outline" className="gap-1 text-[10px] font-normal">
              <DollarSign className="h-2.5 w-2.5" /> ${route.totalCostUSD.toLocaleString()} fees
            </Badge>
            {route.paretoOptimal && (
              <Badge className="bg-primary/15 text-[10px] font-medium text-primary">Pareto-optimal</Badge>
            )}
          </div>
        </div>

        {/* route map */}
        <div className="mt-4 rounded-xl border border-border/40 bg-background/40 p-3">
          <RouteMap route={route} />
        </div>
      </Card>

      {/* tabs */}
      <Tabs defaultValue="eligibility">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="eligibility" className="text-xs">Eligibility</TabsTrigger>
          <TabsTrigger value="scores" className="text-xs">Scores</TabsTrigger>
          <TabsTrigger value="blockers" className="text-xs">Blockers</TabsTrigger>
          <TabsTrigger value="evidence" className="text-xs">Evidence</TabsTrigger>
        </TabsList>

        {/* eligibility */}
        <TabsContent value="eligibility" className="mt-3">
          <Card className="border-border/60 bg-card/60 p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <RequirementGroup title="Satisfied" items={elig.satisfied} tone="emerald" />
              <RequirementGroup title="To confirm (conditional)" items={elig.unknown} tone="amber" />
              {elig.failed.length > 0 && (
                <RequirementGroup title="Not met" items={elig.failed} tone="destructive" />
              )}
            </div>
            {elig.conditions.length > 0 && (
              <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
                <p className="flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400">
                  <ShieldAlert className="h-3.5 w-3.5" /> Conditions to clear
                </p>
                <ul className="mt-1.5 space-y-1">
                  {elig.conditions.map((c, i) => (
                    <li key={i} className="text-xs text-foreground/80">• {c}</li>
                  ))}
                </ul>
              </div>
            )}
          </Card>
        </TabsContent>

        {/* scores */}
        <TabsContent value="scores" className="mt-3">
          <Card className="border-border/60 bg-card/60 p-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <ScoreRadar route={route} compareTo={compareTo} />
              <div className="space-y-1.5">
                {SCORE_ROWS.map((row) => (
                  <div key={row.key} className="flex items-center gap-2">
                    <span className="w-32 shrink-0 text-[11px] text-muted-foreground">{row.label}</span>
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{ width: `${route.scores[row.key]}%` }}
                      />
                    </div>
                    <span className="w-7 text-right text-[11px] font-medium tabular-nums">{route.scores[row.key]}</span>
                  </div>
                ))}
              </div>
            </div>
            <p className="mt-3 text-[11px] text-muted-foreground">
              Scores are computed deterministically from the pathway rules and your profile. They are
              planning heuristics, not guarantees. The Pareto frontier avoids collapsing them to one number.
            </p>
          </Card>
        </TabsContent>

        {/* blockers */}
        <TabsContent value="blockers" className="mt-3">
          <Card className="border-border/60 bg-card/60 p-4">
            {elig.blockers.length === 0 ? (
              <div className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
                <FileCheck className="h-4 w-4" /> No hard blockers on this route — it is actionable.
              </div>
            ) : (
              <div className="space-y-3">
                {elig.blockers.map((b) => (
                  <div key={b.requirementId} className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
                    <div className="flex items-start gap-2">
                      <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-foreground">{b.label}</p>
                        <p className="text-xs text-muted-foreground">{b.reason}</p>
                        {b.addressableVia.length > 0 && (
                          <div className="mt-2">
                            <p className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                              <Unlock className="h-2.5 w-2.5" /> Legitimate unlocks
                            </p>
                            <div className="mt-1 flex flex-wrap gap-1.5">
                              {b.addressableVia.map((a, i) => (
                                <Badge key={i} variant="outline" className="gap-1 text-[10px] font-normal text-emerald-700 dark:text-emerald-400">
                                  <Network className="h-2.5 w-2.5" /> {a.label}
                                </Badge>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {/* future options */}
            <div className="mt-4 border-t border-border/50 pt-3">
              <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <ArrowRightCircle className="h-3.5 w-3.5" /> Future options unlocked
              </p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {route.futureOptions.map((f, i) => (
                  <Badge key={i} variant="secondary" className="text-[10px] font-normal">{f}</Badge>
                ))}
              </div>
            </div>
          </Card>
        </TabsContent>

        {/* evidence */}
        <TabsContent value="evidence" className="mt-3">
          <Card className="border-border/60 bg-card/60 p-4">
            <p className="mb-2 text-xs text-muted-foreground">
              Every legally significant claim on this route is traceable to an authoritative source.
              Click through to verify.
            </p>
            <EvidenceTrail route={route} evidence={evidence} />
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}

function StatusBadge({ status }: { status: Route['eligibility']['status'] }) {
  const map = {
    eligible: { cls: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400', label: 'Eligible now' },
    conditional: { cls: 'bg-amber-500/15 text-amber-700 dark:text-amber-400', label: 'Conditional' },
    ineligible: { cls: 'bg-destructive/15 text-destructive', label: 'Blocked' },
  } as const
  const s = map[status]
  return <Badge className={`text-[10px] font-medium ${s.cls}`}>{s.label}</Badge>
}

function RequirementGroup({
  title,
  items,
  tone,
}: {
  title: string
  items: Route['eligibility']['satisfied']
  tone: 'emerald' | 'amber' | 'destructive'
}) {
  if (items.length === 0) return null
  const toneCls = {
    emerald: 'text-emerald-700 dark:text-emerald-400',
    amber: 'text-amber-700 dark:text-amber-400',
    destructive: 'text-destructive',
  }[tone]
  return (
    <div>
      <p className={`mb-1.5 text-[10px] font-medium uppercase tracking-wider ${toneCls}`}>{title}</p>
      <ul className="space-y-1">
        {items.map((e) => (
          <li key={e.requirement.id} className="rounded bg-background/40 px-2 py-1 text-[11px]">
            <span className="font-medium text-foreground/90">{e.requirement.label}</span>
            <span className="block text-muted-foreground">{e.reason}</span>
            {e.needed && <span className="block text-amber-700 dark:text-amber-400">→ {e.needed}</span>}
          </li>
        ))}
      </ul>
    </div>
  )
}
