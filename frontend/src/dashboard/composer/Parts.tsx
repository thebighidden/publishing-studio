import { useEffect, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowLeft, ArrowRight, Bot, Check, CircleAlert, ImagePlus, TriangleAlert, X } from 'lucide-react'
import { PLATFORMS, PlatformIcon, type PlatformId } from '../../components/ui/PlatformIcon'
import { api, type Account, type Asset, type SpecCheck } from '../../lib/api'
import { ease } from '../../lib/motion'
import { cn } from '../../lib/cn'
import { useApi, useDebounced } from '../data'
import { MediaPicker, MediaThumb } from '../media/Media'
import { Label, Panel } from '../ui'

type Specs = Record<PlatformId, Record<string, { label: string }>>

/** Post as one of your accounts (its platform, its phone), or pick platforms by hand. */
export function AccountPicker({ accounts, value, onChange }: { accounts: Account[]; value: number | null; onChange: (a: Account | null) => void }) {
  if (!accounts.length) return null
  return (
    <div className="border-t border-line px-5 py-4">
      <Label>Post as</Label>
      <div className="mt-3 flex flex-wrap gap-2">
        <Chip on={value === null} onClick={() => onChange(null)}>
          Any platforms
        </Chip>
        {accounts.map((a) => (
          <Chip key={a.id} on={value === a.id} onClick={() => onChange(a)}>
            <PlatformIcon id={a.platform} className="size-3.5" />@{a.handle}
            {a.automation && <Bot className={cn('size-3', value === a.id ? 'text-ink/60' : 'text-accent-soft')} strokeWidth={2} aria-label="Publishes automatically" />}
          </Chip>
        ))}
      </div>
    </div>
  )
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        'flex h-9 items-center gap-2 rounded-full border px-3.5 text-[12.5px] transition-[background-color,border-color,color] duration-300',
        on ? 'border-fg bg-fg text-ink' : 'border-line-2 text-muted hover:border-white/30 hover:text-fg',
      )}
    >
      {children}
    </button>
  )
}

/** The post's media, in order: add from the library, reorder, remove. */
export function MediaStrip({ media, onChange, max = 10 }: { media: Asset[]; onChange: (media: Asset[]) => void; max?: number }) {
  const [picking, setPicking] = useState(false)
  const move = (i: number, by: number) => {
    const next = [...media]
    ;[next[i], next[i + by]] = [next[i + by], next[i]]
    onChange(next)
  }

  return (
    <div className="border-t border-line px-5 py-4">
      <div className="flex items-center justify-between">
        <Label>Media</Label>
        {media.length > 0 && <span className="font-mono text-[10px] text-dim">{media.length} {media.length === 1 ? 'file' : 'files'}</span>}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <AnimatePresence initial={false}>
          {media.map((a, i) => (
            <motion.div
              key={a.id}
              layout
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ duration: 0.3, ease }}
              className="group relative w-[88px]"
            >
              <MediaThumb asset={a} />
              <span className="absolute inset-x-1 bottom-1 flex justify-between opacity-0 transition-opacity group-hover:opacity-100 [@media(hover:none)]:opacity-100">
                <IconBtn label="Move earlier" disabled={i === 0} onClick={() => move(i, -1)} icon={ArrowLeft} />
                <IconBtn label="Move later" disabled={i === media.length - 1} onClick={() => move(i, 1)} icon={ArrowRight} />
              </span>
              <span className="absolute right-1 top-1 opacity-0 transition-opacity group-hover:opacity-100 [@media(hover:none)]:opacity-100">
                <IconBtn label="Remove" onClick={() => onChange(media.filter((m) => m.id !== a.id))} icon={X} />
              </span>
            </motion.div>
          ))}
        </AnimatePresence>
        {media.length < max && (
          <button
            type="button"
            onClick={() => setPicking(true)}
            aria-label="Add media"
            className="grid aspect-square w-[88px] place-items-center rounded-md border border-dashed border-line-2 text-dim transition-colors hover:border-accent-soft/60 hover:text-fg"
          >
            <span className="flex flex-col items-center gap-1 text-[11px]">
              <ImagePlus className="size-4" strokeWidth={1.75} />
              Add
            </span>
          </button>
        )}
      </div>
      <MediaPicker open={picking} onClose={() => setPicking(false)} onPick={onChange} initial={media} max={max} />
    </div>
  )
}

function IconBtn({ label, onClick, icon: Icon, disabled }: { label: string; onClick: () => void; icon: typeof X; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="grid size-5 place-items-center rounded-full bg-black/70 text-white backdrop-blur transition-opacity disabled:opacity-0"
    >
      <Icon className="size-3" strokeWidth={2} />
    </button>
  )
}

const STATUS = {
  pass: { icon: Check, className: 'text-ok' },
  warn: { icon: TriangleAlert, className: 'text-warn' },
  fail: { icon: CircleAlert, className: 'text-fail' },
}

/**
 * The pre-export check, live as you write: each platform's spec against the caption and media.
 * When a phone will publish the post, a failure blocks scheduling; otherwise it's advice.
 */
export function ChecksPanel({
  platforms,
  caption,
  media,
  placement,
  onPlacement,
  blocking,
  error,
}: {
  platforms: PlatformId[]
  caption: string
  media: Asset[]
  placement: string | null
  onPlacement: (p: string) => void
  blocking: boolean
  error?: string
}) {
  const { data: specs } = useApi<Specs>('/platform-specs')
  const [results, setResults] = useState<SpecCheck[] | null>(null)
  const single = platforms.length === 1
  const key = useDebounced(JSON.stringify([platforms, single ? placement : null, caption, media.map((m) => m.id)]), 350)

  useEffect(() => {
    const [p, place, text, ids] = JSON.parse(key) as [PlatformId[], string | null, string, number[]]
    if (!p.length) return setResults(null)
    let cancelled = false
    api<SpecCheck[]>('/checks', { method: 'POST', body: { platforms: p, placements: place ? { [p[0]]: place } : {}, caption: text, asset_ids: ids } })
      .then((r) => !cancelled && setResults(r))
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [key])

  if (!platforms.length) return null
  const failing = results?.filter((r) => !r.ok).length ?? 0

  return (
    <Panel
      title="Platform check"
      sub={blocking ? 'A phone will publish this, so it has to pass first.' : 'Sizes, lengths and limits, checked as you go.'}
      actions={results && <span className={cn('font-mono text-[10.5px]', failing ? (blocking ? 'text-fail' : 'text-warn') : 'text-ok')}>{failing ? `${failing} to fix` : 'All clear'}</span>}
      bodyClassName="space-y-3 p-3 pt-3"
    >
      {(results ?? []).map((r) => {
        const problems = r.checks.filter((c) => c.status !== 'pass')
        const placements = specs?.[r.platform] ?? {}
        return (
          <div key={r.platform} className={cn('rounded-lg border px-3 py-2.5', r.ok ? 'border-line' : blocking ? 'border-fail/40' : 'border-warn/30')}>
            <div className="flex items-center gap-2">
              <PlatformIcon id={r.platform} className="size-3.5 text-muted" />
              {single && Object.keys(placements).length > 1 ? (
                <select
                  value={r.placement}
                  onChange={(e) => onPlacement(e.target.value)}
                  aria-label={`${PLATFORMS[r.platform].name} placement`}
                  className="rounded bg-transparent text-[12.5px] font-medium outline-none [color-scheme:dark]"
                >
                  {Object.entries(placements).map(([id, p]) => (
                    <option key={id} value={id}>
                      {PLATFORMS[r.platform].name} {p.label.toLowerCase()}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="text-[12.5px] font-medium">{r.label}</span>
              )}
              <span className={cn('ml-auto text-[11px]', r.ok ? 'text-ok' : blocking ? 'text-fail' : 'text-warn')}>{r.ok ? (problems.length ? 'Ready, with notes' : 'Ready') : 'Needs work'}</span>
            </div>
            <ul className="mt-2 space-y-1">
              {(problems.length ? problems : r.checks).map((c) => {
                const S = STATUS[c.status]
                return (
                  <li key={c.key} className="flex gap-2 text-[11.5px] leading-snug text-muted">
                    <S.icon className={cn('mt-px size-3 shrink-0', S.className)} strokeWidth={2} />
                    <span>{c.detail}</span>
                  </li>
                )
              })}
            </ul>
          </div>
        )
      })}
      {error && <p className="px-1 font-mono text-[11px] text-fail">{error}</p>}
    </Panel>
  )
}
