import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Brush, Eraser, Maximize2, Redo2, Trash2, Undo2 } from 'lucide-react'
import type { Asset } from '../../lib/api'
import { cn } from '../../lib/cn'

/** What an edit sends: the image as drawn here and the painted area, same size. */
export type EditExport = { image: string; mask: string; mode: 'inpaint' | 'outpaint' }
export type EditApi = { export: () => EditExport | null }

type Pad = { top: number; right: number; bottom: number; left: number }
type Tool = 'brush' | 'eraser'

const NO_PAD: Pad = { top: 0, right: 0, bottom: 0, left: 0 }
/** Bigger images are sent at this size at most: the model works at about a megapixel anyway. */
const MAX_SIDE = 2048
const MASK_COLOR = 'rgb(255, 72, 140)'
const HISTORY = 30

/**
 * Paint over what should change, or extend the frame; the model fills both. The mask lives on
 * its own canvas at the image's full size (plus any extension), drawn over the photo.
 */
export function EditCanvas({ asset, apiRef, onState }: { asset: Asset; apiRef: RefObject<EditApi | null>; onState?: (s: { painted: boolean; extended: boolean }) => void }) {
  const [image, setImage] = useState<HTMLImageElement | null>(null)
  const [pad, setPad] = useState<Pad>(NO_PAD)
  const [tool, setTool] = useState<Tool>('brush')
  const [size, setSize] = useState(60)
  const [painted, setPainted] = useState(false)
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null)
  const mask = useRef<HTMLCanvasElement>(null)
  const frame = useRef<HTMLDivElement>(null)
  const history = useRef<{ stack: ImageData[]; at: number }>({ stack: [], at: -1 })
  const last = useRef<{ x: number; y: number } | null>(null)
  const [, bump] = useState(0)

  const width = image ? image.naturalWidth + pad.left + pad.right : 1
  const height = image ? image.naturalHeight + pad.top + pad.bottom : 1
  const extended = pad.top + pad.right + pad.bottom + pad.left > 0

  // Load the photo; start with an empty mask and a brush sized to it.
  useEffect(() => {
    const img = new Image()
    img.onload = () => {
      setImage(img)
      setPad(NO_PAD)
      setSize(Math.round(Math.max(img.naturalWidth, img.naturalHeight) * 0.06))
    }
    img.src = asset.url
    return () => {
      img.onload = null
    }
  }, [asset.url])

  const ctx = () => mask.current?.getContext('2d', { willReadFrequently: true }) ?? null

  const anyPaint = useCallback(() => {
    const c = ctx()
    if (!c || !mask.current) return false
    const data = c.getImageData(0, 0, mask.current.width, mask.current.height).data
    for (let i = 3; i < data.length; i += 4) if (data[i] > 0) return true
    return false
  }, [])

  const snapshot = useCallback(() => {
    const c = ctx()
    if (!c || !mask.current) return
    const h = history.current
    h.stack = [...h.stack.slice(0, h.at + 1), c.getImageData(0, 0, mask.current.width, mask.current.height)].slice(-HISTORY)
    h.at = h.stack.length - 1
    bump((n) => n + 1)
  }, [])

  // Size the mask canvas to the frame; keep what was painted where it was on the photo.
  const resize = useCallback(
    (next: Pad, prev: Pad) => {
      const canvas = mask.current
      if (!canvas || !image) return
      const old = document.createElement('canvas')
      old.width = canvas.width
      old.height = canvas.height
      old.getContext('2d')?.drawImage(canvas, 0, 0)
      canvas.width = image.naturalWidth + next.left + next.right
      canvas.height = image.naturalHeight + next.top + next.bottom
      ctx()?.drawImage(old, next.left - prev.left, next.top - prev.top)
      history.current = { stack: [], at: -1 }
      snapshot()
    },
    [image, snapshot],
  )

  useEffect(() => {
    if (image) resize(NO_PAD, NO_PAD)
    setPainted(false)
  }, [image, resize])

  useEffect(() => onState?.({ painted, extended }), [painted, extended, onState])

  const extend = (side: keyof Pad | 'reset') => {
    if (!image) return
    const step = Math.round(Math.max(image.naturalWidth, image.naturalHeight) * 0.25)
    const next = side === 'reset' ? NO_PAD : { ...pad, [side]: Math.min(pad[side] + step, image.naturalWidth * 2) }
    resize(next, pad)
    setPad(next)
  }

  const point = (e: ReactPointerEvent) => {
    const r = mask.current!.getBoundingClientRect()
    return { x: ((e.clientX - r.left) / r.width) * width, y: ((e.clientY - r.top) / r.height) * height }
  }

  const stroke = (from: { x: number; y: number }, to: { x: number; y: number }) => {
    const c = ctx()
    if (!c) return
    c.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over'
    c.strokeStyle = MASK_COLOR
    c.fillStyle = MASK_COLOR
    c.lineWidth = size
    c.lineCap = 'round'
    c.lineJoin = 'round'
    c.beginPath()
    c.moveTo(from.x, from.y)
    c.lineTo(to.x, to.y)
    c.stroke()
  }

  const down = (e: ReactPointerEvent) => {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const p = point(e)
    last.current = p
    stroke(p, { x: p.x + 0.01, y: p.y })
  }
  const move = (e: ReactPointerEvent) => {
    const r = frame.current?.getBoundingClientRect()
    if (r) setCursor({ x: e.clientX - r.left, y: e.clientY - r.top })
    if (!last.current) return
    const p = point(e)
    stroke(last.current, p)
    last.current = p
  }
  const up = () => {
    if (!last.current) return
    last.current = null
    snapshot()
    setPainted(tool === 'brush' ? true : anyPaint())
  }

  const restore = (at: number) => {
    const h = history.current
    const data = h.stack[at]
    if (!data) return
    ctx()?.putImageData(data, 0, 0)
    h.at = at
    bump((n) => n + 1)
    setPainted(anyPaint())
  }
  const undo = () => restore(history.current.at - 1)
  const redo = () => restore(history.current.at + 1)
  const clear = () => {
    const c = ctx()
    if (!c || !mask.current) return
    c.clearRect(0, 0, mask.current.width, mask.current.height)
    snapshot()
    setPainted(false)
  }

  // [ and ] resize the brush; Ctrl/⌘+Z undoes, with Shift redoes.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input, textarea, select')) return
      if (e.key === '[') setSize((s) => Math.max(4, Math.round(s * 0.8)))
      else if (e.key === ']') setSize((s) => Math.min(800, Math.round(s * 1.25)))
      else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
      } else if (e.key === 'b') setTool('brush')
      else if (e.key === 'e') setTool('eraser')
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  })

  // What the generator sends: the image as framed here, and the mask as white on transparent.
  apiRef.current = {
    export: () => {
      if (!image || !mask.current || (!painted && !extended)) return null
      const scale = Math.min(1, MAX_SIDE / Math.max(width, height))
      const w = Math.round(width * scale)
      const h = Math.round(height * scale)
      const out = document.createElement('canvas')
      out.width = w
      out.height = h
      const o = out.getContext('2d')!
      o.drawImage(image, pad.left * scale, pad.top * scale, image.naturalWidth * scale, image.naturalHeight * scale)
      const picture = out.toDataURL('image/png')

      o.clearRect(0, 0, w, h)
      o.drawImage(mask.current, 0, 0, w, h)
      const px = o.getImageData(0, 0, w, h)
      for (let i = 0; i < px.data.length; i += 4) {
        const on = px.data[i + 3] > 0
        px.data[i] = px.data[i + 1] = px.data[i + 2] = 255
        px.data[i + 3] = on ? 255 : 0
      }
      o.putImageData(px, 0, 0)

      return { image: picture, mask: out.toDataURL('image/png'), mode: extended ? 'outpaint' : 'inpaint' }
    },
  }

  const h = history.current
  const scaleOnScreen = mask.current ? mask.current.getBoundingClientRect().width / width : 1

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-1 border-b border-line px-2 py-1.5">
        <ToolButton label="Brush (B)" active={tool === 'brush'} onClick={() => setTool('brush')} icon={Brush} />
        <ToolButton label="Eraser (E)" active={tool === 'eraser'} onClick={() => setTool('eraser')} icon={Eraser} />
        <label className="ml-1 flex items-center gap-2 text-[11px] text-dim">
          Size
          <input type="range" min={4} max={800} value={size} onChange={(e) => setSize(Number(e.target.value))} className="w-28 accent-[var(--color-accent)]" aria-label="Brush size" />
          <span className="w-9 font-mono text-[10px]">{size}px</span>
        </label>
        <span className="mx-1 h-5 w-px bg-line" />
        <ToolButton label="Undo (Ctrl+Z)" onClick={undo} icon={Undo2} disabled={h.at <= 0} />
        <ToolButton label="Redo (Ctrl+Shift+Z)" onClick={redo} icon={Redo2} disabled={h.at >= h.stack.length - 1} />
        <ToolButton label="Clear the painted area" onClick={clear} icon={Trash2} disabled={!painted} />
        <span className="mx-1 h-5 w-px bg-line" />
        <span className="text-[11px] text-dim">Extend</span>
        <ToolButton label="Extend left" onClick={() => extend('left')} icon={ArrowLeft} />
        <ToolButton label="Extend up" onClick={() => extend('top')} icon={ArrowUp} />
        <ToolButton label="Extend down" onClick={() => extend('bottom')} icon={ArrowDown} />
        <ToolButton label="Extend right" onClick={() => extend('right')} icon={ArrowRight} />
        {extended && <ToolButton label="Back to the original frame" onClick={() => extend('reset')} icon={Maximize2} />}
        <span className="ml-auto font-mono text-[10px] text-dim">
          {width} × {height}
        </span>
      </div>

      <div className="grid min-h-0 flex-1 place-items-center overflow-hidden p-4">
        {image ? (
          <div
            ref={frame}
            className="checkerboard relative max-h-full max-w-full overflow-hidden rounded-md shadow-[0_20px_60px_-30px_rgb(0_0_0)]"
            style={{ aspectRatio: `${width} / ${height}`, width: `min(100%, calc((100dvh - 15rem) * ${width / height}))` }}
            onPointerLeave={() => setCursor(null)}
          >
            <img
              src={asset.url}
              alt={asset.name ?? ''}
              draggable={false}
              className="pointer-events-none absolute select-none"
              style={{ left: `${(pad.left / width) * 100}%`, top: `${(pad.top / height) * 100}%`, width: `${(image.naturalWidth / width) * 100}%`, height: `${(image.naturalHeight / height) * 100}%` }}
            />
            {extended && (
              <div
                className="pointer-events-none absolute border border-dashed border-white/50"
                style={{ left: `${(pad.left / width) * 100}%`, top: `${(pad.top / height) * 100}%`, width: `${(image.naturalWidth / width) * 100}%`, height: `${(image.naturalHeight / height) * 100}%` }}
              />
            )}
            <canvas
              ref={mask}
              onPointerDown={down}
              onPointerMove={move}
              onPointerUp={up}
              onPointerCancel={up}
              className="absolute inset-0 size-full cursor-none touch-none opacity-55"
            />
            {cursor && (
              <span
                className={cn('pointer-events-none absolute rounded-full border', tool === 'eraser' ? 'border-white/80 border-dashed' : 'border-white/90')}
                style={{ width: size * scaleOnScreen, height: size * scaleOnScreen, left: cursor.x - (size * scaleOnScreen) / 2, top: cursor.y - (size * scaleOnScreen) / 2 }}
              />
            )}
          </div>
        ) : (
          <div className="skeleton aspect-square w-[min(60%,480px)] rounded-md" />
        )}
      </div>
    </div>
  )
}

function ToolButton({ label, icon: Icon, onClick, active, disabled }: { label: string; icon: typeof Brush; onClick: () => void; active?: boolean; disabled?: boolean }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'grid size-8 place-items-center rounded-md transition-colors disabled:opacity-35',
        active ? 'bg-accent/20 text-accent-soft' : 'text-muted hover:bg-white/[0.06] hover:text-fg',
      )}
    >
      <Icon className="size-4" strokeWidth={1.75} />
    </button>
  )
}
