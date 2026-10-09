import { useCallback, useEffect, useRef, useState } from 'react'
import { BookmarkPlus, Bot, Check, CircleStop, LoaderCircle, Play, Send, ShieldQuestion, X } from 'lucide-react'
import { api } from '../../lib/api'
import { cn } from '../../lib/cn'
import { fmtRelative } from '../data'
import { useToast } from '../toast'
import { Btn, inputClass, Label, Segmented } from '../ui'

type Task = {
  id: string
  goal: string
  status: 'queued' | 'starting' | 'running' | 'awaiting_approval' | 'idle' | 'succeeded' | 'failed' | 'cancelled'
  mode: string
  steps: number
  result_text: string | null
  result_data: unknown
  error: string | null
  verified: boolean | null
  verdict: string | null
  created_at: string | null
  recipe_id: string | null
}
type AgentEvent = { seq: number; type: string; ts: string; data: Record<string, unknown> }
type Approval = { id: string; task_id: string; action: string; reason: string; params: Record<string, unknown>; expires_at: string }
type Recipe = { id: string; name: string; status: string; run_count: number; last_run_at: string | null }

// "idle" is a task that has answered (it could take a follow-up); finished for our purposes.
const DONE = ['succeeded', 'idle', 'failed', 'cancelled']
const OK = ['succeeded', 'idle']
// Bookkeeping the panel doesn't show: token counts and the stored screenshots.
const HIDDEN = ['usage', 'artifact']
const EXAMPLES = [
  'Open the Settings app and tell me the Android version.',
  'Open Photos and tell me how many photos are in the library.',
  'Open Settings > Battery and report the battery level.',
]

/** One readable line per event: "3. Open About phone", "tap x=0.5, y=0.23", the answer, the status. */
function eventText(e: AgentEvent): string {
  const d = (e.data ?? {}) as Record<string, unknown>
  if (e.type === 'step') return `${d.n}. ${String(d.next_goal ?? d.evaluation ?? d.title ?? '')}`
  if (e.type === 'action') {
    const params = Object.entries((d.params ?? {}) as Record<string, unknown>)
      .filter(([k]) => k !== 'transport' && k !== 'perception')
      .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
      .join(', ')
    return `${String(d.name)} ${params}${d.error ? ` — failed: ${String(d.error)}` : ''}`
  }
  if (e.type === 'result') return String(d.text ?? JSON.stringify(d.data))
  if (e.type === 'status') return `${String(d.status ?? '')}${d.detail ? `: ${String(d.detail)}` : ''}`
  for (const key of ['text', 'message', 'error', 'reason']) {
    const v = d[key]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return Object.keys(d).length ? JSON.stringify(d).slice(0, 220) : ''
}

/**
 * The hackathon's own phone agent, from FlowAI: give it a goal in plain words and it looks at
 * the screen and acts. Watch it work, answer when it asks permission, keep a good run as a recipe.
 * Everything goes through the FlowAI agent on this computer, which holds the team key.
 */
export function AgentPanel({ base, phoneRef }: { base: string; phoneRef: string }) {
  const toast = useToast()
  const [token, setToken] = useState<string | null>(null)
  const [goal, setGoal] = useState('')
  const [mode, setMode] = useState<'flash' | 'pro'>('flash')
  const [maxSteps, setMaxSteps] = useState(25)
  const [format, setFormat] = useState<'text' | 'table' | 'json'>('text')
  const [tasks, setTasks] = useState<Task[]>([])
  const [current, setCurrent] = useState<Task | null>(null)
  const [events, setEvents] = useState<AgentEvent[]>([])
  const [approvals, setApprovals] = useState<Approval[]>([])
  const [recipes, setRecipes] = useState<Recipe[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const seq = useRef(0)

  useEffect(() => {
    api<{ token: string }>('/publishing/agent-token')
      .then((r) => setToken(r.token))
      .catch(() => {})
  }, [])

  const hack = useCallback(
    async <T,>(path: string, body?: unknown): Promise<T> => {
      const r = await fetch(`${base}/phones/${encodeURIComponent(phoneRef)}/hack/${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { 'X-Agent-Token': token ?? '', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      const json = (await r.json().catch(() => ({}))) as { ok?: boolean; data?: T; error?: { message?: string }; message?: string }
      if (!r.ok || json.ok === false) throw new Error(json.error?.message ?? json.message ?? `The phone agent answered ${r.status}.`)
      return json.data as T
    },
    [base, phoneRef, token],
  )

  // What's there already: recent tasks, recipes, and anything waiting for an answer.
  const refresh = useCallback(async () => {
    if (!token) return
    try {
      const [list, rs, ap] = await Promise.all([hack<{ items: Task[] }>('tasks?limit=10'), hack<Recipe[]>('recipes'), hack<Approval[]>('approvals?status=pending')])
      setTasks(list.items ?? [])
      setRecipes(rs ?? [])
      setApprovals(ap ?? [])
    } catch {
      /* the phone service comes and goes; the next tick tries again */
    }
  }, [hack, token])

  useEffect(() => {
    refresh()
    const t = window.setInterval(refresh, 5000)
    return () => window.clearInterval(t)
  }, [refresh])

  // Follow the open task: its status, and new events as they arrive.
  useEffect(() => {
    if (!token || !current || DONE.includes(current.status)) return
    const t = window.setInterval(async () => {
      try {
        const [task, fresh] = await Promise.all([hack<Task>(`tasks/${current.id}`), hack<AgentEvent[]>(`tasks/${current.id}/events?after_seq=${seq.current}`)])
        if (fresh?.length) {
          seq.current = Math.max(seq.current, ...fresh.map((e) => e.seq))
          setEvents((prev) => [...prev, ...fresh])
        }
        setCurrent(task)
        if (task.status === 'awaiting_approval') setApprovals(await hack<Approval[]>('approvals?status=pending'))
      } catch {
        /* try again next tick */
      }
    }, 2000)
    return () => window.clearInterval(t)
  }, [current, hack, token])

  const open = async (task: Task) => {
    seq.current = 0
    setCurrent(task)
    setEvents([])
    try {
      const all = await hack<AgentEvent[]>(`tasks/${task.id}/events?after_seq=0`)
      seq.current = Math.max(0, ...all.map((e) => e.seq))
      setEvents(all)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Couldn’t load what it did.', 'error')
    }
  }

  const act = async (label: string, fn: () => Promise<unknown>, done?: string) => {
    setBusy(label)
    try {
      await fn()
      if (done) toast(done)
      refresh()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'The phone agent didn’t take that.', 'error')
    } finally {
      setBusy(null)
    }
  }

  const start = () =>
    act('start', async () => {
      if (!goal.trim()) throw new Error('Tell the agent what to do.')
      const task = await hack<Task>('tasks', { goal: goal.trim(), mode, max_steps: maxSteps, output_format: format })
      setGoal('')
      await open(task)
    })

  const mine = approvals.filter((a) => !current || a.task_id === current.id)

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <div className="rounded-lg border border-line p-3">
        <Label className="flex items-center gap-1.5">
          <Bot className="size-3.5" /> Phone agent
        </Label>
        <textarea
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === 'Enter' && start()}
          rows={3}
          placeholder="Tell the phone agent what to do and what to report back."
          className={cn(inputClass, 'mt-2 h-auto resize-y py-2 text-[12.5px] leading-snug')}
        />
        <div className="mt-1.5 flex flex-wrap gap-1">
          {EXAMPLES.map((x) => (
            <button key={x} type="button" onClick={() => setGoal(x)} className="max-w-full truncate rounded-full border border-line px-2 py-0.5 text-[10.5px] text-dim hover:text-muted">
              {x}
            </button>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div>
            <Label>Mode</Label>
            <Segmented id="agent-mode" label="Mode" className="mt-1" value={mode} onChange={setMode} options={[{ value: 'flash' as const, label: 'flash' }, { value: 'pro' as const, label: 'pro (checked)' }]} />
          </div>
          <label>
            <Label>Max steps</Label>
            <input type="number" min={1} max={200} value={maxSteps} onChange={(e) => setMaxSteps(Math.max(1, Math.min(200, Number(e.target.value) || 1)))} className={cn(inputClass, 'mt-1 h-9 w-20')} />
          </label>
          <div>
            <Label>Answer as</Label>
            <Segmented id="agent-format" label="Answer as" className="mt-1" value={format} onChange={setFormat} options={[{ value: 'text' as const, label: 'text' }, { value: 'table' as const, label: 'table' }, { value: 'json' as const, label: 'json' }]} />
          </div>
          <Btn variant="primary" icon={Send} onClick={start} loading={busy === 'start'} disabled={!token} className="ml-auto">
            Start
          </Btn>
        </div>
        <p className="mt-2 text-[10.5px] text-dim">One run at a time on the phone. flash is fast; pro adds an independent check of the answer. Ctrl+Enter starts.</p>
      </div>

      {mine.map((a) => (
        <div key={a.id} className="rounded-lg border border-warn/40 bg-warn/[0.06] p-3">
          <p className="flex items-center gap-1.5 text-[12.5px] font-medium">
            <ShieldQuestion className="size-4 text-warn" /> The agent asks before it does this
          </p>
          <p className="mt-1 text-[12px] text-muted">
            <span className="font-mono text-[11px] text-fg">{a.action}</span> — {a.reason}
          </p>
          <div className="mt-2 flex gap-1.5">
            <Btn size="sm" variant="primary" icon={Check} loading={busy === `ok-${a.id}`} onClick={() => act(`ok-${a.id}`, () => hack(`approvals/${a.id}`, { approved: true }), 'Approved.')}>
              Approve
            </Btn>
            <Btn size="sm" variant="subtle" icon={X} loading={busy === `no-${a.id}`} onClick={() => act(`no-${a.id}`, () => hack(`approvals/${a.id}`, { approved: false }), 'Refused.')}>
              Refuse
            </Btn>
          </div>
        </div>
      ))}

      {current && (
        <div className="rounded-lg border border-line p-3">
          <div className="flex items-start gap-2">
            <p className="min-w-0 flex-1 text-[12.5px] font-medium leading-snug">{current.goal}</p>
            <span className={cn('shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px]', OK.includes(current.status) ? 'bg-ok/15 text-ok' : current.status === 'failed' ? 'bg-fail/15 text-fail' : DONE.includes(current.status) ? 'bg-white/[0.06] text-dim' : 'bg-accent/15 text-accent-soft')}>
              {!DONE.includes(current.status) && <LoaderCircle className="mr-1 inline size-2.5 animate-spin" />}
              {current.status === 'idle' ? 'done' : current.status.replace('_', ' ')} · {current.steps} steps
            </span>
          </div>
          <ol className="mt-2 max-h-48 space-y-1 overflow-y-auto pr-1" data-lenis-prevent>
            {events.filter((e) => !HIDDEN.includes(e.type)).map((e) => (
              <li key={e.seq} className="text-[11px] leading-snug text-muted">
                <span className="mr-1.5 font-mono text-[9.5px] text-dim">{e.type}</span>
                {eventText(e)}
              </li>
            ))}
            {!events.length && <li className="text-[11px] text-dim">Waiting for its first step…</li>}
          </ol>
          {DONE.includes(current.status) && (
            <div className="mt-2 border-t border-line pt-2">
              {(current.result_text || current.result_data != null) && (
                <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded bg-white/[0.03] p-2 font-mono text-[11px] text-fg">
                  {current.result_text ?? JSON.stringify(current.result_data, null, 2)}
                </pre>
              )}
              {current.error && <p className="mt-1 text-[11.5px] text-fail">{current.error}</p>}
              {current.verified !== null && (
                <p className={cn('mt-1 text-[11px]', current.verified ? 'text-ok' : 'text-warn')}>
                  {current.verified ? 'Checked: the answer holds up.' : 'The check didn’t agree with the answer.'} {current.verdict ?? ''}
                </p>
              )}
              {OK.includes(current.status) && !current.recipe_id && (
                <Btn
                  size="sm"
                  variant="subtle"
                  icon={BookmarkPlus}
                  className="mt-2"
                  loading={busy === 'recipe'}
                  onClick={() => act('recipe', () => hack(`tasks/${current.id}/recipe`, { name: current.goal.slice(0, 80) }), 'Saved as a recipe: it can run again without the AI.')}
                >
                  Save as recipe
                </Btn>
              )}
            </div>
          )}
          {!DONE.includes(current.status) && (
            <Btn size="sm" variant="subtle" icon={CircleStop} className="mt-2" loading={busy === 'cancel'} onClick={() => act('cancel', () => hack(`tasks/${current.id}/cancel`, {}), 'Stopped.')}>
              Stop
            </Btn>
          )}
        </div>
      )}

      {recipes.length > 0 && (
        <div className="rounded-lg border border-line p-3">
          <Label>Recipes</Label>
          <ul className="mt-2 space-y-1">
            {recipes.map((r) => (
              <li key={r.id} className="flex items-center gap-2 text-[12px]">
                <span className="min-w-0 flex-1 truncate">{r.name}</span>
                <span className="font-mono text-[10px] text-dim">{r.run_count} runs</span>
                <Btn
                  size="sm"
                  variant="ghost"
                  icon={Play}
                  loading={busy === `run-${r.id}`}
                  onClick={() =>
                    act(`run-${r.id}`, async () => {
                      const task = await hack<Task | { task?: Task }>(`recipes/${r.id}/run`, { params: {}, allow_heal: true })
                      const started = (task as { task?: Task }).task ?? (task as Task)
                      if (started?.id) await open(started)
                    }, 'Running the recipe.')
                  }
                >
                  Run
                </Btn>
              </li>
            ))}
          </ul>
        </div>
      )}

      {tasks.length > 0 && (
        <div className="rounded-lg border border-line p-3">
          <Label>Runs</Label>
          <ul className="mt-2 space-y-1">
            {tasks.map((t) => (
              <li key={t.id}>
                <button type="button" onClick={() => open(t)} className={cn('flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-[11.5px] hover:bg-white/[0.04]', current?.id === t.id && 'bg-white/[0.05]')}>
                  <span className={cn('size-1.5 shrink-0 rounded-full', OK.includes(t.status) ? 'bg-ok' : t.status === 'failed' ? 'bg-fail' : DONE.includes(t.status) ? 'bg-draft' : 'bg-accent-soft')} />
                  <span className="min-w-0 flex-1 truncate">{t.goal}</span>
                  <span className="shrink-0 font-mono text-[9.5px] text-dim">{t.created_at ? fmtRelative(t.created_at) : ''}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
