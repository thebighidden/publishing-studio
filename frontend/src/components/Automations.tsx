import { useRef } from 'react'
import { AnimatePresence, motion, useInView } from 'framer-motion'
import {
  CalendarClock,
  Check,
  Clock3,
  FileText,
  Image as ImageIcon,
  Lightbulb,
  LoaderCircle,
  Send,
  Shuffle,
  type LucideIcon,
} from 'lucide-react'
import { ease } from '../lib/motion'
import { cn } from '../lib/cn'
import { useLoop } from '../lib/useLoop'
import { Button } from './ui/Button'
import { DrawnBorder } from './ui/DrawnBorder'
import { LineReveal, Reveal, Serif } from './ui/Reveal'
import { SectionLabel } from './ui/Section'

const NODES: Array<{ label: string; icon: LucideIcon; log: string; time: string }> = [
  { label: 'Generate 5 content ideas', icon: Lightbulb, log: 'Generated 5 content ideas', time: '09:00:04' },
  { label: 'Create posts', icon: FileText, log: 'Created 5 posts', time: '09:00:31' },
  { label: 'Generate images', icon: ImageIcon, log: 'Generated 5 images', time: '09:01:12' },
  { label: 'Adapt for platforms', icon: Shuffle, log: 'Adapted for LinkedIn, Instagram, X', time: '09:01:20' },
  { label: 'Schedule', icon: CalendarClock, log: 'Scheduled 15 posts · Mon–Fri', time: '09:01:21' },
  { label: 'Publish', icon: Send, log: 'Publishing on schedule', time: '09:01:21' },
]

// Hold on the trigger, walk through each node, then rest on "done" before looping.
const TIMING = [1200, ...NODES.map(() => 950), 3200]

export function Automations() {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { margin: '-15% 0px' })
  const step = useLoop(TIMING, inView)
  // step 0 = trigger fired; step n = nodes[0..n-1] finished; last = everything done
  const done = step - 1

  return (
    <section id="automations" className="relative py-28 md:py-40">
      <div className="container-x grid gap-16 lg:grid-cols-12 lg:gap-10">
        <div className="lg:col-span-5">
          <SectionLabel index="09">Automations</SectionLabel>
          <LineReveal
            className="mt-10 text-[clamp(2.4rem,4.8vw,5rem)] font-medium leading-[0.95] tracking-[-0.045em]"
            lines={['Turn repetitive', 'work into', <Serif>workflows.</Serif>]}
          />
          <div data-thread="rail" data-side="left">
          <Reveal delay={0.15} className="mt-8 max-w-sm text-[17px] leading-snug text-muted">
            Create automated workflows that run whenever you need them. This one fills a whole week before you’ve
            opened your laptop.
          </Reveal>
          <Reveal delay={0.25} className="mt-10">
            <Button href="#start" arrow>
              Create an Automation
            </Button>
          </Reveal>

          <Reveal delay={0.3} className="mt-14 rounded-lg border border-line bg-ink-2 p-4 font-mono text-[11.5px] leading-[1.9]">
            <p className="mb-2 flex items-center justify-between text-[10px] uppercase tracking-[0.14em] text-dim">
              Run log <span>Monday, Oct 5</span>
            </p>
            <p className="text-muted">
              <span className="text-dim">09:00:00</span> Trigger fired
            </p>
            <AnimatePresence initial={false}>
              {NODES.slice(0, Math.max(0, Math.min(done, NODES.length))).map((n) => (
                <motion.p
                  key={n.log}
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.35, ease }}
                  className="overflow-hidden text-muted"
                >
                  <span className="text-dim">{n.time}</span> {n.log} <span className="text-ok">✓</span>
                </motion.p>
              ))}
            </AnimatePresence>
          </Reveal>
          </div>
        </div>

        <div ref={ref} className="lg:col-span-6 lg:col-start-7">
          <Reveal y={40}>
            <div className="relative overflow-hidden rounded-xl border border-white/[0.05] bg-panel p-5 md:p-8">
              <DrawnBorder />
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 rounded-xl opacity-60"
                style={{
                  backgroundImage: 'radial-gradient(rgb(255 255 255 / 0.07) 1px, transparent 1px)',
                  backgroundSize: '18px 18px',
                }}
              />
              <div className="relative flex items-center justify-between">
                <p className="text-[13.5px] font-medium">Weekly content engine</p>
                <span className="flex items-center gap-1.5 rounded-full border border-ok/30 px-2 py-0.5 text-[10.5px] text-ok">
                  <span className="size-1.5 animate-pulse rounded-full bg-ok" /> Active
                </span>
              </div>

              <div className="relative mx-auto mt-8 max-w-md">
                {/* Trigger */}
                <div className="flex items-center gap-3 rounded-lg border border-accent/50 bg-accent/10 px-4 py-3.5">
                  <span className="grid size-8 place-items-center rounded-md bg-accent text-on-accent">
                    <Clock3 className="size-4" />
                  </span>
                  <div>
                    <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-accent-soft">Trigger</p>
                    <p className="text-[14px] font-medium">Every Monday at 9:00</p>
                  </div>
                </div>

                {NODES.map((n, i) => {
                  const state = i < done ? 'done' : i === done ? 'running' : 'idle'
                  const Icon = n.icon
                  return (
                    <div key={n.label}>
                      <Connector active={i <= done} />
                      <div
                        className={cn(
                          'flex items-center gap-3 rounded-lg border px-4 py-3 transition-colors duration-500',
                          state === 'idle' ? 'border-line bg-ink-2' : 'border-line-2 bg-card',
                        )}
                      >
                        <span
                          className={cn(
                            'grid size-8 place-items-center rounded-md transition-colors duration-500',
                            state === 'idle' ? 'bg-white/[0.04] text-dim' : 'bg-white/[0.08] text-fg',
                          )}
                        >
                          <Icon className="size-4" strokeWidth={1.75} />
                        </span>
                        <p className={cn('text-[14px] transition-colors duration-500', state === 'idle' ? 'text-muted' : 'text-fg')}>
                          {n.label}
                        </p>
                        <span className="ml-auto">
                          {state === 'running' ? (
                            <LoaderCircle className="size-4 animate-spin text-accent-soft" />
                          ) : state === 'done' ? (
                            <motion.span
                              initial={{ scale: 0 }}
                              animate={{ scale: 1 }}
                              transition={{ type: 'spring', stiffness: 500, damping: 25 }}
                              className="grid size-4 place-items-center rounded-full bg-ok text-ink"
                            >
                              <Check className="size-2.5" strokeWidth={3.5} />
                            </motion.span>
                          ) : (
                            <span className="block size-4 rounded-full border border-line-2" />
                          )}
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  )
}

function Connector({ active }: { active: boolean }) {
  return (
    <div className="relative ml-8 h-6 w-px bg-line-2">
      <motion.div
        className="absolute inset-0 origin-top bg-accent-soft"
        initial={false}
        animate={{ scaleY: active ? 1 : 0 }}
        transition={{ duration: 0.4, ease }}
      />
    </div>
  )
}
