import { cn } from '../../lib/cn'
import { useLinkClick } from '../../lib/router'
import { RollChars } from './Button'

/** Three bars stepping down: one idea narrowing into a single output. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn('size-5', className)} aria-hidden>
      <path d="M3 4h18v4H3zM3 10h11.5v4H3zM3 16h6v4H3z" fill="currentColor" />
      <circle cx="17.5" cy="18" r="2.4" className="fill-accent" />
    </svg>
  )
}

/** `href` is "#top" on the home page and "/" anywhere else. */
export function Logo({ className, href = '#top' }: { className?: string; href?: string }) {
  const onClick = useLinkClick(href)
  return (
    <a href={href} onClick={onClick} aria-label="FlowAI home" className={cn('group inline-flex items-center gap-2.5', className)}>
      <LogoMark className="transition-transform duration-700 ease-expo group-hover:-rotate-90" />
      <span className="text-[17px] font-semibold tracking-[-0.04em]">
        <RollChars>FlowAI</RollChars>
      </span>
    </a>
  )
}
