import { useEffect, useRef, useState, type Ref } from 'react'
import { AnimatePresence, motion, useMotionValueEvent, useScroll, useSpring } from 'framer-motion'
import { ChevronDown } from 'lucide-react'
import { useLenis } from 'lenis/react'
import { ease } from '../lib/motion'
import { cn } from '../lib/cn'
import { useReady } from '../lib/ready'
import { Link } from '../lib/router'
import { useSession } from '../lib/session'
import { MegaPanel } from './nav/MegaPanel'
import { MobileMenu } from './nav/MobileMenu'
import { NAV } from './nav/links'
import { Button, RollChars } from './ui/Button'
import { Logo } from './ui/Logo'

/*
 * At the top of the page the bar is a transparent, full-bleed strip. Once the page moves
 * it draws itself in to a floating sheet; hovering a menu item unrolls that same sheet into
 * a mega panel, so bar and dropdown are always one surface.
 */
export function Navbar() {
  const ready = useReady()
  const lenis = useLenis()
  const { user } = useSession()
  const { scrollY, scrollYProgress } = useScroll()
  const progress = useSpring(scrollYProgress, { stiffness: 200, damping: 40, restDelta: 0.001 })

  const [scrolled, setScrolled] = useState(false)
  const [hidden, setHidden] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [active, setActive] = useState<number | null>(null)
  const [hovered, setHovered] = useState<number | null>(null)
  const openTimer = useRef(0)
  const closeTimer = useRef(0)
  const menuButton = useRef<HTMLButtonElement>(null)

  useMotionValueEvent(scrollY, 'change', (y) => {
    const prev = scrollY.getPrevious() ?? 0
    setScrolled(y > 24)
    // Get out of the way while reading down; come back as soon as the reader scrolls up.
    const down = y > 640 && y > prev + 2
    setHidden(down)
    if (down) setActive(null)
  })

  // Only take the scroll away while the menu is open, and always hand it back,
  // including when the page unmounts underneath an open menu.
  useEffect(() => {
    if (!lenis || !mobileOpen) return
    lenis.stop()
    return () => lenis.start()
  }, [mobileOpen, lenis])

  useEffect(() => {
    if (active === null && !mobileOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setActive(null)
      setMobileOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, mobileOpen])

  useEffect(
    () => () => {
      window.clearTimeout(openTimer.current)
      window.clearTimeout(closeTimer.current)
    },
    [],
  )

  // A short intent delay on the first open stops the panel flashing when the pointer
  // merely sweeps across the bar. Moving between menus once one is open is instant.
  const hover = (i: number) => {
    window.clearTimeout(closeTimer.current)
    window.clearTimeout(openTimer.current)
    setHovered(i)
    const next = NAV[i].menu ? i : null
    if (active !== null || next === null) setActive(next)
    else openTimer.current = window.setTimeout(() => setActive(next), 90)
  }

  const scheduleClose = () => {
    window.clearTimeout(openTimer.current)
    window.clearTimeout(closeTimer.current)
    closeTimer.current = window.setTimeout(() => setActive(null), 200)
  }

  const solid = scrolled || active !== null || mobileOpen
  const shown = !hidden || active !== null || mobileOpen
  const pill = hovered ?? active

  return (
    <>
      <AnimatePresence>
        {active !== null && (
          <motion.div
            key="scrim"
            aria-hidden
            className="fixed inset-0 z-95 hidden bg-ink/60 lg:block"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5, ease }}
          />
        )}
      </AnimatePresence>

      <motion.header
        initial={{ y: -100, opacity: 0 }}
        animate={ready ? { y: shown ? 0 : -110, opacity: 1 } : undefined}
        transition={{ duration: 0.8, ease }}
        className="fixed inset-x-0 top-0 z-100"
      >
        <div className={cn('transition-[padding] duration-700 ease-expo', scrolled ? 'px-2.5 pt-2.5 md:px-4 md:pt-3' : 'px-0 pt-0')}>
          <div
            onPointerEnter={() => window.clearTimeout(closeTimer.current)}
            onPointerLeave={scheduleClose}
            className={cn(
              'relative mx-auto overflow-hidden border transition-[max-width,border-radius,background-color,border-color,box-shadow] duration-700 ease-expo',
              scrolled ? 'max-w-[1180px] rounded-[20px]' : 'max-w-[1440px] rounded-none',
              solid
                ? 'border-line bg-[#0a0a0b]/80 shadow-[0_30px_80px_-30px_rgb(0_0_0_/_0.9)] backdrop-blur-xl backdrop-saturate-150'
                : 'border-transparent bg-transparent',
            )}
          >
            <nav
              className={cn(
                'flex h-16 items-center justify-between gap-6 transition-[padding] duration-700 ease-expo',
                scrolled ? 'pl-4 pr-2.5 md:pl-5' : 'px-5 md:px-8 xl:px-12',
              )}
            >
              <Logo />

              <ul className="hidden items-center lg:flex" onPointerLeave={() => setHovered(null)}>
                {NAV.map((item, i) => {
                  const isOpen = active === i
                  const content = (
                    <>
                      {pill === i && (
                        <motion.span
                          layoutId="nav-pill"
                          className="absolute inset-0 -z-10 rounded-full bg-white/[0.07]"
                          transition={{ type: 'spring', stiffness: 420, damping: 36 }}
                        />
                      )}
                      <RollChars>{item.label}</RollChars>
                      {item.menu && (
                        <ChevronDown
                          className={cn('size-3.5 transition-transform duration-500 ease-expo', isOpen && 'rotate-180')}
                          strokeWidth={1.75}
                        />
                      )}
                    </>
                  )
                  const cls = cn(
                    'group relative isolate flex h-9 items-center gap-1 rounded-full px-3.5 text-[13.5px] transition-colors duration-300',
                    isOpen || hovered === i ? 'text-fg' : 'text-muted',
                  )
                  return (
                    <li key={item.label} onPointerEnter={() => hover(i)}>
                      {item.menu ? (
                        <button
                          type="button"
                          aria-expanded={isOpen}
                          aria-controls="nav-panel"
                          onClick={() => setActive(isOpen ? null : i)}
                          className={cls}
                        >
                          {content}
                        </button>
                      ) : (
                        <a href={item.href} className={cls}>
                          {content}
                        </a>
                      )}
                    </li>
                  )
                })}
              </ul>

              <div className="flex items-center gap-1.5">
                {!user && (
                  <Link
                    to="/login"
                    className="group relative hidden h-9 items-center px-3 text-[13.5px] text-muted transition-colors duration-300 hover:text-fg sm:flex"
                  >
                    <RollChars>Log in</RollChars>
                  </Link>
                )}
                <Button href={user ? '/dashboard' : '/signup'} size="sm" arrow className="max-sm:px-3.5">
                  {user ? 'Open Studio' : 'Start Creating'}
                </Button>
                <MenuButton ref={menuButton} open={mobileOpen} onClick={() => setMobileOpen((o) => !o)} />
              </div>
            </nav>

            <MegaPanel active={active} scrolled={scrolled} onNavigate={() => setActive(null)} />

            {/* Reading progress, drawn along the bottom edge of the sheet. */}
            <motion.div
              aria-hidden
              style={{ scaleX: progress }}
              className={cn(
                'absolute inset-x-0 bottom-0 h-px origin-left bg-linear-to-r from-accent/0 via-accent-soft to-fg transition-opacity duration-700',
                scrolled ? 'opacity-100' : 'opacity-0',
              )}
            />
          </div>
        </div>
      </motion.header>

      <MobileMenu open={mobileOpen} onClose={() => setMobileOpen(false)} origin={menuButton} />
    </>
  )
}

function MenuButton({
  open,
  onClick,
  ref,
}: {
  open: boolean
  onClick: () => void
  ref: Ref<HTMLButtonElement>
}) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={open ? 'Close menu' : 'Open menu'}
      aria-expanded={open}
      onClick={onClick}
      className="group relative flex h-9 items-center gap-2.5 rounded-full border border-line-2 pl-3.5 pr-3 transition-colors duration-300 hover:border-white/30 lg:hidden"
    >
      <span className="relative block h-[14px] overflow-hidden font-mono text-[10.5px] uppercase leading-[14px] tracking-[0.14em]">
        <motion.span
          className="block"
          animate={{ y: open ? '-50%' : '0%' }}
          transition={{ duration: 0.6, ease }}
        >
          <span className="block">Menu</span>
          <span className="block">Close</span>
        </motion.span>
      </span>
      <span className="relative block size-3">
        <span
          className={cn(
            'absolute left-0 top-1/2 h-px w-3 bg-fg transition-transform duration-500 ease-expo',
            open ? 'rotate-45' : '-translate-y-[3px]',
          )}
        />
        <span
          className={cn(
            'absolute left-0 top-1/2 h-px w-3 bg-fg transition-transform duration-500 ease-expo',
            open ? '-rotate-45' : 'translate-y-[3px]',
          )}
        />
      </span>
    </button>
  )
}
