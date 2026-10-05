import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'
import { Reveal } from './Reveal'

export function SectionLabel({
  index,
  children,
  className,
  light,
  thread = true,
}: {
  index: string
  children: ReactNode
  className?: string
  /** For the bone section: dark ink instead of light. */
  light?: boolean
  /** The dot the drawn line ties a knot around. Off inside pinned/sticky layouts. */
  thread?: boolean
}) {
  return (
    <Reveal
      y={12}
      className={cn(
        'relative flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.18em]',
        light ? 'text-ink/55' : 'text-muted',
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
          )}
        />
      )}
      <span className={light ? 'text-ink' : 'text-fg'}>({index})</span>
      <span className="h-px w-8 bg-current opacity-40" />
      <span>{children}</span>
    </Reveal>
  )
}

/** Editorial caption under a figure — "Fig. 02 — The composer." */
export function Caption({ fig, children, className }: { fig: string; children: ReactNode; className?: string }) {
  return (
    <p className={cn('flex gap-3 font-mono text-[11px] leading-relaxed text-dim', className)}>
      <span className="shrink-0 text-muted">Fig. {fig}</span>
      <span>{children}</span>
    </p>
  )
}
