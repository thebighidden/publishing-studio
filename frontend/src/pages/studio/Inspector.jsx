import { useEffect, useState } from "react";
import { api } from "../../api.js";
import { Banner, useAction, when } from "../../ui.jsx";
import Lineage from "./Lineage.jsx";

/** Details and actions for the asset on the canvas. */
export default function Inspector({ asset, projects, presets, onChanged, onDeleted, onRemix, onMoreLikeThis, onAnimate, onReference, onPost, onOpen, lineageBump }) {
  const [tags, setTags] = useState((asset.tags || []).join(", "));
  const [confirming, setConfirming] = useState(false);
  const [copied, setCopied] = useState(false);
  const { busy, error, run } = useAction();

  // Reset only when the asset or its saved tags change, not on every update of
  // the asset object (a favourite toggle would otherwise wipe tags being typed).
  const savedTags = (asset.tags || []).join(", ");
  useEffect(() => {
    setTags(savedTags);
    setConfirming(false);
  }, [asset.id, savedTags]);

  const patch = (body) => run(async () => onChanged(await api.patch(`/api/creative/assets/${asset.id}`, body)));
  const saveTags = () => {
    const next = tags.split(",").map((t) => t.trim()).filter(Boolean);
    if (next.join(",") !== (asset.tags || []).join(",")) patch({ tags: next });
  };
  const remove = () => run(async () => {
    await api.del(`/api/creative/assets/${asset.id}`);
    onDeleted(asset);
  });
  const copySeed = async () => {
    try {
      await navigator.clipboard.writeText(String(asset.seed));
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch { /* clipboard blocked; the seed is visible anyway */ }
  };

  const p = asset.params || {};
  const style = (presets || []).find((s) => s.id === p.style);
  const settings = { ...(asset.meta?.settings || {}), ...(p.advanced || {}) };
  const simulated = Boolean(asset.meta?.simulated);
  const fileName = `studio-${asset.id}${asset.kind === "video" ? ".mp4" : ".png"}`;

  return (
    <aside className="studio-inspector" aria-label="Selected asset">
      <div className="studio-inspector-actions">
        <button className={`icon-toggle ${asset.favorite ? "on" : ""}`} onClick={() => patch({ favorite: !asset.favorite })} aria-pressed={asset.favorite} title={asset.favorite ? "Remove from favourites" : "Add to favourites"}>
          {asset.favorite ? "★" : "☆"}
        </button>
        <a className="button small" href={asset.url} download={fileName}>Download</a>
        {!confirming ? (
          <button className="ghost small danger" onClick={() => setConfirming(true)} disabled={asset.used_in_posts > 0} title={asset.used_in_posts > 0 ? "Used by a post, so it is kept" : "Delete"}>Delete</button>
        ) : (
          <span className="row" style={{ gap: 6 }}>
            <button className="small danger" onClick={remove} disabled={busy}>Delete for good</button>
            <button className="ghost small" onClick={() => setConfirming(false)}>Keep</button>
          </span>
        )}
      </div>
      <Banner error={error} />

      <div className="studio-inspector-block">
        <span className="studio-label">Create from this</span>
        <div className="studio-inspector-buttons">
          <button onClick={() => onRemix(asset)} title="Load this prompt, style, model and seed into the panel to tweak (R)">Remix <kbd>R</kbd></button>
          {asset.kind === "image" && <button onClick={() => onMoreLikeThis(asset)} title="Four new versions with the same settings and new seeds (V)">Variations <kbd>V</kbd></button>}
          {asset.kind === "image" && <button onClick={() => onReference(asset)} title="Keep this subject and put it in a new scene (E)">Reference <kbd>E</kbd></button>}
          {asset.kind === "image" && <button onClick={() => onAnimate(asset)} title="Make a short video that starts from this image (A)">Animate <kbd>A</kbd></button>}
        </div>
        <button className="primary studio-post-button" onClick={() => onPost(asset)} disabled={simulated} title={simulated ? "Offline placeholders can't be posted" : "P"}>
          Post to Instagram…
        </button>
        {asset.used_in_posts > 0 && <span className="muted small">Used in {asset.used_in_posts} post{asset.used_in_posts === 1 ? "" : "s"}</span>}
      </div>

      <div className="studio-inspector-block">
        <label className="studio-label" htmlFor="insp-project">Project</label>
        <select id="insp-project" value={asset.project_id || ""} onChange={(e) => patch({ project_id: e.target.value })} disabled={busy}>
          <option value="">Unfiled</option>
          {(projects || []).map((pr) => <option key={pr.id} value={pr.id}>{pr.name}</option>)}
        </select>
        <label className="studio-label" htmlFor="insp-tags" style={{ marginTop: 10 }}>Tags</label>
        <input id="insp-tags" value={tags} onChange={(e) => setTags(e.target.value)} onBlur={saveTags} onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()} placeholder="summer, hero, draft" />
      </div>

      <div className="studio-inspector-block">
        <span className="studio-label">Versions</span>
        <Lineage asset={asset} bump={lineageBump} onOpen={onOpen} />
      </div>

      <dl className="studio-facts">
        <dt>Prompt</dt>
        <dd className="studio-fact-prompt">{p.prompt || asset.prompt || "—"}</dd>
        {style && style.id !== "none" && (<><dt>Style</dt><dd>{style.name}</dd></>)}
        {(p.reference_asset_id || p.reference_uploaded || p.source_asset_id) && (
          <><dt>Reference</dt><dd>{p.source_asset_id ? "Animated from a library image" : p.reference_uploaded ? "Uploaded image" : "Library image"}{p.preserve_subject ? " · subject kept" : ""}</dd></>
        )}
        <dt>Model</dt>
        <dd>{asset.provider || "—"}</dd>
        <dt>Size</dt>
        <dd>{asset.width && asset.height ? `${asset.width} × ${asset.height}` : "—"}{asset.duration_s ? ` · ${asset.duration_s}s` : ""}</dd>
        {asset.seed != null && (
          <>
            <dt>Seed</dt>
            <dd><button className="linklike" onClick={copySeed} title="Copy seed">{asset.seed}</button>{copied && <span className="muted small"> copied</span>}</dd>
          </>
        )}
        {Object.keys(settings).length > 0 && (
          <>
            <dt>Settings</dt>
            <dd>{Object.entries(settings).map(([k, v]) => `${k} ${v}`).join(" · ")}</dd>
          </>
        )}
        <dt>Created</dt>
        <dd>{when(asset.created_at)}</dd>
      </dl>
      {simulated && <p className="studio-hint warn">Offline placeholder: generate with a real model to post it.</p>}
    </aside>
  );
}
