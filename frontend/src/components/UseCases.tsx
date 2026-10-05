import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowUpRight } from 'lucide-react'
import { ease } from '../lib/motion'
import { cn } from '../lib/cn'
import { Field } from './mock/Mock'
import { LineReveal, Reveal, Serif } from './ui/Reveal'
import { SectionLabel } from './ui/Section'

const CASES = [
  {
    name: 'Creators',
    body: 'Publish consistently without spending your entire day creating content.',
    setup: ['One idea → post, image and short video', 'Daily at 18:00 · Instagram, TikTok', 'Weekly recap thread on X'],
  },
  {
    name: 'Marketing Teams',
    body: 'Scale campaigns across multiple channels.',
    setup: ['Campaign brief → a full set of assets', 'Review before anything goes live', 'One shared content library'],
  },
  {
    name: 'Agencies',
    body: 'Manage content workflows for multiple clients.',
    setup: ['A workspace per client', 'Each client’s tone saved as a preset', 'One calendar across every account'],
  },
  {
    name: 'Startups',
    body: 'Build a consistent online presence with a small team.',
    setup: ['Launch posts in every format', 'Weekly founder update, drafted Monday', 'Changelog → social posts'],
  },
  {
    name: 'E-commerce',
    body: 'Generate product content and promotional campaigns.',
    setup: ['Product page → captions and visuals', 'Seasonal promos on autopilot', 'Drop announcements on a schedule'],
  },
]

export function UseCases() {
  const [active, setActive] = useState(0)
  const c = CASES[active]

  return (
    <section id="use-cases" className="relative py-28 md:py-40">
      <div className="container-x">
        <SectionLabel index="13">Use cases</SectionLabel>
        <LineReveal
          className="mt-10 text-[clamp(2.6rem,6vw,6.25rem)] font-medium leading-[0.92] tracking-[-0.05em]"
          lines={['Built for the way', <Serif data-thread="circle">you create.</Serif>]}
        />

        <div data-thread="rail" className="mt-16 grid gap-10 md:mt-24 lg:grid-cols-12">
          <div role="tablist" aria-label="Use cases" className="border-t border-line lg:col-span-7">
            {CASES.map((it, i) => (
              <button
                key={it.name}
                role="tab"
                type="button"
                aria-selected={i === active}
                onMouseEnter={() => setActive(i)}
                onFocus={() => setActive(i)}
                onClick={() => setActive(i)}
                className="group flex w-full items-baseline gap-5 border-b border-line py-5 text-left md:py-6"
              >
                <span className="font-mono text-[11px] text-dim">0{i + 1}</span>
                <span
                  className={cn(
                    'text-[clamp(2rem,4.2vw,4rem)] font-medium leading-none tracking-[-0.045em] transition-[color,transform] duration-500 ease-expo',
                    i === active ? 'translate-x-2 text-fg' : 'text-fg/25 group-hover:text-fg/50',
                  )}
                >
                  {it.name}
                </span>
                <ArrowUpRight
                  className={cn(
                    'ml-auto size-6 self-center transition-all duration-500 ease-expo',
                    i === active ? 'rotate-45 text-fg opacity-100' : 'text-dim opacity-0',
                  )}
                  strokeWidth={1.5}
                />
              </button>
            ))}
          </div>

          <div className="lg:col-span-4 lg:col-start-9">
            <Reveal className="lg:sticky lg:top-28">
              <div className="rounded-xl border border-line-2 bg-ink-2 p-6 md:p-7">
                <AnimatePresence mode="wait">
                  <motion.div
                    key={c.name}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.4, ease }}
                  >
                    <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-dim">For {c.name.toLowerCase()}</p>
                    <p className="mt-5 text-[24px] leading-[1.15] tracking-[-0.02em]">{c.body}</p>
                    <Field className="mt-10">A typical setup</Field>
                    <ul className="mt-3 space-y-2">
                      {c.setup.map((s, i) => (
                        <li key={s} className="flex items-center gap-3 rounded-md border border-line px-3 py-2.5 text-[13.5px]">
                          <span className="font-mono text-[10.5px] text-dim">{String.fromCharCode(97 + i)}</span>
                          {s}
                        </li>
                      ))}
                    </ul>
                  </motion.div>
                </AnimatePresence>
              </div>
            </Reveal>
          </div>
        </div>
      </div>
    </section>
  )
}
