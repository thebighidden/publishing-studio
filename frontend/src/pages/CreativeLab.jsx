import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, useResource } from "../api.js";
import { Banner, Field, Tag, useAction } from "../ui.jsx";

const IMAGE_ASPECTS = ["1:1", "4:5", "9:16", "16:9"];
const VIDEO_ASPECTS = ["9:16", "16:9"];

export default function CreativeLab() {
  const [kind, setKind] = useState("image");
  const [prompt, setPrompt] = useState("A sunlit café terrace by the sea at golden hour, pastel houses behind, warm tones, shallow depth of field, editorial photo.");
  const [aspect, setAspect] = useState("1:1");
  const [duration, setDuration] = useState(6);
  const [result, setResult] = useState(null);
  const [skipped, setSkipped] = useState(null);
  const { data: status } = useResource("/api/creative/status");
  const { data: assets, reload: reloadAssets } = useResource("/api/creative/assets");
  const { busy, error, run } = useAction();

  const changeKind = (next) => {
    setKind(next);
    setAspect(next === "video" ? "9:16" : "1:1");
    setResult(null);
  };

  const generate = () => run(async () => {
    const form = new FormData();
    form.append("prompt", prompt);
    form.append("kind", kind);
    form.append("aspect", aspect);
    form.append("duration_s", String(duration));
    const asset = await api.form("/api/creative/generate", form);
    setResult(asset);
    reloadAssets();
  });

  const activeStatus = status?.[kind];
  const aspects = kind === "video" ? VIDEO_ASPECTS : IMAGE_ASPECTS;

  return (
    <>
      <header className="page-head creative-head">
        <div>
          <div className="eyebrow">Creative lab / Aluna workflow</div>
          <h1>Make the world around it.</h1>
          <p>Describe a scene, generate it, then post it to Instagram from the phone.</p>
        </div>
        <div className="creative-provider-state">
          <span className={`provider-light ${activeStatus?.simulated ? "simulated" : "live"}`} />
          <div>
            <b>{activeStatus?.provider || "Loading provider…"}</b>
            <small>{activeStatus?.simulated ? "Offline test mode · no credits" : "Connected generation path"}</small>
          </div>
        </div>
      </header>

      <div className="creative-shell">
        <section className="creative-stage">
          <div className="creative-stage-bar">
            <span>Output / {aspect}</span>
            {result && <Tag kind={result.meta?.simulated ? "warn" : "ok"}>{result.model}</Tag>}
          </div>
          <div className={`creative-output creative-output-${aspect.replace(":", "-")}`}>
            {result?.kind === "image" && <img src={result.url} alt="Generated creative" />}
            {result?.kind === "video" && <video src={result.url} controls autoPlay loop muted />}
            {!result && (
              <div className="creative-empty">
                <span>ALUNA / 01</span>
                <strong>Start from words.</strong>
                <small>The offline provider is ready for a zero-credit test.</small>
              </div>
            )}
          </div>
          {result && (
            <div className="creative-result-meta">
              <div><span>Provider</span><b>{result.provider}</b></div>
              <div><span>Model</span><b>{result.model}</b></div>
              <div><span>Format</span><b>{result.kind === "video" ? `${result.duration_s}s · MP4` : aspect}</b></div>
            </div>
          )}
        </section>

        <aside className="creative-controls">
          <div className="creative-tabs">
            <button className={kind === "image" ? "active" : ""} onClick={() => changeKind("image")}>Still image</button>
            <button className={kind === "video" ? "active" : ""} onClick={() => changeKind("video")}>Motion / Veo</button>
          </div>

          <div className="creative-control-block">
            <div className="control-index">01</div>
            <div className="control-body">
              <label>Creative direction</label>
              <textarea className="creative-prompt" value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={6} />
            </div>
          </div>

          <div className="creative-control-block">
            <div className="control-index">02</div>
            <div className="control-body">
              <label>Format</label>
              <div className="choice-row">
                {aspects.map((value) => <button key={value} className={aspect === value ? "active" : ""} onClick={() => setAspect(value)}>{value}</button>)}
              </div>
              {kind === "video" && (
                <div className="duration-row">
                  <label>Duration</label>
                  <div className="choice-row">
                    {[4, 6, 8].map((value) => <button key={value} className={duration === value ? "active" : ""} onClick={() => setDuration(value)}>{value}s</button>)}
                  </div>
                </div>
              )}
            </div>
          </div>

          <Banner error={error} />
          {activeStatus?.simulated && <div className="creative-note"><b>Test mode</b> {kind === "image"
            ? "This makes a placeholder, not a real image. Add your ComfyUI server in Settings → AI providers as the default image provider."
            : "This makes a placeholder video, not a real one. Add a video provider (Google Veo or Higgsfield) in Settings → AI providers."}</div>}
          <button className="creative-generate" onClick={generate} disabled={busy || prompt.trim().length < 3}>
            <span>{busy ? "Generating…" : `Generate ${kind}`}</span><span>↗</span>
          </button>
        </aside>
      </div>

      {result && skipped !== result.id && (
        <PostViaPhone key={result.id} asset={result} onSkip={() => setSkipped(result.id)} />
      )}

      <section className="creative-history">
        <div className="spread">
          <div><div className="eyebrow">Recent output</div><h2>Your contact sheet</h2></div>
          <span className="small muted">Newest first · campaign and lab assets</span>
        </div>
        {!assets?.length ? <div className="empty">Your generated work will appear here.</div> : (
          <div className="contact-sheet">
            {assets.slice(0, 12).map((asset) => (
              <button key={asset.id} className="contact-frame" onClick={() => setResult(asset)}>
                {asset.kind === "image" ? <img src={asset.url} alt="" /> : <video src={asset.url} muted />}
                <span>{asset.kind} · {asset.model}</span>
              </button>
            ))}
          </div>
        )}
      </section>
    </>
  );
}

const OUTCOME_TEXT = {
  confirmed: "Posted. The phone checked the profile afterwards and found it live.",
  failed: "Not posted.",
  uncertain: "Sent, but it could not be confirmed live. Check the account on the phone before trying again, so it isn't posted twice.",
};

/** After a generation: ask whether to post it to Instagram through the account's phone, or skip. */
function PostViaPhone({ asset, onSkip }) {
  const { data: phones } = useResource("/api/phones");
  const { data: accounts } = useResource("/api/accounts");
  const [phoneId, setPhoneId] = useState(() => {
    try { return localStorage.getItem("creative-post-phone") || ""; } catch { return ""; }
  });
  const [handle, setHandle] = useState("");
  const [caption, setCaption] = useState("");
  const [hashtags, setHashtags] = useState("");
  const [postId, setPostId] = useState(null);
  const [run, setRun] = useState(null);
  const [startError, setStartError] = useState(null);
  const { busy, error, run: act } = useAction();

  const instagramByPhone = Object.fromEntries(
    (accounts || []).filter((a) => a.platform === "instagram" && a.phone_id).map((a) => [a.phone_id, a]),
  );
  const phoneList = phones || [];
  const phone = phoneList.find((p) => p.id === phoneId) || phoneList.find((p) => instagramByPhone[p.id]) || phoneList[0];
  const linked = phone ? instagramByPhone[phone.id] : null;
  const simulated = Boolean(asset.meta?.simulated);

  const choosePhone = (id) => {
    setPhoneId(id);
    try { localStorage.setItem("creative-post-phone", id); } catch { /* remembered for convenience only */ }
  };

  // Follow the phone run until it finishes; the outcome comes from the run, not from the request returning.
  useEffect(() => {
    if (!postId) return undefined;
    let stopped = false;
    let polls = 0;
    const poll = async () => {
      if (stopped) return;
      polls += 1;
      try {
        const [latest] = await api.get(`/api/runs?post_id=${postId}&limit=1`);
        if (latest) {
          const detail = await api.get(`/api/runs/${latest.id}`);
          if (stopped) return;
          setRun(detail);
          if (detail.status === "finished") return;
        } else if (polls > 8) {
          const post = await api.get(`/api/posts/${postId}`);
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
  }, [postId]);

  const post = () => act(async () => {
    const res = await api.post(`/api/creative/assets/${asset.id}/publish`, {
      ...(linked ? { account_id: linked.id } : { phone_id: phone.id, handle }),
      caption,
      hashtags: hashtags.split(/[\s,]+/).filter(Boolean),
    });
    setPostId(res.post_id);
  });

  const lastStep = run?.steps?.[run.steps.length - 1];
  const finished = run?.status === "finished";

  return (
    <section className="panel post-via-phone">
      <div className="spread">
        <div>
          <div className="eyebrow">Next step</div>
          <h2>Post this to Instagram via phone?</h2>
        </div>
        {!postId && <button className="ghost" onClick={onSkip}>Skip</button>}
      </div>

      {simulated ? (
        <p className="small muted">
          This image came from the offline test provider, so it can't be posted. Add your ComfyUI server under
          Settings → AI providers (ComfyUI server, image, default) and generate again.
        </p>
      ) : !postId ? (
        <>
          {phoneList.length === 0 ? (
            <p className="small muted">No phone yet. Connect one in Settings → Phones.</p>
          ) : (
            <div className="post-via-phone-grid">
              <Field
                label="Phone"
                hint={phone?.driver === "simulator"
                  ? "Simulator: nothing reaches real Instagram"
                  : "Real phone: this posts to the real Instagram account"}
              >
                <select value={phone?.id || ""} onChange={(e) => choosePhone(e.target.value)}>
                  {phoneList.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} · {p.driver === "simulator" ? "simulator" : "real phone"}{p.online ? "" : " · offline"}
                    </option>
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
              <Field label="Hashtags" hint="Separated by spaces or commas">
                <input value={hashtags} onChange={(e) => setHashtags(e.target.value)} placeholder="#studio #newdrop" />
              </Field>
              <Field label={`Caption · ${caption.length} / 2200`}>
                <textarea value={caption} maxLength={2200} rows={3} onChange={(e) => setCaption(e.target.value)} placeholder="Write the caption the phone will type" />
              </Field>
            </div>
          )}
          <Banner error={error} />
          <div className="row end">
            <button className="ghost" onClick={onSkip}>Skip</button>
            <button className="primary" onClick={post} disabled={busy || !phone || (!linked && !handle.trim().replace(/^@/, ""))}>
              {busy ? "Starting…" : `Approve and post from ${phone?.name || "phone"}`}
            </button>
          </div>
          <p className="small muted">Approving here counts as the content approval for this one post. The phone opens Instagram, adds the image and caption, publishes, then checks the profile to confirm.</p>
        </>
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
    </section>
  );
}
