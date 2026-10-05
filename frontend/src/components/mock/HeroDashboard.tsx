import type { ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, Clock3, CornerDownLeft, LoaderCircle, Play } from 'lucide-react'
import { ease } from '../../lib/motion'
import { cn } from '../../lib/cn'
import { useTypewriter } from '../../lib/useTypewriter'
import { GenArt } from '../ui/GenArt'
import { PlatformIcon } from '../ui/PlatformIcon'
import { AppFrame, Caret, Field, Sidebar } from './Mock'

export const PROMPT = 'Create a launch announcement for our new AI productivity app.'
/** typing → generating → generated → scheduled → published */
export const HERO_PHASES = [3200, 1900, 1700, 1500, 3000]

const MODELS = ['GPT', 'Claude', 'Gemini', 'Image Model', 'Video Model']
const TYPES = ['Text', 'Image', 'Video']

const POST =
  'Meet Tempo — the planner that reads your notes, tasks and meetings and hands you one clear plan for the day. Early access opens Monday.'

export function HeroDashboard({ phase, run }: { phase: number; run: boolean }) {
  const typed = useTypewriter(PROMPT, run && phase === 0, 28)
  const prompt = phase === 0 ? typed.value : PROMPT
  const generating = phase === 1
  const hasOutput = phase >= 2

  return (
    <AppFrame crumb="Create / New content" bodyClassName="flex h-[660px] md:h-[590px]">
      <Sidebar active="Create" className="hidden md:flex" />

      <div className="flex min-w-0 flex-1 flex-col gap-4 p-4 md:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[15px] font-medium tracking-[-0.01em]">Create Content</p>
            <p className="mt-0.5 text-[11.5px] text-dim">Launch · Tempo early access</p>
          </div>
          <PhaseStatus phase={phase} />
        </div>

        <div className="grid gap-3 md:grid-cols-[1fr_210px]">
          <div className="space-y-3">
            <div className="rounded-lg border border-line-2 bg-white/[0.025] p-3.5">
              <Field>Prompt</Field>
              <p className="mt-2 min-h-[42px] text-[13.5px] leading-snug text-fg">
                {prompt}
                {phase === 0 && <Caret />}
              </p>
              <div className="mt-3 flex items-center gap-2 text-[11px] text-muted">
                <span className="rounded-md border border-line px-2 py-0.5">Tone · Confident</span>
                <span className="hidden rounded-md border border-line px-2 py-0.5 sm:inline">Length · Medium</span>
                <span className="ml-auto font-mono text-[10.5px] text-dim">{prompt.length}/2000</span>
              </div>
            </div>

            <div>
              <Field>Model</Field>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {MODELS.map((m) => (
                  <span
                    key={m}
                    className={cn(
                      'rounded-md border px-2.5 py-1 text-[11.5px]',
                      m === 'Claude' ? 'border-fg/80 bg-fg text-ink' : 'border-line text-muted',
                    )}
                  >
                    {m}
                  </span>
                ))}
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <div>
              <Field>Content type</Field>
              <div className="mt-2 grid grid-cols-3 gap-1.5 md:grid-cols-1">
                {TYPES.map((t) => (
                  <span key={t} className="flex items-center gap-2 rounded-md border border-line px-2.5 py-1.5 text-[12px] text-fg">
                    <span className="grid size-3.5 place-items-center rounded-[3px] bg-accent">
                      <Check className="size-2.5 text-white" strokeWidth={3} />
                    </span>
                    {t}
                  </span>
                ))}
              </div>
            </div>
            <button
              type="button"
              tabIndex={-1}
              className={cn(
                'mt-auto flex h-9 items-center justify-center gap-2 rounded-md text-[12.5px] font-medium transition-colors duration-300',
                generating ? 'bg-white/10 text-fg' : 'bg-fg text-ink',
              )}
            >
              {generating ? (
                <>
                  <LoaderCircle className="size-3.5 animate-spin" /> Generating…
                </>
              ) : (
                <>
                  Generate Content
                  <span className="flex items-center gap-0.5 font-mono text-[10px] opacity-50">
                    ⌘<CornerDownLeft className="size-2.5" />
                  </span>
                </>
              )}
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1">
          <div className="flex items-center justify-between">
            <Field>Output</Field>
            <span className="font-mono text-[10px] text-dim">{hasOutput ? '3 assets' : generating ? 'working…' : '—'}</span>
          </div>
          <div className="mt-2 grid h-[calc(100%-22px)] grid-cols-3 gap-2.5">
            <OutputCard label="Post" state={phase}>
              <div className="flex h-full flex-col p-3">
                <div className="flex items-center gap-1.5 text-[10.5px] text-muted">
                  <PlatformIcon id="linkedin" className="size-3" /> LinkedIn
                </div>
                <p className="mt-2 line-clamp-5 text-[11.5px] leading-[1.45] text-fg/90 md:line-clamp-6">{POST}</p>
              </div>
            </OutputCard>
            <OutputCard label="Image · 4:5" state={phase}>
              <GenArt variant="product" className="h-full w-full" />
            </OutputCard>
            <OutputCard label="Video · 0:15" state={phase}>
              <GenArt variant="sun" className="h-full w-full">
                <div className="absolute inset-0 grid place-items-center">
                  <span className="grid size-8 place-items-center rounded-full bg-black/40 backdrop-blur">
                    <Play className="size-3.5 fill-white text-white" />
                  </span>
                </div>
                <div className="absolute inset-x-2.5 bottom-2.5 h-0.5 overflow-hidden rounded-full bg-white/25">
                  <motion.div
                    className="h-full origin-left bg-white"
                    initial={{ scaleX: 0 }}
                    animate={{ scaleX: hasOutput ? 1 : 0 }}
                    transition={{ duration: hasOutput ? 5 : 0, ease: 'linear' }}
                  />
                </div>
              </GenArt>
            </OutputCard>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-3.5 text-[11.5px] text-muted">
          <span className="flex items-center gap-1.5">
            <PlatformIcon id="linkedin" className="size-3.5 text-fg" />
            <PlatformIcon id="instagram" className="size-3.5 text-fg" />
            <PlatformIcon id="x" className="size-3.5 text-fg" />
            <span className="ml-1">3 platforms</span>
          </span>
          <span className="flex items-center gap-1.5">
            <Clock3 className="size-3.5" /> Tue, Oct 6 · 09:30
          </span>
          <span
            className={cn(
              'ml-auto rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors duration-500',
              phase >= 3 ? 'bg-accent text-white' : 'border border-line-2 text-fg',
            )}
          >
            {phase >= 4 ? 'Published' : phase >= 3 ? 'Scheduled' : 'Schedule'}
          </span>
        </div>
      </div>
    </AppFrame>
  )
}

function OutputCard({ label, state, children }: { label: string; state: number; children: ReactNode }) {
  return (
    <div className="relative flex min-h-0 flex-col overflow-hidden rounded-lg border border-line bg-white/[0.02]">
      <div className="relative min-h-0 flex-1">
        <AnimatePresence mode="wait" initial={false}>
          {state >= 2 ? (
            <motion.div
              key="out"
              className="absolute inset-0"
              initial={{ opacity: 0, filter: 'blur(8px)', scale: 1.04 }}
              animate={{ opacity: 1, filter: 'blur(0px)', scale: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.8, ease }}
            >
              {children}
            </motion.div>
          ) : state === 1 ? (
            <motion.div key="load" className="absolute inset-0 skeleton" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
          ) : (
            <motion.div
              key="empty"
              className="absolute inset-2 rounded-md border border-dashed border-white/10"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            />
          )}
        </AnimatePresence>
      </div>
      <p className="border-t border-line px-2.5 py-1.5 font-mono text-[10px] text-dim">{label}</p>
    </div>
  )
}

const PHASE_LABEL = ['Draft', 'Generating…', 'Generated', 'Scheduled · Tue 09:30', 'Published to 3 platforms']

function PhaseStatus({ phase }: { phase: number }) {
  return (
    <div className="relative h-7 overflow-hidden">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={phase}
          initial={{ y: 16, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -16, opacity: 0 }}
          transition={{ duration: 0.45, ease }}
          className={cn(
            'flex h-7 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 text-[11px] font-medium',
            phase === 4 ? 'border-ok/30 text-ok' : phase >= 2 ? 'border-plan/30 text-plan' : 'border-line-2 text-muted',
          )}
        >
          {phase === 1 ? (
            <LoaderCircle className="size-3 animate-spin" />
          ) : phase >= 2 ? (
            <Check className="size-3" strokeWidth={2.5} />
          ) : (
            <span className="size-1.5 rounded-full bg-draft" />
          )}
          {PHASE_LABEL[phase]}
        </motion.span>
      </AnimatePresence>
    </div>
  )
}
