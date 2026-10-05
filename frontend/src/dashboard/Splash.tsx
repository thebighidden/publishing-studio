import { motion } from 'framer-motion'
import { LogoMark } from '../components/ui/Logo'
import { ease } from '../lib/motion'

/** Shown while the studio loads, and while the session is being checked. */
export function Splash() {
  return (
    <div className="grid min-h-dvh place-items-center bg-ink">
      <motion.div
        className="flex flex-col items-center gap-4"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.2, duration: 0.6 }}
      >
        <motion.span animate={{ rotate: [0, -90, -90, 0] }} transition={{ duration: 2.4, repeat: Infinity, ease }}>
          <LogoMark className="size-7" />
        </motion.span>
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-dim">Opening your studio</p>
      </motion.div>
    </div>
  )
}
