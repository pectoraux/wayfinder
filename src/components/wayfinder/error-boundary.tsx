'use client'

import React from 'react'

interface State {
  error: Error | null
}

/** Surfaces render errors in-page (and in the console) instead of the opaque
 *  Next.js overlay, so failures are debuggable. */
export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  constructor(props: { children: React.ReactNode }) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  reset = () => this.setState({ error: null })

  render() {
    if (this.state.error) {
      return (
        <div className="mx-auto max-w-3xl px-4 py-10">
          <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-5">
            <h2 className="text-base font-semibold text-destructive">Something went wrong rendering this view</h2>
            <pre className="mt-3 max-h-64 overflow-auto rounded bg-background/60 p-3 text-xs leading-relaxed text-foreground/80">
              {this.state.error.message}
              {'\n\n'}
              {this.state.error.stack}
            </pre>
            <button
              onClick={this.reset}
              className="mt-3 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium hover:bg-muted"
            >
              Try again
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
