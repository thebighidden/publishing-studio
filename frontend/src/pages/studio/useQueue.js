import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../api.js";

const ACTIVE = new Set(["queued", "running"]);
const utc = (iso) => (iso ? new Date(iso.endsWith("Z") || iso.includes("+") ? iso : `${iso}Z`).getTime() : null);

function toFormData(req, batch) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(req)) {
    if (key === "advanced") fd.append("advanced", JSON.stringify(value));
    else if (value instanceof File) fd.append(key, value, value.name);
    else if (typeof value === "boolean") fd.append(key, value ? "true" : "false");
    else if (value !== null && value !== undefined && value !== "") fd.append(key, String(value));
  }
  fd.append("batch", batch);
  return fd;
}

/** A server job in the shape the strip and the canvas use. */
function fromServer(job) {
  return {
    key: job.id,
    batch: job.batch,
    label: job.label,
    model: job.model_label,
    providerId: job.provider_id,
    status: job.status,
    asset: job.asset,
    error: job.error,
    stopping: job.cancel_requested,
    startedAt: utc(job.started_at),
    finishedAt: utc(job.finished_at),
  };
}

/**
 * The studio's generation queue. Jobs run on the server, so a closed tab or a
 * reload loses nothing; this hook submits them and follows their progress.
 */
export function useQueue({ onDone }) {
  const [jobs, setJobs] = useState([]);
  const [error, setError] = useState(null);
  const seen = useRef(null); // ids already finished when first seen: no "new result" for them
  const done = useRef(onDone);
  done.current = onDone;

  const refresh = useCallback(async () => {
    try {
      const list = (await api.get("/api/creative/jobs")).map(fromServer);
      if (seen.current === null) {
        seen.current = new Set(list.filter((j) => j.status === "done").map((j) => j.key));
      } else {
        for (const job of list) {
          if (job.status === "done" && !seen.current.has(job.key)) {
            seen.current.add(job.key);
            done.current?.(job.asset, job);
          }
        }
      }
      setJobs(list);
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, []);

  // Poll fast while anything is in flight, slowly otherwise (another tab may queue work).
  const active = jobs.some((j) => ACTIVE.has(j.status));
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, active ? 1500 : 8000);
    return () => clearInterval(t);
  }, [refresh, active]);

  /** Submit requests as one batch. Returns the batch id; a request the server refuses is reported, not queued. */
  const enqueue = (requests, label = "") => {
    const batch = `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    (async () => {
      for (const request of requests) {
        try {
          const job = fromServer(await api.form("/api/creative/jobs", toFormData(request, batch)));
          setJobs((list) => [...list, job]);
        } catch (err) {
          setJobs((list) => [...list, { key: `local-${Math.random()}`, batch, label, status: "failed", error: err.message, local: true }]);
          break; // the rest of the batch would fail the same way
        }
      }
      refresh();
    })();
    return batch;
  };

  const act = (fn) => async (key) => {
    if (String(key).startsWith("local-")) {
      setJobs((list) => list.filter((j) => j.key !== key));
      return;
    }
    try { await fn(key); } catch (err) { setError(err); }
    refresh();
  };
  const cancel = act((key) => api.post(`/api/creative/jobs/${key}/cancel`));
  const retry = act((key) => api.post(`/api/creative/jobs/${key}/retry`));
  const cancelAll = async () => {
    await Promise.all(jobs.filter((j) => j.status === "queued").map((j) => api.post(`/api/creative/jobs/${j.key}/cancel`).catch(() => {})));
    refresh();
  };
  const clearFinished = async () => {
    setJobs((list) => list.filter((j) => ACTIVE.has(j.status)));
    try { await api.post("/api/creative/jobs/dismiss", { finished: true }); } catch (err) { setError(err); }
    refresh();
  };
  const replaceAsset = (asset) => setJobs((list) => list.map((j) => (j.asset?.id === asset.id ? { ...j, asset } : j)));
  const dropAsset = (id) => setJobs((list) => list.filter((j) => j.asset?.id !== id));

  /** Rough seconds left for everything in flight, from how long finished jobs on the same model took. */
  const estimate = () => {
    const took = {};
    for (const j of jobs) {
      if (j.status === "done" && j.startedAt && j.finishedAt) (took[j.model] ||= []).push((j.finishedAt - j.startedAt) / 1000);
    }
    let total = 0;
    for (const j of jobs) {
      if (!ACTIVE.has(j.status)) continue;
      const samples = took[j.model];
      if (!samples?.length) return null;
      const avg = samples.slice(-5).reduce((a, b) => a + b, 0) / Math.min(samples.length, 5);
      total = Math.max(total, j.status === "running" ? avg - (Date.now() - j.startedAt) / 1000 : avg);
    }
    return Math.max(0, Math.round(total));
  };

  return { jobs, error, enqueue, cancel, cancelAll, retry, clearFinished, replaceAsset, dropAsset, estimate };
}
