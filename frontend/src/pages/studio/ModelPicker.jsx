import { useEffect, useRef, useState } from "react";

const REACH_TEXT = { local: "local", cloud: "cloud", offline: "offline test" };

/** Short capability badges for one model. */
export function modelBadges(m, kind) {
  const out = [];
  if (kind === "image" && m.reference_input) out.push("Reference");
  if (kind === "video") {
    if (m.text_to_video === false) out.push("Needs start frame");
    else if (m.reference_input) out.push("Start frame");
    if (m.end_frame) out.push("End frame");
    if (m.audio) out.push("Audio");
    if (m.durations?.length) out.push(`up to ${Math.max(...m.durations)}s`);
  }
  if (m.resolutions?.length) out.push(m.resolutions[m.resolutions.length - 1].toUpperCase());
  return out;
}

/** Choose the model: grouped by connection, with what each one is good at. */
export default function ModelPicker({ models, value, kind, onChange }) {
  const [open, setOpen] = useState(false);
  const box = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (!box.current?.contains(e.target)) setOpen(false); };
    const esc = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", esc, true);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", esc, true);
    };
  }, [open]);

  const groups = [];
  for (const m of models || []) {
    const name = m.family || m.group || "Models";
    let g = groups.find((x) => x.name === name);
    if (!g) groups.push((g = { name, items: [] }));
    g.items.push(m);
  }

  return (
    <div className="model-picker" ref={box}>
      <button className="model-current" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-haspopup="listbox">
        <span className="model-current-text">
          <b>{value?.name || "Choose a model"}</b>
          <span className="muted small">{value ? [value.family || value.group, REACH_TEXT[value.reach] || value.reach].filter(Boolean).join(" · ") : ""}</span>
        </span>
        <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="model-pop" role="listbox" aria-label={`${kind} models`}>
          {groups.map((g) => (
            <div key={g.name} className="model-group">
              <div className="model-group-name">{g.name}</div>
              {g.items.map((m) => (
                <button
                  key={m.id || "offline"}
                  role="option"
                  aria-selected={m.id === value?.id}
                  className={`model-option ${m.id === value?.id ? "on" : ""}`}
                  onClick={() => { onChange(m); setOpen(false); }}
                >
                  <span className="model-option-head">
                    <b>{m.name}</b>
                    <span className={`reach reach-${m.reach}`}>{REACH_TEXT[m.reach] || m.reach}</span>
                    {m.healthy === false && <span className="badge warn">last test failed</span>}
                  </span>
                  {m.blurb && <span className="model-option-blurb">{m.blurb}</span>}
                  <span className="model-badges">{modelBadges(m, kind).map((b) => <span key={b} className="model-badge">{b}</span>)}</span>
                </button>
              ))}
            </div>
          ))}
          <div className="model-pop-foot muted small">Add Higgsfield, Gemini, ComfyUI or an OpenAI-compatible server in Settings → AI providers.</div>
        </div>
      )}
    </div>
  );
}
