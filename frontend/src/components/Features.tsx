import {
  CalendarClock,
  ChartColumn,
  FolderOpen,
  Layers,
  PenLine,
  Share2,
  Shuffle,
  Workflow,
  type LucideIcon,
} from 'lucide-react'
import { LineReveal, Reveal, Serif } from './ui/Reveal'
import { SectionLabel } from './ui/Section'

const FEATURES: Array<{ title: string; body: string; icon: LucideIcon }> = [
  { title: 'AI Content Generation', body: 'Generate text, images and videos.', icon: PenLine },
  { title: 'Multi-Model', body: 'Choose the AI model that fits your workflow.', icon: Layers },
  { title: 'Multi-Platform', body: 'Connect multiple social networks.', icon: Share2 },
  { title: 'Scheduling', body: 'Plan content ahead of time.', icon: CalendarClock },
  { title: 'Content Library', body: 'Keep every generated asset organized.', icon: FolderOpen },
  { title: 'Automations', body: 'Create repeatable workflows.', icon: Workflow },
  { title: 'Platform Adaptation', body: 'Automatically adjust content for each platform.', icon: Shuffle },
  { title: 'Analytics', body: 'Understand what performs best.', icon: ChartColumn },
]

/** On paper (see PaperChapter in Home), like a printed spec sheet. */
export function Features() {
  return (
    <section id="features" className="relative pb-28 pt-12 md:pb-40 md:pt-20">
      <div className="container-x">
        <div className="grid gap-8 lg:grid-cols-12 lg:items-end">
          <div className="lg:col-span-8">
            <SectionLabel index="11" light>
              Features
            </SectionLabel>
            <LineReveal
              className="mt-10 text-[clamp(2.6rem,6vw,6.25rem)] font-medium leading-[0.92] tracking-[-0.05em]"
              lines={['Everything you need', <>to <Serif data-thread="underline">publish at scale.</Serif></>]}
            />
          </div>
          <Reveal delay={0.15} className="max-w-xs text-[17px] leading-snug text-ink/60 lg:col-span-4 lg:justify-self-end">
            Eight things that usually live in eight different tabs.
          </Reveal>
        </div>

        <div data-thread="rail" className="mt-16 grid border-l border-t border-ink/12 sm:grid-cols-2 md:mt-24 lg:grid-cols-4">
          {FEATURES.map((f, i) => {
            const Icon = f.icon
            return (
              <Reveal
                key={f.title}
                delay={(i % 4) * 0.06}
                y={16}
                className="group relative flex min-h-[200px] flex-col overflow-hidden border-b border-r border-ink/12 p-6 md:min-h-[290px] md:p-7"
              >
                <span
                  aria-hidden
                  className="absolute inset-0 origin-bottom scale-y-0 bg-ink transition-transform duration-700 ease-expo group-hover:scale-y-100"
                />
                <div className="relative flex items-start justify-between">
                  <span className="font-mono text-[11px] text-ink/45 transition-colors duration-500 group-hover:text-fg/50">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <Icon
                    className="size-5 text-ink transition-[color,transform] duration-700 ease-expo group-hover:-rotate-12 group-hover:text-accent-soft"
                    strokeWidth={1.5}
                  />
                </div>
                <div className="relative mt-auto">
                  <h3 className="text-[22px] font-medium leading-tight tracking-[-0.03em] transition-colors duration-500 group-hover:text-fg">
                    {f.title}
                  </h3>
                  <p className="mt-2 min-h-[2.8em] text-[14.5px] leading-snug text-ink/60 transition-colors duration-500 group-hover:text-fg/60">
                    {f.body}
                  </p>
                </div>
              </Reveal>
            )
          })}
        </div>
      </div>
    </section>
  )
}
