import { motion } from 'framer-motion'
import { ease } from '../../lib/motion'
import { DrawnTick } from './Field'

/** A ring that draws itself, a tick inside it, and two pulses that ripple out once. */
export function SuccessMark() {
  return (
    <div className="relative size-16">
      {[0, 1].map((i) => (
        <motion.span
          key={i}
          aria-hidden
          className="absolute inset-0 rounded-full border border-ok/60"
          initial={{ scale: 1, opacity: 0 }}
          animate={{ scale: 2.1, opacity: [0, 0.7, 0] }}
          transition={{ duration: 1.6, ease: 'easeOut', delay: 0.75 + i * 0.25 }}
        />
      ))}
      <svg viewBox="0 0 64 64" className="absolute inset-0 size-16 -rotate-90 text-ok" aria-hidden>
        <motion.circle
          cx="32"
          cy="32"
          r="30"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.9, ease }}
        />
      </svg>
      <motion.span
        className="absolute inset-[9px] grid place-items-center rounded-full bg-ok text-ink"
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ type: 'spring', stiffness: 380, damping: 20, delay: 0.55 }}
      >
        <DrawnTick on className="size-6" delay={0.75} />
      </motion.span>
    </div>
  )
}
