import { useRef } from 'react'
import { motion, useInView, useReducedMotion, useScroll, useTransform } from 'framer-motion'
import { Check } from 'lucide-react'
import { ease } from '../lib/motion'
import { cn } from '../lib/cn'
import { useReady } from '../lib/ready'
import { useLoop } from '../lib/useLoop'
import { useMediaQuery } from '../lib/useMediaQuery'
import { HERO_PHASES, HeroDashboard } from './mock/HeroDashboard'
import { Button } from './ui/Button'
import { FlowField } from './ui/FlowField'
import { PlatformIcon } from './ui/PlatformIcon'
import { LineReveal, Serif } from './ui/Reveal'

export function Hero() {
  const ready = useReady()
  const sectionRef = useRef<HTMLElement>(null)
  const dashRef = useRef<HTMLDivElement>(null)
  const copyRef = useRef<HTMLDivElement>(null)
  // The bundle always leaves just under the copy, through the gap above the dashboard; on phones it climbs steeper.
  const wide = useMediaQuery('(min-width: 768px)')
  const dashInView = useInView(dashRef, { margin: '0px 0px -20% 0px' })
  const phase = useLoop(HERO_PHASES, ready && dashInView)

  const { scrollYProgress } = useScroll({ target: sectionRef, offset: ['start start', 'end start'] })
  const headOpacity = useTransform(scrollYProgress, [0, 0.45], [1, 0.25])
  // As the hero scrolls away, the fan of threads gathers back into one.
  const gather = useTransform(scrollYProgress, [0.04, 0.42], [0, 1])

  const { scrollYProgress: dashProgress } = useScroll({ target: dashRef, offset: ['start end', 'start 0.2'] })
  const dashScale = useTransform(dashProgress, [0, 1], [0.9, 1])
  // The screen rises out of the page: leaning back at first, flat by the time it's read.
  const dashTilt = useTransform(dashProgress, [0, 1], [26, 0])
  const reduce = useReducedMotion()

  const fade = (delay: number) => ({
    initial: { opacity: 0, y: 16 },
    animate: ready ? { opacity: 1, y: 0 } : undefined,
    transition: { duration: 0.9, ease, delay },
  })

  return (
    <section id="top" ref={sectionRef} className="relative isolate pt-28 md:pt-36">
      <FlowField
        play={ready}
        gather={gather}
        quietRef={copyRef}
        sourceRef={copyRef}
        to={wide ? 0.4 : 0.24}
        spread={wide ? 0.46 : 0.36}
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[100svh] min-h-[620px] w-full [mask-image:linear-gradient(to_bottom,transparent,#000_12%,#000_72%,transparent)]"
      />
      <div className="container-x relative">
        <motion.div style={{ opacity: headOpacity }}>
          <div className="flex items-center justify-between">
            <motion.p
              {...fade(0.1)}
              className="flex items-center gap-2.5 font-mono text-[11px] uppercase tracking-[0.2em] text-muted"
            >
              <span className="relative flex size-1.5">
                <span className="absolute inset-0 animate-ping rounded-full bg-accent opacity-60" />
                <span className="size-1.5 rounded-full bg-accent" />
              </span>
              AI Content Automation
            </motion.p>
            <motion.p {...fade(0.15)} className="hidden font-mono text-[11px] text-dim md:block">
              Text / Image / Video
            </motion.p>
          </div>

          <LineReveal
            as="h1"
            play={ready}
            delay={0.12}
            className="mt-7 text-[clamp(2.9rem,10.4vw,11.5rem)] font-medium leading-[0.86] tracking-[-0.06em]"
            lines={[
              'Create once.',
              <span className="block md:pl-[8vw]">
                Publish <Serif data-thread="underline" data-loop="">everywhere.</Serif>
              </span>,
            ]}
          />

          <div className="mt-10 grid gap-10 md:mt-14 md:grid-cols-12 md:items-end">
            <div ref={copyRef} className="md:col-span-6 md:col-start-7">
              <motion.p {...fade(0.45)} className="max-w-[36ch] text-lg leading-snug text-muted md:text-[21px]">
                Generate text, images, and videos with AI — then automatically adapt, schedule, and publish them across
                your social platforms from one workspace.
              </motion.p>
              <motion.div {...fade(0.55)} className="mt-8 flex flex-wrap items-center gap-3">
                <Button href="/signup" size="lg" arrow>
                  Start Creating Free
                </Button>
                <Button href="#workflow" size="lg" variant="ghost" arrow>
                  See How It Works
                </Button>
              </motion.div>
              <motion.p {...fade(0.62)} className="mt-4 font-mono text-[11px] text-dim">
                No credit card required.
              </motion.p>
            </div>
          </div>
        </motion.div>

        <motion.div
          ref={dashRef}
          data-thread="rail"
          initial={{ opacity: 0, y: 100 }}
          animate={ready ? { opacity: 1, y: 0 } : undefined}
          transition={{ duration: 1.4, ease, delay: 0.55 }}
          className="relative mt-16 md:mt-24"
        >
          <div
            aria-hidden
            className="pointer-events-none absolute -top-28 left-1/2 h-56 w-[70%] -translate-x-1/2 rounded-[50%] bg-accent/25 blur-[110px]"
          />
          <motion.div
            style={{ scale: dashScale, rotateX: reduce ? 0 : dashTilt, transformPerspective: 1800 }}
            className="relative origin-top"
          >
            <HeroDashboard phase={phase} run={ready && dashInView} />
            <FloatingChips phase={phase} />
          </motion.div>
        </motion.div>
      </div>
    </section>
  )
}

const CHIPS = [
  { label: 'Generated', at: 2, pos: 'left-[-3.25rem] top-[44%]', float: 6 },
  { label: 'Scheduled', at: 3, pos: 'right-[-2.75rem] top-[22%]', float: 7 },
  { label: 'Published', at: 4, pos: 'right-[12%] bottom-[-1.4rem]', float: 6.5 },
  { label: '3 Platforms', at: 3, pos: 'left-[22%] bottom-[-1.4rem]', float: 7.5, icons: true },
]

function FloatingChips({ phase }: { phase: number }) {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 hidden xl:block">
      {CHIPS.map((c, i) => {
        const on = phase >= c.at
        return (
          <motion.div
            key={c.label}
            className={cn('absolute', c.pos)}
            animate={{ y: [0, -10, 0] }}
            transition={{ duration: c.float, repeat: Infinity, ease: 'easeInOut', delay: i * 0.7 }}
          >
            <div
              className={cn(
                'flex items-center gap-2.5 rounded-full border py-1.5 pl-1.5 pr-4 text-[13px] font-medium tracking-[-0.01em] shadow-[0_24px_50px_-14px_rgb(0_0_0_/_0.9)] transition-[background-color,border-color,color,scale] duration-700 ease-expo',
                on ? 'scale-100 border-transparent bg-bone text-ink' : 'scale-95 border-line-2 bg-panel-2 text-dim',
              )}
            >
              {c.icons ? (
                <span className="flex -space-x-1.5">
                  {(['linkedin', 'instagram', 'x'] as const).map((p) => (
                    <span
                      key={p}
                      className={cn(
                        'grid size-6 place-items-center rounded-full border-2 transition-colors duration-700',
                        on ? 'border-bone bg-ink text-fg' : 'border-panel-2 bg-card text-dim',
                      )}
                    >
                      <PlatformIcon id={p} className="size-3" />
                    </span>
                  ))}
                </span>
              ) : (
                <span
                  className={cn(
                    'grid size-6 place-items-center rounded-full transition-colors duration-700',
                    on ? (c.at === 4 ? 'bg-ok text-ink' : 'bg-accent text-on-accent') : 'border border-line-2',
                  )}
                >
                  {on && <Check className="size-3.5" strokeWidth={3} />}
                </span>
              )}
              {c.label}
            </div>
          </motion.div>
        )
      })}
    </div>
  )
}
