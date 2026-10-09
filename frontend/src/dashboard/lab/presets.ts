import type { Generation } from '../../lib/api'

/** Where the piece is going: decides its shape, a sensible length, and the overlay in the preview. */
export type FormatId = 'reels' | 'tiktok' | 'shorts' | 'story' | 'feed' | 'square' | 'landscape'

export const FORMATS: Array<{ id: FormatId; label: string; aspect: string; duration: number; overlay: 'reels' | 'tiktok' | 'shorts' | 'story' | null; tip: string }> = [
  { id: 'reels', label: 'Reels', aspect: '9:16', duration: 8, overlay: 'reels', tip: 'Instagram Reels: vertical, hook in the first second, best at 7–15 s.' },
  { id: 'tiktok', label: 'TikTok', aspect: '9:16', duration: 10, overlay: 'tiktok', tip: 'TikTok: vertical, keep the subject clear of the right-hand buttons and the caption.' },
  { id: 'shorts', label: 'Shorts', aspect: '9:16', duration: 10, overlay: 'shorts', tip: 'YouTube Shorts: vertical, loops well when the last frame meets the first.' },
  { id: 'story', label: 'Story', aspect: '9:16', duration: 5, overlay: 'story', tip: 'Stories: vertical, leave the top and bottom bands free for stickers and replies.' },
  { id: 'feed', label: 'Feed 4:5', aspect: '4:5', duration: 5, overlay: null, tip: 'Instagram feed: the tallest shape the grid shows in full.' },
  { id: 'square', label: 'Square', aspect: '1:1', duration: 5, overlay: null, tip: 'Square: works on every feed.' },
  { id: 'landscape', label: '16:9', aspect: '16:9', duration: 5, overlay: null, tip: 'Landscape: YouTube and X.' },
]

export const formatOf = (id: string | undefined) => FORMATS.find((f) => f.id === id) ?? FORMATS[0]

/** A visual direction, added to the prompt when the piece is made. */
export const STYLES: Array<{ id: string; label: string; text: string }> = [
  { id: 'none', label: 'As written', text: '' },
  { id: 'ugc', label: 'UGC handheld', text: 'shot on a phone, handheld, natural light, authentic creator style, slight camera shake' },
  { id: 'cinematic', label: 'Cinematic', text: 'cinematic, shallow depth of field, anamorphic lens, rich contrast, film grain' },
  { id: 'product', label: 'Studio product', text: 'studio product shot, seamless backdrop, softbox lighting, crisp detail, commercial' },
  { id: 'lifestyle', label: 'Lifestyle', text: 'lifestyle, warm tones, candid moment, soft daylight, people in real places' },
  { id: 'macro', label: 'Satisfying macro', text: 'extreme close-up, macro detail, slow satisfying motion, tactile textures' },
  { id: 'retro', label: 'Retro film', text: 'vintage 35mm film look, halation, muted colours, nostalgic' },
]

export const styleOf = (id: string | undefined) => STYLES.find((s) => s.id === id) ?? STYLES[0]

/**
 * Proven short-form openings. `{x}` is replaced with what the person typed (or a placeholder),
 * so a template is a starting point, not a form to fill in.
 */
export const HOOKS: Array<{ id: string; label: string; template: string }> = [
  { id: 'reveal', label: 'Product reveal', template: 'Hook in the first second: {x} is revealed from behind a soft fabric that slides away, camera pushes in slowly, light catches the details' },
  { id: 'pov', label: 'POV', template: 'POV shot from the viewer’s eyes: hands reach for {x}, pick it up and use it, natural movement, close and personal' },
  { id: 'before-after', label: 'Before / after', template: 'Split moment: first a dull, messy before, then a quick whip transition to the after with {x}, bright and satisfying' },
  { id: 'unboxing', label: 'Unboxing', template: 'Top-down unboxing of {x}: the lid lifts, tissue paper unfolds, the product is lifted into frame, ASMR-like calm pace' },
  { id: 'day', label: 'Day in the life', template: 'Morning routine montage featuring {x}: window light, coffee, quick cuts between moments, warm and real' },
  { id: 'loop', label: 'Perfect loop', template: '{x} in a slow continuous motion that ends exactly where it began, seamless loop, centred composition' },
  { id: 'macro', label: 'Satisfying close-up', template: 'Extreme close-up of {x}: texture, pour or press in slow motion, crisp macro detail, oddly satisfying' },
]

export const fillHook = (template: string, subject: string) => template.replace('{x}', subject.trim() || 'the product')

/** What a remake starts from: the prompt as typed, before the style was added. */
export const promptOf = (g: Pick<Generation, 'prompt' | 'params'>) => {
  const base = g.params?.base_prompt
  return typeof base === 'string' && base ? base : g.prompt
}

/** The piece's shape as "w:h": what it was asked for, else what came out. */
export function aspectOf(g: Pick<Generation, 'params' | 'outputs'>, fallback = '9:16') {
  const asked = g.params?.aspect_ratio
  if (typeof asked === 'string' && asked.includes(':')) return asked
  const out = g.outputs[0]
  return out?.width && out?.height ? `${out.width}:${out.height}` : fallback
}

/** Where a piece was made for: saved with it, else guessed from its shape. */
export function formatFor(g: Pick<Generation, 'params' | 'outputs'>): FormatId {
  const saved = g.params?.format
  if (typeof saved === 'string' && FORMATS.some((f) => f.id === saved)) return saved as FormatId
  const [w, h] = aspectOf(g).split(':').map(Number)
  const shape = w / h || 1
  return FORMATS.reduce((best, f) => {
    const [fw, fh] = f.aspect.split(':').map(Number)
    const [bw, bh] = best.aspect.split(':').map(Number)
    return Math.abs(fw / fh - shape) < Math.abs(bw / bh - shape) ? f : best
  }, FORMATS[0]).id
}

/** "Reels · 9:16", or "Feed 4:5" where the name already says the shape. */
export function madeFor(g: Pick<Generation, 'params' | 'outputs'>) {
  const { label } = formatOf(formatFor(g))
  const aspect = aspectOf(g)
  return label.includes(aspect) ? label : `${label} · ${aspect}`
}

/** Recent prompts, kept in this browser only. */
const HISTORY_KEY = 'flowai-lab-prompts'
export function promptHistory(): string[] {
  try {
    const list = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]')
    return Array.isArray(list) ? list.filter((p) => typeof p === 'string') : []
  } catch {
    return []
  }
}
export function rememberPrompt(prompt: string) {
  const text = prompt.trim()
  if (!text) return
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify([text, ...promptHistory().filter((p) => p !== text)].slice(0, 30)))
  } catch {
    /* storage blocked: history is a convenience */
  }
}
