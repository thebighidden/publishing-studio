import { motion } from 'framer-motion'
import { Button } from './ui/Button'
import { LineReveal, Reveal, Serif } from './ui/Reveal'

export function FinalCTA() {
  return (
    <section id="start" className="relative isolate flex min-h-[92vh] items-center overflow-hidden border-t border-line py-32">
      {/* A horizon of light, breathing slowly. */}
      <motion.div
        aria-hidden
        className="absolute left-1/2 top-[60%] -z-10 h-[90vh] w-[140vw] -translate-x-1/2 rounded-[50%] md:w-[110vw]"
        style={{
          background:
            'radial-gradient(closest-side, rgb(99 102 241 / 0.42), rgb(139 92 246 / 0.16) 45%, transparent 75%)',
        }}
        animate={{ scale: [1, 1.07, 1], opacity: [0.75, 1, 0.75] }}
        transition={{ duration: 9, repeat: Infinity, ease: 'easeInOut' }}
      />
      <div
        aria-hidden
        className="absolute inset-x-0 top-[84%] -z-10 h-px bg-gradient-to-r from-transparent via-accent-soft/60 to-transparent"
      />
      <div
        aria-hidden
        className="absolute inset-0 -z-10 opacity-40"
        style={{
          backgroundImage:
            'linear-gradient(rgb(255 255 255 / 0.05) 1px, transparent 1px), linear-gradient(90deg, rgb(255 255 255 / 0.05) 1px, transparent 1px)',
          backgroundSize: '72px 72px',
          maskImage: 'radial-gradient(ellipse 60% 55% at 50% 45%, #000 20%, transparent 75%)',
        }}
      />

      <div className="container-x text-center">
        <Reveal y={12}>
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted">(15) — Start</p>
        </Reveal>
        <div className="relative">
        <span data-thread="point" data-dir="0.15,1" aria-hidden className="absolute right-[6%] top-0 size-px" />
        <LineReveal
          className="mx-auto mt-8 max-w-[14ch] text-[clamp(3rem,9vw,9.5rem)] font-medium leading-[0.88] tracking-[-0.055em]"
          lines={['Stop creating', <>content <Serif data-thread="scribble" data-from="right">manually.</Serif></>]}
        />
        </div>
        <Reveal delay={0.2} className="mx-auto mt-10 max-w-md text-lg leading-snug text-muted md:text-xl">
          Build your workflow once and let AI handle the repetitive work.
        </Reveal>
        <Reveal delay={0.3} className="mt-10 flex flex-wrap items-center justify-center gap-3">
          <span data-thread="end" className="inline-flex">
            <Button href="/signup" size="lg" arrow cursor="Go">
              Start Creating Free
            </Button>
          </span>
          <Button href="#product" size="lg" variant="ghost">
            Explore the Platform
          </Button>
        </Reveal>
        <Reveal delay={0.35}>
          <p className="mt-5 font-mono text-[11px] text-dim">No credit card required.</p>
        </Reveal>
      </div>
    </section>
  )
}
