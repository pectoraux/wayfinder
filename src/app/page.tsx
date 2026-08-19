'use client'

import { useWayfinder } from '@/components/wayfinder/store'
import { IntentInput } from '@/components/wayfinder/intent-input'
import { IntakeFlow } from '@/components/wayfinder/intake-flow'
import { ResultsDashboard } from '@/components/wayfinder/results-dashboard'
import { ComputingView } from '@/components/wayfinder/computing-view'
import { ErrorBoundary } from '@/components/wayfinder/error-boundary'
import { WayfinderWordmark } from '@/components/wayfinder/wayfinder-logo'
import { HeaderAuth } from '@/components/wayfinder/header-auth'
import { Button } from '@/components/ui/button'
import { Compass, RotateCcw } from 'lucide-react'

export default function Home() {
  const phase = useWayfinder((s) => s.phase)
  const reset = useWayfinder((s) => s.reset)

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6">
          <button onClick={reset} className="flex items-center gap-2 transition-opacity hover:opacity-80">
            <WayfinderWordmark />
          </button>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Compass className="hidden h-3.5 w-3.5 sm:block" />
            <span className="hidden sm:inline">Policy v2024.11.1 · Deterministic engine</span>
            {phase !== 'home' && (
              <Button variant="ghost" size="sm" onClick={reset} className="ml-2 h-7 gap-1.5 text-xs">
                <RotateCcw className="h-3 w-3" /> Start over
              </Button>
            )}
            <HeaderAuth />
          </div>
        </div>
      </header>

      <main className="flex-1">
        {phase === 'home' && <IntentInput />}
        {phase === 'intake' && <IntakeFlow />}
        {phase === 'computing' && <ComputingView />}
        {phase === 'results' && (
          <ErrorBoundary>
            <ResultsDashboard />
          </ErrorBoundary>
        )}
      </main>

      <footer className="mt-auto border-t border-border/60 bg-background">
        <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6">
          <div className="flex flex-col items-start justify-between gap-2 text-xs text-muted-foreground sm:flex-row sm:items-center">
            <p>
              Wayfinder distinguishes <span className="font-medium text-foreground">law</span>,{' '}
              <span className="font-medium text-foreground">fact</span>,{' '}
              <span className="font-medium text-foreground">eligibility</span>,{' '}
              <span className="font-medium text-foreground">inference</span>, and{' '}
              <span className="font-medium text-foreground">recommendation</span>. Not legal advice — verify primary sources.
            </p>
            <p className="font-mono">evidence → facts → policy → routes → optimization → explanation</p>
          </div>
        </div>
      </footer>
    </div>
  )
}
