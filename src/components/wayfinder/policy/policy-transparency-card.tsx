"use client"

import type { Evidence } from "@/lib/domain/types"
import type { NormalizedRequirement } from "@/lib/policy/types"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { ExternalLink, ShieldCheck, FileText, Globe, Calendar, GitBranch, AlertTriangle, Clock } from "lucide-react"
import { cn } from "@/lib/utils"
import { useState } from "react"

const VERIFICATION_STYLE: Record<string, { cls: string; icon: typeof ShieldCheck; label: string }> = {
  OFFICIAL_CONFIRMED: { cls: "border-emerald-500/40 text-emerald-700 dark:text-emerald-400", icon: ShieldCheck, label: "Officially confirmed" },
  HUMAN_REVIEWED: { cls: "border-blue-500/40 text-blue-700 dark:text-blue-400", icon: FileText, label: "Human reviewed" },
  PENDING_VERIFICATION: { cls: "border-amber-500/40 text-amber-700 dark:text-amber-400", icon: Clock, label: "Pending verification" },
  AI_EXTRACTED: { cls: "border-orange-500/40 text-orange-700 dark:text-orange-400", icon: AlertTriangle, label: "AI-extracted (not authoritative)" },
  DISPUTED: { cls: "border-destructive/40 text-destructive", icon: AlertTriangle, label: "Disputed" },
  SUPERSEDED: { cls: "border-muted-foreground/40 text-muted-foreground", icon: Clock, label: "Superseded" },
}

/** Policy transparency card: shows a requirement's full provenance — effective
 *  dates, verification status, policy version, evidence sources, and why it
 *  matters. Expandable evidence excerpts. */
export function PolicyTransparencyCard({
  requirement,
  evidence,
  policySnapshotId,
}: {
  requirement: NormalizedRequirement
  evidence: Evidence[]
  policySnapshotId?: string
}) {
  const [expanded, setExpanded] = useState(false)
  const v = VERIFICATION_STYLE[requirement.verification] ?? VERIFICATION_STYLE.AI_EXTRACTED
  const VIcon = v.icon
  const linkedEvidence = evidence.filter((e) => requirement.evidenceIds.includes(e.id))

  return (
    <div className="rounded-lg border border-border/60 bg-card/60 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{requirement.label}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {requirement.kind.replace(/_/g, " ")} · {requirement.criticality} requirement
          </p>
        </div>
        <Badge variant="outline" className={cn("shrink-0 gap-1 text-[10px] font-normal", v.cls)}>
          <VIcon className="h-2.5 w-2.5" />
          {v.label}
        </Badge>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-1.5 text-[11px]">
        <Meta icon={Calendar} label="Effective" value={requirement.effectiveFrom} />
        <Meta icon={GitBranch} label="Policy" value={policySnapshotId ?? requirement.policyVersionId} />
        {requirement.effectiveTo && (
          <Meta icon={Clock} label="Effective to" value={requirement.effectiveTo} />
        )}
        {requirement.supersedesId && (
          <Meta icon={GitBranch} label="Supersedes" value={requirement.supersedesId} />
        )}
      </div>

      <button
        onClick={() => setExpanded((x) => !x)}
        className="mt-2 text-[11px] font-medium text-primary hover:underline"
      >
        {expanded ? "Hide" : "Show"} evidence ({linkedEvidence.length})
      </button>

      {expanded && linkedEvidence.length > 0 && (
        <div className="mt-2 space-y-2 border-t border-border/50 pt-2">
          {linkedEvidence.map((ev) => (
            <div key={ev.id} className="rounded bg-background/40 p-2">
              <p className="text-[11px] font-medium">{ev.title}</p>
              <p className="text-[10px] text-muted-foreground">
                {ev.publisher} · {ev.kind}
                {ev.publishedAt && ` · ${new Date(ev.publishedAt).toLocaleDateString("en", { year: "numeric", month: "short" })}`}
              </p>
              <blockquote className="mt-1 border-l-2 border-primary/30 pl-2 text-[10px] italic leading-relaxed text-foreground/70">
                {ev.excerpt}
              </blockquote>
              <a
                href={ev.url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 inline-flex items-center gap-1 text-[10px] font-medium text-primary hover:underline"
              >
                <Globe className="h-2.5 w-2.5" />
                {new URL(ev.url).hostname.replace("www.", "")}
                <ExternalLink className="h-2 w-2" />
              </a>
            </div>
          ))}
        </div>
      )}

      {requirement.verification === "AI_EXTRACTED" && (
        <div className="mt-2 rounded border border-orange-500/30 bg-orange-500/5 p-2">
          <p className="flex items-center gap-1.5 text-[10px] font-medium text-orange-700 dark:text-orange-400">
            <AlertTriangle className="h-2.5 w-2.5" />
            This rule was AI-extracted and is NOT authoritative. It cannot be used in eligibility
            determinations until promoted to OFFICIAL_CONFIRMED.
          </p>
        </div>
      )}
    </div>
  )
}

function Meta({ icon: Icon, label, value }: { icon: typeof Calendar; label: string; value: string }) {
  return (
    <div className="flex items-center gap-1.5 rounded bg-background/40 px-2 py-1">
      <Icon className="h-2.5 w-2.5 text-muted-foreground" />
      <span className="text-muted-foreground">{label}:</span>
      <span className="font-mono text-[10px]">{value}</span>
    </div>
  )
}
