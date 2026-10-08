import { useEffect, useRef, useState } from "react";

function useTicker(active) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return undefined;
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [active]);
}

/** Everything made this session, oldest left, plus what is still queued. */
export default function Filmstrip({ jobs, selectedId, compareId, onSelect, onCompare, onCancel, onRetry, onClear }) {
  const strip = useRef(null);
  const running = jobs.some((j) => j.status === "running");
  useTicker(running);

  // Keep the newest work in view as jobs are added.
  const count = jobs.length;
  useEffect(() => {
    strip.current?.scrollTo({ left: strip.current.scrollWidth, behavior: "smooth" });
  }, [count]);

  if (!jobs.length) {
    return (
      <div className="filmstrip empty-strip">
        <span className="muted small">Results collect here. Queue as many as you like: they keep generating on the server even if you close this tab.</span>
      </div>
    );
  }

  const finished = jobs.filter((j) => !["queued", "running"].includes(j.status)).length;
  let queuedIndex = 0;

  return (
    <div className="filmstrip">
      <div className="filmstrip-items" ref={strip}>
        {jobs.map((job, i) => {
          const newBatch = i > 0 && jobs[i - 1].batch !== job.batch;
          const isSelected = job.asset && job.asset.id === selectedId;
          const isCompare = job.asset && job.asset.id === compareId;
          return (
            <div key={job.key} className={`film-cell ${job.status} ${isSelected ? "selected" : ""} ${isCompare ? "compare" : ""} ${newBatch ? "new-batch" : ""}`}>
              {job.status === "done" && (
                <button
                  onClick={(e) => (e.shiftKey ? onCompare(job.asset) : onSelect(job.asset))}
                  title={`${job.asset.params?.prompt || ""}\n\nClick to view · Shift-click to compare`}
                  aria-label="Show this result"
                >
                  {job.asset.kind === "video" ? <video src={job.asset.url} muted preload="metadata" /> : <img src={job.asset.url} alt="" />}
                  {job.asset.favorite && <span className="film-fav">★</span>}
                  {isCompare && <span className="film-mark">B</span>}
                </button>
              )}
              {job.status === "running" && (
                <div className="film-wait" title={`${job.model || ""}\n${job.label || ""}`}>
                  <div className="spinner" />
                  <span>{job.stopping ? "stopping" : `${Math.max(0, Math.round((Date.now() - (job.startedAt || Date.now())) / 1000))}s`}</span>
                  {!job.stopping && (
                    <button className="film-x" onClick={() => onCancel(job.key)} aria-label="Stop" title="Stop. Works while the model still has it queued; once generating, it finishes.">×</button>
                  )}
                </div>
              )}
              {job.status === "queued" && (
                <div className="film-wait queued">
                  <span>#{++queuedIndex}</span>
                  <button className="film-x" onClick={() => onCancel(job.key)} aria-label="Remove from the queue" title="Remove from the queue">×</button>
                </div>
              )}
              {(job.status === "failed" || job.status === "canceled") && (
                <div className="film-error" title={`${job.model || ""}\n${job.error || ""}`}>
                  <b>{job.status === "canceled" ? "Stopped" : "Failed"}</b>
                  <span>{job.error}</span>
                  {job.local
                    ? <button className="small" onClick={() => onCancel(job.key)}>Dismiss</button>
                    : <button className="small" onClick={() => onRetry(job.key)}>Retry</button>}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {finished > 0 && (
        <button className="ghost small filmstrip-clear" onClick={onClear} title="Clear finished results from the strip. They stay in the library.">Clear</button>
      )}
    </div>
  );
}
