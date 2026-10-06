import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useMotionValueEvent, useReducedMotion, useScroll } from 'framer-motion'
import { Heart, MessageCircle, Music2, Play, Repeat2, Send, ThumbsUp } from 'lucide-react'
import { useMediaQuery } from '../lib/useMediaQuery'
import { GenArt } from './ui/GenArt'
import { PLATFORMS, PlatformIcon, type PlatformId } from './ui/PlatformIcon'
import { LineReveal, Reveal, Serif } from './ui/Reveal'
import { Caption, SectionLabel } from './ui/Section'

const LEFT: PlatformId[] = ['linkedin', 'instagram', 'x']
const RIGHT: PlatformId[] = ['tiktok', 'facebook', 'youtube']

/** Position of `el` inside `root`, from layout offsets — immune to any transform animating on the way in. */
function offsetWithin(el: HTMLElement, root: HTMLElement) {
  let x = 0
  let y = 0
  let node: HTMLElement | null = el
  while (node && node !== root) {
    x += node.offsetLeft
    y += node.offsetTop
    node = node.offsetParent as HTMLElement | null
  }
  return { x, y, w: el.offsetWidth, h: el.offsetHeight }
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n))

/*
 * On wide screens the six previews start stacked behind the source post and are dealt out to their places
 * as the source scrolls up the page; each connector draws in as its card lands, then carries a pulse.
 * Phones and reduced motion get the finished layout.
 */
export function MultiPlatform() {
  const wrapRef = useRef<HTMLDivElement>(null)
  const centerRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<Array<HTMLDivElement | null>>([])
  const pathRefs = useRef<Array<SVGPathElement | null>>([])
  const dotRefs = useRef<Array<SVGGElement | null>>([])
  const offsets = useRef<Array<{ x: number; y: number }>>([])
  const [paths, setPaths] = useState<string[]>([])
  const [size, setSize] = useState({ w: 0, h: 0 })
  const wide = useMediaQuery('(min-width: 1024px)')
  const reduce = useReducedMotion()
  const deal = wide && !reduce

  const { scrollYProgress } = useScroll({ target: centerRef, offset: ['center 1', 'center 0.32'] })

  const apply = useCallback(
    (p: number) => {
      itemRefs.current.forEach((el, i) => {
        if (!el) return
        const o = offsets.current[i]
        const path = pathRefs.current[i]
        const dot = dotRefs.current[i]
        if (!deal || !o) {
          el.style.transform = ''
          el.style.opacity = ''
          if (path) path.style.strokeDashoffset = '0'
          if (dot) dot.style.opacity = reduce ? '0' : '1'
          return
        }
        const left = i < LEFT.length
        // Middle row first, then the top and bottom; the right-hand side a beat behind the left.
        const start = [0.07, 0, 0.13][i % 3] + (left ? 0 : 0.06)
        const t = clamp01((p - start) / 0.62)
        const e = 1 - Math.pow(1 - t, 3)
        const k = 1 - e
        el.style.transform = `translate3d(${o.x * k}px, ${o.y * k}px, 0) scale(${0.45 + 0.55 * e}) rotate(${(left ? 9 : -9) * k}deg)`
        el.style.opacity = String(clamp01(t * 3.5))
        if (path) path.style.strokeDashoffset = String(1 - clamp01((t - 0.3) / 0.7))
        if (dot) dot.style.opacity = t >= 1 ? '1' : '0'
      })
    },
    [deal, reduce],
  )

  useMotionValueEvent(scrollYProgress, 'change', apply)

  useLayoutEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    const compute = () => {
      const center = centerRef.current
      if (!center || getComputedStyle(center).display === 'none') return
      const c = offsetWithin(center, wrap)
      const cx = c.x + c.w / 2
      const cy = c.y + c.h / 2
      setSize({ w: wrap.offsetWidth, h: wrap.offsetHeight })
      const boxes = itemRefs.current.map((el) => (el ? offsetWithin(el, wrap) : null))
      offsets.current = boxes.map((r) => (r ? { x: cx - (r.x + r.w / 2), y: cy - (r.y + r.h / 2) } : { x: 0, y: 0 }))
      setPaths(
        boxes.map((r, i) => {
          if (!r) return ''
          const left = i < LEFT.length
          const sx = left ? c.x : c.x + c.w
          const sy = c.y + c.h / 2
          const ex = left ? r.x + r.w : r.x
          const ey = r.y + r.h / 2
          const mx = (sx + ex) / 2
          return `M ${sx} ${sy} C ${mx} ${sy}, ${mx} ${ey}, ${ex} ${ey}`
        }),
      )
      apply(scrollYProgress.get())
    }
    compute()
    const ro = new ResizeObserver(compute)
    ro.observe(wrap)
    return () => ro.disconnect()
  }, [apply, scrollYProgress])

  // Paths mount after the first measure; give them their starting state straight away.
  useLayoutEffect(() => apply(scrollYProgress.get()), [paths, apply, scrollYProgress])

  const card = (id: PlatformId, i: number) => {
    const inner = (
      <div ref={(el) => void (itemRefs.current[i] = el)} className="relative will-change-transform">
        <Preview id={id} />
      </div>
    )
    return deal ? (
      <div key={id}>{inner}</div>
    ) : (
      <Reveal key={id} delay={0.3 + (i % 3) * 0.1} y={20}>
        {inner}
      </Reveal>
    )
  }

  return (
    <section id="platforms" className="relative overflow-hidden py-28 md:py-40">
      <div className="container-x">
        <div className="flex flex-col items-center text-center">
          <SectionLabel index="06" thread={false}>
            Distribution
          </SectionLabel>
          <LineReveal
            className="mt-10 text-[clamp(3rem,9vw,9.5rem)] font-medium leading-[0.86] tracking-[-0.06em]"
            lines={['One post.', <Serif>Every platform.</Serif>]}
          />
          <Reveal delay={0.15} className="mt-8 max-w-md text-[17px] leading-snug text-muted">
            Adapt and publish content across your connected social channels without manually switching between apps.
          </Reveal>
        </div>

        <div
          ref={wrapRef}
          data-thread="rail"
          className="relative mt-16 grid gap-4 md:mt-24 lg:grid-cols-[1fr_minmax(0,340px)_1fr] lg:items-center lg:gap-x-20"
        >
          {paths.length > 0 && (
            <svg
              aria-hidden
              className="pointer-events-none absolute left-0 top-0 hidden lg:block"
              width={size.w}
              height={size.h}
              fill="none"
            >
              {paths.map((d, i) => (
                <g key={i}>
                  <path
                    ref={(el) => void (pathRefs.current[i] = el)}
                    d={d}
                    stroke="rgb(255 255 255 / 0.16)"
                    strokeWidth={1}
                    pathLength={1}
                    strokeDasharray="1 1"
                  />
                  <g ref={(el) => void (dotRefs.current[i] = el)} className="transition-opacity duration-500">
                    <circle r={2.5} className="fill-accent-soft">
                      <animateMotion dur="2.6s" begin={`${0.4 + i * 0.35}s`} repeatCount="indefinite" path={d} />
                    </circle>
                  </g>
                </g>
              ))}
            </svg>
          )}

          <div className="order-2 grid gap-4 sm:grid-cols-2 lg:order-1 lg:grid-cols-1 lg:gap-6">
            {LEFT.map((id, i) => card(id, i))}
          </div>

          <Reveal className="relative z-10 order-1 lg:order-2" y={30}>
            <div ref={centerRef} className="relative rounded-xl border border-white/20 bg-card p-4 shadow-[0_40px_100px_-30px_color-mix(in_oklab,var(--color-accent)_35%,transparent)]">
              <div className="flex items-center justify-between">
                <span className="rounded-full bg-fg px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-ink">
                  Source
                </span>
                <span className="font-mono text-[10px] text-dim">→ 6 destinations</span>
              </div>
              <GenArt variant="product" className="mt-4 aspect-[4/3] rounded-md" />
              <p className="mt-4 text-[15px] font-medium leading-snug tracking-[-0.01em]">Introducing our new product…</p>
              <p className="mt-1.5 text-[13px] leading-snug text-muted">
                Tempo turns your notes, tasks and meetings into one clear plan for the day. Early access opens Monday.
              </p>
            </div>
          </Reveal>

          <div className="order-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-1 lg:gap-6">
            {RIGHT.map((id, i) => card(id, i + LEFT.length))}
          </div>
        </div>

        <Caption fig="06" className="mt-12">
          Same source, six outputs. Each preview is shaped for where it’s going.
        </Caption>
      </div>
    </section>
  )
}

function Shell({ id, format, children }: { id: PlatformId; format: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-ink-2 p-3.5 transition-colors duration-500 hover:border-line-2">
      <div className="mb-3 flex items-center gap-2 text-[12px]">
        <PlatformIcon id={id} className="size-3.5" />
        <span className="font-medium">{PLATFORMS[id].name}</span>
        <span className="ml-auto font-mono text-[10px] text-dim">{format}</span>
      </div>
      {children}
    </div>
  )
}

function Author() {
  return (
    <div className="flex items-center gap-2">
      <span className="grid size-6 place-items-center rounded-full bg-[#e6e0d4] text-[9px] font-semibold text-ink">T</span>
      <div className="leading-tight">
        <p className="text-[11.5px] font-medium">Tempo</p>
        <p className="text-[10px] text-dim">Sponsored · now</p>
      </div>
    </div>
  )
}

function Preview({ id }: { id: PlatformId }) {
  switch (id) {
    case 'linkedin':
      return (
        <Shell id={id} format="Long-form">
          <Author />
          <p className="mt-2.5 line-clamp-3 text-[12px] leading-snug text-fg/85">
            We spent 14 months on one question: why does planning your day take so much of it? Today we’re introducing
            Tempo…
          </p>
          <GenArt variant="product" className="mt-2.5 aspect-[1.91/1] rounded" />
        </Shell>
      )
    case 'instagram':
      return (
        <Shell id={id} format="4:5 + caption">
          <div className="flex gap-3">
            <GenArt variant="dune" className="aspect-[4/5] w-[42%] shrink-0 rounded" />
            <div className="flex min-w-0 flex-col">
              <div className="flex gap-2.5 text-muted">
                <Heart className="size-3.5" />
                <MessageCircle className="size-3.5" />
                <Send className="size-3.5" />
              </div>
              <p className="mt-2 line-clamp-3 text-[11.5px] leading-snug text-fg/85">
                Monday, but make it organized ☕️ Early access — link in bio.
              </p>
              <p className="mt-auto text-[11px] leading-snug text-accent-soft">#productivity #planning</p>
            </div>
          </div>
        </Shell>
      )
    case 'x':
      return (
        <Shell id={id} format="Short">
          <p className="text-[12.5px] leading-snug text-fg/90">
            Notes, tasks, meetings → one plan for your day. Tempo is live Monday.
          </p>
          <div className="mt-3 flex gap-6 text-dim">
            <MessageCircle className="size-3.5" />
            <Repeat2 className="size-3.5" />
            <Heart className="size-3.5" />
          </div>
        </Shell>
      )
    case 'tiktok':
      return (
        <Shell id={id} format="9:16 video">
          <div className="flex gap-3">
            <GenArt variant="sun" className="aspect-[9/16] w-[34%] shrink-0 rounded">
              <p className="absolute inset-x-1.5 top-1/2 -translate-y-1/2 text-center text-[9px] font-bold leading-tight text-white">
                I stopped planning my day.
              </p>
            </GenArt>
            <div className="flex min-w-0 flex-col text-[11.5px] leading-snug">
              <p className="font-mono text-[10px] text-dim">Hook · 0:00–0:02</p>
              <p className="mt-1 text-fg/85">“I stopped planning my day. Here’s why.”</p>
              <p className="mt-auto flex items-center gap-1.5 text-[10.5px] text-dim">
                <Music2 className="size-3" /> original sound
              </p>
            </div>
          </div>
        </Shell>
      )
    case 'facebook':
      return (
        <Shell id={id} format="Link post">
          <p className="text-[12px] leading-snug text-fg/85">Big news for anyone who plans their day in five different apps.</p>
          <div className="mt-2.5 overflow-hidden rounded border border-line">
            <GenArt variant="orb" className="aspect-[2.4/1]" />
            <p className="px-2.5 py-1.5 text-[11px] font-medium">tempo.app — Early access</p>
          </div>
          <div className="mt-2.5 flex gap-5 text-dim">
            <ThumbsUp className="size-3.5" />
            <MessageCircle className="size-3.5" />
          </div>
        </Shell>
      )
    case 'youtube':
      return (
        <Shell id={id} format="16:9 video">
          <GenArt variant="topo" className="aspect-video rounded">
            <span className="absolute inset-0 grid place-items-center">
              <span className="grid h-6 w-9 place-items-center rounded-md bg-black/60">
                <Play className="size-3 fill-white text-white" />
              </span>
            </span>
            <span className="absolute bottom-1.5 right-1.5 rounded bg-black/70 px-1 font-mono text-[9.5px] text-white">
              0:42
            </span>
          </GenArt>
          <p className="mt-2 text-[12px] font-medium leading-snug">How Tempo plans your day in the time it takes to make coffee</p>
        </Shell>
      )
    default:
      return null
  }
}
