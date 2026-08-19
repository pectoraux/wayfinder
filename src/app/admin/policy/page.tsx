"use client"

import { useEffect, useState, useCallback } from "react"
import { useSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  ShieldCheck, FileSearch, CheckCircle2, XCircle, AlertTriangle,
  Globe, RefreshCw, Loader2, ExternalLink, Scale,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { toast } from "sonner"

interface DashboardData {
  sources: { registered: number; inDb: number; active: number }
  candidates: { total: number; pendingReview: number; approved: number; rejected: number }
  publications: { total: number }
  recentSnapshots: {
    id: string; sourceId: string; sourceName: string; sourceUrl: string;
    retrievedAt: string; changeType: string | null; contentHash: string;
  }[]
  changedCount: number
  fetchFailureCount: number
  auditRecords: number
}

interface Candidate {
  id: string
  jurisdictionId: string
  entityLabel: string
  changeKind: string
  field: string | null
  oldValue: string | null
  newValue: string | null
  effectiveFrom: string | null
  evidence: string
  sourceUrl: string
  confidence: number
  extractionStatus: string
  aiInterpretation: string | null
  createdAt: string
  reviewedBy: string | null
  reviewNote: string | null
  sourceSnapshot?: { retrievedAt: string }
}

const CHANGE_TYPE_COLORS: Record<string, string> = {
  UNCHANGED: "border-muted-foreground/40 text-muted-foreground",
  TEXT_CHANGED: "border-blue-500/40 text-blue-700 dark:text-blue-400",
  STRUCTURAL_CHANGED: "border-blue-500/40 text-blue-700 dark:text-blue-400",
  POSSIBLE_POLICY_CHANGE: "border-amber-500/40 text-amber-700 dark:text-amber-400",
  LIKELY_POLICY_CHANGE: "border-orange-500/40 text-orange-700 dark:text-orange-400",
  VERIFIED_POLICY_CHANGE: "border-emerald-500/40 text-emerald-700 dark:text-emerald-400",
  FETCH_ERROR: "border-destructive/40 text-destructive",
}

const STATUS_COLORS: Record<string, string> = {
  AI_EXTRACTED: "border-orange-500/40 text-orange-700 dark:text-orange-400",
  PENDING_REVIEW: "border-amber-500/40 text-amber-700 dark:text-amber-400",
  APPROVED: "border-emerald-500/40 text-emerald-700 dark:text-emerald-400",
  REJECTED: "border-destructive/40 text-destructive",
  NEEDS_MORE_EVIDENCE: "border-blue-500/40 text-blue-700 dark:text-blue-400",
  DUPLICATE: "border-muted-foreground/40 text-muted-foreground",
  SUPERSEDED: "border-muted-foreground/40 text-muted-foreground",
}

const COUNTRY_FLAGS: Record<string, string> = {
  DE: "🇩🇪", PT: "🇵🇹", CA: "🇨🇦", EE: "🇪🇪", UK: "🇬🇧", AE: "🇦🇪", KE: "🇰🇪",
}

export default function AdminPolicyPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const [dashboard, setDashboard] = useState<DashboardData | null>(null)
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [selectedCandidate, setSelectedCandidate] = useState<Candidate | null>(null)
  const [loading, setLoading] = useState(true)
  const [monitoring, setMonitoring] = useState(false)
  const [reviewing, setReviewing] = useState<string | null>(null)

  const loadDashboard = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/policy/dashboard")
      if (res.status === 403) { router.push("/"); return }
      const data = await res.json()
      setDashboard(data)
    } catch { toast.error("Failed to load dashboard") }
  }, [router])

  const loadCandidates = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/policy/candidates")
      if (res.ok) {
        const data = await res.json()
        setCandidates(data.candidates ?? [])
      }
    } catch { toast.error("Failed to load candidates") }
  }, [])

  useEffect(() => {
    if (status === "loading") return
    if (!session) { router.push("/login"); return }
    if ((session.user as any)?.role !== "ADMIN") { router.push("/"); return }
    Promise.all([loadDashboard(), loadCandidates()]).finally(() => setLoading(false))
  }, [session, status, router, loadDashboard, loadCandidates])

  const runMonitoring = async () => {
    setMonitoring(true)
    try {
      const res = await fetch("/api/admin/policy/monitor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ extractCandidates: true }),
      })
      const data = await res.json()
      if (res.ok) {
        toast.success(`Monitored ${data.monitored} sources. ${data.changed} changed, ${data.candidatesExtracted} candidates extracted.`)
        loadDashboard()
        loadCandidates()
      } else {
        toast.error(data.error || "Monitoring failed")
      }
    } catch {
      toast.error("Monitoring request failed")
    } finally {
      setMonitoring(false)
    }
  }

  const reviewCandidate = async (id: string, action: "APPROVE" | "REJECT" | "REQUEST_MORE_EVIDENCE" | "MARK_DUPLICATE") => {
    setReviewing(id)
    try {
      const reason = action === "APPROVE" ? "Approved via admin console" : action === "REJECT" ? "Rejected: insufficient evidence" : ""
      const res = await fetch(`/api/admin/policy/candidates/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, reason }),
      })
      const data = await res.json()
      if (res.ok) {
        if (action === "APPROVE" && data.publication) {
          toast.success(`Approved & published: ${data.publication.policyVersionId}`)
        } else if (data.error) {
          toast.error(`${data.error}: ${data.details ?? ""}`)
        } else {
          toast.success(`${action} successful`)
        }
        loadCandidates()
        loadDashboard()
        setSelectedCandidate(null)
      } else {
        toast.error(data.error || "Review failed")
      }
    } catch {
      toast.error("Review request failed")
    } finally {
      setReviewing(null)
    }
  }

  if (status === "loading" || loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    )
  }
  if (!session || (session.user as any)?.role !== "ADMIN") return null

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            <h1 className="text-xl font-semibold">Policy Intelligence Console</h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Monitor authoritative sources, review AI-extracted candidate changes, and publish verified policy versions.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => router.push("/admin")} className="gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5" /> Waitlist
          </Button>
          <Button size="sm" onClick={runMonitoring} disabled={monitoring} className="gap-1.5">
            {monitoring ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Run monitoring
          </Button>
        </div>
      </div>

      {dashboard && (
        <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Sources monitored" value={dashboard.sources.active} sub={`${dashboard.sources.registered} registered`} icon={Globe} />
          <StatCard label="Pending reviews" value={dashboard.candidates.pendingReview} sub={`${dashboard.candidates.total} total candidates`} icon={FileSearch} tone="amber" />
          <StatCard label="Verified changes" value={dashboard.candidates.approved} sub={`${dashboard.publications.total} published`} icon={CheckCircle2} tone="emerald" />
          <StatCard label="Fetch failures" value={dashboard.fetchFailureCount} sub={`${dashboard.changedCount} changed sources`} icon={AlertTriangle} tone={dashboard.fetchFailureCount > 0 ? "destructive" : "primary"} />
        </div>
      )}

      <Tabs defaultValue="queue">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="queue" className="text-xs gap-1.5"><FileSearch className="h-3.5 w-3.5" /> Review Queue</TabsTrigger>
          <TabsTrigger value="sources" className="text-xs gap-1.5"><Globe className="h-3.5 w-3.5" /> Sources</TabsTrigger>
          <TabsTrigger value="audit" className="text-xs gap-1.5"><Scale className="h-3.5 w-3.5" /> Audit Log</TabsTrigger>
        </TabsList>

        <TabsContent value="queue" className="mt-4">
          {selectedCandidate ? (
            <CandidateDetail
              candidate={selectedCandidate}
              onBack={() => setSelectedCandidate(null)}
              onReview={reviewCandidate}
              reviewing={reviewing === selectedCandidate.id}
            />
          ) : (
            <Card className="border-border/60 bg-card/60 p-4">
              <h2 className="mb-3 text-sm font-semibold">Candidate policy changes ({candidates.length})</h2>
              {candidates.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border/60 p-8 text-center text-sm text-muted-foreground">
                  <FileSearch className="mx-auto mb-2 h-5 w-5 opacity-50" />
                  No candidates yet. Run monitoring to fetch sources and extract candidate changes.
                </div>
              ) : (
                <ScrollArea className="wf-scroll max-h-[50vh] pr-2">
                  <div className="space-y-2">
                    {candidates.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => setSelectedCandidate(c)}
                        className="w-full rounded-lg border border-border/60 bg-background/40 p-3 text-left transition-colors hover:border-primary/40 hover:bg-card"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="text-lg">{COUNTRY_FLAGS[c.jurisdictionId] ?? "🏳️"}</span>
                              <p className="text-sm font-semibold">{c.entityLabel}</p>
                            </div>
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              {c.changeKind.replace(/_/g, " ")} · {c.jurisdictionId}
                            </p>
                            {c.aiInterpretation && (
                              <p className="mt-1 text-xs italic text-foreground/70 line-clamp-2">{c.aiInterpretation}</p>
                            )}
                          </div>
                          <div className="flex shrink-0 flex-col items-end gap-1">
                            <Badge variant="outline" className={cn("text-[10px] font-normal", STATUS_COLORS[c.extractionStatus])}>
                              {c.extractionStatus.replace(/_/g, " ").toLowerCase()}
                            </Badge>
                            {c.confidence > 0 && (
                              <span className="text-[10px] text-muted-foreground">
                                AI confidence: {Math.round(c.confidence * 100)}%
                              </span>
                            )}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </Card>
          )}
        </TabsContent>

        <TabsContent value="sources" className="mt-4">
          <Card className="border-border/60 bg-card/60 p-4">
            <h2 className="mb-3 text-sm font-semibold">Monitored sources ({dashboard?.sources.registered ?? 0})</h2>
            <ScrollArea className="wf-scroll max-h-[50vh] pr-2">
              <div className="space-y-2">
                {dashboard?.recentSnapshots.map((snap) => (
                  <div key={snap.id} className="rounded-lg border border-border/50 bg-background/40 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold">{snap.sourceName}</p>
                        <a href={snap.sourceUrl} target="_blank" rel="noopener noreferrer" className="mt-0.5 inline-flex items-center gap-1 text-[10px] text-primary hover:underline">
                          {new URL(snap.sourceUrl).hostname.replace("www.", "")}
                          <ExternalLink className="h-2 w-2" />
                        </a>
                        <p className="mt-0.5 text-[10px] text-muted-foreground">
                          {new Date(snap.retrievedAt).toLocaleString()}
                        </p>
                      </div>
                      <Badge variant="outline" className={cn("text-[10px] font-normal", CHANGE_TYPE_COLORS[snap.changeType ?? "UNCHANGED"])}>
                        {snap.changeType?.replace(/_/g, " ").toLowerCase() ?? "unknown"}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </Card>
        </TabsContent>

        <TabsContent value="audit" className="mt-4">
          <Card className="border-border/60 bg-card/60 p-4">
            <h2 className="mb-3 text-sm font-semibold">Admin audit log ({dashboard?.auditRecords ?? 0} records)</h2>
            <p className="text-xs text-muted-foreground">
              Every admin action is logged: candidate approvals, rejections, publications, and source trust changes.
              The audit trail is immutable.
            </p>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}

function StatCard({ label, value, sub, icon: Icon, tone = "primary" }: {
  label: string; value: number; sub: string; icon: typeof Globe;
  tone?: "primary" | "amber" | "emerald" | "destructive";
}) {
  const toneCls = {
    primary: "text-primary bg-primary/10",
    amber: "text-amber-700 dark:text-amber-400 bg-amber-500/10",
    emerald: "text-emerald-700 dark:text-emerald-400 bg-emerald-500/10",
    destructive: "text-destructive bg-destructive/10",
  }[tone]
  return (
    <Card className="border-border/60 bg-card/60 p-3">
      <div className="flex items-center gap-3">
        <span className={cn("flex h-9 w-9 items-center justify-center rounded-lg", toneCls)}>
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
          <p className="text-xl font-semibold tabular-nums">{value}</p>
          <p className="text-[10px] text-muted-foreground truncate">{sub}</p>
        </div>
      </div>
    </Card>
  )
}

function CandidateDetail({ candidate, onBack, onReview, reviewing }: {
  candidate: Candidate
  onBack: () => void
  onReview: (id: string, action: "APPROVE" | "REJECT" | "REQUEST_MORE_EVIDENCE" | "MARK_DUPLICATE") => void
  reviewing: boolean
}) {
  return (
    <Card className="border-border/60 bg-card/60 p-5">
      <button onClick={onBack} className="mb-3 text-xs text-muted-foreground hover:text-foreground">
        ← Back to queue
      </button>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-2xl">{COUNTRY_FLAGS[candidate.jurisdictionId] ?? "🏳️"}</span>
            <h2 className="text-base font-semibold">{candidate.entityLabel}</h2>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {candidate.changeKind.replace(/_/g, " ")} · {candidate.jurisdictionId}
          </p>
        </div>
        <Badge variant="outline" className={cn("text-[10px] font-normal", STATUS_COLORS[candidate.extractionStatus])}>
          {candidate.extractionStatus.replace(/_/g, " ").toLowerCase()}
        </Badge>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <h3 className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Source</h3>
          <a href={candidate.sourceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
            <Globe className="h-3 w-3" />
            {new URL(candidate.sourceUrl).hostname.replace("www.", "")}
            <ExternalLink className="h-2.5 w-2.5" />
          </a>
          {candidate.sourceSnapshot && (
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              Retrieved: {new Date(candidate.sourceSnapshot.retrievedAt).toLocaleString()}
            </p>
          )}
        </div>

        {candidate.effectiveFrom && (
          <div>
            <h3 className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Effective date</h3>
            <p className="text-xs font-medium">{candidate.effectiveFrom}</p>
          </div>
        )}

        <div className="sm:col-span-2">
          <h3 className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Change</h3>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg border border-border/50 bg-muted/30 p-2">
              <p className="text-[10px] text-muted-foreground">Before</p>
              <p className="text-sm font-mono">{candidate.oldValue ?? "—"}</p>
            </div>
            <div className="rounded-lg border border-primary/30 bg-primary/5 p-2">
              <p className="text-[10px] text-muted-foreground">After</p>
              <p className="text-sm font-mono">{candidate.newValue ?? "—"}</p>
            </div>
          </div>
        </div>

        <div className="sm:col-span-2">
          <h3 className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Evidence excerpt</h3>
          <blockquote className="rounded-lg border-l-2 border-primary/30 bg-background/40 p-2 text-xs italic text-foreground/80">
            {candidate.evidence}
          </blockquote>
        </div>

        {candidate.aiInterpretation && (
          <div className="sm:col-span-2">
            <h3 className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              AI interpretation <span className="text-orange-600">(model confidence: {Math.round(candidate.confidence * 100)}% — NOT legal certainty)</span>
            </h3>
            <p className="rounded-lg bg-orange-500/5 p-2 text-xs text-foreground/80">{candidate.aiInterpretation}</p>
          </div>
        )}

        <div className="sm:col-span-2">
          <h3 className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Proposed structured rule</h3>
          <pre className="overflow-auto rounded-lg bg-muted/40 p-2 text-[11px] font-mono">
{JSON.stringify({
  field: candidate.field,
  oldValue: candidate.oldValue,
  newValue: candidate.newValue,
  effectiveFrom: candidate.effectiveFrom,
}, null, 2)}
          </pre>
        </div>
      </div>

      {candidate.extractionStatus !== "APPROVED" && candidate.extractionStatus !== "REJECTED" && (
        <div className="mt-4 flex flex-wrap gap-2 border-t border-border/50 pt-4">
          <Button size="sm" disabled={reviewing} onClick={() => onReview(candidate.id, "APPROVE")} className="gap-1.5">
            {reviewing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
            Approve & publish
          </Button>
          <Button size="sm" variant="outline" disabled={reviewing} onClick={() => onReview(candidate.id, "REJECT")} className="gap-1.5">
            <XCircle className="h-3.5 w-3.5" /> Reject
          </Button>
          <Button size="sm" variant="outline" disabled={reviewing} onClick={() => onReview(candidate.id, "REQUEST_MORE_EVIDENCE")} className="gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5" /> Request more evidence
          </Button>
          <Button size="sm" variant="ghost" disabled={reviewing} onClick={() => onReview(candidate.id, "MARK_DUPLICATE")} className="gap-1.5">
            Mark duplicate
          </Button>
        </div>
      )}
      {candidate.extractionStatus === "APPROVED" && (
        <div className="mt-4 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-2 text-xs text-emerald-700 dark:text-emerald-400">
          <CheckCircle2 className="mr-1 inline h-3.5 w-3.5" />
          Approved by {candidate.reviewedBy} — a new policy version has been published.
        </div>
      )}
    </Card>
  )
}
