'use client'

import { useState, useEffect } from 'react'
import { useWayfinder } from '@/components/wayfinder/store'
import { RouteList } from '@/components/wayfinder/route-list'
import { RouteDetail } from '@/components/wayfinder/route-detail'
import { MobilityFrontierChart } from '@/components/wayfinder/mobility-frontier'
import { CounterfactualPanel } from '@/components/wayfinder/counterfactual-panel'
import { EnablerList } from '@/components/wayfinder/enabler-list'
import { ChangeSignal } from '@/components/wayfinder/policy/change-signal'
import { HistoricalModePicker } from '@/components/wayfinder/policy/historical-mode-picker'
import { PlanHistory } from '@/components/wayfinder/plan-history'
import { StrategyHistory } from '@/components/wayfinder/strategy/strategy-history'
import { StrategyHero } from '@/components/wayfinder/strategy/strategy-hero'
import { TrajectoryMap } from '@/components/wayfinder/strategy/trajectory-map'
import { BlockerSection } from '@/components/wayfinder/strategy/blocker-section'
import { ActionPlanSection } from '@/components/wayfinder/strategy/action-plan-section'
import { ProfileAnalysisSection } from '@/components/wayfinder/strategy/profile-analysis-section'
import { ProfileEditor } from '@/components/wayfinder/profile-editor'
import { IntentFrontierSection } from '@/components/wayfinder/strategy/intent-frontier-section'
import { NeedsCapabilitySection } from '@/components/wayfinder/strategy/needs-capability-section'
import { StrategyExplanationPanel } from '@/components/wayfinder/strategy/strategy-explanation-panel'
import { PreferenceQuestionCard } from '@/components/wayfinder/strategy/preference-question-card'
import { StrategyDiffBanner, type StrategyDiff } from '@/components/wayfinder/strategy/strategy-diff-banner'
import { StrategyStalenessBanner } from '@/components/wayfinder/strategy/strategy-staleness-banner'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import {
  Compass, Crown, Lock, ArrowRight, Sparkles, Lightbulb, FlaskConical,
  Handshake, ShieldCheck, Save, History, CheckCircle2, AlertTriangle, Scale, FileEdit,
} from 'lucide-react'
import { POLICY_VERSION } from '@/lib/knowledge/policy-version'
import { defaultScenarios } from '@/lib/engine/simulate'
import { cn } from '@/lib/utils'

export function ResultsDashboard() {
  const plan = useWayfinder((s) => s.plan)
  const narrative = useWayfinder((s) => s.narrative)
  const evidence = useWayfinder((s) => s.evidence)
  const strategy = useWayfinder((s) => s.strategy)
  const strategyLoading = useWayfinder((s) => s.strategyLoading)
  const strategyError = useWayfinder((s) => s.strategyError)
  const activeRouteId = useWayfinder((s) => s.activeRouteId)
  const setActiveRoute = useWayfinder((s) => s.setActiveRoute)
  const runCounterfactual = useWayfinder((s) => s.runCounterfactual)
  const mobilityState = useWayfinder((s) => s.mobilityState)
  const intent = useWayfinder((s) => s.intent)
  const scenarios = useWayfinder((s) => s.scenarios)
  const strategyStaleness = useWayfinder((s) => s.strategyStaleness)
  const strategyProvenance = useWayfinder((s) => s.strategyProvenance)
  const recomputeStrategy = useWayfinder((s) => s.recomputeStrategy)
  const activeObjective = useWayfinder((s) => s.activeObjective)

  const [savedId, setSavedId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [strategyDiff, setStrategyDiff] = useState<StrategyDiff | null>(null)
  const [profileEditorOpen, setProfileEditorOpen] = useState(false)
  const [prevStrategyLabel, setPrevStrategyLabel] = useState<string | null>(null)

  // Track strategy changes for the diff banner
  useEffect(() => {
    if (strategy?.bestTrajectory) {
      const currentLabel = strategy.bestTrajectory.label
      if (prevStrategyLabel && prevStrategyLabel !== currentLabel) {
        setStrategyDiff({
          previousLabel: prevStrategyLabel,
          newLabel: currentLabel,
          reason: 'Your preferences or profile changed, altering the optimal trajectory.',
        })
      }
      setPrevStrategyLabel(currentLabel)
    }
  }, [strategy?.bestTrajectory?.label])

  if (!plan || !mobilityState || !intent) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-20 text-center text-sm text-muted-foreground">
        No plan computed yet.
      </div>
    )
  }

  const activeRoute = plan.routes.find((r) => r.id === activeRouteId) ?? plan.routes[0]
  const bestRoute = plan.routes.find((r) => r.id === plan.recommendation.bestRouteId) ?? plan.routes[0]
  const isBestActive = activeRoute.id === bestRoute.id

  const handleSave = async () => {
    setSaving(true)
    try {
      const res = await fetch('/api/decision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan }),
      })
      const data = await res.json()
      setSavedId(data.id)
    } catch (e) {
      console.error(e)
    } finally {
      setSaving(false)
    }
  }

  const handleCounterfactual = async (specId: string) => {
    const spec = defaultScenarios(mobilityState).find((s) => s.id === specId)
    if (spec) await runCounterfactual(spec)
  }

  const superiorAlts = plan.alternativeIntents.filter((a) => a.mayBeSuperior)

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      {/* ===== STRATEGY DIFF BANNER ===== */}
      <StrategyDiffBanner diff={strategyDiff} onDismiss={() => setStrategyDiff(null)} />

      {/* ===== STRATEGY LAYER (primary experience) ===== */}
      {strategyLoading && (
        <section className="mb-6">
          <Card className="border-border/60 bg-card/60 p-5 wf-panel">
            <div className="flex items-center gap-3">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              <div>
                <p className="text-sm font-medium">Building your mobility strategy…</p>
                <p className="text-xs text-muted-foreground">Analyzing trajectories, blockers, and actions against the current policy.</p>
              </div>
            </div>
          </Card>
        </section>
      )}
      {strategyError && !strategy && (
        <section className="mb-6">
          <Card className="border-amber-500/40 bg-amber-500/5 p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                <p className="text-sm text-amber-700 dark:text-amber-400">
                  Your mobility plan is ready. Strategy analysis is temporarily unavailable.
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 text-xs"
                onClick={() => {
                  const { mobilityState: ms, intent: it, asOfDate: ad } = useWayfinder.getState()
                  if (!ms || !it) return
                  useWayfinder.setState({ strategyLoading: true, strategyError: false })
                  fetch('/api/strategy', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ state: ms, intent: it, asOfDate: ad ?? undefined }),
                  })
                    .then((r) => r.ok ? r.json() : null)
                    .then((d) => {
                      if (d?.strategy) useWayfinder.setState({ strategy: d.strategy, strategyLoading: false })
                      else useWayfinder.setState({ strategyLoading: false, strategyError: true })
                    })
                    .catch(() => useWayfinder.setState({ strategyLoading: false, strategyError: true }))
                }}
              >
                Retry strategy
              </Button>
            </div>
          </Card>
        </section>
      )}
      {strategy && (
        <>
          {/* Staleness banner — surfaces structured STALE_POLICY / STALE_PROFILE
              / STALE_INTENT / STALE_ENGINE / STALE_MULTIPLE. Never a single boolean. */}
          <section className="mb-4">
            <StrategyStalenessBanner
              assessment={strategyStaleness}
              onRecalculate={() => { void recomputeStrategy() }}
              isRecalculating={strategyLoading}
            />
          </section>

          <section className="mb-6">
            <StrategyHero
              strategy={strategy}
              provenanceLabel={strategyProvenance
                ? `engine ${strategyProvenance.strategyEngineVersion} · state v${strategyProvenance.mobilityStateVersion} · intent v${strategyProvenance.intentVersion}`
                : undefined}
            />
          </section>

          {/* Preference question — shown right after the hero */}
          {strategy.preferenceQuestions.length > 0 && (
            <section className="mb-6">
              <PreferenceQuestionCard question={strategy.preferenceQuestions[0]} />
            </section>
          )}

          <section className="mb-6">
            <TrajectoryMap trajectory={strategy.bestTrajectory} />
          </section>

          {strategy.blockers.length > 0 && (
            <section className="mb-6">
              <BlockerSection blockers={strategy.blockers} />
            </section>
          )}

          <section className="mb-6">
            <ActionPlanSection plan={strategy.actionPlan} blockers={strategy.blockers} />
          </section>

          <section className="mb-6">
            <div className="mb-2 flex justify-end">
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 text-xs"
                onClick={() => setProfileEditorOpen(true)}
              >
                <FileEdit className="h-3.5 w-3.5" />
                Edit profile
              </Button>
            </div>
            <ProfileAnalysisSection analysis={strategy.profileAnalysis} />
          </section>

          <section className="mb-6">
            <IntentFrontierSection frontier={strategy.intentFrontier} alternativeIntents={strategy.alternativeIntents} />
          </section>

          {/* N0.5 — Needs + Desired Capability Intelligence */}
          {strategy.needs && (
            <section className="mb-6">
              <NeedsCapabilitySection
                needs={strategy.needs}
                desiredCapabilities={strategy.desiredCapabilities ?? []}
                capabilityImpact={strategy.capabilityImpact ?? null}
              />
            </section>
          )}

          {/* N0.6 — Strategy Explanation Panel */}
          {strategy.explanation && typeof strategy.explanation !== 'string' && (
            <section className="mb-6">
              <StrategyExplanationPanel explanation={strategy.explanation as any} />
            </section>
          )}

          <Separator className="my-6" />
          <p className="mb-4 text-center text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Detailed route analysis &amp; evidence
          </p>
        </>
      )}

      {/* ===== RECOMMENDATION HEADER ===== */}
      <section className="mb-6">
        <Card className="overflow-hidden border-border/60 bg-card/70 wf-panel">
          <div className="wf-topo relative border-b border-border/50 px-5 py-4 sm:px-6">
            <div className="absolute inset-0 bg-background/60" />
            <div className="relative flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/15 text-primary">
                  <Compass className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Your best route</p>
                  <h2 className="text-lg font-semibold leading-tight sm:text-xl">{bestRoute.label}</h2>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {bestRoute.paretoOptimal && (
                  <Badge className="gap-1 bg-primary/15 text-[10px] font-medium text-primary">
                    <Crown className="h-2.5 w-2.5" /> Pareto-optimal
                  </Badge>
                )}
                <Badge variant="outline" className="text-[10px] font-normal">
                  {bestRoute.eligibility.status === 'eligible' && 'Actionable now'}
                  {bestRoute.eligibility.status === 'conditional' && 'Conditional'}
                  {bestRoute.eligibility.status === 'ineligible' && 'Blocked'}
                </Badge>
                <Badge variant="outline" className="text-[10px] font-normal">
                  confidence: {plan.confidence}
                </Badge>
                {plan.policySnapshotId && (
                  <Badge variant="outline" className="text-[10px] font-normal">
                    snapshot: {plan.policySnapshotId.replace('snap-', '')}
                  </Badge>
                )}
                <HistoricalModePicker />
              </div>
            </div>
          </div>

          {/* Change signal: flags if the best route is invalidated by a newer snapshot */}
          <ChangeSignal route={bestRoute} plan={plan} latestSnapshotId="snap-2026-01" />

          <div className="grid gap-px bg-border/40 sm:grid-cols-2 lg:grid-cols-4">
            <RecCell icon={Sparkles} label="Why this ranks first" tone="primary">
              {narrative?.whyBest ?? plan.recommendation.rationale.join(' ')}
            </RecCell>
            <RecCell icon={Lock} label="What is blocking it" tone="destructive">
              {narrative?.blocker ?? (plan.recommendation.primaryBlocker
                ? `Primary blocker: ${plan.recommendation.primaryBlocker}.`
                : 'No hard blockers — actionable now.')}
            </RecCell>
            <RecCell icon={ArrowRight} label="What to do next" tone="accent">
              {narrative?.nextAction ?? plan.recommendation.nextAction}
            </RecCell>
            <RecCell icon={AlertTriangle} label="What could change this" tone="amber">
              {narrative?.uncertainty ?? plan.recommendation.sensitivityAssumptions[0] ?? 'No material sensitivity.'}
            </RecCell>
          </div>

          {/* intent assessment banner */}
          {plan.recommendation.intentMayBeSuboptimal && superiorAlts.length > 0 && (
            <div className="border-t border-border/50 bg-accent/5 px-5 py-3 sm:px-6">
              <div className="flex items-start gap-2.5">
                <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">
                    A better goal you may want to consider
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {narrative?.alternativeIntentNote ?? 'Your stated intent may be suboptimal given your profile.'}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {superiorAlts.map((a) => (
                      <span key={a.goal} className="rounded-full border border-accent/40 bg-accent/10 px-2.5 py-1 text-[11px] font-medium text-accent-foreground">
                        {a.title}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </Card>
      </section>

      {/* ===== ROUTE LIST + DETAIL ===== */}
      <section className="mb-6 grid gap-4 lg:grid-cols-12">
        <div className="lg:col-span-4 xl:col-span-3">
          <Card className="border-border/60 bg-card/60 p-3">
            <div className="mb-2 flex items-center justify-between px-1">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                All routes ({plan.routes.length})
              </h3>
              <span className="text-[10px] text-muted-foreground">{plan.frontier.paretoOptimalRouteIds.length} Pareto</span>
            </div>
            <RouteList
              routes={plan.routes}
              activeRouteId={activeRoute.id}
              bestRouteId={bestRoute.id}
              onSelect={setActiveRoute}
            />
          </Card>
        </div>
        <div className="lg:col-span-8 xl:col-span-9">
          <RouteDetail route={activeRoute} evidence={evidence} compareTo={isBestActive ? (plan.routes[1] ?? null) : bestRoute} />
        </div>
      </section>

      {/* ===== MOBILITY FRONTIER ===== */}
      <section className="mb-6">
        <Card className="border-border/60 bg-card/60 p-4 sm:p-5">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold">Mobility frontier</h3>
              <p className="text-xs text-muted-foreground">
                Pareto-optimal trajectories across {plan.frontier.paretoDimensions.length} dimensions you care about. We don&apos;t collapse to one score.
              </p>
            </div>
            <Badge variant="outline" className="hidden text-[10px] font-normal sm:inline-flex">
              {plan.frontier.paretoDimensions.length} dimensions
            </Badge>
          </div>
          <MobilityFrontierChart
            frontier={plan.frontier}
            routes={plan.routes}
            activeRouteId={activeRoute.id}
            onSelect={setActiveRoute}
          />
        </Card>
      </section>

      {/* ===== COUNTERFACTUAL + ENABLERS + ALTERNATIVE INTENTS ===== */}
      <section className="mb-6 grid gap-4 lg:grid-cols-3">
        <Card className="border-border/60 bg-card/60 p-4">
          <SectionHeader icon={FlaskConical} title="What if?" />
          <CounterfactualPanel
            state={mobilityState}
            intent={intent}
            scenarios={scenarios}
            routes={plan.routes}
            onRun={handleCounterfactual}
          />
        </Card>

        <Card className="border-border/60 bg-card/60 p-4">
          <SectionHeader icon={Handshake} title="Enablers" count={plan.enablerMatches.length} />
          <EnablerList matches={plan.enablerMatches} routes={plan.routes} />
        </Card>

        <Card className="border-border/60 bg-card/60 p-4">
          <SectionHeader icon={Lightbulb} title="Alternative intents" count={plan.alternativeIntents.length} />
          <div className="space-y-3">
            {plan.alternativeIntents.map((a) => (
              <div
                key={a.goal}
                className={cn(
                  'rounded-lg border p-3',
                  a.mayBeSuperior ? 'border-accent/40 bg-accent/5' : 'border-border/50 bg-background/30',
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold">{a.title}</p>
                  {a.mayBeSuperior && (
                    <Badge className="bg-accent/20 text-[9px] font-medium text-accent-foreground">may be superior</Badge>
                  )}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{a.rationale}</p>
                {a.betterSatisfies.length > 0 && (
                  <p className="mt-1.5 text-[11px] text-emerald-700 dark:text-emerald-400">
                    Better satisfies: {a.betterSatisfies.join(', ')}
                  </p>
                )}
                {a.tradeoffs.length > 0 && (
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    Tradeoff: {a.tradeoffs.join('; ')}
                  </p>
                )}
                {a.bestRouteId && (
                  <button
                    onClick={() => setActiveRoute(a.bestRouteId!)}
                    className="mt-2 text-[11px] font-medium text-primary hover:underline"
                  >
                    → Inspect its best route
                  </button>
                )}
              </div>
            ))}
          </div>
        </Card>
      </section>

      {/* ===== DECISION LEDGER ===== */}
      <section className="mb-6">
        <Card className="border-border/60 bg-card/60 p-4 sm:p-5">
          <SectionHeader icon={History} title="Decision ledger — reproducibility" />
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <LedgerRow label="Policy version" value={plan.policyVersion} icon={ShieldCheck} />
              <LedgerRow label="Policy hash" value={plan.policyHash} mono />
              {plan.policySnapshotId && (
                <LedgerRow label="Policy snapshot" value={plan.policySnapshotId} mono />
              )}
              <LedgerRow label="As-of date" value={new Date(plan.asOfDate).toLocaleString()} />
              <LedgerRow label="Engine" value="deterministic (policy-as-code)" icon={Scale} />
              <LedgerRow label="Routes evaluated" value={String(plan.routes.length)} />
              <LedgerRow label="Evidence records" value={String(evidence.length)} />
            </div>
            <div className="flex flex-col justify-between gap-3 rounded-lg border border-border/50 bg-background/30 p-3">
              <div>
                <p className="text-sm font-medium">Every recommendation is reproducible</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Saving stores the full computed plan with the policy version + hash. Even after policy
                  changes, the historical decision can be reconstructed — including what Wayfinder
                  believed was true on this date.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button onClick={handleSave} disabled={saving} className="gap-2" size="sm">
                  {saving ? <History className="h-3.5 w-3.5 animate-pulse" /> : <Save className="h-3.5 w-3.5" />}
                  {savedId ? 'Saved to ledger' : 'Save to decision ledger'}
                </Button>
                {savedId && (
                  <span className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="h-3.5 w-3.5" /> {savedId.slice(0, 12)}…
                  </span>
                )}
              </div>
            </div>
          </div>
        </Card>
      </section>

      {/* ===== STRATEGY HISTORY (N0.2 Strategy Memory) ===== */}
      <section className="mb-6">
        <StrategyHistory objectiveId={activeObjective} />
      </section>

      {/* ===== PLAN HISTORY (existing, retained) ===== */}
      <section className="mb-6">
        <PlanHistory />
      </section>

      <Separator className="my-2" />
      <p className="pb-4 text-center text-[11px] text-muted-foreground">
        Wayfinder v{POLICY_VERSION.version} · Policy curated {new Date(POLICY_VERSION.curatedAt).toLocaleDateString()} ·
        Figures are planning approximations — verify primary sources before action. Not legal advice.
      </p>

      {/* === PROFILE EDITOR (N0.3) === */}
      {mobilityState && (
        <ProfileEditor
          key={`profile-editor-${profileEditorOpen}`}
          open={profileEditorOpen}
          onOpenChange={setProfileEditorOpen}
          currentState={mobilityState}
          onSaved={(updatedState) => {
            useWayfinder.setState({ mobilityState: updatedState })
          }}
        />
      )}
    </div>
  )
}

function SectionHeader({ icon: Icon, title, count }: { icon: React.ComponentType<{ className?: string }>; title: string; count?: number }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold">{title}</h3>
      </div>
      {count != null && <Badge variant="secondary" className="text-[10px] font-normal">{count}</Badge>}
    </div>
  )
}

function RecCell({
  icon: Icon,
  label,
  children,
  tone,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  children: React.ReactNode
  tone: 'primary' | 'destructive' | 'accent' | 'amber'
}) {
  const toneCls = {
    primary: 'text-primary bg-primary/5',
    destructive: 'text-destructive bg-destructive/5',
    accent: 'text-accent-foreground bg-accent/10',
    amber: 'text-amber-700 dark:text-amber-400 bg-amber-500/5',
  }[tone]
  return (
    <div className="bg-card/60 p-4">
      <div className="mb-1.5 flex items-center gap-1.5">
        <span className={cn('flex h-5 w-5 items-center justify-center rounded', toneCls)}>
          <Icon className="h-3 w-3" />
        </span>
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</span>
      </div>
      <p className="text-xs leading-relaxed text-foreground/85">{children}</p>
    </div>
  )
}

function LedgerRow({ label, value, icon: Icon, mono }: { label: string; value: string; icon?: React.ComponentType<{ className?: string }>; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded bg-background/40 px-2.5 py-1.5">
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {Icon && <Icon className="h-3 w-3" />}
        {label}
      </span>
      <span className={cn('text-xs font-medium', mono && 'font-mono')}>{value}</span>
    </div>
  )
}
