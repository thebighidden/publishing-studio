import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Bot, CirclePause, CirclePlay, Copy, Eye, EyeOff, KeyRound, MonitorSmartphone, Plus, Radar, RefreshCw, Smartphone, Trash2 } from 'lucide-react'
import { Serif } from '../../components/ui/Reveal'
import { api, ApiError, type AgentStatus, type Device, type PublishingRun } from '../../lib/api'
import { ease } from '../../lib/motion'
import { cn } from '../../lib/cn'
import { fmtRelative, useApi, useInvalidate } from '../data'
import { useToast } from '../toast'
import { LiveView } from '../phones/LiveView'
import { ScanDevices } from '../phones/ScanDevices'
import { Btn, EmptyState, FieldError, inputClass, Label, Modal, PageHeader, Segmented, Skeleton, Stagger } from '../ui'

/** /dashboard/phones: the phones that publish, their latest screens, and the automation service. */
export default function Phones() {
  const { data: devices, loading } = useApi<Device[]>('/devices')
  const { data: runs } = useApi<PublishingRun[]>('/publishing/runs')
  const { data: agent } = useApi<AgentStatus>('/publishing/agent')
  const [editing, setEditing] = useState<Device | 'new' | null>(null)
  const [removing, setRemoving] = useState<Device | null>(null)
  const [scanning, setScanning] = useState(false)
  const invalidate = useInvalidate()

  // While a phone is working, keep its live strip moving; otherwise check now and then, so a
  // phone plugged into the agent's computer appears without a reload.
  const busy = devices?.some((d) => d.status === 'busy') ?? false
  useEffect(() => {
    const t = window.setInterval(invalidate, busy ? 4000 : 15000)
    return () => window.clearInterval(t)
  }, [busy, invalidate])

  return (
    <div>
      <PageHeader
        eyebrow="Phones"
        title={
          <>
            The phones that <Serif>post.</Serif>
          </>
        }
        sub="One job runs on a phone at a time. The built-in simulator needs nothing else; real phones plug into a computer running the FlowAI agent, and appear here on their own."
        actions={
          <div className="flex gap-2">
            <Btn variant="subtle" icon={Plus} onClick={() => setEditing('new')}>
              Add a phone
            </Btn>
            <Btn variant="primary" icon={Radar} onClick={() => setScanning(true)}>
              Scan for devices
            </Btn>
          </div>
        }
      />

      {agent && (
        <p className="mt-6 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[10.5px] text-dim">
          <span className={cn('size-1.5 rounded-full', agent.online ? 'bg-ok' : 'bg-draft')} />
          {agent.online ? (
            <>
              Agent running on <span className="text-muted">{agent.host ?? 'its computer'}</span>
              <span>· adb {agent.adb ? '✓' : '✗'}</span>
              <span>· scrcpy {agent.scrcpy ? '✓' : '—'}</span>
            </>
          ) : agent.last_seen_at ? (
            <>Agent not running · last seen on {agent.host} {fmtRelative(agent.last_seen_at)}</>
          ) : (
            <>No agent yet · start it on the computer your phones plug into (see below)</>
          )}
        </p>
      )}

      <Stagger i={0} className="mt-6">
        {!devices && loading ? (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-[220px] rounded-xl" />
            ))}
          </div>
        ) : devices && devices.length === 0 ? (
          <EmptyState
            icon={Smartphone}
            title="No phones yet"
            body="Add the simulator to see the whole publishing loop run, or register a phone the automation service drives."
            action={
              <Btn variant="primary" icon={Plus} onClick={() => setEditing('new')}>
                Add the first one
              </Btn>
            }
          />
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {devices?.map((d, i) => (
              <PhoneCard key={d.id} device={d} i={i} run={runs?.find((r) => r.id === d.booked_run_id && r.outcome === 'running')} onEdit={() => setEditing(d)} onRemove={() => setRemoving(d)} />
            ))}
          </div>
        )}
      </Stagger>

      <HiddenPhones />

      <AutomationService />

      <PhoneForm open={editing !== null} device={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onRemove={(d) => (setEditing(null), setRemoving(d))} />
      <RemovePhone device={removing} onClose={() => setRemoving(null)} />
      <ScanDevices open={scanning} onClose={() => setScanning(false)} devices={devices ?? []} />
    </div>
  )
}

const STATUS: Record<string, { dot: string; label: string }> = {
  idle: { dot: 'bg-ok', label: 'Idle' },
  busy: { dot: 'bg-accent-soft animate-pulse', label: 'Working' },
  paused: { dot: 'bg-warn', label: 'Paused' },
  offline: { dot: 'bg-draft', label: 'Offline' },
  error: { dot: 'bg-fail', label: 'Error' },
}

function PhoneCard({ device: d, i, run, onEdit, onRemove }: { device: Device; i: number; run?: PublishingRun; onEdit: () => void; onRemove: () => void }) {
  const toast = useToast()
  const invalidate = useInvalidate()
  const [acting, setActing] = useState(false)
  const [watching, setWatching] = useState(false)
  // An agent's phone that has stopped checking in is offline, whatever it was last doing.
  const status = (d.driver === 'http' && !d.online && d.status !== 'busy' ? STATUS.offline : STATUS[d.status]) ?? STATUS.offline
  const details =
    d.driver === 'simulator'
      ? `Simulator · ${d.profile}`
      : [d.agent_kind === 'simulator' ? 'Agent simulator' : d.agent_kind === 'emulator' ? 'Android emulator' : d.agent_kind === 'remote' ? 'Hackathon phone (remote)' : (d.model ?? 'Phone'), d.android && `Android ${d.android}`, d.ref].filter(Boolean).join(' · ')

  const togglePause = async () => {
    setActing(true)
    try {
      await api(`/devices/${d.id}/${d.paused ? 'resume' : 'pause'}`, { method: 'POST' })
      invalidate()
      toast(d.paused ? `“${d.name}” is back in the rotation.` : `“${d.name}” paused. The run on it still finishes.`)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Couldn’t reach the phone.', 'error')
    } finally {
      setActing(false)
    }
  }

  return (
    <motion.article
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease, delay: Math.min(i, 8) * 0.04 }}
      className="flex min-w-0 flex-col rounded-xl border border-line bg-panel transition-colors duration-300 hover:border-line-2"
    >
      <div className="flex items-start gap-3 p-4">
        <span className="grid size-10 shrink-0 place-items-center rounded-lg border border-line-2 bg-white/[0.03] text-fg">
          <Smartphone className="size-4.5" strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1">
          <button type="button" onClick={onEdit} className="block max-w-full truncate text-left text-[14px] font-medium tracking-[-0.01em] hover:underline">
            {d.name}
          </button>
          <p className="truncate text-[12px] text-dim" title={details}>
            {details}
          </p>
        </div>
        <span className="flex shrink-0 items-center gap-1.5 font-mono text-[10.5px] text-dim">
          <span className={cn('size-1.5 rounded-full', status.dot)} />
          {status.label}
        </span>
      </div>

      {run && (
        <div className="mx-4 mb-3 rounded-lg border border-accent/25 bg-accent/[0.06] px-3 py-2.5">
          <p className="flex items-center gap-1.5 font-mono text-[9.5px] uppercase tracking-[0.14em] text-accent-soft">
            <Bot className="size-3" strokeWidth={2} />
            Publishing now
          </p>
          <p className="mt-1 truncate text-[12.5px]">{run.goal}</p>
          <p className="mt-0.5 text-[11px] text-dim">
            {run.totals.steps} steps · started {run.started_at ? fmtRelative(run.started_at) : '—'}
          </p>
        </div>
      )}

      {d.screenshot_url && (
        <a href={d.screenshot_url} target="_blank" rel="noreferrer" className="mx-4 mb-3 block overflow-hidden rounded-lg border border-line" title="The phone's latest screen">
          <img src={d.screenshot_url} alt={`${d.name}'s latest screen`} className="max-h-44 w-full object-cover object-top" loading="lazy" />
        </a>
      )}

      <div className="mt-auto flex items-center justify-between gap-2 border-t border-line px-4 py-2.5">
        <span className="min-w-0 truncate font-mono text-[10.5px] text-dim">
          {d.accounts.length > 0 ? d.accounts.map((a) => `@${a.handle}`).join(', ') : 'No accounts'}
          {d.last_seen_at ? ` · seen ${fmtRelative(d.last_seen_at)}` : ''}
        </span>
        <span className="flex shrink-0 gap-1.5">
          {d.mirror_url && d.online && (
            <Btn size="sm" variant="subtle" icon={MonitorSmartphone} onClick={() => setWatching(true)}>
              Live
            </Btn>
          )}
          <Btn size="sm" variant={d.paused ? 'ghost' : 'subtle'} icon={d.paused ? CirclePlay : CirclePause} loading={acting} onClick={togglePause}>
            {d.paused ? 'Resume' : 'Pause'}
          </Btn>
          <button
            type="button"
            onClick={onRemove}
            disabled={d.status === 'busy'}
            aria-label={`Delete ${d.name}`}
            title={d.status === 'busy' ? 'It’s publishing right now; delete it when the run ends' : 'Delete this phone'}
            className="grid size-8 place-items-center rounded-md text-dim transition-colors hover:bg-fail/10 hover:text-fail disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-dim"
          >
            <Trash2 className="size-3.5" strokeWidth={1.75} />
          </button>
        </span>
      </div>
      {d.mirror_url && <LiveView device={d} open={watching} onClose={() => setWatching(false)} />}
    </motion.article>
  )
}

/**
 * Delete a phone, after saying what that does: its accounts are unlinked, its publishing history
 * stays, and a phone the agent is still connected to is hidden so it doesn't come straight back.
 */
function RemovePhone({ device, onClose }: { device: Device | null; onClose: () => void }) {
  const toast = useToast()
  const invalidate = useInvalidate()
  const [busy, setBusy] = useState(false)
  const connected = !!device && device.driver === 'http' && device.online

  const remove = async () => {
    if (!device) return
    setBusy(true)
    try {
      const r = await api<{ hidden: boolean }>(`/devices/${device.id}`, { method: 'DELETE' })
      invalidate()
      toast(r?.hidden ? `“${device.name}” deleted and hidden. Bring it back under Hidden phones.` : `“${device.name}” deleted.`)
      onClose()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Couldn’t delete it.', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={!!device} onClose={onClose} title={device ? `Delete “${device.name}”?` : 'Delete'} className="max-w-md">
      {device && (
        <div className="space-y-4">
          <ul className="space-y-2 text-[12.5px] leading-snug text-muted">
            <li>
              {device.accounts.length
                ? `${device.accounts.map((a) => `@${a.handle}`).join(', ')} will be unlinked from it; link ${device.accounts.length > 1 ? 'them' : 'it'} to another phone to keep posting automatically.`
                : 'No accounts post through it.'}
            </li>
            <li>Its publishing history and screenshots stay.</li>
            {connected && (
              <li className="text-fg">
                It’s still connected to the FlowAI agent, so it will be hidden rather than reappear in 30 seconds. You can bring it back from Hidden phones on this page.
              </li>
            )}
          </ul>
          <div className="flex justify-end gap-2 border-t border-line pt-4">
            <Btn variant="subtle" onClick={onClose}>
              Cancel
            </Btn>
            <Btn variant="danger" icon={Trash2} onClick={remove} loading={busy}>
              Delete phone
            </Btn>
          </div>
        </div>
      )}
    </Modal>
  )
}

/** Phones deleted while the agent still had them: listed here, so they can be brought back. */
function HiddenPhones() {
  const { data } = useApi<{ refs: string[] }>('/devices/hidden')
  const invalidate = useInvalidate()
  const toast = useToast()
  const [busy, setBusy] = useState<string | null>(null)
  if (!data?.refs.length) return null

  const show = async (ref: string) => {
    setBusy(ref)
    try {
      await api(`/devices/hidden/${encodeURIComponent(ref)}`, { method: 'DELETE' })
      invalidate()
      toast('It will be back within 30 seconds, at the agent’s next check-in.')
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Couldn’t bring it back.', 'error')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-line px-3 py-2.5 text-[12px] text-dim">
      <EyeOff className="size-3.5" strokeWidth={1.75} />
      Hidden phones:
      {data.refs.map((ref) => (
        <span key={ref} className="flex items-center gap-1.5 rounded-md border border-line-2 py-0.5 pl-2 pr-1 font-mono text-[11px] text-muted">
          {ref}
          <Btn size="sm" variant="ghost" icon={Eye} loading={busy === ref} onClick={() => show(ref)}>
            Show again
          </Btn>
        </span>
      ))}
    </div>
  )
}

/** The card the Python dev needs: the token, and where its loop points. */
function AutomationService() {
  const toast = useToast()
  const [token, setToken] = useState<string | null>(null)
  const [shown, setShown] = useState(false)
  const [rotating, setRotating] = useState(false)

  useEffect(() => {
    api<{ token: string }>('/publishing/agent-token')
      .then((r) => setToken(r.token))
      .catch(() => {})
  }, [])

  const copy = async () => {
    if (!token) return
    await navigator.clipboard?.writeText(token)
    toast('Token copied.')
  }

  const rotate = async () => {
    setRotating(true)
    try {
      const r = await api<{ token: string }>('/publishing/agent-token/rotate', { method: 'POST' })
      setToken(r.token)
      setShown(true)
      toast('Token rotated. Update the automation service — the old one is dead.')
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Couldn’t rotate the token.', 'error')
    } finally {
      setRotating(false)
    }
  }

  const endpoints = [
    ['POST', '/api/agent/hello'],
    ['GET', '/api/agent/next-job?device_ref=…'],
    ['POST', '/api/agent/runs/{run}/steps'],
    ['POST', '/api/agent/runs/{run}/screenshot'],
    ['POST', '/api/agent/runs/{run}/finish'],
    ['GET', '/api/agent/assets/{id}/file'],
  ] as const

  return (
    <Stagger i={1} className="mt-12">
      <section className="rounded-xl border border-line bg-panel">
        <div className="border-b border-line px-5 py-4">
          <h2 className="flex items-center gap-2 text-[14px] font-medium">
            <KeyRound className="size-4 text-dim" strokeWidth={1.75} />
            The automation service
          </h2>
          <p className="mt-1 max-w-2xl text-[12px] leading-snug text-dim">
            The FlowAI agent (<span className="font-mono text-[11px]">agent/</span> in the repo) runs on the computer your phones are plugged into. It
            registers them here, asks for each phone’s next job, drives the app through named targets, reports steps and
            screenshots as it goes, and finishes — with proof, a failure, or honestly uncertain. It also serves each phone’s
            live screen. Every call is signed with this token as <span className="font-mono text-[11px]">Authorization: Bearer …</span>.
          </p>
        </div>
        <div className="border-b border-line px-5 py-4">
          <Label>Connect a phone</Label>
          <ol className="mt-2 grid gap-1.5 text-[12px] leading-snug text-muted md:grid-cols-2">
            <li>1. On the phone: Settings → About → tap Build number 7 times, then Developer options → USB debugging on.</li>
            <li>2. Plug it in with USB and accept “Allow USB debugging” on the phone. Sign in to Instagram or X there, by hand.</li>
            <li>
              3. Put the token below in <span className="font-mono text-[11px]">agent/.env</span> as{' '}
              <span className="font-mono text-[11px]">FLOWAI_AGENT_TOKEN</span>, then run{' '}
              <span className="font-mono text-[11px]">python -m flowai_agent</span> in <span className="font-mono text-[11px]">agent/</span>.
            </li>
            <li>4. The phone appears above within 30 seconds. Link an account to it under Accounts and turn automation on.</li>
          </ol>
        </div>
        <div className="grid gap-5 px-5 py-4 lg:grid-cols-2">
          <div>
            <Label>Agent token</Label>
            <div className="mt-2 flex items-center gap-2">
              <code className="h-9 flex-1 truncate rounded-md border border-line-2 bg-white/[0.02] px-3 font-mono text-[12px] leading-9 text-muted">
                {token ? (shown ? token : '•'.repeat(12) + token.slice(-6)) : '…'}
              </code>
              <Btn size="sm" icon={shown ? EyeOff : Eye} onClick={() => setShown((s) => !s)} disabled={!token}>
                {shown ? 'Hide' : 'Show'}
              </Btn>
              <Btn size="sm" icon={Copy} onClick={copy} disabled={!token}>
                Copy
              </Btn>
              <Btn size="sm" icon={RefreshCw} onClick={rotate} loading={rotating}>
                Rotate
              </Btn>
            </div>
            <p className="mt-2 text-[11.5px] text-dim">One token per studio. Rotating it cuts the old service off immediately.</p>
          </div>
          <div>
            <Label>The loop</Label>
            <ul className="mt-2 space-y-1">
              {endpoints.map(([method, path]) => (
                <li key={path} className="flex items-baseline gap-2 font-mono text-[11.5px]">
                  <span className={cn('w-9 shrink-0', method === 'GET' ? 'text-ok' : 'text-plan')}>{method}</span>
                  <span className="truncate text-muted">{path}</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[11.5px] text-dim">
              204 means no job. Named targets only (R6); every run has a step budget and a hard timeout (R7), both in the job payload.
            </p>
          </div>
        </div>
      </section>
    </Stagger>
  )
}

function PhoneForm({ open, device, onClose, onRemove }: { open: boolean; device: Device | null; onClose: () => void; onRemove: (d: Device) => void }) {
  return (
    <Modal open={open} onClose={onClose} title={device ? device.name : 'Add a phone'} className="max-w-lg">
      {open && <PhoneFields key={device?.id ?? 'new'} device={device} onDone={onClose} onRemove={onRemove} />}
    </Modal>
  )
}

function PhoneFields({ device, onDone, onRemove }: { device: Device | null; onDone: () => void; onRemove: (d: Device) => void }) {
  const toast = useToast()
  const invalidate = useInvalidate()
  const [name, setName] = useState(device?.name ?? '')
  const [driver, setDriver] = useState<Device['driver']>(device?.driver ?? 'simulator')
  const [ref, setRef] = useState(device?.ref ?? '')
  const [profile, setProfile] = useState<Device['profile']>(device?.profile ?? 'reliable')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  const save = async () => {
    setSaving(true)
    setErrors({})
    try {
      await api(device ? `/devices/${device.id}` : '/devices', {
        method: device ? 'PATCH' : 'POST',
        body: { name, driver, ref: driver === 'http' ? ref || null : null, profile },
      })
      invalidate()
      toast(device ? 'Phone saved.' : `“${name}” added.`)
      onDone()
    } catch (e) {
      if (e instanceof ApiError && e.status === 422) setErrors(Object.fromEntries(Object.keys(e.errors).map((k) => [k, e.field(k) ?? e.message])))
      else toast(e instanceof Error ? e.message : 'Couldn’t save the phone.', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <label className="block">
        <Label>Name</Label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Studio phone" className={cn(inputClass, 'mt-2')} />
        <FieldError message={errors.name} />
      </label>

      <div>
        <Label>Driver</Label>
        <Segmented
          id="driver"
          label="Driver"
          className="mt-2 w-fit"
          value={driver}
          onChange={setDriver}
          options={[
            { value: 'simulator' as const, label: 'Built-in simulator' },
            { value: 'http' as const, label: 'Automation service' },
          ]}
        />
        <p className="mt-1.5 text-[11.5px] text-dim">
          {driver === 'simulator'
            ? 'Runs in-process on the queue worker: the whole loop works with no hardware and no external service.'
            : 'The Python automation service drives this phone through the agent API below.'}
        </p>
      </div>

      {driver === 'http' && (
        <label className="block">
          <Label>Device ID on the phone-control service</Label>
          <input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="phone-1" className={cn(inputClass, 'mt-2')} />
          <FieldError message={errors.ref} />
        </label>
      )}

      {driver === 'simulator' && (
        <div>
          <Label>How it behaves</Label>
          <Segmented
            id="profile"
            label="Profile"
            className="mt-2 w-fit"
            value={profile}
            onChange={setProfile}
            options={[
              { value: 'reliable' as const, label: 'Reliable' },
              { value: 'flaky' as const, label: 'Flaky' },
              { value: 'broken' as const, label: 'Broken' },
            ]}
          />
          <p className="mt-1.5 text-[11.5px] text-dim">
            {profile === 'reliable' && 'Posts and proves it, every time.'}
            {profile === 'flaky' && 'Mostly works; sometimes the screen proves nothing, so the run ends honestly unconfirmed.'}
            {profile === 'broken' && 'Can’t even open the app: every run fails, waits, and tries again (R3).'}
          </p>
        </div>
      )}

      <div className="flex items-center justify-between border-t border-line pt-4">
        {device ? (
          <Btn variant="danger" icon={Trash2} onClick={() => onRemove(device)} disabled={device.status === 'busy'}>
            Delete
          </Btn>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Btn variant="subtle" onClick={onDone}>
            Cancel
          </Btn>
          <Btn variant="primary" onClick={save} loading={saving} disabled={!name.trim()}>
            {device ? 'Save' : 'Add phone'}
          </Btn>
        </div>
      </div>
    </div>
  )
}
