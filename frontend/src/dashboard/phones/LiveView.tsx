import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { ArrowLeft, Circle, LoaderCircle, Send, Square, Unplug } from 'lucide-react'
import { api, type Device } from '../../lib/api'
import { cn } from '../../lib/cn'
import { useToast } from '../toast'
import { Btn, inputClass, Label, Modal } from '../ui'

/**
 * The phone's screen, live, from the agent on the computer it's plugged into — and a hand on it:
 * tap or drag on the screen, the system keys, and typing. The agent refuses control while a
 * publishing run is driving the phone, so a person can watch a run but not disturb it.
 */
export function LiveView({ device, open, onClose }: { device: Device; open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title={device.name} className="max-w-[440px]">
      {open && device.mirror_url && device.ref && <Screen device={device} base={device.mirror_url} phoneRef={device.ref} />}
    </Modal>
  )
}

function Screen({ device, base, phoneRef }: { device: Device; base: string; phoneRef: string }) {
  const toast = useToast()
  const [token, setToken] = useState<string | null>(null)
  const [state, setState] = useState<'connecting' | 'live' | 'unreachable'>('connecting')
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const down = useRef<{ x: number; y: number; t: number } | null>(null)
  const phone = `${base}/phones/${encodeURIComponent(phoneRef)}`

  useEffect(() => {
    api<{ token: string }>('/publishing/agent-token')
      .then((r) => setToken(r.token))
      .catch(() => setState('unreachable'))
  }, [])

  const control = async (action: 'touch' | 'swipe' | 'key' | 'text', body: Record<string, unknown>) => {
    if (!token) return
    try {
      const r = await fetch(`${phone}/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Agent-Token': token }, body: JSON.stringify(body) })
      if (!r.ok) {
        const msg = ((await r.json().catch(() => ({}))) as { message?: string }).message
        toast(msg ?? `The phone didn’t take that (${r.status}).`, 'error')
      }
    } catch {
      toast('Couldn’t reach the agent.', 'error')
    }
  }

  // Positions go as fractions of the screen, so the stream's size never matters.
  const at = (e: PointerEvent<HTMLImageElement>) => {
    const box = e.currentTarget.getBoundingClientRect()
    return { x: Math.min(1, Math.max(0, (e.clientX - box.left) / box.width)), y: Math.min(1, Math.max(0, (e.clientY - box.top) / box.height)) }
  }
  const onDown = (e: PointerEvent<HTMLImageElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    down.current = { ...at(e), t: Date.now() }
  }
  const onUp = (e: PointerEvent<HTMLImageElement>) => {
    const start = down.current
    down.current = null
    if (!start) return
    const end = at(e)
    const ms = Date.now() - start.t
    if (Math.hypot(end.x - start.x, end.y - start.y) < 0.02) {
      control('touch', { x: start.x, y: start.y, hold_ms: ms > 500 ? ms : 0 })
    } else {
      control('swipe', { x1: start.x, y1: start.y, x2: end.x, y2: end.y, ms: Math.min(2000, Math.max(120, ms)) })
    }
  }

  const type = async () => {
    if (!text) return
    setSending(true)
    await control('text', { text })
    setText('')
    setSending(false)
  }

  const [w, h] = device.screen ?? [1080, 2400]

  return (
    <div>
      <div className="relative mx-auto overflow-hidden rounded-[22px] border border-line-2 bg-black" style={{ aspectRatio: `${w} / ${h}`, maxHeight: '62vh' }}>
        {token && state !== 'unreachable' && (
          <img
            src={`${phone}/stream.mjpeg?token=${encodeURIComponent(token)}`}
            alt={`${device.name}, live`}
            draggable={false}
            onLoad={() => setState('live')}
            onError={() => setState('unreachable')}
            onPointerDown={onDown}
            onPointerUp={onUp}
            className="size-full cursor-pointer touch-none select-none object-contain"
          />
        )}
        {state === 'connecting' && (
          <div className="absolute inset-0 grid place-items-center text-[12px] text-dim">
            <span className="flex items-center gap-2">
              <LoaderCircle className="size-4 animate-spin" />
              Connecting to the phone…
            </span>
          </div>
        )}
        {state === 'unreachable' && (
          <div className="absolute inset-0 grid place-items-center p-6 text-center">
            <div>
              <Unplug className="mx-auto size-6 text-dim" strokeWidth={1.5} />
              <p className="mt-3 text-[13px]">Can’t reach the live view</p>
              <p className="mt-1 text-[11.5px] leading-snug text-dim">
                It’s served by the FlowAI agent at <span className="font-mono">{base}</span>. Is the agent running on the computer this phone is plugged into?
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="mt-3 flex justify-center gap-1.5">
        <Btn size="sm" variant="subtle" icon={ArrowLeft} onClick={() => control('key', { key: 'back' })}>
          Back
        </Btn>
        <Btn size="sm" variant="subtle" icon={Circle} onClick={() => control('key', { key: 'home' })}>
          Home
        </Btn>
        <Btn size="sm" variant="subtle" icon={Square} onClick={() => control('key', { key: 'recents' })}>
          Apps
        </Btn>
      </div>

      <div className="mt-4">
        <Label>Type on the phone</Label>
        <div className="mt-2 flex gap-2">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && type()}
            placeholder="Tap a field on the screen first"
            className={cn(inputClass, 'flex-1')}
          />
          <Btn size="md" icon={Send} onClick={type} loading={sending} disabled={!text}>
            Send
          </Btn>
        </div>
        <p className="mt-2 text-[11px] leading-snug text-dim">
          Tap or drag on the screen to use the phone. While a post is publishing you can watch, but the agent won’t let anyone touch it.
        </p>
      </div>
    </div>
  )
}
