import { useCallback, useEffect, useState } from 'react'
import { Bot, Cable, CircleCheck, CircleAlert, LoaderCircle, MonitorSmartphone, Play, Plus, Radar, RotateCw, Smartphone, Wifi } from 'lucide-react'
import { api, type AgentStatus, type Device, type ScanResult } from '../../lib/api'
import { cn } from '../../lib/cn'
import { useInvalidate } from '../data'
import { useToast } from '../toast'
import { Btn, inputClass, Label, Modal, Toggle } from '../ui'

type Phase = 'loading' | 'no-agent' | 'unreachable' | 'ready'

const CONNECTION = {
  usb: { icon: Cable, label: 'USB' },
  wifi: { icon: Wifi, label: 'Wi-Fi' },
  emulator: { icon: MonitorSmartphone, label: 'Emulator' },
} as const

/**
 * Scan for devices: everything the agent's computer can drive — phones on USB or Wi-Fi, running
 * emulators — plus phones nearby with Wireless debugging on, installed emulators to start, and
 * the simulators. Connected, ready devices join FlowAI on their own; the rest say what they need.
 */
export function ScanDevices({ open, onClose, devices }: { open: boolean; onClose: () => void; devices: Device[] }) {
  return (
    <Modal open={open} onClose={onClose} title="Scan for devices" className="max-w-2xl">
      {open && <Scan devices={devices} />}
    </Modal>
  )
}

function Scan({ devices }: { devices: Device[] }) {
  const toast = useToast()
  const invalidate = useInvalidate()
  const [phase, setPhase] = useState<Phase>('loading')
  const [agent, setAgent] = useState<AgentStatus | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [result, setResult] = useState<ScanResult | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [codes, setCodes] = useState<Record<string, string>>({})

  const scan = useCallback(async (a: AgentStatus | null = agent, t: string | null = token) => {
    if (!a?.online || !a.url || !t) return setPhase('no-agent')
    setPhase((p) => (p === 'ready' ? p : 'loading'))
    try {
      const r = await fetch(`${a.url}/scan`, { headers: { 'X-Agent-Token': t } })
      if (!r.ok) throw new Error(String(r.status))
      setResult((await r.json()) as ScanResult)
      setPhase('ready')
      // Ready devices are registered by the agent right after a scan; show them.
      window.setTimeout(invalidate, 3500)
    } catch {
      setPhase('unreachable')
    }
  }, [agent, token, invalidate])

  useEffect(() => {
    Promise.all([api<AgentStatus>('/publishing/agent'), api<{ token: string }>('/publishing/agent-token')])
      .then(([a, t]) => {
        setAgent(a)
        setToken(t.token)
        scan(a, t.token)
      })
      .catch(() => setPhase('no-agent'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const act = async (key: string, action: string, body: Record<string, unknown> = {}) => {
    if (!agent?.url || !token) return
    setBusy(key)
    try {
      const r = await fetch(`${agent.url}/scan/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Agent-Token': token }, body: JSON.stringify(body) })
      const data = (await r.json().catch(() => ({}))) as { message?: string }
      toast(data.message ?? (r.ok ? 'Done.' : `The agent couldn’t do that (${r.status}).`), r.ok ? 'success' : 'error')
      if (r.ok) window.setTimeout(() => scan(), 2500)
    } catch {
      toast('Couldn’t reach the agent.', 'error')
    } finally {
      setBusy(null)
    }
  }

  const addBuiltInSimulator = async () => {
    setBusy('builtin')
    try {
      const n = devices.filter((d) => d.driver === 'simulator').length + 1
      await api('/devices', { method: 'POST', body: { name: `Simulator ${n}`, driver: 'simulator', profile: 'reliable' } })
      invalidate()
      toast('A simulator phone was added.')
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Couldn’t add it.', 'error')
    } finally {
      setBusy(null)
    }
  }

  if (phase === 'loading') {
    return (
      <p className="flex items-center justify-center gap-2 py-14 text-[12.5px] text-dim">
        <LoaderCircle className="size-4 animate-spin" />
        Looking for devices…
      </p>
    )
  }

  if (phase === 'no-agent' || phase === 'unreachable') {
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-warn/25 bg-warn/[0.06] p-4">
          <p className="flex items-center gap-2 text-[13px] font-medium">
            <CircleAlert className="size-4 text-warn" strokeWidth={1.75} />
            {phase === 'no-agent' ? 'The FlowAI agent isn’t running' : 'Can’t reach the agent from this browser'}
          </p>
          <p className="mt-1.5 text-[12px] leading-snug text-muted">
            {phase === 'no-agent'
              ? 'The scan runs on the computer your phones plug into. Start the agent there, then scan again.'
              : `The agent on ${agent?.host ?? 'its computer'} is checking in, but ${agent?.url} doesn’t answer here. Open FlowAI on that computer, or set FLOWAI_MIRROR_HOST and FLOWAI_MIRROR_URL so this browser can reach it.`}
          </p>
        </div>
        <div>
          <Label>Start the agent</Label>
          <pre className="mt-2 overflow-x-auto rounded-lg border border-line bg-white/[0.02] p-3 font-mono text-[11.5px] leading-relaxed text-muted">
            {'cd agent\n.venv\\Scripts\\python -m flowai_agent'}
          </pre>
          <p className="mt-2 text-[11.5px] text-dim">First time? See agent/README.md for the one-time setup (Python, adb, the token).</p>
        </div>
        <div className="flex justify-between">
          <Btn variant="subtle" icon={Plus} onClick={addBuiltInSimulator} loading={busy === 'builtin'}>
            Add a simulator instead
          </Btn>
          <Btn icon={RotateCw} onClick={() => window.location.reload()}>
            Check again
          </Btn>
        </div>
      </div>
    )
  }

  const r = result!
  const inFlowAI = (serial: string) => devices.find((d) => d.ref === serial)

  return (
    <div className="space-y-6">
      <p className="flex items-center gap-2 text-[12px] text-dim">
        <Radar className="size-3.5 text-ok" strokeWidth={2} />
        Agent on <span className="text-muted">{agent?.host ?? 'this computer'}</span> · adb {r.adb ? 'found' : 'missing'} · scrcpy {agent?.scrcpy ? 'found' : 'not installed'}
      </p>

      {!r.adb && <p className="rounded-lg border border-fail/25 bg-fail/[0.06] p-3 text-[12.5px]">{r.hint}</p>}

      <section>
        <Label>Connected to this computer</Label>
        {r.connected.length === 0 ? (
          <p className="mt-2 rounded-lg border border-dashed border-line-2 p-4 text-[12px] leading-snug text-dim">
            No device yet. Plug a phone in with USB debugging on (Settings → About → tap Build number 7 times → Developer options), or start an emulator below.
          </p>
        ) : (
          <ul className="mt-2 space-y-2">
            {r.connected.map((d) => {
              const C = CONNECTION[d.connection]
              const known = inFlowAI(d.serial)
              return (
                <li key={d.serial} className="flex items-start gap-3 rounded-xl border border-line bg-panel px-3.5 py-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-line-2 bg-white/[0.03]">
                    <C.icon className="size-4" strokeWidth={1.75} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium">{d.name}</span>
                    <span className="block truncate font-mono text-[10.5px] text-dim">
                      {C.label} · {d.serial}
                      {d.android ? ` · Android ${d.android}` : ''}
                    </span>
                    {d.status !== 'ready' && <span className="mt-1 block text-[11.5px] leading-snug text-warn">{d.hint}</span>}
                  </span>
                  <span
                    className={cn(
                      'flex shrink-0 items-center gap-1.5 font-mono text-[10.5px]',
                      d.status !== 'ready' ? 'text-warn' : known ? 'text-ok' : 'text-accent-soft',
                    )}
                  >
                    {d.status !== 'ready' ? (
                      d.status === 'needs-allow' ? 'Needs Allow' : 'Offline'
                    ) : known ? (
                      <>
                        <CircleCheck className="size-3.5" strokeWidth={2} />
                        In FlowAI
                      </>
                    ) : (
                      <>
                        <LoaderCircle className="size-3.5 animate-spin" />
                        Adding…
                      </>
                    )}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section>
        <Label>On this Wi-Fi</Label>
        {r.nearby.length === 0 ? (
          <p className="mt-2 text-[12px] leading-snug text-dim">
            No phone advertising Wireless debugging. On a phone (Android 11+): Developer options → Wireless debugging on, on the same network as this computer.
          </p>
        ) : (
          <ul className="mt-2 space-y-2">
            {r.nearby.map((n) => (
              <li key={n.name + n.address} className="rounded-xl border border-line bg-panel px-3.5 py-3">
                <div className="flex items-center gap-3">
                  <Wifi className="size-4 shrink-0 text-dim" strokeWidth={1.75} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium">{n.name.replace(/^adb-/, '').split('-')[0] || n.name}</span>
                    <span className="block font-mono text-[10.5px] text-dim">{n.address}</span>
                  </span>
                  {n.action === 'connect' && (
                    <Btn size="sm" variant="primary" onClick={() => act(n.address, 'connect', { address: n.address })} loading={busy === n.address}>
                      Connect
                    </Btn>
                  )}
                </div>
                <p className="mt-1.5 text-[11.5px] leading-snug text-dim">{n.hint}</p>
                {n.action === 'pair' && (
                  <div className="mt-2 flex gap-2">
                    <input
                      value={codes[n.address] ?? ''}
                      onChange={(e) => setCodes((c) => ({ ...c, [n.address]: e.target.value.replace(/\D/g, '').slice(0, 6) }))}
                      placeholder="6-digit code"
                      inputMode="numeric"
                      className={cn(inputClass, 'w-36 font-mono')}
                    />
                    <Btn size="md" variant="primary" disabled={(codes[n.address] ?? '').length !== 6} loading={busy === n.address} onClick={() => act(n.address, 'pair', { address: n.address, code: codes[n.address] })}>
                      Pair
                    </Btn>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <Label>Android emulators</Label>
        {!r.emulators.available ? (
          <p className="mt-2 text-[12px] leading-snug text-dim">{r.emulators.hint}</p>
        ) : r.emulators.avds.length === 0 ? (
          <p className="mt-2 text-[12px] leading-snug text-dim">No emulator created yet. In Android Studio: Device Manager → Create device, with a Google Play system image.</p>
        ) : (
          <ul className="mt-2 grid gap-2 sm:grid-cols-2">
            {r.emulators.avds.map((a) => (
              <li key={a.name} className="flex items-center gap-3 rounded-xl border border-line bg-panel px-3.5 py-2.5">
                <MonitorSmartphone className="size-4 shrink-0 text-dim" strokeWidth={1.75} />
                <span className="min-w-0 flex-1 truncate text-[12.5px]">{a.name.replaceAll('_', ' ')}</span>
                {a.running ? (
                  <span className="font-mono text-[10.5px] text-ok">Running</span>
                ) : (
                  <Btn size="sm" icon={Play} onClick={() => act(a.name, 'emulator', { name: a.name })} loading={busy === a.name}>
                    Start
                  </Btn>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <Label>Simulators</Label>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <div className="rounded-xl border border-line bg-panel px-3.5 py-3">
            <p className="flex items-center gap-2 text-[13px] font-medium">
              <Smartphone className="size-4 text-dim" strokeWidth={1.75} />
              FlowAI simulator
            </p>
            <p className="mt-1 text-[11.5px] leading-snug text-dim">Runs inside FlowAI: no agent, no hardware. Reliable, flaky or broken on purpose.</p>
            <Btn size="sm" icon={Plus} className="mt-2.5" onClick={addBuiltInSimulator} loading={busy === 'builtin'}>
              Add one
            </Btn>
          </div>
          <div className="rounded-xl border border-line bg-panel px-3.5 py-3">
            <div className="flex items-center justify-between gap-2">
              <p className="flex items-center gap-2 text-[13px] font-medium">
                <Bot className="size-4 text-dim" strokeWidth={1.75} />
                Agent simulator
              </p>
              <Toggle on={r.simulated.length > 0} onChange={(on) => act('agent-sim', 'simulator', { enabled: on })} label="Agent simulator" />
            </div>
            <p className="mt-1 text-[11.5px] leading-snug text-dim">A virtual phone on the agent: the full Instagram flow, with a live view, for trying runs safely.</p>
          </div>
        </div>
      </section>

      <div className="flex items-center justify-between border-t border-line pt-4">
        <Btn variant="ghost" size="sm" icon={RotateCw} onClick={() => act('adb', 'restart-adb')} loading={busy === 'adb'}>
          Restart adb
        </Btn>
        <Btn icon={Radar} onClick={() => scan()}>
          Scan again
        </Btn>
      </div>
    </div>
  )
}
