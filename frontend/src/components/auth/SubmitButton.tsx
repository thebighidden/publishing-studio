import { AnimatePresence, motion } from 'framer-motion'
import { ArrowRight } from 'lucide-react'
import { ease } from '../../lib/motion'
import { cn } from '../../lib/cn'
import { RollText } from '../ui/Button'
import { DrawnTick } from './Field'

export type SubmitStatus = 'idle' | 'loading' | 'success'

/**
 * Full-width submit. On hover an accent fill rises from below; once pressed the label
 * rolls up into a loading state, then into a drawn tick.
 */
export function SubmitButton({
  status,
  children,
  loading,
  success,
  type = 'submit',
  onClick,
}: {
  status: SubmitStatus
  children: string
  loading?: string
  success?: string
  type?: 'submit' | 'button'
  onClick?: () => void
}) {
  const idle = status === 'idle'

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={!idle}
      className={cn(
        'group relative isolate flex h-14 w-full items-center justify-center overflow-hidden rounded-full text-[15px] font-medium tracking-[-0.01em] transition-[background-color,color,box-shadow] duration-500 disabled:cursor-default',
        status === 'success' ? 'bg-ok text-ink' : 'bg-fg text-ink',
        idle && 'hover:text-white hover:shadow-[0_0_0_5px_color-mix(in_oklab,var(--color-accent)_22%,transparent),0_14px_44px_-12px_color-mix(in_oklab,var(--color-accent)_70%,transparent)]',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'absolute inset-0 -z-10 translate-y-[101%] rounded-t-[50%] bg-accent transition-[translate,border-radius] duration-700 ease-expo',
          idle ? 'group-hover:translate-y-0 group-hover:rounded-t-none' : 'opacity-0',
        )}
      />
      <span aria-live="polite" className="relative grid">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={status}
            className="flex items-center gap-2.5"
            initial={{ y: 30, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -30, opacity: 0 }}
            transition={{ duration: 0.5, ease }}
          >
            {status === 'idle' && (
              <>
                <RollText>{children}</RollText>
                <ArrowRight className="size-4 transition-transform duration-500 ease-expo group-hover:translate-x-1" strokeWidth={1.75} />
              </>
            )}
            {status === 'loading' && (
              <>
                <Dots />
                {loading}
              </>
            )}
            {status === 'success' && (
              <>
                <span className="grid size-5 place-items-center rounded-full bg-ink text-ok">
                  <DrawnTick on className="size-3" delay={0.15} />
                </span>
                {success}
              </>
            )}
          </motion.span>
        </AnimatePresence>
      </span>
    </button>
  )
}

function Dots() {
  return (
    <span className="flex gap-1">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="size-1.5 rounded-full bg-current"
          animate={{ y: [0, -4, 0], opacity: [0.35, 1, 0.35] }}
          transition={{ duration: 0.9, repeat: Infinity, ease: 'easeInOut', delay: i * 0.12 }}
        />
      ))}
    </span>
  )
}
