import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Bookmark, ChevronDown, Minus, Plus } from 'lucide-react'
import { ease } from '../lib/motion'
import { cn } from '../lib/cn'
import { Field } from './mock/Mock'
import { DrawnBorder } from './ui/DrawnBorder'
import { LineReveal, Reveal, Serif } from './ui/Reveal'
import { SectionLabel } from './ui/Section'

const GROUPS = [
  { title: 'AI Model', items: [{ name: 'GPT', note: 'text' }, { name: 'Claude', note: 'text' }, { name: 'Gemini', note: 'text' }] },
  { title: 'Image Model', items: [{ name: 'Flux', note: 'image' }] },
  { title: 'Video Model', items: [{ name: 'Runway', note: 'video' }] },
]

const TONES = ['Confident', 'Playful', 'Technical'] as const
type Tone = (typeof TONES)[number]

const OUTPUT: Record<Tone, string[]> = {
  Confident: [
    'Your notes, tasks and meetings — turned into one plan. Tempo is live Monday.',
    'Stop planning your day. Start having it. Early access opens Monday.',
    'One plan for your whole day, built from everything you already write down.',
    'We built the planner we always wanted. It’s ready Monday.',
  ],
  Playful: [
    'Your to-do list called. It wants a manager. Meet Tempo — Monday.',
    'Tempo reads your chaos and hands back a plan. Coffee not included (yet).',
    'Monday just got a glow-up. Early access opens soon 👀',
    'Notes everywhere? Same. Tempo sorts them out, starting Monday.',
  ],
  Technical: [
    'Tempo merges notes, tasks and calendar events into a single ranked plan.',
    'New: calendar + task sync, priority scoring and a daily plan at 07:00.',
    'Imports from the tools you already use. No migration, no new habits.',
    'Plans recalculate as meetings move, so the day stays realistic.',
  ],
}

const FEATURES = [
  'Choose the right model for each task',
  'Generate multiple variations',
  'Control tone and style',
  'Reuse prompts',
  'Create reusable workflows',
]

export function AIGeneration() {
  const [model, setModel] = useState('Claude')
  const [image, setImage] = useState(true)
  const [video, setVideo] = useState(false)
  const [tone, setTone] = useState<Tone>('Confident')
  const [count, setCount] = useState(3)
  const [loading, setLoading] = useState(false)
  const [runId, setRunId] = useState(0)

  // Any change "regenerates": a short loading beat, then the new set fades in.
  useEffect(() => {
    setLoading(true)
    const t = window.setTimeout(() => {
      setLoading(false)
      setRunId((r) => r + 1)
    }, 750)
    return () => window.clearTimeout(t)
  }, [model, tone, count])

  const pick = (name: string, kind: string) => {
    if (kind === 'text') setModel(name)
    else if (kind === 'image') setImage((v) => !v)
    else setVideo((v) => !v)
  }

  return (
    <section id="studio" className="relative py-28 md:py-40">
      <div className="container-x grid gap-16 lg:grid-cols-12 lg:gap-10">
        <div className="lg:col-span-5">
          <div>
            <SectionLabel index="03">Models</SectionLabel>
            <LineReveal
              className="mt-10 text-[clamp(2.4rem,4.1vw,4.4rem)] font-medium leading-[0.95] tracking-[-0.045em]"
              lines={['Choose the model.', <Serif data-thread="circle" data-exit="down">Define the outcome.</Serif>]}
            />
            <Reveal delay={0.15} className="mt-8 max-w-sm text-[17px] leading-snug text-muted">
              Give creators control over the AI models powering their content.
            </Reveal>
            <div data-thread="rail" data-side="left">
            <ul className="mt-10 border-t border-line">
              {FEATURES.map((f, i) => (
                <Reveal as="li" key={f} delay={0.05 * i} y={12} className="flex items-baseline gap-5 border-b border-line py-3.5 text-[15px]">
                  <span className="font-mono text-[11px] text-dim">0{i + 1}</span>
                  {f}
                </Reveal>
              ))}
            </ul>
            <p className="mt-6 font-mono text-[11px] leading-relaxed text-dim">
              Providers shown are examples. The line-up can change.
            </p>
            </div>
          </div>
        </div>

        <Reveal className="lg:col-span-7" y={40}>
          <div className="relative overflow-hidden rounded-xl border border-white/[0.05] bg-[#0b0b0c] shadow-[0_60px_120px_-40px_rgb(0_0_0_/_0.9)]">
            <DrawnBorder />
            <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
              <p className="text-[13.5px] font-medium">Generation settings</p>
              <span className="flex items-center gap-2 rounded-md border border-line px-2.5 py-1 text-[11.5px] text-muted">
                <Bookmark className="size-3" /> Saved prompt: Launch post
                <ChevronDown className="size-3 text-dim" />
              </span>
            </div>

            <div className="grid md:grid-cols-[1fr_1.1fr]">
              <div className="space-y-5 border-b border-line p-5 md:border-b-0 md:border-r">
                {GROUPS.map((g) => (
                  <div key={g.title}>
                    <Field>{g.title}</Field>
                    <div className="mt-2 space-y-1">
                      {g.items.map((it) => {
                        const selected = it.note === 'text' ? model === it.name : it.note === 'image' ? image : video
                        return (
                          <button
                            key={it.name}
                            type="button"
                            aria-pressed={selected}
                            onClick={() => pick(it.name, it.note)}
                            className={cn(
                              'flex w-full items-center gap-3 rounded-md border px-3 py-2.5 text-left text-[13px] transition-colors duration-300',
                              selected ? 'border-white/25 bg-white/[0.05] text-fg' : 'border-line text-muted hover:border-white/15',
                            )}
                          >
                            <span
                              className={cn(
                                'grid size-3.5 place-items-center rounded-full border transition-colors',
                                selected ? 'border-accent' : 'border-line-2',
                              )}
                            >
                              {selected && <motion.span layoutId={it.note === 'text' ? 'radio' : undefined} className="size-1.5 rounded-full bg-accent" />}
                            </span>
                            {it.name}
                            <span className="ml-auto font-mono text-[10px] text-dim">{it.note}</span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>

              <div className="space-y-5 p-5">
                <div>
                  <Field>Tone</Field>
                  <div className="relative mt-2 grid grid-cols-3 rounded-md border border-line p-0.5 text-[12.5px]">
                    {TONES.map((t) => (
                      <button
                        key={t}
                        type="button"
                        aria-pressed={tone === t}
                        onClick={() => setTone(t)}
                        className={cn('relative py-1.5 transition-colors', tone === t ? 'text-ink' : 'text-muted hover:text-fg')}
                      >
                        {tone === t && (
                          <motion.span
                            layoutId="tone"
                            className="absolute inset-0 rounded-[5px] bg-fg"
                            transition={{ type: 'spring', stiffness: 500, damping: 40 }}
                          />
                        )}
                        <span className="relative">{t}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <Field>Variations</Field>
                    <p className="mt-1 text-[12px] text-dim">Pick the best, discard the rest.</p>
                  </div>
                  <div className="flex items-center rounded-md border border-line">
                    <button
                      type="button"
                      aria-label="Fewer variations"
                      onClick={() => setCount((c) => Math.max(1, c - 1))}
                      className="grid size-8 place-items-center text-muted hover:text-fg"
                    >
                      <Minus className="size-3.5" />
                    </button>
                    <span className="w-6 text-center font-mono text-[13px] tabular-nums">{count}</span>
                    <button
                      type="button"
                      aria-label="More variations"
                      onClick={() => setCount((c) => Math.min(4, c + 1))}
                      className="grid size-8 place-items-center text-muted hover:text-fg"
                    >
                      <Plus className="size-3.5" />
                    </button>
                  </div>
                </div>

                <div className="rounded-md border border-dashed border-line-2 px-3 py-2.5 text-[12px] leading-relaxed text-muted">
                  <span className="text-fg">Style notes:</span> short sentences, no hype words, end with the date.
                </div>
              </div>
            </div>

            <div className="border-t border-line p-5">
              <div className="flex items-center justify-between">
                <Field>Output</Field>
                <span className="font-mono text-[10.5px] text-dim">
                  {loading ? 'generating…' : `${model}${image ? ' + Flux' : ''}${video ? ' + Runway' : ''} ·${tone.toLowerCase()} · ${count}×`}
                </span>
              </div>
              <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
                <AnimatePresence mode="popLayout" initial={false}>
                  {Array.from({ length: count }).map((_, i) =>
                    loading ? (
                      <motion.div
                        key={`s-${i}`}
                        className="h-[92px] rounded-md skeleton"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                      />
                    ) : (
                      <motion.div
                        key={`o-${runId}-${i}`}
                        layout
                        initial={{ opacity: 0, y: 10, filter: 'blur(6px)' }}
                        animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.5, ease, delay: i * 0.06 }}
                        className="flex h-[92px] flex-col justify-between rounded-md border border-line bg-white/[0.02] p-3"
                      >
                        <p className="text-[12.5px] leading-snug text-fg/90">{OUTPUT[tone][i]}</p>
                        <span className="font-mono text-[10px] text-dim">V{i + 1}</span>
                      </motion.div>
                    ),
                  )}
                </AnimatePresence>
              </div>
            </div>
          </div>
          <p className="mt-4 font-mono text-[11px] text-dim">↑ Try it — change the model, tone or count.</p>
        </Reveal>
      </div>
    </section>
  )
}
