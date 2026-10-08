import { useEffect, useState } from "react";
import { api } from "../../api.js";
import { Banner } from "../../ui.jsx";
import { loadJSON, saveJSON } from "./storage.js";

const PAGE = 36;

/** Every asset the studio has made, filterable, newest first. */
export default function Library({ projectId, projects, bump, selectedId, onOpen, onCompare, pickKind }) {
  const saved = loadJSON("studio-library", {});
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState(saved.scope || "project");
  const [ownKind, setKind] = useState(saved.kind || "");
  const kind = pickKind || ownKind;
  const [favorites, setFavorites] = useState(Boolean(saved.favorites));
  const [hideTest, setHideTest] = useState(saved.hideTest ?? true);
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Debounce typing so every keystroke is not a query.
  useEffect(() => {
    const t = setTimeout(() => setQuery(q), 250);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => saveJSON("studio-library", { scope, kind: ownKind, favorites, hideTest }), [scope, ownKind, favorites, hideTest]);

  const effectiveScope = scope === "project" && !projectId ? "all" : scope;
  const params = (offset) => {
    const p = new URLSearchParams({ limit: String(PAGE), offset: String(offset) });
    if (query.trim()) p.set("q", query.trim());
    if (kind) p.set("kind", kind);
    if (favorites) p.set("favorite", "true");
    if (hideTest) p.set("include_simulated", "false");
    if (effectiveScope === "project") p.set("project_id", projectId);
    if (effectiveScope === "unfiled") p.set("project_id", "none");
    return p.toString();
  };

  const load = async (offset = 0) => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get(`/api/creative/assets?${params(offset)}`);
      setTotal(res.total);
      setItems((prev) => (offset ? [...prev, ...res.items] : res.items));
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, effectiveScope, kind, favorites, hideTest, projectId, bump]);

  return (
    <section className="studio-library" aria-label="Library">
      <div className="studio-filters">
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search prompts, captions, models…" aria-label="Search the library" />
        <div className="segmented" role="radiogroup" aria-label="Which work">
          {projectId && <button role="radio" aria-checked={effectiveScope === "project"} className={effectiveScope === "project" ? "active" : ""} onClick={() => setScope("project")}>This project</button>}
          <button role="radio" aria-checked={effectiveScope === "all"} className={effectiveScope === "all" ? "active" : ""} onClick={() => setScope("all")}>All</button>
          <button role="radio" aria-checked={effectiveScope === "unfiled"} className={effectiveScope === "unfiled" ? "active" : ""} onClick={() => setScope("unfiled")}>Unfiled</button>
        </div>
        {!pickKind && (
          <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Type">
            <option value="">Images and video</option>
            <option value="image">Images</option>
            <option value="video">Video</option>
          </select>
        )}
        <label className="inline-field"><input type="checkbox" checked={favorites} onChange={(e) => setFavorites(e.target.checked)} /> Favourites</label>
        <label className="inline-field"><input type="checkbox" checked={hideTest} onChange={(e) => setHideTest(e.target.checked)} /> Hide test images</label>
        <span className="muted small studio-library-count">
          {total} item{total === 1 ? "" : "s"}{onCompare && !pickKind ? " · Shift-click to compare" : ""}
        </span>
      </div>

      <Banner error={error} />
      {!items.length && !loading ? (
        <div className="empty">{query || favorites ? "Nothing matches these filters." : "Generated work will appear here."}</div>
      ) : (
        <div className="studio-grid">
          {items.map((asset) => (
            <button
              key={asset.id}
              className={`studio-tile ${asset.id === selectedId ? "selected" : ""}`}
              onClick={(e) => (e.shiftKey && onCompare && !pickKind ? onCompare(asset) : onOpen(asset))}
              title={asset.params?.prompt || asset.prompt || ""}
            >
              {asset.kind === "image" ? <img src={asset.url} alt="" loading="lazy" /> : <video src={asset.url} muted preload="metadata" />}
              <span className="studio-tile-badges">
                {asset.favorite && <span className="badge fav">★</span>}
                {asset.kind === "video" && <span className="badge">video</span>}
                {asset.meta?.simulated && <span className="badge warn">test</span>}
                {asset.used_in_posts > 0 && <span className="badge ok">posted</span>}
              </span>
            </button>
          ))}
        </div>
      )}
      {items.length < total && (
        <div className="row" style={{ justifyContent: "center", marginTop: 14 }}>
          <button onClick={() => load(items.length)} disabled={loading}>{loading ? "Loading…" : `Show more (${total - items.length})`}</button>
        </div>
      )}
    </section>
  );
}
