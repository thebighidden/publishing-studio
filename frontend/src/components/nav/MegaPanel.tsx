import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion, type Variants } from 'framer-motion'
import { ArrowRight, ArrowUpRight } from 'lucide-react'
import { ease } from '../../lib/motion'
import { cn } from '../../lib/cn'
import { GenArt } from '../ui/GenArt'
import { Serif } from '../ui/Reveal'
import { NAV, type Menu, type MenuItem } from './links'

// Moving right along the nav pushes the old menu out to the left, and vice versa.
const slide: Variants = {
  enter: (dir: number) => ({ x: dir * 72, opacity: 0, filter: 'blur(4px)' }),
  center: { x: 0, opacity: 1, filter: 'blur(0px)' },
  exit: (dir: number) => ({ x: dir * -72, opacity: 0, filter: 'blur(4px)' }),
}

/**
 * The dropdown half of the nav surface. It grows out of the bar itself, so bar and panel
 * read as one sheet. Height follows whatever menu is showing; content slides between menus.
 */
export function MegaPanel({
  active,
  scrolled,
  onNavigate,
}: {
  active: number | null
  /** Matches the bar's horizontal padding, which tightens once the sheet floats. */
  scrolled: boolean
  onNavigate: () => void
}) {
  const [shown, setShown] = useState<number | null>(null)
  const [dir, setDir] = useState(0)
  const inner = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState(0)
  const open = active !== null

  // Track the previous menu during render so the first frame of the new one already knows its direction.
  if (active !== null && active !== shown) {
    setDir(shown === null ? 0 : Math.sign(active - shown))
    setShown(active)
  }

  useLayoutEffect(() => {
    const el = inner.current
    if (!el) return
    const ro = new ResizeObserver(() => setHeight(el.offsetHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const entry = shown !== null ? NAV[shown] : null

  return (
    <motion.div
      id="nav-panel"
      initial={false}
      animate={{ height: open ? height : 0 }}
      transition={{ duration: 0.65, ease }}
      // Once folded away, drop the content so the stagger replays on the next open.
      onAnimationComplete={() => !open && setShown(null)}
      className="hidden overflow-hidden lg:block"
      inert={!open}
    >
      <div ref={inner} className="relative">
        <AnimatePresence mode="popLayout" initial={false} custom={dir}>
          {entry?.menu && (
            <motion.div
              key={entry.label}
              custom={dir}
              variants={slide}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.55, ease }}
            >
              <PanelContent
                label={entry.label}
                href={entry.href}
                menu={entry.menu}
                inset={scrolled ? 'px-5' : 'px-8 xl:px-12'}
                onNavigate={onNavigate}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  )
}

function Stagger({ i, children, className }: { i: number; children: ReactNode; className?: string }) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.7, ease, delay: 0.08 + i * 0.035 }}
    >
      {children}
    </motion.div>
  )
}

function PanelContent({
  label,
  href,
  menu,
  inset,
  onNavigate,
}: {
  label: string
  href: string
  menu: Menu
  inset: string
  onNavigate: () => void
}) {
  let n = 1
  return (
    <div className={cn('grid grid-cols-12 gap-6 border-t border-line pb-5 pt-6', inset)}>
      <div className="col-span-3 flex flex-col justify-between gap-8">
        <Stagger i={0}>
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-dim">({label})</p>
          <p className="mt-4 text-[28px] font-medium leading-[1.02] tracking-[-0.04em] xl:text-[32px]">
            {menu.intro[0]}
            <br />
            <Serif>{menu.intro[1]}</Serif>
          </p>
        </Stagger>
        <Stagger i={1}>
          <a href={href} onClick={onNavigate} className="group inline-flex items-center gap-2 text-[13.5px] text-fg">
            <span className="relative">
              Explore {label.toLowerCase()}
              <span className="absolute -bottom-0.5 left-0 h-px w-full origin-right scale-x-0 bg-current transition-transform duration-500 ease-expo group-hover:origin-left group-hover:scale-x-100" />
            </span>
            <ArrowRight className="size-3.5 transition-transform duration-500 ease-expo group-hover:translate-x-1" strokeWidth={1.75} />
          </a>
        </Stagger>
      </div>

      <div className="col-span-6 grid grid-cols-2 gap-x-6 xl:col-span-5">
        {menu.groups.map((g) => (
          <div key={g.title}>
            <Stagger i={n++}>
              <p className="flex items-center gap-3 font-mono text-[10.5px] uppercase tracking-[0.18em] text-dim">
                {g.title}
                <span className="h-px flex-1 bg-line" />
              </p>
            </Stagger>
            <ul className="mt-3 space-y-0.5">
              {g.items.map((item) => (
                <li key={item.label}>
                  <Stagger i={n++}>
                    <PanelLink item={item} onNavigate={onNavigate} />
                  </Stagger>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <Stagger i={n} className="col-span-3 xl:col-span-4">
        <a
          href={menu.feature.href}
          onClick={onNavigate}
          data-cursor="View"
          className="group/feat relative block h-full min-h-[230px] overflow-hidden rounded-2xl border border-line"
        >
          <div className="absolute inset-0 transition-transform duration-[1400ms] ease-expo group-hover/feat:scale-[1.07]">
            <GenArt variant={menu.feature.art} className="h-full w-full" />
          </div>
          <div className="absolute inset-0 bg-linear-to-t from-black/80 via-black/10 to-transparent" />
          <span className="absolute left-3 top-3 rounded-full border border-white/25 bg-black/30 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-white/90 backdrop-blur">
            {menu.feature.tag}
          </span>
          <span className="absolute right-3 top-3 grid size-8 scale-50 place-items-center rounded-full bg-fg text-ink opacity-0 transition-[scale,opacity] duration-500 ease-expo group-hover/feat:scale-100 group-hover/feat:opacity-100">
            <ArrowUpRight className="size-4" strokeWidth={1.75} />
          </span>
          <p className="absolute inset-x-4 bottom-4 max-w-[22ch] text-[18px] font-medium leading-tight tracking-[-0.025em] text-white">
            {menu.feature.title}
          </p>
        </a>
      </Stagger>
    </div>
  )
}

function PanelLink({ item, onNavigate }: { item: MenuItem; onNavigate: () => void }) {
  const Icon = item.icon
  return (
    <a
      href={item.href}
      onClick={onNavigate}
      className="group/item -mx-2.5 flex items-start gap-3 rounded-xl p-2.5 transition-colors duration-300 hover:bg-white/[0.04]"
    >
      <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-line-2 text-muted transition-[background-color,color,border-color] duration-500 ease-expo group-hover/item:border-fg group-hover/item:bg-fg group-hover/item:text-ink">
        <Icon className="size-4 transition-transform duration-500 ease-expo group-hover/item:scale-110" strokeWidth={1.6} />
      </span>
      <span className="min-w-0">
        <span className="flex items-center gap-1 text-[14px] text-fg">
          <span className="transition-transform duration-500 ease-expo group-hover/item:translate-x-0.5">{item.label}</span>
          <ArrowUpRight
            className="size-3.5 -translate-x-1 translate-y-0.5 text-muted opacity-0 transition-[translate,opacity] duration-500 ease-expo group-hover/item:translate-x-0.5 group-hover/item:translate-y-0 group-hover/item:opacity-100"
            strokeWidth={1.75}
          />
        </span>
        <span className="mt-0.5 block text-[12.5px] leading-snug text-dim">{item.desc}</span>
      </span>
    </a>
  )
}
