import { useEffect, useState } from "react";

export function Tag({ kind, children }) {
  return <span className={`tag ${kind || ""}`}>{children}</span>;
}

export function Stat({ label, value, kind }) {
  return (
    <div className="panel stat">
      <b className={kind ? `tag ${kind}` : undefined} style={kind ? { background: "none", border: "none", padding: 0, fontSize: 26 } : undefined}>
        {value}
      </b>
      <span>{label}</span>
    </div>
  );
}

export function Field({ label, hint, children }) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
      {hint && <div className="small muted" style={{ marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

export function Banner({ error, warning }) {
  const message = error?.message || error || warning;
  if (!message) return null;
  return <div className={`banner ${error ? "bad" : "warn"}`}>{message}</div>;
}

export function Empty({ children }) {
  return <div className="empty">{children}</div>;
}

export function Modal({ title, onClose, children, footer }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="spread" style={{ marginBottom: 16 }}>
          <h1>{title}</h1>
          <button className="ghost" onClick={onClose}>Close</button>
        </div>
        {children}
        {footer && <div className="row end" style={{ marginTop: 18 }}>{footer}</div>}
      </div>
    </div>
  );
}

/** Wraps an async action with a pending flag and surfaces the API error. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const run = async (fn) => {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (err) {
      setError(err);
      return undefined;
    } finally {
      setBusy(false);
    }
  };

  return { busy, error, run, setError };
}

export function when(iso) {
  if (!iso) return "—";
  const d = new Date(iso.endsWith("Z") || iso.includes("+") ? iso : iso + "Z");
  return d.toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

export function ago(iso) {
  if (!iso) return "—";
  const secs = (Date.now() - new Date(iso.endsWith("Z") ? iso : iso + "Z")) / 1000;
  if (secs < 60) return `${Math.round(secs)}s ago`;
  if (secs < 3600) return `${Math.round(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.round(secs / 3600)}h ago`;
  return when(iso);
}

/** Datetime-local input value from a UTC ISO string, and back again. */
export function toLocalInput(iso) {
  if (!iso) return "";
  const d = new Date(iso.endsWith("Z") ? iso : iso + "Z");
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromLocalInput(value) {
  return value ? new Date(value).toISOString() : null;
}
