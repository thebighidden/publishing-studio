import type { ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { CircleAlert, CircleCheck, X } from 'lucide-react'
import { ease } from '../../lib/motion'
import { cn } from '../../lib/cn'

export type Alert = { tone: 'error' | 'success'; text: ReactNode }

/** A message from the server that opens up above the form, and can be dismissed. */
export function FormAlert({ alert, onClose, className }: { alert: Alert | null; onClose?: () => void; className?: string }) {
  return (
    <AnimatePresence initial={false}>
      {alert && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.45, ease }}
          className={cn('overflow-hidden', className)}
        >
          <div
            role={alert.tone === 'error' ? 'alert' : 'status'}
            className={cn(
              'flex items-start gap-3 rounded-xl border px-4 py-3 text-[13.5px] leading-snug',
              alert.tone === 'error' ? 'border-fail/30 bg-fail/[0.07] text-fail' : 'border-ok/25 bg-ok/[0.07] text-ok',
            )}
          >
            {alert.tone === 'error' ? (
              <CircleAlert className="mt-px size-4 shrink-0" strokeWidth={1.75} />
            ) : (
              <CircleCheck className="mt-px size-4 shrink-0" strokeWidth={1.75} />
            )}
            <span className="flex-1">{alert.text}</span>
            {onClose && (
              <button type="button" onClick={onClose} aria-label="Dismiss" className="opacity-60 transition-opacity hover:opacity-100">
                <X className="size-4" strokeWidth={1.75} />
              </button>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
