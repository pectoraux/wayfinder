"use client"

import { useEffect, useState } from "react"
import { useSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ArrowLeft, AlertTriangle, Info, CheckCircle2, ExternalLink, Globe, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"

interface AlertDetail {
  id: string
  title: string
  severity: string
  impactLevel: string
  whatChanged: string
  whyItMatters: string
  recommendedAction: string
  alternativeRoutes: string | null
  read: boolean
  createdAt: string
  policyPublicationId: string | null
  policyChangeId: string
}

const SEVERITY_STYLE: Record<string, { cls: string; icon: typeof Info; label: string }> = {
  CRITICAL: { cls: "border-destructive/40 bg-destructive/5 text-destructive", icon: AlertTriangle, label: "Critical" },
  IMPORTANT: { cls: "border-amber-500/40 bg-amber-500/5 text-amber-700 dark:text-amber-400", icon: AlertTriangle, label: "Important" },
  NOTICE: { cls: "border-blue-500/40 bg-blue-500/5 text-blue-700 dark:text-blue-400", icon: Info, label: "Notice" },
  INFO: { cls: "border-muted-foreground/40 bg-muted/5 text-muted-foreground", icon: Info, label: "Info" },
}

export default function AlertDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { data: session, status } = useSession()
  const router = useRouter()
  const [alert, setAlert] = useState<AlertDetail | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (status === "loading") return
    if (!session) { router.push("/login"); return }
    params.then(({ id }) =>
      fetch(`/api/alerts/${id}`)
        .then((r) => r.json())
        .then((data) => setAlert(data.alert ?? null))
        .catch(() => {})
        .finally(() => setLoading(false)),
    )
  }, [session, status, router, params])

  if (status === "loading" || loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    )
  }
  if (!alert) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-12 text-center">
        <p className="text-sm text-muted-foreground">Alert not found.</p>
        <Button variant="ghost" size="sm" className="mt-4" onClick={() => router.push("/alerts")}>Back to alerts</Button>
      </div>
    )
  }

  const sev = SEVERITY_STYLE[alert.severity] ?? SEVERITY_STYLE.INFO
  const Icon = sev.icon
  const alternatives: string[] = alert.alternativeRoutes ? JSON.parse(alert.alternativeRoutes) : []

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
      <button onClick={() => router.push("/alerts")} className="mb-4 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to alerts
      </button>

      <Card className="border-border/60 bg-card/70 p-5">
        <div className="mb-4 flex items-start gap-3">
          <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border", sev.cls)}>
            <Icon className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-semibold">{alert.title}</h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <Badge variant="outline" className={cn("text-[10px] font-normal", sev.cls)}>{sev.label}</Badge>
              <Badge variant="secondary" className="text-[10px] font-normal">
                {alert.impactLevel.replace(/_/g, " ").toLowerCase()}
              </Badge>
              <span className="text-[10px] text-muted-foreground">
                {new Date(alert.createdAt).toLocaleString()}
              </span>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <Section title="What changed">
            <p className="text-sm text-foreground/80">{alert.whatChanged}</p>
          </Section>

          <Section title="Why it matters">
            <p className="text-sm text-foreground/80">{alert.whyItMatters}</p>
          </Section>

          {alternatives.length > 0 && (
            <Section title="Alternative routes">
              <div className="flex flex-wrap gap-1.5">
                {alternatives.map((r, i) => (
                  <Badge key={i} variant="secondary" className="text-[10px] font-normal">{r}</Badge>
                ))}
              </div>
            </Section>
          )}

          <Section title="Recommended action">
            <p className="text-sm text-foreground/80">{alert.recommendedAction}</p>
          </Section>

          {alert.policyPublicationId && (
            <Section title="Evidence trail">
              <p className="text-xs text-muted-foreground">
                This alert was generated from a verified policy publication.
                The change was approved by an admin and traces to an authoritative source.
              </p>
              <div className="mt-2 flex items-center gap-2">
                <Badge variant="outline" className="text-[10px] font-normal font-mono">
                  {alert.policyPublicationId.slice(0, 16)}…
                </Badge>
                <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs" onClick={() => router.push("/policy")}>
                  <Globe className="h-3 w-3" /> View policy
                  <ExternalLink className="h-2.5 w-2.5" />
                </Button>
              </div>
            </Section>
          )}
        </div>

        <div className="mt-5 flex gap-2 border-t border-border/50 pt-4">
          <Button size="sm" variant="outline" onClick={() => router.push("/")}>
            Review my plan
          </Button>
          <Button size="sm" variant="ghost" onClick={async () => {
            await fetch(`/api/alerts/${alert.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "dismiss" }) })
            router.push("/alerts")
          }}>
            Dismiss
          </Button>
        </div>
      </Card>

      <p className="mt-4 text-center text-[11px] text-muted-foreground">
        This alert was produced from a verified policy change. The LLM did not invent the substance —
        it only phrased the explanation. Every claim traces to an authoritative source.
      </p>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{title}</h3>
      {children}
    </div>
  )
}
