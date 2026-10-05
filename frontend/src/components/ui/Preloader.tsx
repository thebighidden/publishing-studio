import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, animate, motion, useReducedMotion } from 'framer-motion'
import { ease, easeInOut } from '../../lib/motion'
import { LogoMark } from './Logo'

const WORDS = ['Create', 'Adapt', 'Schedule', 'Publish']

export function Preloader({ onDone }: { onDone: () => void }) {
  const reduce = useReducedMotion()
  const [count, setCount] = useState(0)
  const [open, setOpen] = useState(true)
  const done = useRef(onDone)
  done.current = onDone

  useEffect(() => {
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual'
    window.scrollTo(0, 0)

    if (reduce) {
      setOpen(false)
      done.current()
      return
    }

    let exitTimer = 0
    const controls = animate(0, 100, {
      duration: 1.9,
      ease: [0.6, 0.05, 0.25, 1],
      onUpdate: (v) => setCount(Math.round(v)),
      onComplete: () => {
        exitTimer = window.setTimeout(() => {
          setOpen(false)
          done.current()
        }, 180)
      },
    })
    return () => {
      controls.stop()
      window.clearTimeout(exitTimer)
    }
  }, [reduce])

  const word = WORDS[Math.min(WORDS.length - 1, Math.floor(count / 25))]

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="preloader"
          className="fixed inset-0 z-300 flex flex-col justify-between bg-ink px-5 py-6 md:px-10 md:py-8"
          exit={{ clipPath: 'inset(0 0 100% 0)' }}
          initial={{ clipPath: 'inset(0 0 0% 0)' }}
          transition={{ duration: 1, ease: easeInOut }}
        >
          <div className="flex items-center justify-between font-mono text-[11px] uppercase tracking-[0.18em] text-muted">
            <span className="flex items-center gap-2 text-fg">
              <LogoMark className="size-4" /> FlowAI
            </span>
            <span>Loading workspace</span>
          </div>

          <div className="flex h-[1.1em] items-center justify-center overflow-hidden font-serif text-6xl italic md:text-8xl">
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span
                key={word}
                initial={{ y: '100%', opacity: 0 }}
                animate={{ y: '0%', opacity: 1 }}
                exit={{ y: '-100%', opacity: 0 }}
                transition={{ duration: 0.55, ease }}
              >
                {word}
              </motion.span>
            </AnimatePresence>
          </div>

          <div className="flex items-end justify-between gap-6">
            <div className="h-px flex-1 self-center bg-line">
              <div className="h-px origin-left bg-fg" style={{ transform: `scaleX(${count / 100})` }} />
            </div>
            <span className="font-mono text-5xl tabular-nums leading-none tracking-tight md:text-7xl">
              {String(count).padStart(3, '0')}
            </span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
