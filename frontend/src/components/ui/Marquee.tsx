import { useRef, type ReactNode } from 'react'
import {
  motion,
  useAnimationFrame,
  useMotionValue,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
  useVelocity,
} from 'framer-motion'
import { cn } from '../../lib/cn'

/** CSS-only infinite strip. The content is rendered twice and the track slides by half. */
export function Marquee({ children, className, reverse }: { children: ReactNode; className?: string; reverse?: boolean }) {
  return (
    <div className={cn('group flex overflow-hidden mask-x', className)}>
      <div
        className="flex w-max animate-marquee group-hover:[animation-play-state:paused] motion-reduce:animate-none"
        style={reverse ? { animationDirection: 'reverse' } : undefined}
      >
        <div className="flex shrink-0 items-center">{children}</div>
        <div aria-hidden className="flex shrink-0 items-center">
          {children}
        </div>
      </div>
    </div>
  )
}

const wrap = (min: number, max: number, v: number) => {
  const r = max - min
  return ((((v - min) % r) + r) % r) + min
}

/**
 * A strip that drifts on its own and answers the page: scrolling speeds it up, scrolling back
 * reverses it, and a hard flick leans the type into the direction of travel.
 * `speed` is in percent of one copy per second; negative drifts left.
 */
export function VelocityMarquee({ children, className, speed = -2.4 }: { children: ReactNode; className?: string; speed?: number }) {
  const reduce = useReducedMotion()
  const base = useMotionValue(0)
  const { scrollY } = useScroll()
  const velocity = useSpring(useVelocity(scrollY), { damping: 50, stiffness: 400 })
  const boost = useTransform(velocity, [0, 1000], [0, 4], { clamp: false })
  const skewX = useTransform(velocity, [-2400, 0, 2400], [9, 0, -9])
  const x = useTransform(base, (v) => `${wrap(-50, 0, v)}%`)
  const direction = useRef(1)

  useAnimationFrame((_, delta) => {
    if (reduce) return
    let move = direction.current * speed * (delta / 1000)
    const b = boost.get()
    if (b < 0) direction.current = -1
    else if (b > 0) direction.current = 1
    move += direction.current * move * b
    base.set(base.get() + move)
  })

  return (
    <div className={cn('flex overflow-hidden mask-x', className)}>
      <motion.div className="flex w-max will-change-transform" style={{ x, skewX: reduce ? 0 : skewX }}>
        <div className="flex shrink-0 items-center">{children}</div>
        <div aria-hidden className="flex shrink-0 items-center">
          {children}
        </div>
      </motion.div>
    </div>
  )
}
