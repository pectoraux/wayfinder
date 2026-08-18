'use client'

import { useState } from 'react'
import type { MobilityFrontier, Route, RouteScores } from '@/lib/domain/types'
import { ScatterChart, Scatter, XAxis, YAxis, ZAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Cell } from 'recharts'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Label } from '@/components/ui/label'

const DIMS: { key: keyof RouteScores; label: string }[] = [
  { key: 'economicUpside', label: 'Economic upside' },
  { key: 'immigrationProbability', label: 'Immigration probability' },
  { key: 'speed', label: 'Speed' },
  { key: 'affordability', label: 'Affordability' },
  { key: 'longTermResidence', label: 'Long-term residence' },
  { key: 'citizenshipProspect', label: 'Citizenship prospect' },
  { key: 'familyUtility', label: 'Family utility' },
  { key: 'mobilityUpside', label: 'Mobility upside' },
  { key: 'optionality', label: 'Optionality' },
  { key: 'reversibility', label: 'Reversibility' },
  { key: 'riskAdjusted', label: 'Risk-adjusted' },
]

export function MobilityFrontierChart({
  frontier,
  routes,
  activeRouteId,
  onSelect,
}: {
  frontier: MobilityFrontier
  routes: Route[]
  activeRouteId: string | null
  onSelect: (id: string) => void
}) {
  const [xDim, setXDim] = useState<keyof RouteScores>('economicUpside')
  const [yDim, setYDim] = useState<keyof RouteScores>('citizenshipProspect')

  const data = frontier.points.map((p) => ({
    id: p.routeId,
    label: p.label,
    x: p.dimensions[xDim],
    y: p.dimensions[yDim],
    z: p.dimensions.immigrationProbability,
    pareto: p.paretoOptimal,
  }))

  const active = routes.find((r) => r.id === activeRouteId)

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <div>
          <Label className="mb-1 block text-xs text-muted-foreground">X axis</Label>
          <Select value={xDim} onValueChange={(v) => setXDim(v as keyof RouteScores)}>
            <SelectTrigger className="h-8 w-44 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>{DIMS.map((d) => <SelectItem key={d.key} value={d.key} className="text-xs">{d.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div>
          <Label className="mb-1 block text-xs text-muted-foreground">Y axis</Label>
          <Select value={yDim} onValueChange={(v) => setYDim(v as keyof RouteScores)}>
            <SelectTrigger className="h-8 w-44 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>{DIMS.map((d) => <SelectItem key={d.key} value={d.key} className="text-xs">{d.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <p className="ml-auto text-[11px] text-muted-foreground">
          Bubble size = immigration probability · <span className="text-primary">●</span> Pareto-optimal
        </p>
      </div>

      <ResponsiveContainer width="100%" height={320}>
        <ScatterChart margin={{ top: 10, right: 20, bottom: 28, left: 8 }}>
          <CartesianGrid stroke="var(--border)" strokeOpacity={0.5} strokeDasharray="3 3" />
          <XAxis
            type="number"
            dataKey="x"
            name={DIMS.find((d) => d.key === xDim)?.label}
            domain={[0, 100]}
            tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }}
            label={{ value: DIMS.find((d) => d.key === xDim)?.label, position: 'insideBottom', offset: -16, fontSize: 11, fill: 'var(--muted-foreground)' }}
          />
          <YAxis
            type="number"
            dataKey="y"
            name={DIMS.find((d) => d.key === yDim)?.label}
            domain={[0, 100]}
            tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }}
            label={{ value: DIMS.find((d) => d.key === yDim)?.label, angle: -90, position: 'insideLeft', offset: 18, fontSize: 11, fill: 'var(--muted-foreground)' }}
          />
          <ZAxis type="number" dataKey="z" range={[60, 320]} />
          <Tooltip
            cursor={{ strokeDasharray: '3 3' }}
            contentStyle={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }}
            content={({ payload }) => {
              const d = payload?.[0]?.payload as typeof data[number] | undefined
              if (!d) return null
              return (
                <div className="rounded-lg border bg-card p-2 text-xs shadow-sm">
                  <div className="font-medium">{d.label}</div>
                  <div className="text-muted-foreground">{xDim}: {d.x} · {yDim}: {d.y}</div>
                  {d.pareto && <div className="mt-0.5 text-primary">Pareto-optimal</div>}
                </div>
              )
            }}
          />
          <ReferenceLine x={50} stroke="var(--border)" strokeOpacity={0.3} />
          <ReferenceLine y={50} stroke="var(--border)" strokeOpacity={0.3} />
          <Scatter data={data} onClick={(d) => onSelect((d as any).id)} cursor="pointer">
            {data.map((entry) => (
              <Cell
                key={entry.id}
                fill={entry.id === activeRouteId ? 'var(--primary)' : entry.pareto ? 'var(--primary)' : 'var(--muted-foreground)'}
                fillOpacity={entry.pareto ? 0.85 : 0.35}
                stroke={entry.id === activeRouteId ? 'var(--accent)' : 'transparent'}
                strokeWidth={entry.id === activeRouteId ? 2 : 0}
              />
            ))}
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>
      {active && (
        <p className="mt-1 text-center text-[11px] text-muted-foreground">
          Click a bubble to inspect. Selected: <span className="font-medium text-foreground">{active.label}</span>
        </p>
      )}
    </div>
  )
}
