import { AnimatePresence, motion } from 'framer-motion'
import { PASSWORD_RULES, passwordScore } from '../../lib/auth'
import { ease } from '../../lib/motion'
import { cn } from '../../lib/cn'
import { DrawnTick } from './Field'

const LEVELS = [
  { label: 'Too weak', bar: 'bg-fail', text: 'text-fail' },
  { label: 'Weak', bar: 'bg-fail', text: 'text-fail' },
  { label: 'Fair', bar: 'bg-warn', text: 'text-warn' },
  { label: 'Good', bar: 'bg-plan', text: 'text-plan' },
  { label: 'Strong', bar: 'bg-ok', text: 'text-ok' },
]

/** Four segments that fill as the password meets more rules, with the rules ticked off below. */
export function PasswordStrength({ password }: { password: string }) {
  const score = passwordScore(password)
  const level = LEVELS[score]

  return (
    <AnimatePresence initial={false}>
      {password && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.5, ease }}
          className="overflow-hidden"
        >
          <div className="pt-3.5">
            <div className="flex gap-1.5">
              {[0, 1, 2, 3].map((i) => (
                <span key={i} className="relative h-[3px] flex-1 overflow-hidden rounded-full bg-white/[0.08]">
                  <motion.span
                    className={cn('absolute inset-0 origin-left rounded-full transition-colors duration-500', level.bar)}
                    initial={false}
                    animate={{ scaleX: i < score ? 1 : 0 }}
                    transition={{ duration: 0.55, ease, delay: i * 0.05 }}
                  />
                </span>
              ))}
            </div>

            <div className="mt-2.5 flex items-center justify-between font-mono text-[10.5px] uppercase tracking-[0.14em]">
              <span className="relative block h-4 overflow-hidden">
                <AnimatePresence mode="popLayout" initial={false}>
                  <motion.span
                    key={level.label}
                    className={cn('block leading-4', level.text)}
                    initial={{ y: '100%' }}
                    animate={{ y: '0%' }}
                    exit={{ y: '-100%' }}
                    transition={{ duration: 0.4, ease }}
                  >
                    {level.label}
                  </motion.span>
                </AnimatePresence>
              </span>
              <span className="tabular-nums text-dim">{score}/4</span>
            </div>

            <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5">
              {PASSWORD_RULES.map((r) => {
                const ok = r.test(password)
                return (
                  <li
                    key={r.label}
                    className={cn('flex items-center gap-2 text-[12px] transition-colors duration-300', ok ? 'text-fg' : 'text-dim')}
                  >
                    <span
                      className={cn(
                        'grid size-3.5 place-items-center rounded-full border text-ink transition-colors duration-300',
                        ok ? 'border-ok bg-ok' : 'border-line-2',
                      )}
                    >
                      <DrawnTick on={ok} className="size-2.5" />
                    </span>
                    {r.label}
                  </li>
                )
              })}
            </ul>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
