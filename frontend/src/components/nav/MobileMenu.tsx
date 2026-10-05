import { type MouseEvent, type RefObject } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowUpRight } from 'lucide-react'
import { useLenis } from 'lenis/react'
import { ease, easeInOut } from '../../lib/motion'
import { formatTime, useClock } from '../../lib/useClock'
import { Link } from '../../lib/router'
import { useSession } from '../../lib/session'
import { NAV } from './links'

const QUICK_LABELS = ['AI Studio', 'Adaptation', 'Calendar', 'Automations', 'Analytics', 'Documentation']
const QUICK = NAV.flatMap((n) => n.menu?.groups.flatMap((g) => g.items) ?? []).filter((i) => QUICK_LABELS.includes(i.label))

/**
 * Full-screen menu below lg. It opens as a circle growing out of the menu button,
 * and closes back into it.
 */
export function MobileMenu({
  open,
  onClose,
  origin,
}: {
  open: boolean
  onClose: () => void
  origin: RefObject<HTMLElement | null>
}) {
  const lenis = useLenis()
  const { user } = useSession()

  // Lenis ignores scrollTo while stopped, so restart it before jumping.
  const go = (e: MouseEvent<HTMLAnchorElement>, href: string) => {
    e.preventDefault()
    onClose()
    if (lenis) {
      lenis.start()
      lenis.scrollTo(href, { offset: -80 })
    } else {
      document.querySelector(href)?.scrollIntoView()
    }
  }

  const r = origin.current?.getBoundingClientRect()
  const cx = r ? r.left + r.width / 2 : window.innerWidth - 40
  const cy = r ? r.top + r.height / 2 : 32
  const radius = Math.hypot(Math.max(cx, window.innerWidth - cx), Math.max(cy, window.innerHeight - cy))

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="mobile-menu"
          className="fixed inset-0 z-90 flex flex-col overflow-y-auto bg-ink-2 px-5 pb-6 pt-24 lg:hidden"
          initial={{ clipPath: `circle(0px at ${cx}px ${cy}px)` }}
          animate={{ clipPath: `circle(${radius}px at ${cx}px ${cy}px)` }}
          exit={{ clipPath: `circle(0px at ${cx}px ${cy}px)` }}
          transition={{ duration: 0.85, ease: easeInOut }}
          data-lenis-prevent
        >
          <motion.p
            className="flex items-center justify-between font-mono text-[11px] uppercase tracking-[0.18em] text-dim"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.35, duration: 0.6 }}
          >
            <span>(Menu)</span>
            <span>0{NAV.length} sections</span>
          </motion.p>

          <ul className="mt-5">
            {NAV.map((l, i) => (
              <li key={l.label} className="relative overflow-hidden">
                <motion.a
                  href={l.href}
                  onClick={(e) => go(e, l.href)}
                  className="group flex items-center justify-between py-3 text-[clamp(2.6rem,12vw,4.5rem)] font-medium leading-[1.05] tracking-[-0.045em]"
                  initial={{ y: '105%', rotate: 4 }}
                  animate={{ y: '0%', rotate: 0 }}
                  transition={{ duration: 0.9, ease, delay: 0.28 + i * 0.06 }}
                  style={{ transformOrigin: '0% 100%' }}
                >
                  <span className="flex items-baseline gap-4">
                    <span className="w-6 font-mono text-[11px] tracking-normal text-dim">0{i + 1}</span>
                    <span className="transition-transform duration-500 ease-expo group-active:translate-x-2">{l.label}</span>
                  </span>
                  <ArrowUpRight className="size-6 text-dim transition-[rotate,color] duration-500 ease-expo group-active:rotate-45 group-active:text-fg" strokeWidth={1.5} />
                </motion.a>
                <motion.span
                  aria-hidden
                  className="absolute inset-x-0 bottom-0 h-px origin-left bg-line"
                  initial={{ scaleX: 0 }}
                  animate={{ scaleX: 1 }}
                  transition={{ duration: 1.1, ease, delay: 0.35 + i * 0.06 }}
                />
              </li>
            ))}
          </ul>

          <motion.div
            className="mt-8 grid grid-cols-2 gap-x-6 gap-y-2.5"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease, delay: 0.62 }}
          >
            {QUICK.map((q) => {
              const Icon = q.icon
              return (
                <a
                  key={q.label}
                  href={q.href}
                  onClick={(e) => go(e, q.href)}
                  className="flex items-center gap-2.5 text-[14px] text-muted transition-colors active:text-fg"
                >
                  <Icon className="size-3.5 text-dim" strokeWidth={1.75} />
                  {q.label}
                </a>
              )
            })}
          </motion.div>

          <motion.div
            className="mt-auto grid grid-cols-2 gap-2.5 pt-10"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease, delay: 0.7 }}
          >
            {user ? (
              <Link
                to="/dashboard"
                onClick={onClose}
                className="col-span-2 grid h-12 place-items-center rounded-full bg-fg text-[14px] font-medium text-ink"
              >
                Open Studio
              </Link>
            ) : (
              <>
                <Link
                  to="/login"
                  onClick={onClose}
                  className="grid h-12 place-items-center rounded-full border border-line-2 text-[14px] font-medium"
                >
                  Log in
                </Link>
                <Link
                  to="/signup"
                  onClick={onClose}
                  className="grid h-12 place-items-center rounded-full bg-fg text-[14px] font-medium text-ink"
                >
                  Start creating
                </Link>
              </>
            )}
          </motion.div>

          <MenuFooter />
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function MenuFooter() {
  const now = useClock()
  return (
    <motion.div
      className="mt-6 flex items-center justify-between font-mono text-[10.5px] uppercase tracking-[0.16em] text-dim"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.6, delay: 0.85 }}
    >
      <span>Create once. Publish everywhere.</span>
      <span className="tabular-nums">{formatTime(now)}</span>
    </motion.div>
  )
}
