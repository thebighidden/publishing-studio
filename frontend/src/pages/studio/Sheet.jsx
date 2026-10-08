import { useEffect } from "react";

/** A panel that slides over the studio: the library, the post composer. Escape closes it. */
export default function Sheet({ eyebrow, title, side = "bottom", bare = false, onClose, actions, children }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return (
    <div className={`studio-sheet-back side-${side}`} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <section className={`studio-sheet ${bare ? "bare" : ""}`} role="dialog" aria-label={title}>
        {bare && <button className="ghost modal-close studio-sheet-x" onClick={onClose} aria-label="Close">×</button>}
        {!bare && <header className="studio-sheet-head">
          <div>
            {eyebrow && <div className="eyebrow">{eyebrow}</div>}
            <h2>{title}</h2>
          </div>
          <div className="row" style={{ gap: 6 }}>
            {actions}
            <button className="ghost modal-close" onClick={onClose} aria-label="Close">×</button>
          </div>
        </header>}
        <div className="studio-sheet-body">{children}</div>
      </section>
    </div>
  );
}
