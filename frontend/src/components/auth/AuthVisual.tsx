import { useContext, useRef, type PointerEvent, type ReactNode } from 'react'
import { motion, useMotionTemplate, useMotionValue, useSpring } from 'framer-motion'
import { ease, easeInOut } from '../../lib/motion'
import { formatTime, useClock } from '../../lib/useClock'
import { LineReveal } from '../ui/Reveal'
import { EntryContext } from './AuthLayout'

/**
 * The framed stage beside each auth form. It wipes up into place, then the scene inside
 * settles from a slight zoom; a soft light follows the pointer across it.
 */
export function AuthVisual({
  children,
  headline,
  caption,
}: {
  children: ReactNode
  headline: ReactNode[]
  caption: string
}) {
  const base = useContext(EntryContext)
  const ref = useRef<HTMLDivElement>(null)
  const mx = useMotionValue(-1000)
  const my = useMotionValue(-1000)
  const sx = useSpring(mx, { stiffness: 140, damping: 22 })
  const sy = useSpring(my, { stiffness: 140, damping: 22 })
  const spotlight = useMotionTemplate`radial-gradient(560px circle at ${sx}px ${sy}px, rgb(129 140 248 / 0.13), transparent 65%)`

  const onMove = (e: PointerEvent) => {
    const r = ref.current?.getBoundingClientRect()
    if (!r) return
    mx.set(e.clientX - r.left)
    my.set(e.clientY - r.top)
  }

  return (
    <motion.div
      ref={ref}
      onPointerMove={onMove}
      className="relative h-full overflow-hidden rounded-[28px] border border-line bg-[#0b0b0c]"
      initial={{ clipPath: 'inset(100% 0% 0% 0% round 28px)' }}
      animate={{ clipPath: 'inset(0% 0% 0% 0% round 28px)' }}
      transition={{ duration: 1.3, ease: easeInOut, delay: base }}
    >
      <div
        aria-hidden
        className="absolute inset-0 opacity-60"
        style={{
          backgroundImage:
            'linear-gradient(rgb(255 255 255 / 0.04) 1px, transparent 1px), linear-gradient(90deg, rgb(255 255 255 / 0.04) 1px, transparent 1px)',
          backgroundSize: '64px 64px',
          maskImage: 'radial-gradient(ellipse 70% 60% at 50% 40%, #000 30%, transparent 80%)',
        }}
      />

      <motion.div
        className="absolute inset-0"
        initial={{ scale: 1.18, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 2, ease, delay: base + 0.25 }}
      >
        {children}
      </motion.div>

      <motion.div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: spotlight }} />

      <motion.div
        className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between bg-linear-to-b from-[#0b0b0c] to-transparent p-6 pb-14 font-mono text-[11px] uppercase tracking-[0.18em] text-muted"
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.9, ease, delay: base + 0.9 }}
      >
        <span className="flex items-center gap-2.5">
          <span className="relative flex size-1.5">
            <span className="absolute inset-0 animate-ping rounded-full bg-ok opacity-60" />
            <span className="size-1.5 rounded-full bg-ok" />
          </span>
          Live workspace
        </span>
        <Clock />
      </motion.div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-linear-to-t from-[#0b0b0c] from-35% via-[#0b0b0c]/80 to-transparent px-8 pb-7 pt-40 xl:px-10 xl:pb-9">
        <LineReveal
          as="p"
          play
          delay={base + 0.75}
          lines={headline}
          className="text-[clamp(2.4rem,4vw,4.4rem)] font-medium leading-[0.92] tracking-[-0.05em]"
        />
        <motion.div
          className="mt-7 flex items-center justify-between gap-6 border-t border-line pt-4 font-mono text-[11px] text-dim"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 1, ease, delay: base + 1.1 }}
        >
          <span>{caption}</span>
          <span className="hidden xl:inline">Generate · Adapt · Schedule · Publish</span>
        </motion.div>
      </div>
    </motion.div>
  )
}

function Clock() {
  const now = useClock()
  const offset = -now.getTimezoneOffset() / 60
  return (
    <span className="tabular-nums">
      {formatTime(now)}
      <span className="ml-2 text-dim">
        GMT{offset >= 0 ? '+' : ''}
        {offset}
      </span>
    </span>
  )
}
