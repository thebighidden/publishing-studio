import { Link } from "react-router-dom";
import { useResource } from "../api.js";
import { Banner, Empty, Tag, ago } from "../ui.jsx";

export default function Runs({ bump }) {
  const { data: runs, error } = useResource("/api/runs?limit=100", [bump]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Runs</h1>
          <p>
            One row per attempt to publish. Confirmed means we saw the post afterwards. Uncertain
            means the command went through and we could not prove the result — it is a real answer,
            not a failure in disguise.
          </p>
        </div>
      </div>

      <Banner error={error} />
      {!runs?.length ? (
        <Empty>No publishing runs yet.</Empty>
      ) : (
        <div className="panel">
          <table>
            <thead>
              <tr>
                <th>Post</th>
                <th>Account</th>
                <th>Phone</th>
                <th>Outcome</th>
                <th>Steps</th>
                <th>Started</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.id}>
                  <td>
                    <Link to={`/runs/${run.id}`}>
                      <b>{run.post_title || run.goal || run.id}</b>
                    </Link>
                    {run.error && <div className="issue small">{run.error}</div>}
                  </td>
                  <td className="muted">@{run.handle} · {run.platform}</td>
                  <td className="muted">{run.phone_name}</td>
                  <td>
                    <Tag kind={run.outcome || "running"}>{run.outcome || run.status}</Tag>
                  </td>
                  <td className="muted small">
                    {run.totals?.steps ?? "—"} steps
                    {run.totals?.wall_clock_ms ? ` · ${Math.round(run.totals.wall_clock_ms / 1000)}s` : ""}
                  </td>
                  <td className="muted small">{ago(run.started_at || run.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
