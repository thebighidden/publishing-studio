import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { useMotionValue, useMotionValueEvent, useReducedMotion, useScroll, useSpring } from 'framer-motion'
import { useReady } from '../../lib/ready'

/*
 * One continuous hand-drawn line that runs the length of the page.
 *
 * Sections declare where the pen should go with data attributes:
 *   data-thread="node"       knot around a section-number dot
 *   data-thread="circle"     loop around a word            (data-from="right", data-exit="down")
 *   data-thread="underline"  swoosh under a word            (data-loop adds a flourish)
 *   data-thread="scribble"   cross a phrase out             (data-from="right")
 *   data-thread="rail"       run down the margin past a block (data-side="left")
 *   data-thread="point"      pass through a waypoint
 *   data-thread="end"        circle the final call to action, then lift the pen
 *
 * Below 1024px the layouts stack, so the route simplifies: rails keep to the left margin
 * (unless data-side-sm says otherwise), circles leave downward, and underlines become circles —
 * or drop out when their word wraps onto two lines.
 *
 * Positions come from layout offsets (not bounding rects), so reveal transforms
 * that are still mid-animation never bend the line.
 */

type V = { x: number; y: number }
type Cubic = [V, V, V, V]

const v = (x: number, y: number): V => ({ x, y })
const add = (a: V, b: V) => v(a.x + b.x, a.y + b.y)
const sub = (a: V, b: V) => v(a.x - b.x, a.y - b.y)
const mul = (a: V, s: number) => v(a.x * s, a.y * s)
const dist = (a: V, b: V) => Math.hypot(a.x - b.x, a.y - b.y)
const norm = (a: V) => {
  const l = Math.hypot(a.x, a.y) || 1
  return v(a.x / l, a.y / l)
}
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))
const lerp = (a: V, b: V, t: number) => v(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)

function bez([p0, p1, p2, p3]: Cubic, t: number): V {
  const u = 1 - t
  return v(
    u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
  )
}

/** Split a cubic at t (de Casteljau). */
function split([p0, p1, p2, p3]: Cubic, t: number): [Cubic, Cubic] {
  const a = lerp(p0, p1, t)
  const b = lerp(p1, p2, t)
  const c = lerp(p2, p3, t)
  const d = lerp(a, b, t)
  const e = lerp(b, c, t)
  const m = lerp(d, e, t)
  return [
    [p0, a, d, m],
    [m, e, c, p3],
  ]
}

type Gesture = {
  el: HTMLElement
  kind: string
  segs: Cubic[]
  start: V
  startDir: V
  end: V
  endDir: V
  /** Cap on the connector handle arriving at / leaving this gesture. */
  inK?: number
  outK?: number
  /** Which moment counts as "reached" for data-on. */
  reach: 'start' | 'end'
  auto?: boolean
}

/** Elliptical arc as cubic pieces. `drift` grows or shrinks the radius along the sweep, like a hand. */
function arc(c: V, rx: number, ry: number, a0: number, sweep: number, drift = 1, tilt = 0) {
  const n = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 2)))
  const step = sweep / n
  const k = (4 / 3) * Math.tan(step / 4)
  const ct = Math.cos(tilt)
  const st = Math.sin(tilt)
  const rot = (p: V) => v(p.x * ct - p.y * st, p.x * st + p.y * ct)
  const at = (a: number, s: number) => add(c, rot(v(rx * s * Math.cos(a), ry * s * Math.sin(a))))
  const der = (a: number, s: number) => rot(v(-rx * s * Math.sin(a), ry * s * Math.cos(a)))
  const segs: Cubic[] = []
  for (let i = 0; i < n; i++) {
    const a1 = a0 + step * i
    const a2 = a1 + step
    const s1 = 1 + (drift - 1) * (i / n)
    const s2 = 1 + (drift - 1) * ((i + 1) / n)
    const p0 = at(a1, s1)
    const p3 = at(a2, s2)
    segs.push([p0, add(p0, mul(der(a1, s1), k)), sub(p3, mul(der(a2, s2), k)), p3])
  }
  const sign = Math.sign(sweep)
  return {
    segs,
    start: segs[0][0],
    end: segs[n - 1][3],
    startDir: norm(mul(der(a0, 1), sign)),
    endDir: norm(mul(der(a0 + sweep, drift), sign)),
  }
}

/** A cursive loop that leaves and rejoins the line travelling in direction `d`. */
function loopAt(m: V, d: V, r: number, width: number) {
  const a = v(-d.y, d.x)
  const b = v(d.y, -d.x)
  const n = Math.abs(d.x) > 0.5 ? (a.y < b.y ? a : b) : Math.sign(a.x) === Math.sign(width / 2 - m.x) ? a : b
  const c = add(m, mul(n, r))
  const a0 = Math.atan2(m.y - c.y, m.x - c.x)
  const inc = v(-Math.sin(a0), Math.cos(a0))
  const sweep = inc.x * d.x + inc.y * d.y > 0 ? Math.PI * 2 : -Math.PI * 2
  return arc(c, r, r, a0, sweep, 0.84)
}

/** Catmull–Rom through points, returned as cubics. */
function smooth(points: V[], tension = 1): Cubic[] {
  const segs: Cubic[] = []
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i]
    const p1 = points[i]
    const p2 = points[i + 1]
    const p3 = points[i + 2] ?? p2
    segs.push([p1, add(p1, mul(sub(p2, p0), tension / 6)), sub(p2, mul(sub(p3, p1), tension / 6)), p2])
  }
  return segs
}

type Box = { x: number; y: number; w: number; h: number }

function offsetWithin(el: HTMLElement, root: HTMLElement): Box {
  let x = 0
  let y = 0
  let node: HTMLElement | null = el
  while (node && node !== root) {
    x += node.offsetLeft
    y += node.offsetTop
    node = node.offsetParent as HTMLElement | null
  }
  return { x, y, w: el.offsetWidth, h: el.offsetHeight }
}

export type Geometry = {
  W: number
  H: number
  pageTop: number
  chunks: Array<{ d: string; start: number; len: number; minY: number; maxY: number }>
  total: number
  L: Float64Array
  X: Float64Array
  Y: Float64Array
  maxY: Float64Array
  marks: Array<{ el: HTMLElement; at: number }>
  surfaces: Surface[]
}

/** A section painted over the page (paper, or the accent plate): the line is redrawn above it in a darker ink. */
type Surface = { top: number; height: number; tone: 'paper' | 'signal' }

const SURFACE_INK: Record<Surface['tone'], { base: string; ink: string }> = {
  paper: { base: 'rgb(5 5 5 / 0.5)', ink: 'var(--color-accent)' },
  signal: {
    base: 'color-mix(in oklab, var(--color-on-accent) 45%, transparent)',
    ink: 'var(--color-on-accent)',
  },
}

const CHUNK = 1100

function build(root: HTMLElement): Geometry | null {
  const W = root.clientWidth
  // The page's own height. scrollHeight would include this SVG, so a page that was once taller
  // (fallback fonts, say) would keep its old height and leave a blank band under the footer.
  const H = root.offsetHeight

  const box = root.querySelector<HTMLElement>('.container-x')
  if (!box) return null
  const cs = getComputedStyle(box)
  const bx = offsetWithin(box, root).x
  const contentLeft = bx + parseFloat(cs.paddingLeft)
  const contentRight = bx + box.clientWidth - parseFloat(cs.paddingRight)
  const leftX = contentLeft - Math.min(contentLeft / 2, 24)
  const rightX = contentRight + Math.min((W - contentRight) / 2, 24)
  const small = W < 768
  const compact = W < 1024

  const els = Array.from(root.querySelectorAll<HTMLElement>('[data-thread]')).filter((el) => el.offsetParent !== null)
  const gestures: Gesture[] = []

  for (const el of els) {
    const r = offsetWithin(el, root)
    let kind = el.dataset.thread!
    const wraps = el.getClientRects().length > 1
    if ((kind === 'circle' || kind === 'underline') && wraps) continue
    if (compact && kind === 'underline') kind = 'circle'
    const fromRight = !compact && el.dataset.from === 'right'
    const exitDown = compact || el.dataset.exit === 'down'

    if (kind === 'node') {
      const c = v(r.x + r.w / 2, r.y + r.h / 2)
      const rad = clamp(leftX - 3, 6, 13)
      // Drop in on the left of the dot, go once around it, and carry on down.
      const a = arc(c, rad, rad, Math.PI, -(Math.PI * 2 + 0.3), 0.9)
      gestures.push({ el, kind, ...a, inK: 90, reach: 'start' })
      continue
    }

    if (kind === 'circle' || kind === 'end') {
      const c = v(r.x + r.w / 2, r.y + r.h * 0.54)
      const rx = r.w / 2 + clamp(r.h * 0.2, 10, 30)
      const ry = r.h * 0.5 + clamp(r.h * 0.08, 5, 12)
      // Leaving "down" means straight down the left edge; otherwise swing out to the lower right.
      const extra = exitDown ? (compact ? 0 : 0.06) : 1.05
      const a = fromRight
        ? arc(c, rx, ry, 0, Math.PI * 2 + extra, 1.07, -0.035)
        : arc(c, rx, ry, Math.PI, -(Math.PI * 2 + extra), 1.07, -0.035)
      const g: Gesture = { el, kind, ...a, inK: 90, reach: 'end' }
      if (kind === 'end') {
        // Pen lifts with a small hook, curling back under the button.
        const e = g.end
        const tail: Cubic = [e, add(e, mul(g.endDir, 30)), add(e, v(-6, 50)), add(e, v(-40, 56))]
        g.segs.push(tail)
        g.end = tail[3]
        g.endDir = norm(sub(tail[3], tail[2]))
      }
      gestures.push(g)
      continue
    }

    if (kind === 'underline') {
      const y0 = r.y + r.h * 0.9
      const p0 = v(r.x - 14, y0 + 3)
      const p3 = v(r.x + r.w + 18, y0 + 2)
      const p1 = v(r.x + r.w * 0.28, y0 + 11)
      const p2 = v(r.x + r.w * 0.72, y0 + 7)
      gestures.push({
        el,
        kind,
        segs: [[p0, p1, p2, p3]],
        start: p0,
        startDir: norm(sub(p1, p0)),
        end: p3,
        endDir: norm(sub(p3, p2)),
        inK: 120,
        outK: 110,
        reach: 'end',
      })
      continue
    }

    if (kind === 'scribble') {
      const back = el.dataset.from === 'right'
      const n = clamp(Math.round(r.w / 44), 5, 14)
      const pts: V[] = []
      for (let i = 0; i <= n; i++) {
        const t = i / n
        const jitter = ((i * 37) % 7) - 3
        pts.push(v(r.x - 10 + (r.w + 20) * (back ? 1 - t : t), r.y + r.h * (i % 2 ? 0.7 : 0.34) + jitter))
      }
      const segs = smooth(pts, 0.9)
      gestures.push({
        el,
        kind,
        segs,
        start: pts[0],
        startDir: norm(sub(pts[1], pts[0])),
        end: pts[n],
        endDir: norm(sub(pts[n], pts[n - 1])),
        inK: 110,
        reach: 'end',
      })
      continue
    }

    if (kind === 'rail') {
      const side = compact ? (el.dataset.sideSm ?? 'left') : (el.dataset.side ?? 'right')
      const x = side === 'left' ? leftX : rightX
      const top = v(x, r.y - (small ? 18 : 28))
      const bottom = v(x, r.y + r.h + (small ? 18 : 28))
      gestures.push({
        el,
        kind,
        segs: [[top, lerp(top, bottom, 1 / 3), lerp(top, bottom, 2 / 3), bottom]],
        start: top,
        startDir: v(0, 1),
        end: bottom,
        endDir: v(0, 1),
        inK: 36,
        reach: 'start',
      })
      continue
    }

    // point
    const p = v(r.x + r.w / 2, r.y + r.h / 2)
    const dir = el.dataset.dir?.split(',').map(Number)
    gestures.push({
      el,
      kind: 'point',
      segs: [],
      start: p,
      end: p,
      startDir: dir ? norm(v(dir[0], dir[1])) : v(0, 1),
      endDir: dir ? norm(v(dir[0], dir[1])) : v(0, 1),
      reach: 'start',
      auto: !dir,
    })
  }

  if (gestures.length < 2) return null

  // Waypoints without an explicit direction point from where the line was to where it's going.
  gestures.forEach((g, i) => {
    if (!g.auto) return
    const prev = gestures[i - 1]?.end ?? g.start
    const next = gestures[i + 1]?.start ?? g.end
    g.startDir = g.endDir = norm(sub(next, prev))
  })

  // A small flourish after gestures that ask for one.
  for (const g of gestures) {
    if (compact || g.el.dataset.loop === undefined) continue
    const l = loopAt(g.end, g.endDir, small ? 12 : 20, W)
    g.segs.push(...l.segs)
    g.end = l.end
    g.endDir = l.endDir
  }

  const segs: Cubic[] = []
  const markSeg: Array<{ el: HTMLElement; seg: number }> = []
  let crossings = 0

  gestures.forEach((g, i) => {
    if (i > 0) {
      const a = gestures[i - 1]
      const d = dist(a.end, g.start)
      const dy = Math.abs(g.start.y - a.end.y)
      const cap = (dir: V) => (Math.abs(dir.y) > 0.7 ? Math.max(40, dy * 0.6) : Infinity)
      const k1 = Math.min(a.outK ?? Infinity, cap(a.endDir), clamp(d * 0.45, 16, 380))
      const k2 = Math.min(g.inK ?? Infinity, cap(g.startDir), clamp(d * 0.45, 16, 380))
      const conn: Cubic = [a.end, add(a.end, mul(a.endDir, k1)), sub(g.start, mul(g.startDir, k2)), g.start]
      if (g.kind === 'node' && d > 240 && crossings++ % 2 === 0) {
        // Every other section change gets a loop halfway across.
        const [left, right] = split(conn, 0.5)
        const mid = right[0]
        const dir = norm(sub(right[1], left[2]))
        const l = loopAt(mid, dir, small ? 14 : 24, W)
        segs.push(left, ...l.segs, [l.end, add(l.end, sub(right[1], mid)), right[2], right[3]])
      } else if (d > 0.5) {
        segs.push(conn)
      }
    }
    if (g.reach === 'start') markSeg.push({ el: g.el, seg: segs.length })
    segs.push(...g.segs)
    if (g.reach === 'end') markSeg.push({ el: g.el, seg: segs.length })
  })

  // Sample the whole thing once: arc length → point, and a running max of y for scroll lookup.
  const L: number[] = [0]
  const X: number[] = [segs[0][0].x]
  const Y: number[] = [segs[0][0].y]
  const segStart: number[] = []
  let acc = 0
  for (const s of segs) {
    segStart.push(acc)
    let est = 0
    let prev = s[0]
    for (let j = 1; j <= 8; j++) {
      const p = bez(s, j / 8)
      est += dist(prev, p)
      prev = p
    }
    const steps = clamp(Math.ceil(est / 6), 3, 900)
    prev = s[0]
    for (let j = 1; j <= steps; j++) {
      const p = bez(s, j / steps)
      acc += dist(prev, p)
      L.push(acc)
      X.push(p.x)
      Y.push(p.y)
      prev = p
    }
  }
  segStart.push(acc)

  const maxY = new Float64Array(Y.length)
  let m = -Infinity
  for (let i = 0; i < Y.length; i++) {
    m = Math.max(m, Y[i])
    maxY[i] = m
  }

  // Chunk the path so only the piece being drawn repaints each frame.
  const f = (n: number) => Math.round(n * 10) / 10
  const chunks: Geometry['chunks'] = []
  let i = 0
  while (i < segs.length) {
    const start = segStart[i]
    let d = `M${f(segs[i][0].x)} ${f(segs[i][0].y)}`
    let lo = Infinity
    let hi = -Infinity
    while (i < segs.length && (segStart[i] - start < CHUNK || d.length < 12)) {
      const [, c1, c2, p3] = segs[i]
      d += `C${f(c1.x)} ${f(c1.y)} ${f(c2.x)} ${f(c2.y)} ${f(p3.x)} ${f(p3.y)}`
      for (const p of segs[i]) {
        lo = Math.min(lo, p.y)
        hi = Math.max(hi, p.y)
      }
      i++
    }
    chunks.push({ d, start, len: Math.max(0.01, segStart[i] - start), minY: lo, maxY: hi })
  }

  const surfaces = Array.from(root.querySelectorAll<HTMLElement>('[data-thread-surface]')).map((el): Surface => {
    const r = offsetWithin(el, root)
    return { top: r.y, height: r.h, tone: el.dataset.threadSurface === 'signal' ? 'signal' : 'paper' }
  })

  return {
    W,
    H,
    pageTop: root.getBoundingClientRect().top + window.scrollY,
    chunks,
    total: acc,
    L: Float64Array.from(L),
    X: Float64Array.from(X),
    Y: Float64Array.from(Y),
    maxY,
    marks: markSeg.map((mk) => ({ el: mk.el, at: segStart[mk.seg] })),
    surfaces,
  }
}

/** First sample index whose value is >= target (arr is non-decreasing). */
function search(arr: Float64Array, target: number) {
  let lo = 0
  let hi = arr.length - 1
  if (target <= arr[0]) return 0
  if (target > arr[hi]) return hi + 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (arr[mid] < target) lo = mid + 1
    else hi = mid
  }
  return lo
}

function lengthForY(g: Geometry, y: number) {
  const i = search(g.maxY, y)
  if (i === 0) return 0
  if (i >= g.maxY.length) return g.total
  const y0 = g.maxY[i - 1]
  const y1 = g.maxY[i]
  const t = y1 > y0 ? (y - y0) / (y1 - y0) : 1
  return g.L[i - 1] + (g.L[i] - g.L[i - 1]) * t
}

function pointAt(g: Geometry, l: number): V {
  const i = search(g.L, l)
  if (i === 0) return v(g.X[0], g.Y[0])
  if (i >= g.L.length) return v(g.X[g.L.length - 1], g.Y[g.L.length - 1])
  const t = (l - g.L[i - 1]) / (g.L[i] - g.L[i - 1] || 1)
  return v(g.X[i - 1] + (g.X[i] - g.X[i - 1]) * t, g.Y[i - 1] + (g.Y[i] - g.Y[i - 1]) * t)
}

function polyline(g: Geometry, from: number, to: number) {
  if (to - from < 0.5) return ''
  const a = pointAt(g, from)
  const b = pointAt(g, to)
  let d = `M${a.x.toFixed(1)} ${a.y.toFixed(1)}`
  for (let i = search(g.L, from); i < g.L.length && g.L[i] < to; i++) d += `L${g.X[i].toFixed(1)} ${g.Y[i].toFixed(1)}`
  return `${d}L${b.x.toFixed(1)} ${b.y.toFixed(1)}`
}

/* ------------------------------------------------------------------ */

/** How far down the viewport the pen sits. */
const PEN_LINE = 0.64
/** Fresh ink: the last stretch behind the pen, brightest at the tip. */
const INK = [
  { from: 360, to: 220, opacity: 0.2 },
  { from: 220, to: 90, opacity: 0.5 },
  { from: 90, to: 0, opacity: 1 },
]

export function Thread({ rootRef }: { rootRef: RefObject<HTMLDivElement | null> }) {
  const ready = useReady()
  const reduce = useReducedMotion()
  const [geom, setGeom] = useState<Geometry | null>(null)
  const [armed, setArmed] = useState(false)
  const geomRef = useRef<Geometry | null>(null)

  const baseRefs = useRef<Array<SVGPathElement | null>>([])
  const surfRefs = useRef<Array<Array<SVGPathElement | null>>>([])
  const inkRefs = useRef<Array<SVGPathElement | null>>([])
  const surfInkRefs = useRef<Array<Array<SVGPathElement | null>>>([])
  const headRef = useRef<HTMLDivElement>(null)
  const chunkState = useRef<number[]>([])
  const markState = useRef<boolean[]>([])

  const target = useMotionValue(0)
  const drawn = useSpring(target, { stiffness: 80, damping: 18, mass: 0.8, restDelta: 0.5 })
  const { scrollY } = useScroll()

  // (Re)build whenever the page reflows: fonts landing, resizes, panels opening.
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    let timer = 0
    const run = () => {
      const g = build(root)
      geomRef.current = g
      setGeom(g)
    }
    const schedule = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(run, 140)
    }
    run()
    document.fonts?.ready.then(schedule)
    // A face that arrives late can move words inside a fixed-height section without resizing the page.
    document.fonts?.addEventListener('loadingdone', schedule)
    const ro = new ResizeObserver(schedule)
    ro.observe(root)
    return () => {
      window.clearTimeout(timer)
      document.fonts?.removeEventListener('loadingdone', schedule)
      ro.disconnect()
    }
  }, [rootRef])

  // Let the headline land before the pen touches the page.
  useEffect(() => {
    if (!ready) return
    const t = window.setTimeout(() => setArmed(true), reduce ? 0 : 950)
    return () => window.clearTimeout(t)
  }, [ready, reduce])

  const aim = useCallback(() => {
    const g = geomRef.current
    if (!g) return
    if (reduce) {
      target.jump(g.total)
      drawn.jump(g.total)
      return
    }
    if (!armed) return
    const y = window.scrollY + window.innerHeight * PEN_LINE - g.pageTop
    target.set(lengthForY(g, y))
  }, [armed, reduce, target, drawn])

  useMotionValueEvent(scrollY, 'change', aim)
  useEffect(aim, [aim, geom])

  const paint = useCallback((l: number) => {
    const g = geomRef.current
    if (!g) return

    const st = chunkState.current
    g.chunks.forEach((c, i) => {
      const s = l >= c.start + c.len ? 2 : l <= c.start ? 0 : 1
      if (s === 1 || st[i] !== s) {
        const off = s === 2 ? 0 : s === 0 ? c.len : c.len - (l - c.start)
        const o = String(off)
        baseRefs.current[i]?.setAttribute('stroke-dashoffset', o)
        for (const refs of surfRefs.current) refs[i]?.setAttribute('stroke-dashoffset', o)
      }
      st[i] = s
    })

    INK.forEach((seg, k) => {
      const d = polyline(g, Math.max(0, l - seg.from), Math.max(0, l - seg.to))
      inkRefs.current[k]?.setAttribute('d', d)
      for (const refs of surfInkRefs.current) refs[k]?.setAttribute('d', d)
    })

    const head = headRef.current
    if (head) {
      const p = pointAt(g, l)
      head.style.transform = `translate3d(${p.x}px, ${p.y}px, 0)`
      head.style.opacity = !reduce && l > 2 && l < g.total - 2 ? '1' : '0'
    }

    g.marks.forEach((mk, i) => {
      const on = l >= mk.at - 1
      if (markState.current[i] === on) return
      markState.current[i] = on
      if (on) mk.el.setAttribute('data-on', '')
      else mk.el.removeAttribute('data-on')
    })
  }, [reduce])

  useMotionValueEvent(drawn, 'change', paint)

  useLayoutEffect(() => {
    if (!geom) return
    baseRefs.current.length = geom.chunks.length
    surfRefs.current = geom.surfaces.map((_, j) => {
      const refs = surfRefs.current[j] ?? []
      refs.length = geom.chunks.length
      return refs
    })
    surfInkRefs.current.length = geom.surfaces.length
    chunkState.current = geom.chunks.map(() => -1)
    markState.current = geom.marks.map(() => false)
    paint(drawn.get())
  }, [geom, paint, drawn])

  if (!geom) return null

  return (
    <>
      <svg
        aria-hidden
        className="pointer-events-none absolute left-0 top-0 [will-change:transform]"
        width={geom.W}
        height={geom.H}
        viewBox={`0 0 ${geom.W} ${geom.H}`}
        fill="none"
      >
        <g stroke="color-mix(in oklab, var(--color-fg) 30%, transparent)" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
          {geom.chunks.map((c, i) => (
            <path
              key={`${i}-${c.len}`}
              ref={(el) => void (baseRefs.current[i] = el)}
              d={c.d}
              pathLength={c.len}
              strokeDasharray={`${c.len} ${c.len}`}
              strokeDashoffset={c.len}
            />
          ))}
        </g>
        <g stroke="var(--color-accent-soft)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          {INK.map((seg, k) => (
            <path key={k} ref={(el) => void (inkRefs.current[k] = el)} strokeOpacity={seg.opacity} />
          ))}
        </g>
      </svg>

      {/* Over a painted section the line has to sit above the backdrop, in a darker ink. */}
      {geom.surfaces.map((s, j) => {
        const tone = SURFACE_INK[s.tone]
        return (
          <svg
            key={`${j}-${s.top}`}
            aria-hidden
            className="pointer-events-none absolute left-0 z-30"
            style={{ top: s.top }}
            width={geom.W}
            height={s.height}
            viewBox={`0 ${s.top} ${geom.W} ${s.height}`}
            fill="none"
          >
            <g stroke={tone.base} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
              {geom.chunks.map((c, i) =>
                c.maxY < s.top || c.minY > s.top + s.height ? null : (
                  <path
                    key={`${i}-${c.len}`}
                    ref={(el) => {
                      ;(surfRefs.current[j] ??= [])[i] = el
                    }}
                    d={c.d}
                    pathLength={c.len}
                    strokeDasharray={`${c.len} ${c.len}`}
                    strokeDashoffset={c.len}
                  />
                ),
              )}
            </g>
            <g stroke={tone.ink} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              {INK.map((seg, k) => (
                <path
                  key={k}
                  ref={(el) => {
                    ;(surfInkRefs.current[j] ??= [])[k] = el
                  }}
                  strokeOpacity={seg.opacity}
                />
              ))}
            </g>
          </svg>
        )
      })}

      <div
        ref={headRef}
        aria-hidden
        className="pointer-events-none absolute left-0 top-0 z-40 opacity-0 transition-opacity duration-500 [will-change:transform]"
      >
        <span className="absolute size-[9px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent-glow shadow-[0_0_0_4px_color-mix(in_oklab,var(--color-accent)_20%,transparent),0_0_22px_5px_color-mix(in_oklab,var(--color-accent)_55%,transparent)]" />
        <span className="absolute size-7 -translate-x-1/2 -translate-y-1/2 animate-ping rounded-full border border-accent-soft/40 [animation-duration:2.2s]" />
      </div>
    </>
  )
}
