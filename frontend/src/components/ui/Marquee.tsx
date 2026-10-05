import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'

/** CSS-only infinite strip. The content is rendered twice and the track slides by half. */
export function Marquee({ children, className, reverse }: { children: ReactNode; className?: string; reverse?: boolean }) {
  return (
    <div className={cn('group flex overflow-hidden mask-x', className)}>
      <div
        className="flex w-max animate-marquee group-hover:[animation-play-state:paused] motion-reduce:animate-none"
        style={reverse ? { animationDirection: 'reverse' } : undefined}
      >
        <div className="flex shrink-0 items-center">{children}</div>
        <div aria-hidden className="flex shrink-0 items-center">
          {children}
        </div>
      </div>
    </div>
  )
}
