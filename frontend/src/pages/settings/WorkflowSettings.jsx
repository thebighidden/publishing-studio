import { useEffect, useState } from "react";
import { api, useResource } from "../../api.js";
import { Banner, Empty, Field, Modal, Tag, useAction } from "../../ui.jsx";

const REQUIRED = [
  ["prompt", "Prompt text", "The text the studio's prompt goes into."],
  ["seed", "Seed", "Changes each generation; fixed for remixes."],
];
const SIZE = [
  ["width", "Width"],
  ["height", "Height"],
];
const ADVANCED = [
  ["steps", "Steps"],
  ["guidance", "Guidance (CFG)"],
  ["shift", "Shift"],
  ["sampler", "Sampler"],
  ["scheduler", "Scheduler"],
];

/** Settings → ComfyUI workflows: bring your own exported workflows into the studio. */
export default function WorkflowSettings() {
  const { data: workflows, reload } = useResource("/api/comfy-workflows");
  const [editing, setEditing] = useState(null); // null | "new" | workflow
  const [note, setNote] = useState("");
  const { busy, error, run } = useAction();

  const use = (wf) => run(async () => {
    const res = await api.post(`/api/comfy-workflows/${wf.id}/use`, {});
    setNote(`"${res.name}" is now in the studio's model list.`);
    reload();
  });
  const remove = (wf) => run(async () => {
    await api.del(`/api/comfy-workflows/${wf.id}`);
    reload();
  });

  return (
    <>
      <div className="panel">
        <div className="spread">
          <h3>ComfyUI workflows</h3>
          <button className="primary" onClick={() => setEditing("new")}>Add workflow</button>
        </div>
        <p className="small muted">
          Build a workflow in ComfyUI, export it with <b>Save (API Format)</b> (turn on dev mode in ComfyUI's settings), and add it
          here. Tell the studio which inputs hold the prompt, seed and size; it then shows up as a model in the studio.
        </p>
        <Banner error={error} />
        {note && <div className="banner ok">{note}</div>}
        {!workflows?.length ? <Empty>No workflows yet.</Empty> : (
          <div className="stack">
            {workflows.map((wf) => (
              <div className="device" key={wf.id}>
                <div className="spread">
                  <div>
                    <b>{wf.title}</b> {wf.builtin && <Tag>built in</Tag>}
                    <div className="small muted">
                      model name <code>{wf.name}</code> · {wf.node_count} nodes
                      {wf.used_by.length ? ` · used by ${wf.used_by.join(", ")}` : " · not in the studio yet"}
                    </div>
                    {wf.notes && <div className="small muted">{wf.notes}</div>}
                  </div>
                  <div className="row" style={{ gap: 6 }}>
                    {!wf.used_by.length && <button className="small primary" onClick={() => use(wf)} disabled={busy}>Use in studio</button>}
                    {!wf.builtin && <button className="small" onClick={() => setEditing(wf)}>Edit mapping</button>}
                    {!wf.builtin && <button className="small ghost danger" onClick={() => remove(wf)} disabled={busy || wf.used_by.length > 0} title={wf.used_by.length ? "Remove its model in AI providers first" : ""}>Delete</button>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {editing && (
        <WorkflowModal
          workflow={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(wf, created) => { setEditing(null); reload(); if (created) setNote(`Saved "${wf.title}". Use it in the studio from the list.`); }}
        />
      )}
    </>
  );
}

function fieldOptions(nodes) {
  return nodes.flatMap((n) => Object.entries(n.fields).map(([field, value]) => ({
    key: `${n.id}::${field}`,
    label: `${n.title} (#${n.id}) · ${field} = ${String(value).slice(0, 40)}`,
    node: n.id,
    field,
    value,
  })));
}

function WorkflowModal({ workflow, onClose, onSaved }) {
  const [title, setTitle] = useState(workflow?.title || "");
  const [notes, setNotes] = useState(workflow?.notes || "");
  const [raw, setRaw] = useState("");
  const [graph, setGraph] = useState(workflow?.graph || null);
  const [nodes, setNodes] = useState(null);
  const [mapping, setMapping] = useState(workflow?.mapping || null);
  const [useSize, setUseSize] = useState(Boolean(workflow ? workflow.mapping?.width : true));
  const { busy, error, run, setError } = useAction();

  const analyze = (g) => run(async () => {
    const res = await api.post("/api/comfy-workflows/analyze", { graph: g });
    setGraph(g);
    setNodes(res.nodes);
    if (!workflow) {
      setMapping(res.suggested);
      setUseSize(Boolean(res.suggested.width));
    }
  });

  // Editing: read the stored graph's nodes once.
  useEffect(() => {
    if (workflow) analyze(workflow.graph);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const readText = () => {
    try {
      analyze(JSON.parse(raw));
    } catch {
      setError(new Error("That is not valid JSON. Paste the whole exported file."));
    }
  };
  const readFile = async (file) => {
    if (!file) return;
    setRaw(await file.text());
    if (!title) setTitle(file.name.replace(/\.json$/i, "").replace(/[_-]+/g, " "));
    try {
      analyze(JSON.parse(await file.text()));
    } catch {
      setError(new Error("That file is not valid JSON."));
    }
  };

  const options = nodes ? fieldOptions(nodes) : [];
  const outputs = (nodes || []).filter((n) => "filename_prefix" in n.fields);
  const ref = (key) => (mapping?.[key] ? `${mapping[key][0]}::${mapping[key][1]}` : "");
  const setRef = (key, value) => {
    const opt = options.find((o) => o.key === value);
    setMapping((m) => ({ ...m, [key]: opt ? [opt.node, opt.field] : undefined }));
  };
  const advRef = (key) => (mapping?.advanced?.[key] ? `${mapping.advanced[key][0]}::${mapping.advanced[key][1]}` : "");
  const setAdv = (key, value) => {
    const opt = options.find((o) => o.key === value);
    setMapping((m) => {
      const advanced = { ...(m.advanced || {}) };
      if (opt) advanced[key] = [opt.node, opt.field, opt.value];
      else delete advanced[key];
      return { ...m, advanced };
    });
  };

  const save = () => run(async () => {
    const body = { ...mapping };
    if (!useSize) { delete body.width; delete body.height; }
    const saved = workflow
      ? await api.patch(`/api/comfy-workflows/${workflow.id}`, { title, notes, mapping: body })
      : await api.post("/api/comfy-workflows", { title, notes, graph, mapping: body });
    onSaved(saved, !workflow);
  });

  const pick = (key, label, hint) => (
    <Field key={key} label={label} hint={hint}>
      <select value={ref(key)} onChange={(e) => setRef(key, e.target.value)}>
        <option value="">Choose an input…</option>
        {options.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
      </select>
    </Field>
  );

  return (
    <Modal
      title={workflow ? `Edit · ${workflow.title}` : "Add a ComfyUI workflow"}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={save} disabled={busy || !nodes || !title.trim() || !mapping}>{busy ? "Saving…" : "Save workflow"}</button>
        </>
      }
    >
      <Banner error={error} />
      <Field label="Name" hint="Shown in the studio's model list."><input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} placeholder="Portraits, Flux dev" /></Field>
      <Field label="Notes" hint="Models it needs, what it is good at."><input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} /></Field>

      {!workflow && !nodes && (
        <>
          <Field label="Exported workflow (API format)">
            <input type="file" accept=".json,application/json" onChange={(e) => readFile(e.target.files?.[0])} />
          </Field>
          <Field label="…or paste it">
            <textarea value={raw} onChange={(e) => setRaw(e.target.value)} rows={5} placeholder='{"3": {"class_type": "KSampler", "inputs": {...}}, ...}' />
          </Field>
          <button onClick={readText} disabled={busy || !raw.trim()}>{busy ? "Reading…" : "Read workflow"}</button>
        </>
      )}

      {nodes && mapping && (
        <div className="wf-mapping">
          <p className="small muted">{nodes.length} nodes read. The studio guessed these; check each one.</p>
          {REQUIRED.map(([key, label, hint]) => pick(key, label, hint))}
          <Field label="Save node" hint="The node whose images the studio collects.">
            <select value={mapping.output || ""} onChange={(e) => setMapping((m) => ({ ...m, output: e.target.value }))}>
              <option value="">Choose a node…</option>
              {outputs.map((n) => <option key={n.id} value={n.id}>{n.title} (#{n.id})</option>)}
            </select>
          </Field>
          <label className="inline-field"><input type="checkbox" checked={useSize} onChange={(e) => setUseSize(e.target.checked)} /> The studio sets the image size</label>
          {useSize && SIZE.map(([key, label]) => pick(key, label))}
          <div className="studio-label" style={{ marginTop: 12 }}>Advanced controls offered in the studio (optional)</div>
          {ADVANCED.map(([key, label]) => (
            <div className="wf-adv" key={key}>
              <span>{label}</span>
              <select value={advRef(key)} onChange={(e) => setAdv(key, e.target.value)}>
                <option value="">Not offered</option>
                {options.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
              </select>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
