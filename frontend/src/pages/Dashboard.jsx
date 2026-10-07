import { Link } from "react-router-dom";
import { useResource } from "../api.js";
import { Empty, Stat, Tag, ago } from "../ui.jsx";

export default function Dashboard({ events, bump }) {
  const { data: overview } = useResource("/api/overview", [bump]);
  const { data: runs } = useResource("/api/runs?limit=8", [bump]);

  if (!overview) return <Empty>Loading…</Empty>;

  const r = overview.runs;
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Dashboard</h1>
          <p>
            A command sent is not a post published. Every run below ended in one of three
            answers: confirmed, failed, or honestly uncertain.
          </p>
        </div>
      </div>

      <div className="grid four">
        <Stat label="confirmed" value={r.confirmed} kind="confirmed" />
        <Stat label="uncertain" value={r.uncertain} kind="uncertain" />
        <Stat label="failed" value={r.failed} kind="failed" />
        <Stat
          label={`phones online / ${overview.phones.total}`}
          value={overview.phones.online}
        />
      </div>

      <div className="grid two" style={{ marginTop: 14 }}>
        <div className="panel">
          <h3>Latest runs</h3>
          {!runs?.length ? (
            <Empty>Nothing has been published yet.</Empty>
          ) : (
            <table>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.id}>
                    <td>
                      <Link to={`/runs/${run.id}`}>{run.post_title || run.goal}</Link>
                      <div className="small muted">
                        @{run.handle} · {run.phone_name} · {ago(run.created_at)}
                      </div>
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <Tag kind={run.outcome || "running"}>{run.outcome || run.status}</Tag>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="panel">
          <h3>Live feed</h3>
          <div className="feed mono">
            {!events.length ? (
              <Empty>Waiting for activity…</Empty>
            ) : (
              [...events].reverse().map((e, i) => (
                <div className="feed-row" key={i}>
                  <span className="t">{new Date(e.at).toLocaleTimeString()}</span>
                  <span className="k">{e.kind}</span>
                  <span className="muted" style={{ flex: 1, wordBreak: "break-word" }}>
                    {summarise(e)}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="panel">
        <h3>Posts by status</h3>
        <div className="row">
          {Object.keys(overview.posts).length === 0 && <span className="muted">None yet.</span>}
          {Object.entries(overview.posts).map(([status, n]) => (
            <Tag key={status} kind={status}>
              {status}: {n}
            </Tag>
          ))}
        </div>
      </div>
    </>
  );
}

function summarise(event) {
  const { kind, at, ...rest } = event;
  return Object.entries(rest)
    .filter(([k]) => !["run_id", "campaign_id", "post_id", "media_id"].includes(k))
    .map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : v}`)
    .join(" ");
}
