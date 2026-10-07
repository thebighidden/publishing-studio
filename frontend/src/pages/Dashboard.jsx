import { Link } from "react-router-dom";
import { useResource } from "../api.js";
import { Empty, Stat, Tag, ago } from "../ui.jsx";

export default function Dashboard({ events, bump }) {
  const { data: overview } = useResource("/api/overview", [bump]);
  const { data: runs } = useResource("/api/runs?limit=8", [bump]);

  if (!overview) return <Empty>Loading…</Empty>;

  const r = overview.runs;
  const today = new Intl.DateTimeFormat(undefined, {
    weekday: "long", month: "long", day: "numeric",
  }).format(new Date());

  return (
    <>
      <div className="panel dashboard-hero">
        <div>
          <div className="eyebrow">{today}</div>
          <h1>Your publishing desk, at a glance.</h1>
          <p>Plan carefully, approve confidently, and follow every post from draft to verified publication.</p>
        </div>
        <div className="hero-note">
          <b>Evidence over assumptions</b>
          A post is only marked confirmed after the studio sees it live on the account.
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

      <div className="grid two" style={{ marginTop: 16 }}>
        <div className="panel">
          <div className="spread">
            <h3>Latest runs</h3>
            <Link className="small" to="/runs">View all</Link>
          </div>
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
          <div className="spread">
            <h3>Studio activity</h3>
            <Tag kind={events.length ? "live" : "muted"}>{events.length ? "Live" : "Quiet"}</Tag>
          </div>
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
