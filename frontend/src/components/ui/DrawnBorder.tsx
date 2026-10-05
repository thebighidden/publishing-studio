import { useRef } from 'react'
import { motion, useInView } from 'framer-motion'
import { easeInOut } from '../../lib/motion'

/**
 * Sketches a frame's outline the first time it scrolls into view, starting at the top-left
 * corner and going clockwise — the same pen as the page-long line.
 * Drop it inside a rounded, overflow-hidden container: the outer half of the 2px stroke
 * is clipped away, leaving a crisp 1px edge that follows the corner radius.
 */
export function DrawnBorder({ radius = 12, delay = 0 }: { radius?: number; delay?: number }) {
  const ref = useRef<SVGSVGElement>(null)
  const inView = useInView(ref, { once: true, margin: '0px 0px -12% 0px' })

  return (
    <svg ref={ref} aria-hidden className="pointer-events-none absolute inset-0 z-20 h-full w-full">
      <motion.rect
        x="0"
        y="0"
        width="100%"
        height="100%"
        rx={radius}
        fill="none"
        stroke="rgb(255 255 255 / 0.16)"
        strokeWidth={2}
        initial={{ pathLength: 0 }}
        animate={{ pathLength: inView ? 1 : 0 }}
        transition={{ duration: 2, ease: easeInOut, delay }}
      />
    </svg>
  )
}
