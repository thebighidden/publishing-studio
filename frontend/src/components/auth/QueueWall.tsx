import { type PointerEvent } from 'react'
import { motion, useMotionValue, useSpring } from 'framer-motion'
import { LoaderCircle, Play } from 'lucide-react'
import { cn } from '../../lib/cn'
import { STATUS } from '../mock/Mock'
import { GenArt, type ArtVariant } from '../ui/GenArt'
import { PLATFORMS, PlatformIcon, type PlatformId } from '../ui/PlatformIcon'

type CardStatus = 'published' | 'scheduled' | 'generating'

type Card = { platform: PlatformId; status: CardStatus; when?: string } & (
  | { art: ArtVariant; ratio: string; video?: string }
  | { text: string }
)

const COLUMNS: Card[][] = [
  [
    { platform: 'instagram', art: 'sun', ratio: 'aspect-[4/5]', status: 'published' },
    { platform: 'linkedin', text: 'Three things we learned shipping our first launch week — and the one we’d skip next time.', status: 'scheduled', when: 'Thu 09:30' },
    { platform: 'tiktok', art: 'dune', ratio: 'aspect-[4/5]', video: '0:15', status: 'generating' },
    { platform: 'x', text: 'How to plan a week of content in 10 minutes — a thread.', status: 'published' },
  ],
  [
    { platform: 'youtube', art: 'orb', ratio: 'aspect-video', video: '0:42', status: 'scheduled', when: 'Fri 17:00' },
    { platform: 'instagram', art: 'product', ratio: 'aspect-square', status: 'published' },
    { platform: 'linkedin', text: 'We’re hiring our first designer. Small team, big surface area.', status: 'published' },
    { platform: 'pinterest', art: 'topo', ratio: 'aspect-[3/4]', status: 'scheduled', when: 'Sat 11:00' },
  ],
  [
    { platform: 'x', text: 'Day one: thank you. Here’s what we learned in the first 12 hours.', status: 'scheduled', when: 'Mon 16:00' },
    { platform: 'facebook', art: 'rings', ratio: 'aspect-[4/3]', status: 'published' },
    { platform: 'instagram', art: 'sun', ratio: 'aspect-square', status: 'generating' },
    { platform: 'tiktok', art: 'product', ratio: 'aspect-[4/5]', video: '0:24', status: 'published' },
  ],
  [
    { platform: 'linkedin', text: 'Everything we shipped this week, in one place.', status: 'scheduled', when: 'Fri 12:00' },
    { platform: 'youtube', art: 'dune', ratio: 'aspect-video', video: '1:05', status: 'published' },
    { platform: 'instagram', art: 'orb', ratio: 'aspect-[4/5]', status: 'scheduled', when: 'Sun 10:00' },
    { platform: 'x', text: 'Five ways to stop re-planning your week. The third one is the one people save.', status: 'published' },
  ],
  [
    { platform: 'tiktok', art: 'rings', ratio: 'aspect-[4/5]', video: '0:12', status: 'scheduled', when: 'Tue 18:30' },
    { platform: 'linkedin', text: 'A day in the office, from the whiteboard to the 5pm demo.', status: 'generating' },
    { platform: 'pinterest', art: 'sun', ratio: 'aspect-[3/4]', status: 'published' },
    { platform: 'facebook', text: 'Three planning habits that take under a minute each.', status: 'scheduled', when: 'Wed 08:00' },
  ],
]

const SPEEDS = [52, 64, 56, 70, 60]

/**
 * A tilted wall of queued posts, every column drifting at its own pace
 * (alternate columns run the other way). The wall leans away from the pointer.
 */
export function QueueWall() {
  const px = useMotionValue(0)
  const py = useMotionValue(0)
  const x = useSpring(px, { stiffness: 60, damping: 20 })
  const y = useSpring(py, { stiffness: 60, damping: 20 })

  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    px.set(((e.clientX - r.left) / r.width - 0.5) * -36)
    py.set(((e.clientY - r.top) / r.height - 0.5) * -24)
  }

  return (
    <div
      className="absolute inset-0 overflow-hidden"
      onPointerMove={onMove}
      onPointerLeave={() => {
        px.set(0)
        py.set(0)
      }}
    >
      <motion.div style={{ x, y }} className="absolute inset-0">
        <div
          className="absolute left-1/2 top-1/2 grid h-[180%] w-[175%] grid-cols-5 gap-3.5"
          style={{ transform: 'translate(-50%, -50%) perspective(1800px) rotateX(24deg) rotateZ(-14deg)' }}
        >
          {COLUMNS.map((col, i) => (
            <Column key={i} cards={col} duration={SPEEDS[i]} reverse={i % 2 === 1} />
          ))}
        </div>
      </motion.div>
    </div>
  )
}

function Column({ cards, duration, reverse }: { cards: Card[]; duration: number; reverse: boolean }) {
  // Two copies, each carrying its own trailing gap, so sliding by exactly half loops seamlessly.
  const set = (hidden?: boolean) => (
    <div aria-hidden={hidden} className="flex flex-col gap-4 pb-4">
      {[...cards, ...cards].map((c, i) => (
        <QueueCard key={i} card={c} />
      ))}
    </div>
  )
  return (
    <div className="min-w-0">
      <div
        className="animate-marquee-y motion-reduce:animate-none"
        style={{ animationDuration: `${duration}s`, animationDirection: reverse ? 'reverse' : undefined }}
      >
        {set()}
        {set(true)}
      </div>
    </div>
  )
}

function QueueCard({ card }: { card: Card }) {
  return (
    <div className="rounded-2xl border border-white/[0.07] bg-panel-3 p-2.5 shadow-[0_30px_60px_-30px_rgb(0_0_0_/_0.9)]">
      <div className="flex items-center justify-between gap-2 px-1 pb-2.5 pt-0.5">
        <span className="flex min-w-0 items-center gap-2 text-[11.5px] text-muted">
          <PlatformIcon id={card.platform} className="size-3.5 text-fg" />
          <span className="truncate">{PLATFORMS[card.platform].name}</span>
        </span>
        <Chip status={card.status} when={card.when} />
      </div>

      {'art' in card ? (
        <>
          <div className="relative overflow-hidden rounded-xl">
            <GenArt variant={card.art} className={cn('w-full', card.ratio)} />
            {card.video && (
              <>
                <span className="absolute left-1/2 top-1/2 grid size-9 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-black/40 text-white backdrop-blur">
                  <Play className="size-3.5 translate-x-px" fill="currentColor" />
                </span>
                <span className="absolute bottom-2 left-2 rounded bg-black/50 px-1.5 py-0.5 font-mono text-[9.5px] text-white">
                  {card.video}
                </span>
              </>
            )}
            {card.status === 'generating' && <div className="skeleton absolute inset-0 opacity-70" />}
          </div>
          <div className="space-y-1.5 px-1 pb-1 pt-3">
            <div className="h-1.5 w-[82%] rounded-full bg-white/10" />
            <div className="h-1.5 w-[54%] rounded-full bg-white/[0.06]" />
          </div>
        </>
      ) : (
        <p className="px-1 pb-1 text-[13px] leading-snug text-fg/85">{card.text}</p>
      )}
    </div>
  )
}

function Chip({ status, when }: { status: CardStatus; when?: string }) {
  if (status === 'generating') {
    return (
      <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-accent/40 px-2 py-0.5 text-[10px] font-medium text-accent-soft">
        <LoaderCircle className="size-2.5 animate-spin" strokeWidth={2.5} />
        Generating
      </span>
    )
  }
  const s = STATUS[status]
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium', s.ring, s.text)}>
      <span className={cn('size-1.5 rounded-full', s.dot)} />
      {status === 'scheduled' && when ? when : s.label}
    </span>
  )
}
