'use client'

import type { Route } from '@/lib/domain/types'
import { cn } from '@/lib/utils'
import { Flag, Lock, Shield, Sparkles, MapPin, CircleDot, Building2 } from 'lucide-react'
import { getEnablersForAddressal } from '@/lib/knowledge/enablers'

/** A navigation-style visualization of a route's state-transition sequence. */
export function RouteMap({ route, compact = false }: { route: Route; compact?: boolean }) {
  const steps = route.steps
  const n = steps.length
  // node positions across the SVG width
  const W = 1000
  const H = compact ? 180 : 240
  const padX = 60
  const usable = W - padX * 2
  const gap = n > 1 ? usable / (n - 1) : 0
  const cy = H / 2

  const nodes = steps.map((s, i) => ({
    ...s,
    x: n > 1 ? padX + gap * i : W / 2,
    y: cy,
  }))

  return (
    <div className="relative w-full overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[640px]" role="img" aria-label={`Route map: ${route.label}`}>
        <defs>
          <linearGradient id="wf-line" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.3" />
            <stop offset="50%" stopColor="var(--primary)" stopOpacity="0.9" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.9" />
          </linearGradient>
          <filter id="wf-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        {/* connectors */}
        {nodes.slice(0, -1).map((node, i) => {
          const next = nodes[i + 1]
          const blocked = node.blocked || next.blocked
          const isFinal = i === nodes.length - 2
          return (
            <g key={`line-${i}`}>
              <line
                x1={node.x}
                y1={node.y}
                x2={next.x}
                y2={next.y}
                stroke={blocked ? 'var(--destructive)' : 'url(#wf-line)'}
                strokeWidth={2.5}
                strokeLinecap="round"
                className={blocked ? '' : 'wf-route-dash'}
                opacity={blocked ? 0.5 : 0.9}
              />
              {/* arrow head */}
              <path
                d={`M ${next.x - 8} ${node.y - 5} L ${next.x - 2} ${node.y} L ${next.x - 8} ${node.y + 5} Z`}
                fill={blocked ? 'var(--destructive)' : 'var(--primary)'}
                opacity={isFinal ? 0.9 : 0.7}
              />
            </g>
          )
        })}

        {/* nodes */}
        {nodes.map((node, i) => {
          const isOrigin = i === 0
          const isDestination = i === nodes.length - 1
          const isPR = /permanent|settlement|ilr/i.test(node.status)
          const isCit = /citizenship/i.test(node.status)
          const r = isOrigin || isDestination ? 26 : 22
          const color = node.blocked
            ? 'var(--destructive)'
            : isCit
              ? 'var(--accent)'
              : isPR
                ? 'var(--chart-4)'
                : isOrigin
                  ? 'var(--chart-5)'
                  : 'var(--primary)'
          return (
            <g key={`node-${i}`} transform={`translate(${node.x} ${node.y})`}>
              {/* halo */}
              <circle r={r + 8} fill={color} opacity={0.08} />
              <circle r={r + 4} fill="none" stroke={color} strokeWidth={1} opacity={0.25} />
              {/* body */}
              <circle
                r={r}
                fill="var(--card)"
                stroke={color}
                strokeWidth={node.blocked ? 2.5 : 2}
                strokeDasharray={node.blocked ? '4 3' : undefined}
                filter={isDestination ? 'url(#wf-glow)' : undefined}
              />
              {/* icon */}
              <g transform="translate(-9 -9)" color={color}>
                {node.blocked ? (
                  <Lock size={18} color={color} />
                ) : isCit ? (
                  <Flag size={18} color={color} />
                ) : isPR ? (
                  <Shield size={18} color={color} />
                ) : isOrigin ? (
                  <MapPin size={18} color={color} />
                ) : (
                  <CircleDot size={18} color={color} />
                )}
              </g>

              {/* enabler satellite for blocked nodes */}
              {node.blocked && node.blockerLabels && node.blockerLabels.length > 0 && (
                <g transform={`translate(${r + 4} ${-r - 6})`}>
                  <circle r={9} fill="var(--chart-4)" opacity={0.18} />
                  <circle r={9} fill="none" stroke="var(--chart-4)" strokeWidth={1.5} strokeDasharray="2 2" />
                  <g transform="translate(-4 -4)">
                    <Building2 size={8} color="var(--chart-4)" />
                  </g>
                </g>
              )}

              {/* label */}
              <foreignObject x={-90} y={r + 8} width={180} height={compact ? 44 : 60}>
                <div className="text-center">
                  <div className={cn('text-[11px] font-semibold leading-tight', isDestination && 'text-accent-foreground')}>
                    {node.status}
                  </div>
                  <div className="text-[10px] leading-tight text-muted-foreground">
                    {node.durationMonths > 0 ? `${node.durationMonths} mo` : 'start'}
                    {node.blocked && <span className="ml-1 text-destructive">· blocked</span>}
                  </div>
                  {node.blocked && node.blockerLabels && !compact && (
                    <div className="mt-0.5 text-[9px] leading-tight text-destructive/80">
                      {node.blockerLabels[0]}
                    </div>
                  )}
                </div>
              </foreignObject>
            </g>
          )
        })}
      </svg>

      {/* legend */}
      {!compact && (
        <div className="mt-1 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[10px] text-muted-foreground">
          <Legend color="var(--chart-5)" label="Current" />
          <Legend color="var(--primary)" label="Entry status" />
          <Legend color="var(--chart-4)" label="Permanent residence" />
          <Legend color="var(--accent)" label="Citizenship" />
          <Legend color="var(--destructive)" label="Blocked step" dashed />
          <Legend color="var(--chart-4)" label="Enabler unlock" circle />
        </div>
      )}
    </div>
  )
}

function Legend({ color, label, dashed, circle }: { color: string; label: string; dashed?: boolean; circle?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {circle ? (
        <span className="inline-block h-2.5 w-2.5 rounded-full border" style={{ borderColor: color, borderStyle: dashed ? 'dashed' : 'solid' }} />
      ) : (
        <span className="inline-block h-0.5 w-4 rounded" style={{ backgroundColor: color, opacity: dashed ? 0.6 : 1 }} />
      )}
      {label}
    </span>
  )
}

/** Count distinct enabler kinds that could address this route's blockers. */
export function enablerCount(route: Route): number {
  const kinds = new Set<string>()
  for (const b of route.eligibility.blockers) {
    for (const a of b.addressableVia) kinds.add(a.kind)
  }
  return kinds.size
}

export function enablerSummary(route: Route): { label: string; count: number }[] {
  const out: Record<string, number> = {}
  for (const b of route.eligibility.blockers) {
    for (const a of b.addressableVia) {
      const enablers = getEnablersForAddressal(a.kind, route.countryCode)
      out[a.label] = (out[a.label] ?? 0) + enablers.length
    }
  }
  return Object.entries(out).map(([label, count]) => ({ label, count }))
}
