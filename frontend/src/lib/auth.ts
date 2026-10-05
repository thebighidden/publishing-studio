import type { PlatformId } from '../components/ui/PlatformIcon'
import { api, type PostFormat, type Provider, type User } from './api'

export const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim())

export const PASSWORD_RULES = [
  { label: '8+ characters', test: (p: string) => p.length >= 8 },
  { label: 'Upper & lower case', test: (p: string) => /[a-z]/.test(p) && /[A-Z]/.test(p) },
  { label: 'A number', test: (p: string) => /\d/.test(p) },
  { label: 'A symbol', test: (p: string) => /[^A-Za-z0-9]/.test(p) },
]

/** 0–4: how many of the rules above the password meets. */
export const passwordScore = (p: string) => PASSWORD_RULES.filter((r) => r.test(p)).length

export const browserTimezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone

export const authApi = {
  login: (body: { email: string; password: string; remember: boolean }) =>
    api<User>('/auth/login', { method: 'POST', body }),

  register: (body: {
    name: string
    email: string
    password: string
    platforms: PlatformId[]
    formats: PostFormat[]
    terms: boolean
  }) => api<User>('/auth/register', { method: 'POST', body: { ...body, timezone: browserTimezone() } }),

  logout: () => api<void>('/auth/logout', { method: 'POST' }),

  forgotPassword: (email: string) => api<{ status: string }>('/auth/forgot-password', { method: 'POST', body: { email } }),

  resetPassword: (body: { token: string; email: string; password: string; password_confirmation: string }) =>
    api<{ status: string }>('/auth/reset-password', { method: 'POST', body }),

  resendVerification: () => api<{ status: string }>('/auth/email/verification-notification', { method: 'POST' }),

  providers: () => api<Record<Provider, boolean>>('/auth/providers'),
}

/** Where a provider button sends the browser. It's a full page load: the provider takes over. */
export const oauthUrl = (provider: Provider) => `/oauth/${provider}/redirect`

const PROVIDER_NAMES: Record<string, string> = { google: 'Google', github: 'GitHub' }

/** Messages for the ?error= codes the API redirects back with. */
export function authErrorMessage(code: string | null, provider: string | null) {
  const name = (provider && PROVIDER_NAMES[provider]) || 'That provider'
  switch (code) {
    case 'oauth_unconfigured':
      return `${name} sign-in isn’t switched on yet. Use your email for now.`
    case 'oauth_failed':
      return `${name} didn’t complete the sign-in. Give it another try.`
    case 'oauth_no_email':
      return `${name} didn’t share an email address with us, so we can’t create your account.`
    case 'verification_invalid':
      return 'That confirmation link is invalid or has expired. Log in to get a new one.'
    default:
      return null
  }
}
