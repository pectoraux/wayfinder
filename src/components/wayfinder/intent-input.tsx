'use client'

import { useWayfinder } from '@/components/wayfinder/store'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { WayfinderLogo } from '@/components/wayfinder/wayfinder-logo'
import { ArrowRight, Sparkles, Map, Compass, Route as RouteIcon } from 'lucide-react'
import { useState } from 'react'

const EXAMPLE_INTENTS = [
  'I want to move somewhere I can earn more and start a company.',
  'I want to study abroad and eventually stay.',
  'I want a safer country for my family.',
  'I want to maximize my global mobility and a second citizenship eventually.',
  'I want to spend three years in Europe.',
]

export function IntentInput() {
  const rawIntent = useWayfinder((s) => s.rawIntent)
  const setRawIntent = useWayfinder((s) => s.setRawIntent)
  const submitIntent = useWayfinder((s) => s.submitIntent)
  const loadExample = useWayfinder((s) => s.loadExample)
  const isComputing = useWayfinder((s) => s.isComputing)
  const error = useWayfinder((s) => s.error)
  const [focused, setFocused] = useState(false)

  return (
    <div className="relative overflow-hidden">
      {/* topographic background */}
      <div className="wf-topo absolute inset-0 -z-10 opacity-70" />
      <div className="absolute inset-0 -z-10 bg-gradient-to-b from-transparent via-background/40 to-background" />

      <section className="mx-auto flex max-w-4xl flex-col items-center px-4 pb-20 pt-16 text-center sm:px-6 sm:pt-24">
        <div className="mb-6 inline-flex h-16 w-16 items-center justify-center rounded-2xl border border-border/60 bg-card/70 wf-panel">
          <WayfinderLogo className="h-9 w-9 text-primary" animated />
        </div>

        <p className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-card/70 px-3 py-1 text-xs font-medium text-muted-foreground">
          <Sparkles className="h-3 w-3 text-accent" />
          Global Mobility Intelligence
        </p>

        <h1 className="max-w-2xl text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
          What are you trying to <span className="text-primary">make possible?</span>
        </h1>

        <p className="mt-4 max-w-xl text-balance text-muted-foreground">
          Don&apos;t ask &ldquo;what visa can I get?&rdquo; Tell Wayfinder your intent. It will map
          every legal route, rank them, find the blockers, and connect you to the legitimate
          enablers who can unlock them.
        </p>

        <div className="mt-8 w-full max-w-2xl">
          <div
            className={`relative rounded-2xl border bg-card/80 p-2 wf-panel transition-all ${
              focused ? 'border-primary/50 ring-2 ring-primary/15' : 'border-border/60'
            }`}
          >
            <Textarea
              value={rawIntent}
              onChange={(e) => setRawIntent(e.target.value)}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              placeholder="e.g. I'm a software engineer from Kenya earning $70k. I want to move somewhere I can start a company, earn more, and eventually get permanent residence — while keeping the freedom to travel."
              className="min-h-[120px] resize-none border-0 bg-transparent px-3 py-2 text-base shadow-none focus-visible:ring-0"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault()
                  submitIntent()
                }
              }}
            />
            <div className="flex items-center justify-between gap-2 px-2 pb-1 pt-2">
              <span className="text-xs text-muted-foreground">
                {rawIntent.length > 0 ? `${rawIntent.length} chars · ⌘+↵ to continue` : 'Free-form — describe your real goal'}
              </span>
              <Button
                onClick={submitIntent}
                disabled={isComputing || rawIntent.trim().length < 8}
                className="gap-2"
              >
                {isComputing ? 'Understanding…' : 'Find my routes'}
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {error && <p className="mt-3 text-sm text-destructive">{error}</p>}

          <div className="mt-6">
            <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Or start from an example intent
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {EXAMPLE_INTENTS.map((ex) => (
                <button
                  key={ex}
                  onClick={() => setRawIntent(ex)}
                  className="rounded-full border border-border/60 bg-card/60 px-3 py-1.5 text-xs text-foreground/80 transition-colors hover:border-primary/40 hover:bg-card hover:text-foreground"
                >
                  {ex}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-6">
            <Button
              variant="outline"
              size="sm"
              onClick={loadExample}
              className="gap-2"
            >
              <Compass className="h-3.5 w-3.5" />
              Load the full demo profile (Kenya · software engineer)
            </Button>
          </div>
        </div>
      </section>

      {/* principle strip */}
      <section className="mx-auto max-w-5xl px-4 pb-16 sm:px-6">
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            { icon: Map, title: 'Map every legal route', body: 'A deterministic engine over a curated, versioned mobility graph — not an LLM guess.' },
            { icon: RouteIcon, title: 'Find the blockers & enablers', body: 'See exactly what blocks your best route and who can legitimately unlock it.' },
            { icon: Sparkles, title: 'Discover better intents', body: 'Your stated goal may be suboptimal. Wayfinder surfaces superior objectives.' },
          ].map((f) => (
            <div key={f.title} className="rounded-xl border border-border/60 bg-card/60 p-4">
              <f.icon className="mb-2 h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold">{f.title}</h3>
              <p className="mt-1 text-xs text-muted-foreground">{f.body}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
