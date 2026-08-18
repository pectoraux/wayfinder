import { cn } from '@/lib/utils'

/** Wayfinder compass mark — the navigation metaphor. */
export function WayfinderLogo({ className, animated = false }: { className?: string; animated?: boolean }) {
  return (
    <svg
      viewBox="0 0 48 48"
      className={cn('h-7 w-7', className)}
      fill="none"
      aria-hidden="true"
    >
      {/* outer ring */}
      <circle cx="24" cy="24" r="21" stroke="currentColor" strokeWidth="1.5" opacity="0.35" />
      <circle cx="24" cy="24" r="15" stroke="currentColor" strokeWidth="1" opacity="0.25" />
      {/* cardinal ticks */}
      {[0, 90, 180, 270].map((deg) => (
        <line
          key={deg}
          x1="24"
          y1="3"
          x2="24"
          y2="7"
          stroke="currentColor"
          strokeWidth="1.5"
          transform={`rotate(${deg} 24 24)`}
          opacity="0.6"
        />
      ))}
      {/* compass needle */}
      <g className={animated ? 'wf-compass' : undefined}>
        <path d="M24 9 L28 24 L24 39 L20 24 Z" fill="currentColor" opacity="0.95" />
        <path d="M24 9 L28 24 L24 24 Z" fill="oklch(0.78 0.135 72)" />
        <path d="M24 39 L20 24 L24 24 Z" fill="currentColor" opacity="0.55" />
      </g>
      <circle cx="24" cy="24" r="2.2" fill="var(--background)" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  )
}

export function WayfinderWordmark({ className }: { className?: string }) {
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <WayfinderLogo className="text-primary" animated />
      <span className="text-lg font-semibold tracking-tight">
        Wayfinder
      </span>
    </div>
  )
}
