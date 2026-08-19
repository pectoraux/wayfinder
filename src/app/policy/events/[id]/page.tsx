"use client"

// Wayfinder — Policy Event Detail
//
// A calm, evidence-backed single page for one verified policy change.
// Designed to be one of the best pages in the product: every claim traces
// to an authoritative source, every section answers one user question,
// provenance is always visible.

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { useSession } from "next-auth/react"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { WayfinderWordmark } from "@/components/wayfinder/wayfinder-logo"
import { JURISDICTIONS } from "@/lib/policy/knowledge"
import { cn } from "@/lib/utils"
import {
  ArrowLeft,
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
  ExternalLink,
  MapPin,
  Users,
  Lightbulb,
  Quote,
  Beaker,
  HelpCircle,
  Compass,
  BellRing,
} from "lucide-react"
import type { PolicyEventChangeType, PolicyProvenance } from "@/lib/policy/types"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PolicyEventDetail {
  id: string
  publicationId: string
  candidateFactId: string
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
  sourceSnapshotId?: string | null
  evidence: string
  sourceUrl: string
  provenance: PolicyProvenance
  status: string
  createdAt: string
  publishedAt?: string | null
}

interface AffectedAlert {
  id: string
  title: string
  severity: string
  impactLevel: string
  read: boolean
  policyEventId?: string | null
}

interface AlertsResponse {
  alerts: AffectedAlert[]
  unreadCount?: number
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
// Change type metadata
// ---------------------------------------------------------------------------

interface ChangeTypeMeta {
  label: string
  icon: typeof TrendingUp
  cls: string
  blurb: string
}

const CHANGE_TYPE_META: Record<PolicyEventChangeType, ChangeTypeMeta> = {
  threshold_changed: {
    label: "Threshold changed",
    icon: TrendingUp,
    cls: "border-amber-500/40 bg-amber-500/5 text-amber-700 dark:text-amber-400",
    blurb: "A numeric qualification bar changed.",
  },
  requirement_added: {
    label: "Requirement added",
    icon: Plus,
    cls: "border-emerald-500/40 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400",
    blurb: "A new condition applicants must satisfy.",
  },
  requirement_removed: {
    label: "Requirement removed",
    icon: Minus,
    cls: "border-blue-500/40 bg-blue-500/5 text-blue-700 dark:text-blue-400",
    blurb: "A previously required condition is no longer needed.",
  },
  program_opened: {
    label: "Program opened",
    icon: Plus,
    cls: "border-emerald-500/40 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400",
    blurb: "An immigration program is now accepting applications.",
  },
  program_suspended: {
    label: "Program suspended",
    icon: AlertTriangle,
    cls: "border-amber-500/40 bg-amber-500/5 text-amber-700 dark:text-amber-400",
    blurb: "New applications are likely paused.",
  },
  program_closed: {
    label: "Program closed",
    icon: XCircle,
    cls: "border-destructive/40 bg-destructive/5 text-destructive",
    blurb: "The program is no longer accepting applications.",
  },
  transition_changed: {
    label: "Transition changed",
    icon: ArrowRight,
    cls: "border-blue-500/40 bg-blue-500/5 text-blue-700 dark:text-blue-400",
    blurb: "The path between two immigration statuses changed.",
  },
  processing_time_changed: {
    label: "Processing time changed",
    icon: Clock,
    cls: "border-blue-500/40 bg-blue-500/5 text-blue-700 dark:text-blue-400",
    blurb: "Expected processing duration changed.",
  },
  fee_changed: {
    label: "Fee changed",
    icon: DollarSign,
    cls: "border-amber-500/40 bg-amber-500/5 text-amber-700 dark:text-amber-400",
    blurb: "A government application fee changed.",
  },
  other: {
    label: "Policy updated",
    icon: FileText,
    cls: "border-muted-foreground/40 bg-muted/5 text-muted-foreground",
    blurb: "A policy change was detected.",
  },
}

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
// Value formatting (oldValue / newValue come from DB as JSON strings)
// ---------------------------------------------------------------------------

function parseMaybeJson(v: unknown): unknown {
  if (typeof v !== "string") return v
  try {
    return JSON.parse(v)
  } catch {
    return v
  }
}

function formatValue(v: unknown): string {
  const parsed = parseMaybeJson(v)
  if (parsed == null) return "—"
  if (typeof parsed === "boolean") return parsed ? "Yes" : "No"
  if (typeof parsed === "number") return parsed.toLocaleString()
  if (typeof parsed === "string") return parsed
  if (typeof parsed === "object" && parsed !== null) {
    const obj = parsed as Record<string, unknown>
    if ("amount" in obj && typeof obj.amount === "number") {
      const currency = typeof obj.currency === "string" ? obj.currency + " " : ""
      const period = typeof obj.period === "string" ? ` / ${obj.period}` : ""
      return `${currency}${obj.amount.toLocaleString()}${period}`.trim()
    }
    if ("label" in obj && typeof obj.label === "string") return obj.label
    if ("value" in obj && typeof obj.value !== "object") return String(obj.value)
    try {
      return JSON.stringify(parsed, null, 2).slice(0, 240)
    } catch {
      return String(parsed)
    }
  }
  return String(parsed)
}

// ---------------------------------------------------------------------------
// Strategic impact ("Why it matters")
// ---------------------------------------------------------------------------

function buildWhyItMatters(evt: PolicyEventDetail): string {
  const oldV = parseMaybeJson(evt.oldValue)
  const newV = parseMaybeJson(evt.newValue)
  const isIncrease = typeof oldV === "number" && typeof newV === "number" && newV > oldV
  const isDecrease = typeof oldV === "number" && typeof newV === "number" && newV < oldV
  const amountDelta =
    typeof oldV === "number" && typeof newV === "number"
      ? Math.abs(newV - oldV)
      : null

  switch (evt.changeType) {
    case "threshold_changed":
      if (isIncrease) {
        return `The qualification bar for ${evt.entityLabel} rose${
          amountDelta ? ` by ${amountDelta.toLocaleString()}` : ""
        }. Applicants who would have qualified yesterday may no longer meet the criteria. If your plan depends on this route and you were close to the previous threshold, your eligibility may have shifted — re-evaluate before relying on it.`
      }
      if (isDecrease) {
        return `The qualification bar for ${evt.entityLabel} dropped${
          amountDelta ? ` by ${amountDelta.toLocaleString()}` : ""
        }. Applicants who previously missed the threshold may now be eligible. If your profile was just short of the previous requirement, this change may open the route for you.`
      }
      return `The qualification threshold for ${evt.entityLabel} changed. Eligibility may shift in either direction — review the before/after values and re-check your plan.`
    case "requirement_added":
      return `A new requirement was added to ${evt.entityLabel}. Applicants who haven't yet submitted will need to satisfy it. If your evidence already covers the new condition, you may be unaffected — but verify before proceeding.`
    case "requirement_removed":
      return `A requirement was removed from ${evt.entityLabel}. The path is now simpler, and applicants previously blocked by this condition may now qualify. If this was your blocker, the route may now be open.`
    case "program_opened":
      return `${evt.entityLabel} is now accepting applications. If your profile matches, this may be a faster or cheaper route than the alternatives in your plan. Compare it against your current best route.`
    case "program_suspended":
      return `${evt.entityLabel} is suspended — new applications are likely paused, and in-flight applications may be delayed. If your plan relied on this route, you should evaluate alternatives and avoid making irreversible commitments until it reopens.`
    case "program_closed":
      return `${evt.entityLabel} has closed. New applications cannot be submitted. If your plan relied on this route, it is no longer available — identify the closest alternative route and update your plan.`
    case "transition_changed":
      return `The path between immigration statuses under ${evt.entityLabel} changed. This may shorten or lengthen your overall timeline to permanent residence or citizenship. Recompute your plan to see the new expected duration.`
    case "processing_time_changed":
      return `Expected processing times for ${evt.entityLabel} changed. Your timeline milestones may shift — re-check any dependent deadlines (job start dates, lease end dates, school enrollment).`
    case "fee_changed":
      return `The cost of ${evt.entityLabel} changed. Update your budget and re-check whether the route still fits your financial plan.`
    default:
      return `A policy change was detected for ${evt.entityLabel}. Review the before/after values to understand how your plan may be affected, and re-run the planner to confirm your eligibility.`
  }
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

function fmtDateTime(iso?: string | null): string {
  if (!iso) return "—"
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
  } catch {
    return iso
  }
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function PolicyEventDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const router = useRouter()
  const { data: session, status: sessionStatus } = useSession()
  const [eventId, setEventId] = useState<string | null>(null)
  const [event, setEvent] = useState<PolicyEventDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [affectedAlert, setAffectedAlert] = useState<AffectedAlert | null>(null)
  const [alertChecked, setAlertChecked] = useState(false)

  // Resolve the dynamic param id
  useEffect(() => {
    params.then(({ id }) => setEventId(id))
  }, [params])

  // Fetch event when eventId changes. The synchronous setState calls are
  // deferred via microtask to avoid cascading renders within the effect.
  useEffect(() => {
    if (!eventId) return
    let cancelled = false
    Promise.resolve().then(() => {
      if (cancelled) return
      setLoading(true)
      setError(null)
      setNotFound(false)
    })
    fetch(`/api/policy/events/${encodeURIComponent(eventId)}`)
      .then(async (r) => {
        if (r.status === 404) {
          if (!cancelled) setNotFound(true)
          return null
        }
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json() as Promise<{ event: PolicyEventDetail }>
      })
      .then((data) => {
        if (cancelled) return
        if (data) setEvent(data.event)
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load event")
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [eventId])

  // Manual retry (called from the error UI, not from an effect)
  const reload = () => {
    if (!eventId) return
    setLoading(true)
    setError(null)
    setNotFound(false)
    fetch(`/api/policy/events/${encodeURIComponent(eventId)}`)
      .then(async (r) => {
        if (r.status === 404) {
          setNotFound(true)
          return null
        }
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json() as Promise<{ event: PolicyEventDetail }>
      })
      .then((data) => {
        if (data) setEvent(data.event)
      })
      .catch((e) =>
        setError(e instanceof Error ? e.message : "Failed to load event"),
      )
      .finally(() => setLoading(false))
  }

  // If authenticated, look for an alert referencing this event. Deferred
  // via microtask to avoid synchronous setState inside the effect body.
  useEffect(() => {
    let cancelled = false
    Promise.resolve().then(() => {
      if (cancelled) return
      setAffectedAlert(null)
      setAlertChecked(false)
      if (sessionStatus !== "authenticated" || !eventId) {
        setAlertChecked(true)
        return
      }
      fetch("/api/alerts")
        .then(async (r): Promise<AlertsResponse> => {
          if (!r.ok) return { alerts: [], unreadCount: 0 }
          return r.json() as Promise<AlertsResponse>
        })
        .then((data) => {
          if (cancelled) return
          const match = (data.alerts ?? []).find(
            (a) => a.policyEventId === eventId,
          )
          if (match) {
            setAffectedAlert({
              id: match.id,
              title: match.title,
              severity: match.severity,
              impactLevel: match.impactLevel,
              read: match.read,
              policyEventId: match.policyEventId ?? null,
            })
          }
        })
        .catch(() => {})
        .finally(() => {
          if (!cancelled) setAlertChecked(true)
        })
    })
    return () => {
      cancelled = true
    }
  }, [sessionStatus, eventId])

  const whyItMatters = useMemo(
    () => (event ? buildWhyItMatters(event) : ""),
    [event],
  )

  // --- loading ---
  if (loading) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <DetailHeader onBack={() => router.push("/policy/events")} />
        <div className="flex min-h-[40vh] items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      </div>
    )
  }

  // --- error ---
  if (error) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <DetailHeader onBack={() => router.push("/policy/events")} />
        <Card className="border-destructive/40 bg-destructive/5 p-6 text-center">
          <AlertTriangle className="mx-auto mb-2 h-6 w-6 text-destructive" />
          <p className="text-sm font-medium text-destructive">
            Couldn&apos;t load this event
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
        <DetailFooter onBack={() => router.push("/policy/events")} />
      </div>
    )
  }

  // --- not found ---
  if (notFound || !event) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <DetailHeader onBack={() => router.push("/policy/events")} />
        <Card className="border-border/60 bg-card/60 p-8 text-center">
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full border border-border/60 bg-background/60">
            <HelpCircle className="h-5 w-5 text-muted-foreground" />
          </div>
          <p className="text-sm font-medium">Event not found</p>
          <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
            This event may have been superseded or removed. Every published
            event is preserved with a status flag — check the policy feed for
            the latest version.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-4 h-8 gap-1.5 text-xs"
            onClick={() => router.push("/policy/events")}
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back to feed
          </Button>
        </Card>
        <DetailFooter onBack={() => router.push("/policy/events")} />
      </div>
    )
  }

  // --- loaded ---
  const ct = CHANGE_TYPE_META[event.changeType] ?? CHANGE_TYPE_META.other
  const CTIcon = ct.icon
  const prov = PROVENANCE_META[event.provenance] ?? PROVENANCE_META.TEST_FIXTURE
  const ProvIcon = prov.icon
  const jxMeta = jurisdictionMeta(event.jurisdictionId)
  const oldStr = formatValue(event.oldValue)
  const newStr = formatValue(event.newValue)
  const isSimulated = event.provenance === "SIMULATED" || event.provenance === "TEST_FIXTURE"

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <DetailHeader onBack={() => router.push("/policy/events")} />

      {/* hero card — title + badges */}
      <Card className="mb-4 border-border/60 bg-card/60 p-5 wf-panel">
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
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
          <Badge variant="secondary" className="text-[10px] font-normal">
            <span className="mr-1">{jxMeta.flag}</span>
            {jxMeta.name}
          </Badge>
        </div>

        <h1 className="text-xl font-semibold leading-tight tracking-tight">
          {event.title}
        </h1>
        <p className="mt-2 text-sm text-foreground/80">{event.summary}</p>

        {isSimulated && (
          <div className="mt-3 rounded-lg border border-orange-500/30 bg-orange-500/5 p-2.5">
            <p className="flex items-start gap-1.5 text-[11px] text-orange-700 dark:text-orange-400">
              <Beaker className="mt-0.5 h-3 w-3 shrink-0" />
              <span>
                This is a simulated event for demonstrating the policy
                intelligence pipeline. It is not real law — always verify
                against live primary sources.
              </span>
            </p>
          </div>
        )}
      </Card>

      {/* structured facts */}
      <div className="space-y-3">
        {/* where + when (compact, side-by-side on larger screens) */}
        <div className="grid gap-3 sm:grid-cols-2">
          <FactCard icon={MapPin} label="Where?">
            <p className="text-sm font-medium">
              <span className="mr-1.5 text-base">{jxMeta.flag}</span>
              {jxMeta.name}
            </p>
            <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
              {event.jurisdictionId}
            </p>
          </FactCard>

          <FactCard icon={CalendarClock} label="When?">
            <div className="space-y-1">
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Published
                </p>
                <p className="text-sm font-medium">
                  {fmtDate(event.publishedAt ?? event.createdAt)}
                </p>
              </div>
              <div className="border-t border-border/40 pt-1">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Effective from
                </p>
                <p className="text-sm font-medium">
                  {fmtDate(event.effectiveFrom)}
                </p>
              </div>
              {event.effectiveTo && (
                <div className="border-t border-border/40 pt-1">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Effective to
                  </p>
                  <p className="text-sm font-medium">
                    {fmtDate(event.effectiveTo)}
                  </p>
                </div>
              )}
            </div>
          </FactCard>
        </div>

        {/* before / after */}
        <Card className="border-border/60 bg-card/60 p-4">
          <div className="mb-3 flex items-center gap-1.5">
            <ArrowRight className="h-3.5 w-3.5 text-primary" />
            <h2 className="text-sm font-semibold">Before / After</h2>
          </div>
          <div className="grid gap-2 sm:grid-cols-[1fr_auto_1fr] sm:items-stretch">
            <div className="rounded-lg border border-border/50 bg-muted/30 p-3">
              <p className="mb-1 inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50" />
                Before
              </p>
              <p className="font-mono text-sm leading-relaxed break-words">
                {oldStr}
              </p>
            </div>
            <div className="hidden items-center justify-center sm:flex">
              <ArrowRight className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="rounded-lg border border-primary/30 bg-primary/[0.04] p-3">
              <p className="mb-1 inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-primary">
                <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                After
              </p>
              <p className="font-mono text-sm leading-relaxed break-words">
                {newStr}
              </p>
            </div>
          </div>
        </Card>

        {/* who is affected */}
        <FactCard icon={Users} label="Who is affected?">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <p className="text-sm font-semibold">{event.entityLabel}</p>
            <Badge
              variant="outline"
              className={cn("gap-1 text-[10px] font-normal", ct.cls)}
            >
              <CTIcon className="h-2.5 w-2.5" />
              {ct.label}
            </Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{ct.blurb}</p>
          <p className="mt-1.5 font-mono text-[10px] text-muted-foreground">
            entity: {event.entityType} / {event.entityId}
          </p>
        </FactCard>

        {/* why it matters */}
        <Card className="border-border/60 bg-card/60 p-4">
          <div className="mb-2 flex items-center gap-1.5">
            <Lightbulb className="h-3.5 w-3.5 text-accent" />
            <h2 className="text-sm font-semibold">Why it matters</h2>
          </div>
          <p className="text-sm leading-relaxed text-foreground/80">
            {whyItMatters}
          </p>
        </Card>

        {/* evidence */}
        <Card className="border-border/60 bg-card/60 p-4">
          <div className="mb-2 flex items-center gap-1.5">
            <Quote className="h-3.5 w-3.5 text-primary" />
            <h2 className="text-sm font-semibold">Evidence</h2>
          </div>
          {event.evidence ? (
            <blockquote className="border-l-2 border-primary/40 pl-3 text-sm italic leading-relaxed text-foreground/80">
              {event.evidence}
            </blockquote>
          ) : (
            <p className="text-xs text-muted-foreground">
              No excerpt was recorded for this event.
            </p>
          )}
          {event.sourceUrl && (
            <a
              href={event.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-border/50 bg-background/40 px-2.5 py-1.5 text-xs font-medium text-primary transition-colors hover:border-primary/40 hover:bg-primary/[0.04]"
            >
              <ExternalLink className="h-3 w-3" />
              View source
              <span className="hidden text-[10px] font-normal text-muted-foreground sm:inline">
                {(() => {
                  try {
                    return new URL(event.sourceUrl).hostname.replace(/^www\./, "")
                  } catch {
                    return event.sourceUrl.slice(0, 40)
                  }
                })()}
              </span>
            </a>
          )}
        </Card>

        {/* your plan */}
        <Card className="border-border/60 bg-card/60 p-4">
          <div className="mb-2 flex items-center gap-1.5">
            <Compass className="h-3.5 w-3.5 text-primary" />
            <h2 className="text-sm font-semibold">Your plan</h2>
          </div>

          {/* loading check */}
          {!alertChecked && (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Checking your saved plans…
            </p>
          )}

          {/* affected alert found */}
          {alertChecked && affectedAlert && (
            <div>
              <p className="text-sm text-foreground/80">
                We flagged this change against one of your saved plans.
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <Badge
                  variant="outline"
                  className="text-[10px] font-normal border-primary/40 text-primary"
                >
                  {affectedAlert.impactLevel.replace(/_/g, " ").toLowerCase()}
                </Badge>
                {!affectedAlert.read && (
                  <Badge className="bg-primary/15 text-[10px] font-medium text-primary">
                    new
                  </Badge>
                )}
              </div>
              <Button
                variant="default"
                size="sm"
                className="mt-3 h-8 gap-1.5 text-xs"
                onClick={() =>
                  router.push(`/alerts/${affectedAlert.id}`)
                }
              >
                <BellRing className="h-3.5 w-3.5" />
                View your alert
                <ArrowRight className="h-3 w-3" />
              </Button>
            </div>
          )}

          {/* authenticated but no affected alert */}
          {alertChecked && !affectedAlert && session && (
            <div>
              <p className="text-sm text-foreground/80">
                This change doesn&apos;t affect any of your saved plans —
                but you can still see how a profile like yours would route
                under the new rule.
              </p>
              <Button
                variant="outline"
                size="sm"
                className="mt-3 h-8 gap-1.5 text-xs"
                onClick={() => router.push("/")}
              >
                <Compass className="h-3.5 w-3.5" />
                See how this could affect you
                <ArrowRight className="h-3 w-3" />
              </Button>
            </div>
          )}

          {/* not authenticated */}
          {alertChecked && !affectedAlert && !session && (
            <div>
              <p className="text-sm text-foreground/80">
                Sign in and save a plan to get notified when a verified change
                like this one shifts your best route. We only alert on
                material impacts — never on noise.
              </p>
              <Button
                variant="outline"
                size="sm"
                className="mt-3 h-8 gap-1.5 text-xs"
                onClick={() => router.push("/login")}
              >
                <Compass className="h-3.5 w-3.5" />
                See how this could affect you
                <ArrowRight className="h-3 w-3" />
              </Button>
            </div>
          )}
        </Card>

        {/* provenance footer (transparency) */}
        <Card className="border-dashed border-border/50 bg-card/40 p-4">
          <div className="flex items-start gap-2">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Provenance
              </p>
              <p className="mt-0.5 text-xs text-foreground/80">
                This event was created from{" "}
                <span className="font-mono text-[11px]">
                  {event.publicationId.slice(0, 18)}
                </span>
                … — an admin-approved publication. The underlying candidate
                fact was reviewed by a human before publication.
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Badge
                  variant="outline"
                  className={cn("gap-1 text-[10px] font-normal", prov.cls)}
                >
                  <ProvIcon className="h-2.5 w-2.5" />
                  {prov.label}
                </Badge>
                <Badge variant="secondary" className="text-[10px] font-normal">
                  published {fmtDateTime(event.publishedAt ?? event.createdAt)}
                </Badge>
                {event.sourceSnapshotId && (
                  <Badge
                    variant="secondary"
                    className="text-[10px] font-normal font-mono"
                  >
                    snap: {event.sourceSnapshotId}
                  </Badge>
                )}
              </div>
            </div>
          </div>
        </Card>
      </div>

      <DetailFooter onBack={() => router.push("/policy/events")} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Header / footer
// ---------------------------------------------------------------------------

function DetailHeader({ onBack }: { onBack: () => void }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <button
        onClick={onBack}
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Back to feed
      </button>
      <WayfinderWordmark />
    </div>
  )
}

function DetailFooter({ onBack }: { onBack: () => void }) {
  return (
    <div className="mt-8 flex items-center justify-between border-t border-border/60 pt-4">
      <WayfinderWordmark />
      <Button variant="ghost" size="sm" onClick={onBack}>
        <ArrowLeft className="mr-1.5 h-3.5 w-3.5" /> Back to feed
      </Button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Fact card (small section card with icon + label)
// ---------------------------------------------------------------------------

function FactCard({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof MapPin
  label: string
  children: React.ReactNode
}) {
  return (
    <Card className="border-border/60 bg-card/60 p-4">
      <div className="mb-2 flex items-center gap-1.5">
        <Icon className="h-3.5 w-3.5 text-primary" />
        <h2 className="text-sm font-semibold">{label}</h2>
      </div>
      {children}
    </Card>
  )
}
