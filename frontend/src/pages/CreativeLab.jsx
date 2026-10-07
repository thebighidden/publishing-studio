import { useEffect, useMemo, useRef, useState } from "react";
import { api, useResource } from "../api.js";
import { Banner, Tag, useAction } from "../ui.jsx";

const IMAGE_ASPECTS = ["1:1", "4:5", "9:16", "16:9"];
const VIDEO_ASPECTS = ["9:16", "16:9"];

export default function CreativeLab() {
  const [kind, setKind] = useState("image");
  const [prompt, setPrompt] = useState("Place the product in a sculptural violet studio set with crisp side light, tactile surfaces, and a premium fashion-editorial composition.");
  const [aspect, setAspect] = useState("1:1");
  const [duration, setDuration] = useState(6);
  const [reference, setReference] = useState(null);
  const [result, setResult] = useState(null);
  const [preserve, setPreserve] = useState(true);
  const [opening, setOpening] = useState(true);
  const inputRef = useRef(null);
  const { data: status } = useResource("/api/creative/status");
  const { data: assets, reload: reloadAssets } = useResource("/api/creative/assets");
  const { busy, error, run } = useAction();
  const preview = useMemo(() => reference ? URL.createObjectURL(reference) : null, [reference]);

  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

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
    form.append("preserve_subject", String(preserve));
    form.append("prepare_opening_frame", String(opening));
    if (reference) form.append("reference", reference);
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
          <p>Generate art-directed images and animate them into short videos while keeping the product identity intact.</p>
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
            {!result && preview && <img className="reference-preview" src={preview} alt="Reference preview" />}
            {!result && !preview && (
              <div className="creative-empty">
                <span>ALUNA / 01</span>
                <strong>Upload a product<br />or start from words.</strong>
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
              <label>Identity reference <span>optional</span></label>
              <button className="reference-drop" onClick={() => inputRef.current?.click()}>
                {reference ? (
                  <><img src={preview} alt="" /><span><b>{reference.name}</b><small>Click to replace</small></span></>
                ) : (
                  <><span className="upload-plus">+</span><span><b>Add a product image</b><small>PNG, JPEG or WebP · up to 20 MB</small></span></>
                )}
              </button>
              <input ref={inputRef} hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => setReference(e.target.files?.[0] || null)} />
            </div>
          </div>

          <div className="creative-control-block">
            <div className="control-index">02</div>
            <div className="control-body">
              <label>Creative direction</label>
              <textarea className="creative-prompt" value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={6} />
              <label className="inline-field creative-check">
                <input type="checkbox" checked={preserve} onChange={(e) => setPreserve(e.target.checked)} />
                <span>Preserve exact product, logo, color and text</span>
              </label>
              {kind === "video" && reference && (
                <label className="inline-field creative-check">
                  <input type="checkbox" checked={opening} onChange={(e) => setOpening(e.target.checked)} />
                  <span>Art-direct the opening frame before animation</span>
                </label>
              )}
            </div>
          </div>

          <div className="creative-control-block">
            <div className="control-index">03</div>
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
          {activeStatus?.simulated && <div className="creative-note"><b>Test mode</b> This run creates a real local file but does not call a paid model. Add Google Gemini + Veo in Settings to use the Aluna path.</div>}
          <button className="creative-generate" onClick={generate} disabled={busy || prompt.trim().length < 3}>
            <span>{busy ? "Generating…" : `Generate ${kind}`}</span><span>↗</span>
          </button>
        </aside>
      </div>

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
