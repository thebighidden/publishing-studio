import type { Campaign, CampaignPhoto } from '../../lib/api'

/** Long edge photos are scaled to before upload: what Claude reads at full detail, and far below its 5 MB cap. */
const MAX_EDGE = 1568
export const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']

/**
 * Phone photos are often 4000 px and 6 MB. Scale anything big down to a JPEG, on a white
 * ground so transparent product shots don't turn black. Small files go up as they are.
 */
export async function shrinkPhoto(file: File): Promise<File> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    return file
  }
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
  if (scale === 1 && file.size < 1.5 * 1024 * 1024) {
    bitmap.close()
    return file
  }

  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  const ctx = canvas.getContext('2d')
  if (!ctx) return file
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.86))
  return blob ? new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }) : file
}

/** The interview as plain lines, the way the strategist's notes read. */
export function transcript(campaign: Campaign) {
  return campaign.messages
    .filter((m) => m.who !== 'note')
    .map((m) => `${m.who === 'agency' ? 'Strategist' : 'Client'}: ${m.text}`)
    .join('\n')
}

/** What "Copy brief" copies: the brief, then the kit if there is one. */
export const briefText = (campaign: Campaign) =>
  campaign.markdown + (campaign.kit ? `\n\n# Content kit\n\n${campaign.kit}` : '')

const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' }
const photoFile = (p: CampaignPhoto, i: number) => `photos/photo-${i + 1}${p.kind ? `-${p.kind}` : ''}.${EXT[p.mime] ?? 'jpg'}`

const slug = (s: string | null) =>
  (s ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'campaign'

/**
 * Everything an agency needs to produce the campaign, as one zip: the brief (Markdown and JSON,
 * with the interview), the content kit, and the reference photos.
 */
export async function downloadPackage(campaign: Campaign) {
  const { default: JSZip } = await import('jszip')
  const zip = new JSZip()

  zip.file('brief.md', `${campaign.markdown}\n## Interview\n${transcript(campaign)}\n`)
  zip.file(
    'brief.json',
    JSON.stringify(
      {
        created: campaign.created_at,
        fields: Object.fromEntries(campaign.brief.flatMap((g) => g.fields.map((f) => [f.key, { label: f.label, value: f.value }]))),
        photos: campaign.photos.map((p, i) => ({ file: photoFile(p, i), kind: p.kind, title: p.title, description: p.description })),
        transcript: campaign.messages.filter((m) => m.who !== 'note').map(({ who, text }) => ({ who, text })),
        content_kit_markdown: campaign.kit,
      },
      null,
      2,
    ),
  )
  if (campaign.kit) zip.file('content-kit.md', `# Content kit\n\n${campaign.kit}`)

  await Promise.all(
    campaign.photos.map(async (p, i) => {
      const res = await fetch(p.url, { credentials: 'same-origin' })
      if (res.ok) zip.file(photoFile(p, i), await res.blob())
    }),
  )

  const url = URL.createObjectURL(await zip.generateAsync({ type: 'blob' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `${slug(campaign.title)}-brief.zip`
  a.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const ta = document.createElement('textarea')
    ta.value = text
    document.body.appendChild(ta)
    ta.select()
    let ok = false
    try {
      ok = document.execCommand('copy')
    } catch {
      /* nothing else to try */
    }
    ta.remove()
    return ok
  }
}
