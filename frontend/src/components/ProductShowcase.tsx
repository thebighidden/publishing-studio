import { useRef, useState, type ReactNode } from 'react'
import { motion, useInView, useScroll, useTransform } from 'framer-motion'
import { Check, ChevronDown, Clock3, Globe, RefreshCw, SquarePen } from 'lucide-react'
import { cn } from '../lib/cn'
import { useLoop } from '../lib/useLoop'
import { AppFrame, Field, Sidebar } from './mock/Mock'
import { GenArt } from './ui/GenArt'
import { PLATFORMS, PlatformIcon, type PlatformId } from './ui/PlatformIcon'
import { LineReveal, Reveal, Serif } from './ui/Reveal'
import { Caption, SectionLabel } from './ui/Section'

const PARTS = [
  { title: 'Prompt', body: 'Describe what you want, in plain words.' },
  { title: 'Model', body: 'Pick the model that suits the job.' },
  { title: 'Format', body: 'Text, image, video — or all three.' },
  { title: 'Result', body: 'Review variations. Edit anything.' },
  { title: 'Platforms', body: 'Choose where it should go.' },
  { title: 'Schedule', body: 'Pick a time, or let it repeat.' },
  { title: 'Publish', body: 'The last click. Everything else is handled.' },
]
const CYCLE = PARTS.map(() => 2200)

const CHANNELS: Array<{ id: PlatformId; format: string; on: boolean }> = [
  { id: 'instagram', format: 'Feed · 4:5', on: true },
  { id: 'linkedin', format: 'Post · 1.91:1', on: true },
  { id: 'x', format: 'Post · 16:9', on: true },
  { id: 'tiktok', format: 'Video · 9:16', on: false },
  { id: 'pinterest', format: 'Pin · 2:3', on: false },
]

export function ProductShowcase() {
  const frameRef = useRef<HTMLDivElement>(null)
  const inView = useInView(frameRef, { margin: '-20% 0px' })
  const [hovered, setHovered] = useState<number | null>(null)
  const auto = useLoop(CYCLE, inView && hovered === null)
  const active = hovered ?? auto + 1

  const { scrollYProgress } = useScroll({ target: frameRef, offset: ['start end', 'center center'] })
  const scale = useTransform(scrollYProgress, [0, 1], [0.93, 1])
  const y = useTransform(scrollYProgress, [0, 1], [60, 0])

  const region = (n: number, children: ReactNode, className?: string) => (
    <Region n={n} active={active === n} onHover={setHovered} className={className}>
      {children}
    </Region>
  )

  return (
    <section id="product" className="relative py-28 md:py-40">
      <div className="container-x">
        <SectionLabel index="02">Workspace</SectionLabel>
        <div className="mt-10 grid gap-8 lg:grid-cols-12 lg:items-end">
          <LineReveal
            className="text-[clamp(2.6rem,7.2vw,7.75rem)] font-medium leading-[0.88] tracking-[-0.055em] lg:col-span-9"
            lines={['One workspace', 'for your entire', <Serif data-thread="underline">content workflow.</Serif>]}
          />
          <Reveal delay={0.15} className="max-w-sm text-[17px] leading-snug text-muted lg:col-span-3 lg:justify-self-end">
            Generate, customize, schedule and publish content without jumping between different tools.
          </Reveal>
        </div>

        <div data-thread="rail">
        <motion.div ref={frameRef} style={{ scale, y }} className="mt-16 md:mt-24" onMouseLeave={() => setHovered(null)}>
          <AppFrame crumb="Create / Spring collection" bodyClassName="flex">
            <Sidebar active="Create" className="hidden xl:flex" />

            <div className="grid min-w-0 flex-1 lg:grid-cols-[1fr_300px]">
              <div className="space-y-5 p-5 md:p-7">
                {region(
                  1,
                  <div className="rounded-lg border border-line-2 bg-white/[0.025] p-4">
                    <Field>Prompt</Field>
                    <p className="mt-2 text-[14px] leading-relaxed">
                      Write a spring launch post for our linen collection. Warm, not salesy. Mention free returns and the
                      new sand colour.
                    </p>
                  </div>,
                )}

                <div className="grid gap-4 sm:grid-cols-2">
                  {region(
                    2,
                    <div className="space-y-2 p-3">
                      <Field>Models</Field>
                      <Select label="Text" value="Claude" />
                      <Select label="Image" value="Flux" />
                    </div>,
                  )}
                  {region(
                    3,
                    <div className="space-y-2 p-3">
                      <Field>Content type</Field>
                      <div className="grid grid-cols-3 rounded-md border border-line p-0.5 text-center text-[12px]">
                        <span className="rounded-[5px] bg-white/[0.08] py-1.5 text-fg">Text</span>
                        <span className="rounded-[5px] bg-white/[0.08] py-1.5 text-fg">Image</span>
                        <span className="py-1.5 text-dim">Video</span>
                      </div>
                      <p className="pt-1 text-[11.5px] text-dim">2 formats · 3 variations each</p>
                    </div>,
                  )}
                </div>

                {region(
                  4,
                  <div className="rounded-lg border border-line bg-white/[0.02] p-3">
                    <div className="flex items-center justify-between px-1 pb-3">
                      <Field>Result</Field>
                      <div className="flex items-center gap-3 text-[11px] text-muted">
                        <span className="font-mono text-dim">2 / 3</span>
                        <RefreshCw className="size-3.5" />
                        <SquarePen className="size-3.5" />
                      </div>
                    </div>
                    <div className="grid grid-cols-[96px_1fr] gap-4 sm:grid-cols-[160px_1fr]">
                      <GenArt variant="dune" className="aspect-[4/5] rounded-md" />
                      <div className="text-[13px] leading-relaxed text-fg/90">
                        <p>Linen, but make it spring.</p>
                        <p className="mt-2">
                          Our new collection lands today — including the sand colour you kept asking about. Breathable,
                          easy, and made to be lived in.
                        </p>
                        <p className="mt-2 text-muted">Free returns, always. Tap the link to see the full drop.</p>
                        <p className="mt-3 font-mono text-[10.5px] text-dim">312 characters · warm · 1 image</p>
                      </div>
                    </div>
                  </div>,
                )}
              </div>

              <div className="space-y-5 border-t border-line p-5 md:p-7 lg:border-l lg:border-t-0">
                {region(
                  5,
                  <div className="p-3">
                    <Field>Platforms</Field>
                    <ul className="mt-2.5 space-y-1">
                      {CHANNELS.map((c) => (
                        <li key={c.id} className="flex items-center gap-2.5 rounded-md px-1 py-1.5 text-[12.5px]">
                          <span
                            className={cn(
                              'grid size-3.5 place-items-center rounded-[3px] border',
                              c.on ? 'border-accent bg-accent' : 'border-line-2',
                            )}
                          >
                            {c.on && <Check className="size-2.5 text-white" strokeWidth={3} />}
                          </span>
                          <PlatformIcon id={c.id} className={cn('size-3.5', c.on ? 'text-fg' : 'text-dim')} />
                          <span className={c.on ? 'text-fg' : 'text-dim'}>{PLATFORMS[c.id].name}</span>
                          <span className="ml-auto font-mono text-[10px] text-dim">{c.format}</span>
                        </li>
                      ))}
                    </ul>
                  </div>,
                )}

                {region(
                  6,
                  <div className="space-y-2 p-3">
                    <Field>Schedule</Field>
                    <div className="grid grid-cols-2 gap-2 text-[12.5px]">
                      <span className="rounded-md border border-line px-2.5 py-2">Thu, Oct 8</span>
                      <span className="flex items-center gap-1.5 rounded-md border border-line px-2.5 py-2">
                        <Clock3 className="size-3.5 text-dim" /> 18:00
                      </span>
                    </div>
                    <p className="flex items-center gap-1.5 text-[11.5px] text-dim">
                      <Globe className="size-3" /> Europe/Lisbon · repeats never
                    </p>
                  </div>,
                )}

                {region(
                  7,
                  <div className="space-y-2 p-3">
                    <div className="flex h-10 items-center justify-center rounded-md bg-fg text-[13px] font-medium text-ink">
                      Schedule 3 posts
                    </div>
                    <div className="flex h-10 items-center justify-center rounded-md border border-line text-[13px] text-muted">
                      Publish now
                    </div>
                  </div>,
                )}
              </div>
            </div>
          </AppFrame>
        </motion.div>

        <div className="mt-10 grid grid-cols-2 gap-x-6 gap-y-6 sm:grid-cols-4 lg:grid-cols-7">
          {PARTS.map((p, i) => (
            <button
              key={p.title}
              type="button"
              onMouseEnter={() => setHovered(i + 1)}
              onMouseLeave={() => setHovered(null)}
              onFocus={() => setHovered(i + 1)}
              onBlur={() => setHovered(null)}
              className="group flex flex-col items-start border-t pt-3 text-left transition-colors duration-500"
              style={{ borderColor: active === i + 1 ? 'var(--color-fg)' : 'var(--color-line-2)' }}
            >
              <span className={cn('font-mono text-[11px] transition-colors', active === i + 1 ? 'text-accent-soft' : 'text-dim')}>
                0{i + 1}
              </span>
              <p className="mt-1 text-[15px] font-medium tracking-[-0.01em]">{p.title}</p>
              <p className="mt-1 text-[13px] leading-snug text-muted">{p.body}</p>
            </button>
          ))}
        </div>
        <Caption fig="02" className="mt-10">
          The composer. Every step of a post, one screen.
        </Caption>
        </div>
      </div>
    </section>
  )
}

function Region({
  n,
  active,
  onHover,
  className,
  children,
}: {
  n: number
  active: boolean
  onHover: (n: number) => void
  className?: string
  children: ReactNode
}) {
  return (
    <div
      onMouseEnter={() => onHover(n)}
      className={cn(
        'relative rounded-lg transition-[box-shadow] duration-500',
        active ? 'shadow-[0_0_0_1.5px_var(--color-accent),0_0_0_6px_color-mix(in_oklab,var(--color-accent)_12%,transparent)]' : 'shadow-[0_0_0_1.5px_transparent]',
        className,
      )}
    >
      <span
        className={cn(
          'absolute -left-2.5 -top-2.5 z-10 grid size-5 place-items-center rounded-full font-mono text-[10px] transition-colors duration-500',
          active ? 'bg-accent text-on-accent' : 'border border-line-2 bg-[#161618] text-muted',
        )}
      >
        {n}
      </span>
      {children}
    </div>
  )
}

function Select({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-md border border-line px-2.5 py-2 text-[12.5px]">
      <span className="text-dim">{label}</span>
      <span className="flex items-center gap-1.5">
        {value}
        <ChevronDown className="size-3 text-dim" />
      </span>
    </div>
  )
}
