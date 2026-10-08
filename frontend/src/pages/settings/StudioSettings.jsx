import { useEffect, useState } from "react";
import { api, useResource } from "../../api.js";
import { Banner, Field, useAction } from "../../ui.jsx";

const ASPECTS = ["1:1", "4:5", "9:16", "16:9"];

/** Settings → Studio: what the creative studio starts with, and the style presets it offers. */
export default function StudioSettings() {
  const { data, reload } = useResource("/api/creative/settings");
  const { data: models } = useResource("/api/creative/models");
  const [defaults, setDefaults] = useState({});
  const [presets, setPresets] = useState([]);
  const [saved, setSaved] = useState("");
  const { busy, error, run } = useAction();

  useEffect(() => {
    if (!data) return;
    setDefaults(data.defaults || {});
    setPresets((data.presets || []).filter((p) => p.id !== "none"));
  }, [data]);

  const setDefault = (key, value) => setDefaults((d) => ({ ...d, [key]: value }));
  const setPreset = (i, key, value) => setPresets((list) => list.map((p, j) => (j === i ? { ...p, [key]: value } : p)));
  const move = (i, delta) => setPresets((list) => {
    const next = [...list];
    const j = i + delta;
    if (j < 0 || j >= next.length) return list;
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });

  const save = () => run(async () => {
    const res = await api.put("/api/creative/settings", { presets, defaults });
    setDefaults(res.defaults || {});
    setPresets(res.presets.filter((p) => p.id !== "none"));
    setSaved("Saved. The studio uses these from the next page load.");
    setTimeout(() => setSaved(""), 4000);
    reload();
  });

  const imageModels = models?.image || [];
  const styleOptions = [{ id: "none", name: "No style" }, ...presets.filter((p) => p.id)];

  return (
    <>
      <div className="panel">
        <h3>Studio defaults</h3>
        <p className="small muted">What a new studio session starts with. Each browser still remembers its own last settings on top of these.</p>
        <div className="settings-grid">
          <Field label="Image model">
            <select value={defaults.model_id || ""} onChange={(e) => setDefault("model_id", e.target.value)}>
              <option value="">The default image provider</option>
              {imageModels.filter((m) => m.id).map((m) => <option key={m.id} value={m.id}>{m.name} · {m.reach}</option>)}
            </select>
          </Field>
          <Field label="Style">
            <select value={defaults.style || "none"} onChange={(e) => setDefault("style", e.target.value)}>
              {styleOptions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
          <Field label="Format">
            <select value={defaults.aspect || "1:1"} onChange={(e) => setDefault("aspect", e.target.value)}>
              {ASPECTS.map((a) => <option key={a} value={a}>{a}{a === "1:1" || a === "4:5" ? " · Instagram feed" : ""}</option>)}
            </select>
          </Field>
          <Field label="Variations per prompt">
            <select value={defaults.count || 1} onChange={(e) => setDefault("count", Number(e.target.value))}>
              {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </Field>
        </div>
      </div>

      <div className="panel">
        <div className="spread">
          <h3>Style presets</h3>
          <div className="row" style={{ gap: 6 }}>
            <button className="ghost small" onClick={() => setPresets(data.builtin_presets.filter((p) => p.id !== "none"))}>Restore built-in styles</button>
            <button className="small" onClick={() => setPresets((list) => [...list, { id: "", name: "", suffix: "" }])} disabled={presets.length >= 29}>Add style</button>
          </div>
        </div>
        <p className="small muted">A style adds its direction to the end of every prompt that uses it. Keep directions visual: light, lens, palette, medium.</p>
        <div className="preset-list">
          {presets.map((p, i) => (
            <div className="preset-row" key={p.id || `new-${i}`}>
              <div className="preset-order">
                <button className="ghost small" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up">↑</button>
                <button className="ghost small" onClick={() => move(i, 1)} disabled={i === presets.length - 1} aria-label="Move down">↓</button>
              </div>
              <input value={p.name} onChange={(e) => setPreset(i, "name", e.target.value)} placeholder="Name" maxLength={40} aria-label="Style name" />
              <textarea value={p.suffix} onChange={(e) => setPreset(i, "suffix", e.target.value)} placeholder="Direction added to the prompt, e.g. soft daylight, 35mm film, muted greens" maxLength={400} rows={2} aria-label="Style direction" />
              <button className="ghost small danger" onClick={() => setPresets((list) => list.filter((_, j) => j !== i))} aria-label={`Remove ${p.name || "style"}`}>Remove</button>
            </div>
          ))}
        </div>
      </div>

      <Banner error={error} />
      <div className="row end settings-save">
        {saved && <span className="small muted">{saved}</span>}
        <button className="primary" onClick={save} disabled={busy || !data}>{busy ? "Saving…" : "Save studio settings"}</button>
      </div>
    </>
  );
}
