import { useState } from 'react'
import { motion } from 'framer-motion'
import { ArrowLeft, ArrowUpRight, FolderKanban, ImagePlus, PenLine, Plus, Wand2 } from 'lucide-react'
import { api, type Asset, type Project, type Registry } from '../../lib/api'
import { ease } from '../../lib/motion'
import { cn } from '../../lib/cn'
import { useQueryParam, useRouter } from '../../lib/router'
import { fmtRelative, useApi, useInvalidate } from '../data'
import { MediaPicker, MediaThumb } from '../media/Media'
import { CanvasView } from '../studio/Canvas'
import { GenerationCard, ModelPicker, useGenerations } from '../studio/parts'
import { messageFor, retryGeneration } from '../studio/run'
import { SPACES, Workbench, type Space } from '../studio/Workbench'
import { Btn, EmptyState, FieldError, inputClass, Label, Modal, Panel, Skeleton } from '../ui'

type Tab = Space | 'recipes' | 'projects'
const TABS: Tab[] = ['home', ...SPACES.map((s) => s.value), 'recipes', 'projects']
// Older links: ?tab=text, image, video, audio.
const LEGACY: Record<string, Tab> = { text: 'write', image: 'compose', audio: 'voice' }

/** /dashboard/studio: the Creative Lab workbench, recipes, or a project's canvas. */
export default function Studio() {
  const project = useQueryParam('project')
  return project ? <CanvasView key={project} id={Number(project)} /> : <StudioHome />
}

function StudioHome() {
  const { search, navigate } = useRouter()
  const [tab, setTab] = useState<Tab>(() => {
    const raw = new URLSearchParams(search).get('tab') ?? 'home'
    const t = LEGACY[raw] ?? raw
    return TABS.includes(t as Tab) ? (t as Tab) : 'home'
  })
  const { data: registry } = useApi<Registry>('/models')
  const [naming, setNaming] = useState(false)

  const pick = (t: Tab) => {
    setTab(t)
    navigate(`/dashboard/studio${t === 'home' ? '' : `?tab=${t}`}`, { replace: true })
  }

  if (!registry) return <Skeleton className="h-[calc(100dvh-5rem)] rounded-xl" />

  if (tab === 'recipes' || tab === 'projects') {
    return (
      <div className="mx-auto max-w-[1320px] px-1 pb-16 pt-2 md:px-4">
        <header className="flex flex-wrap items-center gap-3">
          <Btn size="sm" variant="subtle" icon={ArrowLeft} onClick={() => pick('home')}>
            Creative Lab
          </Btn>
          <h1 className="text-[18px] font-medium tracking-[-0.02em]">{tab === 'recipes' ? 'Recipes' : 'Projects'}</h1>
          <span className="text-[12.5px] text-dim">{tab === 'recipes' ? 'Several steps, each starting when the one before finishes.' : 'Canvases of drafts, photos, videos and notes, connected.'}</span>
          {tab === 'projects' && (
            <Btn variant="primary" icon={Plus} onClick={() => setNaming(true)} className="ml-auto">
              New project
            </Btn>
          )}
        </header>
        <div className="mt-5">{tab === 'recipes' ? <Recipes registry={registry} /> : <Projects onNew={() => setNaming(true)} />}</div>
        <NewProject open={naming} onClose={() => setNaming(false)} />
      </div>
    )
  }

  return (
    <Workbench
      registry={registry}
      space={tab}
      onSpace={pick}
      extra={
        <>
          <Btn size="sm" variant="subtle" icon={Wand2} onClick={() => pick('recipes')}>
            Recipes
          </Btn>
          <Btn size="sm" variant="subtle" icon={FolderKanban} onClick={() => pick('projects')}>
            Projects
          </Btn>
        </>
      }
    />
  )
}

/* ------------------------------------------------------------------ */
/* Recipes                                                              */
/* ------------------------------------------------------------------ */

function Recipes({ registry }: { registry: Registry }) {
  const invalidate = useInvalidate()
  const [recipe, setRecipe] = useState<string>('text_to_image')
  const r = registry.recipes[recipe]
  const imageModels = registry.models.filter((m) => m.kind === 'image' && !m.capabilities.upscale)
  const videoModels = registry.models.filter((m) => m.kind === 'video')
  const [imageModel, setImageModel] = useState(imageModels.find((m) => m.available)?.id ?? null)
  const [videoModel, setVideoModel] = useState(videoModels.find((m) => m.available)?.id ?? null)
  const [prompt, setPrompt] = useState('')
  const [motion_, setMotion] = useState('')
  const [start, setStart] = useState<Asset | null>(null)
  const [picking, setPicking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { data: feed } = useGenerations({ kind: undefined })
  const recent = feed?.filter((g) => g.recipe) ?? []

  const run = async () => {
    setBusy(true)
    setError(null)
    try {
      await api(`/recipes/${recipe}`, {
        method: 'POST',
        body: { prompt, motion: motion_ || null, image_model: r.steps.includes('image') ? imageModel : null, video_model: r.steps.includes('video') ? videoModel : null, asset_id: start?.id ?? null, duration: 5 },
      })
      setPrompt('')
      invalidate()
    } catch (e) {
      setError(messageFor(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[400px_minmax(0,1fr)]">
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          {Object.entries(registry.recipes).map(([id, x]) => (
            <button
              key={id}
              type="button"
              aria-pressed={recipe === id}
              onClick={() => setRecipe(id)}
              className={cn('rounded-xl border p-3 text-left transition-colors', recipe === id ? 'border-accent/50 bg-accent/[0.08]' : 'border-line bg-panel hover:border-line-2')}
            >
              <span className="block text-[13px] font-medium">{x.label}</span>
              <span className="mt-1 block text-[11.5px] leading-snug text-dim">{x.body}</span>
            </button>
          ))}
        </div>
        <Panel title={r.label} sub={`${r.steps.length} ${r.steps.length === 1 ? 'step' : 'steps'}: ${r.steps.join(' → ')}`}>
          <div className="space-y-4">
            {r.needs && (
              <div>
                <Label>{recipe === 'product_scene' ? 'Product photo' : 'Starts from'}</Label>
                <button
                  type="button"
                  onClick={() => setPicking(true)}
                  className="mt-2 flex w-full items-center gap-3 rounded-md border border-dashed border-line-2 p-2 text-left text-[12.5px] text-muted hover:border-accent-soft/60 hover:text-fg"
                >
                  {start ? <MediaThumb asset={start} className="size-12" /> : <ImagePlus className="m-3 size-5" strokeWidth={1.5} />}
                  {start ? (start.name ?? 'Image') : 'Pick an image'}
                </button>
                <MediaPicker open={picking} onClose={() => setPicking(false)} onPick={(a) => setStart(a.find((x) => x.kind === 'image') ?? null)} max={1} initial={start ? [start] : []} />
              </div>
            )}
            <label className="block">
              <Label>{recipe === 'product_scene' ? 'The new scene' : recipe === 'image_to_video' ? 'Motion' : 'Prompt'}</Label>
              <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={3} className={cn(inputClass, 'mt-2 h-auto resize-none py-2')} />
            </label>
            {recipe === 'text_to_video' && (
              <label className="block">
                <Label>Then, the motion</Label>
                <input value={motion_} onChange={(e) => setMotion(e.target.value)} placeholder="Slow push in, the flame flickers" className={cn(inputClass, 'mt-2')} />
              </label>
            )}
            {r.steps.includes('image') && (
              <div>
                <Label>Image model</Label>
                <ModelPicker models={imageModels} kind="image" value={imageModel} onChange={setImageModel} className="mt-2" />
              </div>
            )}
            {r.steps.includes('video') && (
              <div>
                <Label>Video model</Label>
                <ModelPicker models={registry.models} kind="video" value={videoModel} onChange={setVideoModel} className="mt-2" />
              </div>
            )}
            <FieldError message={error} />
            <Btn variant="primary" icon={Wand2} onClick={run} loading={busy} disabled={!prompt.trim()} className="w-full">
              Run the recipe
            </Btn>
          </div>
        </Panel>
      </div>
      <div className="space-y-3">
        {recent.length === 0 ? (
          <EmptyState icon={Wand2} title="No recipes run yet" body="Each step starts on its own when the one before it finishes." />
        ) : (
          recent.map((g) => (
            <GenerationCard
              key={g.id}
              generation={g}
              models={registry.models}
              onRetry={async (x, change) => {
                await retryGeneration(x, change)
                invalidate()
              }}
              compact
            />
          ))
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Projects                                                             */
/* ------------------------------------------------------------------ */

function Projects({ onNew }: { onNew: () => void }) {
  const { data: projects } = useApi<Project[]>('/projects')
  const { navigate } = useRouter()

  if (!projects) return <Skeleton className="h-[160px] rounded-xl" />
  if (!projects.length) {
    return (
      <EmptyState
        icon={FolderKanban}
        title="No projects yet"
        body="A project is a canvas: drafts, photos, videos and notes, laid out side by side and connected."
        action={
          <Btn variant="primary" icon={Plus} onClick={onNew}>
            Start one
          </Btn>
        }
      />
    )
  }
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
      {projects.map((p, i) => (
        <motion.button
          key={p.id}
          type="button"
          onClick={() => navigate(`/dashboard/studio?project=${p.id}`)}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease, delay: Math.min(i, 8) * 0.04 }}
          className="group flex flex-col rounded-xl border border-line bg-panel p-4 text-left transition-colors hover:border-line-2"
        >
          <span className="flex items-start justify-between gap-3">
            <span className="truncate text-[14px] font-medium">{p.name}</span>
            <ArrowUpRight className="size-4 shrink-0 text-dim transition-transform duration-300 group-hover:rotate-45 group-hover:text-fg" strokeWidth={1.75} />
          </span>
          <span className="mt-6 font-mono text-[10.5px] text-dim">
            {p.nodes} on the canvas · {p.generations} made · {fmtRelative(p.updated_at)}
          </span>
        </motion.button>
      ))}
    </div>
  )
}

function NewProject({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { navigate } = useRouter()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const create = async () => {
    setBusy(true)
    try {
      const p = await api<Project>('/projects', { method: 'POST', body: { name: name.trim() } })
      onClose()
      setName('')
      navigate(`/dashboard/studio?project=${p.id}`)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal open={open} onClose={onClose} title="New project">
      <label className="block">
        <Label>Name</Label>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && name.trim() && create()} placeholder="Autumn launch" className={cn(inputClass, 'mt-2')} />
      </label>
      <div className="mt-5 flex justify-end gap-2">
        <Btn variant="subtle" onClick={onClose}>
          Cancel
        </Btn>
        <Btn variant="primary" icon={PenLine} onClick={create} loading={busy} disabled={!name.trim()}>
          Open the canvas
        </Btn>
      </div>
    </Modal>
  )
}
