import { useEffect, useRef, useState } from "react";
import { api } from "../../api.js";
import ModelPicker from "./ModelPicker.jsx";
import ReferenceSlot from "./ReferenceSlot.jsx";
import { promptHistory } from "./storage.js";

const IMAGE_ASPECTS = ["1:1", "4:5", "9:16", "16:9"];
const VIDEO_ASPECTS = ["9:16", "16:9"];
const FEED_ASPECTS = ["1:1", "4:5"]; // what an Instagram feed post accepts
const ratio = (a) => { const [w, h] = a.split(":").map(Number); return w / h || 1; };
const nearest = (want, list) => list.reduce((best, a) => (Math.abs(ratio(a) - ratio(want)) < Math.abs(ratio(best) - ratio(want)) ? a : best), list[0]);
const ADVANCED_LABELS = {
  steps: ["Steps", "More steps add detail but take longer. Turbo models are tuned for few."],
  guidance: ["Guidance", "How strictly the image follows the prompt. Turbo models want about 1."],
  shift: ["Shift", "Moves effort between composition and fine detail."],
  sampler: ["Sampler", "The method that removes noise at each step."],
  scheduler: ["Scheduler", "How the noise is spaced across the steps."],
};
export function selectedModel(models, form) {
  const list = models?.[form.kind] || [];
  return list.find((m) => m.id === form.modelId) || list.find((m) => m.is_default) || list[0] || null;
}

/** The left column of the studio: everything that decides what gets generated. */
export default function GeneratePanel({ models, presets, options, form, setForm, onGenerate, queueBusy, onPickReference, onPickEndFrame, onReset, promptRef }) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [improving, setImproving] = useState(false);
  const [undoPrompt, setUndoPrompt] = useState(null);
  const [assistNote, setAssistNote] = useState("");
  const [assistError, setAssistError] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const historyBox = useRef(null);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  useEffect(() => {
    if (!historyOpen) return undefined;
    const close = (e) => { if (!historyBox.current?.contains(e.target)) setHistoryOpen(false); };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [historyOpen]);

  const improve = async () => {
    setImproving(true);
    setAssistError("");
    try {
      const res = await api.post("/api/creative/assist/prompt", { idea: form.prompt, style: form.style, kind: form.kind });
      setUndoPrompt(form.prompt);
      set({ prompt: res.prompt.slice(0, 4000) });
      setAssistNote(res.simulated ? "Written by the offline writer. Add a text model in Settings for real rewrites." : `Rewritten by ${res.model}`);
    } catch (err) {
      setAssistError(err.message);
    } finally {
      setImproving(false);
    }
  };
  const model = selectedModel(models, form);
  const advanced = model?.advanced || {};
  const hasAdvanced = Object.keys(advanced).length > 0;
  const aspects = model?.aspects?.length ? model.aspects : form.kind === "video" ? VIDEO_ASPECTS : IMAGE_ASPECTS;
  const durations = model?.durations?.length ? model.durations : [4, 6, 8];
  const resolutions = model?.resolutions || [];
  const promptOk = form.prompt.trim().length >= 3;
  // Higgsfield image-to-video takes its orientation from the start frame.
  const aspectFromFrame = form.kind === "video" && form.reference && model?.adapter === "higgsfield";
  const needsFrame = form.kind === "video" && model?.text_to_video === false && !form.reference;

  // A model only offers what it supports: snap format, length and resolution to it.
  useEffect(() => {
    if (!model) return;
    const patch = {};
    if (!form.customSize && !aspects.includes(form.aspect)) patch.aspect = nearest(form.aspect, aspects);
    if (form.kind === "video" && !durations.includes(form.duration)) patch.duration = durations.reduce((b, d) => (Math.abs(d - form.duration) < Math.abs(b - form.duration) ? d : b), durations[0]);
    if (form.resolution && !resolutions.includes(form.resolution)) patch.resolution = "";
    if (Object.keys(patch).length) set(patch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model?.id, form.kind]);

  const setAdvanced = (key, value) => set({ advanced: { ...form.advanced, [key]: value } });
  const randomSeed = () => set({ seedMode: "fixed", seed: String(Math.floor(Math.random() * 4294967295)) });

  return (
    <aside className="studio-controls" aria-label="Generation settings">
      <div className="studio-tabs" role="tablist">
        {["image", "video"].map((kind) => (
          <button
            key={kind}
            role="tab"
            aria-selected={form.kind === kind}
            className={form.kind === kind ? "active" : ""}
            onClick={() => kind !== form.kind && set({ kind, modelId: "", aspect: kind === "video" ? "9:16" : "1:1" })}
          >
            {kind === "image" ? "Image" : "Video"}
          </button>
        ))}
      </div>

      <div className="studio-section">
        <span className="studio-label">Model</span>
        <ModelPicker
          models={models?.[form.kind] || []}
          value={model}
          kind={form.kind}
          onChange={(m) => set({ modelId: m.id, advanced: {}, resolution: "" })}
        />
        {model?.simulated && <p className="studio-hint warn">Offline test generator: makes placeholders that can't be posted. Add Higgsfield or Gemini in Settings for real images and video.</p>}
      </div>

      <div className="studio-section">
        <div className="spread">
          <label className="studio-label" htmlFor="studio-prompt">Prompt</label>
          <span className="studio-prompt-tools">
            {undoPrompt !== null && <button className="ghost small" onClick={() => { set({ prompt: undoPrompt }); setUndoPrompt(null); setAssistNote(""); }}>Undo</button>}
            <span className="history-wrap" ref={historyBox}>
              <button className="ghost small" onClick={() => setHistoryOpen((v) => !v)} aria-expanded={historyOpen} title="Prompts you used before">History</button>
              {historyOpen && (
                <div className="history-pop" role="listbox" aria-label="Recent prompts">
                  {promptHistory().length === 0 && <div className="muted small history-empty">Prompts you generate with are kept here.</div>}
                  {promptHistory().map((p) => (
                    <button key={p} role="option" aria-selected={p === form.prompt} onClick={() => { set({ prompt: p }); setHistoryOpen(false); }}>{p}</button>
                  ))}
                </div>
              )}
            </span>
            <button className="small" onClick={improve} disabled={improving || form.prompt.trim().length < 2} title="Rewrite a short idea as a detailed prompt with your text model">
              {improving ? "Writing…" : "✦ Improve"}
            </button>
          </span>
        </div>
        <textarea
          id="studio-prompt"
          ref={promptRef}
          className="studio-prompt"
          rows={6}
          maxLength={4000}
          value={form.prompt}
          placeholder={form.kind === "video" ? "Describe the shot: what moves, how the camera moves, the mood…" : "Describe the image: subject, setting, light, mood, camera…"}
          onChange={(e) => set({ prompt: e.target.value })}
        />
        <div className="spread studio-prompt-foot">
          <span className={`small ${assistError ? "bad-text" : "muted"}`}>{assistError || assistNote}</span>
          <span className="muted small">{form.prompt.length} / 4000</span>
        </div>
      </div>

      <ReferenceSlot form={form} set={set} model={model} onPickFromLibrary={onPickReference} onPickEndFrame={onPickEndFrame} />
      {needsFrame && <p className="studio-hint warn studio-inline-hint">{model.name} animates a start frame. Add one above.</p>}

      <div className="studio-section">
        <span className="studio-label">Style</span>
        <div className="chip-row" role="radiogroup" aria-label="Style">
          {(presets || []).map((p) => (
            <button
              key={p.id}
              role="radio"
              aria-checked={form.style === p.id}
              className={`chip ${form.style === p.id ? "active" : ""}`}
              title={p.suffix || "Your prompt only"}
              onClick={() => set({ style: p.id })}
            >
              {p.name}
            </button>
          ))}
        </div>
      </div>

      <div className="studio-section">
        <span className="studio-label">Format</span>
        <div className="chip-row" role="radiogroup" aria-label="Format">
          {aspects.map((a) => (
            <button
              key={a}
              role="radio"
              aria-checked={!form.customSize && form.aspect === a}
              className={`chip ${!form.customSize && form.aspect === a ? "active" : ""}`}
              onClick={() => set({ aspect: a, customSize: false })}
              disabled={aspectFromFrame}
            >
              <span className="aspect-glyph" style={{ aspectRatio: a.replace(":", " / ") }} aria-hidden="true" />
              {a}
            </button>
          ))}
          {form.kind === "image" && model?.custom_size && (
            <button className={`chip ${form.customSize ? "active" : ""}`} onClick={() => set({ customSize: true })}>Custom</button>
          )}
        </div>
        {form.customSize && form.kind === "image" && (
          <div className="studio-size">
            <input type="number" min={256} max={2048} step={16} value={form.width} onChange={(e) => set({ width: e.target.value })} aria-label="Width" />
            <span className="muted">×</span>
            <input type="number" min={256} max={2048} step={16} value={form.height} onChange={(e) => set({ height: e.target.value })} aria-label="Height" />
            <span className="muted small">px · multiples of 16</span>
          </div>
        )}
        {aspectFromFrame && <p className="studio-hint">The video takes its shape from the start frame.</p>}
        {form.kind === "image" && !form.customSize && !FEED_ASPECTS.includes(form.aspect) && (
          <p className="studio-hint">Instagram feed posts need 1:1 or 4:5{aspects.includes("4:5") ? "" : `; ${model?.name || "this model"} offers 1:1`}.</p>
        )}
        {form.kind === "video" && (
          <>
            <span className="studio-label studio-sub-label">Length</span>
            <div className="chip-row" role="radiogroup" aria-label="Duration">
              {durations.map((d) => (
                <button key={d} role="radio" aria-checked={form.duration === d} className={`chip ${form.duration === d ? "active" : ""}`} onClick={() => set({ duration: d })}>{d}s</button>
              ))}
            </div>
          </>
        )}
        {resolutions.length > 0 && (
          <>
            <span className="studio-label studio-sub-label">Quality</span>
            <div className="chip-row" role="radiogroup" aria-label="Resolution">
              {resolutions.map((r) => {
                const on = (form.resolution || model.default_resolution) === r;
                return <button key={r} role="radio" aria-checked={on} className={`chip ${on ? "active" : ""}`} onClick={() => set({ resolution: r })}>{r.toUpperCase()}</button>;
              })}
            </div>
          </>
        )}
        {form.kind === "video" && model?.audio && (
          <label className="inline-field ref-option">
            <input type="checkbox" checked={form.audio} onChange={(e) => set({ audio: e.target.checked })} />
            Generate sound
          </label>
        )}
      </div>

      {form.kind === "image" && (
        <div className="studio-section studio-two">
          <div>
            <span className="studio-label">Variations</span>
            <div className="segmented" role="radiogroup" aria-label="Number of variations">
              {[1, 2, 3, 4].map((n) => (
                <button key={n} role="radio" aria-checked={form.count === n} className={form.count === n ? "active" : ""} onClick={() => set({ count: n })}>{n}</button>
              ))}
            </div>
          </div>
          <div hidden={model?.seed === false}>
            <span className="studio-label">Seed</span>
            <div className="studio-seed">
              <button className={`chip ${form.seedMode === "random" ? "active" : ""}`} onClick={() => set({ seedMode: "random" })}>Random</button>
              <input
                type="number"
                min={0}
                max={4294967295}
                placeholder="or type a seed"
                value={form.seedMode === "fixed" ? form.seed : ""}
                onChange={(e) => set({ seedMode: e.target.value === "" ? "random" : "fixed", seed: e.target.value })}
                aria-label="Fixed seed"
              />
              <button className="ghost small" onClick={randomSeed} title="Pick a random seed and keep it fixed">New</button>
            </div>
          </div>
        </div>
      )}

      {form.kind === "image" && hasAdvanced && (
        <div className="studio-section">
          <button className="studio-disclosure" aria-expanded={showAdvanced} onClick={() => setShowAdvanced((v) => !v)}>
            <span>Advanced</span><span>{showAdvanced ? "−" : "+"}</span>
          </button>
          {showAdvanced && (
            <div className="studio-advanced">
              {Object.entries(advanced).map(([key, fallback]) => {
                const [label, hint] = ADVANCED_LABELS[key] || [key, ""];
                const value = form.advanced?.[key] ?? "";
                const choices = key === "sampler" ? options?.samplers : key === "scheduler" ? options?.schedulers : null;
                return (
                  <label key={key} className="studio-adv-row" title={hint}>
                    <span>{label}</span>
                    {choices ? (
                      <select value={value || fallback} onChange={(e) => setAdvanced(key, e.target.value === fallback ? "" : e.target.value)}>
                        {choices.map((o) => <option key={o} value={o}>{o}</option>)}
                      </select>
                    ) : (
                      <input type="number" step={key === "steps" ? 1 : 0.1} placeholder={String(fallback)} value={value} onChange={(e) => setAdvanced(key, e.target.value)} />
                    )}
                  </label>
                );
              })}
              <button className="ghost small" onClick={() => set({ advanced: {} })}>Reset to model defaults</button>
            </div>
          )}
        </div>
      )}

      {onReset && (
        <div className="studio-reset">
          <button className="ghost small" onClick={onReset} title="Model, style, format and variations from Settings → Studio. Keeps your prompt.">Reset to studio defaults</button>
        </div>
      )}

      <div className="studio-generate-wrap">
        <button className="studio-generate" onClick={onGenerate} disabled={!promptOk || needsFrame}>
          <span>
            {queueBusy ? "Queue " : "Generate "}
            {form.kind === "video" ? "video" : form.count > 1 ? `${form.count} images` : "image"}
          </span>
          <kbd>Ctrl ↵</kbd>
        </button>
      </div>
    </aside>
  );
}
