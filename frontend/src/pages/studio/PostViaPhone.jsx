import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, useResource } from "../../api.js";
import { Banner, Field, Tag, toLocalInput, useAction, when as formatWhen } from "../../ui.jsx";
import { loadJSON, saveJSON } from "./storage.js";

const OUTCOME_TEXT = {
  confirmed: "Posted. The phone checked the profile afterwards and found it live.",
  failed: "Not posted.",
  uncertain: "Sent, but it could not be confirmed live. Check the account on the phone before trying again, so it isn't posted twice.",
};
// Instagram feed: what the studio's spec check enforces (agents/specs.py).
const FEED_RATIOS = { "1:1": 1, "4:5": 0.8 };
const CAPTION_MAX = 2200;
const HASHTAG_MAX = 30;

const tagList = (raw) => raw.split(/[\s,]+/).map((h) => h.replace(/^#/, "")).filter(Boolean);

function nearestRatio(w, h) {
  const ratios = { "1:1": 1, "4:5": 0.8, "9:16": 0.5625, "16:9": 1.7778, "3:2": 1.5, "2:3": 0.6667 };
  const r = w / h;
  return Object.keys(ratios).reduce((best, k) => (Math.abs(ratios[k] - r) < Math.abs(ratios[best] - r) ? k : best), "1:1");
}

function inAnHour() {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0);
  return toLocalInput(d.toISOString());
}

/** Compose an Instagram post for one asset: preview, caption, post now or schedule, through a phone. */
export default function PostViaPhone({ asset, onSkip, onAssetChanged }) {
  const { data: phones } = useResource("/api/phones");
  const { data: accounts } = useResource("/api/accounts");
  const [phoneId, setPhoneId] = useState(() => loadJSON("creative-post-phone", ""));
  const [handle, setHandle] = useState("");
  const [caption, setCaption] = useState(asset.caption_draft || "");
  const [hashtags, setHashtags] = useState((asset.hashtags_draft || []).map((h) => `#${h}`).join(" "));
  const [timing, setTiming] = useState("now");
  const [at, setAt] = useState(inAnHour);
  const [result, setResult] = useState(null); // { post_id, scheduled_at }
  const [run, setRun] = useState(null);
  const [startError, setStartError] = useState(null);
  const [writing, setWriting] = useState(false);
  const [writeNote, setWriteNote] = useState("");
  const [writeError, setWriteError] = useState("");
  const { busy, error, run: act } = useAction();

  const instagramByPhone = Object.fromEntries(
    (accounts || []).filter((a) => a.platform === "instagram" && a.phone_id).map((a) => [a.phone_id, a]),
  );
  const phoneList = phones || [];
  const phone = phoneList.find((p) => p.id === phoneId) || phoneList.find((p) => instagramByPhone[p.id]) || phoneList[0];
  const linked = phone ? instagramByPhone[phone.id] : null;
  const shownHandle = linked?.handle || handle.replace(/^@/, "") || "your_account";
  const simulated = Boolean(asset.meta?.simulated);

  // Live checks, the same rules the server enforces.
  const tags = tagList(hashtags);
  const fullLength = caption.length + tags.reduce((n, t) => n + t.length + 2, 0);
  const ratio = asset.width && asset.height ? nearestRatio(asset.width, asset.height) : null;
  const problems = [];
  if (asset.kind === "image" && ratio && !(ratio in FEED_RATIOS)) problems.push(`The feed takes 1:1 or 4:5 images; this one is ${asset.width}×${asset.height} (~${ratio}). Generate it again in 1:1 or 4:5.`);
  if (fullLength > CAPTION_MAX) problems.push(`Caption and hashtags are ${fullLength} characters; the limit is ${CAPTION_MAX}.`);
  const warnings = [];
  if (tags.length > HASHTAG_MAX) warnings.push(`${tags.length} hashtags; Instagram allows ${HASHTAG_MAX}.`);
  if (!caption.trim()) warnings.push("No caption. Posting an image alone is allowed, but the post can only be confirmed by position, not by its text.");
  if (/[^\x20-\x7E\n]/.test(caption + hashtags)) warnings.push("Emoji and accented letters can't be typed by the phone and will be dropped.");
  const scheduledAt = timing === "later" && at ? new Date(at) : null;
  if (scheduledAt && scheduledAt.getTime() < Date.now() + 60000) problems.push("Pick a time at least a minute from now.");

  const choosePhone = (id) => {
    setPhoneId(id);
    saveJSON("creative-post-phone", id);
  };

  // The caption lives on the asset as a draft, so closing the panel loses nothing.
  const saveDraft = () => {
    if (caption === (asset.caption_draft || "") && tags.join(" ") === (asset.hashtags_draft || []).join(" ")) return;
    api.patch(`/api/creative/assets/${asset.id}`, { caption_draft: caption, hashtags_draft: tags })
      .then((updated) => onAssetChanged?.(updated))
      .catch(() => {});
  };

  const writeCaption = async () => {
    setWriting(true);
    setWriteError("");
    try {
      const res = await api.post(`/api/creative/assets/${asset.id}/caption`, { account_id: linked?.id || null });
      setCaption(res.caption);
      setHashtags(res.hashtags.map((h) => `#${h}`).join(" "));
      onAssetChanged?.(res.asset);
      setWriteNote(res.simulated
        ? "Drafted by the offline writer. Add a text model in Settings for real copy."
        : `Drafted by ${res.model}${linked ? ` in @${linked.handle}'s voice` : ""}. Edit freely.`);
    } catch (err) {
      setWriteError(err.message);
    } finally {
      setWriting(false);
    }
  };

  // Follow the phone run until it finishes; the outcome comes from the run, not from the request returning.
  useEffect(() => {
    if (!result || result.scheduled_at) return undefined;
    let stopped = false;
    let polls = 0;
    const poll = async () => {
      if (stopped) return;
      polls += 1;
      try {
        const [latest] = await api.get(`/api/runs?post_id=${result.post_id}&limit=1`);
        if (latest) {
          const detail = await api.get(`/api/runs/${latest.id}`);
          if (stopped) return;
          setRun(detail);
          if (detail.status === "finished") return;
        } else if (polls > 8) {
          const post = await api.get(`/api/posts/${result.post_id}`);
          if (post.last_error) {
            setStartError(post.last_error);
            return;
          }
        }
      } catch {
        // a dropped poll is retried on the next tick
      }
      setTimeout(poll, 2000);
    };
    poll();
    return () => { stopped = true; };
  }, [result]);

  const submit = () => act(async () => {
    const res = await api.post(`/api/creative/assets/${asset.id}/publish`, {
      ...(linked ? { account_id: linked.id } : { phone_id: phone.id, handle }),
      caption,
      hashtags: tags,
      scheduled_at: scheduledAt ? scheduledAt.toISOString() : null,
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    });
    setResult(res);
  });

  const lastStep = run?.steps?.[run.steps.length - 1];
  const finished = run?.status === "finished";
  const ready = phone && (linked || handle.trim().replace(/^@/, "")) && !problems.length && !simulated;
  const shortCaption = caption.length > 125 ? `${caption.slice(0, 125).trimEnd()}…` : caption;

  return (
    <section className="panel composer" aria-label="Post composer">
      <div className="spread">
        <div>
          <div className="eyebrow">Publish</div>
          <h2>Post this to Instagram via phone?</h2>
        </div>
        {!result && <button className="ghost" onClick={onSkip}>Skip</button>}
      </div>

      <div className="composer-grid">
        <figure className="ig-preview" aria-label="Instagram preview">
          <div className="ig-head">
            <span className="ig-avatar" aria-hidden="true">{shownHandle.slice(0, 1).toUpperCase()}</span>
            <b>{shownHandle}</b>
            <span className="ig-more" aria-hidden="true">•••</span>
          </div>
          <div className="ig-media" style={{ aspectRatio: asset.width && asset.height ? `${asset.width} / ${asset.height}` : "1 / 1" }}>
            {asset.kind === "video" ? <video src={asset.url} muted autoPlay loop /> : <img src={asset.url} alt="" />}
          </div>
          <div className="ig-actions" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="M12 20.5s-7.5-4.6-7.5-10.1A4.3 4.3 0 0 1 12 7.6a4.3 4.3 0 0 1 7.5 2.8c0 5.5-7.5 10.1-7.5 10.1Z" /></svg>
            <svg viewBox="0 0 24 24"><path d="M20.5 11.6a8.4 8.4 0 0 1-12.4 7.4L3.5 20.5l1.5-4.4a8.4 8.4 0 1 1 15.5-4.5Z" /></svg>
            <svg viewBox="0 0 24 24"><path d="M21.5 3.5 10.6 13.4M21.5 3.5 14.6 20.5l-4-7.1-7.1-4 18-5.9Z" /></svg>
            <svg className="ig-save" viewBox="0 0 24 24"><path d="M19 21.5 12 16l-7 5.5V3.5h14v18Z" /></svg>
          </div>
          <figcaption className="ig-caption">
            <b>{shownHandle}</b> {shortCaption || <span className="muted">Your caption appears here.</span>}
            {caption.length > 125 && <span className="muted"> more</span>}
            {tags.length > 0 && <div className="ig-tags">{tags.map((t) => `#${t}`).join(" ")}</div>}
          </figcaption>
        </figure>

        <div className="composer-form">
          {simulated ? (
            <p className="small muted">This image came from the offline test generator, so it can't be posted. Pick a real model in the studio and generate again.</p>
          ) : !result ? (
            <>
              {phoneList.length === 0 ? (
                <p className="small muted">No phone yet. Connect one in Settings → Phones.</p>
              ) : (
                <div className="post-via-phone-grid">
                  <Field label="Phone" hint={phone?.driver === "simulator" ? "Simulator: nothing reaches real Instagram" : "Real phone: this posts to the real Instagram account"}>
                    <select value={phone?.id || ""} onChange={(e) => choosePhone(e.target.value)}>
                      {phoneList.map((p) => (
                        <option key={p.id} value={p.id}>{p.name} · {p.driver === "simulator" ? "simulator" : "real phone"}{p.online ? "" : " · offline"}</option>
                      ))}
                    </select>
                  </Field>
                  {linked ? (
                    <Field label="Instagram account" hint={linked.logged_in ? "Sign-in confirmed on the phone" : "Sign-in not checked yet: Settings → Accounts → Check login"}>
                      <input value={`@${linked.handle}`} readOnly />
                    </Field>
                  ) : (
                    <Field label="Instagram account on this phone" hint="Must already be signed in on the phone. It's linked to this phone when you post.">
                      <input value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="@your_test_account" />
                    </Field>
                  )}
                </div>
              )}

              <div className="field">
                <div className="spread">
                  <label htmlFor="post-caption">Caption · {fullLength} / {CAPTION_MAX}</label>
                  <button className="small" onClick={writeCaption} disabled={writing} title="Draft a caption and hashtags with your text model, in this account's voice">
                    {writing ? "Writing…" : "✦ Write with AI"}
                  </button>
                </div>
                <textarea id="post-caption" value={caption} maxLength={CAPTION_MAX} rows={5} onChange={(e) => setCaption(e.target.value)} onBlur={saveDraft} placeholder="Write the caption the phone will type" />
                {(writeNote || writeError) && <div className={`small ${writeError ? "bad-text" : "muted"}`} style={{ marginTop: 4 }}>{writeError || writeNote}</div>}
              </div>
              <Field label={`Hashtags · ${tags.length}`} hint="Separated by spaces or commas">
                <input value={hashtags} onChange={(e) => setHashtags(e.target.value)} onBlur={saveDraft} placeholder="#studio #newdrop" />
              </Field>

              <div className="field">
                <label>When</label>
                <div className="row" style={{ gap: 8 }}>
                  <div className="segmented" role="radiogroup" aria-label="When to post">
                    <button role="radio" aria-checked={timing === "now"} className={timing === "now" ? "active" : ""} onClick={() => setTiming("now")}>Post now</button>
                    <button role="radio" aria-checked={timing === "later"} className={timing === "later" ? "active" : ""} onClick={() => setTiming("later")}>Schedule</button>
                  </div>
                  {timing === "later" && <input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} style={{ width: "auto" }} aria-label="Post at" />}
                </div>
                {timing === "later" && <div className="small muted" style={{ marginTop: 4 }}>Goes on the calendar. The phone posts it at that time if publishing isn't paused.</div>}
              </div>

              {problems.map((p) => <div key={p} className="banner bad">{p}</div>)}
              {warnings.map((w) => <div key={w} className="banner warn">{w}</div>)}
              <Banner error={error} />
              <div className="row end">
                <button className="ghost" onClick={onSkip}>Skip</button>
                <button className="primary" onClick={submit} disabled={busy || !ready}>
                  {busy ? "Starting…" : timing === "later" ? `Approve and schedule` : `Approve and post from ${phone?.name || "phone"}`}
                </button>
              </div>
              <p className="small muted">Approving here counts as the content approval for this one post. The phone opens Instagram, adds the image and caption, publishes, then checks the profile to confirm.</p>
            </>
          ) : result.scheduled_at ? (
            <div className="post-via-phone-status">
              <div className="row"><Tag kind="scheduled">scheduled</Tag><span className="small">For {formatWhen(result.scheduled_at)} on @{result.account}.</span></div>
              <Link className="small" to="/calendar">See it on the calendar →</Link>
            </div>
          ) : (
            <div className="post-via-phone-status">
              <div className="row">
                <Tag kind={finished ? run.outcome : startError ? "failed" : "running"}>
                  {finished ? run.outcome : startError ? "not started" : "publishing"}
                </Tag>
                <span className="small">
                  {startError
                    ? startError
                    : finished
                      ? `${OUTCOME_TEXT[run.outcome] || ""} ${run.outcome === "confirmed" ? "" : run.error || run.evidence?.note || ""}`
                      : run
                        ? `@${run.handle} on ${run.phone_name}${lastStep ? ` · step ${lastStep.n}: ${lastStep.action}` : " · starting"}`
                        : "Booking the phone…"}
                </span>
              </div>
              {run && <Link className="small" to={`/runs/${run.id}`}>Open the run record with screenshots →</Link>}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
