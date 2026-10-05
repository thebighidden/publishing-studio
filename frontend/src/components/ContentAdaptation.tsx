import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useInView } from 'framer-motion'
import { ArrowRight } from 'lucide-react'
import { ease } from '../lib/motion'
import { cn } from '../lib/cn'
import { Field } from './mock/Mock'
import { DrawnBorder } from './ui/DrawnBorder'
import { PLATFORMS, PlatformIcon, type PlatformId } from './ui/PlatformIcon'
import { LineReveal, Reveal, Serif } from './ui/Reveal'
import { SectionLabel } from './ui/Section'

const ORIGINAL =
  'Introducing our new AI productivity platform. It turns scattered notes, tasks and meetings into one clear plan for your day. Early access opens Monday.'

type Variant = { id: PlatformId; format: string; tone: string; hook?: string; text: string; limit?: number }

const VARIANTS: Variant[] = [
  {
    id: 'linkedin',
    format: 'Professional long-form',
    tone: 'Considered',
    text: 'We spent 14 months on one question: why does planning your day take so much of it?\n\nToday we’re introducing our new AI productivity platform. It reads your notes, tasks and meetings and turns them into one clear plan — before your first coffee.\n\nEarly access opens Monday. If your team lives in five tools, we built this for you.',
  },
  {
    id: 'x',
    format: 'Short, concise',
    tone: 'Direct',
    limit: 280,
    text: 'Your notes, tasks and meetings → one clear plan for the day.\n\nOur AI productivity platform opens early access Monday.',
  },
  {
    id: 'instagram',
    format: 'Caption + hashtags',
    tone: 'Warm',
    text: 'Monday, but make it organized ☕️\n\nOur new platform turns notes, tasks and meetings into one plan for your day. Early access opens Monday — link in bio.\n\n#productivity #planning #startup #worksmarter',
  },
  {
    id: 'tiktok',
    format: 'Video caption + hook',
    tone: 'Casual',
    hook: '“I stopped planning my day. Here’s why.”',
    text: 'Notes + tasks + meetings → one plan. Early access Monday 👀 #productivity #aitools',
  },
]

export function ContentAdaptation() {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { margin: '-20% 0px' })
  const [index, setIndex] = useState(0)
  const [touched, setTouched] = useState(false)

  // Cycles on its own until someone picks a tab.
  useEffect(() => {
    if (!inView || touched) return
    const t = window.setTimeout(() => setIndex((i) => (i + 1) % VARIANTS.length), 4200)
    return () => window.clearTimeout(t)
  }, [index, inView, touched])

  const v = VARIANTS[index]

  return (
    <section id="adapt" className="relative py-28 md:py-40">
      <div className="container-x">
        <div className="grid gap-8 lg:grid-cols-12">
          <div className="lg:col-span-7">
            <SectionLabel index="07">Adaptation</SectionLabel>
            <LineReveal
              className="mt-10 text-[clamp(2.6rem,6vw,6.25rem)] font-medium leading-[0.92] tracking-[-0.05em]"
              lines={['Same idea.', <Serif data-thread="circle">Native everywhere.</Serif>]}
            />
          </div>
          <Reveal delay={0.15} className="max-w-sm self-end text-[17px] leading-snug text-muted lg:col-span-4 lg:col-start-9">
            A LinkedIn post isn’t a tweet with more words. Every destination gets its own length, structure and voice —
            from the same source.
          </Reveal>
        </div>

        <div ref={ref} data-thread="rail" className="mt-16 grid gap-4 md:mt-24 lg:grid-cols-[1fr_auto_1.25fr] lg:items-stretch">
          <Reveal className="flex flex-col rounded-xl border border-line bg-ink-2 p-6 md:p-8">
            <div className="flex items-center justify-between">
              <Field>Original</Field>
              <span className="font-mono text-[10.5px] text-dim">{ORIGINAL.length} chars</span>
            </div>
            <p className="mt-6 font-serif text-[26px] leading-[1.2] tracking-[-0.01em] text-fg md:text-[30px]">{ORIGINAL}</p>
            <p className="mt-auto pt-8 font-mono text-[10.5px] text-dim">Written once, by a person, on a Tuesday.</p>
          </Reveal>

          <div className="flex items-center justify-center py-2 lg:px-2">
            <div className="flex items-center gap-3 lg:flex-col">
              <span className="h-px w-10 bg-line-2 lg:h-10 lg:w-px" />
              <span className="grid size-10 place-items-center rounded-full border border-line-2">
                <ArrowRight className="size-4 rotate-90 text-muted lg:rotate-0" />
              </span>
              <span className="h-px w-10 bg-line-2 lg:h-10 lg:w-px" />
            </div>
          </div>

          <Reveal delay={0.1} className="relative flex flex-col overflow-hidden rounded-xl border border-white/[0.05] bg-[#0b0b0c]">
            <DrawnBorder delay={0.2} />
            <div role="tablist" aria-label="Destination" className="flex border-b border-line">
              {VARIANTS.map((it, i) => (
                <button
                  key={it.id}
                  role="tab"
                  type="button"
                  aria-selected={i === index}
                  onClick={() => {
                    setTouched(true)
                    setIndex(i)
                  }}
                  className={cn(
                    'relative flex flex-1 items-center justify-center gap-2 py-3.5 text-[12.5px] transition-colors',
                    i === index ? 'text-fg' : 'text-dim hover:text-muted',
                  )}
                >
                  <PlatformIcon id={it.id} className="size-3.5" />
                  <span className="hidden sm:inline">{PLATFORMS[it.id].name}</span>
                  {i === index && (
                    <motion.span layoutId="adapt-tab" className="absolute inset-x-0 -bottom-px h-px bg-fg" />
                  )}
                  {i === index && !touched && inView && (
                    <motion.span
                      key={`timer-${index}`}
                      className="absolute inset-x-0 -bottom-px h-px origin-left bg-accent"
                      initial={{ scaleX: 0 }}
                      animate={{ scaleX: 1 }}
                      transition={{ duration: 4.2, ease: 'linear' }}
                    />
                  )}
                </button>
              ))}
            </div>

            <div className="relative min-h-[360px] flex-1 p-6 md:p-8">
              <AnimatePresence mode="wait">
                <motion.div
                  key={v.id}
                  initial={{ opacity: 0, y: 14, filter: 'blur(6px)' }}
                  animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                  exit={{ opacity: 0, y: -10, filter: 'blur(6px)' }}
                  transition={{ duration: 0.5, ease }}
                  className="flex h-full flex-col"
                >
                  <div className="flex flex-wrap gap-1.5 text-[11px]">
                    <span className="rounded-full border border-line-2 px-2.5 py-0.5 text-fg">{v.format}</span>
                    <span className="rounded-full border border-line px-2.5 py-0.5 text-muted">Tone · {v.tone}</span>
                  </div>
                  {v.hook && (
                    <p className="mt-5 border-l-2 border-accent pl-3 text-[15px] font-medium text-fg">
                      <span className="mr-2 font-mono text-[10px] uppercase tracking-[0.12em] text-accent-soft">Hook</span>
                      {v.hook}
                    </p>
                  )}
                  <p className="mt-5 whitespace-pre-line text-[15px] leading-relaxed text-fg/90">{v.text}</p>
                  <div className="mt-auto flex items-center justify-between pt-6 font-mono text-[10.5px] text-dim">
                    <span>{v.text.length} chars</span>
                    {v.limit && <LimitRing used={v.text.length} limit={v.limit} />}
                  </div>
                </motion.div>
              </AnimatePresence>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  )
}

/** The little character-limit ring you get in X's composer. */
function LimitRing({ used, limit }: { used: number; limit: number }) {
  const r = 8
  const c = 2 * Math.PI * r
  return (
    <span className="flex items-center gap-2">
      {limit - used} left
      <svg viewBox="0 0 20 20" className="size-5 -rotate-90">
        <circle cx="10" cy="10" r={r} fill="none" stroke="rgb(255 255 255 / 0.12)" strokeWidth="2" />
        <motion.circle
          cx="10"
          cy="10"
          r={r}
          fill="none"
          className="stroke-accent-soft"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c * (1 - used / limit) }}
          transition={{ duration: 0.8, ease }}
        />
      </svg>
    </span>
  )
}
