'use client'

import type { Evidence, Route } from '@/lib/domain/types'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { ExternalLink, FileText, ShieldCheck, Globe } from 'lucide-react'
import { cn } from '@/lib/utils'

const KIND_LABEL: Record<Evidence['kind'], string> = {
  government: 'Government',
  legislation: 'Legislation',
  embassy: 'Embassy',
  official_portal: 'Official portal',
  institution: 'Institution',
  secondary: 'Secondary',
}

export function EvidenceTrail({ route, evidence }: { route: Route; evidence: Evidence[] }) {
  const routeEvidenceIds = new Set(route.evidenceIds)
  const items = evidence.filter((e) => routeEvidenceIds.has(e.id))

  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">No evidence records attached to this route.</p>
  }

  return (
    <ScrollArea className="wf-scroll max-h-[28rem] pr-3">
      <ol className="space-y-3">
        {items.map((e, i) => (
          <li key={e.id} className="relative rounded-lg border border-border/60 bg-card/60 p-3 pl-9">
            <span className="absolute left-3 top-3 flex h-4 w-4 items-center justify-center rounded-full bg-primary/10 text-[9px] font-semibold text-primary">
              {i + 1}
            </span>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-medium leading-tight">{e.title}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {e.publisher} · {KIND_LABEL[e.kind]}
                  {e.publishedAt && ` · ${new Date(e.publishedAt).toLocaleDateString('en', { year: 'numeric', month: 'short' })}`}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <Badge
                  variant="outline"
                  className={cn(
                    'gap-1 text-[10px] font-normal',
                    e.verification === 'official' && 'border-emerald-500/40 text-emerald-700 dark:text-emerald-400',
                    e.verification === 'corroborated' && 'border-amber-500/40 text-amber-700 dark:text-amber-400',
                  )}
                >
                  {e.verification === 'official' ? <ShieldCheck className="h-2.5 w-2.5" /> : <FileText className="h-2.5 w-2.5" />}
                  {e.verification}
                </Badge>
              </div>
            </div>
            <blockquote className="mt-2 border-l-2 border-primary/30 pl-2.5 text-xs italic leading-relaxed text-foreground/80">
              {e.excerpt}
            </blockquote>
            {e.location && (
              <p className="mt-1.5 text-[11px] text-muted-foreground">📍 {e.location}</p>
            )}
            <a
              href={e.url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            >
              <Globe className="h-3 w-3" />
              {new URL(e.url).hostname.replace('www.', '')}
              <ExternalLink className="h-2.5 w-2.5" />
            </a>
          </li>
        ))}
      </ol>
    </ScrollArea>
  )
}
