"use client"

import { useEffect, useState } from "react"
import type { Route, MobilityPlan } from "@/lib/domain/types"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { AlertTriangle, ArrowRight, RefreshCw } from "lucide-react"
import { cn } from "@/lib/utils"

interface InvalidationResult {
  valid: boolean
  reasons: string[]
  description: string
  affectedEntityIds: string[]
  effectiveFrom?: string
  alternativeRouteIds: string[]
}

/** Shows a "this route changed" signal when the route was computed under an
 *  older snapshot and a newer one invalidates it. Calls /api/route/validate. */
export function ChangeSignal({
  route,
  plan,
  latestSnapshotId,
}: {
  route: Route
  plan: MobilityPlan
  latestSnapshotId: string
}) {
  const [invalidation, setInvalidation] = useState<InvalidationResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  const originalSnapshotId = plan.policySnapshotId ?? "snap-2024-11"

  // Only check if the plan's snapshot differs from the latest
  const needsCheck = originalSnapshotId !== latestSnapshotId

  useEffect(() => {
    if (!needsCheck || dismissed) return
    let cancelled = false
    // Use a microtask to avoid the synchronous setState-in-effect lint rule
    Promise.resolve().then(() => { if (!cancelled) setLoading(true) })
    fetch("/api/route/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        route: { entryPathwayId: route.entryPathwayId, eligibility: { evidenceIds: route.evidenceIds } },
        originalSnapshotId,
        currentSnapshotId: latestSnapshotId,
      }),
    })
      .then((r) => r.json())
      .then((data) => { if (!cancelled) setInvalidation(data.invalidation) })
      .catch(() => { if (!cancelled) setInvalidation(null) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [route.entryPathwayId, originalSnapshotId, latestSnapshotId, needsCheck, dismissed])

  if (!needsCheck || dismissed) return null
  if (loading) return null
  if (!invalidation || invalidation.valid) return null

  return (
    <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-amber-700 dark:text-amber-400">
            This route changed
          </p>
          <p className="mt-0.5 text-xs text-foreground/80">{invalidation.description}</p>
          {invalidation.effectiveFrom && (
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Effective: {invalidation.effectiveFrom}
            </p>
          )}
          {invalidation.alternativeRouteIds.length > 0 && (
            <div className="mt-2">
              <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Alternative routes still valid
              </p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {invalidation.alternativeRouteIds.slice(0, 4).map((id) => (
                  <Badge key={id} variant="secondary" className="text-[10px] font-normal">
                    {id.replace("route-", "")}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </div>
        <button
          onClick={() => setDismissed(true)}
          className="shrink-0 text-[10px] text-muted-foreground hover:text-foreground"
        >
          dismiss
        </button>
      </div>
    </div>
  )
}
