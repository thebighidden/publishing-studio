import { useEffect, useRef, type RefObject } from 'react'
import { useReducedMotion, type MotionValue } from 'framer-motion'

/*
 * Hundreds of fine threads of light, drawn on the GPU.
 *
 *   spread  one tight bundle leaves the left edge and fans out across the canvas: create once, publish everywhere.
 *   focus   threads come in from both edges and pinch together on one element (the final call to action).
 *
 * Each thread is an instanced triangle strip whose shape is computed in the vertex shader, so a frame costs
 * the CPU almost nothing. The pointer parts the threads, pulses of light ride them towards their ends, and the
 * colours come from the palette tokens (re-read whenever the palette changes).
 * Pauses while off screen; draws a single still frame for reduced motion; renders nothing without WebGL2.
 */

const SEGMENTS = 240

const VERT = /* glsl */ `#version 300 es
precision highp float;

layout(location = 0) in vec2 aVert; // x: position along the thread (0–1), y: which edge of the ribbon (−1 or 1)

uniform vec2 uRes;
uniform float uTime;
uniform float uMode;    // 0 spread, 1 focus
uniform vec2 uPinch;    // where the threads are bundled together, 0–1 of the canvas
uniform float uEndY;    // spread: the centre of the fan at the right-hand edge
uniform float uWide;    // half-height of the fan at its widest, share of the canvas height
uniform float uRise;    // focus: how far the threads climb towards the edges, so they arrive from above
uniform float uCount;
uniform float uStride;  // the glow pass only draws every other thread
uniform vec3 uMouse;    // xy 0–1, z strength
uniform vec2 uTilt;     // pointer parallax, −1–1
uniform float uGather;  // 0–1: pull every thread back into one
uniform float uWidth;   // core line width, device px
uniform float uDpr;
uniform float uPass;    // 0 core, 1 glow

out float vX;
out float vU;
out float vEdge;
out float vHalf;
out float vDepth;
out float vSeed;
out float vNear;

float hash(float n) { return fract(sin(n * 91.3458) * 47453.5453); }

vec2 thread(float t, float lane, float h1, float h2, float depth) {
  float x = mix(-0.06, 1.06, t);
  float aspect = uRes.x / uRes.y;
  float d;
  float spread;
  float cy;
  if (uMode < 0.5) {
    d = clamp((x - uPinch.x) / (1.06 - uPinch.x), 0.0, 1.0);
    spread = mix(0.007, uWide, pow(d, 1.3));
    cy = mix(uPinch.y, uEndY, smoothstep(0.0, 1.0, d));
    cy += (0.06 * sin(x * 2.4 + uTime * 0.21) + 0.03 * sin(x * 5.7 - uTime * 0.29)) * d;
  } else {
    d = clamp(abs(x - uPinch.x) / 0.58, 0.0, 1.0);
    spread = mix(0.003, uWide, pow(d, 1.55));
    cy = uPinch.y - uRise * pow(d, 1.4) + (0.05 * sin(x * 2.9 + uTime * 0.23) + 0.025 * sin(x * 6.4 - uTime * 0.33)) * d;
  }
  spread *= 1.0 - 0.94 * uGather;

  float y = cy + lane * spread;
  // Neighbours drift together and far lanes apart, so the fan weaves like silk.
  y += spread * 0.24 * sin(x * 3.9 + uTime * 0.37 + lane * 2.1 + h1 * 6.2832);
  y += spread * 0.07 * sin(x * 10.5 - uTime * 0.61 + h2 * 6.2832);
  // Near threads move more with the pointer than far ones.
  y += uTilt.y * 0.03 * (depth - 0.4) * d;

  // The pointer parts the threads around it.
  vec2 dm = vec2((x - uMouse.x) * aspect, y - uMouse.y);
  float r = length(dm);
  float f = exp(-(r * r) / 0.011) * uMouse.z;
  y += dm.y / (r + 0.015) * f * 0.08;
  vNear = f;
  return vec2(x, y);
}

void main() {
  float id = float(gl_InstanceID) * uStride;
  float h1 = hash(id + 1.0);
  float h2 = hash(id + 23.0);
  float depth = hash(id + 57.0);

  float lane = (id + 0.5) / uCount * 2.0 - 1.0;
  lane += (h1 - 0.5) * 2.4 / uCount;
  lane = sign(lane) * pow(abs(lane), 1.2);

  float t = aVert.x;
  vec2 a = thread(t, lane, h1, h2, depth) * uRes;
  vec2 b = thread(t + 0.0025, lane, h1, h2, depth) * uRes;
  vec2 dir = b - a;
  dir = length(dir) > 1e-4 ? normalize(dir) : vec2(1.0, 0.0);
  vec2 n = vec2(-dir.y, dir.x);

  float hw = uPass > 0.5 ? uWidth * 4.5 : uWidth * mix(0.32, 1.0, depth * depth) * 0.5;
  float ext = hw + uDpr;
  vec2 p = a + n * aVert.y * ext;

  vX = mix(-0.06, 1.06, t);
  vU = uMode < 0.5 ? t : 1.0 - abs(vX - uPinch.x) / max(uPinch.x, 1.0 - uPinch.x);
  vEdge = aVert.y * ext;
  vHalf = hw;
  vDepth = depth;
  vSeed = h2;
  gl_Position = vec4(p.x / uRes.x * 2.0 - 1.0, 1.0 - p.y / uRes.y * 2.0, 0.0, 1.0);
}
`

const FRAG = /* glsl */ `#version 300 es
precision highp float;

in float vX;
in float vU;
in float vEdge;
in float vHalf;
in float vDepth;
in float vSeed;
in float vNear;

uniform vec3 uC1;
uniform vec3 uC2;
uniform vec3 uC3;
uniform float uTime;
uniform float uIntro;
uniform float uPass;
uniform float uMode;
uniform float uGather;
uniform float uGain;
uniform vec2 uRes;
uniform vec4 uQuiet;     // a rectangle (device px, from the top-left) where the threads dim, so text over it reads
uniform float uFeather;
uniform float uQuietDim; // how much of a thread's light is left inside that rectangle

out vec4 outColor;

// The posts in transit wear the colours of the content they carry (the same ones as the generated art on the page).
vec3 content(float s) {
  float k = fract(s * 5.31);
  return k < 0.25 ? vec3(1.0, 0.70, 0.54)
       : k < 0.5  ? vec3(0.92, 0.42, 0.30)
       : k < 0.75 ? vec3(0.66, 0.78, 0.56)
       :            vec3(0.60, 0.76, 0.94);
}

void main() {
  float cover = uPass > 0.5
    ? exp(-(vEdge / vHalf) * (vEdge / vHalf) * 2.5)
    : clamp(vHalf + 0.5 - abs(vEdge), 0.0, 1.0);

  // Drawn on from the source: everything behind the moving front shows, and the front itself sparks.
  float front = uIntro * 1.3 - 0.12;
  float shown = 1.0 - smoothstep(front - 0.12, front, vU);
  float spark = exp(-pow((vU - front + 0.05) / 0.04, 2.0)) * (1.0 - uIntro);

  // Posts in transit: a few bright pulses ride some of the threads towards their ends.
  float speed = 0.035 + vSeed * 0.06;
  float ph = fract(vU - uTime * speed + vSeed * 17.0);
  float pulse = exp(-pow((ph - 0.5) / 0.018, 2.0)) * step(0.55, fract(vSeed * 9.17));

  float ends = uMode < 0.5
    ? smoothstep(-0.06, 0.05, vX) * (1.0 - smoothstep(0.93, 1.06, vX))
    : smoothstep(-0.04, 0.12, vX) * (1.0 - smoothstep(0.88, 1.04, vX));

  vec3 col = mix(uC1, uC2, clamp(smoothstep(0.1, 1.0, vU) * 0.75 + vSeed * 0.3, 0.0, 1.0));
  col = mix(col, uC3, vDepth * 0.45);
  float glint = spark * 1.6 + vNear * 0.7;
  float lift = pulse * 1.4 + glint;
  col = mix(col, vec3(1.0), clamp(glint * 0.6, 0.0, 0.85));
  col = mix(col, content(vSeed), clamp(pulse * 1.2, 0.0, 0.95));

  float base = mix(0.06, 0.32, vDepth * vDepth);
  float a = (base + lift) * ends * shown * (1.0 - 0.45 * uGather) * uGain;
  vec2 fc = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec2 out2 = max(uQuiet.xy - fc, fc - uQuiet.zw);
  a *= mix(1.0, uQuietDim, 1.0 - smoothstep(0.0, uFeather, length(max(out2, 0.0))));
  if (uPass > 0.5) a *= 0.045 + 0.05 * lift;
  outColor = vec4(col, clamp(a * cover, 0.0, 1.0));
}
`

type RGB = [number, number, number]

let probe: CanvasRenderingContext2D | null = null

/** Any CSS colour → 0–1 RGB, via a 2D canvas, which normalises colour strings for us. */
function toRGB(css: string, fallback: RGB): RGB {
  probe ??= document.createElement('canvas').getContext('2d')
  if (!probe || !css) return fallback
  probe.fillStyle = '#000'
  probe.fillStyle = css
  const s = String(probe.fillStyle)
  if (s.startsWith('#') && s.length === 7) {
    return [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16) / 255) as RGB
  }
  const m = s.match(/[\d.]+/g)
  return m && m.length >= 3 ? (m.slice(0, 3).map((n) => Number(n) / 255) as RGB) : fallback
}

function readPalette(): [RGB, RGB, RGB] {
  const cs = getComputedStyle(document.documentElement)
  return [
    toRGB(cs.getPropertyValue('--color-accent').trim(), [0.39, 0.4, 0.95]),
    toRGB(cs.getPropertyValue('--color-accent-2').trim(), [0.55, 0.36, 0.96]),
    toRGB(cs.getPropertyValue('--color-accent-soft').trim(), [0.65, 0.71, 0.99]),
  ]
}

function compile(gl: WebGL2RenderingContext, type: number, src: string) {
  const s = gl.createShader(type)!
  gl.shaderSource(s, src)
  gl.compileShader(s)
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    console.warn('FlowField shader:', gl.getShaderInfoLog(s))
    gl.deleteShader(s)
    return null
  }
  return s
}

const UNIFORMS = [
  'uRes', 'uTime', 'uMode', 'uPinch', 'uEndY', 'uWide', 'uCount', 'uStride', 'uMouse', 'uTilt', 'uGather',
  'uWidth', 'uDpr', 'uPass', 'uC1', 'uC2', 'uC3', 'uIntro', 'uGain', 'uQuiet', 'uFeather', 'uQuietDim', 'uRise',
] as const
type Uniform = (typeof UNIFORMS)[number]

type Props = {
  mode?: 'spread' | 'focus'
  className?: string
  /** Start drawing. Until then the canvas stays empty (the hero waits for the preloader). */
  play?: boolean
  /** Spread: the height (0–1) at which the bundle leaves the left edge, and where the fan's centre ends up. */
  from?: number
  to?: number
  /** Half-height of the fan at its widest, as a share of the canvas height. */
  spread?: number
  /** Focus: how far up the threads start at the edges (share of the canvas height). */
  rise?: number
  /** Focus: the element the threads converge on. */
  focusRef?: RefObject<HTMLElement | null>
  /** Threads dim behind this element, so the text on it stays easy to read. */
  quietRef?: RefObject<HTMLElement | null>
  /** Spread: the bundle leaves the left edge just below this element (overrides `from`), whatever the viewport. */
  sourceRef?: RefObject<HTMLElement | null>
  /** 0–1: pulls every thread back into one, e.g. as the section scrolls away. */
  gather?: MotionValue<number>
  /** Thread count at desktop widths; narrow screens get 70% of it. */
  strands?: number
  /** Overall brightness. */
  gain?: number
}

export function FlowField({
  mode = 'spread',
  className,
  play = true,
  from = 0.7,
  to = 0.4,
  spread = 0.42,
  rise = 0,
  focusRef,
  quietRef,
  sourceRef,
  gather,
  strands = 150,
  gain = 1,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const reduce = useReducedMotion()
  const live = useRef({ play, from, to, spread, rise, gather, gain, focusRef, quietRef, sourceRef })
  live.current = { play, from, to, spread, rise, gather, gain, focusRef, quietRef, sourceRef }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: true, premultipliedAlpha: true, powerPreference: 'high-performance' })
    if (!gl) return

    const vs = compile(gl, gl.VERTEX_SHADER, VERT)
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG)
    if (!vs || !fs) return
    const prog = gl.createProgram()!
    gl.attachShader(prog, vs)
    gl.attachShader(prog, fs)
    gl.linkProgram(prog)
    gl.deleteShader(vs)
    gl.deleteShader(fs)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.warn('FlowField program:', gl.getProgramInfoLog(prog))
      return
    }
    const u = Object.fromEntries(UNIFORMS.map((n) => [n, gl.getUniformLocation(prog, n)])) as Record<Uniform, WebGLUniformLocation | null>

    // One strip, shared by every thread: (t, −1), (t, 1) for each step along it.
    const verts = new Float32Array((SEGMENTS + 1) * 4)
    for (let i = 0; i <= SEGMENTS; i++) {
      const t = i / SEGMENTS
      verts.set([t, -1, t, 1], i * 4)
    }
    const vao = gl.createVertexArray()
    const buf = gl.createBuffer()
    gl.bindVertexArray(vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)

    let colors = readPalette()
    const paletteWatch = new MutationObserver(() => {
      colors = readPalette()
      if (reduce) draw(performance.now())
    })
    // Only the palette attribute: the smooth scroller toggles classes on <html> all the time.
    paletteWatch.observe(document.documentElement, { attributes: true, attributeFilter: ['data-palette'] })

    let dpr = 1
    let count = strands
    let narrow = false
    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 1.75)
      const w = Math.max(1, Math.round(canvas.clientWidth * dpr))
      const h = Math.max(1, Math.round(canvas.clientHeight * dpr))
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w
        canvas.height = h
      }
      narrow = canvas.clientWidth < 768
      count = narrow ? Math.round(strands * 0.7) : strands
      if (reduce) draw(performance.now())
    }
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)

    // Pointer, eased so the threads move like something with weight.
    const pointer = { x: -1, y: -1, nx: 0, ny: 0 }
    const eased = { x: 0.5, y: 0.5, s: 0, tx: 0, ty: 0 }
    const onMove = (e: PointerEvent) => {
      pointer.x = e.clientX
      pointer.y = e.clientY
      pointer.nx = (e.clientX / window.innerWidth) * 2 - 1
      pointer.ny = (e.clientY / window.innerHeight) * 2 - 1
    }
    const onLeave = () => {
      pointer.x = -1
      pointer.y = -1
    }
    if (!reduce) {
      window.addEventListener('pointermove', onMove, { passive: true })
      document.addEventListener('pointerleave', onLeave)
    }

    const start = performance.now()
    let introAt: number | null = null
    let raf = 0
    let visible = false

    function draw(now: number) {
      if (!gl) return
      const L = live.current
      const w = canvas!.width
      const h = canvas!.height
      const rect = canvas!.getBoundingClientRect()

      // Draw-on: begins when `play` first turns on.
      if (L.play && introAt === null) introAt = now
      const intro = reduce ? 1 : introAt === null ? 0 : Math.min(1, Math.max(0, (now - introAt - 250) / 3000))
      // Quick off the mark, long glide in: the front races out of the source and settles at the far edge.
      const introEased = 1 - Math.pow(1 - intro, 4)

      const inside = pointer.x >= rect.left && pointer.x <= rect.right && pointer.y >= rect.top && pointer.y <= rect.bottom
      if (inside) {
        eased.x += ((pointer.x - rect.left) / rect.width - eased.x) * 0.12
        eased.y += ((pointer.y - rect.top) / rect.height - eased.y) * 0.12
      }
      eased.s += ((inside ? 1 : 0) - eased.s) * 0.05
      eased.tx += (pointer.nx - eased.tx) * 0.04
      eased.ty += (pointer.ny - eased.ty) * 0.04

      let pinch: [number, number] = [-0.05, L.from]
      const source = L.sourceRef?.current?.getBoundingClientRect()
      if (mode === 'spread' && source && source.height > 0 && rect.height > 0) {
        pinch = [-0.05, Math.min(0.95, (source.bottom - rect.top + 34) / rect.height)]
      }
      if (mode === 'focus') {
        const el = L.focusRef?.current
        if (el && rect.width > 0 && rect.height > 0) {
          const r = el.getBoundingClientRect()
          pinch = [(r.left + r.width / 2 - rect.left) / rect.width, (r.top + r.height / 2 - rect.top) / rect.height]
        } else {
          pinch = [0.5, 0.5]
        }
      }

      gl.viewport(0, 0, w, h)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      if (introEased <= 0) return

      gl.useProgram(prog)
      gl.bindVertexArray(vao)
      gl.enable(gl.BLEND)
      gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE, gl.ONE, gl.ONE)

      const time = reduce ? 14 : (now - start) / 1000
      gl.uniform2f(u.uRes, w, h)
      gl.uniform1f(u.uTime, time)
      gl.uniform1f(u.uMode, mode === 'focus' ? 1 : 0)
      gl.uniform2f(u.uPinch, pinch[0], pinch[1])
      gl.uniform1f(u.uEndY, L.to)
      gl.uniform1f(u.uWide, L.spread)
      gl.uniform1f(u.uRise, L.rise)
      gl.uniform1f(u.uCount, count)
      gl.uniform3f(u.uMouse, eased.x, eased.y, reduce ? 0 : eased.s)
      gl.uniform2f(u.uTilt, eased.tx, eased.ty)
      gl.uniform1f(u.uGather, L.gather ? Math.min(1, Math.max(0, L.gather.get())) : 0)
      gl.uniform1f(u.uWidth, 1.5 * dpr)
      gl.uniform1f(u.uDpr, dpr)
      gl.uniform3fv(u.uC1, colors[0])
      gl.uniform3fv(u.uC2, colors[1])
      gl.uniform3fv(u.uC3, colors[2])
      gl.uniform1f(u.uIntro, introEased)
      gl.uniform1f(u.uGain, L.gain)
      const quiet = L.quietRef?.current?.getBoundingClientRect()
      if (quiet && quiet.width > 0) {
        const sx = w / rect.width
        const sy = h / rect.height
        gl.uniform4f(u.uQuiet, (quiet.left - rect.left) * sx, (quiet.top - rect.top) * sy, (quiet.right - rect.left) * sx, (quiet.bottom - rect.top) * sy)
      } else {
        gl.uniform4f(u.uQuiet, -1e5, -1e5, -1e5, -1e5)
      }
      gl.uniform1f(u.uFeather, (narrow ? 50 : 90) * dpr)
      // On a phone the text spans the whole width, so dim less or the threads all but vanish.
      gl.uniform1f(u.uQuietDim, narrow ? 0.5 : 0.22)

      const n = (SEGMENTS + 1) * 2
      // Soft halo first, on every other thread, then the fine core of every thread.
      gl.uniform1f(u.uPass, 1)
      gl.uniform1f(u.uStride, 2)
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, n, Math.ceil(count / 2))
      gl.uniform1f(u.uPass, 0)
      gl.uniform1f(u.uStride, 1)
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, n, count)
    }

    const loop = (now: number) => {
      raf = 0
      if (!visible) return
      draw(now)
      raf = requestAnimationFrame(loop)
    }
    const kick = () => {
      if (!raf && visible) raf = requestAnimationFrame(loop)
    }

    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting
      if (reduce) {
        if (visible) draw(performance.now())
        return
      }
      kick()
    })
    io.observe(canvas)
    resize()

    const onLost = (e: Event) => {
      e.preventDefault()
      cancelAnimationFrame(raf)
      raf = 0
      visible = false
    }
    canvas.addEventListener('webglcontextlost', onLost)

    return () => {
      cancelAnimationFrame(raf)
      io.disconnect()
      ro.disconnect()
      paletteWatch.disconnect()
      window.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerleave', onLeave)
      canvas.removeEventListener('webglcontextlost', onLost)
      gl.deleteBuffer(buf)
      gl.deleteVertexArray(vao)
      gl.deleteProgram(prog)
    }
  }, [mode, reduce, strands])

  return <canvas ref={canvasRef} aria-hidden className={className} />
}
