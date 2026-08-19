"use client"

import { useEffect, useState, useCallback } from "react"
import { useSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { WayfinderWordmark } from "@/components/wayfinder/wayfinder-logo"
import { Loader2, Users, CheckCircle2, Clock, Mail, ArrowRight, RefreshCw, ShieldCheck } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"

interface WaitlistEntry {
  id: string
  email: string
  name: string | null
  intent: string | null
  status: "PENDING" | "APPROVED" | "REJECTED"
  createdAt: string
}

export default function AdminPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const [entries, setEntries] = useState<WaitlistEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [approving, setApproving] = useState<string | null>(null)
  const [passwords, setPasswords] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/admin/approve")
      if (res.status === 403) {
        toast.error("Admin access required.")
        router.push("/")
        return
      }
      const data = await res.json()
      setEntries(data.entries || [])
    } catch {
      toast.error("Failed to load waitlist.")
    } finally {
      setLoading(false)
    }
  }, [router])

  useEffect(() => {
    if (status === "loading") return
    if (!session) {
      router.push("/login")
      return
    }
    if ((session.user as any)?.role !== "ADMIN") {
      toast.error("Admin access required.")
      router.push("/")
      return
    }
    load()
  }, [session, status, router, load])

  const approve = async (id: string, email: string) => {
    const pw = passwords[id]
    if (!pw || pw.length < 8) {
      toast.error("Password must be at least 8 characters.")
      return
    }
    setApproving(id)
    try {
      const res = await fetch("/api/admin/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ waitlistId: id, password: pw }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || "Failed to approve.")
        return
      }
      toast.success(`Account created for ${email}.`)
      setPasswords((p) => ({ ...p, [id]: "" }))
      load()
    } catch {
      toast.error("Network error.")
    } finally {
      setApproving(null)
    }
  }

  const pending = entries.filter((e) => e.status === "PENDING")
  const approved = entries.filter((e) => e.status === "APPROVED")

  if (status === "loading" || !session) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            <h1 className="text-xl font-semibold">Admin — Waitlist</h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Review access requests and create accounts. Approved users can sign in immediately.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading} className="gap-1.5">
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          Refresh
        </Button>
      </div>

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <StatCard label="Total requests" value={entries.length} icon={Users} />
        <StatCard label="Pending" value={pending.length} icon={Clock} tone="amber" />
        <StatCard label="Approved" value={approved.length} icon={CheckCircle2} tone="emerald" />
      </div>

      <Card className="border-border/60 bg-card/60 p-4">
        <h2 className="mb-3 text-sm font-semibold">Pending requests</h2>
        {pending.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border/60 p-8 text-center text-sm text-muted-foreground">
            No pending requests. New sign-ups will appear here.
          </div>
        ) : (
          <ScrollArea className="wf-scroll max-h-[60vh] pr-2">
            <div className="space-y-3">
              {pending.map((entry) => (
                <div key={entry.id} className="rounded-lg border border-border/60 bg-background/40 p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="text-sm font-medium">{entry.email}</span>
                      </div>
                      {entry.name && <p className="mt-0.5 text-xs text-muted-foreground">{entry.name}</p>}
                      {entry.intent && (
                        <p className="mt-1 text-xs italic text-foreground/70">&ldquo;{entry.intent}&rdquo;</p>
                      )}
                      <p className="mt-1 text-[10px] text-muted-foreground">
                        {new Date(entry.createdAt).toLocaleString()}
                      </p>
                    </div>
                    <Badge variant="outline" className="text-[10px] font-normal text-amber-700 dark:text-amber-400">
                      Pending
                    </Badge>
                  </div>
                  <div className="mt-3 flex flex-wrap items-end gap-2">
                    <div className="flex-1 min-w-[180px]">
                      <Label className="mb-1 block text-[10px] font-medium text-muted-foreground">
                        Set a temporary password (min 8 chars)
                      </Label>
                      <Input
                        type="text"
                        value={passwords[entry.id] || ""}
                        onChange={(e) => setPasswords((p) => ({ ...p, [entry.id]: e.target.value }))}
                        placeholder="e.g. Welcome2024"
                        className="h-8 text-xs"
                      />
                    </div>
                    <Button
                      size="sm"
                      disabled={approving === entry.id}
                      onClick={() => approve(entry.id, entry.email)}
                      className="gap-1.5"
                    >
                      {approving === entry.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowRight className="h-3.5 w-3.5" />}
                      Approve & create account
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </Card>

      {approved.length > 0 && (
        <Card className="mt-4 border-border/60 bg-card/60 p-4">
          <h2 className="mb-3 text-sm font-semibold">Approved accounts ({approved.length})</h2>
          <div className="space-y-1.5">
            {approved.map((entry) => (
              <div key={entry.id} className="flex items-center justify-between rounded bg-background/40 px-3 py-1.5">
                <span className="text-xs">{entry.email}</span>
                <Badge variant="outline" className="text-[10px] font-normal text-emerald-700 dark:text-emerald-400">
                  <CheckCircle2 className="mr-1 h-2.5 w-2.5" /> Approved
                </Badge>
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="mt-6 flex items-center justify-between border-t border-border/60 pt-4">
        <WayfinderWordmark />
        <Button variant="ghost" size="sm" onClick={() => router.push("/")}>
          Back to app
        </Button>
      </div>
    </div>
  )
}

function StatCard({
  label,
  value,
  icon: Icon,
  tone = "primary",
}: {
  label: string
  value: number
  icon: React.ComponentType<{ className?: string }>
  tone?: "primary" | "amber" | "emerald"
}) {
  const toneCls = {
    primary: "text-primary bg-primary/10",
    amber: "text-amber-700 dark:text-amber-400 bg-amber-500/10",
    emerald: "text-emerald-700 dark:text-emerald-400 bg-emerald-500/10",
  }[tone]
  return (
    <Card className="border-border/60 bg-card/60 p-3">
      <div className="flex items-center gap-3">
        <span className={cn("flex h-9 w-9 items-center justify-center rounded-lg", toneCls)}>
          <Icon className="h-4 w-4" />
        </span>
        <div>
          <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
          <p className="text-xl font-semibold tabular-nums">{value}</p>
        </div>
      </div>
    </Card>
  )
}
