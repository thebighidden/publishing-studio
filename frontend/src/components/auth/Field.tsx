import { useEffect, useId, useState, type ReactNode } from 'react'
import { AnimatePresence, motion, useAnimate } from 'framer-motion'
import { Check } from 'lucide-react'
import { ease } from '../../lib/motion'
import { cn } from '../../lib/cn'

type FieldProps = {
  label: string
  name: string
  type?: 'text' | 'email' | 'password'
  value: string
  onChange: (value: string) => void
  error?: string | null
  /** Shows a small tick once the value is good. */
  valid?: boolean
  autoComplete?: string
  autoFocus?: boolean
  /** Bump to shake the field, if it has an error. */
  shake?: number
}

/**
 * Underlined input with a floating label. Focus draws a bright line across the base;
 * a failed submit shakes the field and slides its message in underneath.
 */
export function Field({
  label,
  name,
  type = 'text',
  value,
  onChange,
  error,
  valid,
  autoComplete,
  autoFocus,
  shake = 0,
}: FieldProps) {
  const id = useId()
  const [reveal, setReveal] = useState(false)
  const [scope, animate] = useAnimate<HTMLDivElement>()
  const isPassword = type === 'password'

  useEffect(() => {
    if (shake && error) animate(scope.current, { x: [0, -10, 9, -6, 4, 0] }, { duration: 0.5, ease: 'easeOut' })
    // Only a new submit attempt should shake, not every keystroke that changes the error.
  }, [shake])

  return (
    <div ref={scope}>
      <div className="relative">
        <input
          id={id}
          name={name}
          type={isPassword && reveal ? 'text' : type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder=" "
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          spellCheck={false}
          aria-invalid={!!error}
          aria-describedby={error ? `${id}-error` : undefined}
          className={cn(
            'peer h-[62px] w-full border-b bg-transparent pb-2 pt-6 text-[16px] text-fg caret-accent-soft outline-none transition-colors duration-300',
            'autofill:shadow-[inset_0_0_0_1000px_var(--color-ink)] autofill:[-webkit-text-fill-color:var(--color-fg)]',
            isPassword ? 'pr-20' : 'pr-8',
            error ? 'border-fail/50' : 'border-line-2 hover:border-white/25',
          )}
        />
        <label
          htmlFor={id}
          className={cn(
            'pointer-events-none absolute left-0 top-[22px] origin-left text-[15px] text-muted transition-[translate,scale,color] duration-500 ease-expo',
            'peer-focus:-translate-y-3.5 peer-focus:scale-[0.78] peer-focus:text-fg',
            'peer-[:not(:placeholder-shown)]:-translate-y-3.5 peer-[:not(:placeholder-shown)]:scale-[0.78]',
            'peer-autofill:-translate-y-3.5 peer-autofill:scale-[0.78]',
          )}
        >
          {label}
        </label>
        <span
          aria-hidden
          className={cn(
            'pointer-events-none absolute bottom-0 left-0 h-px w-full origin-left transition-[scale,background-color] duration-700 ease-expo',
            error ? 'scale-x-100 bg-fail' : 'scale-x-0 bg-fg peer-focus:scale-x-100',
          )}
        />

        <div className="absolute bottom-3 right-0 flex items-center gap-3">
          <AnimatePresence>
            {valid && !error && (
              <motion.span
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0, opacity: 0 }}
                transition={{ type: 'spring', stiffness: 520, damping: 26 }}
                className="grid size-4 place-items-center rounded-full bg-ok text-ink"
              >
                <Check className="size-2.5" strokeWidth={3.5} />
              </motion.span>
            )}
          </AnimatePresence>
          {isPassword && (
            <button
              type="button"
              onClick={() => setReveal((r) => !r)}
              aria-label={reveal ? 'Hide password' : 'Show password'}
              aria-pressed={reveal}
              className="relative block h-4 overflow-hidden font-mono text-[10.5px] uppercase leading-4 tracking-[0.14em] text-muted transition-colors hover:text-fg"
            >
              <motion.span className="block" animate={{ y: reveal ? '-50%' : '0%' }} transition={{ duration: 0.5, ease }}>
                <span className="block">Show</span>
                <span className="block">Hide</span>
              </motion.span>
            </button>
          )}
        </div>
      </div>

      <AnimatePresence initial={false}>
        {error && (
          <motion.p
            id={`${id}-error`}
            role="alert"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.4, ease }}
            className="overflow-hidden font-mono text-[11px] text-fail"
          >
            <span className="block pt-2">{error}</span>
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  )
}

/** A tick that draws itself in. Size and colour come from the parent. */
export function DrawnTick({ on, className, delay = 0 }: { on: boolean; className?: string; delay?: number }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <motion.path
        d="M5 12.5l4.5 4.5L19 7.5"
        fill="none"
        stroke="currentColor"
        strokeWidth={3}
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={false}
        animate={{ pathLength: on ? 1 : 0, opacity: on ? 1 : 0 }}
        transition={{ duration: 0.4, ease, delay: on ? delay : 0 }}
      />
    </svg>
  )
}

export function Checkbox({
  checked,
  onChange,
  children,
  error,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  children: ReactNode
  error?: boolean
}) {
  return (
    <label className="group inline-flex cursor-pointer select-none items-center gap-3">
      <input type="checkbox" className="peer sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span
        className={cn(
          'grid size-[18px] shrink-0 place-items-center rounded-[5px] border text-ink transition-[background-color,border-color,scale] duration-300 group-active:scale-90',
          'peer-focus-visible:outline peer-focus-visible:outline-[1.5px] peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent-soft',
          checked ? 'border-fg bg-fg' : error ? 'border-fail' : 'border-line-2 group-hover:border-white/40',
        )}
      >
        <DrawnTick on={checked} className="size-3" />
      </span>
      <span className="text-[13.5px] text-muted transition-colors group-hover:text-fg">{children}</span>
    </label>
  )
}

/** Hairlines that grow outward from a centred label. */
export function Divider({ children, delay = 0 }: { children: ReactNode; delay?: number }) {
  const line = (origin: string) => (
    <motion.span
      className={cn('h-px flex-1 bg-line-2', origin)}
      initial={{ scaleX: 0 }}
      animate={{ scaleX: 1 }}
      transition={{ duration: 1.2, ease, delay }}
    />
  )
  return (
    <div className="flex items-center gap-4 font-mono text-[10.5px] uppercase tracking-[0.18em] text-dim">
      {line('origin-right')}
      {children}
      {line('origin-left')}
    </div>
  )
}
