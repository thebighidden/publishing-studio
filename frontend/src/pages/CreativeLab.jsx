import { useEffect, useRef, useState } from "react";
import { api, useResource } from "../api.js";
import Filmstrip from "./studio/Filmstrip.jsx";
import GeneratePanel, { selectedModel } from "./studio/GeneratePanel.jsx";
import Inspector from "./studio/Inspector.jsx";
import Library from "./studio/Library.jsx";
import PostViaPhone from "./studio/PostViaPhone.jsx";
import ProjectBar from "./studio/ProjectBar.jsx";
import Sheet from "./studio/Sheet.jsx";
import Shortcuts from "./studio/Shortcuts.jsx";
import Viewer from "./studio/Viewer.jsx";
import { useQueue } from "./studio/useQueue.js";
import { loadJSON, rememberPrompt, saveJSON } from "./studio/storage.js";

const DEFAULT_FORM = {
  kind: "image",
  prompt: "",
  style: "none",
  aspect: "1:1",
  modelId: "",
  count: 1,
  seedMode: "random",
  seed: "",
  advanced: {},
  customSize: false,
  width: 1024,
  height: 1024,
  duration: 6,
  preserveSubject: true,
  prepareFrame: true,
  resolution: "", // empty: the model's default
  audio: true,
  // Not saved between visits:
  reference: null, // { asset } from the library, or { file, url, name } uploaded
  endFrame: null, // video: { asset } to end on, where the model supports it
  parentId: "",
};
const BACKGROUNDS = ["dark", "checker", "light"];
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** One generation request, from the panel's state. */
function buildRequest(form, models, projectId, seed) {
  const model = selectedModel(models, form);
  const advanced = {};
  if (form.kind === "image" && model?.advanced) {
    for (const [key, value] of Object.entries(form.advanced || {})) {
      if (value !== "" && value != null && key in model.advanced) advanced[key] = value;
    }
    if (form.customSize && model.custom_size) {
      advanced.width = Number(form.width);
      advanced.height = Number(form.height);
    }
  }
  const ref = form.reference;
  return {
    prompt: form.prompt.trim(),
    kind: form.kind,
    aspect: form.aspect,
    duration_s: form.duration,
    provider_id: model?.id || "",
    project_id: projectId || "",
    style: form.style || "none",
    seed,
    advanced,
    parent_id: form.parentId || "",
    source_asset_id: form.kind === "video" && ref?.asset ? ref.asset.id : "",
    reference_asset_id: form.kind === "image" && ref?.asset ? ref.asset.id : "",
    end_asset_id: form.kind === "video" && ref && form.endFrame && model?.end_frame ? form.endFrame.asset.id : "",
    reference: ref?.file || null,
    preserve_subject: Boolean(form.preserveSubject),
    prepare_opening_frame: Boolean(form.prepareFrame),
    resolution: model?.resolutions?.includes(form.resolution) ? form.resolution : "",
    audio: form.kind === "video" ? Boolean(form.audio) : true,
  };
}

/** The library image an asset was made from, if it still exists. */
async function referenceOf(asset) {
  const id = asset.params?.source_asset_id || asset.params?.reference_asset_id;
  if (!id) return null;
  try {
    return { asset: await api.get(`/api/creative/assets/${id}`) };
  } catch {
    return null;
  }
}

function isTyping(target) {
  return Boolean(target?.closest?.("input, textarea, select, [contenteditable='true']"));
}

export default function CreativeLab() {
  const { data: models } = useResource("/api/creative/models");
  const { data: presetData } = useResource("/api/creative/presets");
  const { data: projects, reload: reloadProjects } = useResource("/api/creative/projects");
  const [projectId, setProjectId] = useState(() => loadJSON("studio-project", ""));
  const [form, setForm] = useState(() => ({ ...DEFAULT_FORM, ...loadJSON("studio-form", {}), reference: null, endFrame: null, parentId: "" }));
  const [selected, setSelected] = useState(null);
  const [compare, setCompare] = useState(null);
  const [view, setView] = useState("single");
  const [zoom, setZoom] = useState("fit");
  const [background, setBackground] = useState(() => loadJSON("studio-bg", "dark"));
  const [inspectorOpen, setInspectorOpen] = useState(() => loadJSON("studio-inspector", true));
  const [focus, setFocus] = useState(false);
  const [sheet, setSheet] = useState(null); // null | { type: "library" | "pick" } | { type: "post", asset }
  const [showKeys, setShowKeys] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [libraryBump, setLibraryBump] = useState(0);
  const [gridBatch, setGridBatch] = useState(null);
  const fitRef = useRef(1);
  const promptRef = useRef(null);
  const selectedRef = useRef(null);
  const previousRef = useRef(null);
  const followBatch = useRef(null);
  const sheetRef = useRef(null);
  selectedRef.current = selected;
  sheetRef.current = sheet;

  const show = (asset, { manual = true } = {}) => {
    const current = selectedRef.current;
    if (current && asset && current.id !== asset.id) previousRef.current = current;
    setSelected(asset);
    setZoom("fit");
    if (manual) {
      followBatch.current = null;
      const job = jobs.find((j) => j.asset?.id === asset?.id);
      if (job) setGridBatch(job.batch);
    }
  };
  const enqueue = (requests, label) => {
    const batch = queue.enqueue(requests, label);
    followBatch.current = batch;
    setGridBatch(batch);
    return batch;
  };

  const queue = useQueue({
    onDone: (asset, job) => {
      setLibraryBump((n) => n + 1);
      reloadProjects();
      // The first result of the batch just asked for goes on the canvas; the rest wait in the strip.
      if (job.batch === followBatch.current) {
        followBatch.current = null;
        show(asset, { manual: false });
      }
    },
  });
  const { jobs } = queue;
  const running = jobs.find((j) => j.status === "running");
  const queued = jobs.filter((j) => j.status === "queued").length;
  const results = jobs.filter((j) => j.status === "done").map((j) => j.asset);

  // Studio defaults (Settings → Studio) apply to a browser that has no settings of its own yet.
  const hasOwnForm = useRef(loadJSON("studio-form", null) !== null);
  const applyDefaults = (d = {}) => setForm((f) => ({
    ...f,
    kind: "image",
    style: d.style || "none",
    aspect: d.aspect || "1:1",
    count: d.count || 1,
    modelId: d.model_id || "",
    advanced: {},
    customSize: false,
    seedMode: "random",
    seed: "",
    reference: null,
    parentId: "",
  }));
  useEffect(() => {
    if (presetData && !hasOwnForm.current) {
      applyDefaults(presetData.defaults || {});
      hasOwnForm.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetData]);

  // A project that was deleted elsewhere should not stay selected.
  useEffect(() => {
    if (projects && projectId && !projects.some((p) => p.id === projectId)) setProjectId("");
  }, [projects, projectId]);
  useEffect(() => saveJSON("studio-project", projectId), [projectId]);
  useEffect(() => {
    const { reference, endFrame, parentId, ...rest } = form;
    saveJSON("studio-form", rest);
  }, [form]);
  useEffect(() => saveJSON("studio-bg", background), [background]);
  useEffect(() => saveJSON("studio-inspector", inspectorOpen), [inspectorOpen]);

  // An uploaded reference holds an object URL until it is replaced.
  const refUrl = form.reference?.file ? form.reference.url : null;
  useEffect(() => () => { if (refUrl) URL.revokeObjectURL(refUrl); }, [refUrl]);

  const setReferenceFile = (file) => {
    if (!file?.type?.startsWith("image/")) return;
    setForm((f) => ({ ...f, reference: { file, url: URL.createObjectURL(file), name: file.name || "Pasted image" }, parentId: "" }));
  };
  const focusPrompt = () => setTimeout(() => promptRef.current?.focus(), 0);

  // ---------- making ----------

  const generate = () => {
    if (form.prompt.trim().length < 3) {
      promptRef.current?.focus();
      return;
    }
    const count = form.kind === "video" ? 1 : form.count;
    const fixed = form.kind === "image" && form.seedMode === "fixed" && form.seed !== "" ? Number(form.seed) : null;
    const requests = Array.from({ length: count }, (_, i) => buildRequest(form, models, projectId, fixed === null ? null : fixed + i));
    enqueue(requests, form.prompt.trim());
    rememberPrompt(form.prompt);
    setForm((f) => ({ ...f, parentId: "" }));
  };

  const formFromAsset = (asset) => {
    const p = asset.params || {};
    const kind = asset.kind;
    const modelExists = (models?.[kind] || []).some((m) => m.id === p.provider_id);
    const adv = { ...(p.advanced || {}) };
    const custom = Boolean(adv.width && adv.height);
    const { width, height } = adv;
    delete adv.width;
    delete adv.height;
    return {
      kind,
      prompt: p.prompt || asset.prompt || "",
      style: p.style || "none",
      aspect: p.aspect || (kind === "video" ? "9:16" : "1:1"),
      modelId: modelExists ? p.provider_id : "",
      advanced: adv,
      customSize: custom,
      width: width || form.width,
      height: height || form.height,
      duration: p.duration_s || 6,
      resolution: p.resolution || "",
      audio: p.audio ?? form.audio,
      endFrame: null,
      preserveSubject: p.preserve_subject ?? form.preserveSubject,
      parentId: asset.id,
    };
  };

  const remix = (asset) => {
    setForm((f) => ({
      ...f,
      ...formFromAsset(asset),
      count: 1,
      seedMode: asset.seed != null ? "fixed" : "random",
      seed: asset.seed != null ? String(asset.seed) : "",
      reference: null,
    }));
    referenceOf(asset).then((reference) => reference && setForm((f) => (f.parentId === asset.id ? { ...f, reference } : f)));
    focusPrompt();
  };

  const moreLikeThis = async (asset) => {
    const reference = await referenceOf(asset);
    const base = { ...form, ...formFromAsset(asset), seedMode: "random", reference };
    const requests = Array.from({ length: 4 }, () => buildRequest(base, models, projectId || asset.project_id || "", null));
    enqueue(requests, base.prompt);
    setView("grid");
  };

  const animate = (asset) => {
    setForm((f) => ({ ...f, kind: "video", modelId: f.kind === "video" ? f.modelId : "", aspect: "9:16", prompt: asset.params?.prompt || f.prompt, reference: { asset }, parentId: asset.id }));
    focusPrompt();
  };

  const useAsReference = (asset) => {
    setForm((f) => ({
      ...f,
      kind: "image",
      modelId: f.kind === "image" ? f.modelId : "",
      aspect: f.kind === "image" ? f.aspect : "1:1",
      reference: { asset },
      parentId: asset.id,
      preserveSubject: true,
    }));
    focusPrompt();
  };

  // ---------- the selected asset ----------

  const assetChanged = (asset) => {
    if (selectedRef.current?.id === asset.id) setSelected(asset);
    setCompare((c) => (c?.id === asset.id ? asset : c));
    queue.replaceAsset(asset);
    setSheet((s) => (s?.type === "post" && s.asset.id === asset.id ? { ...s, asset } : s));
    setLibraryBump((n) => n + 1);
    reloadProjects();
  };

  const assetDeleted = (asset) => {
    setSelected(null);
    setCompare((c) => (c?.id === asset.id ? null : c));
    if (view === "compare") setView("single");
    queue.dropAsset(asset.id);
    setLibraryBump((n) => n + 1);
    reloadProjects();
  };

  const toggleFavorite = async (asset) => {
    try {
      assetChanged(await api.patch(`/api/creative/assets/${asset.id}`, { favorite: !asset.favorite }));
    } catch { /* the inspector's own toggle reports errors */ }
  };

  const download = (asset) => {
    const a = document.createElement("a");
    a.href = asset.url;
    a.download = `studio-${asset.id}${asset.kind === "video" ? ".mp4" : ".png"}`;
    a.click();
  };

  const startCompare = (b) => {
    if (!b) return;
    if (!selectedRef.current) {
      show(b);
      return;
    }
    if (b.id === selectedRef.current.id || b.kind !== "image" || selectedRef.current.kind !== "image") return;
    setCompare(b);
    setView("compare");
  };

  const toggleCompare = () => {
    if (view === "compare") {
      setView("single");
      return;
    }
    const current = selectedRef.current;
    if (!current) return;
    const index = results.findIndex((a) => a.id === current.id);
    const candidates = [compare, previousRef.current, results[index - 1], results[index + 1]];
    startCompare(candidates.find((a) => a && a.id !== current.id && a.kind === current.kind));
  };

  const step = (delta) => {
    if (!results.length) return;
    const index = results.findIndex((a) => a.id === selectedRef.current?.id);
    const next = index === -1 ? results[delta > 0 ? 0 : results.length - 1] : results[index + delta];
    if (next) show(next);
  };

  const zoomBy = (factor) => setZoom((z) => clamp((z === "fit" ? fitRef.current : z) * factor, 0.05, 8));

  // ---------- keyboard, paste, drop ----------

  const keys = useRef(null);
  keys.current = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      if (!sheet) generate();
      return;
    }
    if (sheet || showKeys || e.ctrlKey || e.metaKey || e.altKey) return;
    if (isTyping(e.target)) {
      // Esc leaves the field so the single-key shortcuts work again.
      if (e.key === "Escape") e.target.blur();
      return;
    }
    const asset = selectedRef.current;
    const actions = {
      ArrowRight: () => step(1),
      ArrowLeft: () => step(-1),
      f: () => asset && toggleFavorite(asset),
      r: () => asset && remix(asset),
      v: () => asset?.kind === "image" && moreLikeThis(asset),
      e: () => asset?.kind === "image" && useAsReference(asset),
      a: () => asset?.kind === "image" && animate(asset),
      p: () => asset && !asset.meta?.simulated && setSheet({ type: "post", asset }),
      d: () => asset && download(asset),
      c: toggleCompare,
      g: () => setView((v) => (v === "grid" ? "single" : "grid")),
      0: () => setZoom("fit"),
      1: () => setZoom(1),
      "+": () => zoomBy(1.25),
      "=": () => zoomBy(1.25),
      "-": () => zoomBy(0.8),
      b: () => setBackground((b) => BACKGROUNDS[(BACKGROUNDS.indexOf(b) + 1) % BACKGROUNDS.length]),
      l: () => setSheet({ type: "library" }),
      i: () => setInspectorOpen((v) => !v),
      "\\": () => setFocus((v) => !v),
      "?": () => setShowKeys(true),
      Escape: () => (view !== "single" ? setView("single") : setFocus(false)),
    };
    const action = actions[e.key.length === 1 ? e.key.toLowerCase() : e.key] || actions[e.key];
    if (action) {
      e.preventDefault();
      action();
    }
  };
  useEffect(() => {
    const onKey = (e) => keys.current(e);
    const onPaste = (e) => {
      const file = [...(e.clipboardData?.files || [])].find((f) => f.type.startsWith("image/"));
      if (file && !sheetRef.current) {
        e.preventDefault();
        setReferenceFile(file);
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("paste", onPaste);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes("Files");
  const dropProps = {
    onDragOver: (e) => {
      if (!hasFiles(e) || sheet) return;
      e.preventDefault();
      setDragOver(true);
    },
    onDragLeave: (e) => {
      if (!e.currentTarget.contains(e.relatedTarget)) setDragOver(false);
    },
    onDrop: (e) => {
      if (!hasFiles(e) || sheet) return;
      e.preventDefault();
      setDragOver(false);
      setReferenceFile(e.dataTransfer.files?.[0]);
    },
  };

  // ---------- render ----------

  const model = selectedModel(models, form);
  const current = (projects || []).find((p) => p.id === projectId);
  // The grid shows the batch being worked on, or the whole session when that batch is a single image.
  const batchJobs = gridBatch ? jobs.filter((j) => j.batch === gridBatch) : [];
  const gridItems = batchJobs.length > 1 ? batchJobs : jobs;
  const eta = running ? queue.estimate() : null;
  const canCompare = Boolean(selected) && (Boolean(compare) || Boolean(previousRef.current) || results.length > 1);

  const empty = running ? (
    <div className="studio-empty"><div className="spinner" /><span>Generating on {model?.name || "the model"}…</span></div>
  ) : (
    <div className="studio-empty">
      <strong>Start with a prompt.</strong>
      <span>Results land here. Drop or paste an image anywhere to use it as a reference.</span>
      <span className="studio-empty-keys"><kbd>Ctrl ↵</kbd> generate · <kbd>L</kbd> library · <kbd>?</kbd> all shortcuts</span>
    </div>
  );

  return (
    <div className={`studio-app ${focus ? "focus" : ""} ${inspectorOpen ? "" : "no-inspector"}`} {...dropProps}>
      <header className="studio-bar">
        <div className="studio-bar-left">
          <span className="studio-bar-title">Creative studio</span>
          <ProjectBar projects={projects} projectId={projectId} onSelect={setProjectId} onChanged={reloadProjects} />
        </div>
        <div className="studio-bar-right">
          {(running || queued > 0) && (
            <span className="queue-pill" aria-live="polite">
              <span className="queue-dot" />
              {running ? "Generating" : "Waiting"}
              {queued > 0 && ` · ${queued} queued`}
              {eta != null && eta > 0 && ` · ~${eta}s`}
              {queued > 0 && <button className="linklike" onClick={queue.cancelAll}>cancel queued</button>}
            </span>
          )}
          <button className="ghost small" onClick={() => setSheet({ type: "library" })}>Library <kbd>L</kbd></button>
          <button className={`ghost small ${inspectorOpen ? "on" : ""}`} onClick={() => setInspectorOpen((v) => !v)} aria-pressed={inspectorOpen}>Inspector <kbd>I</kbd></button>
          <button className={`ghost small ${focus ? "on" : ""}`} onClick={() => setFocus((v) => !v)} aria-pressed={focus} title="Hide everything but the studio">{focus ? "Exit focus" : "Focus"} <kbd>\</kbd></button>
          <button className="ghost small" onClick={() => setShowKeys(true)} aria-label="Keyboard shortcuts" title="Keyboard shortcuts">?</button>
        </div>
      </header>

      <div className="studio-body">
        <GeneratePanel
          models={models}
          presets={presetData?.presets || []}
          options={{ samplers: presetData?.samplers || [], schedulers: presetData?.schedulers || [] }}
          form={form}
          setForm={setForm}
          onGenerate={generate}
          queueBusy={Boolean(running) || queued > 0}
          onPickReference={() => setSheet({ type: "pick", target: "reference" })}
          onPickEndFrame={() => setSheet({ type: "pick", target: "end" })}
          onReset={() => applyDefaults(presetData?.defaults || {})}
          promptRef={promptRef}
        />

        <section className="studio-stage" aria-label="Canvas">
          <div className="stage-toolbar">
            <span className="stage-info">
              {selected
                ? `${selected.kind} · ${selected.width || "?"}×${selected.height || "?"}${selected.duration_s ? ` · ${selected.duration_s}s` : ""} · ${selected.provider || ""}`
                : current ? current.name : model ? `${model.name} · ${model.reach}` : ""}
            </span>
            <div className="stage-views" role="radiogroup" aria-label="View">
              <button role="radio" aria-checked={view === "single"} className={view === "single" ? "active" : ""} onClick={() => setView("single")}>Single</button>
              <button role="radio" aria-checked={view === "compare"} className={view === "compare" ? "active" : ""} onClick={toggleCompare} disabled={!canCompare} title="Compare A/B (C)">Compare</button>
              <button role="radio" aria-checked={view === "grid"} className={view === "grid" ? "active" : ""} onClick={() => setView("grid")} disabled={!gridItems.length} title="Contact sheet (G)">Grid</button>
            </div>
            <div className="stage-zoom">
              <button onClick={() => zoomBy(0.8)} disabled={view !== "single" || selected?.kind !== "image"} aria-label="Zoom out">−</button>
              <button className="stage-zoom-value" onClick={() => setZoom("fit")} disabled={view !== "single"} title="Fit (0)">{zoom === "fit" ? "Fit" : `${Math.round(zoom * 100)}%`}</button>
              <button onClick={() => zoomBy(1.25)} disabled={view !== "single" || selected?.kind !== "image"} aria-label="Zoom in">+</button>
              <button onClick={() => setZoom(1)} disabled={view !== "single" || selected?.kind !== "image"} title="Actual size (1)">1:1</button>
              <button
                className={`stage-bg-swatch bg-${background}`}
                onClick={() => setBackground((b) => BACKGROUNDS[(BACKGROUNDS.indexOf(b) + 1) % BACKGROUNDS.length])}
                title={`Background: ${background} (B)`}
                aria-label={`Canvas background: ${background}`}
              />
            </div>
          </div>

          {view === "compare" && compare && selected && (
            <div className="compare-legend">
              <span><b>A</b> {selected.params?.prompt?.slice(0, 60) || selected.id}</span>
              <span><b>B</b> {compare.params?.prompt?.slice(0, 60) || compare.id}{compare.seed != null ? ` · seed ${compare.seed}` : ""}</span>
              <button className="linklike" onClick={() => { const a = selected; show(compare); setCompare(a); }}>swap</button>
            </div>
          )}

          <Viewer
            asset={selected}
            compare={compare}
            view={view === "compare" && !(compare && selected) ? "single" : view}
            zoom={zoom}
            setZoom={setZoom}
            fitRef={fitRef}
            background={background}
            gridItems={gridItems}
            onPick={(asset) => { show(asset); setView("single"); }}
            empty={empty}
          />

          <Filmstrip
            jobs={jobs}
            selectedId={selected?.id}
            compareId={view === "compare" ? compare?.id : null}
            onSelect={(asset) => show(asset)}
            onCompare={startCompare}
            onCancel={queue.cancel}
            onRetry={queue.retry}
            onClear={queue.clearFinished}
          />
        </section>

        {inspectorOpen && (selected ? (
          <Inspector
            asset={selected}
            projects={projects}
            presets={presetData?.presets}
            onChanged={assetChanged}
            onDeleted={assetDeleted}
            onRemix={remix}
            onMoreLikeThis={moreLikeThis}
            onAnimate={animate}
            onReference={useAsReference}
            onPost={(asset) => setSheet({ type: "post", asset })}
            onOpen={(asset) => show(asset)}
            lineageBump={libraryBump}
          />
        ) : (
          <aside className="studio-inspector inspector-empty" aria-label="Selected asset">
            <span className="studio-label">Nothing selected</span>
            <p className="muted small">Pick a result from the strip below, or open the library to bring back earlier work.</p>
            <button className="small" onClick={() => setSheet({ type: "library" })}>Open library</button>
            {results.length > 0 && (
              <dl className="studio-facts">
                <dt>Session</dt>
                <dd>{results.length} made · {results.filter((a) => a.favorite).length} favourited</dd>
              </dl>
            )}
          </aside>
        ))}
      </div>

      {dragOver && (
        <div className="studio-drop" aria-hidden="true">
          <span>Drop to use as the {form.kind === "video" ? "start frame" : "reference image"}</span>
        </div>
      )}

      {sheet?.type === "library" && (
        <Sheet eyebrow={current ? current.name : "All projects"} title="Library" onClose={() => setSheet(null)}>
          <Library
            projectId={projectId}
            projects={projects}
            bump={libraryBump}
            selectedId={selected?.id}
            onOpen={(asset) => { show(asset); setView("single"); setSheet(null); }}
            onCompare={(asset) => { startCompare(asset); setSheet(null); }}
          />
        </Sheet>
      )}
      {sheet?.type === "pick" && (
        <Sheet eyebrow={sheet.target === "end" ? "End frame" : form.kind === "video" ? "Start frame" : "Reference"} title="Pick an image" onClose={() => setSheet(null)}>
          <Library
            projectId={projectId}
            projects={projects}
            bump={libraryBump}
            pickKind="image"
            onOpen={(asset) => {
              setForm((f) => (sheet.target === "end" ? { ...f, endFrame: { asset } } : { ...f, reference: { asset }, parentId: asset.id }));
              setSheet(null);
            }}
          />
        </Sheet>
      )}
      {sheet?.type === "post" && (
        <Sheet side="right" bare title="Post to Instagram" onClose={() => setSheet(null)}>
          <PostViaPhone key={sheet.asset.id} asset={sheet.asset} onSkip={() => setSheet(null)} onAssetChanged={assetChanged} />
        </Sheet>
      )}
      {showKeys && <Shortcuts onClose={() => setShowKeys(false)} />}
    </div>
  );
}
