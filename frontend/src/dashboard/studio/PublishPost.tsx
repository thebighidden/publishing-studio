import { useState } from 'react'
import { CalendarClock, Check, FileText, Sparkles } from 'lucide-react'
import { PLATFORMS, PlatformIcon, type PlatformId } from '../../components/ui/PlatformIcon'
import { api, type Asset } from '../../lib/api'
import { cn } from '../../lib/cn'
import { useRouter } from '../../lib/router'
import { PLATFORM_ORDER, useInvalidate } from '../data'
import { MediaThumb } from '../media/Media'
import { useToast } from '../toast'
import { useUser } from '../Shell'
import { Btn, inputClass, Label, Modal, Segmented } from '../ui'
import { messageFor } from './run'

/** What goes into the post: finished files from the lab, or written text, and a first caption. */
export type PostSource = { format: 'text' | 'image' | 'video'; assets: Asset[]; caption: string; label: string }

/** A compact hand-off from a finished creative asset to the studio's multi-platform scheduler. */
export function PublishPost({ source, onClose }: { source: PostSource | null; onClose: () => void }) {
  const user = useUser()
  const { navigate } = useRouter()
  const toast = useToast()
  const invalidate = useInvalidate()
  const nextMorning = () => {
    const date = new Date()
    date.setDate(date.getDate() + 1)
    return { date: date.toISOString().slice(0, 10), time: '09:00' }
  }
  const initial = nextMorning()
  const [caption, setCaption] = useState('')
  const [platforms, setPlatforms] = useState<PlatformId[]>(user.preferences.platforms.length ? user.preferences.platforms : ['instagram', 'tiktok'])
  const [date, setDate] = useState(initial.date)
  const [time, setTime] = useState(initial.time)
  const [mode, setMode] = useState<'draft' | 'schedule'>('schedule')
  const [saving, setSaving] = useState(false)

  // New source, new suggested caption. Keep an operator's edits while the modal stays open.
  const effectiveCaption = caption || (source?.caption ?? '')
  const toggle = (id: PlatformId) => setPlatforms((items) => (items.includes(id) ? items.filter((item) => item !== id) : PLATFORM_ORDER.filter((item) => item === id || items.includes(item))))
  const save = async () => {
    if (!source || !effectiveCaption.trim() || !platforms.length) return
    const scheduledAt = new Date(`${date}T${time}`).toISOString()
    if (mode === 'schedule' && Number.isNaN(Date.parse(scheduledAt))) return toast('Choose a valid date and time.', 'error')
    setSaving(true)
    try {
      await api('/posts', {
        method: 'POST',
        body: {
          body: effectiveCaption.trim(),
          format: source.format,
          platforms,
          status: mode === 'schedule' ? 'scheduled' : 'draft',
          scheduled_at: mode === 'schedule' ? scheduledAt : null,
          asset_ids: source.assets.map((asset) => asset.id),
        },
      })
      invalidate()
      toast(mode === 'schedule' ? 'Post scheduled across the selected platforms.' : 'Post saved as a draft.')
      onClose()
      navigate(mode === 'schedule' ? '/dashboard/calendar' : '/dashboard/library')
    } catch (error) {
      toast(messageFor(error), 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={!!source} onClose={onClose} title="Create a multi-platform post" className="max-w-2xl">
      {source && (
        <div className="space-y-5">
          <div className="flex items-center gap-3 rounded-lg border border-accent/30 bg-accent/[0.06] p-3">
            {source.assets[0] ? <MediaThumb asset={source.assets[0]} className="size-12" /> : <Sparkles className="m-3 size-5 text-accent-soft" />}
            <div className="min-w-0">
              <p className="text-[12.5px] font-medium">{source.assets.length ? `${source.assets.length} creative asset${source.assets.length > 1 ? 's' : ''} attached` : 'Text output attached'}</p>
              <p className="truncate text-[11px] text-dim">{source.label}</p>
            </div>
          </div>
          <label className="block">
            <Label>Caption</Label>
            <textarea value={effectiveCaption} onChange={(event) => setCaption(event.target.value)} rows={4} className={cn(inputClass, 'mt-2 h-auto resize-none py-2.5')} />
          </label>
          <div>
            <Label>Publish to</Label>
            <div className="mt-2 flex flex-wrap gap-2">
              {PLATFORM_ORDER.map((id) => {
                const active = platforms.includes(id)
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => toggle(id)}
                    aria-pressed={active}
                    className={cn('flex h-9 items-center gap-2 rounded-full border px-3 text-[12px] transition-colors', active ? 'border-fg bg-fg text-ink' : 'border-line-2 text-muted hover:text-fg')}
                  >
                    <PlatformIcon id={id} className="size-3.5" />
                    {PLATFORMS[id].name}
                    {active && <Check className="size-3" />}
                  </button>
                )
              })}
            </div>
          </div>
          <div className="rounded-lg border border-line p-3">
            <div className="flex items-center justify-between gap-3">
              <Label>Publishing plan</Label>
              <Segmented id="lab-post-mode" label="Publishing plan" options={[{ value: 'draft', label: 'Save draft' }, { value: 'schedule', label: 'Schedule' }]} value={mode} onChange={setMode} />
            </div>
            {mode === 'schedule' && (
              <div className="mt-3 grid grid-cols-2 gap-2">
                <label>
                  <Label>Date</Label>
                  <input type="date" value={date} min={new Date().toISOString().slice(0, 10)} onChange={(event) => setDate(event.target.value)} className={cn(inputClass, 'mt-1.5')} />
                </label>
                <label>
                  <Label>Time</Label>
                  <input type="time" value={time} onChange={(event) => setTime(event.target.value)} className={cn(inputClass, 'mt-1.5')} />
                </label>
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <Btn variant="subtle" onClick={onClose}>
              Cancel
            </Btn>
            <Btn variant="primary" icon={mode === 'schedule' ? CalendarClock : FileText} onClick={save} loading={saving} disabled={!effectiveCaption.trim() || !platforms.length}>
              {mode === 'schedule' ? 'Schedule post' : 'Save draft'}
            </Btn>
          </div>
        </div>
      )}
    </Modal>
  )
}
