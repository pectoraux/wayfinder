'use client'

import { WayfinderLogo } from '@/components/wayfinder/wayfinder-logo'

const STAGES = [
  'Evaluating deterministic eligibility across 9 pathways…',
  'Generating legal state-transition routes…',
  'Computing the Pareto frontier…',
  'Discovering alternative intents…',
  'Matching legitimate enablers to blockers…',
  'Running counterfactual scenarios…',
  'Writing the explanation…',
]

export function ComputingView() {
  return (
    <div className="wf-topo relative flex min-h-[70vh] items-center justify-center overflow-hidden">
      <div className="absolute inset-0 -z-10 bg-gradient-to-b from-background/30 to-background" />
      <div className="flex flex-col items-center gap-6 px-6 text-center">
        <WayfinderLogo className="h-14 w-14 text-primary" animated />
        <div>
          <h2 className="text-xl font-semibold">Mapping your mobility graph</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            The deterministic engine is running. The LLM is only used to phrase the explanation.
          </p>
        </div>
        <div className="w-full max-w-sm space-y-2">
          {STAGES.map((s, i) => (
            <div
              key={s}
              className="flex items-center gap-2 text-left text-xs text-muted-foreground"
              style={{ animation: `wf-fade 0.4s ease ${i * 0.18}s both` }}
            >
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" style={{ animationDelay: `${i * 0.18}s` }} />
              {s}
            </div>
          ))}
        </div>
      </div>
      <style>{`@keyframes wf-fade { from { opacity: 0; transform: translateY(4px) } to { opacity: 1; transform: none } }`}</style>
    </div>
  )
}
