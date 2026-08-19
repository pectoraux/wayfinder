'use client'

import type { Route, RouteScores } from '@/lib/domain/types'
import { Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer, Tooltip } from 'recharts'

const LABELS: Record<keyof RouteScores, string> = {
  economicUpside: 'Income',
  immigrationProbability: 'Probability',
  speed: 'Speed',
  affordability: 'Affordability',
  longTermResidence: 'Residence',
  citizenshipProspect: 'Citizenship',
  familyUtility: 'Family',
  mobilityUpside: 'Mobility',
  optionality: 'Optionality',
  reversibility: 'Reversible',
  riskAdjusted: 'Risk-adj',
}

export function ScoreRadar({ route, compareTo }: { route: Route; compareTo?: Route | null }) {
  const dims = Object.keys(LABELS) as (keyof RouteScores)[]
  const data = dims.map((d) => ({
    dim: LABELS[d],
    value: route.scores[d],
    compare: compareTo?.scores[d] ?? undefined,
  }))

  return (
    <ResponsiveContainer width="100%" height={260}>
      <RadarChart data={data} margin={{ top: 8, right: 24, bottom: 8, left: 24 }}>
        <PolarGrid stroke="var(--border)" strokeOpacity={0.6} />
        <PolarAngleAxis dataKey="dim" tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} />
        <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
        <Tooltip
          contentStyle={{
            background: 'var(--card)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            fontSize: 12,
          }}
          formatter={(v: number, n: string) => [`${v}`, n === 'value' ? route.label : compareTo?.label ?? '']}
        />
        <Radar name="value" dataKey="value" stroke="var(--primary)" fill="var(--primary)" fillOpacity={0.25} strokeWidth={2} />
        {compareTo && (
          <Radar name="compare" dataKey="compare" stroke="var(--accent)" fill="var(--accent)" fillOpacity={0.12} strokeWidth={1.5} strokeDasharray="3 3" />
        )}
      </RadarChart>
    </ResponsiveContainer>
  )
}
