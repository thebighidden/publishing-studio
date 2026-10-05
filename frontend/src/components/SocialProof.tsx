import { Marquee } from './ui/Marquee'
import { PLATFORMS, PlatformIcon, type PlatformId } from './ui/PlatformIcon'
import { Reveal } from './ui/Reveal'

const ORDER: PlatformId[] = ['instagram', 'tiktok', 'x', 'linkedin', 'facebook', 'youtube', 'pinterest']

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

      <Marquee className="mt-10 md:mt-14">
        {ORDER.map((id) => (
          <div
            key={id}
            className="flex items-center gap-4 px-8 text-fg/35 transition-colors duration-500 hover:text-fg md:gap-5 md:px-12"
          >
            <PlatformIcon id={id} className="size-7 md:size-9" />
            <span className="text-3xl font-medium tracking-[-0.04em] md:text-5xl">{PLATFORMS[id].name}</span>
          </div>
        ))}
      </Marquee>
    </section>
  )
}
