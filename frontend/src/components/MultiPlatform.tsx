import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { motion, useInView } from 'framer-motion'
import { Heart, MessageCircle, Music2, Play, Repeat2, Send, ThumbsUp } from 'lucide-react'
import { ease } from '../lib/motion'
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

export function MultiPlatform() {
  const wrapRef = useRef<HTMLDivElement>(null)
  const centerRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<Array<HTMLDivElement | null>>([])
  const [paths, setPaths] = useState<string[]>([])
  const [size, setSize] = useState({ w: 0, h: 0 })
  const inView = useInView(wrapRef, { once: true, margin: '0px 0px -25% 0px' })

  useLayoutEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    const compute = () => {
      const center = centerRef.current
      if (!center || getComputedStyle(center).display === 'none') return
      const c = offsetWithin(center, wrap)
      setSize({ w: wrap.offsetWidth, h: wrap.offsetHeight })
      setPaths(
        itemRefs.current.map((el, i) => {
          if (!el) return ''
          const r = offsetWithin(el, wrap)
          const left = i < LEFT.length
          const sx = left ? c.x : c.x + c.w
          const sy = c.y + c.h / 2
          const ex = left ? r.x + r.w : r.x
          const ey = r.y + r.h / 2
          const mx = (sx + ex) / 2
          return `M ${sx} ${sy} C ${mx} ${sy}, ${mx} ${ey}, ${ex} ${ey}`
        }),
      )
    }
    compute()
    const ro = new ResizeObserver(compute)
    ro.observe(wrap)
    return () => ro.disconnect()
  }, [])

  const card = (id: PlatformId, i: number) => (
    <Reveal key={id} delay={0.3 + (i % 3) * 0.1} y={20}>
      <div ref={(el) => void (itemRefs.current[i] = el)}>
        <Preview id={id} />
      </div>
    </Reveal>
  )

  return (
    <section id="platforms" className="relative overflow-hidden py-28 md:py-40">
      <div className="container-x">
        <div className="grid gap-8 lg:grid-cols-12 lg:items-end">
          <div className="lg:col-span-7">
            <SectionLabel index="06">Distribution</SectionLabel>
            <LineReveal
              className="mt-10 text-[clamp(2.8rem,7vw,7.5rem)] font-medium leading-[0.9] tracking-[-0.05em]"
              lines={['One post.', <Serif data-thread="circle">Every platform.</Serif>]}
            />
          </div>
          <Reveal delay={0.15} className="max-w-sm text-[17px] leading-snug text-muted lg:col-span-4 lg:col-start-9">
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
                  <motion.path
                    d={d}
                    stroke="rgb(255 255 255 / 0.16)"
                    strokeWidth={1}
                    initial={{ pathLength: 0 }}
                    animate={{ pathLength: inView ? 1 : 0 }}
                    transition={{ duration: 1.3, ease, delay: 0.2 + i * 0.07 }}
                  />
                  {inView && (
                    <circle r={2.5} className="fill-accent-soft">
                      <animateMotion dur="2.6s" begin={`${1.4 + i * 0.35}s`} repeatCount="indefinite" path={d} />
                    </circle>
                  )}
                </g>
              ))}
            </svg>
          )}

          <div className="order-2 grid gap-4 sm:grid-cols-2 lg:order-1 lg:grid-cols-1 lg:gap-6">
            {LEFT.map((id, i) => card(id, i))}
          </div>

          <Reveal className="order-1 lg:order-2" y={30}>
            <div ref={centerRef} className="relative rounded-xl border border-white/20 bg-card p-4 shadow-[0_40px_100px_-30px_rgb(99_102_241_/_0.35)]">
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
