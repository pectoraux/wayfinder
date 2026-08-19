'use client'

import { useEffect, useMemo, useState } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Compass,
  Globe,
  Route as RouteIcon,
  GraduationCap,
  Star,
  X,
  Loader2,
  Inbox,
  ArrowLeft,
} from 'lucide-react'
import { WayfinderWordmark } from '@/components/wayfinder/wayfinder-logo'

interface WatchlistEntry {
  id: string
  watchType: string // 'route' | 'country' | 'program'
  watchId: string
  watchLabel: string
  createdAt: string
}

type GroupKey = 'route' | 'country' | 'program'

const GROUP_META: Record<
  GroupKey,
  { title: string; icon: typeof RouteIcon; emptyHint: string }
> = {
  route: {
    title: 'Routes',
    icon: RouteIcon,
    emptyHint: 'No watched routes yet.',
  },
  country: {
    title: 'Countries',
    icon: Globe,
    emptyHint: 'No watched countries yet.',
  },
  program: {
    title: 'Programs',
    icon: GraduationCap,
    emptyHint: 'No watched programs yet.',
  },
}

const GROUP_ORDER: GroupKey[] = ['route', 'country', 'program']

export default function WatchlistPage() {
  const { data: session, status } = useSession()
  const router = useRouter()

  const [entries, setEntries] = useState<WatchlistEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [removingId, setRemovingId] = useState<string | null>(null)

  const reload = () => {
    setLoading(true)
    setError(null)
    fetch('/api/watchlist')
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json() as Promise<{ entries: WatchlistEntry[] }>
      })
      .then((data) => setEntries(data.entries ?? []))
      .catch((e) =>
        setError(e instanceof Error ? e.message : 'Failed to load watchlist'),
      )
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    if (status === 'loading') return
    if (!session) {
      router.push('/login')
      return
    }
    reload()
  }, [session, status, router])

  const grouped = useMemo(() => {
    const map: Record<GroupKey, WatchlistEntry[]> = {
      route: [],
      country: [],
      program: [],
    }
    for (const e of entries) {
      const key = (e.watchType as GroupKey) ?? 'route'
      if (key in map) map[key].push(e)
      else map.route.push(e)
    }
    return map
  }, [entries])

  const totalCount = entries.length

  const handleUnwatch = async (entry: WatchlistEntry) => {
    setRemovingId(entry.id)
    try {
      const url = new URL('/api/watchlist', window.location.origin)
      url.searchParams.set('id', entry.id)
      const res = await fetch(url.toString(), { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to unwatch')
      setEntries((prev) => prev.filter((e) => e.id !== entry.id))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to unwatch')
    } finally {
      setRemovingId(null)
    }
  }

  // --- render: loading ---
  if (status === 'loading' || loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    )
  }
  if (!session) return null

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      {/* header */}
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Compass className="h-5 w-5 text-primary" />
            <h1 className="text-xl font-semibold">Your Watchlist</h1>
            {totalCount > 0 && (
              <Badge className="bg-primary/15 text-[10px] font-medium text-primary">
                {totalCount} {totalCount === 1 ? 'item' : 'items'}
              </Badge>
            )}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Routes, countries, and programs you follow. We alert you when a
            verified policy change affects any of them.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => router.push('/')}>
          Back to app
        </Button>
      </div>

      {/* error banner */}
      {error && (
        <Card className="mb-4 border-destructive/40 bg-destructive/5 p-3">
          <p className="text-xs text-destructive">{error}</p>
        </Card>
      )}

      {/* empty state */}
      {!error && totalCount === 0 && (
        <Card className="border-border/60 bg-card/60 p-8 text-center">
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full border border-border/60 bg-background/60">
            <Inbox className="h-5 w-5 text-muted-foreground" />
          </div>
          <p className="text-sm font-medium">Your watchlist is empty</p>
          <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
            Open a route from the planner and tap{' '}
            <span className="font-medium text-foreground/80">
              ☆ Watch this route
            </span>{' '}
            to be notified when a verified policy change affects it. You can
            also follow specific countries and programs.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-4 h-8 gap-1.5 text-xs"
            onClick={() => router.push('/')}
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Explore routes
          </Button>
        </Card>
      )}

      {/* groups */}
      {!error && totalCount > 0 && (
        <div className="space-y-4">
          {GROUP_ORDER.map((key) => {
            const items = grouped[key]
            if (items.length === 0) return null
            const meta = GROUP_META[key]
            const Icon = meta.icon
            return (
              <Card
                key={key}
                className="border-border/60 bg-card/60 p-4 wf-panel"
              >
                <div className="mb-2.5 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <Icon className="h-3.5 w-3.5 text-primary" />
                    <h2 className="text-sm font-semibold">{meta.title}</h2>
                    <Badge
                      variant="secondary"
                      className="text-[10px] font-normal"
                    >
                      {items.length}
                    </Badge>
                  </div>
                </div>

                <ScrollArea className="wf-scroll max-h-[28rem] pr-1">
                  <ul className="space-y-1.5">
                    {items.map((entry) => (
                      <li
                        key={entry.id}
                        className="flex items-center justify-between gap-3 rounded-lg border border-border/50 bg-background/40 px-3 py-2"
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          <Star className="h-3 w-3 shrink-0 fill-accent text-accent" />
                          <div className="min-w-0">
                            <p className="truncate text-xs font-medium text-foreground/90">
                              {entry.watchLabel}
                            </p>
                            <p className="text-[10px] text-muted-foreground">
                              Added{' '}
                              {new Date(entry.createdAt).toLocaleDateString(
                                undefined,
                                {
                                  year: 'numeric',
                                  month: 'short',
                                  day: 'numeric',
                                },
                              )}{' '}
                              · <span className="font-mono">{entry.watchId}</span>
                            </p>
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleUnwatch(entry)}
                          disabled={removingId === entry.id}
                          className="h-7 shrink-0 gap-1 px-2 text-[11px] text-muted-foreground hover:text-destructive"
                          title="Unwatch"
                        >
                          {removingId === entry.id ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <X className="h-3 w-3" />
                          )}
                          Unwatch
                        </Button>
                      </li>
                    ))}
                  </ul>
                </ScrollArea>
              </Card>
            )
          })}

          {/* groups that are empty (informational, calm) */}
          {GROUP_ORDER.filter((k) => grouped[k].length === 0).length > 0 && (
            <Card className="border-dashed border-border/50 bg-card/40 p-4">
              <p className="text-[11px] text-muted-foreground">
                You can also watch{' '}
                {GROUP_ORDER.filter((k) => grouped[k].length === 0)
                  .map((k) => GROUP_META[k].title.toLowerCase())
                  .join(', ')}{' '}
                from their respective detail pages.
              </p>
            </Card>
          )}
        </div>
      )}

      {/* footer */}
      <div className="mt-8 flex items-center justify-between border-t border-border/60 pt-4">
        <WayfinderWordmark />
        <Button variant="ghost" size="sm" onClick={() => router.push('/')}>
          Back to app
        </Button>
      </div>
    </div>
  )
}
