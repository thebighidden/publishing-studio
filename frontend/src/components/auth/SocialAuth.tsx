import { useEffect, useState } from 'react'
import { LoaderCircle } from 'lucide-react'
import { siGithub, siGoogle } from 'simple-icons'
import type { Provider } from '../../lib/api'
import { authApi, authErrorMessage, oauthUrl } from '../../lib/auth'
import { cn } from '../../lib/cn'

export const PROVIDERS: Array<{ id: Provider; name: string; path: string }> = [
  { id: 'google', name: 'Google', path: siGoogle.path },
  { id: 'github', name: 'GitHub', path: siGithub.path },
]

/**
 * One-click providers. A bone fill rises through each button on hover; the one that was
 * pressed spins while the browser heads off to the provider.
 */
export function SocialAuth({ onUnavailable }: { onUnavailable: (message: string) => void }) {
  const [pending, setPending] = useState<Provider | null>(null)
  const [ready, setReady] = useState<Record<Provider, boolean> | null>(null)

  useEffect(() => {
    authApi
      .providers()
      .then(setReady)
      .catch(() => setReady(null))
  }, [])

  // Coming back with the browser's Back button restores this page from cache, mid-spin.
  useEffect(() => {
    const reset = () => setPending(null)
    window.addEventListener('pageshow', reset)
    return () => window.removeEventListener('pageshow', reset)
  }, [])

  const select = (id: Provider) => {
    if (ready && !ready[id]) {
      onUnavailable(authErrorMessage('oauth_unconfigured', id)!)
      return
    }
    setPending(id)
    window.location.assign(oauthUrl(id))
  }

  return (
    <div className="grid grid-cols-2 gap-2">
      {PROVIDERS.map((p) => {
        const busy = pending === p.id
        return (
          <button
            key={p.id}
            type="button"
            disabled={pending !== null}
            onClick={() => select(p.id)}
            aria-label={`Continue with ${p.name}`}
            className={cn(
              'group relative isolate flex h-12 items-center justify-center gap-2 overflow-hidden rounded-full border border-line-2 text-[13.5px] transition-[color,border-color,opacity] duration-500 ease-expo',
              'hover:border-fg hover:text-ink',
              pending !== null && 'pointer-events-none',
              pending !== null && !busy && 'opacity-40',
            )}
          >
            <span
              aria-hidden
              className="absolute inset-0 -z-10 translate-y-full rounded-t-[50%] bg-fg transition-[translate,border-radius] duration-500 ease-expo group-hover:translate-y-0 group-hover:rounded-t-none"
            />
            {busy ? (
              <LoaderCircle className="size-4 animate-spin" strokeWidth={2} />
            ) : (
              <svg
                viewBox="0 0 24 24"
                className="size-4 transition-transform duration-500 ease-expo group-hover:scale-110"
                fill="currentColor"
                aria-hidden
              >
                <path d={p.path} />
              </svg>
            )}
            <span>Continue with {p.name}</span>
          </button>
        )
      })}
    </div>
  )
}
