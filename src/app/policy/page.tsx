"use client"

import { useEffect, useState } from "react"
import { useSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { WayfinderWordmark } from "@/components/wayfinder/wayfinder-logo"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  ShieldCheck, GitBranch, GitCompare, ArrowRight, ExternalLink, Globe,
  AlertTriangle, TrendingUp, TrendingDown, Plus, Minus, Clock, FileText,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Loader2 } from "lucide-react"

interface SnapshotInfo {
  id: string
  version: string
  hash: string
  publishedAt: string
  effectiveFrom: string
  effectiveTo?: string
  status: string
  provenance: string
  notes: string
  programIds: string[]
  requirementIds: string[]
  transitionIds: string[]
  evidenceIds: string[]
}

interface PolicyChange {
  kind: string
  entityId: string
  entityLabel: string
  field?: string
  oldValue?: unknown
  newValue?: unknown
  effectiveFrom?: string
  evidenceIds: string[]
  summary: string
}

interface DiffResult {
  diff: { fromSnapshotId: string; toSnapshotId: string; changes: PolicyChange[]; summary: Record<string, number> }
  evidence: { id: string; title: string; publisher: string; url: string; excerpt: string }[]
}

const CHANGE_ICONS: Record<string, typeof TrendingUp> = {
  PROGRAM_ADDED: Plus,
  PROGRAM_REMOVED: Minus,
  PROGRAM_SUSPENDED: AlertTriangle,
  PROGRAM_REOPENED: ShieldCheck,
  PROGRAM_RENAMED: FileText,
  REQUIREMENT_ADDED: Plus,
  REQUIREMENT_REMOVED: Minus,
  RULE_CHANGED: AlertTriangle,
  THRESHOLD_CHANGED: TrendingUp,
  TRANSITION_ADDED: Plus,
  TRANSITION_REMOVED: Minus,
  EFFECTIVE_DATE_CHANGED: Clock,
  EVIDENCE_UPDATED: FileText,
}

export default function PolicyPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const [snapshots, setSnapshots] = useState<SnapshotInfo[]>([])
  const [selectedId, setSelectedId] = useState<string>("")
  const [selectedSnapshot, setSelectedSnapshot] = useState<any>(null)
  const [diffFrom, setDiffFrom] = useState("snap-2024-11")
  const [diffTo, setDiffTo] = useState("snap-2026-01")
  const [diffResult, setDiffResult] = useState<DiffResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [diffLoading, setDiffLoading] = useState(false)

  useEffect(() => {
    if (status === "loading") return
    if (!session) {
      router.push("/login")
      return
    }
    fetch("/api/policy/snapshot")
      .then((r) => r.json())
      .then((data) => {
        setSnapshots(data.snapshots ?? [])
        if (data.snapshots?.length > 0) {
          setSelectedId(data.snapshots[0].id)
        }
      })
      .finally(() => setLoading(false))
  }, [session, status, router])

  useEffect(() => {
    if (!selectedId) return
    let cancelled = false
    fetch(`/api/policy/snapshot?id=${selectedId}`)
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setSelectedSnapshot(d) })
    return () => { cancelled = true }
  }, [selectedId])

  useEffect(() => {
    if (!diffFrom || !diffTo) return
    let cancelled = false
    Promise.resolve().then(() => { if (!cancelled) setDiffLoading(true) })
    fetch(`/api/policy/diff?from=${diffFrom}&to=${diffTo}`)
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setDiffResult(d) })
      .finally(() => { if (!cancelled) setDiffLoading(false) })
    return () => { cancelled = true }
  }, [diffFrom, diffTo])

  if (status === "loading" || loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    )
  }

  if (!session) return null

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            <h1 className="text-xl font-semibold">Policy Intelligence</h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Versioned, evidence-backed immigration policy snapshots. Every rule traces to a source.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => router.push("/")}>
          Back to app
        </Button>
      </div>

      <Tabs defaultValue="snapshots">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="snapshots" className="text-xs gap-1.5">
            <GitBranch className="h-3.5 w-3.5" /> Snapshots
          </TabsTrigger>
          <TabsTrigger value="diff" className="text-xs gap-1.5">
            <GitCompare className="h-3.5 w-3.5" /> Diff
          </TabsTrigger>
          <TabsTrigger value="about" className="text-xs gap-1.5">
            <FileText className="h-3.5 w-3.5" /> About
          </TabsTrigger>
        </TabsList>

        {/* SNAPSHOTS TAB */}
        <TabsContent value="snapshots" className="mt-4">
          <div className="mb-4 flex items-center gap-2">
            <Select value={selectedId} onValueChange={setSelectedId}>
              <SelectTrigger className="w-72"><SelectValue /></SelectTrigger>
              <SelectContent>
                {snapshots.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.version} · {s.id} {s.status === "current" ? "(current)" : ""} {s.provenance === "SIMULATED" ? "⚠ SIMULATED" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {selectedSnapshot && (
            <div className="grid gap-4 lg:grid-cols-3">
              <Card className="border-border/60 bg-card/60 p-4 lg:col-span-1">
                <div className="mb-2 flex items-center gap-2">
                  <h3 className="text-sm font-semibold">{selectedSnapshot.snapshot.version}</h3>
                  <ProvenanceBadge provenance={selectedSnapshot.snapshot.provenance} />
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{selectedSnapshot.snapshot.notes}</p>
                <div className="mt-3 space-y-1.5 text-xs">
                  <Row label="Status" value={selectedSnapshot.snapshot.status} />
                  <Row label="Provenance" value={selectedSnapshot.snapshot.provenance} />
                  <Row label="Hash" value={selectedSnapshot.snapshot.hash} mono />
                  <Row label="Published" value={selectedSnapshot.snapshot.publishedAt} />
                  <Row label="Effective from" value={selectedSnapshot.snapshot.effectiveFrom} />
                  {selectedSnapshot.snapshot.effectiveTo && (
                    <Row label="Effective to" value={selectedSnapshot.snapshot.effectiveTo} />
                  )}
                  <Row label="Programs" value={String(selectedSnapshot.programs.length)} />
                  <Row label="Requirements" value={String(selectedSnapshot.requirements.length)} />
                  <Row label="Transitions" value={String(selectedSnapshot.transitions.length)} />
                  <Row label="Evidence records" value={String(selectedSnapshot.evidence.length)} />
                </div>
              </Card>

              <Card className="border-border/60 bg-card/60 p-4 lg:col-span-2">
                <h3 className="mb-2 text-sm font-semibold">Programs in this snapshot</h3>
                <ScrollArea className="wf-scroll max-h-[32rem] pr-2">
                  <div className="space-y-2">
                    {selectedSnapshot.programs.map((p: any) => (
                      <div key={p.id} className="rounded-lg border border-border/50 bg-background/40 p-2.5">
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-xs font-semibold">{p.name}</p>
                            <p className="text-[10px] text-muted-foreground">
                              {p.jurisdictionId} · {p.category.replace(/_/g, " ")}
                            </p>
                          </div>
                          <Badge
                            variant="outline"
                            className={cn(
                              "text-[10px] font-normal capitalize",
                              p.status === "active" && "border-emerald-500/40 text-emerald-700 dark:text-emerald-400",
                              p.status === "suspended" && "border-amber-500/40 text-amber-700 dark:text-amber-400",
                            )}
                          >
                            {p.status}
                          </Badge>
                        </div>
                        <p className="mt-1 text-[10px] text-muted-foreground">{p.tagline}</p>
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          <Badge variant="secondary" className="text-[9px] font-normal">
                            {p.requirementIds.length} reqs
                          </Badge>
                          <Badge variant="secondary" className="text-[9px] font-normal">
                            {p.transitionIds.length} transitions
                          </Badge>
                          <Badge variant="secondary" className="text-[9px] font-normal">
                            ${p.estimatedCostUSD} fees
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </Card>
            </div>
          )}
        </TabsContent>

        {/* DIFF TAB */}
        <TabsContent value="diff" className="mt-4">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <Select value={diffFrom} onValueChange={setDiffFrom}>
              <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
              <SelectContent>
                {snapshots.map((s) => <SelectItem key={s.id} value={s.id}>{s.version}</SelectItem>)}
              </SelectContent>
            </Select>
            <ArrowRight className="h-4 w-4 text-muted-foreground" />
            <Select value={diffTo} onValueChange={setDiffTo}>
              <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
              <SelectContent>
                {snapshots.map((s) => <SelectItem key={s.id} value={s.id}>{s.version}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {diffLoading && <Loader2 className="h-5 w-5 animate-spin text-primary" />}
          {diffResult && !diffLoading && (
            <div className="space-y-4">
              {/* Summary */}
              <Card className="border-border/60 bg-card/60 p-4">
                <h3 className="mb-2 text-sm font-semibold">Change summary</h3>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(diffResult.diff.summary).map(([kind, count]) => {
                    const Icon = CHANGE_ICONS[kind] ?? FileText
                    return (
                      <Badge key={kind} variant="outline" className="gap-1 text-[10px] font-normal">
                        <Icon className="h-2.5 w-2.5" />
                        {kind.replace(/_/g, " ").toLowerCase()}: {count as number}
                      </Badge>
                    )
                  })}
                  {diffResult.diff.changes.length === 0 && (
                    <p className="text-xs text-muted-foreground">No changes between these snapshots.</p>
                  )}
                </div>
              </Card>

              {/* Changes */}
              <Card className="border-border/60 bg-card/60 p-4">
                <h3 className="mb-3 text-sm font-semibold">
                  Changes ({diffResult.diff.changes.length})
                </h3>
                <ScrollArea className="wf-scroll max-h-[40rem] pr-2">
                  <div className="space-y-2">
                    {diffResult.diff.changes.map((c, i) => {
                      const Icon = CHANGE_ICONS[c.kind] ?? FileText
                      const isIncrease = c.kind === "THRESHOLD_CHANGED" &&
                        typeof (c.oldValue as any)?.amount === "number" &&
                        typeof (c.newValue as any)?.amount === "number" &&
                        (c.newValue as any).amount > (c.oldValue as any).amount
                      return (
                        <div key={i} className="rounded-lg border border-border/50 bg-background/40 p-3">
                          <div className="flex items-start gap-2">
                            <Icon className={cn(
                              "mt-0.5 h-4 w-4 shrink-0",
                              c.kind.includes("REMOVED") || c.kind.includes("SUSPENDED") ? "text-destructive" :
                              c.kind.includes("ADDED") || c.kind.includes("REOPENED") ? "text-emerald-500" :
                              isIncrease ? "text-amber-500" : "text-primary",
                            )} />
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <Badge variant="outline" className="text-[10px] font-normal">
                                  {c.kind.replace(/_/g, " ").toLowerCase()}
                                </Badge>
                                <p className="text-xs font-semibold">{c.entityLabel}</p>
                                {c.effectiveFrom && (
                                  <span className="text-[10px] text-muted-foreground">
                                    effective {c.effectiveFrom}
                                  </span>
                                )}
                              </div>
                              <p className="mt-1 text-xs text-foreground/80">{c.summary}</p>
                              {c.oldValue != null && c.newValue != null && (
                                <div className="mt-1.5 flex items-center gap-2 text-[11px]">
                                  <span className="rounded bg-muted px-1.5 py-0.5">
                                    old: {fmtVal(c.oldValue)}
                                  </span>
                                  <ArrowRight className="h-3 w-3 text-muted-foreground" />
                                  <span className="rounded bg-primary/10 px-1.5 py-0.5 text-primary">
                                    new: {fmtVal(c.newValue)}
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </ScrollArea>
              </Card>
            </div>
          )}
        </TabsContent>

        {/* ABOUT TAB */}
        <TabsContent value="about" className="mt-4">
          <Card className="border-border/60 bg-card/60 p-5">
            <h3 className="text-sm font-semibold">How Wayfinder's policy layer works</h3>
            <div className="mt-3 space-y-3 text-xs text-muted-foreground">
              <p>
                Every legally significant rule in Wayfinder is traceable to an authoritative source
                (government portal, legislation, official institution). The policy layer separates:
              </p>
              <div className="rounded-lg border border-border/50 bg-background/40 p-3 font-mono text-[11px]">
                raw evidence → normalized facts → policy rules → legal transitions → routes → optimization → explanation
              </div>
              <p>
                <span className="font-medium text-foreground">Temporal versioning:</span> Each policy
                snapshot has an effective window [effectiveFrom, effectiveTo). A route computed on
                2025-06-01 uses the v1 rules; the same route computed on 2026-06-01 uses the v2 rules.
                Historical decisions remain reproducible — they never silently recompute against today's laws.
              </p>
              <p>
                <span className="font-medium text-foreground">Evidence linkage:</span> Every published
                requirement, transition, and program cites at least one Evidence record with a URL,
                publisher, publication date, and excerpt. Nothing is invented.
              </p>
              <p>
                <span className="font-medium text-foreground">AI extraction boundaries:</span> The LLM
                may propose candidate requirements, but they enter as{" "}
                <code className="rounded bg-muted px-1">AI_EXTRACTED</code> and CANNOT become
                authoritative until a human promotes them through{" "}
                <code className="rounded bg-muted px-1">PENDING_VERIFICATION → HUMAN_REVIEWED → OFFICIAL_CONFIRMED</code>.
                This is enforced by a state machine, not by prompt instructions.
              </p>
              <p>
                <span className="font-medium text-foreground">Diff engine:</span> Given two snapshots,
                Wayfinder produces a structured diff (PROGRAM_SUSPENDED, THRESHOLD_CHANGED, etc.) with
                each change pointing to evidence. This powers route invalidation and impact analysis.
              </p>
              <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-2 text-amber-700 dark:text-amber-400">
                <AlertTriangle className="mr-1 inline h-3 w-3" />
                The <code className="rounded bg-amber-500/10 px-1">snap-2026-01</code> snapshot is a
                HYPOTHETICAL future projection for demonstrating the diff/invalidation APIs. It is NOT
                current law. Always verify against live primary sources.
              </p>
            </div>
          </Card>
        </TabsContent>
      </Tabs>

      <div className="mt-6 flex items-center justify-between border-t border-border/60 pt-4">
        <WayfinderWordmark />
        <Button variant="ghost" size="sm" onClick={() => router.push("/")}>
          Back to app
        </Button>
      </div>
    </div>
  )
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded bg-background/40 px-2 py-1">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("font-medium", mono && "font-mono text-[10px]")}>{value}</span>
    </div>
  )
}

function fmtVal(v: unknown): string {
  if (v == null) return "—"
  if (typeof v === "number") return String(v)
  if (typeof v === "string") return v
  if (typeof v === "object" && v !== null) {
    const obj = v as Record<string, unknown>
    if ("amount" in obj) return `$${obj.amount}`
    return JSON.stringify(v).slice(0, 60)
  }
  return String(v)
}

function ProvenanceBadge({ provenance }: { provenance: string }) {
  const styles: Record<string, string> = {
    AUTHORITATIVE: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    DERIVED: "border-blue-500/40 bg-blue-500/10 text-blue-700 dark:text-blue-400",
    SIMULATED: "border-orange-500/40 bg-orange-500/10 text-orange-700 dark:text-orange-400",
    TEST_FIXTURE: "border-muted-foreground/40 bg-muted/20 text-muted-foreground",
  }
  const labels: Record<string, string> = {
    AUTHORITATIVE: "✓ Official",
    DERIVED: "Derived",
    SIMULATED: "⚠ Simulated",
    TEST_FIXTURE: "Test fixture",
  }
  return (
    <Badge variant="outline" className={cn("text-[10px] font-medium", styles[provenance] ?? styles.TEST_FIXTURE)}>
      {labels[provenance] ?? provenance}
    </Badge>
  )
}
