import { createContext, useContext, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowLeft,
  CalendarDays,
  ChartColumn,
  ChevronDown,
  CornerDownLeft,
  FolderOpen,
  LayoutGrid,
  LogOut,
  Mail,
  Menu as MenuIcon,
  PenLine,
  Plus,
  Search,
  Settings,
  Workflow,
  X,
  type LucideIcon,
} from 'lucide-react'
import { useLenis } from 'lenis/react'
import { LogoMark } from '../components/ui/Logo'
import { api, type Page, type Post, type User } from '../lib/api'
import { authApi } from '../lib/auth'
import { ease } from '../lib/motion'
import { cn } from '../lib/cn'
import { useRouter } from '../lib/router'
import { useSession } from '../lib/session'
import { firstName, postState, titleOf, useApi, type Overview } from './data'
import { useToast } from './toast'
import { Avatar, Kbd, Menu, Platforms, StateBadge } from './ui'

type NavItem = { path: string; label: string; icon: LucideIcon; count?: (o: Overview) => number }

export const NAV: NavItem[] = [
  { path: '/dashboard', label: 'Overview', icon: LayoutGrid },
  { path: '/dashboard/create', label: 'Create', icon: PenLine },
  { path: '/dashboard/library', label: 'Library', icon: FolderOpen, count: (o) => o.counts.total },
  { path: '/dashboard/calendar', label: 'Calendar', icon: CalendarDays, count: (o) => o.counts.scheduled },
  { path: '/dashboard/automations', label: 'Automations', icon: Workflow },
  { path: '/dashboard/analytics', label: 'Analytics', icon: ChartColumn },
]
const SETTINGS: NavItem = { path: '/dashboard/settings', label: 'Settings', icon: Settings }

export const pageLabel = (path: string) => [...NAV, SETTINGS].find((n) => n.path === path)?.label ?? 'Overview'

/* ------------------------------------------------------------------ */
/* Shared overview data: sidebar counts and the Overview page read one fetch */
/* ------------------------------------------------------------------ */

const OverviewContext = createContext<{ data: Overview | null; loading: boolean }>({ data: null, loading: true })
export const useOverview = () => useContext(OverviewContext)

/** The signed-in user. The shell only renders once there is one. */
export function useUser(): User {
  const { user } = useSession()
  if (!user) throw new Error('useUser needs a signed-in user')
  return user
}

export const workspaceName = (user: User) => `${firstName(user.name)}’s studio`

/* ------------------------------------------------------------------ */

export function Shell({ children }: { children: ReactNode }) {
  const user = useUser()
  const overview = useApi<Overview>('/overview')
  const { path, navigate } = useRouter()
  const [drawer, setDrawer] = useState(false)
  const [palette, setPalette] = useState(false)

  // ⌘K / Ctrl+K opens the palette; N starts a post when you're not typing somewhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPalette((p) => !p)
        return
      }
      const typing = (e.target as HTMLElement | null)?.closest('input, textarea, select, [contenteditable="true"]')
      if (!typing && !e.metaKey && !e.ctrlKey && !e.altKey && e.key.toLowerCase() === 'n') {
        e.preventDefault()
        navigate('/dashboard/create')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate])

  useEffect(() => setDrawer(false), [path])

  return (
    <OverviewContext.Provider value={{ data: overview.data, loading: overview.loading }}>
      <div className="min-h-dvh bg-ink text-fg">
        <aside className="fixed inset-y-0 left-0 z-40 hidden w-[236px] border-r border-line bg-[#0b0b0c] lg:block">
          <Sidebar overview={overview.data} />
        </aside>

        <AnimatePresence>
          {drawer && (
            <>
              <motion.div
                className="fixed inset-0 z-50 bg-ink/70 backdrop-blur-sm lg:hidden"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setDrawer(false)}
              />
              <motion.aside
                className="fixed inset-y-0 left-0 z-50 w-[272px] border-r border-line bg-[#0b0b0c] lg:hidden"
                initial={{ x: '-100%' }}
                animate={{ x: 0 }}
                exit={{ x: '-100%' }}
                transition={{ duration: 0.5, ease }}
                data-lenis-prevent
              >
                <Sidebar overview={overview.data} onClose={() => setDrawer(false)} />
              </motion.aside>
            </>
          )}
        </AnimatePresence>

        <div className="lg:pl-[236px]">
          <TopBar onMenu={() => setDrawer(true)} onSearch={() => setPalette(true)} />
          {!user.email_verified && <VerifyBanner email={user.email} />}
          <main className="mx-auto w-full max-w-[1320px] px-4 pb-24 pt-8 md:px-8 md:pt-10">{children}</main>
        </div>

        <CommandPalette open={palette} onClose={() => setPalette(false)} />
      </div>
    </OverviewContext.Provider>
  )
}

/* ------------------------------------------------------------------ */
/* Sidebar                                                              */
/* ------------------------------------------------------------------ */

function Sidebar({ overview, onClose }: { overview: Overview | null; onClose?: () => void }) {
  const user = useUser()
  const { path, navigate } = useRouter()
  const { signOut } = useSession()

  const logOut = async () => {
    // Head for the door first, so the guard doesn't add a ?next= back to here.
    navigate('/login')
    await signOut()
  }

  const item = (n: NavItem) => {
    const active = path === n.path
    const Icon = n.icon
    const count = overview && n.count ? n.count(overview) : null
    return (
      <a
        key={n.path}
        href={n.path}
        onClick={(e) => {
          e.preventDefault()
          navigate(n.path)
        }}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'group relative flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[12.5px] transition-colors duration-200',
          active ? 'text-fg' : 'text-muted hover:text-fg',
        )}
      >
        {active && (
          <motion.span
            layoutId={onClose ? 'nav-active-drawer' : 'nav-active'}
            className="absolute inset-0 rounded-md bg-white/[0.07]"
            transition={{ type: 'spring', stiffness: 500, damping: 40 }}
          />
        )}
        <Icon className="relative size-3.5 transition-transform duration-300 group-hover:scale-110" strokeWidth={1.75} />
        <span className="relative">{n.label}</span>
        {count !== null && count > 0 && (
          <span className="relative ml-auto font-mono text-[10px] tabular-nums text-dim">{count}</span>
        )}
      </a>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 items-center gap-2 border-b border-line px-3">
        <Menu
          className="min-w-0 flex-1"
          align="left"
          header={
            <div className="mb-1 border-b border-line px-2.5 pb-2.5 pt-1.5">
              <p className="truncate text-[12.5px] text-fg">{user.name}</p>
              <p className="truncate text-[11.5px] text-dim">{user.email}</p>
            </div>
          }
          items={[
            { label: 'Settings', icon: Settings, onSelect: () => navigate('/dashboard/settings') },
            { label: 'Back to the site', icon: ArrowLeft, onSelect: () => navigate('/') },
            { label: 'Log out', icon: LogOut, onSelect: logOut, danger: true },
          ]}
          trigger={({ toggle, open }) => (
            <button
              type="button"
              onClick={toggle}
              aria-expanded={open}
              className="flex w-full min-w-0 items-center gap-2.5 rounded-md px-1.5 py-1.5 text-left transition-colors hover:bg-white/[0.04]"
            >
              <span className="grid size-6 shrink-0 place-items-center rounded-[5px] bg-[#e6e0d4] text-[11px] font-semibold text-ink">
                {firstName(user.name)[0]?.toUpperCase()}
              </span>
              <span className="truncate text-[13px] font-medium">{workspaceName(user)}</span>
              <ChevronDown className={cn('ml-auto size-3.5 shrink-0 text-dim transition-transform duration-300', open && 'rotate-180')} />
            </button>
          )}
        />
        {onClose && (
          <button type="button" onClick={onClose} aria-label="Close menu" className="grid size-8 place-items-center text-dim hover:text-fg">
            <X className="size-4" />
          </button>
        )}
      </div>

      <div className="px-3 pt-3">
        <button
          type="button"
          onClick={() => navigate('/dashboard/create')}
          className="group flex h-9 w-full items-center gap-2 rounded-md bg-fg px-3 text-[12.5px] font-medium text-ink transition-[background-color,box-shadow] duration-300 hover:bg-white hover:shadow-[0_0_0_4px_rgb(99_102_241_/_0.2)]"
        >
          <Plus className="size-3.5 transition-transform duration-500 ease-expo group-hover:rotate-90" strokeWidth={2} />
          New post
          <Kbd className="ml-auto border-ink/20 text-ink/50">N</Kbd>
        </button>
      </div>

      <nav className="mt-4 flex flex-col gap-0.5 px-3" aria-label="Workspace">
        {NAV.map(item)}
      </nav>

      <div className="mt-auto space-y-2.5 p-3">
        <a
          href="/dashboard/settings"
          onClick={(e) => {
            e.preventDefault()
            navigate('/dashboard/settings')
          }}
          className="block rounded-md border border-line p-2.5 transition-colors hover:border-line-2"
        >
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-dim">Your channels</p>
          <div className="mt-2 flex items-center gap-2">
            {user.preferences.platforms.length ? (
              <Platforms ids={user.preferences.platforms} />
            ) : (
              <span className="text-[11.5px] text-dim">Pick your platforms</span>
            )}
            <span className="ml-auto font-mono text-[10px] text-dim">{user.preferences.platforms.length}</span>
          </div>
        </a>
        {item(SETTINGS)}
        <div className="flex items-center gap-2.5 border-t border-line px-1 pt-3">
          <Avatar user={user} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12.5px]">{user.name}</p>
            <p className="truncate text-[11px] text-dim">{user.email}</p>
          </div>
          <button
            type="button"
            onClick={logOut}
            aria-label="Log out"
            className="grid size-7 place-items-center rounded-md text-dim transition-colors hover:bg-white/[0.05] hover:text-fg"
          >
            <LogOut className="size-3.5" strokeWidth={1.75} />
          </button>
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Top bar                                                              */
/* ------------------------------------------------------------------ */

function TopBar({ onMenu, onSearch }: { onMenu: () => void; onSearch: () => void }) {
  const user = useUser()
  const { path } = useRouter()
  const label = pageLabel(path)

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-ink/80 px-4 backdrop-blur-xl md:px-8">
      <button
        type="button"
        onClick={onMenu}
        aria-label="Open menu"
        className="-ml-1 grid size-8 place-items-center rounded-md text-muted hover:bg-white/[0.05] hover:text-fg lg:hidden"
      >
        <MenuIcon className="size-4" />
      </button>
      <LogoMark className="size-4 lg:hidden" />
      <p className="flex min-w-0 items-center gap-2 text-[12.5px]">
        <span className="hidden truncate text-dim sm:inline">{workspaceName(user)}</span>
        <span className="hidden text-dim sm:inline">/</span>
        <span className="relative h-5 overflow-hidden">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={label}
              className="block leading-5 text-fg"
              initial={{ y: '100%', opacity: 0 }}
              animate={{ y: '0%', opacity: 1 }}
              exit={{ y: '-100%', opacity: 0 }}
              transition={{ duration: 0.4, ease }}
            >
              {label}
            </motion.span>
          </AnimatePresence>
        </span>
      </p>

      <button
        type="button"
        onClick={onSearch}
        className="ml-auto flex h-8 items-center gap-2 rounded-md border border-line px-2.5 text-[12px] text-dim transition-colors hover:border-line-2 hover:text-muted sm:w-56"
      >
        <Search className="size-3.5" strokeWidth={1.75} />
        <span className="hidden sm:inline">Search posts & pages</span>
        <Kbd className="ml-auto hidden sm:inline">⌘K</Kbd>
      </button>
    </header>
  )
}

/* ------------------------------------------------------------------ */
/* Email confirmation                                                   */
/* ------------------------------------------------------------------ */

function VerifyBanner({ email }: { email: string }) {
  const [hidden, setHidden] = useState(false)
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle')
  const toast = useToast()

  const resend = async () => {
    setState('sending')
    try {
      await authApi.resendVerification()
      setState('sent')
    } catch (e) {
      setState('idle')
      toast(e instanceof Error ? e.message : 'Couldn’t send the link.', 'error')
    }
  }

  return (
    <AnimatePresence initial={false}>
      {!hidden && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.4, ease }}
          className="overflow-hidden border-b border-accent/20 bg-accent/[0.07]"
        >
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 text-[12.5px] md:px-8">
            <Mail className="size-3.5 text-accent-soft" strokeWidth={1.75} />
            <p className="text-muted">
              Confirm <span className="text-fg">{email}</span> to keep your account secure.
            </p>
            <button
              type="button"
              onClick={resend}
              disabled={state !== 'idle'}
              className="font-medium text-accent-soft transition-colors hover:text-fg disabled:text-dim"
            >
              {state === 'sending' ? 'Sending…' : state === 'sent' ? 'Sent. Check your inbox.' : 'Resend the link'}
            </button>
            <button type="button" onClick={() => setHidden(true)} aria-label="Dismiss" className="ml-auto text-dim hover:text-fg">
              <X className="size-3.5" />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/* ------------------------------------------------------------------ */
/* ⌘K                                                                   */
/* ------------------------------------------------------------------ */

type Result = { key: string; label: string; hint?: ReactNode; icon: LucideIcon; to: string }

function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { navigate } = useRouter()
  const lenis = useLenis()
  const [q, setQ] = useState('')
  const [posts, setPosts] = useState<Post[]>([])
  const [active, setActive] = useState(0)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setQ('')
    setActive(0)
    lenis?.stop()
    const t = window.setTimeout(() => input.current?.focus(), 30)
    return () => {
      window.clearTimeout(t)
      lenis?.start()
    }
  }, [open, lenis])

  // Search posts as you type, a beat after you stop.
  useEffect(() => {
    if (!open) return
    const t = window.setTimeout(() => {
      api<Page<Post>>('/posts', { query: { q: q.trim() || undefined, per_page: 6 } })
        .then((r) => setPosts(r.data))
        .catch(() => setPosts([]))
    }, 180)
    return () => window.clearTimeout(t)
  }, [q, open])

  const needle = q.trim().toLowerCase()
  const pages: Result[] = [
    { key: 'new', label: 'New post', icon: Plus, to: '/dashboard/create', hint: <Kbd>N</Kbd> },
    ...[...NAV, SETTINGS].map((n) => ({ key: n.path, label: n.label, icon: n.icon, to: n.path })),
  ].filter((r) => !needle || r.label.toLowerCase().includes(needle))
  const found: Result[] = posts.map((p) => ({
    key: `post-${p.id}`,
    label: titleOf(p),
    icon: PenLine,
    to: `/dashboard/create?post=${p.id}`,
    hint: (
      <span className="flex items-center gap-2">
        <Platforms ids={p.platforms} />
        <StateBadge state={postState(p)} />
      </span>
    ),
  }))
  const results = [...pages, ...found]

  const go = (r: Result | undefined) => {
    if (!r) return
    onClose()
    navigate(r.to)
  }

  const onKey = (e: ReactKeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => Math.min(results.length - 1, a + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(0, a - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      go(results[active])
    } else if (e.key === 'Escape') {
      onClose()
    }
  }

  const row = (r: Result, i: number) => {
    const Icon = r.icon
    return (
      <button
        key={r.key}
        type="button"
        onMouseMove={() => setActive(i)}
        onClick={() => go(r)}
        className={cn(
          'relative flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-[13px] transition-colors',
          active === i ? 'text-fg' : 'text-muted',
        )}
      >
        {active === i && (
          <motion.span layoutId="palette-active" className="absolute inset-0 rounded-md bg-white/[0.06]" transition={{ type: 'spring', stiffness: 600, damping: 45 }} />
        )}
        <Icon className="relative size-3.5 shrink-0" strokeWidth={1.75} />
        <span className="relative min-w-0 flex-1 truncate">{r.label}</span>
        <span className="relative shrink-0">{active === i ? <CornerDownLeft className="size-3.5 text-dim" /> : r.hint}</span>
      </button>
    )
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[120] flex items-start justify-center p-4 pt-[12vh]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <div className="absolute inset-0 bg-ink/70 backdrop-blur-sm" onClick={onClose} />
          <motion.div
            role="dialog"
            aria-label="Search"
            data-lenis-prevent
            className="relative w-full max-w-xl overflow-hidden rounded-xl border border-line-2 bg-[#0e0e10] shadow-[0_40px_120px_-30px_rgb(0_0_0_/_0.95)]"
            initial={{ opacity: 0, y: -12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.3, ease }}
          >
            <div className="flex items-center gap-3 border-b border-line px-4">
              <Search className="size-4 text-dim" strokeWidth={1.75} />
              <input
                ref={input}
                value={q}
                onChange={(e) => {
                  setQ(e.target.value)
                  setActive(0)
                }}
                onKeyDown={onKey}
                placeholder="Search posts, or jump to a page…"
                className="h-12 flex-1 bg-transparent text-[14px] outline-none placeholder:text-dim"
              />
              <Kbd>Esc</Kbd>
            </div>
            <div className="max-h-[50vh] overflow-y-auto p-2">
              {pages.length > 0 && <p className="px-3 pb-1 pt-2 font-mono text-[10px] uppercase tracking-[0.14em] text-dim">Go to</p>}
              {pages.map((r, i) => row(r, i))}
              {found.length > 0 && <p className="px-3 pb-1 pt-3 font-mono text-[10px] uppercase tracking-[0.14em] text-dim">Posts</p>}
              {found.map((r, i) => row(r, pages.length + i))}
              {results.length === 0 && <p className="px-3 py-8 text-center text-[13px] text-dim">Nothing matches “{q}”.</p>}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
