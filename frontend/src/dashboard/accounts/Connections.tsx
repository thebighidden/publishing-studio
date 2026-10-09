import { useEffect, useState } from 'react'
import { Link2, PlugZap, Unplug } from 'lucide-react'
import { PlatformIcon } from '../../components/ui/PlatformIcon'
import { api, type Account, type Connection, type Connections as ConnectionList } from '../../lib/api'
import { cn } from '../../lib/cn'
import { useApi, useInvalidate } from '../data'
import { useToast } from '../toast'
import { Btn, inputClass, Skeleton } from '../ui'

const KIND_LABEL: Record<Connection['kind'], string> = { instagram: 'Instagram', facebook_page: 'Facebook Page', x: 'X' }

/**
 * Accounts connected through the platforms' official sign-in. Connected accounts publish through
 * the API (Instagram feed, Reels, Stories, carousels; Facebook Pages; X) and bring likes,
 * comments, shares and views back each hour. No passwords: the platform's own sign-in page.
 */
export function Connections({ accounts }: { accounts: Account[] }) {
  const { data, loading } = useApi<ConnectionList>('/connections')
  const toast = useToast()

  // The sign-in round trip comes back here with ?connected=… or ?connect_error=…
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const connected = params.get('connected')
    const error = params.get('connect_error')
    if (!connected && !error) return
    if (connected) toast(`Connected ${connected}.`)
    if (error) toast(error, 'error')
    window.history.replaceState(null, '', window.location.pathname)
  }, [toast])

  const connect = (provider: 'meta' | 'x') => {
    window.location.href = `/oauth/connect/${provider}/redirect`
  }

  return (
    <section className="rounded-xl border border-line bg-panel">
      <header className="flex flex-wrap items-start gap-3 border-b border-line p-4">
        <span className="grid size-10 shrink-0 place-items-center rounded-lg border border-line-2 bg-white/[0.03] text-accent-soft">
          <PlugZap className="size-4.5" strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[14px] font-medium tracking-[-0.01em]">Official connections</h2>
          <p className="mt-0.5 max-w-2xl text-[12px] leading-snug text-dim">
            Sign in on the platform’s own page (FlowAI never sees a password). Connected accounts publish through the API: Instagram posts, Reels,
            Stories and carousels, Facebook Page posts, Reels and Stories, and X posts. Likes, comments, shares, views and reactions come back every
            hour; X numbers are read on a phone.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Btn variant="primary" icon={Link2} disabled={!data?.available.meta} onClick={() => connect('meta')} title={data && !data.available.meta ? 'Add META_APP_ID and META_APP_SECRET to backend/.env' : undefined}>
            Instagram & Facebook
          </Btn>
          <Btn variant="subtle" icon={Link2} disabled={!data?.available.x} onClick={() => connect('x')} title={data && !data.available.x ? 'Add X_CLIENT_ID to backend/.env' : undefined}>
            X
          </Btn>
        </div>
      </header>

      {data && (!data.available.meta || !data.available.x) && (
        <p className="border-b border-line px-4 py-2.5 text-[11.5px] text-warn">
          {!data.available.meta && 'Meta isn’t set up yet: add META_APP_ID and META_APP_SECRET to backend/.env. '}
          {!data.available.x && 'X isn’t set up yet: add X_CLIENT_ID to backend/.env.'}
        </p>
      )}
      {data && data.available.meta && !data.public_media && (
        <p className="border-b border-line px-4 py-2.5 text-[11.5px] text-warn">
          Instagram downloads photos from a public address: set META_PUBLIC_MEDIA_URL to this API’s public URL (a domain or a tunnel). Videos, Reels and
          Facebook posts work without it.
        </p>
      )}

      {!data && loading ? (
        <div className="space-y-2 p-4">
          <Skeleton className="h-11 rounded-lg" />
          <Skeleton className="h-11 rounded-lg" />
        </div>
      ) : data && data.data.length > 0 ? (
        <ul className="divide-y divide-line">
          {data.data.map((c) => (
            <ConnectionRow key={c.id} connection={c} accounts={accounts.filter((a) => a.platform === c.platform)} />
          ))}
        </ul>
      ) : (
        <p className="px-4 py-4 text-[12px] text-dim">Nothing connected yet.</p>
      )}
    </section>
  )
}

function ConnectionRow({ connection: c, accounts }: { connection: Connection; accounts: Account[] }) {
  const toast = useToast()
  const invalidate = useInvalidate()
  const [busy, setBusy] = useState(false)

  const relink = async (accountId: number) => {
    try {
      await api(`/connections/${c.id}`, { method: 'PATCH', body: { account_id: accountId } })
      invalidate()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Couldn’t link it.', 'error')
    }
  }

  const disconnect = async () => {
    if (!window.confirm(`Disconnect ${KIND_LABEL[c.kind]} ${c.username ? '@' + c.username : c.name}? Posts already published stay; the account goes back to its phone.`)) return
    setBusy(true)
    try {
      await api(`/connections/${c.id}`, { method: 'DELETE' })
      invalidate()
      toast('Disconnected.')
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Couldn’t disconnect it.', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3">
      <span className="grid size-8 shrink-0 place-items-center rounded-md border border-line-2 text-fg">
        <PlatformIcon id={c.platform} className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium">{c.username ? `@${c.username}` : c.name}</span>
        <span className="flex items-center gap-1.5 text-[11.5px] text-dim">
          <span className={cn('size-1.5 rounded-full', c.status === 'ok' ? 'bg-ok' : 'bg-fail')} />
          {KIND_LABEL[c.kind]}
          {c.name && c.username ? ` · ${c.name}` : ''}
          {c.status !== 'ok' && <span className="text-fail"> · {c.error ?? 'Connect it again.'}</span>}
        </span>
      </span>
      <label className="flex items-center gap-2 text-[11.5px] text-dim">
        Publishes as
        <select value={c.account_id ?? ''} onChange={(e) => relink(Number(e.target.value))} className={cn(inputClass, 'h-8 w-44')}>
          {c.account_id === null && <option value="">Pick an account</option>}
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              @{a.handle}
            </option>
          ))}
        </select>
      </label>
      <Btn size="sm" variant="subtle" icon={Unplug} loading={busy} onClick={disconnect}>
        Disconnect
      </Btn>
    </li>
  )
}
