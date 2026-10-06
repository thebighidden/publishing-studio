import { useState } from 'react'
import { ArrowRight, Check, Sparkles } from 'lucide-react'
import { PlatformIcon } from '../../components/ui/PlatformIcon'
import { api, ApiError, type Account, type BriefForm, type Campaign } from '../../lib/api'
import { cn } from '../../lib/cn'
import { useRouter } from '../../lib/router'
import { Interview } from '../intake/Interview'
import { useToast } from '../toast'
import { Btn, FieldError, inputClass, Label, Panel } from '../ui'

const FIELDS: Array<{ key: keyof BriefForm; label: string; hint: string; rows?: number; type?: 'date' }> = [
  { key: 'goal', label: 'Goal', hint: 'What it’s for: sell the gift box, grow the list, fill the workshop.' },
  { key: 'audience', label: 'Audience', hint: 'Who it’s for, specifically.', rows: 2 },
  { key: 'message', label: 'Message', hint: 'The one thing people should take away.', rows: 2 },
  { key: 'key_facts', label: 'Key facts', hint: 'Prices, dates, names, numbers: the agents use these and never invent others.', rows: 3 },
  { key: 'rhythm', label: 'Rhythm', hint: 'How often to post, e.g. 3 times a week.' },
  { key: 'deadline', label: 'Deadline', hint: 'When it has to be done by.', type: 'date' },
]

/** The brief (the form, or the interview), and what the agents need to plan: accounts and a period. */
export function BriefTab({ campaign, accounts, onChange }: { campaign: Campaign; accounts: Account[]; onChange: (c: Campaign) => void }) {
  const locked = !!campaign.plan_approved_at
  return (
    <div className="space-y-4">
      {campaign.source === 'form' ? <FormBrief campaign={campaign} locked={locked} onChange={onChange} /> : <Interview initial={campaign} embedded onChange={onChange} />}
      <Setup campaign={campaign} accounts={accounts} onChange={onChange} />
    </div>
  )
}

function FormBrief({ campaign, locked, onChange }: { campaign: Campaign; locked: boolean; onChange: (c: Campaign) => void }) {
  const toast = useToast()
  const [form, setForm] = useState<BriefForm>(campaign.brief_form)
  const [name, setName] = useState(campaign.name ?? '')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const dirty = name !== (campaign.name ?? '') || FIELDS.some((f) => (form[f.key] ?? '') !== (campaign.brief_form[f.key] ?? ''))

  const save = async () => {
    setSaving(true)
    setErrors({})
    try {
      onChange(await api<Campaign>(`/campaigns/${campaign.id}`, { method: 'PATCH', body: { name: name || null, brief: form } }))
      toast('Brief saved.')
    } catch (e) {
      if (e instanceof ApiError && e.status === 422) setErrors(Object.fromEntries(Object.keys(e.errors).map((k) => [k.replace('brief.', ''), e.field(k) ?? ''])))
      else toast(e instanceof Error ? e.message : 'Couldn’t save.', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Panel
      title="Campaign brief"
      sub={locked ? 'The plan is approved, so the brief is fixed.' : 'The agents work from this. Be specific: real details make content that feels like you.'}
      actions={!locked && <Btn variant="primary" size="sm" icon={Check} onClick={save} loading={saving} disabled={!dirty}>Save</Btn>}
    >
      <div className="grid gap-4 md:grid-cols-2">
        <label className="block md:col-span-2">
          <Label>Name</Label>
          <input value={name} onChange={(e) => setName(e.target.value)} disabled={locked} placeholder="Autumn pour" className={cn(inputClass, 'mt-2')} />
        </label>
        {FIELDS.map((f) => (
          <label key={f.key} className={cn('block', (f.rows ?? 1) > 1 && 'md:col-span-2')}>
            <Label>{f.label}</Label>
            {f.type === 'date' ? (
              <input type="date" value={form[f.key] ?? ''} disabled={locked} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} className={cn(inputClass, 'mt-2')} />
            ) : (f.rows ?? 1) > 1 ? (
              <textarea rows={f.rows} value={form[f.key] ?? ''} disabled={locked} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} className={cn(inputClass, 'mt-2 h-auto resize-none py-2 leading-snug')} />
            ) : (
              <input value={form[f.key] ?? ''} disabled={locked} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} className={cn(inputClass, 'mt-2')} />
            )}
            <span className="mt-1 block text-[11px] text-dim">{f.hint}</span>
            <FieldError message={errors[f.key]} />
          </label>
        ))}
      </div>
    </Panel>
  )
}

function Setup({ campaign, accounts, onChange }: { campaign: Campaign; accounts: Account[]; onChange: (c: Campaign) => void }) {
  const toast = useToast()
  const { navigate } = useRouter()
  const [ids, setIds] = useState<number[]>(campaign.account_ids)
  const [start, setStart] = useState(campaign.period_start ?? '')
  const [end, setEnd] = useState(campaign.period_end ?? '')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const canPlan = ['brief', 'plan_review'].includes(campaign.stage)

  const plan = async () => {
    setBusy(true)
    setErrors({})
    try {
      await api(`/campaigns/${campaign.id}`, { method: 'PATCH', body: { account_ids: ids, period_start: start || null, period_end: end || null } })
      const c = await api<Campaign>(`/campaigns/${campaign.id}/plan`, { method: 'POST' })
      onChange(c)
      navigate(`/dashboard/campaigns?id=${campaign.id}&tab=plan`, { replace: true })
    } catch (e) {
      if (e instanceof ApiError && e.status === 422) setErrors(Object.fromEntries(Object.keys(e.errors).map((k) => [k.split('.')[0], e.field(k) ?? ''])))
      else toast(e instanceof Error ? e.message : 'Couldn’t start planning.', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel title="Where and when" sub="The writer plans for these accounts, over this period, at the brief’s rhythm.">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div>
          <Label>Accounts</Label>
          {accounts.length ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {accounts.map((a) => {
                const on = ids.includes(a.id)
                return (
                  <button
                    key={a.id}
                    type="button"
                    aria-pressed={on}
                    disabled={!canPlan}
                    onClick={() => setIds(on ? ids.filter((x) => x !== a.id) : [...ids, a.id])}
                    className={cn(
                      'flex h-9 items-center gap-2 rounded-full border px-3.5 text-[12.5px] transition-colors disabled:cursor-not-allowed',
                      on ? 'border-fg bg-fg text-ink' : 'border-line-2 text-muted hover:text-fg',
                    )}
                  >
                    <PlatformIcon id={a.platform} className="size-3.5" />@{a.handle}
                  </button>
                )
              })}
            </div>
          ) : (
            <p className="mt-2 text-[12.5px] text-dim">
              No accounts yet.{' '}
              <button type="button" className="text-accent-soft hover:underline" onClick={() => navigate('/dashboard/accounts')}>
                Add the accounts you post to
              </button>
              .
            </p>
          )}
          <FieldError message={errors.account_ids} />
        </div>
        <div>
          <Label>Runs</Label>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <input type="date" value={start} disabled={!canPlan} onChange={(e) => setStart(e.target.value)} aria-label="From" className={inputClass} />
            <input type="date" value={end} disabled={!canPlan} onChange={(e) => setEnd(e.target.value)} aria-label="To" className={inputClass} />
          </div>
          <FieldError message={errors.period_start ?? errors.period_end} />
        </div>
      </div>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        <p className="text-[12px] text-dim">
          {campaign.brief_ready ? (
            <>
              About <span className="text-fg">{campaign.post_count} posts</span>. The writer plans them, the visual director dresses them, and you approve the plan before anything is made.
            </>
          ) : (
            'Finish the interview first.'
          )}
        </p>
        {canPlan ? (
          <Btn variant="primary" icon={campaign.stage === 'plan_review' ? Sparkles : ArrowRight} onClick={plan} loading={busy} disabled={!campaign.brief_ready}>
            {campaign.stage === 'plan_review' ? 'Plan it again' : 'Plan the campaign'}
          </Btn>
        ) : (
          <span className="font-mono text-[10.5px] text-dim">Planned{campaign.plan_approved_at ? ' and approved' : ''}</span>
        )}
      </div>
      <FieldError message={errors.brief ?? errors.stage} />
    </Panel>
  )
}
