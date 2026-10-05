import { useRef, type ReactNode } from 'react'
import { motion, useInView } from 'framer-motion'
import { RotateCw } from 'lucide-react'
import { ease } from '../lib/motion'
import { cn } from '../lib/cn'
import { useLoop } from '../lib/useLoop'
import { Caret } from './mock/Mock'
import { LineReveal, Reveal, ScrollWords, Serif, type Word } from './ui/Reveal'
import { SectionLabel } from './ui/Section'

const MANUAL = [
  'Think of an idea',
  'Write the content',
  'Generate visuals',
  'Edit everything',
  'Open every platform',
  'Adapt for each one',
  'Publish manually',
]

const QUESTION: Word[] = [
  { text: 'What' },
  { text: 'if' },
  { text: 'one', serif: true, mark: true },
  { text: 'workflow', serif: true, mark: true },
  { text: 'handled' },
  { text: 'all' },
  { text: 'of' },
  { text: 'it?' },
]

export function Problem() {
  return (
    <section className="relative py-28 md:py-44">
      <div className="container-x">
        <SectionLabel index="01">The problem</SectionLabel>

        <div className="mt-10 grid gap-10 lg:grid-cols-12">
          <LineReveal
            className="text-[clamp(2.4rem,5.6vw,5.75rem)] font-medium leading-[0.95] tracking-[-0.045em] lg:col-span-9"
            lines={['Content creation', 'shouldn’t feel like a', <Serif data-thread="circle">full-time job.</Serif>]}
          />
          <Reveal delay={0.2} className="max-w-sm text-[17px] leading-snug text-muted lg:col-span-3 lg:self-end">
            One post, eight steps, a handful of apps. Then tomorrow you do it all again.
          </Reveal>
        </div>

        <div data-thread="rail">
          <ManualSteps />

          <div className="mt-20 grid border-t border-line md:mt-28 md:grid-cols-3">
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
      </div>

      <div className="container-x mt-32 md:mt-52">
        <ScrollWords
          words={QUESTION}
          markProps={{ 'data-thread': 'circle', 'data-from': 'right', 'data-exit': 'down' }}
          className="max-w-[14ch] text-[clamp(2.8rem,8vw,8.5rem)] font-medium leading-[0.92] tracking-[-0.05em]"
        />
        <Reveal delay={0.1} className="mt-8 flex justify-end">
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted">(It can. Keep scrolling.)</p>
        </Reveal>
      </div>
    </section>
  )
}

function ManualSteps() {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { once: true, margin: '0px 0px -15% 0px' })

  return (
    <div ref={ref} className="mt-16 md:mt-24">
      <div className="flex items-center justify-between font-mono text-[11px] uppercase tracking-[0.16em] text-dim">
        <span>The manual way</span>
        <span>per post</span>
      </div>
      <ol className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-2.5">
        {MANUAL.map((step, i) => (
          <motion.li
            key={step}
            className="flex items-center gap-2"
            initial={{ opacity: 0, y: 10 }}
            animate={inView ? { opacity: 1, y: 0 } : undefined}
            transition={{ duration: 0.6, ease, delay: i * 0.09 }}
          >
            <span className="rounded-full border border-line-2 px-3.5 py-1.5 text-[13px] text-muted">
              <span className="mr-2 font-mono text-[10.5px] text-dim">{String(i + 1).padStart(2, '0')}</span>
              {step}
            </span>
            <span className="text-dim">→</span>
          </motion.li>
        ))}
        <motion.li
          className="flex items-center gap-2 rounded-full border border-fail/30 px-3.5 py-1.5 text-[13px] text-fail"
          initial={{ opacity: 0, y: 10 }}
          animate={inView ? { opacity: 1, y: 0 } : undefined}
          transition={{ duration: 0.6, ease, delay: MANUAL.length * 0.09 }}
        >
          <span className="font-mono text-[10.5px] opacity-70">08</span>
          Repeat
          <RotateCw className="size-3.5 animate-[spin_4s_linear_infinite]" />
        </motion.li>
      </ol>
    </div>
  )
}

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
      className="group flex min-h-[440px] flex-col border-b border-line py-8 md:border-b-0 md:border-l md:px-8 md:first:border-l-0 md:first:pl-0 lg:min-h-[500px]"
    >
      <div className="flex items-start justify-between">
        <span className="font-mono text-[11px] text-dim">{index}</span>
      </div>
      <div className="grid flex-1 place-items-center py-10">{children}</div>
      <h3 className="text-4xl font-medium tracking-[-0.04em] md:text-5xl">{title}</h3>
      <p className="mt-3 min-h-[4.2em] max-w-[32ch] text-[15px] leading-snug text-muted">{body}</p>
    </Reveal>
  )
}

/** Writer's block, rendered as a document with nothing in it. */
function BlankDoc() {
  return (
    <div className="w-[220px] rounded-lg border border-line-2 bg-card p-4 shadow-2xl transition-transform duration-700 ease-expo group-hover:-rotate-2">
      <div className="flex items-center justify-between font-mono text-[10px] text-dim">
        <span>untitled-post.txt</span>
        <span>0 words</span>
      </div>
      <p className="mt-5 text-[13px] text-fg">
        <Caret />
      </p>
      <div className="mt-6 space-y-2 opacity-40">
        <div className="h-1.5 w-full rounded-full bg-white/5" />
        <div className="h-1.5 w-4/5 rounded-full bg-white/5" />
        <div className="h-1.5 w-3/5 rounded-full bg-white/5" />
      </div>
      <p className="mt-6 font-mono text-[10px] text-dim">Opened 47 min ago</p>
    </div>
  )
}

const FORMAT_LIST = [
  { label: '1080×1350', w: 64, h: 80 },
  { label: '1080×1920', w: 54, h: 96 },
  { label: '1200×627', w: 120, h: 63 },
  { label: '1280×720', w: 112, h: 63 },
]
const FORMAT_TIMING = [1100, 1100, 1100, 1100]

/** The same post needs four different frames. */
function Formats() {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref)
  const active = useLoop(FORMAT_TIMING, inView)

  return (
    <div ref={ref} className="flex flex-col items-center gap-6">
      <div className="relative grid h-[110px] w-[150px] place-items-end justify-items-center">
        {FORMAT_LIST.map((f, i) => (
          <div
            key={f.label}
            className={cn(
              'absolute bottom-0 rounded-[3px] border transition-colors duration-500',
              i === active ? 'border-fg bg-white/[0.04]' : 'border-white/15',
            )}
            style={{ width: f.w, height: f.h }}
          />
        ))}
      </div>
      <div className="flex gap-3 font-mono text-[10.5px]">
        {FORMAT_LIST.map((f, i) => (
          <span key={f.label} className={cn('transition-colors duration-500', i === active ? 'text-fg' : 'text-dim')}>
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
          className="absolute left-0 flex h-[34px] w-[172px] items-start gap-2 rounded-t-md border border-b-0 border-line-2 bg-card px-3 pt-[5px] text-[11px] leading-[14px] text-muted shadow-[0_-8px_20px_-8px_rgb(0_0_0_/_0.8)] transition-transform duration-700 ease-expo group-hover:translate-x-2"
          style={{ top: i * 20, marginLeft: i * 7, zIndex: i, transitionDelay: `${i * 30}ms` }}
        >
          <span className="mt-1 size-1.5 rounded-full bg-white/25" />
          {t}
          <span className="ml-auto text-dim">×</span>
        </div>
      ))}
    </div>
  )
}
