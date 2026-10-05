import { useRef } from 'react'
import { AnimatePresence, motion, useInView } from 'framer-motion'
import { ArrowDown, RotateCw } from 'lucide-react'
import { ease } from '../lib/motion'
import { useLoop } from '../lib/useLoop'
import { LogoMark } from './ui/Logo'
import { Reveal, Serif } from './ui/Reveal'
import { SectionLabel } from './ui/Section'

const WITHOUT = ['Idea', 'ChatGPT', 'Image generator', 'Video editor', 'Instagram', 'LinkedIn', 'TikTok', 'Calendar']
const WITH = ['Idea', 'AI', 'Platforms', 'Published']
const TABS = ['Notes — ideas', 'ChatGPT', 'Image generator', 'Video editor', 'Instagram', 'LinkedIn', 'TikTok', 'Calendar']
// One tab opens every ~half second; hold on the mess for a beat, then close them all.
const TAB_TIMING = [...TABS.map(() => 480), 2200]

export function BeforeAfter() {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { margin: '-20% 0px' })
  const open = useLoop(TAB_TIMING, inView)

  return (
    <section className="relative py-28 md:py-40">
      <div className="container-x">
        <SectionLabel index="12">Before / After</SectionLabel>

        <div ref={ref} className="mt-12 grid overflow-hidden rounded-xl border border-line md:mt-16 md:grid-cols-2">
          {/* Without */}
          <div className="flex flex-col border-b border-line p-6 md:border-b-0 md:border-r md:p-10">
            <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-dim">Without FlowAI</p>

            <div className="mt-6 flex h-9 items-end gap-px overflow-hidden border-b border-line">
              <AnimatePresence initial={false}>
                {TABS.slice(0, Math.min(open + 1, TABS.length)).map((t) => (
                  <motion.div
                    key={t}
                    layout
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.35, ease }}
                    className="flex h-8 min-w-0 max-w-[150px] flex-1 basis-0 items-center gap-1.5 rounded-t-md border border-b-0 border-line bg-card px-2 text-[11px] text-muted"
                  >
                    <span className="size-1.5 shrink-0 rounded-full bg-white/25" />
                    <span className="truncate">{t}</span>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>

            <ol className="mt-8 space-y-1 font-mono text-[12.5px] text-muted">
              {WITHOUT.map((s, i) => (
                <Reveal as="li" key={s} delay={i * 0.04} y={8} className="flex flex-col">
                  <span>{s}</span>
                  <span className="text-dim">↓</span>
                </Reveal>
              ))}
              <li className="flex items-center gap-2 text-fail">
                Repeat… <RotateCw className="size-3.5 animate-[spin_3s_linear_infinite]" />
              </li>
            </ol>

            <p className="mt-auto pt-14 text-[clamp(2.6rem,5.5vw,5.5rem)] font-medium leading-[0.9] tracking-[-0.05em] text-muted">
              <span data-thread="scribble">Too many tabs.</span>
            </p>
          </div>

          {/* With */}
          <div className="relative flex flex-col overflow-hidden bg-white/[0.025] p-6 md:p-10">
            <div
              aria-hidden
              className="pointer-events-none absolute -right-24 -top-24 size-72 rounded-full bg-accent/15 blur-[90px]"
            />
            <p className="relative font-mono text-[11px] uppercase tracking-[0.16em] text-fg">With FlowAI</p>

            <div className="relative mt-6 flex h-9 items-end border-b border-line">
              <div className="flex h-8 w-[190px] items-center gap-2 rounded-t-md border border-b-0 border-line-2 bg-ink-2 px-2.5 text-[11px] text-fg">
                <LogoMark className="size-3" /> FlowAI — Workspace
              </div>
            </div>

            <ol className="relative mt-8 space-y-2">
              {/* Phones stack the panels: send the line down the margin instead of across this list. */}
              <li data-thread="rail" data-side-sm="right" aria-hidden className="absolute inset-y-0 right-0 w-px list-none lg:hidden" />
              {WITH.map((s, i) => (
                <Reveal as="li" key={s} delay={0.1 + i * 0.1} y={12}>
                  <div className="flex items-center gap-4 rounded-lg border border-line-2 bg-ink-2 px-4 py-3.5">
                    <span className="font-mono text-[11px] text-dim">0{i + 1}</span>
                    <span className="text-[17px] font-medium tracking-[-0.02em]">{s}</span>
                    {i === WITH.length - 1 && (
                      <span className="ml-auto flex items-center gap-1.5 text-[11px] text-ok">
                        <span className="size-1.5 rounded-full bg-ok" /> Done
                      </span>
                    )}
                  </div>
                  {i < WITH.length - 1 && <ArrowDown className="my-1 ml-5 size-3.5 text-dim" />}
                </Reveal>
              ))}
            </ol>

            <p className="relative mt-auto pt-14 text-[clamp(2.6rem,5.5vw,5.5rem)] font-medium leading-[0.9] tracking-[-0.05em]">
              <span data-thread="point" data-dir="1,0.15" aria-hidden className="absolute -bottom-3 left-0 hidden size-px lg:block" />
              One <Serif data-thread="underline" data-loop="">workflow.</Serif>
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}
