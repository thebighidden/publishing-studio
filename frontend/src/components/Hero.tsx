import { useRef } from 'react'
import { motion, useInView, useScroll, useTransform } from 'framer-motion'
import { Check } from 'lucide-react'
import { ease } from '../lib/motion'
import { cn } from '../lib/cn'
import { useReady } from '../lib/ready'
import { useLoop } from '../lib/useLoop'
import { HERO_PHASES, HeroDashboard } from './mock/HeroDashboard'
import { Button } from './ui/Button'
import { PlatformIcon } from './ui/PlatformIcon'
import { LineReveal, Serif } from './ui/Reveal'

const PIPELINE = ['Generate', 'Adapt', 'Schedule', 'Publish']

export function Hero() {
  const ready = useReady()
  const sectionRef = useRef<HTMLElement>(null)
  const dashRef = useRef<HTMLDivElement>(null)
  const dashInView = useInView(dashRef, { margin: '0px 0px -20% 0px' })
  const phase = useLoop(HERO_PHASES, ready && dashInView)

  const { scrollYProgress } = useScroll({ target: sectionRef, offset: ['start start', 'end start'] })
  const headOpacity = useTransform(scrollYProgress, [0, 0.45], [1, 0.25])

  const { scrollYProgress: dashProgress } = useScroll({ target: dashRef, offset: ['start end', 'start 0.2'] })
  const dashScale = useTransform(dashProgress, [0, 1], [0.9, 1])

  const fade = (delay: number) => ({
    initial: { opacity: 0, y: 16 },
    animate: ready ? { opacity: 1, y: 0 } : undefined,
    transition: { duration: 0.9, ease, delay },
  })

  return (
    <section id="top" ref={sectionRef} className="relative pt-28 md:pt-36">
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
            className="mt-7 text-[clamp(3rem,9vw,9.5rem)] font-medium leading-[0.9] tracking-[-0.055em]"
            lines={[
              'Create once.',
              <span className="block md:pl-[10vw]">
                Publish <Serif data-thread="underline" data-loop="">everywhere.</Serif>
              </span>,
            ]}
          />

          <div className="mt-10 grid gap-10 md:mt-14 md:grid-cols-12 md:items-end">
            <motion.ol {...fade(0.5)} className="hidden font-mono text-[11px] leading-[1.9] text-dim md:col-span-3 md:block">
              {PIPELINE.map((step, i) => (
                <li key={step} className="flex gap-4">
                  <span>0{i + 1}</span>
                  <span className="text-muted">{step}</span>
                </li>
              ))}
            </motion.ol>

            <div className="md:col-span-6 md:col-start-7">
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
          <motion.div style={{ scale: dashScale }} className="relative origin-top">
            <HeroDashboard phase={phase} run={ready && dashInView} />
            <FloatingChips phase={phase} />
          </motion.div>
        </motion.div>
      </div>
    </section>
  )
}

const CHIPS = [
  { label: 'Generated', at: 2, pos: 'left-[-1.75rem] top-[58%]', float: 6 },
  { label: 'Scheduled', at: 3, pos: 'left-[44%] top-[-1.2rem]', float: 7 },
  { label: 'Published', at: 4, pos: 'right-[16%] bottom-[-1.2rem]', float: 6.5 },
  { label: '3 Platforms', at: 3, pos: 'left-[26%] bottom-[-1.2rem]', float: 7.5, icons: true },
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
                'flex items-center gap-2 rounded-lg border bg-[#0e0e10]/90 px-3 py-2 text-[12px] shadow-[0_20px_40px_-12px_rgb(0_0_0_/_0.8)] backdrop-blur transition-all duration-500',
                on ? 'border-white/20 text-fg' : 'border-line text-dim',
              )}
            >
              {c.icons ? (
                <span className="flex -space-x-1">
                  {(['linkedin', 'instagram', 'x'] as const).map((p) => (
                    <span key={p} className="grid size-5 place-items-center rounded-full border border-line-2 bg-ink">
                      <PlatformIcon id={p} className="size-2.5" />
                    </span>
                  ))}
                </span>
              ) : (
                <span
                  className={cn(
                    'grid size-4 place-items-center rounded-full transition-colors duration-500',
                    on ? (c.at === 4 ? 'bg-ok text-ink' : 'bg-accent text-white') : 'border border-line-2',
                  )}
                >
                  {on && <Check className="size-2.5" strokeWidth={3} />}
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
