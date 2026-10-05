import type { PlatformId } from '../components/ui/PlatformIcon'

/* ------------------------------------------------------------------ */
/* Shapes the Laravel API returns                                       */
/* ------------------------------------------------------------------ */

export type PostStatus = 'draft' | 'scheduled' | 'published'
export type PostFormat = 'text' | 'image' | 'video'
export type Provider = 'google' | 'github'

export type User = {
  id: number
  name: string
  email: string
  email_verified: boolean
  avatar_url: string | null
  timezone: string | null
  preferences: { platforms: PlatformId[]; formats: PostFormat[] }
  has_password: boolean
  providers: Provider[]
  created_at: string
}

export type Post = {
  id: number
  title: string | null
  body: string
  format: PostFormat
  platforms: PlatformId[]
  status: PostStatus
  scheduled_at: string | null
  published_at: string | null
  created_at: string
  updated_at: string
}

/** GET /ai: whether the composer can offer AI writing, and with which models. */
export type AiOptions = {
  enabled: boolean
  models: Array<{ id: string; label: string }>
}

export type Page<T> = {
  data: T[]
  meta: { current_page: number; last_page: number; per_page: number; total: number }
}

/* ------------------------------------------------------------------ */
/* Client                                                               */
/* ------------------------------------------------------------------ */

export class ApiError extends Error {
  status: number
  errors: Record<string, string[]>

  constructor(status: number, message: string, errors: Record<string, string[]> = {}) {
    super(message)
    this.status = status
    this.errors = errors
  }

  /** The first validation message for a field, if Laravel sent one. */
  field(name: string) {
    return this.errors[name]?.[0] ?? null
  }
}

type Query = Record<string, string | number | boolean | null | undefined>
type Options = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown
  query?: Query
}

function xsrfToken() {
  const match = document.cookie.match(/(?:^|; )XSRF-TOKEN=([^;]*)/)
  return match ? decodeURIComponent(match[1]) : null
}

// Laravel hands out the CSRF token as a cookie; fetch it once before the first write.
let csrfInFlight: Promise<void> | null = null
function ensureCsrfCookie() {
  if (xsrfToken()) return Promise.resolve()
  csrfInFlight ??= fetch('/sanctum/csrf-cookie', { credentials: 'same-origin' })
    .then(() => undefined)
    .finally(() => {
      csrfInFlight = null
    })
  return csrfInFlight
}

function toQueryString(query?: Query) {
  if (!query) return ''
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== '') params.set(k, String(v))
  }
  const s = params.toString()
  return s ? `?${s}` : ''
}

/** Send a request and return the response once it's known to be a success; anything else throws an ApiError. */
async function send(path: string, options: Options & { signal?: AbortSignal }, retry = true): Promise<Response> {
  const method = options.method ?? 'GET'
  if (method !== 'GET') await ensureCsrfCookie()

  const headers: Record<string, string> = { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' }
  const token = xsrfToken()
  if (token) headers['X-XSRF-TOKEN'] = token
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'

  let res: Response
  try {
    res = await fetch(`/api${path}${toQueryString(options.query)}`, {
      method,
      headers,
      credentials: 'same-origin',
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: options.signal,
    })
  } catch (e) {
    if (options.signal?.aborted) throw e
    throw new ApiError(0, 'Can’t reach FlowAI right now. Check your connection and try again.')
  }

  // The token went stale (session expired, or a sign-in rotated it): get a fresh one, retry once.
  if (res.status === 419 && retry) {
    document.cookie = 'XSRF-TOKEN=; Max-Age=0; path=/'
    await ensureCsrfCookie()
    return send(path, options, false)
  }

  if (!res.ok) {
    const data = await res.json().catch(() => null)
    const fallback =
      res.status >= 500 ? 'Something went wrong on our side. Try again in a moment.' : `Request failed (${res.status}).`
    throw new ApiError(res.status, data?.message ?? fallback, data?.errors)
  }
  return res
}

export async function api<T = unknown>(path: string, options: Options = {}): Promise<T> {
  const res = await send(path, options)
  if (res.status === 204) return undefined as T
  return (await res.json().catch(() => null)) as T
}

export type StreamEvent = { event: string; data: unknown }

/**
 * POST, then read the reply as server-sent events, handing each to `onEvent` as it arrives.
 * A request the API turns down before streaming (validation, auth) throws like `api()` does.
 */
export async function apiStream(
  path: string,
  body: unknown,
  onEvent: (e: StreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await send(path, { method: 'POST', body, signal })
  if (!res.body) throw new ApiError(0, 'Can’t reach FlowAI right now. Check your connection and try again.')

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) return
    buffer += value

    let end: number
    while ((end = buffer.indexOf('\n\n')) !== -1) {
      const block = buffer.slice(0, end)
      buffer = buffer.slice(end + 2)

      let event = 'message'
      const data: string[] = []
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim()
        else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''))
      }
      if (data.length) onEvent({ event, data: JSON.parse(data.join('\n')) })
    }
  }
}
