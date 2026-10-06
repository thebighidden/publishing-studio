import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'
import { Reveal } from './Reveal'

export function SectionLabel({
  index,
  children,
  className,
  light,
  signal,
  thread = true,
}: {
  index: string
  children: ReactNode
  className?: string
  /** For the paper sections: dark ink instead of light. */
  light?: boolean
  /** For the accent plate: type in the colour that sits on the accent. */
  signal?: boolean
  /** The dot the drawn line ties a knot around. Off inside pinned/sticky layouts. */
  thread?: boolean
}) {
  return (
    <Reveal
      y={12}
      className={cn(
        'relative flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.18em]',
        light ? 'text-ink/55' : signal ? 'text-on-accent/70' : 'text-muted',
        className,
      )}
    >
      {thread && (
        <span
          data-thread="node"
          aria-hidden
          className={cn(
            'thread-node absolute -left-[10px] top-1/2 size-[7px] -translate-x-1/2 -translate-y-1/2 rounded-full md:-left-4 xl:-left-6',
            light && 'thread-node-light',
            signal && 'thread-node-signal',
          )}
        />
      )}
      <span className={light ? 'text-ink' : signal ? 'text-on-accent' : 'text-fg'}>({index})</span>
      <span className="h-px w-8 bg-current opacity-40" />
      <span>{children}</span>
    </Reveal>
  )
}

/** Editorial caption under a figure — "Fig. 02 — The composer." */
export function Caption({
  fig,
  children,
  className,
  light,
}: {
  fig: string
  children: ReactNode
  className?: string
  light?: boolean
}) {
  return (
    <p className={cn('flex gap-3 font-mono text-[11px] leading-relaxed', light ? 'text-ink/50' : 'text-dim', className)}>
      <span className={cn('shrink-0', light ? 'text-ink' : 'text-muted')}>Fig. {fig}</span>
      <span>{children}</span>
    </p>
  )
}
