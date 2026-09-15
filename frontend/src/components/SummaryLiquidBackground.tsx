import { useId, useRef } from 'react'
import { useInView } from 'framer-motion'

// Two identical wavelengths let the surface travel continuously without a reset.
// Opposing layers create changing crests and troughs, like shallow water.
const surface = 'M0 64 C125 64 125 28 250 28 S375 100 500 100 S625 28 750 28 S875 64 1000 64 C1125 64 1125 28 1250 28 S1375 100 1500 100 S1625 28 1750 28 S1875 64 2000 64'
// Brand violet through the magenta accent, so the layers read as one purple
// surface with depth rather than three separate washes. Kept as literals
// because they are SVG fill values, not utility classes.
const layers = [
  { name: 'back', color: '#E0B0FF', opacity: 0.16 },
  { name: 'middle', color: '#BF40BF', opacity: 0.12 },
  { name: 'front', color: '#7F00FF', opacity: 0.1 },
]

export function SummaryLiquidBackground({ generating }: { generating: boolean }) {
  const id = useId().replace(/:/g, '')
  const ref = useRef<HTMLDivElement>(null)
  const visible = useInView(ref)

  return (
    <div ref={ref} aria-hidden="true" className="summary-liquid" data-generating={generating} data-visible={visible}>
      {layers.map(layer => (
        <svg key={layer.name} className={`summary-liquid-wave summary-liquid-wave--${layer.name}`} viewBox="0 0 2000 140" preserveAspectRatio="none" focusable="false">
          <defs>
            <linearGradient id={`${id}-${layer.name}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={layer.color} stopOpacity={layer.opacity} />
              <stop offset="100%" stopColor={layer.color} stopOpacity="0.015" />
            </linearGradient>
          </defs>
          <path d={`${surface} L2000 140 H0 Z`} fill={`url(#${id}-${layer.name})`} />
          <path d={surface} fill="none" stroke={layer.color} strokeOpacity="0.2" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        </svg>
      ))}
    </div>
  )
}
