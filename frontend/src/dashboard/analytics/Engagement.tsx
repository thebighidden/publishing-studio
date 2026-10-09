import { ExternalLink, Eye, Heart, MessageCircle, Repeat2, Bookmark, Users } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { PLATFORMS, PlatformIcon } from '../../components/ui/PlatformIcon'
import type { PostMetrics } from '../../lib/api'
import { useRouter } from '../../lib/router'
import { BarList } from '../charts'
import { PLATFORM_ORDER, type Analytics } from '../data'
import { CountUp, Panel } from '../ui'

const REACTION_EMOJI: Record<string, string> = { like: '👍', love: '❤️', care: '🤗', haha: '😆', wow: '😮', sad: '😢', angry: '😠' }

const TILES: Array<{ key: keyof Analytics['engagement']['totals']; label: string; icon: LucideIcon }> = [
  { key: 'likes', label: 'Likes & reactions', icon: Heart },
  { key: 'comments', label: 'Comments', icon: MessageCircle },
  { key: 'shares', label: 'Shares', icon: Repeat2 },
  { key: 'saves', label: 'Saves', icon: Bookmark },
  { key: 'views', label: 'Views', icon: Eye },
  { key: 'reach', label: 'Reach', icon: Users },
]

const compact = (n: number) => new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(n)

/** Likes, comments, shares, saves, views and reach on what went out, as the platforms report them. */
export function Engagement({ data, range }: { data: Analytics['engagement']; range: number }) {
  const { navigate } = useRouter()

  if (data.posts === 0) {
    return (
      <Panel title="Engagement" sub={`Posts published in the last ${range} days`}>
        <p className="py-6 text-center text-[12.5px] leading-relaxed text-dim">
          Nothing to show yet. Connect Instagram, Facebook or X on the Accounts page: posts published through the API bring their likes, comments,
          shares and views back every hour.
          <br />
          <button type="button" onClick={() => navigate('/dashboard/accounts')} className="mt-2 text-accent-soft hover:text-fg">
            Go to Accounts →
          </button>
        </p>
      </Panel>
    )
  }

  const reactions = Object.entries(data.reactions)
  const platforms = PLATFORM_ORDER.filter((id) => data.by_platform[id])

  return (
    <Panel
      title="Engagement"
      sub={`${data.posts} post${data.posts === 1 ? '' : 's'} published in the last ${range} days${data.updated_at ? ` · updated ${new Date(data.updated_at).toLocaleString()}` : ''}`}
    >
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-3 xl:grid-cols-6">
        {TILES.map(({ key, label, icon: Icon }) => (
          <div key={key} className="bg-panel px-4 py-3">
            <p className="flex items-center gap-1.5 font-mono text-[9.5px] uppercase tracking-[0.14em] text-dim">
              <Icon className="size-3" strokeWidth={1.75} />
              {label}
            </p>
            <p className="mt-1.5 text-[22px] font-medium tracking-[-0.02em] tabular-nums">
              <CountUp value={data.totals[key]} />
            </p>
          </div>
        ))}
      </div>

      {reactions.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2" aria-label="Facebook reactions">
          {reactions.map(([type, n]) => (
            <span key={type} className="flex items-center gap-1.5 rounded-full border border-line-2 px-2.5 py-1 text-[12px]">
              <span aria-hidden>{REACTION_EMOJI[type] ?? '•'}</span>
              <span className="capitalize text-muted">{type}</span>
              <span className="tabular-nums">{compact(n)}</span>
            </span>
          ))}
        </div>
      )}

      <div className="mt-5 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_1.4fr]">
        <div>
          <p className="mb-3 font-mono text-[9.5px] uppercase tracking-[0.14em] text-dim">Likes by platform</p>
          <BarList
            caption="Likes by platform"
            unit="likes"
            rows={platforms.map((id) => ({
              key: id,
              name: PLATFORMS[id].name,
              value: data.by_platform[id]!.likes,
              label: (
                <>
                  <PlatformIcon id={id} className="size-3.5 shrink-0 text-fg" />
                  <span className="truncate">{PLATFORMS[id].name}</span>
                </>
              ),
            }))}
          />
        </div>
        <div>
          <p className="mb-3 font-mono text-[9.5px] uppercase tracking-[0.14em] text-dim">Best posts</p>
          <ol className="space-y-1.5">
            {data.top.map((p, i) => (
              <li key={p.id} className="flex items-center gap-3 rounded-md border border-line px-3 py-2">
                <span className="w-4 font-mono text-[11px] text-dim">{i + 1}</span>
                {p.platform && <PlatformIcon id={p.platform} className="size-3.5 shrink-0" />}
                <span className="min-w-0 flex-1 truncate text-[12.5px]">{p.title}</span>
                <MetricsInline metrics={p.metrics} />
                {p.post_url && (
                  <a href={p.post_url} target="_blank" rel="noreferrer" className="text-dim hover:text-fg" aria-label="Open the post">
                    <ExternalLink className="size-3.5" strokeWidth={1.75} />
                  </a>
                )}
              </li>
            ))}
          </ol>
        </div>
      </div>
    </Panel>
  )
}

/** A post's numbers in one line: likes, comments, shares, views (what the platform reports). */
export function MetricsInline({ metrics }: { metrics: PostMetrics }) {
  const items: Array<[LucideIcon, number | null, string]> = [
    [Heart, metrics.likes, 'likes'],
    [MessageCircle, metrics.comments, 'comments'],
    [Repeat2, metrics.shares, 'shares'],
    [Eye, metrics.views, 'views'],
  ]
  return (
    <span className="flex shrink-0 items-center gap-2.5 text-[11.5px] tabular-nums text-muted">
      {items
        .filter(([, n]) => n !== null)
        .map(([Icon, n, label]) => (
          <span key={label} className="flex items-center gap-1" title={`${n} ${label}`}>
            <Icon className="size-3" strokeWidth={1.75} />
            {compact(n!)}
          </span>
        ))}
    </span>
  )
}
