import { useEffect, useId, useState, type FormEvent } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Send } from 'lucide-react'
import { AuthHeading, AuthLayout, AuthLink, EntryContext, Enter } from '../components/auth/AuthLayout'
import { AuthVisual } from '../components/auth/AuthVisual'
import { DrawnTick, Field } from '../components/auth/Field'
import { QueueWall } from '../components/auth/QueueWall'
import { SubmitButton, type SubmitStatus } from '../components/auth/SubmitButton'
import { Serif } from '../components/ui/Reveal'
import { ApiError } from '../lib/api'
import { authApi, isEmail } from '../lib/auth'
import { ease, easeInOut } from '../lib/motion'
import { cn } from '../lib/cn'
import { useDocumentTitle, useEntryDelay } from '../lib/router'

// Matches Laravel's password-broker throttle (config/auth.php → passwords.users.throttle).
const RESEND_AFTER = 60

export default function ForgotPassword() {
  useDocumentTitle('Reset password — FlowAI')
  const entry = useEntryDelay()

  const [sent, setSent] = useState(false)
  const [moved, setMoved] = useState(false)
  const [email, setEmail] = useState('')
  const [tried, setTried] = useState(false)
  const [shake, setShake] = useState(0)
  const [status, setStatus] = useState<SubmitStatus>('idle')
  const [serverError, setServerError] = useState<string | null>(null)

  const error = !email.trim() ? 'Enter your email address.' : !isEmail(email) ? 'That doesn’t look like an email address.' : null

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (status !== 'idle') return
    setTried(true)
    if (error) {
      setShake((s) => s + 1)
      return
    }
    setStatus('loading')
    try {
      await authApi.forgotPassword(email)
    } catch (err) {
      setStatus('idle')
      setServerError(err instanceof ApiError ? (err.field('email') ?? err.message) : 'Something went wrong.')
      setShake((s) => s + 1)
      return
    }
    setStatus('success')
    window.setTimeout(() => {
      setMoved(true)
      setSent(true)
    }, 600)
  }

  const restart = () => {
    setMoved(true)
    setSent(false)
    setStatus('idle')
    setTried(false)
  }

  return (
    <AuthLayout
      visual={
        <AuthVisual
          headline={['Create once.', <Serif>Publish everywhere.</Serif>]}
          caption="Fig. 03 — Your queue keeps its place."
        >
          <QueueWall />
        </AuthVisual>
      }
    >
      <EntryContext.Provider value={moved ? 0.12 : entry}>
        <AnimatePresence mode="wait" initial={false}>
          {!sent ? (
            <motion.form
              key="request"
              onSubmit={onSubmit}
              noValidate
              initial={{ opacity: 0, x: -48 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -48 }}
              transition={{ duration: 0.5, ease }}
            >
              <AuthHeading
                index="03"
                eyebrow="Reset password"
                lines={['Forgot your', <Serif>password?</Serif>]}
                sub="It happens. Enter the email you signed up with and we’ll send you a link to set a new one."
              />
              <Enter i={4} className="mt-10">
                <Field
                  label="Email address"
                  name="email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(v) => {
                    setEmail(v)
                    setServerError(null)
                  }}
                  error={(tried ? error : null) ?? serverError}
                  valid={isEmail(email) && !serverError}
                  shake={shake}
                />
              </Enter>
              <Enter i={5} className="mt-8">
                <SubmitButton status={status} loading="Sending" success="Sent">
                  Send reset link
                </SubmitButton>
              </Enter>
              <Enter i={6} className="mt-8 text-[14px]">
                <AuthLink to="/login" back className="text-muted transition-colors hover:text-fg">
                  Back to log in
                </AuthLink>
              </Enter>
            </motion.form>
          ) : (
            <motion.div
              key="sent"
              initial={{ opacity: 0, x: 48 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 48 }}
              transition={{ duration: 0.5, ease }}
            >
              <PaperPlane />
              <div className="mt-6">
                <AuthHeading
                  index="✓"
                  eyebrow="Link sent"
                  lines={['Check your', <Serif>inbox.</Serif>]}
                  sub={
                    <>
                      If <span className="text-fg">{email}</span> has an account, a reset link is on its way. It
                      expires in an hour.
                    </>
                  }
                />
              </div>
              <Enter i={4} className="mt-10">
                <Resend email={email} />
              </Enter>
              <Enter i={5} className="mt-8 flex flex-wrap items-center justify-between gap-4 text-[14px]">
                <AuthLink to="/login" back className="text-muted transition-colors hover:text-fg">
                  Back to log in
                </AuthLink>
                <button type="button" onClick={restart} className="group relative text-muted transition-colors hover:text-fg">
                  Use a different email
                  <span className="absolute -bottom-0.5 left-0 h-px w-full origin-right scale-x-0 bg-current transition-transform duration-500 ease-expo group-hover:origin-left group-hover:scale-x-100" />
                </button>
              </Enter>
            </motion.div>
          )}
        </AnimatePresence>
      </EntryContext.Provider>
    </AuthLayout>
  )
}

/** Counts down before another link can be sent; the ring empties as time runs out. */
function Resend({ email }: { email: string }) {
  const [left, setLeft] = useState(RESEND_AFTER)
  const [status, setStatus] = useState<'wait' | 'ready' | 'sending' | 'sent'>('wait')

  useEffect(() => {
    if (status !== 'wait') return
    if (left <= 0) {
      setStatus('ready')
      return
    }
    const t = window.setTimeout(() => setLeft((l) => l - 1), 1000)
    return () => window.clearTimeout(t)
  }, [left, status])

  const resend = async () => {
    setStatus('sending')
    try {
      await authApi.forgotPassword(email)
      setStatus('sent')
      await new Promise((r) => window.setTimeout(r, 1600))
    } catch {
      // Throttled or offline: the countdown below is the honest answer either way.
    }
    setLeft(RESEND_AFTER)
    setStatus('wait')
  }

  const label =
    status === 'wait'
      ? `Resend in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`
      : status === 'ready'
        ? 'Resend link'
        : status === 'sending'
          ? 'Sending again'
          : 'Sent again'

  return (
    <button
      type="button"
      onClick={resend}
      disabled={status !== 'ready'}
      className={cn(
        'group relative flex h-14 w-full items-center justify-center gap-3 rounded-full border text-[14.5px] font-medium transition-[border-color,color,background-color] duration-500',
        status === 'ready' ? 'border-fg text-fg hover:bg-fg hover:text-ink' : 'border-line-2 text-muted',
        status === 'sent' && 'border-ok/50 text-ok',
      )}
    >
      <span className="relative grid size-5 place-items-center">
        {status === 'wait' && (
          <svg viewBox="0 0 20 20" className="absolute inset-0 size-5 -rotate-90" aria-hidden>
            <circle cx="10" cy="10" r="8" fill="none" stroke="rgb(255 255 255 / 0.1)" strokeWidth={1.5} />
            <motion.circle
              cx="10"
              cy="10"
              r="8"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              strokeLinecap="round"
              initial={false}
              animate={{ pathLength: left / RESEND_AFTER }}
              transition={{ duration: 1, ease: 'linear' }}
            />
          </svg>
        )}
        {status === 'sent' ? (
          <DrawnTick on className="size-4" />
        ) : (
          <Send className={cn(status === 'wait' ? 'size-2.5' : 'size-3.5', status === 'sending' && 'animate-pulse')} strokeWidth={1.75} />
        )}
      </span>
      <span className="tabular-nums">{label}</span>
    </button>
  )
}

// Loops once, then climbs off to the top right. Drawn in a fixed 300×120 box so the
// CSS motion path and the SVG trail share one coordinate space.
const FLIGHT = 'M10 104 C 58 104, 66 46, 108 54 S 150 112, 188 80 S 236 18, 292 12'

function PaperPlane() {
  const mask = useId()
  return (
    <div className="relative h-[120px] w-[300px] max-w-full" aria-hidden>
      <svg viewBox="0 0 300 120" className="absolute inset-0 h-[120px] w-[300px] overflow-visible">
        <defs>
          <mask id={mask}>
            <motion.path
              d={FLIGHT}
              fill="none"
              stroke="#fff"
              strokeWidth={4}
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 1.6, ease: easeInOut, delay: 0.2 }}
            />
          </mask>
        </defs>
        <path d={FLIGHT} fill="none" stroke="rgb(165 180 252 / 0.6)" strokeWidth={1.25} strokeDasharray="3 5" mask={`url(#${mask})`} />
        <motion.circle
          cx="10"
          cy="104"
          r="3"
          className="fill-accent-soft"
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', stiffness: 500, damping: 20 }}
        />
      </svg>
      <motion.div
        className="absolute left-0 top-0 grid size-10 place-items-center rounded-full bg-fg text-ink shadow-[0_10px_30px_-8px_rgb(165_180_252_/_0.6)]"
        style={{ offsetPath: `path('${FLIGHT}')`, offsetRotate: 'auto 45deg' }}
        initial={{ offsetDistance: '0%', scale: 0.4 }}
        animate={{ offsetDistance: '100%', scale: 1 }}
        transition={{ duration: 1.6, ease: easeInOut, delay: 0.2 }}
      >
        <Send className="size-4 -translate-x-px translate-y-px" strokeWidth={2} />
      </motion.div>
    </div>
  )
}
