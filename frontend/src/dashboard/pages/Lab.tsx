import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Clapperboard,
  Download,
  Film,
  Flag,
  FlaskConical,
  History,
  ImagePlus,
  Images,
  Layers,
  LoaderCircle,
  RotateCcw,
  Send,
  Shuffle,
  Sparkles,
  Volume2,
  VolumeX,
  Wand2,
  X,
} from 'lucide-react'
import { Serif } from '../../components/ui/Reveal'
import { api, type Asset, type Generation, type ModelInfo, type Registry } from '../../lib/api'
import { cn } from '../../lib/cn'
import { Link, useQueryParam, useRouter } from '../../lib/router'
import { fmtRelative, useApi, useInvalidate } from '../data'
import { PhoneFrame } from '../lab/PhoneFrame'
import { FORMATS, HOOKS, STYLES, aspectOf, fillHook, formatFor, formatOf, madeFor, promptHistory, promptOf, rememberPrompt, styleOf, type FormatId } from '../lab/presets'
import { MediaPicker, MediaThumb } from '../media/Media'
import { ModelPicker, useGenerations } from '../studio/parts'
import { messageFor, retryGeneration, runMedia } from '../studio/run'
import { useToast } from '../toast'
import { Btn, FieldError, inputClass, Kbd, Label, PageHeader, Panel, Segmented, Skeleton, Stagger, Toggle } from '../ui'

type Kind = 'video' | 'image'

type Form = {
  kind: Kind
  format: FormatId
  model: string | null
  prompt: string
  style: string
  duration: number
  resolution: string
  sound: boolean
  seedMode: 'random' | 'fixed'
  seed: number | null
  variations: number
  inputs: Asset[]
  end: Asset | null
}

const ratio = (a: string) => {
  const [w, h] = a.split(':').map(Number)
  return w / h || 1
}
const nearestAspect = (want: string, list: string[]) => list.reduce((b, a) => (Math.abs(ratio(a) - ratio(want)) < Math.abs(ratio(b) - ratio(want)) ? a : b), list[0])
const nearest = (want: number, list: number[]) => list.reduce((b, d) => (Math.abs(d - want) < Math.abs(b - want) ? d : b), list[0])
const randomSeed = () => 1 + Math.floor(Math.random() * 999_999)
const busy = (g: Generation) => g.status === 'queued' || g.status === 'running'

function firstModel(models: ModelInfo[], kind: Kind) {
  const list = models.filter((m) => m.kind === kind)
  return list.find((m) => m.available)?.id ?? list[0]?.id ?? null
}

/** The lab set up exactly as a piece was made: prompt, model and every setting. */
function fromGeneration(g: Generation, f: Form, models: ModelInfo[]): Form {
  const kind: Kind = g.kind === 'image' ? 'image' : 'video'
  const p = g.params ?? {}
  return {
    ...f,
    kind,
    model: models.some((m) => m.id === g.model && m.kind === kind) ? g.model : firstModel(models, kind),
    format: formatFor(g),
    prompt: promptOf(g),
    style: typeof p.style === 'string' ? p.style : 'none',
    duration: typeof p.duration === 'number' ? p.duration : f.duration,
    resolution: typeof p.resolution === 'string' ? p.resolution : '',
    sound: typeof p.audio === 'boolean' ? p.audio : true,
    seedMode: typeof p.seed === 'number' ? 'fixed' : 'random',
    seed: typeof p.seed === 'number' ? p.seed : null,
    variations: 1,
    // The second input of a video is its end frame.
    inputs: kind === 'video' ? g.inputs.slice(0, 1) : g.inputs,
    end: kind === 'video' ? (g.inputs[1] ?? null) : null,
  }
}

/** A still as the first frame of a new video, on a model that can start from an image. */
function toAnimate(g: Generation, f: Form, models: ModelInfo[]): Form {
  const takes = (m: ModelInfo) => m.kind === 'video' && m.available && (m.caps?.image_input ?? true)
  const model = models.find((m) => m.id === f.model && takes(m))?.id ?? models.find(takes)?.id ?? firstModel(models, 'video')
  const style = g.params?.style
  return { ...f, kind: 'video', model, prompt: promptOf(g), format: formatFor(g), style: typeof style === 'string' ? style : f.style, inputs: g.outputs.slice(0, 1), end: null, seedMode: 'random', seed: null, variations: 1 }
}

/** /dashboard/lab: a lab for short-form social video — Reels, TikTok, Shorts — and the stills around them. */
export default function Lab() {
  const { data: registry } = useApi<Registry>('/models')
  if (!registry) {
    return (
      <div>
        <Header />
        <Skeleton className="mt-10 h-[620px] rounded-xl" />
      </div>
    )
  }
  // Upscalers only enlarge an image; they live in the Creative Lab's Upscale space.
  return <Workspace models={registry.models.filter((m) => !m.capabilities.upscale)} />
}

function Header() {
  return (
    <PageHeader
      eyebrow="Reels Lab"
      title={
        <>
          Make it <Serif>stop the scroll.</Serif>
        </>
      }
      sub="A lab for Reels, TikTok and Shorts: vertical video from a prompt or a product photo, previewed on a phone with the app’s own buttons on top."
    />
  )
}

function Workspace({ models }: { models: ModelInfo[] }) {
  const toast = useToast()
  const invalidate = useInvalidate()
  const { navigate } = useRouter()
  const remakeId = useQueryParam('remake')
  const animateId = useQueryParam('animate')
  const promptRef = useRef<HTMLTextAreaElement>(null)

  const [form, setForm] = useState<Form>(() => ({
    kind: 'video',
    format: 'reels',
    model: firstModel(models, 'video'),
    prompt: '',
    style: 'ugc',
    duration: 8,
    resolution: '',
    sound: true,
    seedMode: 'random',
    seed: null,
    variations: 1,
    inputs: [],
    end: null,
  }))
  const set = useCallback((patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch })), [])
  const [picking, setPicking] = useState<null | 'inputs' | 'end'>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [overlay, setOverlay] = useState(true)
  const [muted, setMuted] = useState(true)
  const [historyOpen, setHistoryOpen] = useState(false)

  const { data: feed, loading } = useGenerations({ media: 1, limit: 30 })
  const items = useMemo(() => feed ?? [], [feed])
  const selected = items.find((g) => g.id === selectedId) ?? items.find((g) => g.status === 'succeeded') ?? items[0] ?? null

  const current = models.find((m) => m.id === form.model && m.kind === form.kind)
  const caps = current?.caps ?? null
  const format = formatOf(form.format)
  const aspects = caps?.aspects ?? ['1:1', '4:5', '9:16', '16:9']
  const madeAs = aspects.includes(format.aspect) ? format.aspect : nearestAspect(format.aspect, aspects)
  const durations = caps?.durations ?? [5, 10]
  const resolutions = caps?.resolutions ?? []
  const takesImages = caps ? caps.image_input : form.kind === 'video'
  const maxImages = form.kind === 'video' ? 1 : Math.max(1, caps?.max_images ?? 1)
  const needsImage = form.kind === 'video' && (caps ? caps.requires_image : true)
  const start = form.kind === 'video' ? (form.inputs[0] ?? null) : null
  const maxVariations = form.kind === 'video' ? 2 : 4

  // A different model keeps every choice it can, snapped to what it accepts.
  useEffect(() => {
    setForm((f) => ({
      ...f,
      duration: durations.includes(f.duration) ? f.duration : nearest(f.duration, durations),
      resolution: f.resolution && resolutions.includes(f.resolution) ? f.resolution : '',
      inputs: takesImages ? f.inputs.slice(0, maxImages) : [],
      end: caps?.end_frame ? f.end : null,
      variations: Math.min(f.variations, form.kind === 'video' ? 2 : 4),
    }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.model, form.kind])

  /** Fill the lab with what made a piece, or set a still up to be animated. */
  const load = useCallback(
    (g: Generation, as: 'remake' | 'animate' = 'remake') => {
      const animating = as === 'animate' && g.outputs[0]?.kind === 'image'
      setForm((f) => (animating ? toAnimate(g, f, models) : fromGeneration(g, f, models)))
      toast(animating ? 'Ready to animate: the video starts from this image.' : 'Loaded into the lab: same prompt, model and settings.')
      window.setTimeout(() => promptRef.current?.focus(), 50)
    },
    [models, toast],
  )

  // Arriving from the Gallery: ?remake=ID or ?animate=ID. Loaded once, however often the effect runs.
  const arrived = useRef<string | null>(null)
  useEffect(() => {
    const id = remakeId ?? animateId
    if (!id) {
      arrived.current = null
      return
    }
    if (arrived.current === `${remakeId}/${animateId}`) return
    arrived.current = `${remakeId}/${animateId}`
    api<Generation>(`/generations/${id}`)
      .then((g) => {
        load(g, animateId ? 'animate' : 'remake')
        setSelectedId(g.id)
      })
      .catch(() => toast('That piece couldn’t be loaded.', 'error'))
      .finally(() => navigate('/dashboard/lab', { replace: true }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remakeId, animateId])

  /** Make `base` as set: on its own model, in the nearest shape that model makes. */
  const make = async (base: Form = form) => {
    const model = models.find((m) => m.id === base.model && m.kind === base.kind)
    const c = model?.caps ?? null
    const want = formatOf(base.format).aspect
    const shapes = c?.aspects ?? ['1:1', '4:5', '9:16', '16:9']
    if (!base.prompt.trim()) {
      setError('Describe the shot, or start from a hook.')
      promptRef.current?.focus()
      return
    }
    if (base.kind === 'video' && (c ? c.requires_image : true) && !base.inputs[0]) return setError(`${model?.label ?? 'This model'} starts from an image. Pick one.`)
    setSubmitting(true)
    setError(null)
    const style = styleOf(base.style)
    const prompt = style.text ? `${base.prompt.trim()}, ${style.text}` : base.prompt.trim()
    const ids = [...base.inputs.map((a) => a.id), ...(base.kind === 'video' && base.inputs[0] && base.end && c?.end_frame ? [base.end.id] : [])]
    try {
      const made: Generation[] = []
      for (let i = 0; i < base.variations; i++) {
        const seed = c?.seed ? (base.seedMode === 'fixed' && base.seed !== null ? base.seed + i : randomSeed()) : undefined
        const params: Record<string, unknown> = {
          aspect_ratio: shapes.includes(want) ? want : nearestAspect(want, shapes),
          format: base.format,
          style: base.style,
          base_prompt: base.prompt.trim(),
          ...(base.kind === 'video' ? { duration: base.duration, ...(c?.audio ? { audio: base.sound } : {}) } : {}),
          ...(base.resolution ? { resolution: base.resolution } : {}),
          ...(seed !== undefined ? { seed } : {}),
        }
        made.push(await runMedia({ kind: base.kind, model: base.model, prompt, params, input_asset_ids: ids.length ? ids : undefined }))
      }
      rememberPrompt(base.prompt)
      if (made[0]) setSelectedId(made[0].id)
      invalidate()
    } catch (e) {
      setError(messageFor(e))
    } finally {
      setSubmitting(false)
    }
  }

  /** Same settings, fresh seeds: four more stills, or one more take of a video. */
  const anotherTake = (g: Generation) => {
    const next: Form = { ...fromGeneration(g, form, models), seedMode: 'random', seed: null, variations: g.kind === 'image' ? 4 : 1 }
    setForm(next)
    make(next)
  }

  // Keyboard: Ctrl+Enter makes; arrows walk the strip; R remake, V another take, A animate, S safe zones.
  const keys = useRef<(e: KeyboardEvent) => void>(() => {})
  keys.current = (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault()
      make()
      return
    }
    const typing = (e.target as HTMLElement)?.closest?.('input, textarea, select, [contenteditable="true"]')
    if (typing || e.ctrlKey || e.metaKey || e.altKey) return
    const index = selected ? items.findIndex((g) => g.id === selected.id) : -1
    const act: Record<string, () => void> = {
      ArrowRight: () => items[index + 1] && setSelectedId(items[index + 1].id),
      ArrowLeft: () => index > 0 && setSelectedId(items[index - 1].id),
      r: () => selected && load(selected),
      v: () => selected?.status === 'succeeded' && anotherTake(selected),
      a: () => selected?.outputs[0]?.kind === 'image' && load(selected, 'animate'),
      s: () => setOverlay((o) => !o),
    }
    const fn = act[e.key.length === 1 ? e.key.toLowerCase() : e.key]
    if (fn) {
      e.preventDefault()
      fn()
    }
  }
  useEffect(() => {
    const handler = (e: KeyboardEvent) => keys.current(e)
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const applyHook = (template: string) => {
    const subject = form.prompt.trim().length <= 80 ? form.prompt : ''
    set({ prompt: fillHook(template, subject) })
    setError(null)
    promptRef.current?.focus()
  }

  return (
    <div>
      <Header />

      <div className="mt-10 grid grid-cols-1 items-start gap-4 xl:grid-cols-[370px_minmax(0,1fr)_290px]">
        {/* ---------------- the shot ---------------- */}
        <Stagger i={0}>
          <Panel title="The shot" sub={format.tip} className="xl:sticky xl:top-20">
            <div className="space-y-4">
              <div>
                <Label>Made for</Label>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {FORMATS.map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      aria-pressed={form.format === f.id}
                      onClick={() => set({ format: f.id, duration: nearest(f.duration, durations) })}
                      className={cn(
                        'rounded-md border px-2.5 py-1.5 text-[12px] transition-colors',
                        form.format === f.id ? 'border-accent/50 bg-accent/[0.1] text-fg' : 'border-line-2 text-muted hover:border-white/20 hover:text-fg',
                      )}
                    >
                      {f.label}
                      {!f.label.includes(f.aspect) && <span className="ml-1.5 font-mono text-[9.5px] text-dim">{f.aspect}</span>}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <Label>Make</Label>
                <Segmented
                  id="lab-kind"
                  label="Output"
                  className="mt-2 w-fit"
                  value={form.kind}
                  onChange={(kind) => set({ kind, model: firstModel(models, kind), inputs: [], end: null })}
                  options={[
                    { value: 'video' as const, label: 'Video' },
                    { value: 'image' as const, label: 'Still' },
                  ]}
                />
              </div>
              <div>
                <Label>Model</Label>
                <ModelPicker models={models} kind={form.kind} value={form.model} onChange={(model) => set({ model })} className="mt-2" />
              </div>
              {current && !current.available && <p className="-mt-2 text-[11.5px] text-warn">{current.reason}</p>}
              {madeAs !== format.aspect && (
                <p className="-mt-2 text-[11.5px] text-dim">
                  {current?.label} doesn’t make {format.aspect}; it will be made {madeAs}.
                </p>
              )}

              <div>
                <Label>Hook</Label>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {HOOKS.map((h) => (
                    <button key={h.id} type="button" onClick={() => applyHook(h.template)} className="rounded-full border border-line-2 px-2.5 py-1 text-[11.5px] text-muted transition-colors hover:border-accent-soft/60 hover:text-fg">
                      {h.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between">
                  <Label>{form.kind === 'video' ? 'The shot, second by second' : 'The image'}</Label>
                  <div className="relative">
                    <button type="button" onClick={() => setHistoryOpen((o) => !o)} className="flex items-center gap-1 text-[11px] text-dim hover:text-fg">
                      <History className="size-3" /> History
                    </button>
                    {historyOpen && (
                      <div className="absolute right-0 top-6 z-30 max-h-64 w-72 overflow-y-auto rounded-lg border border-line-2 bg-panel-3 p-1 shadow-[0_24px_60px_-20px_rgb(0_0_0_/_0.9)]" data-lenis-prevent>
                        {promptHistory().length === 0 && <p className="p-3 text-[11.5px] text-dim">Prompts you make with are kept here, in this browser.</p>}
                        {promptHistory().map((p) => (
                          <button
                            key={p}
                            type="button"
                            onClick={() => {
                              set({ prompt: p })
                              setHistoryOpen(false)
                            }}
                            className="block w-full truncate rounded-md px-2.5 py-1.5 text-left text-[12px] text-muted hover:bg-white/[0.06] hover:text-fg"
                          >
                            {p}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <textarea
                  ref={promptRef}
                  value={form.prompt}
                  onChange={(e) => {
                    set({ prompt: e.target.value })
                    setError(null)
                  }}
                  rows={5}
                  maxLength={3500}
                  placeholder={
                    form.kind === 'video'
                      ? 'Open on the hook: a hand slams the candle down, flame flares, camera whips to a close-up, the label fills the frame…'
                      : 'A cover frame for the reel: the candle on wet slate, bold negative space at the top for a text hook…'
                  }
                  className={cn(inputClass, 'mt-2 h-auto resize-none py-2.5 leading-snug')}
                />
              </div>

              <div>
                <Label>Look</Label>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {STYLES.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      aria-pressed={form.style === s.id}
                      title={s.text || 'Your prompt only'}
                      onClick={() => set({ style: s.id })}
                      className={cn(
                        'rounded-full border px-2.5 py-1 text-[11.5px] transition-colors',
                        form.style === s.id ? 'border-accent/50 bg-accent/[0.1] text-fg' : 'border-line-2 text-muted hover:border-white/20 hover:text-fg',
                      )}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>

              {takesImages && (
                <div>
                  <Label>{form.kind === 'video' ? (needsImage ? 'Starts from' : 'Starts from · optional') : maxImages > 1 ? `References · optional, up to ${maxImages}` : 'Reference · optional'}</Label>
                  <FramePick
                    assets={form.inputs}
                    empty={form.kind === 'video' ? (needsImage ? 'Pick the first frame' : 'Leave empty to make it from the prompt alone') : 'The product to keep in the new image'}
                    filled={form.kind === 'video' ? 'The video starts on this frame' : 'The model keeps what’s in these'}
                    onPick={() => setPicking('inputs')}
                    onClear={() => set({ inputs: [], end: null })}
                    icon={ImagePlus}
                  />
                  {form.kind === 'video' && caps?.end_frame && start && (
                    <FramePick assets={form.end ? [form.end] : []} empty="Ends on · optional: the shot moves to this frame" filled="And ends on this frame" onPick={() => setPicking('end')} onClear={() => set({ end: null })} icon={Flag} />
                  )}
                  <MediaPicker
                    open={picking !== null}
                    onClose={() => setPicking(null)}
                    onPick={(a) => {
                      const images = a.filter((x) => x.kind === 'image')
                      if (picking === 'end') set({ end: images[0] ?? null })
                      else set({ inputs: images.slice(0, maxImages) })
                    }}
                    max={picking === 'end' ? 1 : maxImages}
                    initial={picking === 'end' ? (form.end ? [form.end] : []) : form.inputs}
                  />
                </div>
              )}

              {form.kind === 'video' && (
                <div>
                  <Label>Length</Label>
                  <Segmented id="lab-duration" label="Duration" className="mt-2 w-fit" value={form.duration} onChange={(duration) => set({ duration })} options={durations.map((d) => ({ value: d, label: `${d} s` }))} />
                </div>
              )}

              <div className="flex flex-wrap items-end gap-x-5 gap-y-4">
                {resolutions.length > 0 && (
                  <div>
                    <Label>Quality</Label>
                    <Segmented
                      id="lab-res"
                      label="Resolution"
                      className="mt-2 w-fit"
                      value={form.resolution || caps?.default_resolution || resolutions[0]}
                      onChange={(resolution) => set({ resolution })}
                      options={resolutions.map((r) => ({ value: r, label: r.toUpperCase() }))}
                    />
                  </div>
                )}
                <div>
                  <Label>Takes</Label>
                  <Segmented
                    id="lab-takes"
                    label="Variations"
                    className="mt-2 w-fit"
                    value={Math.min(form.variations, maxVariations)}
                    onChange={(variations) => set({ variations })}
                    options={Array.from({ length: maxVariations }, (_, i) => ({ value: i + 1, label: String(i + 1) }))}
                  />
                </div>
              </div>

              {form.kind === 'video' && caps?.audio && (
                <div className="flex items-center justify-between gap-3">
                  <span>
                    <Label>Sound</Label>
                    <span className="mt-1 block text-[11.5px] text-dim">Music and effects made with the video.</span>
                  </span>
                  <Toggle on={form.sound} onChange={(sound) => set({ sound })} label="Generate sound" />
                </div>
              )}

              {caps?.seed && (
                <div>
                  <Label>Seed</Label>
                  <div className="mt-2 flex items-center gap-2">
                    <Segmented
                      id="lab-seed"
                      label="Seed"
                      className="w-fit"
                      value={form.seedMode}
                      onChange={(seedMode) => set({ seedMode, seed: seedMode === 'fixed' ? (form.seed ?? randomSeed()) : form.seed })}
                      options={[
                        { value: 'random' as const, label: 'New each time' },
                        { value: 'fixed' as const, label: 'Fixed' },
                      ]}
                    />
                    {form.seedMode === 'fixed' && (
                      <input
                        value={form.seed ?? ''}
                        onChange={(e) => set({ seed: e.target.value ? Number(e.target.value.replace(/\D/g, '')) : null })}
                        inputMode="numeric"
                        className={cn(inputClass, 'w-28 font-mono')}
                        aria-label="Seed"
                      />
                    )}
                  </div>
                </div>
              )}

              <FieldError message={error} />
              <Btn variant="primary" icon={Sparkles} onClick={() => make()} loading={submitting} disabled={!current?.available} className="w-full">
                {form.kind === 'video' ? (form.variations > 1 ? `Make ${form.variations} takes` : 'Make the video') : form.variations > 1 ? `Make ${form.variations} stills` : 'Make the still'}
                <Kbd className="ml-1 border-black/20 text-current opacity-60">Ctrl ↵</Kbd>
              </Btn>
            </div>
          </Panel>
        </Stagger>

        {/* ---------------- the phone ---------------- */}
        <Stagger i={1} className="min-w-0">
          <div className="rounded-xl border border-line bg-panel p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <p className="flex items-center gap-2 font-mono text-[10.5px] uppercase tracking-[0.14em] text-dim">
                <FlaskConical className="size-3.5" strokeWidth={1.75} />
                {selected ? `${selected.kind === 'video' ? 'Video' : 'Still'} · ${selected.model_label}` : 'Preview'}
              </p>
              <span className="flex items-center gap-3">
                {selected?.kind === 'video' && selected.status === 'succeeded' && (
                  <button type="button" onClick={() => setMuted((m) => !m)} className="flex items-center gap-1 text-[11.5px] text-muted hover:text-fg">
                    {muted ? <VolumeX className="size-3.5" /> : <Volume2 className="size-3.5" />}
                    {muted ? 'Sound off' : 'Sound on'}
                  </button>
                )}
                {format.overlay && (
                  <label className="flex items-center gap-2 text-[11.5px] text-muted">
                    Safe zones <Kbd>S</Kbd>
                    <Toggle on={overlay} onChange={setOverlay} label="Safe zones" />
                  </label>
                )}
              </span>
            </div>

            <div className="flex h-[min(72vh,760px)] items-center justify-center">
              <PhoneFrame aspect={selected ? aspectOf(selected, format.aspect) : format.aspect} overlay={format.overlay} showOverlay={overlay}>
                <Screen generation={selected} muted={muted} onRetry={async (g) => {
                  try {
                    await retryGeneration(g, {})
                    invalidate()
                  } catch (e) {
                    toast(messageFor(e), 'error')
                  }
                }} />
              </PhoneFrame>
            </div>

            <div className="mt-4">
              <Label className="mb-2">This session · {items.length}</Label>
              {!feed && loading ? (
                <Skeleton className="h-24 rounded-lg" />
              ) : items.length === 0 ? (
                <p className="text-[12px] text-dim">What you make appears here, and in the Gallery.</p>
              ) : (
                <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
                  {items.map((g) => (
                    <StripItem key={g.id} generation={g} selected={g.id === selected?.id} onClick={() => setSelectedId(g.id)} />
                  ))}
                </div>
              )}
            </div>
          </div>
        </Stagger>

        {/* ---------------- what made it ---------------- */}
        <Stagger i={2}>
          <Inspector
            generation={selected}
            onRemake={(g) => load(g)}
            onAnotherTake={anotherTake}
            onAnimate={(g) => load(g, 'animate')}
            onUseAsFrame={(g) => {
              const a = g.outputs[0]
              if (a?.kind === 'image') {
                set({ inputs: form.kind === 'video' ? [a] : [a].concat(form.inputs).slice(0, maxImages) })
                toast(form.kind === 'video' ? 'Set as the start frame.' : 'Added as a reference.')
              }
            }}
            onPost={(g) => navigate(`/dashboard/create?assets=${g.outputs.map((a) => a.id).join(',')}`)}
          />
        </Stagger>
      </div>
    </div>
  )
}

function FramePick({ assets, empty, filled, onPick, onClear, icon: Icon }: { assets: Asset[]; empty: string; filled: string; onPick: () => void; onClear: () => void; icon: typeof ImagePlus }) {
  return (
    <button
      type="button"
      onClick={onPick}
      className="mt-2 flex w-full items-center gap-3 rounded-md border border-dashed border-line-2 p-2 text-left text-[12.5px] text-muted transition-colors hover:border-accent-soft/60 hover:text-fg"
    >
      {assets.length ? (
        <span className="flex gap-1.5">
          {assets.map((a) => (
            <MediaThumb key={a.id} asset={a} className="size-11" />
          ))}
        </span>
      ) : (
        <Icon className="m-2.5 size-5" strokeWidth={1.5} />
      )}
      <span className="min-w-0 flex-1">{assets.length ? filled : empty}</span>
      {assets.length > 0 && (
        <span
          role="button"
          tabIndex={0}
          aria-label="Remove"
          onClick={(e) => {
            e.stopPropagation()
            onClear()
          }}
          onKeyDown={(e) => e.key === 'Enter' && onClear()}
          className="shrink-0 rounded p-1 text-dim hover:bg-white/[0.06] hover:text-fg"
        >
          <X className="size-3.5" />
        </span>
      )}
    </button>
  )
}

function Elapsed({ from }: { from: string }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [])
  const s = Math.max(0, Math.round((now - Date.parse(from)) / 1000))
  return <>{`${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`}</>
}

function Screen({ generation: g, muted, onRetry }: { generation: Generation | null; muted: boolean; onRetry: (g: Generation) => void }) {
  if (!g) {
    return (
      <div className="flex size-full flex-col items-center justify-center p-6 text-center">
        <Clapperboard className="size-7 text-dim" strokeWidth={1.25} />
        <p className="mt-3 font-serif text-[22px] italic">Your reel plays here.</p>
        <p className="mt-2 text-[11.5px] leading-snug text-dim">Pick where it’s going, start from a hook, and make it.</p>
      </div>
    )
  }
  if (busy(g)) {
    return (
      <div className="flex size-full flex-col items-center justify-center p-6 text-center">
        <LoaderCircle className="size-7 animate-spin text-accent-soft" />
        <p className="mt-3 text-[13px]">{g.status === 'queued' ? 'Waiting for the model…' : 'Making it…'}</p>
        <p className="mt-1 font-mono text-[11px] text-dim">
          <Elapsed from={g.started_at ?? g.created_at} />
        </p>
        <p className="mt-3 line-clamp-3 text-[11px] leading-snug text-dim">{promptOf(g)}</p>
      </div>
    )
  }
  if (g.status === 'failed') {
    return (
      <div className="flex size-full flex-col items-center justify-center p-6 text-center">
        <p className="text-[13px] text-fail">This one didn’t come out</p>
        <p className="mt-2 text-[11.5px] leading-snug text-muted">{g.error}</p>
        <Btn size="sm" icon={RotateCcw} className="mt-4" onClick={() => onRetry(g)}>
          Try again
        </Btn>
      </div>
    )
  }
  const out = g.outputs[0]
  if (!out) return null
  return out.kind === 'video' ? (
    <video key={out.id} src={out.url} poster={out.poster_url ?? undefined} autoPlay loop muted={muted} playsInline className="size-full object-cover" />
  ) : (
    <img key={out.id} src={out.url} alt={g.prompt} draggable={false} className="size-full object-cover" />
  )
}

function StripItem({ generation: g, selected, onClick }: { generation: Generation; selected: boolean; onClick: () => void }) {
  const out = g.outputs[0]
  return (
    <button
      type="button"
      onClick={onClick}
      title={promptOf(g)}
      className={cn(
        'relative aspect-[9/16] w-16 shrink-0 overflow-hidden rounded-md border bg-white/[0.03] transition-colors',
        selected ? 'border-accent ring-2 ring-accent/40' : g.status === 'failed' ? 'border-fail/40' : 'border-line hover:border-line-2',
      )}
    >
      {out ? (
        out.kind === 'video' ? (
          <video src={out.url} poster={out.poster_url ?? undefined} muted preload="metadata" className="size-full object-cover" />
        ) : (
          <img src={out.url} alt="" className="size-full object-cover" loading="lazy" />
        )
      ) : busy(g) ? (
        <span className="grid size-full place-items-center">
          <LoaderCircle className="size-4 animate-spin text-accent-soft" />
        </span>
      ) : (
        <span className="grid size-full place-items-center text-[9px] text-fail">Failed</span>
      )}
      {g.kind === 'video' && out && <Film className="absolute bottom-1 right-1 size-3 text-white drop-shadow" />}
    </button>
  )
}

function Inspector({
  generation: g,
  onRemake,
  onAnotherTake,
  onAnimate,
  onUseAsFrame,
  onPost,
}: {
  generation: Generation | null
  onRemake: (g: Generation) => void
  onAnotherTake: (g: Generation) => void
  onAnimate: (g: Generation) => void
  onUseAsFrame: (g: Generation) => void
  onPost: (g: Generation) => void
}) {
  if (!g) {
    return (
      <Panel title="Nothing yet" sub="Make something, or open a piece from the Gallery to remake it.">
        <ul className="space-y-1.5 text-[11.5px] text-dim">
          <li className="flex justify-between">Make <Kbd>Ctrl ↵</Kbd></li>
          <li className="flex justify-between">Previous / next <Kbd>← →</Kbd></li>
          <li className="flex justify-between">Remake <Kbd>R</Kbd></li>
          <li className="flex justify-between">Another take <Kbd>V</Kbd></li>
          <li className="flex justify-between">Animate a still <Kbd>A</Kbd></li>
          <li className="flex justify-between">Safe zones <Kbd>S</Kbd></li>
        </ul>
      </Panel>
    )
  }
  const p = g.params ?? {}
  const out = g.outputs[0]
  const rows: Array<[string, string]> = [
    ['Made for', madeFor(g)],
    ['Model', g.model_label],
    ['Look', styleOf(typeof p.style === 'string' ? p.style : undefined).label],
    ...(g.kind === 'video' && p.duration ? [['Length', `${p.duration} s`] as [string, string]] : []),
    ...(p.resolution ? [['Quality', String(p.resolution).toUpperCase()] as [string, string]] : []),
    ...(typeof p.audio === 'boolean' ? [['Sound', p.audio ? 'On' : 'Off'] as [string, string]] : []),
    ...(p.seed !== undefined ? [['Seed', String(p.seed)] as [string, string]] : []),
    ...(out?.width && out?.height ? [['Size', `${out.width} × ${out.height}`] as [string, string]] : []),
    ['Made', fmtRelative(g.created_at)],
  ]
  return (
    <Panel title={g.status === 'succeeded' ? 'What made it' : g.status === 'failed' ? 'What was asked' : 'In the making'} sub={promptOf(g)} bodyClassName="space-y-4">
      {g.status === 'succeeded' && (
        <div className="grid grid-cols-2 gap-1.5">
          <Btn size="sm" variant="primary" icon={Wand2} onClick={() => onRemake(g)}>
            Remake
          </Btn>
          <Btn size="sm" icon={Shuffle} onClick={() => onAnotherTake(g)}>
            {g.kind === 'image' ? '4 variations' : 'Another take'}
          </Btn>
          {out?.kind === 'image' && (
            <>
              <Btn size="sm" icon={Clapperboard} onClick={() => onAnimate(g)}>
                Animate
              </Btn>
              <Btn size="sm" icon={Layers} onClick={() => onUseAsFrame(g)}>
                Use as frame
              </Btn>
            </>
          )}
          <Btn size="sm" icon={Send} onClick={() => onPost(g)}>
            Use in a post
          </Btn>
          {out && (
            <a href={out.url} download className="inline-flex h-7 items-center justify-center gap-1.5 rounded-md border border-line-2 px-2.5 text-[12px] text-muted transition-colors hover:border-white/20 hover:text-fg">
              <Download className="size-3.5" /> Download
            </a>
          )}
        </div>
      )}
      {g.status === 'failed' && (
        <>
          <p className="rounded-lg border border-fail/25 bg-fail/[0.06] p-3 text-[12px] leading-snug">{g.error}</p>
          <Btn size="sm" icon={Wand2} onClick={() => onRemake(g)}>
            Load to fix and remake
          </Btn>
        </>
      )}
      <dl className="grid grid-cols-[84px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[12px]">
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
      <Link to="/dashboard/gallery" className="flex items-center gap-1.5 text-[11.5px] text-dim hover:text-fg">
        <Images className="size-3.5" /> Everything in the Gallery
      </Link>
    </Panel>
  )
}
