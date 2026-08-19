'use client'

import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Star, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

interface WatchlistEntry {
  id: string
  watchType: string
  watchId: string
  watchLabel: string
  createdAt: string
}

interface WatchlistButtonProps {
  routeId: string
  routeLabel: string
  /** Optional className override for layout integration. */
  className?: string
}

/**
 * Compact watch / unwatch toggle that appears on route detail.
 * - Reads the user's watchlist on mount to determine the watched state.
 * - POST /api/watchlist to watch, DELETE /api/watchlist?watchType=route&watchId=... to unwatch.
 * - If no session: clicking redirects to /login.
 */
export function WatchlistButton({ routeId, routeLabel, className }: WatchlistButtonProps) {
  const { data: session, status } = useSession()
  const router = useRouter()

  const [watching, setWatching] = useState(false)
  const [checking, setChecking] = useState(true)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Determine initial watched state from the user's existing watchlist.
  useEffect(() => {
    if (status === 'loading') return
    if (!session?.user) {
      setChecking(false)
      return
    }
    let cancelled = false
    fetch('/api/watchlist')
      .then((r) => (r.ok ? r.json() : { entries: [] as WatchlistEntry[] }))
      .then((data) => {
        if (cancelled) return
        const entries: WatchlistEntry[] = data.entries ?? []
        const isWatched = entries.some(
          (e) => e.watchType === 'route' && e.watchId === routeId,
        )
        setWatching(isWatched)
      })
      .catch(() => {
        // Soft-fail: default to "not watching" — the user can still click to watch.
      })
      .finally(() => {
        if (!cancelled) setChecking(false)
      })
    return () => {
      cancelled = true
    }
  }, [session, status, routeId])

  const handleClick = async () => {
    setError(null)

    // Not authenticated — route the user to sign in first.
    if (!session?.user) {
      router.push('/login')
      return
    }

    setPending(true)
    try {
      if (watching) {
        const res = await fetch(
          `/api/watchlist?watchType=route&watchId=${encodeURIComponent(routeId)}`,
          { method: 'DELETE' },
        )
        if (!res.ok) throw new Error('Failed to unwatch')
        setWatching(false)
      } else {
        const res = await fetch('/api/watchlist', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            watchType: 'route',
            watchId: routeId,
            watchLabel: routeLabel,
          }),
        })
        if (!res.ok) throw new Error('Failed to watch')
        setWatching(true)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong')
    } finally {
      setPending(false)
    }
  }

  const isBusy = checking || pending

  return (
    <Button
      type="button"
      size="sm"
      variant={watching ? 'secondary' : 'outline'}
      onClick={handleClick}
      disabled={isBusy}
      title={
        !session?.user
          ? 'Sign in to watch this route'
          : watching
            ? 'Stop watching this route'
            : 'Watch this route for policy alerts'
      }
      className={cn('h-7 gap-1.5 text-xs', className)}
    >
      {isBusy ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : (
        <Star
          className={cn(
            'h-3 w-3',
            watching
              ? 'fill-accent text-accent'
              : 'fill-none text-muted-foreground',
          )}
        />
      )}
      {watching ? (
        <span className="text-foreground/80">✓ Watching</span>
      ) : (
        <span>☆ Watch this route</span>
      )}
      {error && <span className="sr-only">{error}</span>}
    </Button>
  )
}
