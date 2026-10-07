import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, useResource } from "../api.js";
import { Banner, Empty, Tag, useAction, when } from "../ui.jsx";

const DAY = 86400000;

export default function Calendar({ bump }) {
  const { data: posts, error, reload } = useResource("/api/posts", [bump]);
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const { busy, error: actionError, run } = useAction();

  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => new Date(weekStart.getTime() + i * DAY)),
    [weekStart]
  );

  const byDay = useMemo(() => {
    const map = new Map();
    for (const post of posts || []) {
      if (!post.scheduled_at) continue;
      const key = dayKey(new Date(post.scheduled_at + "Z"));
      map.set(key, [...(map.get(key) || []), post]);
    }
    return map;
  }, [posts]);

  const unscheduled = (posts || []).filter((p) => !p.scheduled_at);

  const publishNow = (post) =>
    run(async () => {
      await api.post(`/api/runs/publish-now?post_id=${post.id}`, {});
      reload();
    });

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Calendar</h1>
          <p>Everything that is going out, and when. Times are shown in your own timezone.</p>
        </div>
        <div className="row">
          <button onClick={() => setWeekStart(new Date(weekStart.getTime() - 7 * DAY))}>←</button>
          <button onClick={() => setWeekStart(startOfWeek(new Date()))}>This week</button>
          <button onClick={() => setWeekStart(new Date(weekStart.getTime() + 7 * DAY))}>→</button>
        </div>
      </div>

      <Banner error={error} />
      <Banner error={actionError} />

      <div className="week">
        {days.map((day) => {
          const items = byDay.get(dayKey(day)) || [];
          const isToday = dayKey(day) === dayKey(new Date());
          return (
            <div className={isToday ? "day today" : "day"} key={dayKey(day)}>
              <div className="day-head">
                <b>{day.toLocaleDateString(undefined, { weekday: "short" })}</b>
                <span className="muted">{day.getDate()}</span>
              </div>
              {!items.length && <div className="muted small">—</div>}
              {items.map((post) => (
                <div className="slot" key={post.id}>
                  <div className="small mono">
                    {new Date(post.scheduled_at + "Z").toLocaleTimeString(undefined, {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </div>
                  <Link to={`/campaigns/${post.campaign_id}`}>{post.title}</Link>
                  <div className="small muted">@{post.handle}</div>
                  <div className="row" style={{ gap: 4 }}>
                    <Tag kind={post.status}>{post.status}</Tag>
                    {post.status === "approved" || post.status === "scheduled" ? (
                      <button className="ghost small" disabled={busy} onClick={() => publishNow(post)}>
                        now
                      </button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          );
        })}
      </div>

      <div className="panel">
        <h3>Not on the calendar yet</h3>
        {!unscheduled.length ? (
          <Empty>Everything with a date is above.</Empty>
        ) : (
          <table>
            <tbody>
              {unscheduled.map((post) => (
                <tr key={post.id}>
                  <td>
                    <Link to={`/campaigns/${post.campaign_id}`}>{post.title}</Link>
                    <div className="small muted">@{post.handle} · {post.platform} · {post.placement}</div>
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <Tag kind={post.status}>{post.status}</Tag>
                    {post.published_at && (
                      <div className="small muted">published {when(post.published_at)}</div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

function startOfWeek(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // weeks start on Monday
  return d;
}

function dayKey(date) {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}
