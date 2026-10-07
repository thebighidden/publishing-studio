import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useResource } from "../api.js";
import { Banner, Empty, Modal, Tag, when } from "../ui.jsx";

const VERDICT = {
  confirmed: "We looked afterwards and the post was there.",
  uncertain: "The command went through. We could not prove the result, so we are not claiming it.",
  failed: "The post did not go out.",
};

export default function RunDetail({ bump }) {
  const { id } = useParams();
  const { data: run, error } = useResource(`/api/runs/${id}`, [id, bump]);
  const [zoom, setZoom] = useState(null);

  if (error) return <Banner error={error} />;
  if (!run) return <Empty>Loading…</Empty>;

  const ev = run.evidence || {};
  const checks = ev.checks || {};

  return (
    <>
      <div className="page-head">
        <div>
          <div className="small muted">
            <Link to="/runs">Runs</Link> /
          </div>
          <h1>{run.post_title || run.goal}</h1>
          <div className="small muted">
            @{run.handle} · {run.platform} · {run.phone_name} · started {when(run.started_at)}
          </div>
        </div>
        <a className="button" href={`/api/runs/${run.id}/record`} download>
          Download run record
        </a>
      </div>

      <div className="panel">
        <div className="spread">
          <div>
            <h3 style={{ margin: 0 }}>
              <Tag kind={run.outcome || "running"}>{run.outcome || run.status}</Tag>
            </h3>
            <div className="small muted">{VERDICT[run.outcome] || "Still running."}</div>
          </div>
          <div className="small muted" style={{ textAlign: "right" }}>
            {run.totals?.steps ?? 0} steps
            {run.totals?.failed_steps ? ` · ${run.totals.failed_steps} failed` : ""}
            {run.totals?.wall_clock_ms
              ? ` · ${(run.totals.wall_clock_ms / 1000).toFixed(1)}s wall clock`
              : ""}
          </div>
        </div>
        {run.error && <div className="issue">{run.error}</div>}
        {ev.note && <div className="small" style={{ marginTop: 8 }}>{ev.note}</div>}
        {ev.ref && ev.kind === "post_url" && (
          <div className="small" style={{ marginTop: 6 }}>
            evidence:{" "}
            <a href={ev.ref} target="_blank" rel="noreferrer" className="mono">{ev.ref}</a>
          </div>
        )}
        {!!Object.keys(checks).length && (
          <div className="row" style={{ gap: 6, marginTop: 10 }}>
            {Object.entries(checks).map(([name, value]) => (
              <Tag key={name} kind={value === true ? "ok" : value === false ? "bad" : ""}>
                {name.replace(/_/g, " ")}: {String(value)}
              </Tag>
            ))}
          </div>
        )}
      </div>

      {!!(ev.screenshot_urls || []).length && (
        <div className="panel">
          <h3>What the phone showed</h3>
          <div className="shots">
            {ev.screenshot_urls.map((url) => (
              <button className="shot" key={url} onClick={() => setZoom(url)}>
                <img src={url} alt="evidence" />
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="panel">
        <h3>Every step</h3>
        {!run.steps?.length ? (
          <Empty>No steps recorded.</Empty>
        ) : (
          <table>
            <thead>
              <tr>
                <th style={{ width: 40 }}>#</th>
                <th>Action</th>
                <th>Detail</th>
                <th style={{ width: 70 }}>ms</th>
                <th style={{ width: 90 }}>Shot</th>
              </tr>
            </thead>
            <tbody>
              {run.steps.map((s) => (
                <tr key={s.n} className={s.ok ? undefined : "row-bad"}>
                  <td className="muted">{s.n}</td>
                  <td>
                    <span className="step-chip">{s.action}</span>
                  </td>
                  <td className="small muted">{s.detail}</td>
                  <td className="muted small">{s.ms}</td>
                  <td>
                    {s.screenshot && (
                      <button className="ghost small" onClick={() => setZoom(s.screenshot)}>
                        view
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {zoom && (
        <Modal title="Evidence" onClose={() => setZoom(null)}>
          <img className="screen" src={zoom} alt="evidence" />
          <div className="small muted mono">{zoom}</div>
        </Modal>
      )}
    </>
  );
}
