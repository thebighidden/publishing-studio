import { useEffect, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowDown,
  ArrowUp,
  AudioLines,
  CalendarClock,
  Check,
  Clapperboard,
  FileText,
  Image as ImageIcon,
  ImagePlus,
  LoaderCircle,
  Maximize2,
  PenLine,
  Play,
  Plus,
  RotateCcw,
  Save,
  Trash2,
  Workflow as WorkflowIcon,
  X,
} from 'lucide-react'
import { PLATFORMS, PlatformIcon, type PlatformId } from '../../components/ui/PlatformIcon'
import { api, ApiError, type Asset, type ModelInfo, type Registry, type Workflow, type WorkflowRun, type Workflows, type WorkflowStep, type WorkflowStepType } from '../../lib/api'
import { ease } from '../../lib/motion'
import { cn } from '../../lib/cn'
import { fmtRelative, PLATFORM_ORDER, useApi, useInvalidate } from '../data'
import { MediaPicker, MediaThumb } from '../media/Media'
import { useToast } from '../toast'
import { Btn, EmptyState, FieldError, inputClass, Label } from '../ui'
import { ModelPicker } from './parts'
import { messageFor } from './run'

const STEP: Record<WorkflowStepType, { label: string; icon: typeof ImageIcon; kind: ModelInfo['kind'] | null; hint: string }> = {
  image: { label: 'Generate image', icon: ImageIcon, kind: 'image', hint: 'Makes a picture from a prompt.' },
  upscale: { label: 'Upscale', icon: Maximize2, kind: 'image', hint: 'Makes the latest image 2× or 4× larger and sharper.' },
  video: { label: 'Animate to video', icon: Clapperboard, kind: 'video', hint: 'Brings the latest image to life.' },
  voice: { label: 'Voiceover', icon: AudioLines, kind: 'audio', hint: 'Reads a script aloud.' },
  write: { label: 'Write caption', icon: PenLine, kind: 'text', hint: 'Writes text; later steps can use it as {caption}.' },
  post: { label: 'Post draft', icon: CalendarClock, kind: null, hint: 'Drafts a post with the latest picture or clip and caption. Nothing is published.' },
}
const ORDER: WorkflowStepType[] = ['image', 'upscale', 'video', 'voice', 'write', 'post']
const RATIOS = ['1:1', '4:5', '9:16', '16:9']

/** Models a step can use: right kind, upscalers only for Upscale and never elsewhere. */
const fits = (type: WorkflowStepType) => (m: ModelInfo) => m.kind === STEP[type].kind && !!m.capabilities.upscale === (type === 'upscale')

function blank(type: WorkflowStepType, models: ModelInfo[], defaultText: string): WorkflowStep {
  const list = models.filter(fits(type))
  // Local first: a template shouldn't quietly spend cloud credits when your own GPU can do it.
  const runnable = [...list.filter((m) => m.available && m.local), ...list.filter((m) => m.available && !m.local)]
  const model = type === 'write' ? (runnable.find((m) => m.id === defaultText) ?? runnable[0])?.id : runnable[0]?.id
  return {
    type,
    ...(type === 'post' ? {} : { model: model ?? list[0]?.id ?? null }),
    ...(type === 'upscale' ? { scale: 2 } : {}),
    ...(type === 'video' ? { duration: 5, prompt: 'Slow, gentle camera movement that brings it to life' } : {}),
    ...(type === 'image' ? { prompt: '{prompt}', aspect_ratio: '4:5' } : {}),
    ...(type === 'write' ? { prompt: 'Write a short social caption with a strong first line for: {prompt}' } : {}),
    ...(type === 'voice' ? { script: '{caption}' } : {}),
  }
}

/** rev changes whenever a different workflow is loaded, so the builder starts fresh only then. */
type Draft = { id: number | null; name: string; steps: WorkflowStep[]; needsImage: boolean; rev: number }

/**
 * Build a workflow: a chain of steps, each starting from what the one before made. Saved
 * workflows and templates on the left, the chain in the middle, its runs on the right.
 */
export function WorkflowSpace({ registry, board }: { registry: Registry; board: number | null }) {
  const { data: lib, setData } = useApi<Workflows>('/workflows')
  const [draft, setDraft] = useState<Draft>({ id: null, name: 'Untitled workflow', steps: [], needsImage: false, rev: 0 })
  const runs = useRuns()
  const models = registry.models
  const fill = (steps: WorkflowStep[]) => steps.map((s) => ({ ...blank(s.type, models, registry.default_text), ...s, model: s.type === 'post' ? undefined : (s.model ?? blank(s.type, models, registry.default_text).model) }))

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 lg:grid-cols-[280px_minmax(0,1fr)] xl:grid-cols-[280px_minmax(0,1fr)_320px]">
      <aside className="min-h-0 overflow-y-auto rounded-xl border border-line bg-panel p-3" data-lenis-prevent>
        <Btn variant="primary" icon={Plus} className="w-full" onClick={() => setDraft({ id: null, name: 'Untitled workflow', steps: [blank('image', models, registry.default_text)], needsImage: false, rev: Date.now() })}>
          New workflow
        </Btn>
        <Label className="mt-5 px-1">Your workflows</Label>
        <div className="mt-2 space-y-1">
          {!lib ? (
            <div className="skeleton h-10 rounded-md" />
          ) : lib.data.length === 0 ? (
            <p className="px-1 text-[11.5px] text-dim">None saved yet. Start from a template or a blank one.</p>
          ) : (
            lib.data.map((w) => (
              <div key={w.id} className={cn('group flex items-center gap-2 rounded-md px-2 py-2', draft.id === w.id ? 'bg-accent/[0.12]' : 'hover:bg-white/[0.04]')}>
                <button type="button" onClick={() => setDraft({ id: w.id, name: w.name, steps: fill(w.steps), needsImage: w.steps[0]?.type === 'upscale', rev: Date.now() })} className="min-w-0 flex-1 text-left">
                  <span className="block truncate text-[12.5px] text-fg">{w.name}</span>
                  <span className="mt-0.5 flex items-center gap-1 text-dim">
                    {w.steps.map((s, i) => {
                      const Icon = STEP[s.type].icon
                      return <Icon key={i} className="size-3" strokeWidth={1.75} />
                    })}
                    <span className="ml-1 font-mono text-[9.5px]">{w.updated_at ? fmtRelative(w.updated_at) : ''}</span>
                  </span>
                </button>
                <button
                  type="button"
                  aria-label="Delete workflow"
                  onClick={async () => {
                    if (!window.confirm(`Delete “${w.name}”? Its past runs and files stay.`)) return
                    await api(`/workflows/${w.id}`, { method: 'DELETE' })
                    setData({ ...lib, data: lib.data.filter((x) => x.id !== w.id) })
                    if (draft.id === w.id) setDraft((d) => ({ ...d, id: null }))
                  }}
                  className="grid size-6 place-items-center rounded text-dim opacity-0 hover:text-fail group-hover:opacity-100"
                >
                  <Trash2 className="size-3" />
                </button>
              </div>
            ))
          )}
        </div>
        <Label className="mt-5 px-1">Templates</Label>
        <div className="mt-2 space-y-1.5">
          {lib?.templates.map((t) => (
            <button
              key={t.name}
              type="button"
              onClick={() => setDraft({ id: null, name: t.name, steps: fill(t.steps), needsImage: !!t.needs_image, rev: Date.now() })}
              className="w-full rounded-lg border border-line p-2.5 text-left transition-colors hover:border-line-2"
            >
              <span className="flex items-center gap-1.5 text-[12.5px] font-medium">
                {t.name}
                <span className="ml-auto flex gap-1 text-dim">
                  {t.steps.map((s, i) => {
                    const Icon = STEP[s.type].icon
                    return <Icon key={i} className="size-3" strokeWidth={1.75} />
                  })}
                </span>
              </span>
              <span className="mt-1 block text-[11px] leading-snug text-dim">{t.body}</span>
            </button>
          ))}
        </div>
      </aside>

      <section className="flex min-h-[520px] min-w-0 flex-col overflow-hidden rounded-xl border border-line bg-panel">
        {draft.steps.length ? (
          <Builder
            key={draft.rev}
            draft={draft}
            setDraft={setDraft}
            registry={registry}
            board={board}
            onSaved={(w) => {
              if (!lib) return
              setData({ ...lib, data: [w, ...lib.data.filter((x) => x.id !== w.id)] })
              setDraft((d) => ({ ...d, id: w.id }))
            }}
            onRan={runs.refresh}
          />
        ) : (
          <div className="grid flex-1 place-items-center p-6">
            <EmptyState
              icon={WorkflowIcon}
              title="Build a workflow"
              body="Chain steps together: generate an image, upscale it, animate it, write the caption, voice it, draft the post. One click runs them all, each starting from what the one before made."
              action={
                <Btn variant="primary" icon={Plus} onClick={() => setDraft({ id: null, name: 'Untitled workflow', steps: [blank('image', models, registry.default_text)], needsImage: false, rev: Date.now() })}>
                  Start with a blank workflow
                </Btn>
              }
            />
          </div>
        )}
      </section>

      <aside className="flex h-[460px] min-h-0 flex-col overflow-hidden rounded-xl border border-line bg-panel lg:col-span-2 xl:col-span-1 xl:h-auto">
        <Runs runs={runs.data} onResume={runs.refresh} />
      </aside>
    </div>
  )
}

function useRuns() {
  const { data, setData } = useApi<WorkflowRun[]>('/workflow-runs')
  const busy = data?.some((r) => r.status === 'running')
  const refresh = () => api<WorkflowRun[]>('/workflow-runs').then(setData).catch(() => {})
  useEffect(() => {
    if (!busy) return
    const t = window.setInterval(() => api<WorkflowRun[]>('/workflow-runs').then(setData).catch(() => {}), 3000)
    return () => window.clearInterval(t)
  }, [busy, setData])
  return { data, refresh }
}

function Builder({ draft, setDraft, registry, board, onSaved, onRan }: { draft: Draft; setDraft: (f: (d: Draft) => Draft) => void; registry: Registry; board: number | null; onSaved: (w: Workflow) => void; onRan: () => void }) {
  const toast = useToast()
  const invalidate = useInvalidate()
  const [prompt, setPrompt] = useState('')
  const [start, setStart] = useState<Asset | null>(null)
  const [picking, setPicking] = useState(false)
  const [adding, setAdding] = useState<number | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [running, setRunning] = useState(false)
  const models = registry.models
  const steps = draft.steps

  const set = (i: number, patch: Partial<WorkflowStep>) => setDraft((d) => ({ ...d, steps: d.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)) }))
  const insert = (at: number, type: WorkflowStepType) => {
    setDraft((d) => ({ ...d, steps: [...d.steps.slice(0, at), blank(type, models, registry.default_text), ...d.steps.slice(at)] }))
    setAdding(null)
  }
  const move = (i: number, by: number) =>
    setDraft((d) => {
      const next = [...d.steps]
      const [s] = next.splice(i, 1)
      next.splice(i + by, 0, s)
      return { ...d, steps: next }
    })
  const remove = (i: number) => setDraft((d) => ({ ...d, steps: d.steps.filter((_, j) => j !== i) }))
  const failed = (e: unknown) => {
    if (e instanceof ApiError && e.status === 422) {
      setErrors(Object.fromEntries(Object.entries(e.errors).map(([k, v]) => [k, v[0]])))
      toast(Object.values(e.errors)[0]?.[0] ?? e.message, 'error')
    } else toast(messageFor(e), 'error')
  }

  const save = async () => {
    setSaving(true)
    setErrors({})
    try {
      const body = { name: draft.name.trim() || 'Untitled workflow', steps, starts_from_image: draft.needsImage || !!start }
      const w = await api<Workflow>(draft.id ? `/workflows/${draft.id}` : '/workflows', { method: draft.id ? 'PATCH' : 'POST', body })
      onSaved(w)
      toast('Workflow saved.')
    } catch (e) {
      failed(e)
    } finally {
      setSaving(false)
    }
  }

  const run = async () => {
    setRunning(true)
    setErrors({})
    try {
      await api('/workflows/run', { method: 'POST', body: { workflow_id: draft.id, name: draft.name.trim() || 'Workflow', steps, prompt: prompt.trim() || null, start_asset_id: start?.id ?? null, board_id: board } })
      onRan()
      invalidate()
      toast('Running. Each step starts when the one before finishes.')
    } catch (e) {
      failed(e)
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <WorkflowIcon className="size-4 text-dim" strokeWidth={1.75} />
        <input value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} className="h-8 min-w-0 flex-1 bg-transparent text-[14px] font-medium outline-none" aria-label="Workflow name" maxLength={80} />
        <span className="hidden font-mono text-[10px] text-dim sm:inline">{steps.length} / 8 steps</span>
        <Btn size="sm" variant="subtle" icon={Save} onClick={save} loading={saving}>
          {draft.id ? 'Save' : 'Save workflow'}
        </Btn>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto bg-[radial-gradient(circle_at_center,rgb(255_255_255_/_0.035)_1px,transparent_1px)] bg-[length:18px_18px] px-4 py-5" data-lenis-prevent>
        <div className="mx-auto max-w-[560px]">
          <StartNode prompt={prompt} start={start} needsImage={draft.needsImage} onPick={() => setPicking(true)} onClear={() => setStart(null)} />
          {steps.map((s, i) => (
            <div key={i}>
              <Connector onAdd={() => setAdding(adding === i ? null : i)} open={adding === i} onPick={(t) => insert(i, t)} disabled={steps.length >= 8} />
              <StepCard
                index={i}
                step={s}
                models={models}
                errors={Object.fromEntries(Object.entries(errors).filter(([k]) => k.startsWith(`steps.${i}.`)).map(([k, v]) => [k.split('.')[2], v]))}
                onChange={(patch) => set(i, patch)}
                onUp={i > 0 ? () => move(i, -1) : undefined}
                onDown={i < steps.length - 1 ? () => move(i, 1) : undefined}
                onRemove={() => remove(i)}
              />
            </div>
          ))}
          <Connector onAdd={() => setAdding(adding === steps.length ? null : steps.length)} open={adding === steps.length} onPick={(t) => insert(steps.length, t)} disabled={steps.length >= 8} last />
        </div>
      </div>

      <div className="border-t border-line p-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <label className="min-w-0 flex-1">
            <Label>
              Run with <span className="normal-case text-dim">— this is {'{prompt}'} in the steps</span>
            </Label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === 'Enter' && run()}
              rows={2}
              placeholder="Warm croissants on a marble counter, morning light"
              className={cn(inputClass, 'mt-1.5 h-auto resize-none py-2 leading-snug')}
            />
          </label>
          <Btn variant="primary" icon={Play} onClick={run} loading={running} className="sm:w-44">
            Run workflow
          </Btn>
        </div>
        <FieldError message={errors.prompt ?? errors.steps ?? null} />
      </div>
      <MediaPicker open={picking} onClose={() => setPicking(false)} onPick={(a) => setStart(a.find((x) => x.kind === 'image') ?? null)} max={1} initial={start ? [start] : []} />
    </div>
  )
}

function StartNode({ prompt, start, needsImage, onPick, onClear }: { prompt: string; start: Asset | null; needsImage: boolean; onPick: () => void; onClear: () => void }) {
  return (
    <div className="rounded-xl border border-dashed border-line-2 bg-panel-2/60 p-3">
      <p className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-dim">
        <Play className="size-3" /> Start
      </p>
      <p className="mt-1.5 truncate text-[12.5px] text-muted">{prompt.trim() ? `“${prompt.trim()}”` : 'The prompt you run it with (below)'}</p>
      <div className="mt-2 flex items-center gap-2">
        {start ? (
          <>
            <MediaThumb asset={start} className="size-10" />
            <span className="min-w-0 flex-1 truncate text-[11.5px] text-dim">Starts from {start.name ?? 'this photo'}</span>
            <button type="button" onClick={onClear} className="grid size-6 place-items-center rounded text-dim hover:text-fg" aria-label="Remove the starting photo">
              <X className="size-3.5" />
            </button>
          </>
        ) : (
          <button type="button" onClick={onPick} className={cn('flex items-center gap-1.5 text-[11.5px] hover:text-fg', needsImage ? 'text-warn' : 'text-dim')}>
            <ImagePlus className="size-3.5" /> {needsImage ? 'Pick the photo to start from' : 'Optional: start from one of your photos'}
          </button>
        )}
      </div>
    </div>
  )
}

function Connector({ onAdd, open, onPick, disabled, last }: { onAdd: () => void; open: boolean; onPick: (t: WorkflowStepType) => void; disabled: boolean; last?: boolean }) {
  return (
    <div className="relative flex flex-col items-center py-1">
      <span className="h-3 w-px bg-line-2" />
      <button
        type="button"
        onClick={onAdd}
        disabled={disabled}
        title={disabled ? 'Up to 8 steps' : 'Add a step here'}
        className={cn('grid size-6 place-items-center rounded-full border text-dim transition-colors disabled:opacity-30', open ? 'border-accent bg-accent/20 text-accent-soft' : 'border-line-2 bg-panel hover:border-accent-soft/60 hover:text-fg')}
      >
        <Plus className="size-3.5" />
      </button>
      {!last && <span className="h-3 w-px bg-line-2" />}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease }}
            className="z-10 mt-1.5 grid w-full grid-cols-2 gap-1 rounded-lg border border-line-2 bg-panel-3 p-1.5 shadow-[0_24px_60px_-20px_rgb(0_0_0_/_0.9)] sm:grid-cols-3"
          >
            {ORDER.map((t) => {
              const Icon = STEP[t].icon
              return (
                <button key={t} type="button" onClick={() => onPick(t)} className="flex items-start gap-2 rounded-md px-2 py-2 text-left hover:bg-white/[0.06]">
                  <Icon className="mt-0.5 size-3.5 shrink-0 text-accent-soft" strokeWidth={1.75} />
                  <span>
                    <span className="block text-[12px] text-fg">{STEP[t].label}</span>
                    <span className="block text-[10.5px] leading-snug text-dim">{STEP[t].hint}</span>
                  </span>
                </button>
              )
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function StepCard({
  index,
  step,
  models,
  errors,
  onChange,
  onUp,
  onDown,
  onRemove,
}: {
  index: number
  step: WorkflowStep
  models: ModelInfo[]
  errors: Record<string, string>
  onChange: (patch: Partial<WorkflowStep>) => void
  onUp?: () => void
  onDown?: () => void
  onRemove: () => void
}) {
  const meta = STEP[step.type]
  const Icon = meta.icon
  const usable = models.filter(fits(step.type))
  const current = usable.find((m) => m.id === step.model)
  const caps = current?.capabilities ?? {}
  const error = errors.model ?? errors.type ?? null

  return (
    <div className={cn('rounded-xl border bg-panel shadow-[0_18px_40px_-28px_rgb(0_0_0)]', error ? 'border-fail/50' : 'border-line-2')}>
      <header className="flex items-center gap-2 border-b border-line px-3 py-2">
        <span className="grid size-6 place-items-center rounded-md bg-accent/15 text-accent-soft">
          <Icon className="size-3.5" strokeWidth={1.75} />
        </span>
        <span className="text-[12.5px] font-medium">
          <span className="mr-1.5 font-mono text-[10px] text-dim">{index + 1}</span>
          {meta.label}
        </span>
        <span className="ml-auto flex items-center gap-0.5">
          <IconBtn label="Move up" icon={ArrowUp} onClick={onUp} />
          <IconBtn label="Move down" icon={ArrowDown} onClick={onDown} />
          <IconBtn label="Remove step" icon={Trash2} onClick={onRemove} danger />
        </span>
      </header>
      <div className="space-y-3 p-3">
        {meta.kind && (
          <div>
            <ModelPicker models={usable} kind={meta.kind} value={step.model ?? null} onChange={(id) => onChange({ model: id })} />
            {current && !current.available && <p className="mt-1 text-[11px] text-warn">{current.reason}</p>}
          </div>
        )}
        {(step.type === 'image' || step.type === 'video' || step.type === 'write') && (
          <label className="block">
            <Label>{step.type === 'video' ? 'Motion' : step.type === 'write' ? 'What to write' : 'Prompt'}</Label>
            <textarea value={step.prompt ?? ''} onChange={(e) => onChange({ prompt: e.target.value })} rows={2} className={cn(inputClass, 'mt-1.5 h-auto resize-y py-2 text-[12.5px] leading-snug')} />
          </label>
        )}
        {step.type === 'voice' && (
          <>
            <label className="block">
              <Label>Script</Label>
              <textarea value={step.script ?? ''} onChange={(e) => onChange({ script: e.target.value })} rows={2} className={cn(inputClass, 'mt-1.5 h-auto resize-y py-2 text-[12.5px] leading-snug')} />
            </label>
            {(caps.voices?.length ?? 0) > 1 && (
              <select value={step.voice ?? caps.voices?.[0]?.id ?? ''} onChange={(e) => onChange({ voice: e.target.value })} className={cn(inputClass, 'h-8 text-[12px]')} aria-label="Voice">
                {caps.voices?.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                    {v.language ? ` · ${v.language}` : ''}
                  </option>
                ))}
              </select>
            )}
          </>
        )}
        {(step.type === 'image' || step.type === 'video') && (
          <div className="flex flex-wrap items-center gap-1.5">
            {(caps.aspect_ratios?.length ? caps.aspect_ratios : RATIOS).map((r) => (
              <Chip key={r} active={step.aspect_ratio === r} onClick={() => onChange({ aspect_ratio: r })}>
                {r}
              </Chip>
            ))}
            {step.type === 'video' &&
              (caps.durations?.length ? caps.durations : [5, 8, 10]).map((d) => (
                <Chip key={d} active={step.duration === d} onClick={() => onChange({ duration: d })}>
                  {d} s
                </Chip>
              ))}
          </div>
        )}
        {step.type === 'image' && (caps.max_inputs ?? 0) > 0 && index > 0 && (
          <label className="flex items-center gap-2 text-[11.5px] text-muted">
            <input type="checkbox" checked={!!step.use_previous} onChange={(e) => onChange({ use_previous: e.target.checked })} />
            Use the image before this as a reference
          </label>
        )}
        {step.type === 'upscale' && (
          <div className="flex gap-1.5">
            {(caps.scales ?? [2, 4]).map((s) => (
              <Chip key={s} active={step.scale === s} onClick={() => onChange({ scale: s })}>
                {s}×
              </Chip>
            ))}
          </div>
        )}
        {step.type === 'post' && (
          <div>
            <div className="flex flex-wrap gap-1.5">
              {PLATFORM_ORDER.map((id) => {
                const on = step.platforms?.includes(id) ?? false
                return (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => onChange({ platforms: on ? step.platforms?.filter((p) => p !== id) : [...(step.platforms ?? []), id] })}
                    className={cn('flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[11px] transition-colors', on ? 'border-fg bg-fg text-ink' : 'border-line-2 text-muted hover:text-fg')}
                  >
                    <PlatformIcon id={id as PlatformId} className="size-3" />
                    {PLATFORMS[id as PlatformId].name}
                    {on && <Check className="size-3" />}
                  </button>
                )
              })}
            </div>
            <p className="mt-1.5 text-[10.5px] text-dim">{step.platforms?.length ? 'Saved as a draft for these.' : 'None picked: your usual platforms.'} You review it before anything is published.</p>
          </div>
        )}
        {error && <p className="text-[11.5px] text-fail">{error}</p>}
      </div>
    </div>
  )
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active} className={cn('h-7 rounded-md border px-2 font-mono text-[10.5px] transition-colors', active ? 'border-accent/50 bg-accent/[0.12] text-fg' : 'border-line text-dim hover:text-muted')}>
      {children}
    </button>
  )
}

function IconBtn({ label, icon: Icon, onClick, danger }: { label: string; icon: typeof Trash2; onClick?: () => void; danger?: boolean }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} disabled={!onClick} className={cn('grid size-6 place-items-center rounded text-dim transition-colors disabled:opacity-25', danger ? 'hover:text-fail' : 'hover:text-fg')}>
      <Icon className="size-3.5" strokeWidth={1.75} />
    </button>
  )
}

const RUN_TONE = { waiting: 'border-line text-dim', running: 'border-accent/50 text-accent-soft', succeeded: 'border-ok/40 text-ok', failed: 'border-fail/50 text-fail' } as const

function Runs({ runs, onResume }: { runs: WorkflowRun[] | null; onResume: () => void }) {
  const toast = useToast()
  const [busy, setBusy] = useState<number | null>(null)
  return (
    <>
      <div className="flex items-center justify-between border-b border-line px-3 py-2.5">
        <span className="text-[12.5px] font-medium">Runs</span>
        {runs?.some((r) => r.status === 'running') && <LoaderCircle className="size-3.5 animate-spin text-accent-soft" />}
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2" data-lenis-prevent>
        {!runs ? (
          <div className="skeleton h-24 rounded-lg" />
        ) : runs.length === 0 ? (
          <p className="px-2 py-8 text-center text-[11.5px] leading-relaxed text-dim">Runs show here, step by step, with what each one made.</p>
        ) : (
          runs.map((r) => (
            <div key={r.id} className={cn('rounded-lg border p-2.5', r.status === 'failed' ? 'border-fail/30' : r.status === 'running' ? 'border-accent/30' : 'border-line')}>
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-[12px] font-medium">{r.name}</span>
                <span className="font-mono text-[9.5px] text-dim">{fmtRelative(r.created_at)}</span>
              </div>
              {r.prompt && <p className="mt-0.5 truncate text-[11px] text-dim">“{r.prompt}”</p>}
              <div className="mt-2 flex flex-wrap items-center gap-1">
                {r.steps.map((s, i) => {
                  const Icon = STEP[s.type].icon
                  return (
                    <span key={i} title={`${i + 1}. ${STEP[s.type].label}: ${s.status}`} className={cn('grid size-6 place-items-center rounded border', RUN_TONE[s.status])}>
                      {s.status === 'running' ? <LoaderCircle className="size-3 animate-spin" /> : <Icon className="size-3" strokeWidth={1.75} />}
                    </span>
                  )
                })}
              </div>
              {r.steps.some((s) => s.assets.length) && (
                <div className="mt-2 flex gap-1 overflow-x-auto">
                  {r.steps.flatMap((s) => s.assets).map((a) => (
                    <MediaThumb key={a.id} asset={a} className="size-10 shrink-0" />
                  ))}
                </div>
              )}
              {r.steps.find((s) => s.text)?.text && <p className="mt-2 line-clamp-2 text-[11px] italic text-muted">{r.steps.filter((s) => s.text).at(-1)?.text}</p>}
              {r.steps.some((s) => s.post_id) && (
                <p className="mt-1.5 flex items-center gap-1 text-[11px] text-ok">
                  <FileText className="size-3" /> Post draft saved: review it in the Library.
                </p>
              )}
              {r.status === 'failed' && (
                <div className="mt-2 flex items-start gap-2">
                  <p className="min-w-0 flex-1 text-[11px] leading-snug text-fail/90">{r.error}</p>
                  <button
                    type="button"
                    disabled={busy === r.id}
                    onClick={async () => {
                      setBusy(r.id)
                      try {
                        await api(`/workflow-runs/${r.id}/resume`, { method: 'POST' })
                        onResume()
                      } catch (e) {
                        toast(messageFor(e), 'error')
                      } finally {
                        setBusy(null)
                      }
                    }}
                    className="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10.5px] text-muted hover:bg-white/[0.06] hover:text-fg"
                  >
                    {busy === r.id ? <LoaderCircle className="size-3 animate-spin" /> : <RotateCcw className="size-3" />}
                    Pick up again
                  </button>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </>
  )
}
