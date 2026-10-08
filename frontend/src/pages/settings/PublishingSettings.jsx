import { useEffect, useState } from "react";
import { api, useResource } from "../../api.js";
import { Banner, Field, Tag, useAction } from "../../ui.jsx";

const ZONES = ["UTC", "Africa/Casablanca", "Europe/Paris", "Europe/London", "Europe/Madrid", "America/New_York", "America/Los_Angeles", "Asia/Dubai"];

/** Settings → Publishing: the rules every phone run follows, and each phone's readiness. */
export default function PublishingSettings() {
  const { data, reload } = useResource("/api/settings/publishing");
  const { data: phones } = useResource("/api/phones");
  const [form, setForm] = useState(null);
  const [saved, setSaved] = useState("");
  const { busy, error, run } = useAction();

  useEffect(() => {
    if (!data) return;
    const r = data.rules;
    setForm({ ...r, retry: r.retry_backoff_seconds.join(", "), hours: { ...r.posting_hours } });
  }, [data]);

  if (!form) return <div className="panel"><span className="muted">Loading…</span></div>;
  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));
  const setHours = (key, value) => setForm((f) => ({ ...f, hours: { ...f.hours, [key]: value } }));
  const limits = data.limits;

  const save = () => run(async () => {
    await api.put("/api/settings/publishing", {
      cooldown_seconds: Number(form.cooldown_seconds),
      run_timeout_seconds: Number(form.run_timeout_seconds),
      step_budget: Number(form.step_budget),
      max_attempts: Number(form.max_attempts),
      retry_backoff_seconds: form.retry.split(/[\s,]+/).filter(Boolean).map(Number),
      timezone: form.timezone,
      posting_hours: form.hours,
    });
    setSaved("Saved. Applies to the next run.");
    setTimeout(() => setSaved(""), 4000);
    reload();
  });

  const number = (key, label, hint) => (
    <Field label={label} hint={`${hint} Allowed ${limits[key][0]}–${limits[key][1]}.`}>
      <input type="number" min={limits[key][0]} max={limits[key][1]} value={form[key]} onChange={(e) => set(key, e.target.value)} />
    </Field>
  );

  const realPhones = (phones || []).filter((p) => p.driver !== "simulator");

  return (
    <>
      <div className="panel">
        <h3>Publishing rules</h3>
        <p className="small muted">Every phone run follows these. The minimums keep the guardrails: no tight posting loops, and every run stops at its time and step limit.</p>
        <div className="settings-grid">
          {number("cooldown_seconds", "Gap between posts on one account (s)", "Stops rapid-fire posting that gets accounts checkpointed.")}
          {number("max_attempts", "Attempts per post", "Automatic retries after a failed run.")}
          <Field label="Wait before each retry (s)" hint="Comma separated, e.g. 60, 180. Each 30–3600.">
            <input value={form.retry} onChange={(e) => set("retry", e.target.value)} />
          </Field>
          {number("run_timeout_seconds", "Run time limit (s)", "A run is stopped after this long.")}
          {number("step_budget", "Run step limit", "A run is stopped after this many phone actions.")}
        </div>
      </div>

      <div className="panel">
        <div className="spread">
          <h3>Posting hours</h3>
          <Tag kind={data.within_posting_hours ? "ok" : "warn"}>{data.within_posting_hours ? "posting allowed now" : "outside posting hours now"}</Tag>
        </div>
        <p className="small muted">Scheduled posts that fall due outside these hours wait, still scheduled, until the window opens. "Post now" is never held back.</p>
        <label className="inline-field"><input type="checkbox" checked={form.hours.enabled} onChange={(e) => setHours("enabled", e.target.checked)} /> Only publish scheduled posts within these hours</label>
        <div className="settings-grid">
          <Field label="From"><input type="time" value={form.hours.start} onChange={(e) => setHours("start", e.target.value)} disabled={!form.hours.enabled} /></Field>
          <Field label="Until" hint="Earlier than From means overnight, e.g. 20:00 to 02:00."><input type="time" value={form.hours.end} onChange={(e) => setHours("end", e.target.value)} disabled={!form.hours.enabled} /></Field>
          <Field label="Time zone" hint="For posting hours. Any IANA name works.">
            <input list="tz-list" value={form.timezone} onChange={(e) => set("timezone", e.target.value)} />
            <datalist id="tz-list">{ZONES.map((z) => <option key={z} value={z} />)}</datalist>
          </Field>
        </div>
      </div>

      <Banner error={error} />
      <div className="row end settings-save">
        {saved && <span className="small muted">{saved}</span>}
        <button className="primary" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save publishing rules"}</button>
      </div>

      <div className="panel">
        <h3>Phone readiness</h3>
        <p className="small muted">What a real phone needs before the studio can post from it reliably. Preparing changes two phone settings and can be undone.</p>
        {!realPhones.length ? <div className="empty">No real phones connected. The simulator needs no preparing.</div> : (
          <div className="stack">{realPhones.map((p) => <Readiness key={p.id} phone={p} />)}</div>
        )}
      </div>
    </>
  );
}

function Readiness({ phone }) {
  const [report, setReport] = useState(null);
  const { busy, error, run } = useAction();
  const check = () => run(async () => setReport(await api.get(`/api/phones/${phone.id}/readiness`)));
  const prepare = () => run(async () => setReport(await api.post(`/api/phones/${phone.id}/prepare`, {})));
  const restore = () => run(async () => setReport(await api.post(`/api/phones/${phone.id}/restore`, {})));

  useEffect(() => {
    if (phone.online) check();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phone.id]);

  return (
    <div className="device">
      <div className="spread">
        <div>
          <b>{phone.name}</b> <span className="muted small">{phone.model_name || phone.serial}</span>
        </div>
        <div className="row" style={{ gap: 6 }}>
          {report && <Tag kind={report.ready ? "ok" : "warn"}>{report.ready ? "ready" : "needs attention"}</Tag>}
          <button className="small" onClick={check} disabled={busy}>Check</button>
          <button className="small primary" onClick={prepare} disabled={busy || !phone.online}>Prepare for publishing</button>
          {report?.can_restore && <button className="ghost small" onClick={restore} disabled={busy}>Undo</button>}
        </div>
      </div>
      {!phone.online && <div className="small muted">Offline: connect it to check.</div>}
      <Banner error={error} />
      {report && (
        <ul className="readiness">
          {report.checks.map((c) => (
            <li key={c.id} className={c.ok ? "ok" : "bad"}>
              <span aria-hidden="true">{c.ok ? "✓" : "!"}</span>
              <div><b>{c.label}</b><span className="muted small"> · {c.detail}</span></div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
