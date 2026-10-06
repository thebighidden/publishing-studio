import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronDown, X } from 'lucide-react'
import type { Campaign } from '../../lib/api'
import { ease } from '../../lib/motion'
import { cn } from '../../lib/cn'
import { useMediaQuery } from '../../lib/useMediaQuery'

const SUGGESTED = /\s*\(suggested\)\s*$/

/**
 * The brief as it fills in. Answers are highlighted in as they arrive; Claude's guesses get a
 * dashed underline instead, and the field the open question is about is marked.
 */
export function BriefPanel({
  campaign,
  fresh,
  onRemovePhoto,
  removing,
}: {
  campaign: Campaign
  /** Fields that changed in the last update, and a stamp so the highlight replays. */
  fresh: { keys: Set<string>; stamp: number }
  onRemovePhoto: (id: number) => void
  removing: boolean
}) {
  const wide = useMediaQuery('(min-width: 1024px)')
  const [openOnPhone, setOpenOnPhone] = useState(false)
  const open = wide || openOnPhone
  const asking = !campaign.complete ? campaign.pending : null

  return (
    <section className="min-w-0 rounded-xl border border-line bg-panel">
      <button
        type="button"
        onClick={() => setOpenOnPhone((o) => !o)}
        disabled={wide}
        aria-expanded={open}
        className="block w-full px-4 pt-4 text-left md:px-5 md:pt-5 lg:cursor-default"
      >
        <span className="flex items-baseline justify-between gap-3">
          <span className="text-[15px] font-medium tracking-[-0.01em]">Client brief</span>
          <span className="flex items-center gap-2 font-mono text-[11px] tabular-nums text-dim">
            {campaign.filled} of {campaign.total}
            {!wide && <ChevronDown className={cn('size-3.5 transition-transform duration-300', open && 'rotate-180')} />}
          </span>
        </span>
        <span className="mt-3 block h-1 overflow-hidden rounded-full bg-white/[0.06]">
          <motion.span
            className="block h-full rounded-full bg-accent"
            initial={false}
            animate={{ width: `${(campaign.filled / campaign.total) * 100}%` }}
            transition={{ duration: 0.8, ease }}
          />
        </span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.4, ease }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-5 md:px-5">
              <p className="mt-2.5 text-[11px] text-dim">
                <span className="brief-mark text-fg">Answered</span>
                <span className="mx-2">·</span>
                <span className="brief-guess text-muted">Suggested by AI</span>
              </p>

              {campaign.brief.map((group) => (
                <section key={group.id} className="mt-6">
                  <h3 className="flex items-baseline justify-between font-mono text-[10px] uppercase tracking-[0.14em] text-dim">
                    {group.label}
                    <span className="tabular-nums">
                      {group.fields.filter((f) => f.value).length}/{group.fields.length}
                    </span>
                  </h3>
                  <dl className="mt-1.5">
                    {group.fields.map((f) => (
                      <div key={f.key} className="border-t border-line py-2.5">
                        <dt className="flex items-center gap-2 text-[11.5px] text-dim">
                          {f.label}
                          {asking === f.key && (
                            <span className="inline-flex items-center gap-1.5 font-mono text-[9.5px] uppercase tracking-[0.12em] text-accent-soft">
                              <span className="relative flex size-1.5">
                                <span className="absolute inset-0 animate-ping rounded-full bg-accent-soft opacity-70" />
                                <span className="relative size-1.5 rounded-full bg-accent-soft" />
                              </span>
                              Asking
                            </span>
                          )}
                        </dt>
                        <dd className="mt-1 min-h-[1.4em] text-[13px] leading-snug">
                          {f.value ? (
                            f.suggested ? (
                              <span className="brief-guess text-muted" title="Suggested by AI. Check it, or answer more questions.">
                                {f.value.replace(SUGGESTED, '')}
                              </span>
                            ) : (
                              <span
                                key={fresh.keys.has(f.key) ? `${f.value}-${fresh.stamp}` : f.value}
                                className="brief-mark text-fg"
                                data-fresh={fresh.keys.has(f.key) || undefined}
                              >
                                {f.value}
                              </span>
                            )
                          ) : (
                            <span className="text-dim/70">Not yet</span>
                          )}
                        </dd>
                        {f.key === 'photos' && campaign.photos.length > 0 && (
                          <div className="mt-2.5 grid grid-cols-4 gap-2">
                            {campaign.photos.map((p, i) => (
                              <figure key={p.id} className="group relative m-0 min-w-0">
                                <img
                                  src={p.url}
                                  alt={p.description ?? `Photo ${i + 1}`}
                                  title={p.description ?? undefined}
                                  className="aspect-square w-full rounded-md bg-white/[0.04] object-cover"
                                />
                                <figcaption className="mt-1 truncate text-[10.5px] leading-tight text-dim">
                                  {i + 1}
                                  {p.title ? ` · ${p.title}` : ''}
                                </figcaption>
                                <button
                                  type="button"
                                  onClick={() => onRemovePhoto(p.id)}
                                  disabled={removing}
                                  aria-label={`Remove photo ${i + 1}`}
                                  className="absolute right-1 top-1 grid size-5 place-items-center rounded-full bg-ink/80 text-fg opacity-0 backdrop-blur transition-opacity hover:bg-ink focus-visible:opacity-100 group-hover:opacity-100 disabled:hidden [@media(hover:none)]:opacity-100"
                                >
                                  <X className="size-3" strokeWidth={2} />
                                </button>
                              </figure>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </dl>
                </section>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  )
}
