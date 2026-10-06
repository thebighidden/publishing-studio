import { useEffect, useState } from 'react'
import { AnimatePresence, motion, useMotionValue, useSpring } from 'framer-motion'

const INTERACTIVE = 'a, button, [role="tab"], [data-cursor], label'
const TEXT = 'input:not([type="checkbox"]):not([type="radio"]), textarea'

/**
 * A dot that sits exactly on the pointer and a ring that trails it.
 * Over anything clickable the ring opens up; `data-cursor="Label"` puts a word in it;
 * over a text field it narrows into a caret.
 * Only mounts for a fine pointer without reduced-motion preferences.
 */
export function Cursor() {
  const [enabled, setEnabled] = useState(false)
  const [hovering, setHovering] = useState(false)
  const [text, setText] = useState(false)
  const [label, setLabel] = useState<string | null>(null)
  const [visible, setVisible] = useState(false)
  const [down, setDown] = useState(false)

  const x = useMotionValue(-100)
  const y = useMotionValue(-100)
  const rx = useSpring(x, { stiffness: 380, damping: 32, mass: 0.6 })
  const ry = useSpring(y, { stiffness: 380, damping: 32, mass: 0.6 })

  useEffect(() => {
    const fine = window.matchMedia('(pointer: fine)').matches
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    setEnabled(fine && !reduced)
  }, [])

  useEffect(() => {
    if (!enabled) return
    document.documentElement.classList.add('has-cursor')

    const move = (e: PointerEvent) => {
      x.set(e.clientX)
      y.set(e.clientY)
      setVisible(true)
      const el = e.target as Element | null
      const field = !!el?.closest?.(TEXT)
      const target = field ? null : el?.closest?.(INTERACTIVE)
      setText(field)
      setHovering(!!target)
      setLabel(target?.getAttribute('data-cursor') || null)
    }
    const leave = () => setVisible(false)
    const press = () => setDown(true)
    const release = () => setDown(false)

    window.addEventListener('pointermove', move, { passive: true })
    document.addEventListener('pointerleave', leave)
    window.addEventListener('pointerdown', press)
    window.addEventListener('pointerup', release)
    return () => {
      document.documentElement.classList.remove('has-cursor')
      window.removeEventListener('pointermove', move)
      document.removeEventListener('pointerleave', leave)
      window.removeEventListener('pointerdown', press)
      window.removeEventListener('pointerup', release)
    }
  }, [enabled, x, y])

  if (!enabled) return null

  const size = label ? 84 : hovering ? 46 : 28

  // Two separate fixed layers: a fixed element is its own stacking context, so the
  // dot's difference blend only reaches the page if it sits on the fixed layer itself.
  return (
    <>
      <motion.div
        aria-hidden
        className="pointer-events-none fixed left-0 top-0 z-200"
        style={{ x: rx, y: ry, opacity: visible ? 1 : 0 }}
      >
        <motion.div
          className="-translate-x-1/2 -translate-y-1/2 rounded-full border"
          animate={{
            width: text ? 2 : size,
            height: text ? 26 : size,
            scale: down ? 0.85 : 1,
            backgroundColor: label || text ? 'var(--color-fg)' : 'color-mix(in oklab, var(--color-fg) 0%, transparent)',
            borderColor: text ? 'color-mix(in oklab, var(--color-fg) 0%, transparent)' : hovering ? 'color-mix(in oklab, var(--color-fg) 90%, transparent)' : 'color-mix(in oklab, var(--color-fg) 35%, transparent)',
          }}
          transition={{ type: 'spring', stiffness: 400, damping: 30 }}
        >
          <AnimatePresence>
            {label && (
              <motion.span
                initial={{ opacity: 0, scale: 0.6 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.6 }}
                className="grid h-full w-full place-items-center font-mono text-[10px] uppercase tracking-[0.14em] text-ink"
              >
                {label}
              </motion.span>
            )}
          </AnimatePresence>
        </motion.div>
      </motion.div>
      <motion.div
        aria-hidden
        className="pointer-events-none fixed left-0 top-0 z-201 mix-blend-difference"
        style={{ x, y, opacity: visible && !label && !text ? 1 : 0 }}
      >
        <div className="size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white" />
      </motion.div>
    </>
  )
}
