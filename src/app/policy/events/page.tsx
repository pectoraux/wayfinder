"use client"

// Wayfinder — Policy Event Feed
//
// A calm, evidence-backed feed of verified policy changes. Grouped by
// jurisdiction, with clear change-type and provenance signaling. Public —
// no auth required. Every event traces to a published, admin-approved
// policy publication that itself traces to an authoritative source.

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { WayfinderWordmark } from "@/components/wayfinder/wayfinder-logo"
import { JURISDICTIONS } from "@/lib/policy/knowledge"
import { cn } from "@/lib/utils"
import {
  Newspaper,
  ArrowRight,
  RefreshCw,
  Loader2,
  CalendarClock,
  ShieldCheck,
  AlertTriangle,
  TrendingUp,
  Plus,
  Minus,
  Clock,
  FileText,
  DollarSign,
  XCircle,
  Inbox,
  Globe,
  Beaker,
  HelpCircle,
} from "lucide-react"
import type { PolicyEventChangeType, PolicyProvenance } from "@/lib/policy/types"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PolicyEventRow {
  id: string
  jurisdictionId: string
  entityType: string
  entityId: string
  entityLabel: string
  changeType: PolicyEventChangeType
  title: string
  summary: string
  oldValue?: string | null
  newValue?: string | null
  effectiveFrom: string
  effectiveTo?: string | null
  evidence: string
  sourceUrl: string
  provenance: PolicyProvenance
  status: string
  createdAt: string
  publishedAt?: string | null
}

// ---------------------------------------------------------------------------
// Jurisdiction → flag emoji + display name
// ---------------------------------------------------------------------------

function flagEmoji(isoAlpha2?: string): string {
  if (!isoAlpha2 || isoAlpha2.length !== 2 || !/^[a-zA-Z]{2}$/.test(isoAlpha2)) {
    return "🌐"
  }
  const upper = isoAlpha2.toUpperCase()
  const codePoints = [...upper].map(
    (c) => 0x1f1e6 + c.charCodeAt(0) - "A".charCodeAt(0),
  )
  return String.fromCodePoint(...codePoints)
}

function jurisdictionMeta(jurisdictionId: string): { name: string; flag: string } {
  const found = JURISDICTIONS.find((j) => j.id === jurisdictionId)
  if (!found) {
    if (jurisdictionId === "EU") return { name: "European Union", flag: "🇪🇺" }
    return { name: jurisdictionId, flag: "🌐" }
  }
  if (jurisdictionId === "EU") return { name: found.name, flag: "🇪🇺" }
  return { name: found.name, flag: flagEmoji(found.isoAlpha2) }
}

// ---------------------------------------------------------------------------
// Change type → icon + label + tone
// ---------------------------------------------------------------------------

interface ChangeTypeMeta {
  label: string
  icon: typeof TrendingUp
  cls: string
}

const CHANGE_TYPE_META: Record<PolicyEventChangeType, ChangeTypeMeta> = {
  threshold_changed: {
    label: "Threshold changed",
    icon: TrendingUp,
    cls: "border-amber-500/40 bg-amber-500/5 text-amber-700 dark:text-amber-400",
  },
  requirement_added: {
    label: "Requirement added",
    icon: Plus,
    cls: "border-emerald-500/40 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400",
  },
  requirement_removed: {
    label: "Requirement removed",
    icon: Minus,
    cls: "border-blue-500/40 bg-blue-500/5 text-blue-700 dark:text-blue-400",
  },
  program_opened: {
    label: "Program opened",
    icon: Plus,
    cls: "border-emerald-500/40 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400",
  },
  program_suspended: {
    label: "Program suspended",
    icon: AlertTriangle,
    cls: "border-amber-500/40 bg-amber-500/5 text-amber-700 dark:text-amber-400",
  },
  program_closed: {
    label: "Program closed",
    icon: XCircle,
    cls: "border-destructive/40 bg-destructive/5 text-destructive",
  },
  transition_changed: {
    label: "Transition changed",
    icon: ArrowRight,
    cls: "border-blue-500/40 bg-blue-500/5 text-blue-700 dark:text-blue-400",
  },
  processing_time_changed: {
    label: "Processing time changed",
    icon: Clock,
    cls: "border-blue-500/40 bg-blue-500/5 text-blue-700 dark:text-blue-400",
  },
  fee_changed: {
    label: "Fee changed",
    icon: DollarSign,
    cls: "border-amber-500/40 bg-amber-500/5 text-amber-700 dark:text-amber-400",
  },
  other: {
    label: "Policy updated",
    icon: FileText,
    cls: "border-muted-foreground/40 bg-muted/5 text-muted-foreground",
  },
}

// ---------------------------------------------------------------------------
// Provenance → "Official" vs "Simulated" badge
// ---------------------------------------------------------------------------

interface ProvenanceMeta {
  label: string
  icon: typeof ShieldCheck
  cls: string
}

const PROVENANCE_META: Record<PolicyProvenance, ProvenanceMeta> = {
  AUTHORITATIVE: {
    label: "Official",
    icon: ShieldCheck,
    cls: "border-emerald-500/40 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400",
  },
  DERIVED: {
    label: "Derived",
    icon: FileText,
    cls: "border-blue-500/40 bg-blue-500/5 text-blue-700 dark:text-blue-400",
  },
  SIMULATED: {
    label: "Simulated",
    icon: Beaker,
    cls: "border-orange-500/40 bg-orange-500/5 text-orange-700 dark:text-orange-400",
  },
  TEST_FIXTURE: {
    label: "Test fixture",
    icon: HelpCircle,
    cls: "border-muted-foreground/40 bg-muted/5 text-muted-foreground",
  },
}

// ---------------------------------------------------------------------------
// Date formatting
// ---------------------------------------------------------------------------

function fmtDate(iso?: string | null): string {
  if (!iso) return "—"
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    })
  } catch {
    return iso
  }
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function PolicyEventsFeedPage() {
  const router = useRouter()
  const [events, setEvents] = useState<PolicyEventRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Mount-only fetch. setState calls happen in promise callbacks (not
  // synchronously in the effect body), so no cascading renders.
  useEffect(() => {
    let cancelled = false
    fetch("/api/policy/events")
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json() as Promise<{ events: PolicyEventRow[] }>
      })
      .then((data) => {
        if (!cancelled) setEvents(data.events ?? [])
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load events")
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Manual retry (called from the error UI, not from an effect)
  const reload = () => {
    setLoading(true)
    setError(null)
    fetch("/api/policy/events")
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json() as Promise<{ events: PolicyEventRow[] }>
      })
      .then((data) => setEvents(data.events ?? []))
      .catch((e) =>
        setError(e instanceof Error ? e.message : "Failed to load events"),
      )
      .finally(() => setLoading(false))
  }

  // Group by jurisdiction — preserves publishedAt desc order within group
  const grouped = useMemo(() => {
    const map = new Map<string, PolicyEventRow[]>()
    for (const evt of events) {
      const list = map.get(evt.jurisdictionId) ?? []
      list.push(evt)
      map.set(evt.jurisdictionId, list)
    }
    // Sort groups alphabetically by jurisdiction display name
    const entries = [...map.entries()].sort((a, b) => {
      const ma = jurisdictionMeta(a[0]).name
      const mb = jurisdictionMeta(b[0]).name
      return ma.localeCompare(mb)
    })
    return entries
  }, [events])

  const jurisdictionCount = grouped.length
  const officialCount = events.filter(
    (e) => e.provenance === "AUTHORITATIVE",
  ).length

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      {/* header */}
      <div className="mb-6 flex items-center justify-between gap-3">
        <WayfinderWordmark />
        <Button variant="ghost" size="sm" onClick={() => router.push("/")}>
          Back to app
        </Button>
      </div>

      {/* hero */}
      <div className="mb-6 rounded-2xl border border-border/60 bg-card/60 p-5 wf-panel">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-primary/30 bg-primary/5 text-primary">
            <Newspaper className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-semibold tracking-tight">
              Policy Event Feed
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Verified immigration policy changes — every event traces to an
              admin-approved publication, which traces to an authoritative
              source. Nothing here is invented by the LLM.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              {!loading && !error && (
                <>
                  <Badge
                    variant="secondary"
                    className="text-[10px] font-normal"
                  >
                    {events.length}{" "}
                    {events.length === 1 ? "event" : "events"}
                  </Badge>
                  <Badge
                    variant="secondary"
                    className="text-[10px] font-normal"
                  >
                    {jurisdictionCount}{" "}
                    {jurisdictionCount === 1 ? "jurisdiction" : "jurisdictions"}
                  </Badge>
                  {officialCount > 0 && (
                    <Badge
                      variant="outline"
                      className="gap-1 text-[10px] font-normal text-emerald-700 dark:text-emerald-400"
                    >
                      <ShieldCheck className="h-2.5 w-2.5" />
                      {officialCount} official
                    </Badge>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* loading */}
      {loading && (
        <div className="flex min-h-[40vh] items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      )}

      {/* error */}
      {!loading && error && (
        <Card className="border-destructive/40 bg-destructive/5 p-6 text-center">
          <AlertTriangle className="mx-auto mb-2 h-6 w-6 text-destructive" />
          <p className="text-sm font-medium text-destructive">
            Couldn&apos;t load events
          </p>
          <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
            {error}
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-4 h-8 gap-1.5 text-xs"
            onClick={reload}
          >
            <RefreshCw className="h-3.5 w-3.5" /> Try again
          </Button>
        </Card>
      )}

      {/* empty */}
      {!loading && !error && events.length === 0 && (
        <Card className="border-border/60 bg-card/60 p-8 text-center">
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full border border-border/60 bg-background/60">
            <Inbox className="h-5 w-5 text-muted-foreground" />
          </div>
          <p className="text-sm font-medium">No policy events yet</p>
          <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
            When the policy monitoring pipeline detects and verifies a change,
            it will appear here. Every event is reviewed by a human before
            publication — we never surface raw AI extractions.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-4 h-8 gap-1.5 text-xs"
            onClick={() => router.push("/policy")}
          >
            <Globe className="h-3.5 w-3.5" /> View policy explorer
          </Button>
        </Card>
      )}

      {/* grouped events */}
      {!loading && !error && events.length > 0 && (
        <div className="space-y-5">
          {grouped.map(([jurisdictionId, groupEvents]) => {
            const meta = jurisdictionMeta(jurisdictionId)
            return (
              <Card
                key={jurisdictionId}
                className="border-border/60 bg-card/60 p-4 wf-panel"
              >
                {/* jurisdiction header */}
                <div className="mb-3 flex items-center justify-between gap-2 border-b border-border/50 pb-2.5">
                  <div className="flex items-center gap-2">
                    <span className="text-lg leading-none">{meta.flag}</span>
                    <h2 className="text-sm font-semibold tracking-tight">
                      {meta.name}
                    </h2>
                    <Badge
                      variant="secondary"
                      className="text-[10px] font-normal"
                    >
                      {groupEvents.length}
                    </Badge>
                  </div>
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {jurisdictionId}
                  </span>
                </div>

                {/* event list */}
                <ul className="space-y-2">
                  {groupEvents.map((evt) => (
                    <EventRow key={evt.id} evt={evt} />
                  ))}
                </ul>
              </Card>
            )
          })}
        </div>
      )}

      {/* footer */}
      <div className="mt-8 flex items-center justify-between border-t border-border/60 pt-4">
        <WayfinderWordmark />
        <Button variant="ghost" size="sm" onClick={() => router.push("/")}>
          Back to app
        </Button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Event row
// ---------------------------------------------------------------------------

function EventRow({ evt }: { evt: PolicyEventRow }) {
  const ct = CHANGE_TYPE_META[evt.changeType] ?? CHANGE_TYPE_META.other
  const CTIcon = ct.icon
  const prov = PROVENANCE_META[evt.provenance] ?? PROVENANCE_META.TEST_FIXTURE
  const ProvIcon = prov.icon

  return (
    <li>
      <Link
        href={`/policy/events/${encodeURIComponent(evt.id)}`}
        className="group block rounded-xl border border-border/50 bg-background/40 p-3 transition-colors hover:border-primary/40 hover:bg-primary/[0.03]"
      >
        {/* top row: badges + date */}
        <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
          <Badge
            variant="outline"
            className={cn("gap-1 text-[10px] font-normal", ct.cls)}
          >
            <CTIcon className="h-2.5 w-2.5" />
            {ct.label}
          </Badge>
          <Badge
            variant="outline"
            className={cn("gap-1 text-[10px] font-normal", prov.cls)}
          >
            <ProvIcon className="h-2.5 w-2.5" />
            {prov.label}
          </Badge>
          <span className="ml-auto inline-flex items-center gap-1 text-[10px] text-muted-foreground">
            <CalendarClock className="h-2.5 w-2.5" />
            effective {fmtDate(evt.effectiveFrom)}
          </span>
        </div>

        {/* title + summary */}
        <p className="text-sm font-semibold leading-snug text-foreground/90">
          {evt.title}
        </p>
        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
          {evt.summary}
        </p>

        {/* footer */}
        <div className="mt-2 flex items-center justify-between">
          <span className="text-[10px] text-muted-foreground">
            <span className="font-mono">{evt.entityType}</span>
            <span className="mx-1 text-border/80">·</span>
            {evt.entityLabel}
          </span>
          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-primary opacity-70 transition-opacity group-hover:opacity-100">
            View details
            <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
          </span>
        </div>
      </Link>
    </li>
  )
}
