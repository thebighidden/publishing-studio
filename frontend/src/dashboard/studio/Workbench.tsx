import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  AudioLines,
  CalendarClock,
  ArrowRight as ArrowRightIcon,
  ChevronDown,
  Clapperboard,
  Download,
  FolderPlus,
  Image as ImageIcon,
  ImagePlus,
  Home,
  Layers,
  ListOrdered,
  LoaderCircle,
  Maximize2,
  PenLine,
  Pencil,
  RotateCcw,
  Sparkles,
  Trash2,
  Upload,
  Wand2,
  Workflow as WorkflowIcon,
  X,
} from 'lucide-react'
import { api, ApiError, uploadFiles, type Asset, type Board, type Boards, type Generation, type ModelInfo, type Page, type Registry } from '../../lib/api'
import { ease } from '../../lib/motion'
import { cn } from '../../lib/cn'
import { useQueryParam } from '../../lib/router'
import { useApi, useInvalidate } from '../data'
import { MediaPicker, MediaThumb } from '../media/Media'
import { useToast } from '../toast'
import { Btn, EmptyState, FieldError, inputClass, Label, Segmented } from '../ui'
import { EditCanvas, type EditApi } from './EditCanvas'
import { GenerationCard, KIND_ICON, ModelPicker, useGenerations } from './parts'
import { PublishPost, type PostSource } from './PublishPost'
import { WorkflowSpace } from './Workflows'
import { messageFor, retryGeneration, runMedia, runText } from './run'

export type Space = 'home' | 'compose' | 'edit' | 'upscale' | 'video' | 'voice' | 'write' | 'workflow'

export const SPACES: Array<{ value: Space; label: string; icon: typeof Layers }> = [
  { value: 'compose', label: 'Compose', icon: ImageIcon },
  { value: 'edit', label: 'Edit', icon: Layers },
  { value: 'upscale', label: 'Upscale', icon: Maximize2 },
  { value: 'video', label: 'Video', icon: Clapperboard },
  { value: 'voice', label: 'Voice', icon: AudioLines },
  { value: 'write', label: 'Write', icon: PenLine },
  { value: 'workflow', label: 'Workflows', icon: WorkflowIcon },
]

const KIND_OF: Record<Space, Generation['kind']> = { home: 'image', compose: 'image', edit: 'image', upscale: 'image', video: 'video', voice: 'audio', write: 'text', workflow: 'image' }

/** Which generations a space shows: Compose shows plain images, Edit its edits, Upscale its upscales. */
const belongs = (space: Space, g: Generation) => {
  if (g.kind !== KIND_OF[space]) return false
  const mode = g.params?.mode
  if (space === 'edit') return mode === 'inpaint' || mode === 'outpaint'
  if (space === 'upscale') return mode === 'upscale'
  if (space === 'compose') return !mode
  return true
}

/** The board new results land on, and the one the gallery shows. Remembered per browser. */
type View = 'all' | 'none' | number

function useRemembered<T>(key: string, initial: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const saved = localStorage.getItem(key)
      return saved ? (JSON.parse(saved) as T) : initial
    } catch {
      return initial
    }
  })
  const set = useCallback(
    (v: T) => {
      setValue(v)
      try {
        localStorage.setItem(key, JSON.stringify(v))
      } catch {
        /* private mode */
      }
    },
    [key],
  )
  return [value, set]
}

const working = (g: Generation) => g.status === 'queued' || g.status === 'running'

/**
 * The Creative Lab as a workbench: settings on the left, the work in the middle, boards and the
 * queue on the right. Compose makes images, Edit repaints part of one, Video and Voice make
 * clips and voiceovers, Write drafts text.
 */
export function Workbench({ registry, space, onSpace, extra }: { registry: Registry; space: Space; onSpace: (s: Space) => void; extra?: ReactNode }) {
  const invalidate = useInvalidate()
  const toast = useToast()
  const [view, setView] = useRemembered<View>('flowai.lab.board', 'all')
  const [selected, setSelected] = useState<Asset | null>(null)
  const [editing, setEditing] = useState<Asset | null>(null)
  const [upscaling, setUpscaling] = useState<Asset | null>(null)
  const [handoff, setHandoff] = useState<{ space: Space; refs: Asset[]; n: number } | null>(null)
  const [post, setPost] = useState<PostSource | null>(null)
  const { data: boards } = useApi<Boards>('/boards')
  const feed = useGenerations({})
  const all = feed.data ?? []
  const board = typeof view === 'number' ? view : null

  // A result that just finished belongs in the gallery and the board counts.
  const done = all.filter((g) => g.status === 'succeeded').map((g) => g.id).join(',')
  const seen = useRef<string | null>(null)
  useEffect(() => {
    if (seen.current !== null && seen.current !== done) invalidate()
    seen.current = done
  }, [done, invalidate])

  const go = (s: Space) => {
    setSelected(null)
    onSpace(s)
  }
  const edit = (asset: Asset) => {
    setEditing(asset)
    go('edit')
  }
  const animate = (asset: Asset) => {
    setHandoff({ space: 'video', refs: [asset], n: Date.now() })
    go('video')
  }
  const reference = (asset: Asset) => {
    setHandoff({ space: 'compose', refs: [asset], n: Date.now() })
    go('compose')
  }
  const upscale = (asset: Asset) => {
    setUpscaling(asset)
    go('upscale')
  }
  const pick = (asset: Asset) => {
    if (space === 'edit' && asset.kind === 'image') setEditing(asset)
    else if (space === 'upscale' && asset.kind === 'image') setUpscaling(asset)
    else {
      setSelected(asset)
      const to: Space | null = asset.kind === 'video' ? 'video' : asset.kind === 'audio' ? 'voice' : space === 'write' ? 'compose' : null
      if (to && to !== space) onSpace(to)
    }
  }
  const queued = () => setSelected(null)
  const retry = async (g: Generation, change: { model?: string; prompt?: string }) => {
    try {
      await retryGeneration(g, change)
      invalidate()
    } catch (e) {
      toast(messageFor(e), 'error')
    }
  }

  const kind = KIND_OF[space]
  const mine = all.filter((g) => belongs(space, g))
  const editApi = useRef<EditApi | null>(null)
  const [editState, setEditState] = useState({ painted: false, extended: false })
  const active = all.filter(working).length

  return (
    <div className="flex flex-col gap-2 lg:h-[calc(100dvh-4.75rem)] lg:min-h-[600px]">
      <header className="flex flex-wrap items-center gap-2">
        <h1 className="mr-1 text-[15px] font-medium tracking-[-0.01em]">Creative Lab</h1>
        <nav className="flex flex-wrap items-center gap-0.5 rounded-lg border border-line bg-panel p-0.5" aria-label="Workspace">
          <button
            type="button"
            onClick={() => go('home')}
            aria-pressed={space === 'home'}
            aria-label="Start"
            title="Start"
            className={cn('grid size-8 place-items-center rounded-md transition-colors', space === 'home' ? 'bg-white/[0.08] text-fg' : 'text-dim hover:text-fg')}
          >
            <Home className="size-3.5" strokeWidth={1.75} />
          </button>
          {SPACES.map((s) => (
            <button
              key={s.value}
              type="button"
              onClick={() => go(s.value)}
              aria-pressed={space === s.value}
              className={cn(
                'flex h-8 items-center gap-1.5 rounded-md px-3 text-[12.5px] transition-colors',
                space === s.value ? 'bg-white/[0.08] text-fg' : 'text-dim hover:text-fg',
              )}
            >
              <s.icon className="size-3.5" strokeWidth={1.75} />
              {s.label}
            </button>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          {extra}
          <span className={cn('flex h-8 items-center gap-1.5 rounded-md border px-2.5 font-mono text-[11px]', active ? 'border-accent/40 text-accent-soft' : 'border-line text-dim')} title="Working now">
            {active ? <LoaderCircle className="size-3 animate-spin" /> : <ListOrdered className="size-3" />}
            {active}
          </span>
        </div>
      </header>

      {space === 'home' ? (
        <LabHome feed={all} onOpen={(s, a) => (a ? (s === 'edit' ? setEditing(a) : s === 'upscale' ? setUpscaling(a) : setSelected(a)) : null, onSpace(s))} />
      ) : space === 'workflow' ? (
        <WorkflowSpace registry={registry} board={board} />
      ) : (
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 lg:grid-cols-[330px_minmax(0,1fr)] xl:grid-cols-[330px_minmax(0,1fr)_300px]">
        <aside className="min-h-0 overflow-y-auto rounded-xl border border-line bg-panel" data-lenis-prevent>
          {space === 'edit' ? (
            <EditSettings models={registry.models} target={editing} board={board} editApi={editApi} state={editState} onQueued={queued} />
          ) : space === 'upscale' ? (
            <UpscaleSettings models={registry.models} target={upscaling} board={board} onPick={setUpscaling} onQueued={queued} />
          ) : space === 'write' ? (
            <WriteSettings models={registry.models} defaultText={registry.default_text} />
          ) : (
            <MediaSettings
              key={`${space}-${handoff?.space === space ? handoff.n : 0}`}
              kind={kind as 'image' | 'video' | 'audio'}
              models={registry.models}
              board={board}
              initialRefs={handoff?.space === space ? handoff.refs : []}
              onQueued={queued}
            />
          )}
        </aside>

        <section className="flex min-h-[420px] min-w-0 flex-col overflow-hidden rounded-xl border border-line bg-panel">
          {space === 'edit' ? (
            <EditCenter target={editing} onPick={setEditing} results={mine} editApi={editApi} onState={setEditState} onOpen={(a) => setEditing(a)} />
          ) : space === 'upscale' ? (
            <UpscaleCenter target={upscaling} results={mine} onPick={setUpscaling} />
          ) : space === 'write' ? (
            <WriteCenter feed={mine} models={registry.models} onRetry={retry} onPost={(g) => setPost({ format: 'text', assets: [], caption: g.output_text ?? '', label: g.model_label })} />
          ) : (
            <Preview
              kind={kind}
              feed={mine}
              selected={selected}
              onSelect={setSelected}
              models={registry.models}
              boards={boards?.data ?? []}
              onRetry={retry}
              onEdit={edit}
              onUpscale={upscale}
              onAnimate={animate}
              onReference={reference}
              onPost={(a) => setPost({ format: a.kind === 'video' ? 'video' : 'image', assets: [a], caption: `Made in Creative Lab`, label: a.name ?? 'Creative Lab' })}
            />
          )}
        </section>

        <aside className="flex h-[460px] min-h-0 flex-col overflow-hidden rounded-xl border border-line bg-panel lg:col-span-2 xl:col-span-1 xl:h-auto">
          <GalleryPanel boards={boards ?? null} view={view} onView={setView} selectedId={space === 'edit' ? editing?.id : space === 'upscale' ? upscaling?.id : selected?.id} onPick={pick} queue={all} models={registry.models} onRetry={retry} />
        </aside>
      </div>
      )}

      <PublishPost source={post} onClose={() => setPost(null)} />
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Settings                                                             */
/* ------------------------------------------------------------------ */

const FALLBACK_RATIOS = ['1:1', '4:5', '9:16', '16:9']
const TEMPLATES = {
  image: [
    ['Product launch', 'Premium product campaign image, editorial lighting, clear hero composition'],
    ['UGC look', 'Authentic creator-style phone photo, natural light, relatable setting'],
    ['Ad creative', 'High-converting paid social creative with generous clean space for copy'],
  ],
  video: [
    ['Hook first', 'Start with a scroll-stopping visual hook in the first second, then reveal the product'],
    ['Product demo', 'Show a clear satisfying product demonstration with close-up details'],
    ['Lifestyle story', 'Warm aspirational lifestyle moment with a natural camera move'],
  ],
} as const
const SPEECH_FORMATS: Record<string, string> = { mp3: 'MP3', wav: 'WAV' }

function Section({ title, children, open: initial = true, badge }: { title: string; children: ReactNode; open?: boolean; badge?: ReactNode }) {
  const [open, setOpen] = useState(initial)
  return (
    <div className="border-t border-line">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center gap-2 px-4 py-2.5 text-left">
        <ChevronDown className={cn('size-3.5 text-dim transition-transform', !open && '-rotate-90')} />
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted">{title}</span>
        {badge && <span className="ml-auto font-mono text-[9.5px] text-dim">{badge}</span>}
      </button>
      {open && <div className="space-y-3.5 px-4 pb-4">{children}</div>}
    </div>
  )
}

function useModel(models: ModelInfo[], kind: ModelInfo['kind'], filter: (m: ModelInfo) => boolean = () => true) {
  const usable = models.filter((m) => m.kind === kind && filter(m))
  const [remembered, remember] = useRemembered<string | null>(`flowai.lab.model.${kind}`, null)
  const id = usable.some((m) => m.id === remembered) ? remembered : (usable.find((m) => m.available)?.id ?? usable[0]?.id ?? null)
  return { usable, id, current: usable.find((m) => m.id === id), set: remember }
}

/** Compose, Video and Voice: the model, the prompt or script, and what the model can be told. */
function MediaSettings({ kind, models, board, initialRefs, onQueued }: { kind: 'image' | 'video' | 'audio'; models: ModelInfo[]; board: number | null; initialRefs: Asset[]; onQueued: () => void }) {
  const incoming = useQueryParam('prompt')
  const invalidate = useInvalidate()
  // Upscalers have their own space; here they'd only refuse the prompt.
  const { id: model, current, set: setModel } = useModel(models, kind, (m) => !m.capabilities.upscale)
  const caps = current?.capabilities ?? {}
  const [prompt, setPrompt] = useState(incoming ?? '')
  const [negative, setNegative] = useState('')
  const [template, setTemplate] = useState('')
  const [ratio, setRatio] = useState(kind === 'video' ? '9:16' : '4:5')
  const [duration, setDuration] = useState(8)
  const [resolution, setResolution] = useState<string | null>(null)
  const [audio, setAudio] = useState(true)
  const [seed, setSeed] = useState('')
  const [steps, setSteps] = useState<number | null>(null)
  const [guidance, setGuidance] = useState<number | null>(null)
  const [variations, setVariations] = useState(1)
  const [refs, setRefs] = useState<Asset[]>(initialRefs)
  const [picking, setPicking] = useState(false)
  const [voice, setVoice] = useState<string | null>(null)
  const [speed, setSpeed] = useState(1)
  const [fileType, setFileType] = useState('mp3')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const ratios = (caps.aspect_ratios?.length ? caps.aspect_ratios : FALLBACK_RATIOS).map((value) => ({ value, label: value }))
  const durations = caps.durations?.length ? caps.durations : [5, 8, 10]
  const resolutions = caps.resolutions ?? []
  const maxInputs = caps.max_inputs ?? (kind === 'video' ? 1 : 0)
  const maxOutputs = Math.min(caps.max_outputs ?? 1, 4)
  const voices = caps.voices ?? []
  const pickedVoice = voices.some((v) => v.id === voice) ? voice : (voices[0]?.id ?? null)
  const speeds = caps.speeds?.length ? caps.speeds : [1]
  const fileTypes = caps.formats?.length ? caps.formats : ['mp3']

  const go = async () => {
    if (!prompt.trim()) return setError(kind === 'audio' ? 'Write the script to read.' : 'Describe what you want.')
    if (caps.requires_image && !refs[0]) return setError('Pick the image the video starts from.')
    setBusy(true)
    setError(null)
    try {
      if (kind === 'audio') {
        await runMedia({
          kind,
          model,
          board_id: board,
          prompt: prompt.trim(),
          params: { ...(pickedVoice ? { voice: pickedVoice } : {}), speed: speeds.includes(speed) ? speed : 1, format: fileTypes.includes(fileType) ? fileType : fileTypes[0] },
        })
      } else {
        // Models without a negative prompt get "what to avoid" written into the prompt instead.
        const avoid = negative.trim()
        const text = [template, prompt.trim(), avoid && !caps.negative_prompt ? `Avoid: ${avoid}.` : ''].filter(Boolean).join('. ')
        await runMedia({
          kind,
          model,
          board_id: board,
          prompt: text,
          params: {
            ...(caps.aspect_ratios?.length !== 0 ? { aspect_ratio: ratios.some((r) => r.value === ratio) ? ratio : ratios[0].value } : {}),
            ...(kind === 'video' ? { duration: durations.includes(duration) ? duration : durations[0] } : {}),
            ...(resolution && resolutions.includes(resolution) ? { resolution } : {}),
            ...(caps.audio && !caps.audio_always_on ? { audio } : {}),
            ...(seed ? { seed: Number(seed) } : {}),
            ...(caps.steps !== undefined && steps !== null ? { steps } : {}),
            ...(caps.guidance !== undefined && guidance !== null ? { guidance } : {}),
            ...(kind === 'image' && variations > 1 ? { batch_size: variations } : {}),
            ...(avoid ? { negative_prompt: avoid } : {}),
          },
          input_asset_ids: refs.length ? refs.slice(0, maxInputs).map((a) => a.id) : undefined,
        })
      }
      onQueued()
      invalidate()
    } catch (e) {
      setError(messageFor(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-full flex-col">
      <div className="space-y-3.5 p-4">
        <div>
          <Label>Model</Label>
          <ModelPicker models={models.filter((m) => !m.capabilities.upscale)} kind={kind} value={model} onChange={setModel} className="mt-2" />
          {current && !current.available && <p className="mt-1.5 text-[11.5px] text-warn">{current.reason}</p>}
          {current?.available && current.purpose && <p className="mt-1.5 text-[11px] leading-snug text-dim">{current.purpose}</p>}
        </div>

        <label className="block">
          <span className="flex items-center justify-between">
            <Label>{kind === 'video' ? 'Prompt & motion' : kind === 'audio' ? 'Script' : 'Prompt'}</Label>
            {kind === 'audio' && <span className="font-mono text-[10px] text-dim">{prompt.length} / 4000</span>}
          </span>
          <textarea
            value={prompt}
            onChange={(e) => {
              setPrompt(e.target.value)
              setError(null)
            }}
            onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === 'Enter' && go()}
            rows={kind === 'audio' ? 7 : 5}
            maxLength={4000}
            placeholder={
              kind === 'image'
                ? 'An amber candle jar on folded linen, soft morning window light, shallow depth of field…'
                : kind === 'audio'
                  ? 'Slow mornings start here. Fresh bread, warm coffee, and a seat by the window…'
                  : 'Slow dolly in, the flame flickers, steam rises from a cup beside it…'
            }
            className={cn(inputClass, 'mt-2 h-auto resize-y py-2.5 leading-snug')}
          />
        </label>

        {kind !== 'audio' && (
          <>
            <div className="flex flex-wrap gap-1.5">
              {TEMPLATES[kind].map(([label, direction]) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => setTemplate(template === direction ? '' : direction)}
                  aria-pressed={template === direction}
                  className={cn('rounded-full border px-2.5 py-1 text-[11px] transition-colors', template === direction ? 'border-accent/50 bg-accent/[0.1] text-fg' : 'border-line text-dim hover:text-muted')}
                >
                  {label}
                </button>
              ))}
            </div>
            <label className="block">
              <Label>{caps.negative_prompt ? 'Negative prompt' : 'What to avoid'} <span className="normal-case text-dim">optional</span></Label>
              <input value={negative} onChange={(e) => setNegative(e.target.value)} placeholder="Blurry text, distorted logo, cluttered background…" className={cn(inputClass, 'mt-2')} />
              {caps.negative_prompt && caps.guidance !== undefined && (guidance ?? caps.guidance) <= 1 && <span className="mt-1 block text-[10.5px] text-dim">Used only when guidance is above 1.</span>}
            </label>
          </>
        )}
      </div>

      {maxInputs > 0 && (
        <Section title={kind === 'video' ? 'Start & end frames' : 'References'} badge={refs.length ? `${refs.length}/${maxInputs}` : undefined}>
          <button
            type="button"
            onClick={() => setPicking(true)}
            className="flex w-full items-center gap-3 rounded-md border border-dashed border-line-2 p-2 text-left text-[12px] text-muted transition-colors hover:border-accent-soft/60 hover:text-fg"
          >
            {refs[0] ? <MediaThumb asset={refs[0]} className="size-11" /> : <ImagePlus className="m-2.5 size-5" strokeWidth={1.5} />}
            {refs.length ? `${refs.length} image${refs.length > 1 ? 's' : ''}${caps.end_frame && refs[1] ? ' · with an end frame' : ''}` : caps.requires_image ? 'Pick the starting image' : 'Optional: add from the gallery'}
          </button>
          {refs.length > 0 && (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {refs.map((asset, i) => (
                <span key={asset.id} className="group relative shrink-0">
                  <MediaThumb asset={asset} className="size-14" />
                  <span className="absolute bottom-0 left-0 rounded-tr bg-black/70 px-1 py-0.5 font-mono text-[8px] text-white">{caps.end_frame && i === 1 ? 'END' : i === 0 && kind === 'video' ? 'START' : `REF ${i + 1}`}</span>
                  <button type="button" aria-label="Remove" onClick={() => setRefs((r) => r.filter((x) => x.id !== asset.id))} className="absolute -right-1 -top-1 grid size-4 place-items-center rounded-full border border-line bg-panel text-dim opacity-0 transition-opacity hover:text-fg group-hover:opacity-100">
                    <X className="size-2.5" />
                  </button>
                </span>
              ))}
            </div>
          )}
          <MediaPicker open={picking} onClose={() => setPicking(false)} onPick={(a) => setRefs(a.filter((x) => x.kind === 'image').slice(0, maxInputs))} max={maxInputs} initial={refs} />
        </Section>
      )}

      {kind === 'audio' ? (
        <Section title="Voice">
          <label className="block">
            <Label>Voice</Label>
            <select value={pickedVoice ?? ''} onChange={(e) => setVoice(e.target.value)} disabled={!voices.length} className={cn(inputClass, 'mt-2')}>
              {voices.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                  {v.language ? ` · ${v.language}` : ''}
                </option>
              ))}
            </select>
            {current?.available && voices.length === 1 && <span className="mt-1.5 block text-[11px] text-dim">This model reads in its own voice; your cloned voices are on OmniVoice.</span>}
          </label>
          {speeds.length > 1 && (
            <div>
              <Label>Pace</Label>
              <Segmented id="speed" label="Speed" options={speeds.map((v) => ({ value: v, label: `${v}×` }))} value={speeds.includes(speed) ? speed : 1} onChange={setSpeed} className="mt-2 w-fit" />
            </div>
          )}
          {fileTypes.length > 1 && (
            <div>
              <Label>File</Label>
              <Segmented id="file-type" label="File type" options={fileTypes.map((v) => ({ value: v, label: SPEECH_FORMATS[v] ?? v.toUpperCase() }))} value={fileTypes.includes(fileType) ? fileType : fileTypes[0]} onChange={setFileType} className="mt-2 w-fit" />
            </div>
          )}
        </Section>
      ) : (
        <Section title="Size" badge={ratio}>
          {caps.aspect_ratios?.length !== 0 && (
            <div>
              <Label>{kind === 'video' ? 'Format' : 'Shape'}</Label>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {ratios.map((r) => (
                  <RatioChip key={r.value} ratio={r.value} active={(ratios.some((x) => x.value === ratio) ? ratio : ratios[0].value) === r.value} onClick={() => setRatio(r.value)} />
                ))}
              </div>
            </div>
          )}
          {kind === 'video' && (
            <div>
              <Label>Length</Label>
              <Segmented id="duration" label="Duration" options={durations.map((v) => ({ value: v, label: `${v} s` }))} value={durations.includes(duration) ? duration : durations[0]} onChange={setDuration} className="mt-2 w-fit" />
            </div>
          )}
          {resolutions.length > 0 && (
            <div>
              <Label>Resolution</Label>
              <Segmented id="resolution" label="Resolution" options={resolutions.map((value) => ({ value, label: value.toUpperCase() }))} value={resolution && resolutions.includes(resolution) ? resolution : (caps.default_resolution ?? resolutions[0])} onChange={setResolution} className="mt-2 w-fit" />
            </div>
          )}
          {caps.audio && !caps.audio_always_on && (
            <label className="flex items-center justify-between rounded-md border border-line px-3 py-2 text-[12px]">
              <span>Generate sound</span>
              <input type="checkbox" checked={audio} onChange={(e) => setAudio(e.target.checked)} />
            </label>
          )}
        </Section>
      )}

      {kind !== 'audio' && (caps.seed || caps.steps !== undefined || maxOutputs > 1) && (
        <Section title="Render" open={false} badge={[caps.steps !== undefined ? `${steps ?? caps.steps} steps` : null, caps.guidance !== undefined ? `CFG ${guidance ?? caps.guidance}` : null, seed ? `seed ${seed}` : 'random'].filter(Boolean).join(' · ')}>
          {caps.steps !== undefined && (
            <Slider label="Steps" min={1} max={50} step={1} value={steps ?? caps.steps} onChange={setSteps} />
          )}
          {caps.guidance !== undefined && (
            <Slider label="Guidance (CFG)" min={1} max={12} step={0.5} value={guidance ?? caps.guidance} onChange={setGuidance} />
          )}
          {caps.seed && (
            <label className="block">
              <Label>Seed</Label>
              <input value={seed} onChange={(e) => setSeed(e.target.value.replace(/\D/g, '').slice(0, 9))} placeholder="Random" inputMode="numeric" className={cn(inputClass, 'mt-2')} />
            </label>
          )}
          {kind === 'image' && maxOutputs > 1 && (
            <div>
              <Label>Variations</Label>
              <Segmented id="variations" label="Variations" options={Array.from({ length: maxOutputs }, (_, i) => ({ value: i + 1, label: `${i + 1}` }))} value={variations} onChange={setVariations} className="mt-2 w-fit" />
            </div>
          )}
        </Section>
      )}

      <div className="sticky bottom-0 mt-auto border-t border-line bg-panel p-4">
        <FieldError message={error} />
        <Btn variant="primary" icon={Sparkles} onClick={go} loading={busy} disabled={!current?.available} className="w-full">
          {{ image: variations > 1 ? `Make ${variations} images` : 'Make the image', video: 'Make the video', audio: 'Make the voiceover' }[kind]}
        </Btn>
        <p className="mt-1.5 text-center font-mono text-[9.5px] text-dim">Ctrl + Enter</p>
      </div>
    </div>
  )
}

function RatioChip({ ratio, active, onClick }: { ratio: string; active: boolean; onClick: () => void }) {
  const [w, h] = ratio.split(':').map(Number)
  const scale = 14 / Math.max(w, h)
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn('flex h-8 items-center gap-1.5 rounded-md border px-2 text-[11px] transition-colors', active ? 'border-accent/50 bg-accent/[0.1] text-fg' : 'border-line text-dim hover:text-muted')}
    >
      <span className="rounded-[2px] border border-current" style={{ width: w * scale, height: h * scale }} />
      {ratio}
    </button>
  )
}

function Slider({ label, min, max, step, value, onChange, format }: { label: string; min: number; max: number; step: number; value: number; onChange: (v: number) => void; format?: (v: number) => string }) {
  return (
    <label className="block">
      <span className="flex items-center justify-between">
        <Label>{label}</Label>
        <span className="font-mono text-[10.5px] text-muted">{format ? format(value) : value}</span>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="mt-2 w-full accent-[var(--color-accent)]" />
    </label>
  )
}

/** Edit: what should appear in the painted area, and how far the model may stray. */
function EditSettings({ models, target, board, editApi, state, onQueued }: { models: ModelInfo[]; target: Asset | null; board: number | null; editApi: RefObject<EditApi | null>; state: { painted: boolean; extended: boolean }; onQueued: () => void }) {
  const invalidate = useInvalidate()
  const { usable, id: model, current, set: setModel } = useModel(models, 'image', (m) => !!m.capabilities.edit)
  const [prompt, setPrompt] = useState('')
  const [strength, setStrength] = useState(0.85)
  const [seed, setSeed] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ready = !!target && (state.painted || state.extended)

  const go = async () => {
    const out = editApi.current?.export()
    if (!target || !out) return setError('Paint over what to change, or extend the frame.')
    if (!prompt.trim()) return setError('Say what should be there.')
    setBusy(true)
    setError(null)
    try {
      await runMedia({
        kind: 'image',
        model,
        board_id: board,
        prompt: prompt.trim(),
        params: { mode: out.mode, strength, ...(seed ? { seed: Number(seed) } : {}) },
        image: out.image,
        mask: out.mask,
      })
      onQueued()
      invalidate()
    } catch (e) {
      setError(e instanceof ApiError ? messageFor(e) : 'Couldn’t send the edit.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-full flex-col">
      <div className="space-y-3.5 p-4">
        <div>
          <Label>Model</Label>
          <ModelPicker models={usable} kind="image" value={model} onChange={setModel} className="mt-2" />
          {!usable.length && <p className="mt-1.5 text-[11.5px] text-warn">No model that can repaint part of an image is set up. Connect InvokeAI under Models.</p>}
          {current && !current.available && <p className="mt-1.5 text-[11.5px] text-warn">{current.reason}</p>}
        </div>
        <div className="rounded-lg border border-line bg-white/[0.015] p-3 text-[11.5px] leading-relaxed text-muted">
          <p>
            <span className="text-fg">Paint</span> over what should change: the rest of the image stays as it is.
          </p>
          <p className="mt-1">
            <span className="text-fg">Extend</span> with the arrows to add room around it; the new space is filled to match.
          </p>
        </div>
        <label className="block">
          <Label>{state.extended && !state.painted ? 'What the new space shows' : 'What should be there'}</Label>
          <textarea
            value={prompt}
            onChange={(e) => {
              setPrompt(e.target.value)
              setError(null)
            }}
            onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === 'Enter' && go()}
            rows={4}
            placeholder="A croissant on a white plate, same light as the rest of the photo"
            className={cn(inputClass, 'mt-2 h-auto resize-y py-2.5 leading-snug')}
          />
        </label>
      </div>
      <Section title="Render" badge={`${Math.round(strength * 100)}%`}>
        <Slider label="How much it may change" min={0.3} max={1} step={0.05} value={strength} onChange={setStrength} format={(v) => `${Math.round(v * 100)}%`} />
        <p className="-mt-1.5 text-[10.5px] leading-snug text-dim">Lower keeps the painted area’s shapes and colours; 100% replaces it outright.</p>
        <label className="block">
          <Label>Seed</Label>
          <input value={seed} onChange={(e) => setSeed(e.target.value.replace(/\D/g, '').slice(0, 9))} placeholder="Random" inputMode="numeric" className={cn(inputClass, 'mt-2')} />
        </label>
      </Section>
      <div className="sticky bottom-0 mt-auto border-t border-line bg-panel p-4">
        <FieldError message={error} />
        <Btn variant="primary" icon={Wand2} onClick={go} loading={busy} disabled={!current?.available || !ready} className="w-full">
          {state.extended && !state.painted ? 'Fill the new space' : 'Regenerate the painted area'}
        </Btn>
        <p className="mt-1.5 text-center text-[10.5px] text-dim">{!target ? 'Pick an image to edit.' : !ready ? 'Paint over something first.' : 'Ctrl + Enter'}</p>
      </div>
    </div>
  )
}

/** Write: text, streamed into the middle as it's written. */
function WriteSettings({ models, defaultText }: { models: ModelInfo[]; defaultText: string }) {
  const incoming = useQueryParam('prompt')
  const invalidate = useInvalidate()
  const [model, setModel] = useState<string | null>(defaultText)
  const [prompt, setPrompt] = useState(incoming ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const current = models.find((m) => m.id === model)

  const go = async () => {
    if (!prompt.trim()) return setError('Describe what you want.')
    setBusy(true)
    setError(null)
    try {
      await runText({ prompt, model }, (text) => window.dispatchEvent(new CustomEvent('flowai:writing', { detail: text })))
      setPrompt('')
    } catch (e) {
      setError(messageFor(e))
    } finally {
      window.dispatchEvent(new CustomEvent('flowai:writing', { detail: null }))
      setBusy(false)
      invalidate()
    }
  }

  return (
    <div className="flex min-h-full flex-col">
      <div className="space-y-3.5 p-4">
        <div>
          <Label>Model</Label>
          <ModelPicker models={models} kind="text" value={model} onChange={setModel} className="mt-2" />
          {current && !current.available && <p className="mt-1.5 text-[11.5px] text-warn">{current.reason}</p>}
        </div>
        <label className="block">
          <Label>What to write</Label>
          <textarea
            value={prompt}
            onChange={(e) => {
              setPrompt(e.target.value)
              setError(null)
            }}
            onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === 'Enter' && go()}
            rows={8}
            placeholder="Five hooks for an autumn candle launch, warm and unhurried…"
            className={cn(inputClass, 'mt-2 h-auto resize-y py-2.5 leading-snug')}
          />
        </label>
      </div>
      <div className="sticky bottom-0 mt-auto border-t border-line bg-panel p-4">
        <FieldError message={error} />
        <Btn variant="primary" icon={Sparkles} onClick={go} loading={busy} disabled={!current?.available} className="w-full">
          Write
        </Btn>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* The middle                                                           */
/* ------------------------------------------------------------------ */

function Elapsed({ from }: { from: string }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [])
  const s = Math.max(0, Math.round((now - Date.parse(from)) / 1000))
  return <>{s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`}</>
}

/** One file, large, with what can be done with it; a filmstrip of recent results below. */
function Preview({
  kind,
  feed,
  selected,
  onSelect,
  models,
  boards,
  onRetry,
  onEdit,
  onUpscale,
  onAnimate,
  onReference,
  onPost,
}: {
  kind: Generation['kind']
  feed: Generation[]
  selected: Asset | null
  onSelect: (a: Asset | null) => void
  models: ModelInfo[]
  boards: Board[]
  onRetry: (g: Generation, change: { model?: string; prompt?: string }) => Promise<void>
  onEdit: (a: Asset) => void
  onUpscale: (a: Asset) => void
  onAnimate: (a: Asset) => void
  onReference: (a: Asset) => void
  onPost: (a: Asset) => void
}) {
  const invalidate = useInvalidate()
  const toast = useToast()
  const latest = feed[0]
  const asset = selected ?? (latest && !working(latest) && latest.status === 'succeeded' ? latest.outputs[0] : null)
  const showing = selected ? null : latest && (working(latest) || latest.status === 'failed') ? latest : null
  const strip = feed.flatMap((g) => (working(g) ? [{ g, a: null as Asset | null }] : g.outputs.map((a) => ({ g, a })))).slice(0, 30)
  const KindIcon = KIND_ICON[kind]

  const move = async (a: Asset, board: string) => {
    try {
      await api('/assets/board', { method: 'POST', body: { ids: [a.id], board_id: board === '' ? null : Number(board) } })
      onSelect({ ...a, board_id: board === '' ? null : Number(board) })
      invalidate()
      toast(board === '' ? 'Taken off its board.' : `Moved to ${boards.find((b) => b.id === Number(board))?.name}.`)
    } catch (e) {
      toast(messageFor(e), 'error')
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="relative grid min-h-0 flex-1 place-items-center overflow-hidden bg-[radial-gradient(circle_at_center,rgb(255_255_255_/_0.03)_1px,transparent_1px)] bg-[length:18px_18px] p-4">
        {showing ? (
          working(showing) ? (
            <div className="flex flex-col items-center gap-3 text-center">
              <div className={cn('skeleton rounded-lg', kind === 'audio' ? 'h-14 w-[min(520px,80%)]' : 'aspect-square w-[min(380px,60vw)]')} />
              <p className="flex items-center gap-2 font-mono text-[11px] text-accent-soft">
                <LoaderCircle className="size-3 animate-spin" />
                {showing.status === 'queued' ? 'Queued' : `Making with ${showing.model_label}`} · <Elapsed from={showing.started_at ?? showing.created_at} />
              </p>
              <p className="max-w-[52ch] text-[12px] text-dim">{showing.prompt}</p>
            </div>
          ) : (
            <div className="w-[min(560px,100%)]">
              <GenerationCard generation={showing} models={models} onRetry={onRetry} />
            </div>
          )
        ) : asset ? (
          asset.kind === 'video' ? (
            <video key={asset.id} src={asset.url} poster={asset.poster_url ?? undefined} controls playsInline className="max-h-full max-w-full rounded-lg bg-black" />
          ) : asset.kind === 'audio' ? (
            <div className="flex w-[min(560px,100%)] flex-col items-center gap-5">
              <AudioLines className="size-12 text-accent-soft" strokeWidth={1.25} />
              {asset.script && <p className="text-center text-[13px] leading-relaxed text-muted">{asset.script}</p>}
              <audio key={asset.id} src={asset.url} controls className="w-full" />
            </div>
          ) : (
            <img key={asset.id} src={asset.url} alt={asset.name ?? ''} draggable={false} className="max-h-full max-w-full rounded-lg object-contain shadow-[0_24px_70px_-30px_rgb(0_0_0)]" />
          )
        ) : (
          <EmptyState icon={KindIcon} title="Nothing here yet" body="Write a prompt on the left and make something. Results land in the gallery on the right." />
        )}
      </div>

      {asset && !showing && (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-line px-3 py-2">
          <span className="mr-auto min-w-0 truncate text-[11.5px] text-dim">{asset.name}</span>
          {asset.kind === 'image' && (
            <>
              <Btn size="sm" variant="subtle" icon={Layers} onClick={() => onEdit(asset)}>
                Edit
              </Btn>
              <Btn size="sm" variant="subtle" icon={Maximize2} onClick={() => onUpscale(asset)}>
                Upscale
              </Btn>
              <Btn size="sm" variant="subtle" icon={Clapperboard} onClick={() => onAnimate(asset)}>
                Animate
              </Btn>
              <Btn size="sm" variant="subtle" icon={ImagePlus} onClick={() => onReference(asset)}>
                Use as reference
              </Btn>
            </>
          )}
          {asset.kind !== 'audio' && (
            <Btn size="sm" variant="subtle" icon={CalendarClock} onClick={() => onPost(asset)}>
              Post
            </Btn>
          )}
          <select value={asset.board_id ?? ''} onChange={(e) => move(asset, e.target.value)} className="h-8 rounded-md border border-line bg-panel px-2 text-[11.5px] text-muted" aria-label="Board">
            <option value="">No board</option>
            {boards.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          <a href={asset.url} download={asset.name ?? undefined} className="grid size-8 place-items-center rounded-md text-muted hover:bg-white/[0.06] hover:text-fg" aria-label="Download" title="Download">
            <Download className="size-4" strokeWidth={1.75} />
          </a>
        </div>
      )}

      {strip.length > 0 && (
        <div className="flex gap-1.5 overflow-x-auto border-t border-line p-2" data-lenis-prevent>
          {strip.map(({ g, a }) =>
            a ? (
              <button key={a.id} type="button" onClick={() => onSelect(a)} className="shrink-0" title={g.prompt}>
                <MediaThumb asset={a} className={cn('size-14 transition-[box-shadow]', asset?.id === a.id ? 'ring-2 ring-accent' : 'hover:ring-2 hover:ring-line-2')} />
              </button>
            ) : (
              <button key={`g${g.id}`} type="button" onClick={() => onSelect(null)} className="skeleton grid size-14 shrink-0 place-items-center rounded-md" title={g.prompt}>
                <LoaderCircle className="size-4 animate-spin text-accent-soft" />
              </button>
            ),
          )}
        </div>
      )}
    </div>
  )
}

/** Edit: the canvas, or a way to pick what to edit; finished edits below to keep going from. */
function EditCenter({ target, onPick, results, editApi, onState, onOpen }: { target: Asset | null; onPick: (a: Asset) => void; results: Generation[]; editApi: RefObject<EditApi | null>; onState: (s: { painted: boolean; extended: boolean }) => void; onOpen: (a: Asset) => void }) {
  const [picking, setPicking] = useState(false)
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {target ? (
        <EditCanvas key={target.id} asset={target} apiRef={editApi} onState={onState} />
      ) : (
        <div className="grid flex-1 place-items-center p-6">
          <EmptyState
            icon={Layers}
            title="Pick an image to edit"
            body="Click one in the gallery, or choose it here. Then paint over what should change."
            action={
              <Btn variant="primary" icon={ImagePlus} onClick={() => setPicking(true)}>
                Choose an image
              </Btn>
            }
          />
        </div>
      )}
      {results.length > 0 && (
        <div className="flex items-center gap-1.5 overflow-x-auto border-t border-line p-2" data-lenis-prevent>
          <span className="shrink-0 px-1 font-mono text-[9.5px] uppercase tracking-[0.14em] text-dim">Edits</span>
          {results.slice(0, 20).map((g) =>
            working(g) ? (
              <span key={g.id} className="skeleton grid size-14 shrink-0 place-items-center rounded-md" title={g.prompt}>
                <LoaderCircle className="size-4 animate-spin text-accent-soft" />
              </span>
            ) : g.status === 'failed' ? (
              <span key={g.id} className="grid size-14 shrink-0 place-items-center rounded-md border border-fail/40 px-1 text-center text-[9px] leading-tight text-fail" title={g.error ?? ''}>
                Failed
              </span>
            ) : (
              g.outputs.map((a) => (
                <button key={a.id} type="button" onClick={() => onOpen(a)} className="shrink-0" title={`${g.prompt} — click to keep editing this one`}>
                  <MediaThumb asset={a} className={cn('size-14', target?.id === a.id ? 'ring-2 ring-accent' : 'hover:ring-2 hover:ring-line-2')} />
                </button>
              ))
            ),
          )}
        </div>
      )}
      {results[0]?.status === 'failed' && <p className="border-t border-fail/25 bg-fail/[0.06] px-3 py-2 text-[11.5px] text-fg">{results[0].error}</p>}
      <MediaPicker open={picking} onClose={() => setPicking(false)} onPick={(a) => a.find((x) => x.kind === 'image') && onPick(a.find((x) => x.kind === 'image')!)} max={1} initial={[]} />
    </div>
  )
}

/** Write: what's being written now, then earlier drafts. */
function WriteCenter({ feed, models, onRetry, onPost }: { feed: Generation[]; models: ModelInfo[]; onRetry: (g: Generation, change: { model?: string; prompt?: string }) => Promise<void>; onPost: (g: Generation) => void }) {
  const [streaming, setStreaming] = useState<string | null>(null)
  useEffect(() => {
    const on = (e: Event) => setStreaming((e as CustomEvent<string | null>).detail)
    window.addEventListener('flowai:writing', on)
    return () => window.removeEventListener('flowai:writing', on)
  }, [])
  return (
    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4" data-lenis-prevent>
      <AnimatePresence>
        {streaming !== null && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.3, ease }} className="rounded-xl border border-accent/30 bg-panel-2 p-4">
            <p className="font-mono text-[10.5px] text-accent-soft">Writing…</p>
            <p className="mt-2 whitespace-pre-wrap text-[13.5px] leading-relaxed">{streaming || ' '}</p>
          </motion.div>
        )}
      </AnimatePresence>
      {feed.length === 0 && streaming === null ? (
        <EmptyState icon={PenLine} title="Nothing written yet" body="Captions, hooks, scripts and ideas appear here as they’re written." />
      ) : (
        feed.map((g) => (
          <GenerationCard
            key={g.id}
            generation={g}
            models={models}
            onRetry={onRetry}
            actions={
              g.status === 'succeeded' && (
                <Btn size="sm" variant="subtle" icon={CalendarClock} onClick={() => onPost(g)}>
                  Create & schedule
                </Btn>
              )
            }
          />
        ))
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Gallery and queue                                                    */
/* ------------------------------------------------------------------ */

type GalleryKind = 'all' | 'image' | 'video' | 'audio'

function GalleryPanel({
  boards,
  view,
  onView,
  selectedId,
  onPick,
  queue,
  models,
  onRetry,
}: {
  boards: Boards | null
  view: View
  onView: (v: View) => void
  selectedId: number | undefined
  onPick: (a: Asset) => void
  queue: Generation[]
  models: ModelInfo[]
  onRetry: (g: Generation, change: { model?: string; prompt?: string }) => Promise<void>
}) {
  const [tab, setTab] = useState<'gallery' | 'queue'>('gallery')
  const [kind, setKind] = useState<GalleryKind>('all')
  const [naming, setNaming] = useState<number | 'new' | null>(null)
  const [name, setName] = useState('')
  const [progress, setProgress] = useState<number | null>(null)
  const file = useRef<HTMLInputElement>(null)
  const invalidate = useInvalidate()
  const toast = useToast()
  const query = useMemo(() => ({ ...(view === 'all' ? {} : { board: String(view) }), ...(kind === 'all' ? {} : { kind }) }), [view, kind])
  const { data: assets } = useApi<Page<Asset>>('/assets', query)
  const list = boards?.data ?? []
  const active = queue.filter(working).length
  const target = typeof view === 'number' ? list.find((b) => b.id === view)?.name : null

  const save = async () => {
    const n = name.trim()
    if (!n) return setNaming(null)
    try {
      if (naming === 'new') {
        const b = await api<Board>('/boards', { method: 'POST', body: { name: n } })
        onView(b.id)
      } else if (typeof naming === 'number') {
        await api(`/boards/${naming}`, { method: 'PATCH', body: { name: n } })
      }
      setNaming(null)
      setName('')
      invalidate()
    } catch (e) {
      toast(messageFor(e), 'error')
    }
  }
  const remove = async (b: Board) => {
    if (!window.confirm(`Delete the board “${b.name}”? Its ${b.count} files stay in the library, on no board.`)) return
    await api(`/boards/${b.id}`, { method: 'DELETE' })
    if (view === b.id) onView('all')
    invalidate()
  }
  const upload = async (files: File[]) => {
    if (!files.length) return
    setProgress(0)
    try {
      await uploadFiles<Asset[]>(`/assets${typeof view === 'number' ? `?board_id=${view}` : ''}`, files, setProgress)
      invalidate()
    } catch (e) {
      toast(e instanceof ApiError ? (Object.values(e.errors)[0]?.[0] ?? e.message) : 'The upload didn’t go through.', 'error')
    } finally {
      setProgress(null)
    }
  }

  const row = (key: string, label: ReactNode, count: number | undefined, v: View, cover?: string | null, board?: Board) => (
    <div key={key} className={cn('group flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors', view === v ? 'bg-accent/[0.12] text-fg' : 'text-muted hover:bg-white/[0.04]')}>
      <button type="button" onClick={() => onView(v)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
        <span className="grid size-7 shrink-0 place-items-center overflow-hidden rounded bg-white/[0.05]">
          {cover ? <img src={cover} alt="" className="size-full object-cover" /> : <ImageIcon className="size-3.5 text-dim" strokeWidth={1.5} />}
        </span>
        <span className="min-w-0 flex-1 truncate text-[12.5px]">{label}</span>
      </button>
      {board && (
        <span className="hidden gap-0.5 group-hover:flex">
          <button type="button" aria-label="Rename" onClick={() => (setNaming(board.id), setName(board.name))} className="grid size-6 place-items-center rounded text-dim hover:text-fg">
            <Pencil className="size-3" />
          </button>
          <button type="button" aria-label="Delete board" onClick={() => remove(board)} className="grid size-6 place-items-center rounded text-dim hover:text-fail">
            <Trash2 className="size-3" />
          </button>
        </span>
      )}
      {count !== undefined && <span className="font-mono text-[10px] text-dim">{count}</span>}
    </div>
  )

  return (
    <>
      <div className="flex items-center gap-1 border-b border-line p-1.5">
        {(['gallery', 'queue'] as const).map((t) => (
          <button key={t} type="button" onClick={() => setTab(t)} aria-pressed={tab === t} className={cn('flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md text-[12px] transition-colors', tab === t ? 'bg-white/[0.07] text-fg' : 'text-dim hover:text-fg')}>
            {t === 'gallery' ? 'Gallery' : 'Queue'}
            {t === 'queue' && active > 0 && <span className="rounded bg-accent/25 px-1.5 font-mono text-[10px] text-accent-soft">{active}</span>}
          </button>
        ))}
      </div>

      {tab === 'gallery' ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="max-h-[40%] shrink-0 overflow-y-auto border-b border-line p-1.5" data-lenis-prevent>
            <div className="flex items-center justify-between px-2 pb-1 pt-0.5">
              <span className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-dim">Boards</span>
              <button type="button" onClick={() => (setNaming('new'), setName(''))} className="grid size-6 place-items-center rounded text-dim hover:text-fg" aria-label="New board" title="New board">
                <FolderPlus className="size-3.5" />
              </button>
            </div>
            {row('all', 'All media', undefined, 'all')}
            {row('none', 'No board', boards?.unfiled, 'none')}
            {list.map((b) =>
              naming === b.id ? (
                <input key={b.id} autoFocus value={name} onChange={(e) => setName(e.target.value)} onBlur={save} onKeyDown={(e) => (e.key === 'Enter' ? save() : e.key === 'Escape' && setNaming(null))} className={cn(inputClass, 'my-0.5 h-8')} />
              ) : (
                row(String(b.id), b.name, b.count, b.id, b.cover_url, b)
              ),
            )}
            {naming === 'new' && (
              <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onBlur={save} onKeyDown={(e) => (e.key === 'Enter' ? save() : e.key === 'Escape' && setNaming(null))} placeholder="Board name" className={cn(inputClass, 'my-0.5 h-8')} />
            )}
          </div>
          <div className="flex items-center gap-1.5 px-2 pt-2">
            <select value={kind} onChange={(e) => setKind(e.target.value as GalleryKind)} className="h-7 rounded-md border border-line bg-panel px-1.5 text-[11px] text-muted" aria-label="Kind">
              <option value="all">Everything</option>
              <option value="image">Images</option>
              <option value="video">Videos</option>
              <option value="audio">Audio</option>
            </select>
            <span className="min-w-0 flex-1 truncate text-[10.5px] text-dim" title="Where new results go">
              {target ? `New results → ${target}` : 'New results → no board'}
            </span>
            <button type="button" onClick={() => file.current?.click()} disabled={progress !== null} className="grid size-7 place-items-center rounded-md text-dim hover:bg-white/[0.06] hover:text-fg" aria-label="Upload" title="Upload to this board">
              {progress !== null ? <LoaderCircle className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
            </button>
            <input ref={file} type="file" multiple hidden accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime,video/webm" onChange={(e) => (upload([...(e.target.files ?? [])]), (e.target.value = ''))} />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2" data-lenis-prevent>
            {!assets ? (
              <div className="grid grid-cols-3 gap-1.5">
                {Array.from({ length: 9 }, (_, i) => (
                  <div key={i} className="skeleton aspect-square rounded-md" />
                ))}
              </div>
            ) : assets.data.length === 0 ? (
              <p className="px-2 py-8 text-center text-[11.5px] leading-relaxed text-dim">Nothing on this board yet. Results you make while it’s selected land here.</p>
            ) : (
              <div className="grid grid-cols-3 gap-1.5">
                {assets.data.map((a) => (
                  <button key={a.id} type="button" onClick={() => onPick(a)} title={a.name ?? ''}>
                    <MediaThumb asset={a} className={cn('transition-[box-shadow]', selectedId === a.id ? 'ring-2 ring-accent' : 'hover:ring-2 hover:ring-line-2')} />
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : (
        <Queue queue={queue} models={models} onRetry={onRetry} onPick={onPick} />
      )}
    </>
  )
}

function Queue({ queue, models, onRetry, onPick }: { queue: Generation[]; models: ModelInfo[]; onRetry: (g: Generation, change: { model?: string; prompt?: string }) => Promise<void>; onPick: (a: Asset) => void }) {
  const counts = { active: queue.filter(working).length, done: queue.filter((g) => g.status === 'succeeded').length, failed: queue.filter((g) => g.status === 'failed').length }
  const [busy, setBusy] = useState<number | null>(null)
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid grid-cols-3 border-b border-line text-center">
        {(
          [
            ['Working', counts.active, 'text-accent-soft'],
            ['Done', counts.done, 'text-ok'],
            ['Failed', counts.failed, 'text-fail'],
          ] as const
        ).map(([label, n, tone]) => (
          <div key={label} className="py-2.5">
            <p className={cn('font-mono text-[17px]', n ? tone : 'text-dim')}>{n}</p>
            <p className="text-[10.5px] text-dim">{label}</p>
          </div>
        ))}
      </div>
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-1.5" data-lenis-prevent>
        {queue.length === 0 && <p className="px-2 py-8 text-center text-[11.5px] text-dim">Nothing made yet.</p>}
        {queue.map((g) => {
          const Icon = KIND_ICON[g.kind]
          return (
            <div key={g.id} className={cn('rounded-md border px-2.5 py-2', g.status === 'failed' ? 'border-fail/30' : working(g) ? 'border-accent/30' : 'border-line')}>
              <button type="button" onClick={() => g.outputs[0] && onPick(g.outputs[0])} className="flex w-full items-center gap-2 text-left">
                {g.outputs[0] ? <MediaThumb asset={g.outputs[0]} className="size-8 shrink-0" /> : <span className="grid size-8 shrink-0 place-items-center rounded bg-white/[0.04]">{working(g) ? <LoaderCircle className="size-3.5 animate-spin text-accent-soft" /> : <Icon className="size-3.5 text-dim" strokeWidth={1.5} />}</span>}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px] text-fg">{g.prompt}</span>
                  <span className="block truncate font-mono text-[10px] text-dim">
                    {g.model_label} · {working(g) ? <Elapsed from={g.started_at ?? g.created_at} /> : g.status === 'failed' ? 'failed' : 'done'}
                    {g.params?.mode ? ` · ${g.params.mode}` : ''}
                  </span>
                </span>
              </button>
              {g.status === 'failed' && (
                <div className="mt-1.5 flex items-start gap-2">
                  <p className="min-w-0 flex-1 text-[11px] leading-snug text-fail/90">{g.error}</p>
                  <button
                    type="button"
                    onClick={async () => {
                      setBusy(g.id)
                      await onRetry(g, {})
                      setBusy(null)
                    }}
                    className="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10.5px] text-muted hover:bg-white/[0.06] hover:text-fg"
                    disabled={busy === g.id}
                    title={models.find((m) => m.id === g.model)?.available === false ? 'This model can’t run right now' : 'Try again as it was'}
                  >
                    {busy === g.id ? <LoaderCircle className="size-3 animate-spin" /> : <RotateCcw className="size-3" />}
                    Retry
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Upscale                                                              */
/* ------------------------------------------------------------------ */

/** Upscale: which image, by how much, and with which upscaler. No prompt. */
function UpscaleSettings({ models, target, board, onPick, onQueued }: { models: ModelInfo[]; target: Asset | null; board: number | null; onPick: (a: Asset) => void; onQueued: () => void }) {
  const invalidate = useInvalidate()
  const { usable, id: model, current, set: setModel } = useModel(models, 'image', (m) => !!m.capabilities.upscale)
  const scales = current?.capabilities.scales ?? [2, 4]
  const [scale, setScale] = useState(4)
  const [picking, setPicking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const by = scales.includes(scale) ? scale : scales[scales.length - 1]
  const out = target?.width && target.height ? [target.width * by, target.height * by] : null
  const tooBig = !!out && Math.max(...out) > 8192

  const go = async () => {
    if (!target) return setError('Pick the image to upscale.')
    setBusy(true)
    setError(null)
    try {
      await runMedia({ kind: 'image', model, board_id: board, prompt: `Upscale ${by}×: ${target.name ?? 'image'}`, params: { mode: 'upscale', scale: by }, input_asset_ids: [target.id] })
      onQueued()
      invalidate()
    } catch (e) {
      setError(messageFor(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-full flex-col">
      <div className="space-y-4 p-4">
        <div>
          <Label>Upscaler</Label>
          <ModelPicker models={usable} kind="image" value={model} onChange={setModel} className="mt-2" />
          {!usable.length && <p className="mt-1.5 text-[11.5px] text-warn">No upscaler is set up. Connect InvokeAI under Models: its Real-ESRGAN upscaler comes with it.</p>}
          {current && !current.available && <p className="mt-1.5 text-[11.5px] text-warn">{current.reason}</p>}
        </div>
        <div>
          <Label>Image</Label>
          <button type="button" onClick={() => setPicking(true)} className="mt-2 flex w-full items-center gap-3 rounded-md border border-dashed border-line-2 p-2 text-left text-[12px] text-muted transition-colors hover:border-accent-soft/60 hover:text-fg">
            {target ? <MediaThumb asset={target} className="size-12" /> : <ImagePlus className="m-3 size-5" strokeWidth={1.5} />}
            <span className="min-w-0">
              <span className="block truncate">{target ? (target.name ?? 'Image') : 'Pick an image, or click one in the gallery'}</span>
              {target?.width && <span className="block font-mono text-[10.5px] text-dim">{target.width} × {target.height}</span>}
            </span>
          </button>
          <MediaPicker open={picking} onClose={() => setPicking(false)} onPick={(a) => a.find((x) => x.kind === 'image') && onPick(a.find((x) => x.kind === 'image')!)} max={1} initial={target ? [target] : []} />
        </div>
        <div>
          <Label>Scale</Label>
          <Segmented id="upscale-by" label="Scale" options={scales.map((s) => ({ value: s, label: `${s}×` }))} value={by} onChange={setScale} className="mt-2 w-fit" />
          {out && <p className={cn('mt-2 font-mono text-[11px]', tooBig ? 'text-warn' : 'text-dim')}>→ {out[0]} × {out[1]}{tooBig ? ' · too large, try 2×' : ''}</p>}
        </div>
        <p className="text-[11px] leading-relaxed text-dim">Real-ESRGAN adds real detail as it enlarges: sharper edges and textures, not just bigger pixels. Good for print, banners and crisp crops.</p>
      </div>
      <div className="sticky bottom-0 mt-auto border-t border-line bg-panel p-4">
        <FieldError message={error} />
        <Btn variant="primary" icon={Maximize2} onClick={go} loading={busy} disabled={!current?.available || !target || tooBig} className="w-full">
          Upscale {by}×
        </Btn>
      </div>
    </div>
  )
}

/** The image being upscaled, and once done, before and after with a slider. */
function UpscaleCenter({ target, results, onPick }: { target: Asset | null; results: Generation[]; onPick: (a: Asset) => void }) {
  const [shownId, setShownId] = useState<number | null>(null)
  const [split, setSplit] = useState(50)
  const shown = results.find((g) => g.id === shownId) ?? results[0]
  const before = shown?.inputs[0] ?? null
  const after = shown?.status === 'succeeded' ? shown.outputs[0] : null
  const comparing = !!(after && before && (!target || before.id === target.id))

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="relative grid min-h-0 flex-1 place-items-center overflow-hidden p-4">
        {comparing ? (
          <div className="relative max-h-full max-w-full select-none overflow-hidden rounded-lg" style={{ aspectRatio: `${after!.width ?? 1} / ${after!.height ?? 1}`, width: `min(100%, calc((100dvh - 15rem) * ${(after!.width ?? 1) / (after!.height ?? 1)}))` }}>
            <img src={after!.url} alt="After" draggable={false} className="absolute inset-0 size-full object-contain" />
            <img src={before!.url} alt="Before" draggable={false} className="absolute inset-0 size-full object-contain [image-rendering:pixelated]" style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }} />
            <span className="pointer-events-none absolute inset-y-0 w-px bg-white/80" style={{ left: `${split}%` }} />
            <span className="pointer-events-none absolute left-2 top-2 rounded bg-black/60 px-1.5 py-0.5 font-mono text-[10px] text-white">Before · {before!.width}×{before!.height}</span>
            <span className="pointer-events-none absolute right-2 top-2 rounded bg-black/60 px-1.5 py-0.5 font-mono text-[10px] text-white">After · {after!.width}×{after!.height}</span>
            <input type="range" min={0} max={100} value={split} onChange={(e) => setSplit(Number(e.target.value))} aria-label="Before and after" className="absolute inset-0 size-full cursor-ew-resize opacity-0" />
          </div>
        ) : shown && working(shown) && (!target || shown.inputs[0]?.id === target.id) ? (
          <div className="flex flex-col items-center gap-3">
            {shown.inputs[0] && <img src={shown.inputs[0].url} alt="" className="max-h-[50vh] rounded-lg opacity-50 blur-[1px]" />}
            <p className="flex items-center gap-2 font-mono text-[11px] text-accent-soft">
              <LoaderCircle className="size-3 animate-spin" /> Upscaling · <Elapsed from={shown.started_at ?? shown.created_at} />
            </p>
          </div>
        ) : target ? (
          <img src={target.url} alt={target.name ?? ''} draggable={false} className="max-h-full max-w-full rounded-lg object-contain" />
        ) : (
          <EmptyState icon={Maximize2} title="Pick an image to upscale" body="Click one in the gallery, or choose it on the left. Results land next to the original." />
        )}
      </div>
      {shown?.status === 'failed' && (!target || shown.inputs[0]?.id === target.id) && <p className="border-t border-fail/25 bg-fail/[0.06] px-3 py-2 text-[11.5px] text-fg">{shown.error}</p>}
      {results.length > 0 && (
        <div className="flex items-center gap-1.5 overflow-x-auto border-t border-line p-2" data-lenis-prevent>
          <span className="shrink-0 px-1 font-mono text-[9.5px] uppercase tracking-[0.14em] text-dim">Upscaled</span>
          {results.slice(0, 20).map((g) =>
            working(g) ? (
              <span key={g.id} className="skeleton grid size-14 shrink-0 place-items-center rounded-md">
                <LoaderCircle className="size-4 animate-spin text-accent-soft" />
              </span>
            ) : g.outputs[0] ? (
              <button key={g.id} type="button" onClick={() => (setShownId(g.id), g.inputs[0] && onPick(g.inputs[0]))} title={g.prompt} className="shrink-0">
                <MediaThumb asset={g.outputs[0]} className={cn('size-14', shown?.id === g.id ? 'ring-2 ring-accent' : 'hover:ring-2 hover:ring-line-2')} />
              </button>
            ) : (
              <span key={g.id} title={g.error ?? ''} className="grid size-14 shrink-0 place-items-center rounded-md border border-fail/40 text-[9px] text-fail">
                Failed
              </span>
            ),
          )}
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Start                                                                */
/* ------------------------------------------------------------------ */

const STARTS: Array<{ space: Space; title: string; body: string; icon: typeof Layers }> = [
  { space: 'compose', title: 'Generate from text', body: 'Start from a prompt', icon: ImageIcon },
  { space: 'edit', title: 'Edit on canvas', body: 'Paint over part of an image, or extend it', icon: Layers },
  { space: 'upscale', title: 'Upscale an image', body: '2× or 4× larger and sharper', icon: Maximize2 },
  { space: 'video', title: 'Generate a video', body: 'From a prompt or a still', icon: Clapperboard },
  { space: 'voice', title: 'Make a voiceover', body: 'Your cloned voices read a script', icon: AudioLines },
  { space: 'write', title: 'Write copy', body: 'Captions, hooks and scripts', icon: PenLine },
  { space: 'workflow', title: 'Build a workflow', body: 'Chain steps; run them in one go', icon: WorkflowIcon },
]

/** Where a result was made, so opening it goes back to the right place. */
function spaceOf(g: Generation): Space {
  if (g.kind === 'video') return 'video'
  if (g.kind === 'audio') return 'voice'
  if (g.kind === 'text') return 'write'
  const mode = g.params?.mode
  return mode === 'upscale' ? 'upscale' : mode === 'inpaint' || mode === 'outpaint' ? 'edit' : 'compose'
}

/** The Creative Lab's start: pick up the last thing, start something new, see what's recent. */
function LabHome({ feed, onOpen }: { feed: Generation[]; onOpen: (space: Space, asset?: Asset) => void }) {
  const last = feed.find((g) => g.status === 'succeeded' && g.outputs.length)
  const recent = feed.filter((g) => g.status === 'succeeded').flatMap((g) => g.outputs.map((a) => ({ g, a }))).slice(0, 12)
  return (
    <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-line bg-panel" data-lenis-prevent>
      <div className="mx-auto max-w-[1080px] px-5 py-8 md:px-8">
        <h2 className="text-[22px] font-medium tracking-[-0.02em]">Welcome to the Creative Lab</h2>
        <p className="mt-1 text-[13px] text-dim">Images, edits, upscales, video, voiceovers and copy, on your own GPU or in the cloud.</p>

        {last && (
          <div className="mt-6 flex items-center gap-4 rounded-xl border border-line bg-panel-2/60 p-3">
            <MediaThumb asset={last.outputs[0]} className="size-20 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-dim">Pick up where you left off</p>
              <p className="mt-1 truncate text-[14px] font-medium">{last.prompt}</p>
              <p className="mt-0.5 text-[11.5px] text-dim">{last.model_label}</p>
            </div>
            <Btn variant="primary" icon={ArrowRightIcon} onClick={() => onOpen(spaceOf(last), last.outputs[0])}>
              Resume
            </Btn>
          </div>
        )}

        <h3 className="mt-8 text-[13px] font-medium">Start something</h3>
        <div className="mt-3 grid grid-cols-2 gap-2.5 md:grid-cols-4">
          {STARTS.map((s, i) => (
            <motion.button
              key={s.space}
              type="button"
              onClick={() => onOpen(s.space)}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, ease, delay: i * 0.03 }}
              className="group rounded-xl border border-line bg-panel-2/40 p-4 text-left transition-colors hover:border-accent/40 hover:bg-accent/[0.05]"
            >
              <s.icon className="size-5 text-muted transition-colors group-hover:text-accent-soft" strokeWidth={1.5} />
              <span className="mt-4 block text-[13.5px] font-medium">{s.title}</span>
              <span className="mt-0.5 block text-[11.5px] text-dim">{s.body}</span>
            </motion.button>
          ))}
        </div>

        {recent.length > 0 && (
          <>
            <h3 className="mt-8 text-[13px] font-medium">Recent</h3>
            <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
              {recent.map(({ g, a }) => (
                <button key={a.id} type="button" onClick={() => onOpen(spaceOf(g), a)} title={g.prompt} className="group text-left">
                  <MediaThumb asset={a} className="transition-[box-shadow] group-hover:ring-2 group-hover:ring-line-2" />
                  <span className="mt-1 block truncate text-[10.5px] text-dim">{g.prompt}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}