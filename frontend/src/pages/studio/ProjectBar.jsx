import { useState } from "react";
import { api } from "../../api.js";
import { Banner, Field, Modal, useAction } from "../../ui.jsx";

const COLORS = ["#6e47ff", "#d7ff43", "#ff7a00", "#e5484d", "#30a46c", "#0091ff", "#f76b15", "#8e4ec6"];

/** Which project the studio is working in, and managing projects. */
export default function ProjectBar({ projects, projectId, onSelect, onChanged }) {
  const [editing, setEditing] = useState(null); // null | "new" | project
  const current = (projects || []).find((p) => p.id === projectId);

  return (
    <div className="studio-projects">
      <span className="project-dot" style={{ background: current?.color || "var(--line-strong)" }} aria-hidden="true" />
      <select value={projectId} onChange={(e) => onSelect(e.target.value)} aria-label="Project">
        <option value="">No project · all work</option>
        {(projects || []).map((p) => (
          <option key={p.id} value={p.id}>{p.name} ({p.asset_count})</option>
        ))}
      </select>
      {current && <button className="ghost small" onClick={() => setEditing(current)}>Edit</button>}
      <button className="small" onClick={() => setEditing("new")}>New project</button>

      {editing && (
        <ProjectModal
          project={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(saved, deleted) => {
            setEditing(null);
            onChanged();
            if (deleted) onSelect("");
            else if (saved) onSelect(saved.id);
          }}
        />
      )}
    </div>
  );
}

function ProjectModal({ project, onClose, onSaved }) {
  const [name, setName] = useState(project?.name || "");
  const [description, setDescription] = useState(project?.description || "");
  const [color, setColor] = useState(project?.color || COLORS[0]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { busy, error, run } = useAction();

  const save = () => run(async () => {
    const body = { name: name.trim(), description, color };
    const saved = project
      ? await api.patch(`/api/creative/projects/${project.id}`, body)
      : await api.post("/api/creative/projects", body);
    onSaved(saved, false);
  });
  const remove = () => run(async () => {
    await api.del(`/api/creative/projects/${project.id}`);
    onSaved(null, true);
  });

  return (
    <Modal
      title={project ? "Edit project" : "New project"}
      onClose={onClose}
      footer={
        <>
          {project && !confirmDelete && <button className="ghost danger" onClick={() => setConfirmDelete(true)} style={{ marginRight: "auto" }}>Delete project</button>}
          {project && confirmDelete && <button className="danger" onClick={remove} disabled={busy} style={{ marginRight: "auto" }}>Delete; keep its images</button>}
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={save} disabled={busy || !name.trim()}>{busy ? "Saving…" : "Save"}</button>
        </>
      }
    >
      <Banner error={error} />
      <Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Summer launch" autoFocus /></Field>
      <Field label="Notes" hint="The brief, the client, anything worth keeping next to the work.">
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} maxLength={2000} />
      </Field>
      <Field label="Colour">
        <div className="row" style={{ gap: 8 }} role="radiogroup" aria-label="Colour">
          {COLORS.map((c) => (
            <button key={c} role="radio" aria-checked={color === c} aria-label={c} className={`swatch ${color === c ? "active" : ""}`} style={{ background: c }} onClick={() => setColor(c)} />
          ))}
        </div>
      </Field>
      {confirmDelete && <p className="small muted">Deleting the project moves its images to Unfiled. Nothing is lost.</p>}
    </Modal>
  );
}
