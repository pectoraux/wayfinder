'use client'

import { useState } from 'react'
import type { EnablerMatch, Route } from '@/lib/domain/types'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Building2, Briefcase, GraduationCap, Scale, Languages, ShieldCheck, Handshake, Lock, Check } from 'lucide-react'
import { cn } from '@/lib/utils'

const KIND_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  employer: Briefcase,
  university: GraduationCap,
  incubator: Building2,
  accelerator: Building2,
  investor: Briefcase,
  professional_body: ShieldCheck,
  endorsement_body: ShieldCheck,
  language_provider: Languages,
  credential_evaluator: ShieldCheck,
  law_firm: Scale,
  community_org: Handshake,
}

const LEGITIMACY_STYLE: Record<string, string> = {
  required: 'border-primary/40 bg-primary/5 text-primary',
  legally_valid: 'border-emerald-500/40 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400',
  supportive: 'border-amber-500/40 bg-amber-500/5 text-amber-700 dark:text-amber-400',
}

export function EnablerList({
  matches,
  routes,
}: {
  matches: EnablerMatch[]
  routes: Route[]
}) {
  const [consented, setConsented] = useState<Set<string>>(new Set())

  if (matches.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border/60 p-6 text-center text-sm text-muted-foreground">
        <Handshake className="mx-auto mb-2 h-5 w-5 opacity-50" />
        No blockers requiring an enabler on your eligible/conditional routes.
      </div>
    )
  }

  const routeLabel = (id: string) => {
    const r = routes.find((x) => x.id === id)
    return r?.label ?? ''
  }

  const toggleConsent = (key: string) => {
    setConsented((s) => {
      const next = new Set(s)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <ScrollArea className="wf-scroll max-h-[32rem] pr-3">
      <div className="space-y-3">
        {matches.map((m, i) => {
          const Icon = KIND_ICON[m.enabler.kind] ?? Building2
          const key = `${m.enabler.id}-${i}`
          const hasConsent = consented.has(key)
          return (
            <Card key={key} className="border-border/60 bg-card/60 p-3">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Icon className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-1.5">
                    <p className="text-sm font-semibold">{m.enabler.name}</p>
                    <Badge variant="outline" className={cn('text-[10px] font-normal capitalize', LEGITIMACY_STYLE[m.enabler.legitimacy])}>
                      {m.enabler.legitimacy.replace('_', ' ')}
                    </Badge>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">{m.rationale}</p>

                  <div className="mt-2 grid gap-1.5 text-[11px] sm:grid-cols-2">
                    <div className="rounded bg-background/50 px-2 py-1">
                      <span className="text-muted-foreground">Relationship: </span>
                      <span className="font-medium text-foreground/90">{m.relationship}</span>
                    </div>
                    <div className="rounded bg-background/50 px-2 py-1">
                      <span className="text-muted-foreground">Addresses: </span>
                      <span className="font-medium text-foreground/90">{m.addresses}</span>
                    </div>
                    <div className="rounded bg-background/50 px-2 py-1">
                      <span className="text-muted-foreground">You get: </span>
                      <span className="text-foreground/90">{m.whatUserGets}</span>
                    </div>
                    <div className="rounded bg-background/50 px-2 py-1">
                      <span className="text-muted-foreground">They get: </span>
                      <span className="text-foreground/90">{m.whatEnablerGets}</span>
                    </div>
                  </div>

                  {m.enabler.preconditions.length > 0 && (
                    <div className="mt-2">
                      <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Required before contact</p>
                      <ul className="mt-0.5 space-y-0.5">
                        {m.enabler.preconditions.map((p, j) => (
                          <li key={j} className="text-[11px] text-foreground/70">• {p}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* consent gate */}
                  <div className="mt-3 flex items-center gap-2 border-t border-border/50 pt-2">
                    <button
                      onClick={() => toggleConsent(key)}
                      className={cn(
                        'flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] transition-colors',
                        hasConsent
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border text-muted-foreground hover:bg-muted',
                      )}
                    >
                      {hasConsent ? <Check className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
                      {hasConsent ? 'Consent granted' : 'Grant consent to share'}
                    </button>
                    <Button
                      size="sm"
                      variant={hasConsent ? 'default' : 'secondary'}
                      disabled={!hasConsent}
                      className="h-7 gap-1.5 text-xs"
                    >
                      <Handshake className="h-3 w-3" />
                      Request introduction
                    </Button>
                    <span className="ml-auto text-[10px] text-muted-foreground">
                      No profile data shared without consent
                    </span>
                  </div>
                </div>
              </div>
            </Card>
          )
        })}
      </div>
    </ScrollArea>
  )
}
