import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronLeft, ChevronRight, Clock3, Plus, RotateCw } from 'lucide-react'
import { ease } from '../lib/motion'
import { cn } from '../lib/cn'
import { Field, STATUS, StatusBadge, type Status } from './mock/Mock'
import { DrawnBorder } from './ui/DrawnBorder'
import { PLATFORMS, PlatformIcon, type PlatformId } from './ui/PlatformIcon'
import { LineReveal, Reveal, Serif } from './ui/Reveal'
import { Caption, SectionLabel } from './ui/Section'

type Ev = {
  day: number
  start: number
  dur: number
  platform: PlatformId
  title: string
  kind: string
  status: Status
  copy: string
  note?: string
}

const DAYS = [
  { name: 'Monday', short: 'Mon', date: 5 },
  { name: 'Tuesday', short: 'Tue', date: 6 },
  { name: 'Wednesday', short: 'Wed', date: 7 },
  { name: 'Thursday', short: 'Thu', date: 8 },
  { name: 'Friday', short: 'Fri', date: 9 },
]
const TODAY = 2
const NOW = 14 + 20 / 60
const FIRST_HOUR = 8
const HOURS = 12
const ROW = 48

const EVENTS: Ev[] = [
  { day: 0, start: 9, dur: 1.25, platform: 'linkedin', title: 'Product announcement', kind: 'Post', status: 'published', copy: 'We spent 14 months on one question: why does planning your day take so much of it?' },
  { day: 0, start: 16, dur: 1, platform: 'x', title: 'Launch recap', kind: 'Post', status: 'published', copy: 'Day one: thank you. Here’s what we learned in the first 12 hours.' },
  { day: 1, start: 12.5, dur: 1.5, platform: 'instagram', title: 'Carousel', kind: '6 slides', status: 'failed', copy: 'Five ways to stop re-planning your week (slide 3 is the one people save).', note: 'Slide 4 is over the size limit. Swap it and retry.' },
  { day: 2, start: 9, dur: 1, platform: 'linkedin', title: 'Hiring post', kind: 'Post', status: 'published', copy: 'We’re hiring our first designer. Small team, big surface area.' },
  { day: 2, start: 17, dur: 1.5, platform: 'tiktok', title: 'Product video', kind: 'Video · 0:15', status: 'scheduled', copy: 'Hook: “I stopped planning my day.” Then a 12-second walkthrough.' },
  { day: 3, start: 10.5, dur: 1.5, platform: 'x', title: 'Educational thread', kind: 'Thread · 6', status: 'scheduled', copy: 'How to plan a week in 10 minutes — a thread.' },
  { day: 3, start: 15.5, dur: 1, platform: 'youtube', title: 'Short: 3 tips', kind: 'Short', status: 'scheduled', copy: 'Three planning habits that take under a minute each.' },
  { day: 4, start: 11, dur: 1.5, platform: 'instagram', title: 'Behind the scenes', kind: 'Reel', status: 'draft', copy: 'A day in the office, from the whiteboard to the 5pm demo.' },
  { day: 4, start: 16.5, dur: 1, platform: 'facebook', title: 'Weekly roundup', kind: 'Link post', status: 'draft', copy: 'Everything we shipped this week, in one place.' },
]

const fmt = (h: number) => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`

const TONE: Record<Status, string> = {
  published: 'border-l-ok bg-ok/[0.06]',
  scheduled: 'border-l-plan bg-plan/[0.08]',
  draft: 'border-l-draft bg-white/[0.03] border-dashed',
  failed: 'border-l-fail bg-fail/[0.08]',
}

export function Calendar() {
  const [selected, setSelected] = useState(4)
  const ev = EVENTS[selected]
  const counts = (Object.keys(STATUS) as Status[]).map((s) => ({ s, n: EVENTS.filter((e) => e.status === s).length }))

  return (
    <section id="calendar" className="relative py-28 md:py-40">
      <div className="container-x">
        <div className="grid gap-8 lg:grid-cols-12 lg:items-end">
          <div className="lg:col-span-8">
            <SectionLabel index="08">Calendar</SectionLabel>
            <LineReveal
              className="mt-10 text-[clamp(2.6rem,6vw,6.25rem)] font-medium leading-[0.92] tracking-[-0.05em]"
              lines={['See everything.', <Serif data-thread="circle">Plan ahead.</Serif>]}
            />
          </div>
          <Reveal delay={0.15} className="max-w-sm text-[17px] leading-snug text-muted lg:col-span-4">
            Every post, every platform, one week at a glance. Drafts, what’s queued, what went out — and what didn’t.
          </Reveal>
        </div>

        <div data-thread="rail">
        <Reveal y={40} className="mt-16 md:mt-24">
          <div className="relative overflow-hidden rounded-xl border border-white/[0.05] bg-[#0b0b0c] shadow-[0_60px_140px_-40px_rgb(0_0_0_/_0.9)]">
            <DrawnBorder />
            <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3 md:px-5">
              <p className="text-[15px] font-medium tracking-[-0.01em]">October 2026</p>
              <span className="font-mono text-[11px] text-dim">Oct 5 – 9</span>
              <div className="flex items-center gap-1 text-muted">
                <ChevronLeft className="size-4" />
                <ChevronRight className="size-4" />
              </div>
              <div className="ml-auto flex items-center gap-2">
                <div className="hidden rounded-md border border-line p-0.5 text-[12px] sm:flex">
                  <span className="rounded-[5px] bg-white/[0.08] px-2.5 py-1">Week</span>
                  <span className="px-2.5 py-1 text-dim">Month</span>
                </div>
                <span className="flex items-center gap-1.5 rounded-md bg-fg px-2.5 py-1.5 text-[12px] font-medium text-ink">
                  <Plus className="size-3.5" /> New post
                </span>
              </div>
            </div>

            <div className="flex flex-wrap gap-x-5 gap-y-2 border-b border-line px-4 py-2.5 text-[11.5px] text-muted md:px-5">
              {counts.map(({ s, n }) => (
                <span key={s} className="flex items-center gap-1.5">
                  <span className={cn('size-1.5 rounded-full', STATUS[s].dot)} />
                  {STATUS[s].label}
                  <span className="font-mono text-dim">{n}</span>
                </span>
              ))}
            </div>

            <div className="grid lg:grid-cols-[1fr_300px]">
              {/* Week grid — desktop and tablet */}
              <div className="hidden md:block">
                <div className="grid grid-cols-[52px_repeat(5,1fr)] border-b border-line">
                  <span />
                  {DAYS.map((d, i) => (
                    <div key={d.name} className="border-l border-line px-3 py-2.5">
                      <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-dim">{d.name}</p>
                      <p className={cn('mt-0.5 text-[18px] font-medium tracking-[-0.02em]', i === TODAY ? 'text-fg' : 'text-muted')}>
                        {d.date}
                        {i === TODAY && <span className="ml-2 align-middle font-mono text-[10px] text-accent-soft">today</span>}
                      </p>
                    </div>
                  ))}
                </div>
                <div className="relative grid grid-cols-[52px_repeat(5,1fr)]" style={{ height: HOURS * ROW }}>
                  <div className="relative">
                    {Array.from({ length: HOURS }).map((_, h) => (
                      <span key={h} className="absolute right-2 font-mono text-[10px] text-dim" style={{ top: h * ROW - 6 }}>
                        {h === 0 ? '' : fmt(FIRST_HOUR + h)}
                      </span>
                    ))}
                  </div>
                  {DAYS.map((d, di) => (
                    <div
                      key={d.name}
                      className={cn('relative border-l border-line', di === TODAY && 'bg-white/[0.015]')}
                      style={{
                        backgroundImage: `repeating-linear-gradient(180deg, transparent 0 ${ROW - 1}px, rgb(255 255 255 / 0.05) ${ROW - 1}px ${ROW}px)`,
                      }}
                    >
                      {di === TODAY && (
                        <div className="absolute inset-x-0 z-10 flex items-center" style={{ top: (NOW - FIRST_HOUR) * ROW }}>
                          <span className="-ml-[4px] size-2 rounded-full bg-accent" />
                          <span className="h-px flex-1 bg-accent" />
                        </div>
                      )}
                      {EVENTS.map((e, ei) =>
                        e.day !== di ? null : (
                          <motion.button
                            key={ei}
                            type="button"
                            onClick={() => setSelected(ei)}
                            initial={{ opacity: 0, y: -8 }}
                            whileInView={{ opacity: 1, y: 0 }}
                            viewport={{ once: true }}
                            transition={{ duration: 0.6, ease, delay: 0.1 + ei * 0.06 }}
                            className={cn(
                              'absolute inset-x-1.5 overflow-hidden rounded-md border border-l-2 border-transparent px-2 py-1.5 text-left transition-shadow',
                              TONE[e.status],
                              selected === ei && 'shadow-[0_0_0_1px_rgb(255_255_255_/_0.35)]',
                            )}
                            style={{ top: (e.start - FIRST_HOUR) * ROW + 2, height: e.dur * ROW - 4 }}
                          >
                            <p className="flex items-center gap-1.5 font-mono text-[10px] text-muted">
                              <PlatformIcon id={e.platform} className="size-3 text-fg" />
                              {fmt(e.start)}
                            </p>
                            <p className="mt-0.5 truncate text-[12px] font-medium leading-tight">{e.title}</p>
                            {e.dur >= 1.5 && <p className="truncate text-[10.5px] text-dim">{e.kind}</p>}
                          </motion.button>
                        ),
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Agenda — phones */}
              <div className="divide-y divide-line md:hidden">
                {DAYS.map((d, di) => (
                  <div key={d.name} className="px-4 py-3">
                    <p className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-dim">
                      {d.short} {d.date} {di === TODAY && <span className="text-accent-soft">· today</span>}
                    </p>
                    <div className="mt-2 space-y-1.5">
                      {EVENTS.map((e, ei) =>
                        e.day !== di ? null : (
                          <button
                            key={ei}
                            type="button"
                            onClick={() => setSelected(ei)}
                            className={cn('flex w-full items-center gap-2.5 rounded-md border border-l-2 border-transparent px-2.5 py-2 text-left', TONE[e.status])}
                          >
                            <PlatformIcon id={e.platform} className="size-3.5" />
                            <span className="text-[12.5px]">{e.title}</span>
                            <span className="ml-auto font-mono text-[10px] text-dim">{fmt(e.start)}</span>
                          </button>
                        ),
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Detail */}
              <aside className="border-t border-line p-5 lg:border-l lg:border-t-0">
                <AnimatePresence mode="wait">
                  <motion.div
                    key={selected}
                    initial={{ opacity: 0, x: 12 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -12 }}
                    transition={{ duration: 0.35, ease }}
                  >
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-2 text-[12.5px] text-muted">
                        <PlatformIcon id={ev.platform} className="size-4 text-fg" />
                        {PLATFORMS[ev.platform].name} · {ev.kind}
                      </span>
                      <StatusBadge status={ev.status} />
                    </div>
                    <p className="mt-5 text-xl font-medium leading-tight tracking-[-0.02em]">{ev.title}</p>
                    <p className="mt-2 flex items-center gap-1.5 font-mono text-[11px] text-dim">
                      <Clock3 className="size-3" />
                      {DAYS[ev.day].name}, Oct {DAYS[ev.day].date} · {fmt(ev.start)}
                    </p>
                    <Field className="mt-6">Copy</Field>
                    <p className="mt-2 text-[13.5px] leading-relaxed text-fg/85">{ev.copy}</p>
                    {ev.note && (
                      <p className="mt-5 rounded-md border border-fail/25 bg-fail/[0.06] px-3 py-2.5 text-[12.5px] leading-snug text-fail">
                        {ev.note}
                      </p>
                    )}
                    <div className="mt-6 flex gap-2 text-[12.5px]">
                      <span className="flex-1 rounded-md border border-line py-2 text-center text-muted">Edit</span>
                      <span className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-fg py-2 font-medium text-ink">
                        {ev.status === 'failed' ? (
                          <>
                            <RotateCw className="size-3.5" /> Retry
                          </>
                        ) : ev.status === 'draft' ? (
                          'Schedule'
                        ) : ev.status === 'scheduled' ? (
                          'Reschedule'
                        ) : (
                          'View post'
                        )}
                      </span>
                    </div>
                  </motion.div>
                </AnimatePresence>
              </aside>
            </div>
          </div>
        </Reveal>
        <Caption fig="08" className="mt-8">
          Click any post to open it. On a wide screen, the accent line is “now”.
        </Caption>
        </div>
      </div>
    </section>
  )
}
