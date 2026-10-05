import { useState, type FormEvent } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { AuthHeading, AuthLayout, AuthLink, EntryContext, Enter } from '../components/auth/AuthLayout'
import { AuthVisual } from '../components/auth/AuthVisual'
import { Field } from '../components/auth/Field'
import { FormAlert, type Alert } from '../components/auth/FormAlert'
import { PasswordStrength } from '../components/auth/PasswordStrength'
import { QueueWall } from '../components/auth/QueueWall'
import { SubmitButton, type SubmitStatus } from '../components/auth/SubmitButton'
import { SuccessMark } from '../components/auth/SuccessMark'
import { Serif } from '../components/ui/Reveal'
import { ApiError } from '../lib/api'
import { authApi } from '../lib/auth'
import { ease } from '../lib/motion'
import { useDocumentTitle, useEntryDelay, useRouter } from '../lib/router'

/** Where the emailed reset link lands: /reset-password?token=…&email=… */
export default function ResetPassword() {
  useDocumentTitle('Set a new password — FlowAI')
  const entry = useEntryDelay()
  const { search, navigate } = useRouter()
  const [{ token, email }] = useState(() => {
    const params = new URLSearchParams(search)
    return { token: params.get('token') ?? '', email: params.get('email') ?? '' }
  })

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [tried, setTried] = useState(false)
  const [shake, setShake] = useState(0)
  const [status, setStatus] = useState<SubmitStatus>('idle')
  const [alert, setAlert] = useState<Alert | null>(null)
  const [done, setDone] = useState(false)

  const errors = {
    password: password.length < 8 ? 'Use at least 8 characters.' : null,
    confirm: confirm !== password ? 'The two passwords don’t match.' : null,
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (status !== 'idle') return
    setTried(true)
    if (errors.password || errors.confirm) {
      setShake((s) => s + 1)
      return
    }

    setStatus('loading')
    setAlert(null)
    try {
      await authApi.resetPassword({ token, email, password, password_confirmation: confirm })
      setStatus('success')
      window.setTimeout(() => setDone(true), 600)
    } catch (err) {
      setStatus('idle')
      setShake((s) => s + 1)
      const text =
        err instanceof ApiError ? (err.field('email') ?? err.field('password') ?? err.message) : 'Something went wrong.'
      setAlert({ tone: 'error', text })
    }
  }

  const broken = !token || !email

  return (
    <AuthLayout
      visual={
        <AuthVisual headline={['New password.', <Serif>Same queue.</Serif>]} caption="Fig. 04 — Nothing moved while you were out.">
          <QueueWall />
        </AuthVisual>
      }
    >
      <EntryContext.Provider value={done ? 0.12 : entry}>
        <AnimatePresence mode="wait" initial={false}>
          {done ? (
            <motion.div key="done" initial={{ opacity: 0, x: 48 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.5, ease }}>
              <SuccessMark />
              <div className="mt-8">
                <AuthHeading
                  index="✓"
                  eyebrow="Password updated"
                  lines={['You’re all', <Serif>set.</Serif>]}
                  sub="Your new password works from now on. Any other devices you were signed in on have been signed out."
                />
              </div>
              <Enter i={4} className="mt-10">
                <SubmitButton
                  type="button"
                  status="idle"
                  onClick={() => navigate(`/login?${new URLSearchParams({ reset: '1', email })}`)}
                >
                  Log in
                </SubmitButton>
              </Enter>
            </motion.div>
          ) : broken ? (
            <motion.div key="broken" exit={{ opacity: 0, x: -48 }} transition={{ duration: 0.5, ease }}>
              <AuthHeading
                index="03"
                eyebrow="Reset password"
                lines={['This link is', <Serif>incomplete.</Serif>]}
                sub="Open the link from the email again, or ask for a fresh one."
              />
              <Enter i={4} className="mt-10">
                <SubmitButton type="button" status="idle" onClick={() => navigate('/forgot-password')}>
                  Get a new link
                </SubmitButton>
              </Enter>
            </motion.div>
          ) : (
            <motion.form key="form" onSubmit={onSubmit} noValidate exit={{ opacity: 0, x: -48 }} transition={{ duration: 0.5, ease }}>
              <AuthHeading
                index="03"
                eyebrow="Reset password"
                lines={['Choose a new', <Serif>password.</Serif>]}
                sub={
                  <>
                    For <span className="text-fg">{email}</span>. Pick something you don’t use anywhere else.
                  </>
                }
              />

              <FormAlert
                alert={alert}
                onClose={() => setAlert(null)}
                className="mt-8"
              />

              <Enter i={4} className="mt-10">
                <Field
                  label="New password"
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={setPassword}
                  error={tried ? errors.password : null}
                  shake={shake}
                  autoFocus
                />
                <PasswordStrength password={password} />
              </Enter>
              <Enter i={5} className="mt-2">
                <Field
                  label="Repeat it"
                  name="password_confirmation"
                  type="password"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={setConfirm}
                  error={tried ? errors.confirm : null}
                  valid={!!confirm && confirm === password}
                  shake={shake}
                />
              </Enter>
              <Enter i={6} className="mt-8">
                <SubmitButton status={status} loading="Saving" success="Saved">
                  Set new password
                </SubmitButton>
              </Enter>
              <Enter i={7} className="mt-8 flex flex-wrap items-center justify-between gap-4 text-[14px]">
                <AuthLink to="/login" back className="text-muted transition-colors hover:text-fg">
                  Back to log in
                </AuthLink>
                {alert && (
                  <AuthLink to="/forgot-password" className="text-muted transition-colors hover:text-fg">
                    Get a new link
                  </AuthLink>
                )}
              </Enter>
            </motion.form>
          )}
        </AnimatePresence>
      </EntryContext.Provider>
    </AuthLayout>
  )
}
