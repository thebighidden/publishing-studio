import { VelocityMarquee } from './ui/Marquee'
import { PLATFORMS, PlatformIcon, type PlatformId } from './ui/PlatformIcon'
import { Reveal } from './ui/Reveal'

const ORDER: PlatformId[] = ['instagram', 'tiktok', 'x', 'linkedin', 'facebook', 'youtube', 'pinterest']
const FORMATS = ['posts', 'captions', 'threads', 'carousels', 'reels', 'shorts', 'articles', 'thumbnails']

export function SocialProof() {
  return (
    <section data-thread="rail" className="relative mt-24 border-y border-line py-12 md:mt-36 md:py-16">
      <div className="container-x flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <Reveal>
          <p className="max-w-[26ch] text-xl leading-tight tracking-[-0.02em] md:text-[26px]">
            Built for creators, marketers, and teams who publish at scale.
          </p>
        </Reveal>
        <Reveal delay={0.1}>
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-dim">Connects with</p>
        </Reveal>
      </div>

      {/* Two strips running against each other; both answer the speed and direction of the scroll. */}
      <VelocityMarquee className="mt-10 md:mt-14" speed={-2.2}>
        {ORDER.map((id) => (
          <div
            key={id}
            className="flex items-center gap-4 px-6 text-fg/35 transition-colors duration-500 hover:text-fg md:gap-6 md:px-10"
          >
            <PlatformIcon id={id} className="size-8 md:size-[clamp(2.25rem,4vw,4rem)]" />
            <span className="text-[clamp(2.25rem,6.4vw,6.5rem)] font-medium leading-none tracking-[-0.05em]">
              {PLATFORMS[id].name}
            </span>
          </div>
        ))}
      </VelocityMarquee>
      <VelocityMarquee className="mt-3 md:mt-5" speed={1.6}>
        {FORMATS.map((f) => (
          <div key={f} className="flex items-center gap-6 px-6 md:gap-10 md:px-10">
            <span className="font-serif text-[clamp(2.25rem,6.4vw,6.5rem)] italic leading-[1.1] tracking-[-0.02em] text-fg/[0.14]">
              {f}
            </span>
            <span aria-hidden className="size-2 rounded-full bg-accent/60 md:size-3" />
          </div>
        ))}
      </VelocityMarquee>
    </section>
  )
}
