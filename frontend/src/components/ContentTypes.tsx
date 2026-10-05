import { useRef, useState, type ReactNode } from 'react'
import { motion, useInView } from 'framer-motion'
import { ArrowRight, Pause } from 'lucide-react'
import { ease } from '../lib/motion'
import { cn } from '../lib/cn'
import { useMediaQuery } from '../lib/useMediaQuery'
import { GenArt } from './ui/GenArt'
import { LineReveal, Reveal, Serif } from './ui/Reveal'
import { SectionLabel } from './ui/Section'

type Kind = {
  title: string
  items: string[]
  cta: string
  visual: (active: boolean) => ReactNode
}

const KINDS: Kind[] = [
  {
    title: 'Text',
    items: ['Social posts', 'Captions', 'Threads', 'Articles', 'Product descriptions', 'Marketing copy'],
    cta: 'Generate Text',
    visual: (active) => <TextVisual active={active} />,
  },
  {
    title: 'Images',
    items: ['Social graphics', 'Product visuals', 'Campaign images', 'Thumbnails', 'Creative concepts'],
    cta: 'Generate Images',
    visual: (active) => <ImageVisual active={active} />,
  },
  {
    title: 'Videos',
    items: ['Short-form videos', 'Product videos', 'Social clips', 'Promotional videos'],
    cta: 'Generate Videos',
    visual: (active) => <VideoVisual active={active} />,
  },
]

export function ContentTypes() {
  const [open, setOpen] = useState(0)
  const wide = useMediaQuery('(min-width: 1024px)')

  return (
    <section id="formats" className="relative py-28 md:py-40">
      <div className="container-x">
        <div className="flex flex-col gap-10 md:flex-row md:items-end md:justify-between">
          <div>
            <SectionLabel index="04">Formats</SectionLabel>
            <LineReveal
              className="mt-10 text-[clamp(2.8rem,7vw,7.5rem)] font-medium leading-[0.9] tracking-[-0.05em]"
              lines={['One idea.', <Serif data-thread="circle">Every format.</Serif>]}
            />
          </div>
          <Reveal delay={0.15} className="max-w-xs text-[17px] leading-snug text-muted">
            Write the idea once. Get it back as words, pictures and motion.
          </Reveal>
        </div>

        <div data-thread="rail" className="mt-16 flex flex-col gap-3 md:mt-24 lg:h-[620px] lg:flex-row">
          {KINDS.map((k, i) => {
            const active = !wide || open === i
            return (
              <article
                key={k.title}
                onMouseEnter={() => setOpen(i)}
                onFocus={() => setOpen(i)}
                tabIndex={0}
                className="group relative flex min-h-[560px] basis-0 flex-col overflow-hidden rounded-xl border border-line bg-ink-2 outline-none transition-[flex-grow,border-color] duration-[900ms] ease-quint hover:border-line-2 lg:min-h-0"
                style={{ flexGrow: wide && open === i ? 2.3 : 1 }}
              >
                <div className="flex items-start justify-between p-6 md:p-8">
                  <div>
                    <span className="font-mono text-[11px] text-dim">0{i + 1}</span>
                    <h3 className="mt-2 text-4xl font-medium tracking-[-0.04em] md:text-5xl">{k.title}</h3>
                  </div>
                  <span
                    className={cn(
                      'font-mono text-[11px] text-dim transition-opacity duration-500',
                      active ? 'opacity-0' : 'opacity-100',
                    )}
                  >
                    {k.items.length} kinds
                  </span>
                </div>

                <div className="relative mx-6 flex-1 overflow-hidden rounded-lg border border-line bg-black/40 md:mx-8">
                  {k.visual(active)}
                </div>

                <div className="p-6 md:p-8">
                  <motion.div
                    animate={{ opacity: active ? 1 : 0, height: active ? 'auto' : 0 }}
                    transition={{ duration: 0.6, ease }}
                    className="overflow-hidden"
                  >
                    <p className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-dim">Generate</p>
                    <ul className="mt-2 flex flex-wrap gap-1.5">
                      {k.items.map((it) => (
                        <li key={it} className="rounded-full border border-line-2 px-3 py-1 text-[12.5px] text-muted">
                          {it}
                        </li>
                      ))}
                    </ul>
                  </motion.div>
                  <a
                    href="#start"
                    className="mt-5 inline-flex items-center gap-2 text-[14px] font-medium text-fg"
                  >
                    <span className="border-b border-transparent transition-colors group-hover:border-fg">{k.cta}</span>
                    <ArrowRight className="size-4 transition-transform duration-500 ease-expo group-hover:translate-x-1" />
                  </a>
                </div>
              </article>
            )
          })}
        </div>
      </div>
    </section>
  )
}

const LINES = [
  { text: 'Most planning apps ask you to plan.' },
  { text: 'Tempo asks what you already wrote down —' },
  { text: 'notes, tasks, meetings — and does it for you.' },
  { text: 'Early access opens Monday.' },
]

function TextVisual({ active }: { active: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { once: true })
  return (
    <div ref={ref} className="absolute inset-0 flex flex-col p-5 md:p-6">
      <div className="flex gap-1.5 font-mono text-[10px] text-dim">
        {['Post', 'Caption', 'Thread 1/4'].map((t, i) => (
          <span key={t} className={cn('rounded border px-2 py-0.5', i === 0 ? 'border-white/25 text-fg' : 'border-line')}>
            {t}
          </span>
        ))}
      </div>
      <div className="mt-6 space-y-3">
        {LINES.map((l, i) => (
          <motion.p
            key={i}
            className="text-[14px] leading-snug text-fg/90 md:text-[17px]"
            initial={{ clipPath: 'inset(0 100% 0 0)' }}
            animate={{ clipPath: inView ? 'inset(0 0% 0 0)' : 'inset(0 100% 0 0)' }}
            transition={{ duration: 1.1, ease: 'linear', delay: 0.3 + i * 1.05 }}
          >
            {l.text}
          </motion.p>
        ))}
      </div>
      <p
        className={cn(
          'mt-auto font-mono text-[10.5px] text-dim transition-opacity duration-500',
          active ? 'opacity-100' : 'opacity-0',
        )}
      >
        164 characters · confident · en
      </p>
    </div>
  )
}

function ImageVisual({ active }: { active: boolean }) {
  return (
    <div className="absolute inset-0 grid grid-cols-2 grid-rows-2 gap-2 p-2">
      {(['orb', 'dune', 'topo', 'rings'] as const).map((v, i) => (
        <GenArt
          key={v}
          variant={v}
          className={cn(
            'rounded-md transition-[transform,filter] duration-1000 ease-expo',
            active ? 'scale-100 grayscale-0' : 'scale-[0.97] grayscale',
          )}
        >
          <span className="absolute bottom-2 left-2 font-mono text-[9.5px] text-white/70 mix-blend-difference">
            {['concept', 'campaign', 'social', 'thumbnail'][i]}
          </span>
        </GenArt>
      ))}
    </div>
  )
}

function VideoVisual({ active }: { active: boolean }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center gap-4 p-5">
      <GenArt variant="sun" className="aspect-[9/16] h-[82%] rounded-lg shadow-2xl">
        <motion.div
          className="absolute inset-0"
          style={{ background: 'linear-gradient(180deg, transparent 50%, rgb(0 0 0 / 0.55))' }}
          animate={active ? { scale: [1, 1.06] } : { scale: 1 }}
          transition={{ duration: 8, ease: 'linear', repeat: Infinity, repeatType: 'reverse' }}
        />
        <p className="absolute inset-x-3 bottom-8 text-[12px] font-semibold leading-tight text-white">
          I stopped planning my day. Here’s why.
        </p>
        <div className="absolute inset-x-3 bottom-3 h-0.5 overflow-hidden rounded-full bg-white/25">
          <motion.div
            className="h-full origin-left bg-white"
            animate={active ? { scaleX: [0, 1] } : { scaleX: 0.3 }}
            transition={active ? { duration: 6, ease: 'linear', repeat: Infinity } : { duration: 0.4 }}
          />
        </div>
      </GenArt>
      <div
        className={cn(
          'hidden flex-col gap-2 font-mono text-[10.5px] text-dim transition-opacity duration-700 sm:flex',
          active ? 'opacity-100' : 'opacity-0',
        )}
      >
        <span className="flex items-center gap-1.5 text-fg">
          <Pause className="size-3" /> 00:07 / 00:15
        </span>
        <span>9:16 · 1080p</span>
        <span>captions on</span>
        <span>hook in 1.2s</span>
      </div>
    </div>
  )
}
