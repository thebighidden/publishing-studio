import { useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { motion, useInView } from 'framer-motion'
import { ArrowDownRight, ArrowUpRight, ChevronDown } from 'lucide-react'
import { ease } from '../lib/motion'
import { cn } from '../lib/cn'
import { AppFrame, Field } from './mock/Mock'
import { PLATFORMS, PlatformIcon, type PlatformId } from './ui/PlatformIcon'
import { LineReveal, Reveal, Serif } from './ui/Reveal'
import { Caption, SectionLabel } from './ui/Section'

/* ------------------------------------------------------------------ */
/* Illustrative data — seeded, so it's the same on every load           */
/* ------------------------------------------------------------------ */

/** Chart series colour; validated against the #0b0b0c surface (L band, chroma, ≥3:1). */
const SERIES = '#7c80f7'
const SURFACE = '#0b0b0c'

function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

type Day = { date: Date; reach: number; engagement: number; clicks: number; posts: number }

const END = new Date(2026, 9, 7)
const HISTORY: Day[] = (() => {
  const r = mulberry32(11)
  return Array.from({ length: 180 }, (_, i) => {
    const date = new Date(END)
    date.setDate(END.getDate() - (179 - i))
    const weekday = date.getDay() > 0 && date.getDay() < 6
    const reach = Math.round(4300 + i * 17 + 1100 * Math.sin(i / 5.5) + (weekday ? 900 : -700) + r() * 1300)
    return {
      date,
      reach,
      engagement: 4.1 + 0.9 * Math.sin(i / 9 + 1) + r() * 0.7 + i * 0.004,
      clicks: Math.round(reach * (0.028 + r() * 0.012)),
      posts: weekday ? 2 + Math.floor(r() * 3) : Math.floor(r() * 2),
    }
  })
})()

const SHARE: Array<{ id: PlatformId; share: number }> = [
  { id: 'instagram', share: 0.31 },
  { id: 'linkedin', share: 0.24 },
  { id: 'tiktok', share: 0.2 },
  { id: 'x', share: 0.12 },
  { id: 'youtube', share: 0.08 },
  { id: 'facebook', share: 0.05 },
]

const TOP_POSTS: Array<{ title: string; id: PlatformId; daysAgo: number; reach: number; rate: number }> = [
  { title: '“I stopped planning my day.”', id: 'tiktok', daysAgo: 2, reach: 48210, rate: 9.1 },
  { title: 'Product announcement', id: 'linkedin', daysAgo: 5, reach: 31740, rate: 6.4 },
  { title: '5 ways to stop re-planning your week', id: 'instagram', daysAgo: 12, reach: 22930, rate: 7.8 },
  { title: 'How to plan a week in 10 minutes', id: 'x', daysAgo: 18, reach: 14350, rate: 4.2 },
  { title: 'Behind the scenes: launch day', id: 'instagram', daysAgo: 41, reach: 39120, rate: 8.3 },
  { title: 'Why we built Tempo', id: 'youtube', daysAgo: 66, reach: 27480, rate: 5.6 },
]

const RANGES = [7, 30, 90] as const
type Range = (typeof RANGES)[number]

const compact = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}K` : `${Math.round(n)}`)
const grouped = (n: number) => Math.round(n).toLocaleString('en-US')
const shortDate = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
const longDate = (d: Date) => d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
const avg = (xs: number[]) => sum(xs) / xs.length

/** Collapse a series into at most `n` evenly sized buckets (for sparklines). */
function buckets(xs: number[], n: number) {
  if (xs.length <= n) return xs
  const size = xs.length / n
  return Array.from({ length: n }, (_, i) => avg(xs.slice(Math.floor(i * size), Math.floor((i + 1) * size))))
}

/* ------------------------------------------------------------------ */

export function Analytics() {
  const [range, setRange] = useState<Range>(30)

  const view = useMemo(() => {
    const cur = HISTORY.slice(-range)
    const prev = HISTORY.slice(-range * 2, -range)
    const metric = (pick: (d: Day) => number, agg: (xs: number[]) => number) => {
      const now = agg(cur.map(pick))
      const before = agg(prev.map(pick))
      return { now, delta: ((now - before) / before) * 100, trend: buckets(cur.map(pick), 12) }
    }
    const reach = metric((d) => d.reach, sum)
    return {
      cur,
      tiles: [
        { label: 'Posts published', value: grouped(metric((d) => d.posts, sum).now), ...metric((d) => d.posts, sum) },
        { label: 'Engagement rate', value: `${metric((d) => d.engagement, avg).now.toFixed(1)}%`, ...metric((d) => d.engagement, avg) },
        { label: 'Reach', value: compact(reach.now), ...reach },
        { label: 'Clicks', value: compact(metric((d) => d.clicks, sum).now), ...metric((d) => d.clicks, sum) },
      ],
      platforms: SHARE.map((p) => ({ ...p, reach: reach.now * p.share })),
      top: TOP_POSTS.filter((p) => p.daysAgo < range)
        .sort((a, b) => b.reach - a.reach)
        .slice(0, 4),
    }
  }, [range])

  return (
    <section id="analytics" className="relative py-28 md:py-40">
      <div className="container-x">
        <div className="grid gap-8 lg:grid-cols-12 lg:items-end">
          <div className="lg:col-span-8">
            <SectionLabel index="10">Analytics</SectionLabel>
            <LineReveal
              className="mt-10 text-[clamp(2.6rem,6vw,6.25rem)] font-medium leading-[0.92] tracking-[-0.05em]"
              lines={['Create smarter', <Serif data-thread="underline" data-loop="">content.</Serif>]}
            />
          </div>
          <Reveal delay={0.15} className="max-w-sm text-[17px] leading-snug text-muted lg:col-span-4">
            See what landed, where, and why — then feed it back into the next thing you make.
          </Reveal>
        </div>

        <div data-thread="rail">
        <Reveal y={40} className="mt-16 md:mt-24">
          <AppFrame crumb="Analytics / Overview" bodyClassName="p-4 md:p-6">
            {/* Filters: one row, above everything they scope */}
            <div className="flex flex-wrap items-center gap-2">
              <div role="radiogroup" aria-label="Date range" className="flex rounded-md border border-line p-0.5 text-[12px]">
                {RANGES.map((r) => (
                  <button
                    key={r}
                    type="button"
                    role="radio"
                    aria-checked={range === r}
                    onClick={() => setRange(r)}
                    className={cn(
                      'relative rounded-[5px] px-3 py-1.5 transition-colors',
                      range === r ? 'text-fg' : 'text-dim hover:text-muted',
                    )}
                  >
                    {range === r && (
                      <motion.span layoutId="range" className="absolute inset-0 rounded-[5px] bg-white/[0.08]" transition={{ type: 'spring', stiffness: 500, damping: 40 }} />
                    )}
                    <span className="relative">Last {r} days</span>
                  </button>
                ))}
              </div>
              <span className="flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-[12px] text-muted">
                All platforms <ChevronDown className="size-3 text-dim" />
              </span>
              <span className="ml-auto rounded-full border border-dashed border-line-2 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-dim">
                Sample data
              </span>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line lg:grid-cols-4">
              {view.tiles.map((t) => (
                <StatTile key={t.label} label={t.label} value={t.value} delta={t.delta} trend={t.trend} range={range} />
              ))}
            </div>

            <div className="mt-4 grid gap-4 lg:grid-cols-[1.65fr_1fr]">
              <ReachChart days={view.cur} range={range} />
              <PlatformBars rows={view.platforms} />
            </div>

            <TopContent rows={view.top} range={range} />
          </AppFrame>
        </Reveal>
        <Caption fig="10" className="mt-8">
          Illustrative numbers, not customer statistics. Switch the range — everything on the board follows.
        </Caption>
        </div>
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ */

function StatTile({ label, value, delta, trend, range }: { label: string; value: string; delta: number; trend: number[]; range: number }) {
  const up = delta >= 0
  const w = 96
  const h = 28
  const min = Math.min(...trend)
  const max = Math.max(...trend)
  const pts = trend.map((v, i) => [(i / (trend.length - 1)) * w, h - 3 - ((v - min) / (max - min || 1)) * (h - 6)] as const)
  const last = pts[pts.length - 1]

  return (
    <div className="bg-[#0b0b0c] p-4 md:p-5">
      <p className="text-[12.5px] text-muted">{label}</p>
      <div className="mt-3 flex items-end justify-between gap-3">
        <p className="text-[28px] font-semibold leading-none tracking-[-0.03em] md:text-[32px]">{value}</p>
        <svg width={w} height={h} className="hidden shrink-0 overflow-visible sm:block" aria-hidden>
          <polyline
            points={pts.map((p) => p.join(',')).join(' ')}
            fill="none"
            stroke="rgb(255 255 255 / 0.28)"
            strokeWidth={1.5}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          <circle cx={last[0]} cy={last[1]} r={3} fill={SERIES} stroke={SURFACE} strokeWidth={2} />
        </svg>
      </div>
      <p className={cn('mt-3 flex items-center gap-1 text-[11.5px]', up ? 'text-ok' : 'text-fail')}>
        {up ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}
        {up ? '+' : '−'}
        {Math.abs(delta).toFixed(1)}%<span className="ml-1 text-dim">vs prev. {range} days</span>
      </p>
    </div>
  )
}

/* ------------------------------------------------------------------ */

const PAD = { top: 16, right: 52, bottom: 28, left: 44 }
const CHART_H = 260

function niceStep(max: number, ticks = 4) {
  const raw = max / ticks
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].find((s) => s * mag >= raw) ?? 10
  return step * mag
}

function ReachChart({ days, range }: { days: Day[]; range: Range }) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const inView = useInView(wrapRef, { once: true, margin: '-15% 0px' })
  const [width, setWidth] = useState(640)
  const [hover, setHover] = useState<number | null>(null)
  const [mode, setMode] = useState<'chart' | 'table'>('chart')

  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const values = days.map((d) => d.reach)
  const step = niceStep(Math.max(...values))
  const yMax = Math.ceil(Math.max(...values) / step) * step
  const ticks = Array.from({ length: Math.round(yMax / step) + 1 }, (_, i) => i * step)

  const innerW = Math.max(10, width - PAD.left - PAD.right)
  const innerH = CHART_H - PAD.top - PAD.bottom
  const x = (i: number) => PAD.left + (i / (days.length - 1)) * innerW
  const y = (v: number) => PAD.top + innerH - (v / yMax) * innerH

  const line = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('')
  const area = `${line}L${x(values.length - 1)},${y(0)}L${x(0)},${y(0)}Z`
  const xTicks = Array.from({ length: 5 }, (_, k) => Math.round((k / 4) * (days.length - 1)))
  const lastI = values.length - 1

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const i = Math.round(((e.clientX - r.left - PAD.left) / innerW) * (days.length - 1))
    setHover(Math.min(lastI, Math.max(0, i)))
  }
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    setHover((h) => Math.min(lastI, Math.max(0, (h ?? lastI) + (e.key === 'ArrowRight' ? 1 : -1))))
  }

  const hi = hover ?? null
  const tipLeft = hi === null ? 0 : Math.min(width - 150, Math.max(0, x(hi) - 75))

  return (
    <div className="min-w-0 rounded-lg border border-line p-4 md:p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[13.5px] font-medium">Reach per day</p>
          <p className="mt-0.5 text-[11.5px] text-dim">Unique accounts reached · all platforms</p>
        </div>
        <div className="flex rounded-md border border-line p-0.5 text-[11px]">
          {(['chart', 'table'] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => setMode(m)}
              className={cn('rounded-[4px] px-2 py-1 capitalize', mode === m ? 'bg-white/[0.08] text-fg' : 'text-dim')}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      <div ref={wrapRef} className="relative mt-4" style={{ height: CHART_H }}>
        {mode === 'chart' ? (
          <>
            <svg
              width={width}
              height={CHART_H}
              tabIndex={0}
              role="img"
              aria-label={`Reach per day over the last ${range} days. Use left and right arrow keys to read values.`}
              onPointerMove={onMove}
              onPointerLeave={() => setHover(null)}
              onFocus={() => setHover(lastI)}
              onBlur={() => setHover(null)}
              onKeyDown={onKey}
              className="block touch-pan-y outline-none"
            >
              {ticks.map((t) => (
                <g key={t}>
                  <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} stroke="rgb(255 255 255 / 0.06)" />
                  <text x={PAD.left - 10} y={y(t)} dy="0.32em" textAnchor="end" className="fill-dim font-mono text-[10px]">
                    {t === 0 ? '0' : compact(t)}
                  </text>
                </g>
              ))}
              {xTicks.map((i) => (
                <text key={i} x={x(i)} y={CHART_H - 8} textAnchor="middle" className="fill-dim font-mono text-[10px]">
                  {shortDate(days[i].date)}
                </text>
              ))}

              <motion.path
                key={`a-${range}`}
                d={area}
                fill={SERIES}
                initial={{ opacity: 0 }}
                animate={{ opacity: inView ? 0.1 : 0 }}
                transition={{ duration: 1, delay: 0.5 }}
              />
              <motion.path
                key={`l-${range}`}
                d={line}
                fill="none"
                stroke={SERIES}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
                initial={{ pathLength: 0 }}
                animate={{ pathLength: inView ? 1 : 0 }}
                transition={{ duration: 1.4, ease }}
              />

              {/* Direct label on the latest value */}
              <circle cx={x(lastI)} cy={y(values[lastI])} r={4} fill={SERIES} stroke={SURFACE} strokeWidth={2} />
              <text x={x(lastI) + 10} y={y(values[lastI])} dy="0.32em" className="fill-fg font-mono text-[11px]">
                {compact(values[lastI])}
              </text>

              {hi !== null && (
                <g pointerEvents="none">
                  <line x1={x(hi)} x2={x(hi)} y1={PAD.top} y2={y(0)} stroke="rgb(255 255 255 / 0.3)" />
                  <circle cx={x(hi)} cy={y(values[hi])} r={4.5} fill={SERIES} stroke={SURFACE} strokeWidth={2} />
                </g>
              )}
            </svg>

            {hi !== null && (
              <div
                className="pointer-events-none absolute top-0 w-[150px] rounded-md border border-line-2 bg-[#141416] px-3 py-2 shadow-xl"
                style={{ left: tipLeft }}
              >
                <p className="text-[15px] font-semibold tracking-[-0.01em]">{grouped(values[hi])}</p>
                <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted">
                  <span className="h-0.5 w-3 rounded-full" style={{ background: SERIES }} />
                  Reach · {longDate(days[hi].date)}
                </p>
              </div>
            )}
          </>
        ) : (
          <div data-lenis-prevent className="h-full overflow-auto rounded-md border border-line">
            <table className="w-full text-left text-[12px]">
              <thead className="sticky top-0 bg-[#111113] font-mono text-[10px] uppercase tracking-[0.12em] text-dim">
                <tr>
                  <th className="px-3 py-2 font-normal">Date</th>
                  <th className="px-3 py-2 text-right font-normal">Reach</th>
                  <th className="px-3 py-2 text-right font-normal">Engagement</th>
                  <th className="px-3 py-2 text-right font-normal">Clicks</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {[...days].reverse().map((d) => (
                  <tr key={d.date.toISOString()} className="border-t border-line">
                    <td className="px-3 py-1.5 text-muted">{longDate(d.date)}</td>
                    <td className="px-3 py-1.5 text-right">{grouped(d.reach)}</td>
                    <td className="px-3 py-1.5 text-right">{d.engagement.toFixed(1)}%</td>
                    <td className="px-3 py-1.5 text-right">{grouped(d.clicks)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */

function PlatformBars({ rows }: { rows: Array<{ id: PlatformId; reach: number }> }) {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { once: true, margin: '-15% 0px' })
  const max = Math.max(...rows.map((r) => r.reach))

  return (
    <div ref={ref} className="rounded-lg border border-line p-4 md:p-5">
      <p className="text-[13.5px] font-medium">Platform performance</p>
      <p className="mt-0.5 text-[11.5px] text-dim">Reach by platform</p>
      <ul className="mt-5 space-y-3.5">
        {rows.map((r, i) => (
          <li key={r.id} className="group grid grid-cols-[92px_1fr] items-center gap-3 text-[12.5px]">
            <span className="flex items-center gap-2 text-muted">
              <PlatformIcon id={r.id} className="size-3.5 text-fg" />
              {PLATFORMS[r.id].name}
            </span>
            <span className="relative mr-12 h-4">
              <motion.span
                className="absolute inset-y-[3px] left-0 origin-left rounded-r-[4px] transition-[filter] group-hover:brightness-125"
                style={{ background: SERIES, width: `${(r.reach / max) * 100}%` }}
                initial={{ scaleX: 0 }}
                animate={{ scaleX: inView ? 1 : 0 }}
                transition={{ duration: 1, ease, delay: 0.1 + i * 0.06 }}
              />
              <motion.span
                className="absolute top-1/2 -translate-y-1/2 font-mono text-[11px] tabular-nums text-fg"
                style={{ left: `calc(${(r.reach / max) * 100}% + 8px)` }}
                initial={{ opacity: 0 }}
                animate={{ opacity: inView ? 1 : 0 }}
                transition={{ duration: 0.5, delay: 0.8 + i * 0.06 }}
              >
                {compact(r.reach)}
              </motion.span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function TopContent({ rows, range }: { rows: typeof TOP_POSTS; range: number }) {
  return (
    <div className="mt-4 overflow-hidden rounded-lg border border-line">
      <div className="flex items-center justify-between px-4 py-3 md:px-5">
        <p className="text-[13.5px] font-medium">Top performing content</p>
        <Field>Last {range} days</Field>
      </div>
      <table className="w-full text-left text-[12.5px]">
        <thead className="font-mono text-[10px] uppercase tracking-[0.12em] text-dim">
          <tr className="border-t border-line">
            <th className="px-4 py-2 font-normal md:px-5">Post</th>
            <th className="hidden px-4 py-2 font-normal sm:table-cell">Platform</th>
            <th className="px-4 py-2 text-right font-normal">Reach</th>
            <th className="px-4 py-2 text-right font-normal md:px-5">Eng.</th>
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {rows.map((p, i) => (
            <tr key={p.title} className="border-t border-line transition-colors hover:bg-white/[0.02]">
              <td className="px-4 py-2.5 md:px-5">
                <span className="mr-3 font-mono text-[10.5px] text-dim">{i + 1}</span>
                {p.title}
              </td>
              <td className="hidden px-4 py-2.5 text-muted sm:table-cell">
                <span className="flex items-center gap-2">
                  <PlatformIcon id={p.id} className="size-3.5" />
                  {PLATFORMS[p.id].name}
                </span>
              </td>
              <td className="px-4 py-2.5 text-right">{grouped(p.reach)}</td>
              <td className="px-4 py-2.5 text-right md:px-5">{p.rate.toFixed(1)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
