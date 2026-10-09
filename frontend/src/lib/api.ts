import type { PlatformId } from '../components/ui/PlatformIcon'

/* ------------------------------------------------------------------ */
/* Shapes the Laravel API returns                                       */
/* ------------------------------------------------------------------ */

export type PostStatus = 'draft' | 'scheduled' | 'publishing' | 'submitted' | 'published' | 'failed'
export type PostFormat = 'text' | 'image' | 'video'
export type Provider = 'google' | 'github'

export type User = {
  id: number
  name: string
  email: string
  email_verified: boolean
  avatar_url: string | null
  timezone: string | null
  preferences: { platforms: PlatformId[]; formats: PostFormat[] }
  has_password: boolean
  /** The stop button: while true, nothing publishes automatically. */
  publishing_paused: boolean
  providers: Provider[]
  created_at: string
}

export type Post = {
  id: number
  title: string | null
  body: string
  format: PostFormat
  placement: string | null
  platforms: PlatformId[]
  status: PostStatus
  account: { id: number; platform: PlatformId; handle: string; automation: boolean } | null
  assets: Asset[]
  approved_at: string | null
  /** Proof it went live: set by a confirmed run, or by someone taking over by hand. */
  post_url: string | null
  error: string | null
  scheduled_at: string | null
  published_at: string | null
  created_at: string
  updated_at: string
  campaign?: { id: number; name: string | null } | null
  /** The platform's own id, when it went out through the platform's API. */
  external_id?: string | null
  published_via?: 'api' | null
  metrics?: PostMetrics | null
}

/** A published post's latest numbers, read back from the platform (its API, or a phone for X). */
export type PostMetrics = {
  likes: number | null
  comments: number | null
  shares: number | null
  saves: number | null
  views: number | null
  reach: number | null
  /** Facebook only: like, love, haha, wow, sad, angry, care. */
  reactions: Record<string, number> | null
  source: 'api' | 'phone' | null
  error: string | null
  fetched_at: string | null
}

/** An account connected through a platform's official API (Meta or X). */
export type Connection = {
  id: number
  provider: 'meta' | 'x'
  kind: 'instagram' | 'facebook_page' | 'x'
  platform: PlatformId
  name: string | null
  username: string | null
  account_id: number | null
  status: 'ok' | 'expired' | 'error'
  error: string | null
  token_expires_at: string | null
  checked_at: string | null
}

/** GET /connections */
export type Connections = { data: Connection[]; available: { meta: boolean; x: boolean }; public_media: boolean }

/** An image, video or voiceover in the media library. */
export type Asset = {
  id: number
  kind: 'image' | 'video' | 'audio'
  source: 'upload' | 'generated' | 'screenshot' | 'intake'
  name: string | null
  url: string
  poster_url: string | null
  mime: string
  size: number
  width: number | null
  height: number | null
  duration: number | null
  /** What a voiceover says. */
  script?: string | null
  board_id?: number | null
  created_at: string
}

/** A named shelf in the Creative Lab gallery. */
export type Board = { id: number; name: string; count: number; cover_url: string | null }

/** GET /boards */
export type Boards = { data: Board[]; unfiled: number }

export type WorkflowStepType = 'image' | 'upscale' | 'video' | 'voice' | 'write' | 'post'

/** One step in a workflow. {prompt} is what the run starts with; {caption}, the latest text written. */
export type WorkflowStep = {
  type: WorkflowStepType
  model?: string | null
  prompt?: string
  script?: string
  aspect_ratio?: string
  duration?: number
  scale?: number
  voice?: string
  use_previous?: boolean
  platforms?: string[]
}

export type Workflow = { id: number; name: string; steps: WorkflowStep[]; updated_at: string | null }

/** GET /workflows */
export type Workflows = {
  data: Workflow[]
  templates: Array<{ name: string; body: string; needs_image?: boolean; steps: WorkflowStep[] }>
  types: Array<{ id: WorkflowStepType; kind: 'image' | 'video' | 'audio' | 'text' | null; label: string }>
}

export type WorkflowRun = {
  id: number
  workflow_id: number | null
  name: string
  prompt: string | null
  status: 'running' | 'succeeded' | 'failed'
  step: number
  error: string | null
  steps: Array<{ type: WorkflowStepType; status: 'waiting' | 'running' | 'succeeded' | 'failed'; assets: Asset[]; text: string | null; post_id: number | null }>
  created_at: string
  finished_at: string | null
}

export type EditorialProfile = Partial<Record<'tone' | 'topics' | 'style' | 'do' | 'avoid' | 'language' | 'hashtags', string>>

/** A proposed change to one profile field: nothing applies until it's approved. */
export type ProfileChange = {
  id: number
  field: keyof EditorialProfile
  from: string | null
  to: string | null
  reason: string | null
  source: 'operator' | 'ai'
  status: 'pending' | 'approved' | 'rejected'
  decided_at: string | null
  created_at: string | null
}

/** GET /accounts/{id}/voice: the account's editorial identity and memory. */
export type AccountVoice = {
  profile: EditorialProfile
  memory: Record<'instruction' | 'example' | 'history', Array<{ id: number; content: string; source: string; meta: Record<string, unknown> | null; created_at: string | null }>>
  changes: ProfileChange[]
}

/** A social account the studio posts to. */
export type Account = {
  id: number
  platform: PlatformId
  handle: string
  name: string | null
  label: string
  timezone: string | null
  device: { id: number; name: string; driver: 'simulator' | 'http'; status: string } | null
  device_id: number | null
  /** Automated publishing allowed on this account. */
  automation: boolean
  /** approve_all: mode A, every action waits. rules: mode B, approved rules run on their own. */
  autonomy: 'approve_all' | 'rules'
  min_gap_minutes: number
  /** auto: the platform's API when connected, else the phone. */
  publish_via: 'auto' | 'api' | 'phone'
  connection?: Connection | null
  profile: EditorialProfile
  posts_count?: number
  created_at: string
}

/** A phone that publishes. */
export type Device = {
  id: number
  name: string
  driver: 'simulator' | 'http'
  ref: string | null
  status: 'idle' | 'busy' | 'offline' | 'error' | 'paused'
  profile: 'reliable' | 'flaky' | 'broken'
  booked_run_id: number | null
  paused: boolean
  last_seen_at: string | null
  /** Simulators always; an HTTP phone while its agent keeps checking in. */
  online: boolean
  model: string | null
  android: string | null
  screen: [number, number] | null
  /** HTTP phones: 'adb' for a real phone on the agent's computer, 'simulator' for its stand-in. */
  agent_kind: 'adb' | 'emulator' | 'simulator' | 'remote' | null
  /** The agent's live view and remote control, when it serves one. */
  mirror_url: string | null
  screenshot_url: string | null
  accounts: Array<{ id: number; platform: PlatformId; handle: string }>
  created_at: string
}

/** GET /publishing/agent: the phone agent as it last checked in. */
export type AgentStatus = {
  online: boolean
  /** Where it serves the device scan and the live view. */
  url: string | null
  host: string | null
  os: string | null
  version: string | null
  adb: boolean
  scrcpy: boolean
  last_seen_at: string | null
}

/** The agent's GET /scan: every device its computer could drive, and what each needs. */
export type ScanResult = {
  adb: boolean
  adb_path: string
  hint: string | null
  connected: Array<{
    serial: string
    name: string
    connection: 'usb' | 'wifi' | 'emulator'
    status: 'ready' | 'needs-allow' | 'offline'
    hint: string
    android: string | null
    screen: [number, number] | null
    /** The agent is already running jobs on it. */
    working: boolean
  }>
  nearby: Array<{ name: string; address: string; action: 'connect' | 'pair'; hint: string }>
  emulators: { available: boolean; avds: Array<{ name: string; running: boolean }>; hint: string }
  simulated: string[]
}

/** POST /checks: one platform's pre-export check. */
export type SpecCheck = {
  ok: boolean
  platform: PlatformId
  placement: string
  label: string
  checks: Array<{ key: string; status: 'pass' | 'warn' | 'fail'; label: string; detail: string }>
}

/** Something waiting on a person. */
export type InboxItem = {
  kind: string
  key: string
  title: string
  detail: string
  at: string | null
  link: string
  tone: 'fail' | 'warn' | 'plan' | 'accent'
  /** Set on publish_failed / publish_unconfirmed: the post the recovery actions act on. */
  post_id?: number
}

/** One attempt to publish a post from a phone — the hand-in record, plus what it belongs to. */
export type PublishingRun = {
  run_id: string
  goal: string
  account: string | null
  started_at: string | null
  ended_at: string | null
  outcome: 'running' | 'confirmed' | 'failed' | 'uncertain'
  evidence: { kind: 'post_url' | 'screenshot'; ref: string | null; note: string | null } | null
  steps: Array<{ n: number; action: string; ok: boolean; ms: number; note?: string }>
  totals: { steps: number; wall_clock_ms: number; spend: number }
  id: number
  attempt: number
  error: string | null
  post?: { id: number; title: string | null; status: PostStatus; placement: string | null }
  device?: { id: number | null; name: string | null }
  screenshot_url: string | null
}

/** GET /publishing/usage: what a typical run costs. */
export type PublishingUsage = {
  runs: number
  typical: { steps: number; wall_clock_ms: number; spend: number }
  outcomes: Partial<Record<'confirmed' | 'failed' | 'uncertain', number>>
}

/* ------------------------------------------------------------------ */
/* Autonomy (mode B rules), reposts, comments                          */
/* ------------------------------------------------------------------ */

export type AutonomyAction = 'publish.approved_post' | 'profile.apply_ai_change' | 'comment.send_reply' | 'repost.schedule'

export type AutonomyRuleInfo = {
  id: number
  action: AutonomyAction
  label: string
  allow: boolean
  conditions: { max_per_day?: number } | null
  created_at: string
}

export type AutonomyMatrixRow = {
  action: AutonomyAction
  label: string
  detail: string
  mode_a: string
  mode_b: string
  now: 'runs' | 'asks'
  rule_id: number | null
}

/** GET /accounts/{id}/autonomy */
export type AccountAutonomy = {
  mode: Account['autonomy']
  matrix: AutonomyMatrixRow[]
  rules: AutonomyRuleInfo[]
}

export type PreviewItem = { kind: AutonomyAction; label: string; verdict: string }

/** An X post picked for reuse on Instagram. */
export type Repost = {
  id: number
  source_url: string
  author: string
  source_text: string
  permission: 'pending' | 'allowed' | 'denied'
  permission_note: string | null
  status: 'captured' | 'adapted' | 'scheduled' | 'dropped'
  caption: string | null
  caption_with_credit: string | null
  hashtags: string[]
  attribution: boolean
  post_id: number | null
  account: { id: number; platform: PlatformId; handle: string } | null
  created_at: string
}

/** A comment in the inbox, triaged by the AI, replied to by a human. */
export type Comment = {
  id: number
  author: string
  body: string
  post_ref: string | null
  status: 'new' | 'drafted' | 'sent' | 'ignored' | 'human'
  triage: { decision: 'reply' | 'ignore' | 'human'; reason: string } | null
  draft: string | null
  reply: string | null
  sent_at: string | null
  /** It came in from the platform, so the reply goes back there too. */
  from_platform?: boolean
  posted_at?: string | null
  account: { id: number; platform: PlatformId; handle: string } | null
  created_at: string
}

/** One finding of an investigation. */
export type Finding = {
  rule: string
  severity: 'high' | 'medium' | 'low'
  subject: string
  detail: string
  verdict: 'issue' | 'explained'
  note: string | null
}

/** One pass of collect → compare → validate → report. */
export type Investigation = {
  id: number
  title: string
  status: 'running' | 'done' | 'failed'
  stage: string
  stages: Array<{ name: string; summary: string; ms: number }>
  counts: { posts: number; runs: number; devices: number; issues: number } | null
  open_issues: number
  account: { id: number; platform: PlatformId; handle: string } | null
  error: string | null
  created_at: string
  findings?: Finding[]
  report?: string | null
}

/** A model in the registry: local or cloud, and whether it can run right now. */
/** What the studio's controls may offer for an image or video model (null lists: the usual choices). */
export type ModelCaps = {
  aspects: string[] | null
  durations: number[] | null
  resolutions: string[] | null
  default_resolution: string | null
  /** Takes input images: references for photos, a start frame for video. */
  image_input: boolean
  requires_image: boolean
  max_images: number
  end_frame: boolean
  audio: boolean
  seed: boolean
}

export type ModelInfo = {
  id: string
  provider: 'anthropic' | 'gateway' | 'ollama' | 'higgsfield' | 'google' | 'comfyui' | 'invoke' | 'voicestudio'
  model: string
  label: string
  kind: 'text' | 'image' | 'video' | 'audio'
  /** Soul, Kling, Seedance… for grouping in the picker. */
  family: string | null
  /** What the Reels Lab's controls may offer (Higgsfield-spec shape). The workbench reads `capabilities`. */
  caps: ModelCaps | null
  /** How it's reached: Claude API, Gateway, Ollama, Higgsfield API. */
  reach: string
  local: boolean
  available: boolean
  reason: string | null
  purpose: string | null
  /** Average eval score, 0–100, once evaluated. */
  score: number | null
  capabilities: {
    aspect_ratios?: string[]
    durations?: number[]
    resolutions?: string[]
    default_resolution?: string
    max_inputs?: number
    input_optional?: boolean
    requires_image?: boolean
    end_frame?: boolean
    audio?: boolean
    audio_always_on?: boolean
    seed?: boolean
    max_outputs?: number
    /** Speech: the voices it can read in, the file types and the speeds offered. */
    voices?: Array<{ id: string; name: string; language: string | null }>
    formats?: string[]
    speeds?: number[]
    /** Takes a negative prompt; render settings with their defaults; can repaint a masked area. */
    negative_prompt?: boolean
    steps?: number
    guidance?: number
    edit?: boolean
    /** An upscaler: takes an image and makes it larger; can't make one from a prompt. */
    upscale?: boolean
    scales?: number[]
  }
}

/** GET /ai: whether the composer can offer AI writing, and with which models. */
export type AiOptions = {
  enabled: boolean
  default: string
  models: ModelInfo[]
}

export type ModelProvider = {
  id: ModelInfo['provider']
  reach: string
  local: boolean
  configured: boolean
  setup: string
  test: { ok: boolean; message: string; latency_ms: number | null; at: string | null } | null
}

export type Recipe = { label: string; body: string; needs: 'image' | null; steps: Array<'image' | 'video'> }

/** GET /models */
export type Registry = { models: ModelInfo[]; providers: ModelProvider[]; recipes: Record<string, Recipe>; default_text: string }

export type Generation = {
  id: number
  kind: 'text' | 'image' | 'video' | 'audio'
  model: string
  model_label: string
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled'
  prompt: string
  params: Record<string, string | number | boolean>
  inputs: Asset[]
  outputs: Asset[]
  output_text: string | null
  error: string | null
  retry_of: number | null
  recipe: string | null
  recipe_step: number | null
  parent_id: number | null
  project_id: number | null
  cost: number
  created_at: string
  started_at: string | null
  finished_at: string | null
}

export type CanvasNode = { id: string; type: 'note' | 'text' | 'asset' | 'generation'; x: number; y: number; text?: string | null; ref?: number | null }
export type Canvas = { nodes: CanvasNode[]; edges: Array<{ from: string; to: string }>; view: { x: number; y: number; zoom: number } }
export type Project = { id: number; name: string; nodes: number; generations: number; updated_at: string; canvas?: Canvas }

export type CampaignStage = 'brief' | 'planning' | 'plan_review' | 'producing' | 'adapting' | 'content_review' | 'scheduled'

/** A campaign in the list: GET /campaigns. */
export type CampaignSummary = {
  id: number
  title: string | null
  name: string | null
  /** intake: the interview; form: the short brief form. */
  source: 'intake' | 'form'
  stage: CampaignStage
  items_count: number
  period_start: string | null
  period_end: string | null
  depth: 'quick' | 'full'
  complete: boolean
  filled: number
  total: number
  photo_count: number
  has_kit: boolean
  completed_at: string | null
  created_at: string
  updated_at: string
}

export type CampaignMessage = { who: 'agency' | 'client' | 'note'; text: string; photos?: number[] }

export type CampaignPhoto = {
  id: number
  url: string
  mime: string
  kind: 'person' | 'product' | 'place' | 'other' | null
  title: string | null
  description: string | null
}

/** One campaign, everything the intake page shows: GET /campaigns/{id}. */
export type Campaign = CampaignSummary & {
  /** ai: Claude runs the interview. script: the standard question list does. */
  mode: 'ai' | 'script'
  ai_available: boolean
  asked: number
  max_questions: number
  /** The brief field the open question is about. */
  pending: string | null
  /** The client spoke last and the interview owes them a question (a turn failed). */
  awaiting_reply: boolean
  brief: Array<{
    id: string
    label: string
    fields: Array<{ key: string; label: string; value: string; suggested: boolean }>
  }>
  messages: CampaignMessage[]
  /** Answer chips under the open question, and whether to offer a photo upload. */
  prompt: { options: string[]; photos: boolean } | null
  photos: CampaignPhoto[]
  max_photos: number
  kit: string | null
  /** The brief as Markdown, for copying and the download. */
  markdown: string
  brief_form: BriefForm
  brief_ready: boolean
  account_ids: number[]
  autonomy: 'approve_all' | null
  plan: { big_idea: string; pillars: Array<{ name: string; why: string }> } | null
  plan_approved_at: string | null
  /** How many posts the writer plans for the period. */
  post_count: number
  steps: AgentStepInfo[]
}

export type BriefForm = Partial<Record<'goal' | 'audience' | 'message' | 'key_facts' | 'deadline' | 'rhythm', string>>

export type AgentStepInfo = {
  id: number
  agent: 'writer' | 'visual_director' | 'media' | 'adapter' | 'qa' | 'scheduler' | 'publisher'
  status: 'running' | 'done' | 'failed'
  summary: string | null
  error: string | null
  cost: number
  started_at: string | null
  finished_at: string | null
}

export type ItemVariant = {
  id: number
  account: { id: number; platform: PlatformId; handle: string; name: string | null; timezone: string }
  mode: 'shared' | 'adapted'
  caption: string | null
  placement: string | null
  checks: (SpecCheck & { moved_from?: string }) | null
  qa: { status: 'pass' | 'warn' | 'fail'; issues: string[]; edited?: boolean } | null
  status: 'draft' | 'approved' | 'rejected'
  feedback: string | null
  approved_at: string | null
  posts: Array<{ id: number; status: PostStatus; scheduled_at: string | null; post_url: string | null }>
}

export type CampaignItem = {
  id: number
  position: number
  title: string
  pillar: string | null
  format: 'text' | 'image' | 'video' | 'carousel'
  message: string | null
  hook: string | null
  caption: string | null
  visual: string | null
  prompts: string[]
  reference_photo: number | null
  account_ids: number[]
  source: 'ai' | 'upload'
  status: 'planned' | 'producing' | 'needs_media' | 'ready' | 'failed'
  error: string | null
  assets: Asset[]
  shots: Array<{ n: number; description: string; camera: string; duration: number; status: 'planned' | 'still' | 'moving' | 'done' | 'failed'; error: string | null; still: Asset | null; clip: Asset | null }>
  generating: number
  variants: ItemVariant[]
}

export type Conflict = { kind: 'phone' | 'gap' | 'approvals'; message: string; post_ids: number[] }

export type Page<T> = {
  data: T[]
  meta: { current_page: number; last_page: number; per_page: number; total: number }
}

/* ------------------------------------------------------------------ */
/* Client                                                               */
/* ------------------------------------------------------------------ */

export class ApiError extends Error {
  status: number
  errors: Record<string, string[]>

  constructor(status: number, message: string, errors: Record<string, string[]> = {}) {
    super(message)
    this.status = status
    this.errors = errors
  }

  /** The first validation message for a field, if Laravel sent one. */
  field(name: string) {
    return this.errors[name]?.[0] ?? null
  }
}

type Query = Record<string, string | number | boolean | null | undefined>
type Options = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown
  query?: Query
}

function xsrfToken() {
  const match = document.cookie.match(/(?:^|; )XSRF-TOKEN=([^;]*)/)
  return match ? decodeURIComponent(match[1]) : null
}

// Laravel hands out the CSRF token as a cookie; fetch it once before the first write.
let csrfInFlight: Promise<void> | null = null
function ensureCsrfCookie() {
  if (xsrfToken()) return Promise.resolve()
  csrfInFlight ??= fetch('/sanctum/csrf-cookie', { credentials: 'same-origin' })
    .then(() => undefined)
    .finally(() => {
      csrfInFlight = null
    })
  return csrfInFlight
}

function toQueryString(query?: Query) {
  if (!query) return ''
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== '') params.set(k, String(v))
  }
  const s = params.toString()
  return s ? `?${s}` : ''
}

/** Send a request and return the response once it's known to be a success; anything else throws an ApiError. */
async function send(path: string, options: Options & { signal?: AbortSignal }, retry = true): Promise<Response> {
  const method = options.method ?? 'GET'
  if (method !== 'GET') await ensureCsrfCookie()

  const headers: Record<string, string> = { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' }
  const token = xsrfToken()
  if (token) headers['X-XSRF-TOKEN'] = token
  // Files go up as multipart; the browser sets that Content-Type, boundary included.
  const form = options.body instanceof FormData
  if (options.body !== undefined && !form) headers['Content-Type'] = 'application/json'

  let res: Response
  try {
    res = await fetch(`/api${path}${toQueryString(options.query)}`, {
      method,
      headers,
      credentials: 'same-origin',
      body: options.body === undefined ? undefined : form ? (options.body as FormData) : JSON.stringify(options.body),
      signal: options.signal,
    })
  } catch (e) {
    if (options.signal?.aborted) throw e
    throw new ApiError(0, 'Can’t reach FlowAI right now. Check your connection and try again.')
  }

  // The token went stale (session expired, or a sign-in rotated it): get a fresh one, retry once.
  if (res.status === 419 && retry) {
    document.cookie = 'XSRF-TOKEN=; Max-Age=0; path=/'
    await ensureCsrfCookie()
    return send(path, options, false)
  }

  if (!res.ok) {
    const data = await res.json().catch(() => null)
    const fallback =
      res.status >= 500 ? 'Something went wrong on our side. Try again in a moment.' : `Request failed (${res.status}).`
    throw new ApiError(res.status, data?.message ?? fallback, data?.errors)
  }
  return res
}

export async function api<T = unknown>(path: string, options: Options = {}): Promise<T> {
  const res = await send(path, options)
  if (res.status === 204) return undefined as T
  return (await res.json().catch(() => null)) as T
}

/**
 * Upload files as multipart, reporting progress (0–1) as they go up: fetch can't, so this
 * uses XMLHttpRequest. Errors come back as ApiError, like everything else.
 */
export async function uploadFiles<T>(path: string, files: File[], onProgress?: (fraction: number) => void, field = 'files[]'): Promise<T> {
  await ensureCsrfCookie()
  const form = new FormData()
  files.forEach((f) => form.append(field, f))

  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `/api${path}`)
    xhr.withCredentials = true
    xhr.setRequestHeader('Accept', 'application/json')
    xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest')
    const token = xsrfToken()
    if (token) xhr.setRequestHeader('X-XSRF-TOKEN', token)
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total)
    xhr.onerror = () => reject(new ApiError(0, 'Can’t reach FlowAI right now. Check your connection and try again.'))
    xhr.onload = () => {
      let data: { message?: string; errors?: Record<string, string[]> } | null = null
      try {
        data = JSON.parse(xhr.responseText)
      } catch {
        /* not JSON */
      }
      if (xhr.status >= 200 && xhr.status < 300) return resolve(data as T)
      if (xhr.status === 413) return reject(new ApiError(413, 'That file is too big to upload.'))
      reject(new ApiError(xhr.status, data?.message ?? `Upload failed (${xhr.status}).`, data?.errors))
    }
    xhr.send(form)
  })
}

export type StreamEvent = { event: string; data: unknown }

/**
 * POST, then read the reply as server-sent events, handing each to `onEvent` as it arrives.
 * A request the API turns down before streaming (validation, auth) throws like `api()` does.
 */
export async function apiStream(
  path: string,
  body: unknown,
  onEvent: (e: StreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await send(path, { method: 'POST', body, signal })
  if (!res.body) throw new ApiError(0, 'Can’t reach FlowAI right now. Check your connection and try again.')

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) return
    buffer += value

    let end: number
    while ((end = buffer.indexOf('\n\n')) !== -1) {
      const block = buffer.slice(0, end)
      buffer = buffer.slice(end + 2)

      let event = 'message'
      const data: string[] = []
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim()
        else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''))
      }
      if (data.length) onEvent({ event, data: JSON.parse(data.join('\n')) })
    }
  }
}
