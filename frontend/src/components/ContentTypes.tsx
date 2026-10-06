import { useRef } from 'react'
import { motion, useReducedMotion, useScroll, useTransform, type MotionValue } from 'framer-motion'
import { ArrowRight, Heart, MessageCircle, Play, Repeat2 } from 'lucide-react'
import { cn } from '../lib/cn'
import { useMediaQuery } from '../lib/useMediaQuery'
import { GenArt, type ArtVariant } from './ui/GenArt'
import { PLATFORMS, PlatformIcon, type PlatformId } from './ui/PlatformIcon'
import { LineReveal, Reveal, Serif } from './ui/Reveal'
import { SectionLabel } from './ui/Section'

/*
 * One idea, and a wall of everything it became.
 * The interface stays black and white; the colour on this page comes from the content, the way it does in a feed.
 */

type Tile =
  | { kind: 'image'; art: ArtVariant; ratio: string; label: string }
  | { kind: 'video'; art: ArtVariant; caption: string; length: string }
  | { kind: 'post'; platform: PlatformId; text: string }
  | { kind: 'quote'; text: string; bg: string; fg: string }
  | { kind: 'article'; kicker: string; title: string }

const TILES: Tile[] = [
  { kind: 'image', art: 'sun', ratio: '4/5', label: 'Instagram · 4:5' },
  { kind: 'post', platform: 'x', text: 'Notes, tasks, meetings → one plan for your day. Tempo is live Monday.' },
  { kind: 'video', art: 'bloom', caption: 'I stopped planning my day.', length: '0:15' },
  { kind: 'quote', text: 'Plan less. Do more.', bg: '#d4553a', fg: '#fbeee6' },
  { kind: 'image', art: 'ceramic', ratio: '1/1', label: 'Product · 1:1' },
  { kind: 'quote', text: 'Monday, but make it organized.', bg: '#ece3d1', fg: '#1d1a16' },
  { kind: 'image', art: 'arch', ratio: '4/5', label: 'Campaign · 4:5' },
  {
    kind: 'post',
    platform: 'linkedin',
    text: 'We spent 14 months on one question: why does planning your day take so much of it?',
  },
  { kind: 'image', art: 'stripes', ratio: '1/1', label: 'Social · 1:1' },
  { kind: 'video', art: 'night', caption: 'What 7am looks like now.', length: '0:22' },
  { kind: 'video', art: 'sun', caption: 'Three tabs → one plan.', length: '0:12' },
  { kind: 'image', art: 'bauhaus', ratio: '1/1', label: 'Concept · 1:1' },
  { kind: 'article', kicker: 'Blog · 6 min', title: 'Why we stopped building a to-do list' },
  { kind: 'image', art: 'topo', ratio: '16/9', label: 'YouTube · thumbnail' },
  { kind: 'post', platform: 'instagram', text: 'Early access opens Monday — link in bio. #productivity #planning' },
  { kind: 'image', art: 'product', ratio: '4/5', label: 'Launch · 4:5' },
  { kind: 'quote', text: 'Your notes already know the plan.', bg: '#1f2b59', fg: '#e9e4ff' },
  { kind: 'video', art: 'stripes', caption: 'Day one of Tempo.', length: '0:30' },
  { kind: 'image', art: 'orb', ratio: '1/1', label: 'Render · 1:1' },
  { kind: 'post', platform: 'x', text: '1/4 Most planning apps ask you to plan. Here’s what we did instead ↓' },
  { kind: 'image', art: 'dune', ratio: '4/5', label: 'Pinterest · 2:3' },
  { kind: 'quote', text: 'Start the day with a plan, not a blank page.', bg: '#7d8f6a', fg: '#f3f1e6' },
  { kind: 'video', art: 'arch', caption: 'Behind the scenes', length: '0:18' },
  { kind: 'image', art: 'rings', ratio: '1/1', label: 'Thumbnail · 1:1' },
  { kind: 'article', kicker: 'Newsletter', title: 'Tempo is here. Here’s what changes on Monday.' },
  { kind: 'image', art: 'night', ratio: '4/5', label: 'Story · 9:16' },
]

const KINDS = [
  {
    title: 'Text',
    items: ['Social posts', 'Captions', 'Threads', 'Articles', 'Product descriptions', 'Marketing copy'],
    cta: 'Generate Text',
  },
  {
    title: 'Images',
    items: ['Social graphics', 'Product visuals', 'Campaign images', 'Thumbnails', 'Creative concepts'],
    cta: 'Generate Images',
  },
  {
    title: 'Videos',
    items: ['Short-form videos', 'Product videos', 'Social clips', 'Promotional videos'],
    cta: 'Generate Videos',
  },
]

export function ContentTypes() {
  return (
    <section id="formats" className="relative pt-16 md:pt-24">
      <ContentWall />

      <div className="container-x mt-20 md:mt-32">
        <div className="grid border-t border-line md:grid-cols-3">
          {KINDS.map((k, i) => (
            <Reveal
              key={k.title}
              delay={i * 0.08}
              className="group border-b border-line py-10 md:border-b-0 md:border-l md:px-8 md:first:border-l-0 md:first:pl-0 lg:px-10"
            >
              <div className="flex items-baseline justify-between">
                <h3 className="text-[clamp(3rem,5.4vw,5.5rem)] font-medium leading-none tracking-[-0.055em]">{k.title}</h3>
                <span className="font-mono text-[11px] text-dim">0{i + 1}</span>
              </div>
              <ul className="mt-8 space-y-0">
                {k.items.map((it) => (
                  <li key={it} className="border-t border-line py-2.5 text-[15px] text-muted first:border-t-0">
                    {it}
                  </li>
                ))}
              </ul>
              <a href="/signup" className="mt-6 inline-flex items-center gap-2 text-[14px] font-medium text-fg">
                <span className="border-b border-transparent transition-colors group-hover:border-fg">{k.cta}</span>
                <ArrowRight className="size-4 transition-transform duration-500 ease-expo group-hover:translate-x-1" />
              </a>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ */
/* The wall                                                             */
/* ------------------------------------------------------------------ */

function ContentWall() {
  const ref = useRef<HTMLDivElement>(null)
  const reduce = useReducedMotion()
  const xl = useMediaQuery('(min-width: 1280px)')
  const md = useMediaQuery('(min-width: 768px)')
  const cols = xl ? 6 : md ? 5 : 3
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] })

  // Each column takes a different slice of the tiles, so neighbours never repeat each other.
  const columns = Array.from({ length: cols }, (_, c) =>
    Array.from({ length: 7 }, (_, k) => TILES[(c * 5 + k * 3 + (c % 2) * 2) % TILES.length]),
  )

  return (
    <div
      ref={ref}
      data-thread="rail"
      className="relative h-[118svh] min-h-[760px] overflow-hidden [mask-image:linear-gradient(to_bottom,transparent,#000_14%,#000_86%,transparent)] md:min-h-[880px]"
    >
      <div
        aria-hidden
        className="absolute inset-[-12%_-8%] flex items-start gap-3 md:gap-4"
        style={{ transform: 'rotate(-7deg)' }}
      >
        {columns.map((tiles, c) => (
          <WallColumn key={c} index={c} tiles={tiles} progress={scrollYProgress} still={!!reduce} compact={!md} />
        ))}
      </div>

      {/* The headline sits in a pool of the page colour so it reads over anything behind it. */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/2 h-[78%] w-[min(1100px,120vw)] -translate-x-1/2 -translate-y-1/2 rounded-[50%] [background:radial-gradient(closest-side,var(--color-ink)_0%,color-mix(in_oklab,var(--color-ink)_88%,transparent)_45%,transparent_100%)]"
      />

      <div className="absolute inset-0 grid place-items-center px-4">
        <div className="flex flex-col items-center text-center">
          <SectionLabel index="04" thread={false}>
            Formats
          </SectionLabel>
          <LineReveal
            className="mt-8 text-[clamp(3.2rem,9.5vw,10.5rem)] font-medium leading-[0.86] tracking-[-0.06em]"
            lines={['One idea.', <Serif>Every format.</Serif>]}
          />
          <Reveal delay={0.25} className="mt-10 w-[min(28rem,88vw)]">
            <div className="rounded-2xl border border-line-2 bg-panel-2/95 p-4 text-left shadow-[0_40px_90px_-30px_rgb(0_0_0_/_0.9)]">
              <div className="flex items-center justify-between font-mono text-[10.5px] uppercase tracking-[0.14em] text-dim">
                <span className="flex items-center gap-2">
                  <span className="size-1.5 rounded-full bg-accent" /> The idea
                </span>
                <span>1 prompt</span>
              </div>
              <p className="mt-3 text-[15px] leading-snug text-fg md:text-[17px]">
                Tempo launches Monday. Warm, a bit bold.
              </p>
            </div>
            <p className="mt-4 text-[14px] leading-snug text-muted md:text-[15px]">
              Write the idea once. Get it back as words, pictures and motion.
            </p>
          </Reveal>
        </div>
      </div>
    </div>
  )
}

function WallColumn({
  index,
  tiles,
  progress,
  still,
  compact,
}: {
  index: number
  tiles: Tile[]
  progress: MotionValue<number>
  still: boolean
  compact: boolean
}) {
  // Neighbouring columns travel in opposite directions, at different speeds.
  const dir = index % 2 === 0 ? 1 : -1
  const travel = (compact ? 120 : 220) + (index % 3) * 70
  const y = useTransform(progress, [0, 1], [dir * travel - 120, -dir * travel - 120])
  return (
    <motion.div style={{ y: still ? -120 : y }} className="flex min-w-0 flex-1 flex-col gap-3 *:shrink-0 md:gap-4">
      {tiles.map((t, i) => (
        <TileView key={i} tile={t} compact={compact} />
      ))}
    </motion.div>
  )
}

function TileView({ tile, compact }: { tile: Tile; compact: boolean }) {
  switch (tile.kind) {
    case 'image':
      return (
        <figure className="overflow-hidden rounded-lg md:rounded-xl">
          <GenArt variant={tile.art} className="w-full" style={{ aspectRatio: tile.ratio }}>
            {!compact && (
              <figcaption className="absolute bottom-2 left-2 rounded-full bg-black/45 px-2 py-0.5 font-mono text-[9.5px] text-white/85 backdrop-blur-sm">
                {tile.label}
              </figcaption>
            )}
          </GenArt>
        </figure>
      )
    case 'video':
      return (
        <div className="overflow-hidden rounded-lg md:rounded-xl">
          <GenArt variant={tile.art} className="aspect-[9/16] w-full">
            <div className="absolute inset-0 bg-[linear-gradient(180deg,transparent_45%,rgb(0_0_0_/_0.6))]" />
            <span className="absolute left-1/2 top-1/2 grid size-8 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white/20 backdrop-blur-sm md:size-10">
              <Play className="size-3.5 translate-x-px fill-white text-white md:size-4" />
            </span>
            <p
              className={cn(
                'absolute inset-x-2.5 bottom-6 font-semibold leading-tight text-white md:inset-x-3 md:bottom-7',
                compact ? 'text-[10px]' : 'text-[13px]',
              )}
            >
              {tile.caption}
            </p>
            <div className="absolute inset-x-2.5 bottom-3 flex items-center gap-2 md:inset-x-3">
              <span className="h-0.5 flex-1 overflow-hidden rounded-full bg-white/25">
                <span className="block h-full w-1/3 bg-white" />
              </span>
              {!compact && <span className="font-mono text-[9.5px] text-white/80">{tile.length}</span>}
            </div>
          </GenArt>
        </div>
      )
    case 'post':
      return (
        <div className="rounded-lg border border-line bg-card p-3 md:rounded-xl md:p-4">
          <div className="flex items-center gap-2">
            <span className="grid size-6 shrink-0 place-items-center rounded-full bg-[#e6e0d4] text-[9px] font-semibold text-ink">
              T
            </span>
            {!compact && (
              <span className="min-w-0 text-[11.5px] leading-tight">
                <span className="block font-medium">Tempo</span>
                <span className="block text-dim">{PLATFORMS[tile.platform].name}</span>
              </span>
            )}
            <PlatformIcon id={tile.platform} className="ml-auto size-3.5 text-muted" />
          </div>
          <p className={cn('mt-3 leading-snug text-fg/90', compact ? 'line-clamp-4 text-[10.5px]' : 'text-[13px]')}>
            {tile.text}
          </p>
          {!compact && (
            <div className="mt-3 flex gap-5 text-dim">
              <MessageCircle className="size-3.5" />
              <Repeat2 className="size-3.5" />
              <Heart className="size-3.5" />
            </div>
          )}
        </div>
      )
    case 'quote':
      return (
        <div
          className="flex aspect-[4/5] flex-col justify-between rounded-lg p-3.5 md:rounded-xl md:p-5"
          style={{ background: tile.bg, color: tile.fg }}
        >
          <span className="font-mono text-[9px] uppercase tracking-[0.16em] opacity-60">Tempo</span>
          <p
            className={cn(
              'font-serif italic leading-[1.02] tracking-[-0.01em]',
              compact ? 'text-[19px]' : 'text-[clamp(1.6rem,2.3vw,2.4rem)]',
            )}
          >
            {tile.text}
          </p>
          <span className="font-mono text-[9px] opacity-60">tempo.app</span>
        </div>
      )
    case 'article':
      return (
        <article className="rounded-lg border border-line bg-bone p-3.5 text-ink md:rounded-xl md:p-5">
          <p className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-ink/55">{tile.kicker}</p>
          <p
            className={cn(
              'mt-3 font-medium leading-[1.05] tracking-[-0.03em]',
              compact ? 'text-[14px]' : 'text-[clamp(1.25rem,1.6vw,1.6rem)]',
            )}
          >
            {tile.title}
          </p>
          <div className="mt-4 space-y-1.5 opacity-40">
            <span className="block h-1 w-full rounded-full bg-ink/40" />
            <span className="block h-1 w-4/5 rounded-full bg-ink/40" />
          </div>
        </article>
      )
  }
}
