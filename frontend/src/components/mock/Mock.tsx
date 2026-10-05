import type { ReactNode } from 'react'
import { motion } from 'framer-motion'
import {
  Bell,
  CalendarDays,
  ChartColumn,
  ChevronDown,
  FolderOpen,
  LayoutGrid,
  PenLine,
  Search,
  Settings,
  Workflow,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '../../lib/cn'
import { DrawnBorder } from '../ui/DrawnBorder'
import { PlatformIcon } from '../ui/PlatformIcon'

/* ------------------------------------------------------------------ */
/* App chrome                                                           */
/* ------------------------------------------------------------------ */

export function AppFrame({
  children,
  crumb,
  className,
  bodyClassName,
}: {
  children: ReactNode
  crumb: string
  className?: string
  bodyClassName?: string
}) {
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-xl border border-white/[0.05] bg-[#0b0b0c] text-left shadow-[0_60px_140px_-40px_rgb(0_0_0_/_0.95)]',
        className,
      )}
    >
      <DrawnBorder />
      <div className="flex h-11 items-center gap-2.5 border-b border-line px-3.5 text-[12px]">
        <span className="grid size-5 place-items-center rounded-[5px] bg-[#e6e0d4] text-[10px] font-semibold text-ink">A</span>
        <span className="whitespace-nowrap font-medium text-fg">Acme Studio</span>
        <ChevronDown className="-ml-1 size-3 text-dim" />
        <span className="hidden text-dim sm:inline">/</span>
        <span className="hidden truncate text-muted sm:inline">{crumb}</span>
        <div className="ml-auto flex items-center gap-2.5">
          <span className="hidden items-center gap-1.5 rounded-md border border-line px-2 py-1 text-dim sm:flex">
            <Search className="size-3" /> Search
            <kbd className="ml-3 font-mono text-[10px]">⌘K</kbd>
          </span>
          <Bell className="size-3.5 text-dim" />
          <span className="grid size-6 place-items-center rounded-full bg-[#2a2622] text-[9.5px] font-medium text-[#d8cbbb]">
            MR
          </span>
        </div>
      </div>
      <div className={bodyClassName}>{children}</div>
    </div>
  )
}

const NAV: Array<{ label: string; icon: LucideIcon; count?: number }> = [
  { label: 'Dashboard', icon: LayoutGrid },
  { label: 'Create', icon: PenLine },
  { label: 'Library', icon: FolderOpen },
  { label: 'Automations', icon: Workflow, count: 3 },
  { label: 'Calendar', icon: CalendarDays },
  { label: 'Analytics', icon: ChartColumn },
]

export function Sidebar({ active, className }: { active: string; className?: string }) {
  const item = (label: string, Icon: LucideIcon, count?: number) => (
    <div
      key={label}
      className={cn(
        'flex items-center gap-2.5 rounded-md px-2.5 py-[7px]',
        active === label ? 'bg-white/[0.06] text-fg' : 'text-muted',
      )}
    >
      <Icon className="size-3.5" strokeWidth={1.75} />
      {label}
      {count !== undefined && <span className="ml-auto font-mono text-[10px] text-dim">{count}</span>}
    </div>
  )

  return (
    <aside className={cn('w-48 shrink-0 flex-col gap-0.5 border-r border-line p-2.5 text-[12.5px]', className)}>
      {NAV.map((n) => item(n.label, n.icon, n.count))}
      <div className="mt-auto space-y-2.5 pt-6">
        <div className="rounded-md border border-line p-2.5">
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-dim">Connected</p>
          <div className="mt-2 flex items-center gap-2 text-muted">
            <PlatformIcon id="linkedin" className="size-3.5" />
            <PlatformIcon id="instagram" className="size-3.5" />
            <PlatformIcon id="x" className="size-3.5" />
            <PlatformIcon id="tiktok" className="size-3.5" />
            <span className="ml-auto font-mono text-[10px] text-dim">4</span>
          </div>
        </div>
        {item('Settings', Settings)}
      </div>
    </aside>
  )
}

/* ------------------------------------------------------------------ */
/* Small pieces                                                         */
/* ------------------------------------------------------------------ */

export type Status = 'draft' | 'scheduled' | 'published' | 'failed'

export const STATUS: Record<Status, { label: string; dot: string; text: string; ring: string }> = {
  draft: { label: 'Draft', dot: 'bg-draft', text: 'text-muted', ring: 'border-white/10' },
  scheduled: { label: 'Scheduled', dot: 'bg-plan', text: 'text-plan', ring: 'border-plan/30' },
  published: { label: 'Published', dot: 'bg-ok', text: 'text-ok', ring: 'border-ok/25' },
  failed: { label: 'Failed', dot: 'bg-fail', text: 'text-fail', ring: 'border-fail/30' },
}

export function StatusBadge({ status, className }: { status: Status; className?: string }) {
  const s = STATUS[status]
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10.5px] font-medium',
        s.ring,
        s.text,
        className,
      )}
    >
      <span className={cn('size-1.5 rounded-full', s.dot)} />
      {s.label}
    </span>
  )
}

/** Uppercase mono field label used throughout the mock UIs. */
export function Field({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn('font-mono text-[10px] uppercase tracking-[0.14em] text-dim', className)}>{children}</p>
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange?: (on: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange?.(!on)}
      className={cn(
        'relative flex h-5 w-9 shrink-0 items-center rounded-full border p-0.5 transition-colors duration-300',
        on ? 'justify-end border-accent/60 bg-accent' : 'justify-start border-line-2 bg-white/5',
      )}
    >
      <motion.span layout transition={{ type: 'spring', stiffness: 600, damping: 35 }} className="size-3.5 rounded-full bg-white" />
    </button>
  )
}

/** Blinking text caret. */
export function Caret({ className }: { className?: string }) {
  return <span className={cn('ml-px inline-block h-[1.05em] w-px translate-y-[0.15em] animate-blink bg-accent-soft', className)} />
}
