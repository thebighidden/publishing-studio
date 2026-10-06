import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, Clapperboard, Image, Sparkles, Type } from 'lucide-react'
import { ease } from '../../lib/motion'
import { cn } from '../../lib/cn'
import { useLoop } from '../../lib/useLoop'
import { useTypewriter } from '../../lib/useTypewriter'
import { Caret, Field as MockLabel } from '../mock/Mock'
import { GenArt, type ArtVariant } from '../ui/GenArt'
import { PLATFORMS, PlatformIcon, type PlatformId } from '../ui/PlatformIcon'

const PROMPT = 'Announce our spring collection — warm, playful, under 60 words.'

// 0 typing · 1 generating · 2 adapted · 3 scheduled · 4 published
const PHASES = [4200, 1600, 1700, 1500, 3000]
const STEPS = ['Generate', 'Adapt', 'Schedule', 'Publish']
const STEP_OF_PHASE = [0, 0, 1, 2, 3]

type Output = { platform: PlatformId; kind: string; copy?: string; art?: ArtVariant }

const OUTPUTS: Output[] = [
  { platform: 'linkedin', kind: 'Post', copy: 'Spring is here, and so is our new collection. Made for long days and slow mornings.' },
  { platform: 'instagram', kind: 'Image · 4:5', art: 'dune' },
  { platform: 'x', kind: 'Post', copy: 'Spring collection, out now. Warm colours, light layers, zero overthinking.' },
]

const CHIP = [
  null,
  null,
  { label: 'Adapted', cls: 'border-accent/40 text-accent-soft', dot: 'bg-accent' },
  { label: 'Thu 09:30', cls: 'border-plan/30 text-plan', dot: 'bg-plan' },
  { label: 'Published', cls: 'border-ok/25 text-ok', dot: 'bg-ok' },
]

/**
 * One brief moving through the whole pipeline: it types itself, generates, splits into
 * three platform-shaped posts, gets scheduled, then goes live. Then it starts again.
 */
export function PipelineScene({ startAfter = 1.2 }: { startAfter?: number }) {
  const [run, setRun] = useState(false)
  useEffect(() => {
    const t = window.setTimeout(() => setRun(true), startAfter * 1000)
    return () => window.clearTimeout(t)
  }, [startAfter])

  const phase = useLoop(PHASES, run)
  const step = STEP_OF_PHASE[phase]

  return (
    <div className="absolute inset-x-0 top-0 bottom-[30%] flex items-center justify-center px-8 pt-16 xl:px-12">
      <div className="flex w-full max-w-[620px] origin-center flex-col items-center gap-7 [@media(max-height:860px)]:scale-[0.86]">
        <Steps step={step} published={phase === 4} />

        <div className="relative w-full max-w-[460px] overflow-hidden rounded-2xl border border-white/[0.08] bg-panel-2 p-4 shadow-[0_40px_80px_-30px_rgb(0_0_0_/_0.95)]">
          <div className="flex items-center justify-between">
            <MockLabel>Prompt</MockLabel>
            <span className="flex items-center gap-1.5 rounded-md border border-line px-2 py-1 text-[11px] text-muted">
              <Sparkles className="size-3" strokeWidth={1.75} /> Model · Auto
            </span>
          </div>
          <p className="mt-3 min-h-[2.7em] text-[15px] leading-snug text-fg">
            {phase === 0 ? <Typed run={run} /> : PROMPT}
          </p>
          <div className="mt-4 flex items-center justify-between">
            <div className="flex gap-1.5">
              {[
                { label: 'Text', icon: Type, on: true },
                { label: 'Image', icon: Image, on: true },
                { label: 'Video', icon: Clapperboard, on: false },
              ].map(({ label, icon: Icon, on }) => (
                <span
                  key={label}
                  className={cn(
                    'flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px]',
                    on ? 'border-white/20 text-fg' : 'border-line text-dim',
                  )}
                >
                  <Icon className="size-3" strokeWidth={1.75} />
                  {label}
                </span>
              ))}
            </div>
            <span
              className={cn(
                'relative overflow-hidden rounded-full px-3.5 py-1.5 text-[12px] font-medium transition-colors duration-500',
                phase === 1 ? 'bg-accent text-on-accent' : 'bg-fg text-ink',
              )}
            >
              {phase === 0 ? 'Generate' : phase === 1 ? 'Generating…' : 'Generated'}
              {phase === 1 && <span className="skeleton absolute inset-0 opacity-50" />}
            </span>
          </div>
          <motion.span
            aria-hidden
            className="absolute inset-x-0 bottom-0 h-px origin-left bg-accent-soft"
            animate={{ scaleX: phase === 1 ? 1 : 0, opacity: phase === 1 ? 1 : 0 }}
            transition={{ duration: phase === 1 ? 1.5 : 0.3, ease: 'linear' }}
          />
        </div>

        <div className="relative -my-3 h-12 w-full">
          <svg className="absolute inset-0 h-full w-full overflow-visible" viewBox="0 0 300 48" preserveAspectRatio="none" aria-hidden>
            {['M150 0 C150 26, 50 22, 50 48', 'M150 0 L150 48', 'M150 0 C150 26, 250 22, 250 48'].map((d, i) => (
              <g key={d}>
                <path d={d} fill="none" stroke="rgb(255 255 255 / 0.08)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
                <motion.path
                  d={d}
                  fill="none"
                  stroke="var(--color-accent-soft)"
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                  initial={false}
                  animate={{ pathLength: phase >= 2 ? 1 : 0, opacity: phase >= 2 ? 1 : 0 }}
                  transition={{ duration: 0.7, ease, delay: phase >= 2 ? i * 0.08 : 0 }}
                />
              </g>
            ))}
          </svg>
        </div>

        <div className="grid w-full grid-cols-3 gap-3">
          {OUTPUTS.map((o, i) => (
            <div key={o.platform} className="relative h-[196px] rounded-xl border border-dashed border-white/[0.08]">
              <AnimatePresence>
                {phase >= 2 && (
                  <motion.div
                    className="absolute inset-0"
                    initial={{ opacity: 0, y: 26, rotate: (i - 1) * 5, scale: 0.94 }}
                    animate={{ opacity: 1, y: 0, rotate: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -10, scale: 0.97, transition: { duration: 0.4, delay: i * 0.05 } }}
                    transition={{ duration: 0.8, ease, delay: i * 0.09 }}
                  >
                    <OutputCard output={o} phase={phase} />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function Typed({ run }: { run: boolean }) {
  const { value, done } = useTypewriter(PROMPT, run, 36)
  return (
    <>
      {value}
      {!done && <Caret />}
    </>
  )
}

function Steps({ step, published }: { step: number; published: boolean }) {
  return (
    <ol className="flex items-center gap-2.5 font-mono text-[10.5px] uppercase tracking-[0.16em]">
      {STEPS.map((s, i) => {
        const done = step > i || (published && i === 3)
        const on = step === i && !done
        return (
          <li key={s} className="flex items-center gap-2.5">
            {i > 0 && (
              <span className="relative block h-px w-6 overflow-hidden bg-line-2 xl:w-9">
                <motion.span
                  className="absolute inset-0 origin-left bg-fg"
                  initial={false}
                  animate={{ scaleX: step >= i ? 1 : 0 }}
                  transition={{ duration: 0.6, ease }}
                />
              </span>
            )}
            <span className={cn('flex items-center gap-1.5 transition-colors duration-500', on ? 'text-fg' : done ? 'text-muted' : 'text-dim')}>
              <span
                className={cn(
                  'grid size-4 place-items-center rounded-full border text-[8.5px] transition-[background-color,border-color,color] duration-500',
                  done ? 'border-ok bg-ok text-ink' : on ? 'border-fg text-fg' : 'border-line-2',
                )}
              >
                {done ? <Check className="size-2.5" strokeWidth={3} /> : i + 1}
              </span>
              {s}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

function OutputCard({ output, phase }: { output: Output; phase: number }) {
  const chip = CHIP[phase]
  return (
    <div className="flex h-full flex-col rounded-xl border border-white/[0.08] bg-panel-3 p-2.5 shadow-[0_30px_60px_-30px_rgb(0_0_0_/_0.9)]">
      <div className="flex items-center justify-between gap-2 px-0.5">
        <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-fg">
          <PlatformIcon id={output.platform} className="size-3.5" />
          <span className="truncate">{PLATFORMS[output.platform].name}</span>
        </span>
        <span className="shrink-0 font-mono text-[9.5px] text-dim">{output.kind}</span>
      </div>

      <div className="mt-2.5 min-h-0 flex-1">
        {output.art ? (
          <GenArt variant={output.art} className="h-full w-full rounded-lg" />
        ) : (
          <p className="px-0.5 text-[11.5px] leading-snug text-fg/80">{output.copy}</p>
        )}
      </div>

      <div className="mt-2.5 h-[20px]">
        <AnimatePresence mode="popLayout" initial={false}>
          {chip && (
            <motion.span
              key={chip.label}
              className={cn('inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium', chip.cls)}
              initial={{ y: 12, opacity: 0, filter: 'blur(3px)' }}
              animate={{ y: 0, opacity: 1, filter: 'blur(0px)' }}
              exit={{ y: -12, opacity: 0, filter: 'blur(3px)' }}
              transition={{ duration: 0.45, ease }}
            >
              {phase === 4 ? <Check className="size-2.5" strokeWidth={3} /> : <span className={cn('size-1.5 rounded-full', chip.dot)} />}
              {chip.label}
            </motion.span>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
