import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import {
  animate,
  motion,
  useInView,
  useMotionValue,
  useMotionValueEvent,
  useReducedMotion,
  useScroll,
  type MotionValue,
} from 'framer-motion'
import { ArrowDown, Check, ImageIcon, RotateCw, Sparkles, Upload } from 'lucide-react'
import { ease } from '../lib/motion'
import { cn } from '../lib/cn'
import { useMediaQuery } from '../lib/useMediaQuery'
import { Caret } from './mock/Mock'
import { GenArt } from './ui/GenArt'
import { LogoMark } from './ui/Logo'
import { Plate } from './ui/Plate'
import { PlatformIcon } from './ui/PlatformIcon'
import { LineReveal, Reveal, Serif } from './ui/Reveal'
import { SectionLabel } from './ui/Section'

/*
 * The problem, on paper. Three pains, then the manual way acted out: every step opens another window
 * and they pile up on the desk until the whole heap is swept into one.
 * On wide screens the pile is pinned and driven by the scroll; elsewhere it plays once when it comes into view.
 */

export function Problem() {
  const ref = useRef<HTMLElement>(null)
  return (
    <section ref={ref} id="problem" data-thread-surface="paper" className="relative isolate text-ink">
      <Plate target={ref} className="bg-bone" />

      <div className="container-x pt-28 md:pt-40">
        <SectionLabel index="01" light>
          The problem
        </SectionLabel>
        <LineReveal
          className="mt-10 max-w-[15ch] text-[clamp(2.5rem,8.2vw,9rem)] font-medium leading-[0.88] tracking-[-0.055em]"
          lines={['Content creation', 'shouldn’t feel like a', <Serif data-thread="circle">full-time job.</Serif>]}
        />

        <div data-thread="rail" className="mt-20 grid border-t border-ink/15 md:mt-28 md:grid-cols-3">
          <PainCard index="01" title="Create" body="Coming up with ideas and writing content takes time." delay={0}>
            <BlankDoc />
          </PainCard>
          <PainCard
            index="02"
            title="Adapt"
            body="Every platform requires different formats, captions, dimensions and styles."
            delay={0.1}
          >
            <Formats />
          </PainCard>
          <PainCard
            index="03"
            title="Publish"
            body="Switching between multiple platforms and manually publishing everything becomes repetitive."
            delay={0.2}
          >
            <Tabs />
          </PainCard>
        </div>
      </div>

      <Pile />
    </section>
  )
}

/* ------------------------------------------------------------------ */
/* Three pains                                                          */
/* ------------------------------------------------------------------ */

function PainCard({
  index,
  title,
  body,
  delay,
  children,
}: {
  index: string
  title: string
  body: string
  delay: number
  children: ReactNode
}) {
  return (
    <Reveal
      delay={delay}
      className="group flex min-h-[420px] flex-col border-b border-ink/15 py-8 md:border-b-0 md:border-l md:px-8 md:first:border-l-0 md:first:pl-0 lg:min-h-[480px]"
    >
      <span className="font-mono text-[11px] text-ink/45">{index}</span>
      <div className="grid flex-1 place-items-center py-10">{children}</div>
      <h3 className="text-5xl font-medium tracking-[-0.045em] md:text-6xl">{title}</h3>
      <p className="mt-3 min-h-[4.2em] max-w-[32ch] text-[15px] leading-snug text-ink/60">{body}</p>
    </Reveal>
  )
}

/** Writer's block, rendered as a page with nothing on it. */
function BlankDoc() {
  return (
    <div className="w-[220px] rotate-[-2deg] rounded-md bg-white p-4 shadow-[0_24px_50px_-20px_rgb(40_30_20_/_0.35)] transition-transform duration-700 ease-expo group-hover:rotate-[-5deg]">
      <div className="flex items-center justify-between font-mono text-[10px] text-ink/45">
        <span>untitled-post.txt</span>
        <span>0 words</span>
      </div>
      <p className="mt-5 text-[13px]">
        <Caret className="bg-ink" />
      </p>
      <div className="mt-6 space-y-2">
        <div className="h-1.5 w-full rounded-full bg-ink/[0.06]" />
        <div className="h-1.5 w-4/5 rounded-full bg-ink/[0.06]" />
        <div className="h-1.5 w-3/5 rounded-full bg-ink/[0.06]" />
      </div>
      <p className="mt-6 font-mono text-[10px] text-ink/45">Opened 47 min ago</p>
    </div>
  )
}

const FORMAT_LIST = [
  { label: '1080×1350', w: 64, h: 80 },
  { label: '1080×1920', w: 54, h: 96 },
  { label: '1200×627', w: 120, h: 63 },
  { label: '1280×720', w: 112, h: 63 },
]

/** The same post needs four different frames. */
function Formats() {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref)
  const [active, setActive] = useState(0)
  useEffect(() => {
    if (!inView) return
    const t = window.setInterval(() => setActive((a) => (a + 1) % FORMAT_LIST.length), 1100)
    return () => window.clearInterval(t)
  }, [inView])

  return (
    <div ref={ref} className="flex flex-col items-center gap-6">
      <div className="relative grid h-[110px] w-[150px] place-items-end justify-items-center">
        {FORMAT_LIST.map((f, i) => (
          <div
            key={f.label}
            className={cn(
              'absolute bottom-0 rounded-[3px] border transition-colors duration-500',
              i === active ? 'border-ink bg-ink/[0.06]' : 'border-ink/20',
            )}
            style={{ width: f.w, height: f.h }}
          />
        ))}
      </div>
      <div className="flex gap-3 font-mono text-[10.5px]">
        {FORMAT_LIST.map((f, i) => (
          <span key={f.label} className={cn('transition-colors duration-500', i === active ? 'text-ink' : 'text-ink/35')}>
            {f.label}
          </span>
        ))}
      </div>
    </div>
  )
}

const TAB_NAMES = ['instagram.com', 'linkedin.com', 'x.com', 'tiktok.com', 'facebook.com', 'youtube.com', 'Calendar']

function Tabs() {
  return (
    <div className="relative h-[170px] w-[215px]">
      {TAB_NAMES.map((t, i) => (
        <div
          key={t}
          className="absolute left-0 flex h-[34px] w-[172px] items-start gap-2 rounded-t-md border border-b-0 border-ink/15 bg-white px-3 pt-[5px] text-[11px] leading-[14px] text-ink/60 shadow-[0_-8px_20px_-10px_rgb(40_30_20_/_0.3)] transition-transform duration-700 ease-expo group-hover:translate-x-2"
          style={{ top: i * 20, marginLeft: i * 7, zIndex: i, transitionDelay: `${i * 30}ms` }}
        >
          <span className="mt-1 size-1.5 rounded-full bg-ink/25" />
          {t}
          <span className="ml-auto text-ink/35">×</span>
        </div>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* The pile                                                             */
/* ------------------------------------------------------------------ */

const STEPS = [
  'Think of an idea',
  'Write the content',
  'Generate visuals',
  'Edit everything',
  'Open every platform',
  'Adapt for each one',
  'Publish manually',
  'Repeat',
]

type Win = {
  step: number
  title: string
  /** Centre of the window, as a share of the stage. */
  x: number
  y: number
  rot: number
  w: number
  body: ReactNode
}

const WINDOWS: Win[] = [
  { step: 0, title: 'ideas.txt — Notes', x: 0.24, y: 0.2, rot: -5, w: 290, body: <NotesBody /> },
  { step: 1, title: 'AI chat', x: 0.66, y: 0.17, rot: 4, w: 320, body: <ChatBody /> },
  { step: 2, title: 'Image generator', x: 0.42, y: 0.44, rot: -2, w: 300, body: <ImageGenBody /> },
  { step: 3, title: 'Video editor — launch_v3_FINAL.mp4', x: 0.74, y: 0.5, rot: 5, w: 330, body: <VideoBody /> },
  { step: 4, title: 'instagram.com', x: 0.2, y: 0.62, rot: -8, w: 270, body: <PlatformBody id="instagram" /> },
  { step: 4, title: 'linkedin.com', x: 0.5, y: 0.73, rot: 3, w: 300, body: <PlatformBody id="linkedin" /> },
  { step: 4, title: 'x.com', x: 0.82, y: 0.8, rot: -4, w: 280, body: <PlatformBody id="x" /> },
  { step: 5, title: 'Resize — 4 of 6', x: 0.34, y: 0.3, rot: 7, w: 290, body: <CropBody /> },
  { step: 6, title: 'tiktok.com — Upload', x: 0.62, y: 0.36, rot: -6, w: 280, body: <UploadBody /> },
  { step: 6, title: 'Calendar', x: 0.28, y: 0.84, rot: 5, w: 290, body: <CalendarBody /> },
]

/** Where each beat of the pile falls along its progress (0–1). */
const T = {
  stepStart: 0.05,
  stepEvery: 0.085,
  drop: 0.05,
  repeat: 0.66,
  sweep: [0.76, 0.9] as const,
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n))
const backOut = (t: number) => {
  const c = 1.4
  return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2)
}
const stepAt = (p: number) => {
  let s = -1
  for (let i = 0; i < STEPS.length; i++) if (p >= T.stepStart + i * T.stepEvery) s = i
  return s
}

function Pile() {
  const wide = useMediaQuery('(min-width: 1024px)')
  const reduce = useReducedMotion()
  return wide && !reduce ? <PinnedPile /> : <PlayedPile still={!!reduce} />
}

/** Desktop: the scroll drives the pile while the stage is pinned. */
function PinnedPile() {
  const trackRef = useRef<HTMLDivElement>(null)
  const { scrollYProgress } = useScroll({ target: trackRef, offset: ['start start', 'end end'] })

  return (
    <div ref={trackRef} data-thread="rail" data-side="left" className="relative mt-24 h-[380vh] md:mt-32">
      <div className="sticky top-0 flex h-screen items-center overflow-hidden">
        <div className="container-x grid h-full grid-cols-12 items-center gap-8 py-[10vh]">
          <div className="col-span-5 self-stretch">
            <Story progress={scrollYProgress} />
          </div>
          <div className="relative col-span-7 h-full">
            <Stage progress={scrollYProgress} />
          </div>
        </div>
      </div>
    </div>
  )
}

/** Phones, tablets and reduced motion: the same scene, played once on a timer (or shown finished). */
function PlayedPile({ still }: { still: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { once: true, margin: '0px 0px -25% 0px' })
  const progress = useMotionValue(still ? 1 : 0)

  useEffect(() => {
    if (still || !inView) return
    const controls = animate(progress, 1, { duration: 9, ease: 'linear' })
    return () => controls.stop()
  }, [inView, still, progress])

  return (
    <div ref={ref} data-thread="rail" data-side="left" className="container-x mt-24 pb-28 md:mt-32 md:pb-40">
      <Story progress={progress} compact />
      <div className="relative mx-auto mt-10 h-[min(130vw,620px)] max-w-[640px]">
        <Stage progress={progress} compact />
      </div>
    </div>
  )
}

/** The left-hand column: which step we're on, then the question. */
function Story({ progress, compact }: { progress: MotionValue<number>; compact?: boolean }) {
  const [p, setP] = useState(() => progress.get())
  useMotionValueEvent(progress, 'change', (v) => {
    // Only re-render when something on screen changes.
    const bucket = (n: number) => `${stepAt(n)}|${n >= T.sweep[0] + 0.04}|${n >= T.repeat}`
    if (bucket(v) !== bucket(p)) setP(v)
  })

  const step = stepAt(p)
  const open = WINDOWS.filter((w) => w.step <= step && w.step < 7).length
  const swept = p >= T.sweep[0] + 0.04
  const looping = p >= T.repeat

  return (
    <div className="relative flex h-full flex-col">
      <div className="flex items-center justify-between font-mono text-[11px] uppercase tracking-[0.16em] text-ink/50">
        <span>{swept ? 'With FlowAI' : 'The manual way'}</span>
        <span>per post</span>
      </div>

      <motion.ol
        initial={false}
        animate={{ opacity: swept ? 0 : 1 }}
        transition={{ duration: 0.5, ease }}
        className="mt-6 grid grid-cols-2 gap-x-6 gap-y-1.5 border-t border-ink/15 pt-5 text-[13px]"
      >
        {STEPS.map((s, i) => (
          <li
            key={s}
            className={cn(
              'flex items-center gap-2 transition-colors duration-300',
              i < step ? 'text-ink/45 line-through decoration-ink/30' : i === step ? 'text-ink' : 'text-ink/30',
            )}
          >
            <span className="font-mono text-[10.5px]">{String(i + 1).padStart(2, '0')}</span>
            {s}
          </li>
        ))}
      </motion.ol>

      <div className={cn('relative', compact ? 'mt-10 min-h-[250px]' : 'mt-auto')}>
        <motion.div
          initial={false}
          animate={{ opacity: swept ? 0 : 1, y: swept ? -24 : 0 }}
          transition={{ duration: 0.6, ease }}
          className={cn(swept && 'pointer-events-none')}
        >
          <div className="flex items-end gap-4">
            <span className="text-[clamp(6rem,12vw,13rem)] font-medium leading-[0.8] tracking-[-0.07em] tabular-nums">
              {String(Math.max(0, step) + 1).padStart(2, '0')}
            </span>
            <span className="pb-2 font-mono text-[12px] text-ink/45">/ 08</span>
          </div>
          <p
            className={cn(
              'mt-6 text-[clamp(1.75rem,2.8vw,2.75rem)] font-medium leading-none tracking-[-0.035em]',
              looping && 'text-[#d23b2c]',
            )}
          >
            {STEPS[Math.max(0, step)]}
            {looping && <RotateCw className="ml-3 inline size-[0.7em] animate-[spin_3s_linear_infinite]" />}
          </p>
          <p className="mt-4 font-mono text-[11.5px] text-ink/55">
            {open} {open === 1 ? 'window' : 'windows'} open · 0 posts published
          </p>
        </motion.div>

        <motion.div
          initial={false}
          animate={{ opacity: swept ? 1 : 0, y: swept ? 0 : 30 }}
          transition={{ duration: 0.8, ease, delay: swept ? 0.15 : 0 }}
          className={cn('absolute inset-x-0 bottom-0', !swept && 'pointer-events-none')}
        >
          <p className="text-[clamp(2.75rem,5.4vw,6rem)] font-medium leading-[0.9] tracking-[-0.055em]">
            What if <Serif>one workflow</Serif> handled all of it?
          </p>
          <p className="mt-6 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.18em] text-ink/55">
            It can <ArrowDown className="size-3.5" />
          </p>
        </motion.div>
      </div>
    </div>
  )
}

/** The desk: windows land one step at a time, a stamp says it all starts again, then the heap is swept into one. */
function Stage({ progress, compact }: { progress: MotionValue<number>; compact?: boolean }) {
  const stageRef = useRef<HTMLDivElement>(null)
  const winRefs = useRef<Array<HTMLDivElement | null>>([])
  const stampRef = useRef<HTMLDivElement>(null)
  const oneRef = useRef<HTMLDivElement>(null)
  const size = useRef({ w: 1, h: 1 })

  const paint = useCallback(
    (p: number) => {
      const { w: W, h: H } = size.current
      const sweep = clamp01((p - T.sweep[0]) / (T.sweep[1] - T.sweep[0]))
      const sw = sweep * sweep * (3 - 2 * sweep)
      // Within one step, windows that share it land a beat apart.
      const seen: Record<number, number> = {}
      WINDOWS.forEach((win, i) => {
        const el = winRefs.current[i]
        if (!el) return
        const nth = (seen[win.step] = (seen[win.step] ?? -1) + 1)
        const start = T.stepStart + win.step * T.stepEvery + nth * 0.022
        const t = clamp01((p - start) / T.drop)
        const e = backOut(t)
        const k = 1 - e
        // Land, then get pulled into the middle of the desk.
        const dx = (0.5 - win.x) * W * sw
        const dy = (0.5 - win.y) * H * sw - k * H * 0.7
        const rot = win.rot * (1 - sw) + k * (win.rot > 0 ? 18 : -18)
        const scale = (1 - 0.65 * sw) * (compact ? 0.78 : W > 760 ? 1.12 : 1)
        el.style.transform = `translate(-50%, -50%) translate3d(${dx}px, ${dy}px, 0) rotate(${rot}deg) scale(${scale})`
        el.style.opacity = String(Math.min(clamp01(t * 4), 1 - clamp01((sweep - 0.55) / 0.4)))
      })

      const stamp = stampRef.current
      if (stamp) {
        const s = clamp01((p - T.repeat) / 0.03)
        stamp.style.opacity = String(s * (1 - clamp01(sweep / 0.4)))
        stamp.style.transform = `translate(-50%, -50%) rotate(-12deg) scale(${1.6 - 0.6 * backOut(s)})`
      }

      const one = oneRef.current
      if (one) {
        const o = clamp01((sweep - 0.5) / 0.5)
        one.style.opacity = String(o)
        one.style.transform = `translate(-50%, -50%) scale(${0.7 + 0.3 * backOut(o)})`
      }
    },
    [compact],
  )

  useMotionValueEvent(progress, 'change', paint)

  useLayoutEffect(() => {
    const el = stageRef.current
    if (!el) return
    const measure = () => {
      size.current = { w: el.offsetWidth, h: el.offsetHeight }
      paint(progress.get())
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [paint, progress])

  return (
    <div ref={stageRef} aria-hidden className="absolute inset-0">
      {WINDOWS.map((win, i) => (
        <div
          key={win.title}
          ref={(el) => void (winRefs.current[i] = el)}
          className="absolute opacity-0 will-change-transform"
          style={{ left: `${win.x * 100}%`, top: `${win.y * 100}%`, width: compact ? Math.min(win.w, 250) : win.w, zIndex: i }}
        >
          <Window title={win.title}>{win.body}</Window>
        </div>
      ))}

      <div
        ref={stampRef}
        className="absolute left-1/2 top-1/2 z-20 whitespace-nowrap rounded-xl border-[5px] border-[#d23b2c] px-6 py-3 text-[#d23b2c] opacity-0 mix-blend-multiply"
        style={{ background: 'color-mix(in oklab, var(--color-bone) 70%, transparent)' }}
      >
        <span className="flex items-center gap-3 text-[clamp(2.75rem,5vw,4.5rem)] font-semibold uppercase leading-none tracking-[-0.03em]">
          Repeat <RotateCw className="size-[0.8em]" strokeWidth={2.5} />
        </span>
        <span className="mt-1 block text-center font-mono text-[11px] uppercase tracking-[0.2em]">Tomorrow, 9:00</span>
      </div>

      <div ref={oneRef} className="absolute left-1/2 top-1/2 z-30 w-[min(420px,86%)] opacity-0">
        <OneWorkflow />
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* The windows                                                          */
/* ------------------------------------------------------------------ */

function Window({ title, children, className }: { title: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'overflow-hidden rounded-lg border border-white/10 bg-panel text-fg shadow-[0_34px_60px_-24px_rgb(40_28_16_/_0.55),0_8px_18px_-8px_rgb(40_28_16_/_0.3)]',
        className,
      )}
    >
      <div className="flex h-7 items-center gap-1.5 border-b border-line px-2.5">
        <span className="size-2 rounded-full bg-white/15" />
        <span className="size-2 rounded-full bg-white/15" />
        <span className="size-2 rounded-full bg-white/15" />
        <span className="ml-2 truncate font-mono text-[10px] text-dim">{title}</span>
      </div>
      <div className="p-3">{children}</div>
    </div>
  )
}

function NotesBody() {
  return (
    <ul className="space-y-1.5 font-mono text-[11.5px] leading-snug text-muted">
      <li>— launch post??</li>
      <li>
        — something about <span className="bg-[#f5d77a] px-0.5 text-ink">mondays</span>
      </li>
      <li>— ask Sam for the photo</li>
      <li className="text-dim">— tiktok version too…</li>
    </ul>
  )
}

function ChatBody() {
  return (
    <div className="space-y-2 text-[11.5px] leading-snug">
      <p className="ml-auto w-fit max-w-[85%] rounded-lg bg-white/10 px-2.5 py-1.5">
        Write a launch post for Tempo. Not too salesy.
      </p>
      <div className="flex gap-2">
        <Sparkles className="mt-0.5 size-3.5 shrink-0 text-muted" />
        <div className="flex-1 space-y-1.5 pt-1">
          <span className="block h-1.5 w-full rounded-full bg-white/10" />
          <span className="block h-1.5 w-11/12 rounded-full bg-white/10" />
          <span className="block h-1.5 w-2/3 rounded-full bg-white/10" />
        </div>
      </div>
      <p className="w-fit rounded-md border border-line px-2 py-0.5 text-[10.5px] text-dim">↻ Regenerate</p>
    </div>
  )
}

function ImageGenBody() {
  return (
    <div>
      <div className="grid grid-cols-4 gap-1.5">
        {(['sun', 'bloom', 'ceramic', 'arch'] as const).map((v) => (
          <GenArt key={v} variant={v} className="aspect-square rounded" />
        ))}
      </div>
      <div className="mt-2.5 flex items-center gap-2 font-mono text-[10px] text-dim">
        <ImageIcon className="size-3" /> Generating… 62%
        <span className="h-0.5 flex-1 rounded-full bg-white/10">
          <span className="block h-full w-[62%] rounded-full bg-white/50" />
        </span>
      </div>
    </div>
  )
}

function VideoBody() {
  const clips = [
    [0, 38, '#c8603d'],
    [40, 30, '#7d8f6a'],
    [72, 24, '#7c5cff'],
  ] as const
  return (
    <div>
      <GenArt variant="night" className="aspect-[16/7] rounded" />
      <div className="relative mt-2.5 space-y-1">
        {[0, 1, 2].map((row) => (
          <div key={row} className="relative h-3 rounded-sm bg-white/[0.04]">
            {clips.map(([l, w, c], i) =>
              (i + row) % 3 === 0 || row === 0 ? (
                <span
                  key={i}
                  className="absolute inset-y-0 rounded-sm opacity-80"
                  style={{ left: `${l}%`, width: `${w}%`, background: c }}
                />
              ) : null,
            )}
          </div>
        ))}
        <span className="absolute -inset-y-1 left-[58%] w-px bg-white" />
      </div>
    </div>
  )
}

function PlatformBody({ id }: { id: 'instagram' | 'linkedin' | 'x' }) {
  if (id === 'x') {
    return (
      <div className="text-[11.5px] leading-snug">
        <p className="text-muted">
          Introducing Tempo — the AI planner that turns your notes, tasks and meetings into one clear plan for your day,
          every day. Early access…
        </p>
        <div className="mt-2.5 flex items-center justify-between">
          <PlatformIcon id="x" className="size-3.5 text-muted" />
          <span className="font-mono text-[10.5px] text-fail">−32</span>
        </div>
      </div>
    )
  }
  if (id === 'linkedin') {
    return (
      <div className="text-[11.5px]">
        <div className="flex items-center gap-2">
          <PlatformIcon id="linkedin" className="size-3.5 text-muted" />
          <span className="text-muted">Start a post</span>
        </div>
        <div className="mt-2 rounded border border-dashed border-white/15 px-2 py-3 text-center text-dim">
          Paste text here…
        </div>
      </div>
    )
  }
  return (
    <div className="flex gap-2.5 text-[11.5px]">
      <GenArt variant="dune" className="aspect-[4/5] w-16 shrink-0 rounded" />
      <div className="flex flex-col">
        <span className="flex items-center gap-1.5 text-muted">
          <PlatformIcon id="instagram" className="size-3.5" /> New post
        </span>
        <span className="mt-1.5 text-dim">Write a caption…</span>
        <span className="mt-auto w-fit rounded bg-white/10 px-2 py-0.5 text-[10.5px]">Share</span>
      </div>
    </div>
  )
}

function CropBody() {
  return (
    <div>
      <div className="relative">
        <GenArt variant="ceramic" className="aspect-[16/9] rounded" />
        <span className="absolute inset-y-0 left-1/2 aspect-[9/16] -translate-x-1/2 border-2 border-white shadow-[0_0_0_999px_rgb(0_0_0_/_0.45)]" />
      </div>
      <div className="mt-2.5 flex gap-1 font-mono text-[10px]">
        {['1:1', '4:5', '9:16', '1.91:1'].map((r, i) => (
          <span key={r} className={cn('rounded border px-1.5 py-0.5', i === 2 ? 'border-white/40 text-fg' : 'border-line text-dim')}>
            {r}
          </span>
        ))}
      </div>
    </div>
  )
}

function UploadBody() {
  return (
    <div className="text-[11.5px]">
      <div className="grid place-items-center gap-1.5 rounded border border-dashed border-white/15 py-4 text-dim">
        <Upload className="size-4" />
        Select video to upload
      </div>
      <div className="mt-2 flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-dim">
          <PlatformIcon id="tiktok" className="size-3.5" /> Caption…
        </span>
        <span className="rounded bg-white/10 px-2 py-0.5 text-[10.5px]">Post</span>
      </div>
    </div>
  )
}

function CalendarBody() {
  const notes: Record<number, string> = { 1: 'post IG', 2: 'post LI', 3: 'post X', 4: 'post TT' }
  return (
    <div className="grid grid-cols-5 gap-1 font-mono text-[9.5px]">
      {['M', 'T', 'W', 'T', 'F'].map((d, i) => (
        <span key={i} className="text-center text-dim">
          {d}
        </span>
      ))}
      {Array.from({ length: 10 }, (_, i) => (
        <span key={i} className="relative h-7 rounded-sm bg-white/[0.04]">
          {notes[i % 5] && i < 5 && (
            <span className="absolute inset-x-0.5 top-0.5 rotate-[-3deg] rounded-sm bg-[#f5d77a] px-0.5 text-ink">
              {notes[i % 5]}
            </span>
          )}
        </span>
      ))}
    </div>
  )
}

const WITH = ['Idea', 'AI', 'Platforms', 'Published']

/** What the heap becomes. */
function OneWorkflow() {
  return (
    <Window
      className="shadow-[0_50px_100px_-30px_rgb(40_28_16_/_0.6)]"
      title={
        <span className="flex items-center gap-1.5 text-fg">
          <LogoMark className="size-3" /> FlowAI — Workspace
        </span>
      }
    >
      <ol className="space-y-1.5 p-1">
        {WITH.map((s, i) => (
          <li key={s} className="flex items-center gap-3 rounded-md border border-line-2 bg-ink-2 px-3 py-2.5">
            <span className="font-mono text-[10.5px] text-dim">0{i + 1}</span>
            <span className="text-[15px] font-medium tracking-[-0.02em]">{s}</span>
            {i === WITH.length - 1 && (
              <span className="ml-auto flex items-center gap-1 text-[11px] text-ok">
                <Check className="size-3" strokeWidth={3} /> Done
              </span>
            )}
          </li>
        ))}
      </ol>
    </Window>
  )
}
