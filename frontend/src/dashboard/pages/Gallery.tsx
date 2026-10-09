import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Clapperboard, Copy, Download, Film, FlaskConical, Images, Search, Send, Trash2, Wand2 } from 'lucide-react'
import { Serif } from '../../components/ui/Reveal'
import { api, type Generation } from '../../lib/api'
import { cn } from '../../lib/cn'
import { useRouter } from '../../lib/router'
import { fmtRelative, useApi, useDebounced, useInvalidate } from '../data'
import { aspectOf, madeFor, promptOf, styleOf } from '../lab/presets'
import { MediaThumb } from '../media/Media'
import { messageFor } from '../studio/run'
import { useToast } from '../toast'
import { Btn, EmptyState, inputClass, Kbd, Label, Modal, PageHeader, Segmented, Skeleton, Stagger } from '../ui'

const PAGE = 40
const SHAPES = ['9:16', '4:5', '1:1', '16:9']

type KindFilter = 'all' | 'video' | 'image'

const shapeOf = (g: Generation) => {
  const [w, h] = aspectOf(g, '1:1').split(':').map(Number)
  return `${w} / ${h}`
}

/** /dashboard/gallery: every photo and video made, and the way back into the Lab to make it again. */
export default function Gallery() {
  const { navigate } = useRouter()
  const toast = useToast()
  const invalidate = useInvalidate()
  const [kind, setKind] = useState<KindFilter>('all')
  const [shape, setShape] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const q = useDebounced(search.trim(), 300)
  const [openId, setOpenId] = useState<number | null>(null)

  const query = { media: 1, status: 'succeeded', limit: PAGE, kind: kind === 'all' ? undefined : kind, aspect: shape ?? undefined, q: q || undefined }
  const key = JSON.stringify(query)
  const { data, loading, setData } = useApi<Generation[]>('/generations', query)

  // Pages past the first, kept per filter so changing a filter starts over.
  const [pages, setPages] = useState<{ key: string; items: Generation[]; end: boolean }>({ key: '', items: [], end: false })
  const extra = pages.key === key ? pages : { key, items: [], end: false }
  const [loadingMore, setLoadingMore] = useState(false)
  const seen = new Set<number>()
  const items = [...(data ?? []), ...extra.items].filter((g) => !seen.has(g.id) && seen.add(g.id))
  const hasMore = extra.items.length ? !extra.end : (data?.length ?? 0) === PAGE

  const loadMore = async () => {
    const last = items[items.length - 1]
    if (!last) return
    setLoadingMore(true)
    try {
      const next = await api<Generation[]>('/generations', { query: { ...query, before_id: last.id } })
      setPages({ key, items: [...extra.items, ...next], end: next.length < PAGE })
    } catch (e) {
      toast(messageFor(e), 'error')
    } finally {
      setLoadingMore(false)
    }
  }

  const index = items.findIndex((g) => g.id === openId)
  const open = index >= 0 ? items[index] : null
  const remake = (g: Generation) => navigate(`/dashboard/lab?remake=${g.id}`)
  const remove = async (g: Generation) => {
    try {
      await api(`/generations/${g.id}`, { method: 'DELETE' })
      setData((d) => d?.filter((x) => x.id !== g.id) ?? d)
      setPages((p) => ({ ...p, items: p.items.filter((x) => x.id !== g.id) }))
      setOpenId(items[index + 1]?.id ?? items[index - 1]?.id ?? null)
      toast('Removed from the Gallery. The file stays in Media.')
      invalidate()
    } catch (e) {
      toast(messageFor(e), 'error')
    }
  }

  const filtered = kind !== 'all' || shape !== null || q !== ''

  return (
    <div>
      <PageHeader
        eyebrow="Gallery"
        title={
          <>
            Everything you’ve <Serif>made.</Serif>
          </>
        }
        sub="Every photo and video from the Lab, the Studio and campaigns. Open one to see exactly what made it, then remake it in the Lab with the same prompt and settings."
        actions={
          <Btn variant="primary" icon={FlaskConical} onClick={() => navigate('/dashboard/lab')}>
            Open the Lab
          </Btn>
        }
      />

      <Stagger i={0} className="mt-10 flex flex-wrap items-center gap-x-4 gap-y-3">
        <Segmented
          id="gallery-kind"
          label="Kind"
          value={kind}
          onChange={setKind}
          options={[
            { value: 'all' as const, label: 'All' },
            { value: 'video' as const, label: 'Videos' },
            { value: 'image' as const, label: 'Stills' },
          ]}
        />
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Shape">
          {SHAPES.map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={shape === s}
              onClick={() => setShape(shape === s ? null : s)}
              className={cn(
                'rounded-md border px-2.5 py-1.5 font-mono text-[11px] transition-colors',
                shape === s ? 'border-accent/50 bg-accent/[0.1] text-fg' : 'border-line-2 text-muted hover:border-white/20 hover:text-fg',
              )}
            >
              {s}
            </button>
          ))}
        </div>
        <label className="relative ml-auto w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-dim" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search prompts…" aria-label="Search prompts" className={cn(inputClass, 'pl-8')} />
        </label>
      </Stagger>

      <Stagger i={1} className="mt-6">
        {!data && loading ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {Array.from({ length: 10 }, (_, i) => (
              <Skeleton key={i} className={cn('rounded-xl', i % 3 === 0 ? 'aspect-[9/16]' : i % 3 === 1 ? 'aspect-[4/5]' : 'aspect-square')} />
            ))}
          </div>
        ) : items.length === 0 ? (
          filtered ? (
            <EmptyState icon={Search} title="Nothing matches" body="Try another word, or clear the filters." action={<Btn onClick={() => { setKind('all'); setShape(null); setSearch('') }}>Clear filters</Btn>} />
          ) : (
            <EmptyState
              icon={Images}
              title="Nothing made yet"
              body="Photos and videos you make in the Lab land here, ready to post or remake."
              action={
                <Btn variant="primary" icon={FlaskConical} onClick={() => navigate('/dashboard/lab')}>
                  Make your first reel
                </Btn>
              }
            />
          )
        ) : (
          <>
            <div className="columns-2 gap-3 sm:columns-3 lg:columns-4 2xl:columns-5">
              {items.map((g) => (
                <Tile key={g.id} generation={g} onOpen={() => setOpenId(g.id)} onRemake={() => remake(g)} />
              ))}
            </div>
            {hasMore && (
              <div className="mt-6 flex justify-center">
                <Btn onClick={loadMore} loading={loadingMore}>
                  Show more
                </Btn>
              </div>
            )}
          </>
        )}
      </Stagger>

      <Detail
        generation={open}
        onClose={() => setOpenId(null)}
        onPrev={index > 0 ? () => setOpenId(items[index - 1].id) : undefined}
        onNext={index >= 0 && index < items.length - 1 ? () => setOpenId(items[index + 1].id) : undefined}
        onRemake={remake}
        onAnimate={(g) => navigate(`/dashboard/lab?animate=${g.id}`)}
        onPost={(g) => navigate(`/dashboard/create?assets=${g.outputs.map((a) => a.id).join(',')}`)}
        onDelete={remove}
      />
    </div>
  )
}

function Tile({ generation: g, onOpen, onRemake }: { generation: Generation; onOpen: () => void; onRemake: () => void }) {
  const out = g.outputs[0]
  const video = useRef<HTMLVideoElement>(null)
  if (!out) return null
  return (
    <div
      className="group relative mb-3 break-inside-avoid overflow-hidden rounded-xl border border-line bg-panel transition-colors hover:border-line-2"
      onMouseEnter={() => video.current?.play().catch(() => {})}
      onMouseLeave={() => {
        if (!video.current) return
        video.current.pause()
        video.current.currentTime = 0
      }}
    >
      <button type="button" onClick={onOpen} className="block w-full" style={{ aspectRatio: shapeOf(g) }} aria-label={`Open: ${promptOf(g)}`}>
        {out.kind === 'video' ? (
          <video ref={video} src={out.url} poster={out.poster_url ?? undefined} muted loop playsInline preload="metadata" className="size-full object-cover" />
        ) : (
          <img src={out.url} alt={promptOf(g)} loading="lazy" draggable={false} className="size-full object-cover" />
        )}
      </button>
      <span className="pointer-events-none absolute left-2 top-2 flex items-center gap-1 rounded bg-black/55 px-1.5 py-0.5 font-mono text-[9.5px] text-white/90 backdrop-blur-sm">
        {g.kind === 'video' && <Film className="size-3" />}
        {aspectOf(g, '')}
        {g.kind === 'video' && g.params?.duration ? ` · ${g.params.duration}s` : ''}
      </span>
      {g.outputs.length > 1 && <span className="pointer-events-none absolute right-2 top-2 rounded bg-black/55 px-1.5 py-0.5 font-mono text-[9.5px] text-white/90">+{g.outputs.length - 1}</span>}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent p-2.5 pt-10 opacity-0 transition-opacity duration-300 group-hover:opacity-100 group-focus-within:opacity-100">
        <p className="line-clamp-2 text-[11.5px] leading-snug text-white/90">{promptOf(g)}</p>
        <div className="pointer-events-auto mt-2 flex items-center justify-between gap-2">
          <span className="truncate font-mono text-[9.5px] text-white/60">{g.model_label}</span>
          <button type="button" onClick={onRemake} className="flex shrink-0 items-center gap-1 rounded-md bg-white px-2 py-1 text-[11px] font-medium text-black transition-transform active:scale-95">
            <Wand2 className="size-3" /> Remake
          </button>
        </div>
      </div>
    </div>
  )
}

function Detail({
  generation: g,
  onClose,
  onPrev,
  onNext,
  onRemake,
  onAnimate,
  onPost,
  onDelete,
}: {
  generation: Generation | null
  onClose: () => void
  onPrev?: () => void
  onNext?: () => void
  onRemake: (g: Generation) => void
  onAnimate: (g: Generation) => void
  onPost: (g: Generation) => void
  onDelete: (g: Generation) => Promise<void>
}) {
  const toast = useToast()
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [shown, setShown] = useState(0)
  const id = g?.id

  // A new piece starts on its first output, with nothing half-confirmed.
  const [lastId, setLastId] = useState(id)
  if (lastId !== id) {
    setLastId(id)
    setConfirming(false)
    setShown(0)
  }

  useEffect(() => {
    if (!g) return
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.('input, textarea')) return
      if (e.key === 'ArrowLeft' && onPrev) onPrev()
      if (e.key === 'ArrowRight' && onNext) onNext()
      if (e.key.toLowerCase() === 'r' && !e.ctrlKey && !e.metaKey) onRemake(g)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [g, onPrev, onNext, onRemake])

  const out = g?.outputs[shown] ?? g?.outputs[0]
  const p = g?.params ?? {}
  const rows: Array<[string, string]> = g
    ? [
        ['Made for', madeFor(g)],
        ['Model', g.model_label],
        ['Look', styleOf(typeof p.style === 'string' ? p.style : undefined).label],
        ...(g.kind === 'video' && p.duration ? [['Length', `${p.duration} s`] as [string, string]] : []),
        ...(p.resolution ? [['Quality', String(p.resolution).toUpperCase()] as [string, string]] : []),
        ...(typeof p.audio === 'boolean' ? [['Sound', p.audio ? 'On' : 'Off'] as [string, string]] : []),
        ...(p.seed !== undefined ? [['Seed', String(p.seed)] as [string, string]] : []),
        ...(out?.width && out?.height ? [['Size', `${out.width} × ${out.height}`] as [string, string]] : []),
        ...(g.cost > 0 ? [['Cost', `$${g.cost.toFixed(2)}`] as [string, string]] : []),
        ['Made', fmtRelative(g.created_at)],
      ]
    : []

  return (
    <Modal open={!!g} onClose={onClose} title={g ? (g.kind === 'video' ? 'Video' : 'Still') : ''} className="max-w-5xl!">
      {g && out && (
        <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_300px]">
          <div className="relative flex min-h-[320px] items-center justify-center rounded-lg bg-black">
            {out.kind === 'video' ? (
              <video key={out.id} src={out.url} poster={out.poster_url ?? undefined} controls autoPlay loop playsInline className="max-h-[68vh] w-full object-contain" />
            ) : (
              <img key={out.id} src={out.url} alt={promptOf(g)} draggable={false} className="max-h-[68vh] w-full object-contain" />
            )}
            {onPrev && (
              <button type="button" onClick={onPrev} aria-label="Previous" className="absolute left-2 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-full bg-black/60 text-white hover:bg-black/80">
                <ChevronLeft className="size-4" />
              </button>
            )}
            {onNext && (
              <button type="button" onClick={onNext} aria-label="Next" className="absolute right-2 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-full bg-black/60 text-white hover:bg-black/80">
                <ChevronRight className="size-4" />
              </button>
            )}
            {g.outputs.length > 1 && (
              <div className="absolute inset-x-0 bottom-2 flex justify-center gap-1.5">
                {g.outputs.map((a, i) => (
                  <button key={a.id} type="button" onClick={() => setShown(i)} aria-label={`Output ${i + 1}`} className={cn('rounded-md ring-2', i === shown ? 'ring-accent' : 'ring-transparent')}>
                    <MediaThumb asset={a} className="size-10" />
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex min-w-0 flex-col gap-4">
            <div>
              <div className="flex items-center justify-between">
                <Label>Prompt</Label>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard?.writeText(promptOf(g))
                    toast('Prompt copied.')
                  }}
                  className="flex items-center gap-1 text-[11px] text-dim hover:text-fg"
                >
                  <Copy className="size-3" /> Copy
                </button>
              </div>
              <p className="mt-2 max-h-40 overflow-y-auto text-[13px] leading-snug text-fg" data-lenis-prevent>
                {promptOf(g)}
              </p>
            </div>

            <dl className="grid grid-cols-[76px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[12px]">
              {rows.map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="font-mono text-[10px] uppercase tracking-[0.12em] text-dim">{k}</dt>
                  <dd className="truncate text-muted">{v}</dd>
                </div>
              ))}
            </dl>

            {g.inputs.length > 0 && (
              <div>
                <Label>Made from</Label>
                <div className="mt-2 flex gap-1.5">
                  {g.inputs.map((a) => (
                    <MediaThumb key={a.id} asset={a} className="size-10" />
                  ))}
                </div>
              </div>
            )}

            <div className="mt-auto space-y-1.5">
              <Btn variant="primary" icon={Wand2} onClick={() => onRemake(g)} className="w-full">
                Remake in the Lab <Kbd className="ml-1 border-black/20 text-current opacity-60">R</Kbd>
              </Btn>
              <div className="grid grid-cols-2 gap-1.5">
                {out.kind === 'image' && (
                  <Btn size="sm" icon={Clapperboard} onClick={() => onAnimate(g)}>
                    Animate
                  </Btn>
                )}
                <Btn size="sm" icon={Send} onClick={() => onPost(g)}>
                  Use in a post
                </Btn>
                <a href={out.url} download className="inline-flex h-7 items-center justify-center gap-1.5 rounded-md border border-line-2 px-2.5 text-[12px] font-medium text-fg transition-colors hover:border-white/30 hover:bg-white/[0.04]">
                  <Download className="size-3.5" strokeWidth={1.75} /> Download
                </a>
                {confirming ? (
                  <Btn
                    size="sm"
                    variant="danger"
                    loading={deleting}
                    onClick={async () => {
                      setDeleting(true)
                      await onDelete(g)
                      setDeleting(false)
                    }}
                  >
                    Remove it?
                  </Btn>
                ) : (
                  <Btn size="sm" variant="subtle" icon={Trash2} onClick={() => setConfirming(true)}>
                    Remove
                  </Btn>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </Modal>
  )
}
