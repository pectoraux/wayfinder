"use client"

import { useEffect, useState } from "react"
import { useSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Bell, AlertTriangle, Info, CheckCircle2, ArrowRight, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"

interface Alert {
  id: string
  title: string
  severity: string
  impactLevel: string
  whatChanged: string
  whyItMatters: string
  recommendedAction: string
  read: boolean
  createdAt: string
  alternativeRoutes: string | null
}

const SEVERITY_STYLE: Record<string, { cls: string; icon: typeof Info }> = {
  CRITICAL: { cls: "border-destructive/40 bg-destructive/5 text-destructive", icon: AlertTriangle },
  IMPORTANT: { cls: "border-amber-500/40 bg-amber-500/5 text-amber-700 dark:text-amber-400", icon: AlertTriangle },
  NOTICE: { cls: "border-blue-500/40 bg-blue-500/5 text-blue-700 dark:text-blue-400", icon: Info },
  INFO: { cls: "border-muted-foreground/40 bg-muted/5 text-muted-foreground", icon: Info },
}

export default function AlertsPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (status === "loading") return
    if (!session) { router.push("/login"); return }
    fetch("/api/alerts")
      .then((r) => r.json())
      .then((data) => setAlerts(data.alerts ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [session, status, router])

  if (status === "loading" || loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    )
  }
  if (!session) return null

  const unreadCount = alerts.filter((a) => !a.read).length

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Bell className="h-5 w-5 text-primary" />
            <h1 className="text-xl font-semibold">Policy Alerts</h1>
            {unreadCount > 0 && (
              <Badge className="bg-primary/15 text-[10px] font-medium text-primary">
                {unreadCount} unread
              </Badge>
            )}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Verified policy changes that affect your saved plans or watchlist.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => router.push("/")}>Back to app</Button>
      </div>

      {alerts.length === 0 ? (
        <Card className="border-border/60 bg-card/60 p-8 text-center">
          <CheckCircle2 className="mx-auto mb-3 h-8 w-8 text-emerald-500" />
          <p className="text-sm font-medium">No alerts yet</p>
          <p className="mt-1 text-xs text-muted-foreground">
            When a verified policy change affects your plan, you&apos;ll see it here.
            We never send alerts for unverified AI detections.
          </p>
        </Card>
      ) : (
        <ScrollArea className="wf-scroll max-h-[70vh] pr-2">
          <div className="space-y-3">
            {alerts.map((alert) => {
              const sev = SEVERITY_STYLE[alert.severity] ?? SEVERITY_STYLE.INFO
              const Icon = sev.icon
              return (
                <button
                  key={alert.id}
                  onClick={() => router.push(`/alerts/${alert.id}`)}
                  className={cn(
                    "block w-full rounded-xl border p-4 text-left transition-colors hover:border-primary/40",
                    alert.read ? "border-border/50 bg-card/40" : "border-border/60 bg-card/70",
                  )}
                >
                  <div className="flex items-start gap-3">
                    <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border", sev.cls)}>
                      <Icon className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className={cn("text-sm", !alert.read && "font-semibold")}>{alert.title}</p>
                        <span className="text-[10px] text-muted-foreground">
                          {new Date(alert.createdAt).toLocaleDateString()}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{alert.whatChanged}</p>
                      <div className="mt-2 flex items-center gap-1.5">
                        <Badge variant="outline" className={cn("text-[10px] font-normal", sev.cls)}>
                          {alert.severity}
                        </Badge>
                        <Badge variant="secondary" className="text-[10px] font-normal">
                          {alert.impactLevel.replace(/_/g, " ").toLowerCase()}
                        </Badge>
                        {!alert.read && (
                          <Badge className="bg-primary/15 text-[10px] font-medium text-primary">new</Badge>
                        )}
                      </div>
                    </div>
                    <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </div>
                </button>
              )
            })}
          </div>
        </ScrollArea>
      )}
    </div>
  )
}
