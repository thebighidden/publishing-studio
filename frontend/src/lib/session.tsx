import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { api, ApiError, type User } from './api'
import { authApi, browserTimezone } from './auth'
import { useRouter } from './router'

type Session = {
  user: User | null
  /** 'loading' until the first /api/user answer comes back. */
  status: 'loading' | 'ready'
  setUser: (user: User | null) => void
  refresh: () => Promise<User | null>
  signOut: () => Promise<void>
}

const SessionContext = createContext<Session | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready'>('loading')

  const refresh = useCallback(async () => {
    try {
      const me = await api<User>('/user')
      setUser(me)
      return me
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        setUser(null)
        return null
      }
      throw e
    } finally {
      setStatus('ready')
    }
  }, [])

  useEffect(() => {
    refresh().catch(() => setUser(null))
  }, [refresh])

  // Accounts made through Google or GitHub never told us their timezone; the queue needs one.
  useEffect(() => {
    if (!user || user.timezone) return
    api<User>('/user', { method: 'PATCH', body: { timezone: browserTimezone() } })
      .then(setUser)
      .catch(() => {})
  }, [user])

  const signOut = useCallback(async () => {
    try {
      await authApi.logout()
    } finally {
      setUser(null)
    }
  }, [])

  return (
    <SessionContext.Provider value={{ user, status, setUser, refresh, signOut }}>{children}</SessionContext.Provider>
  )
}

export function useSession() {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error('useSession must be used inside <SessionProvider>')
  return ctx
}

/** The ?next= a guard put on the login URL, if it's a safe in-app path. */
export function nextPath(search: string, fallback = '/dashboard') {
  const next = new URLSearchParams(search).get('next')
  return next && next.startsWith('/') && !next.startsWith('//') ? next : fallback
}

/**
 * Auth pages: someone already signed in goes straight to the app. Only checked once,
 * on arrival, so finishing sign-up on the page itself doesn't yank the success screen away.
 */
export function useRedirectIfSignedIn() {
  const { user, status } = useSession()
  const { navigate, search } = useRouter()
  const checked = useRef(false)

  useEffect(() => {
    if (checked.current || status !== 'ready') return
    checked.current = true
    if (user) navigate(nextPath(search), { replace: true })
  }, [status, user, navigate, search])
}
