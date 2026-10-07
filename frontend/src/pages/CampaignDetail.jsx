import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, useResource } from "../api.js";
import { Banner, Empty, Field, Tag, ago, fromLocalInput, toLocalInput, useAction, when } from "../ui.jsx";

const STAGES = ["draft", "plan_review", "producing", "content_review", "scheduled", "done"];

export default function CampaignDetail({ bump }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: campaign, error, setData } = useResource(`/api/campaigns/${id}`, [id, bump]);
  const { data: accounts } = useResource("/api/accounts");

  if (error) return <Banner error={error} />;
  if (!campaign) return <Empty>Loading…</Empty>;

  const stage = STAGES.indexOf(campaign.status);

  return (
    <>
      <div className="page-head">
        <div>
          <div className="small muted">
            <Link to="/campaigns">Campaigns</Link> /
          </div>
          <h1>{campaign.name}</h1>
          <div className="row" style={{ gap: 8 }}>
            {STAGES.map((s, i) => (
              <Tag key={s} kind={i < stage ? "ok" : i === stage ? "" : "muted"}>
                {s.replace("_", " ")}
              </Tag>
            ))}
          </div>
        </div>
      </div>

      <Brief campaign={campaign} accounts={accounts || []} onChange={setData} onDeleted={() => navigate("/campaigns")} />
      <Plan campaign={campaign} onChange={setData} />
      {campaign.gates.plan_approved && <Content campaign={campaign} onChange={setData} />}
      {campaign.posts.some((p) => p.approved_at) && <Schedule campaign={campaign} onChange={setData} />}
    </>
  );
}

/* ---------------- the brief ---------------- */

function Brief({ campaign, accounts, onChange, onDeleted }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(campaign);
  const { busy, error, run } = useAction();

  useEffect(() => setForm(campaign), [campaign]);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const toggleAccount = (aid) =>
    setForm({
      ...form,
      account_ids: form.account_ids.includes(aid)
        ? form.account_ids.filter((a) => a !== aid)
        : [...form.account_ids, aid],
    });

  const save = () =>
    run(async () => {
      const { name, goal, audience, message, key_facts, account_ids } = form;
      onChange(await api.patch(`/api/campaigns/${campaign.id}`, {
        name, goal, audience, message, key_facts, account_ids,
      }));
      setOpen(false);
    });

  const remove = () =>
    run(async () => {
      await api.del(`/api/campaigns/${campaign.id}`);
      onDeleted();
    });

  const linked = accounts.filter((a) => campaign.account_ids.includes(a.id));

  return (
    <div className="panel">
      <div className="spread">
        <h3>Brief</h3>
        <div className="row">
          <button onClick={() => setOpen(!open)}>{open ? "Done editing" : "Edit"}</button>
          <button className="danger ghost" onClick={remove} disabled={busy}>Delete</button>
        </div>
      </div>
      <Banner error={error} />
      {campaign.gates.plan_approved && open && (
        <Banner warning="Editing the brief revokes the plan approval you already gave (gate 6A)." />
      )}

      {!open ? (
        <div className="grid two">
          <Line label="Goal" value={campaign.goal} />
          <Line label="Audience" value={campaign.audience} />
          <Line label="Core message" value={campaign.message} />
          <Line label="Key facts" value={campaign.key_facts} />
          <div>
            <div className="small muted">Accounts</div>
            <div className="row" style={{ gap: 6 }}>
              {!linked.length && <span className="muted">none attached</span>}
              {linked.map((a) => (
                <Tag key={a.id} kind={a.ready ? "ok" : "warn"}>
                  @{a.handle} · {a.platform}
                </Tag>
              ))}
            </div>
          </div>
          <Line label="Created" value={ago(campaign.created_at)} />
        </div>
      ) : (
        <>
          <Field label="Name"><input value={form.name} onChange={set("name")} /></Field>
          <Field label="Goal"><input value={form.goal} onChange={set("goal")} /></Field>
          <Field label="Audience"><input value={form.audience} onChange={set("audience")} /></Field>
          <Field label="Core message"><textarea value={form.message} onChange={set("message")} /></Field>
          <Field label="Key facts"><textarea value={form.key_facts} onChange={set("key_facts")} /></Field>
          <Field label="Accounts">
            <div className="stack">
              {accounts.map((a) => (
                <label key={a.id} className="inline-field" style={{ cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={form.account_ids.includes(a.id)}
                    onChange={() => toggleAccount(a.id)}
                  />
                  <span>@{a.handle} <span className="muted">{a.platform}</span></span>
                  {!a.ready && <Tag kind="warn">not ready</Tag>}
                </label>
              ))}
            </div>
          </Field>
          <div className="row end">
            <button className="primary" onClick={save} disabled={busy}>
              {busy ? "Saving…" : "Save brief"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function Line({ label, value }) {
  return (
    <div>
      <div className="small muted">{label}</div>
      <div>{value || <span className="muted">—</span>}</div>
    </div>
  );
}

/* ---------------- the plan and gate 6A ---------------- */

function Plan({ campaign, onChange }) {
  const [count, setCount] = useState(3);
  const { busy, error, run } = useAction();
  const plan = campaign.plan || {};
  const items = plan.items || [];

  const write = () =>
    run(async () => onChange(await api.post(`/api/campaigns/${campaign.id}/plan`, { item_count: Number(count) })));

  const approve = () =>
    run(async () => onChange(await api.post(`/api/campaigns/${campaign.id}/approve-plan`, {})));

  return (
    <div className="panel">
      <div className="spread">
        <h3>Plan</h3>
        <div className="row">
          <select value={count} onChange={(e) => setCount(e.target.value)}>
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <option key={n} value={n}>{n} item{n > 1 ? "s" : ""}</option>
            ))}
          </select>
          <button onClick={write} disabled={busy || !campaign.account_ids.length}>
            {busy ? "Working…" : items.length ? "Rewrite plan" : "Write the plan"}
          </button>
        </div>
      </div>
      <Banner error={error} />
      {!campaign.account_ids.length && (
        <Banner warning="Attach at least one account before planning — the writer needs a voice to write in." />
      )}

      {!items.length ? (
        <Empty>No plan yet. The writer turns the brief into one.</Empty>
      ) : (
        <>
          <div className="small muted" style={{ marginBottom: 10 }}>
            {plan.summary} · tone: {plan.tone} · written by {plan.generated_by}
          </div>
          <div className="stack">
            {items.map((item, i) => (
              <div className="plan-item" key={i}>
                <div className="spread">
                  <b>{item.title}</b>
                  <div className="row" style={{ gap: 6 }}>
                    <Tag>{item.media_kind}</Tag>
                    <Tag>{item.placement}</Tag>
                  </div>
                </div>
                <div className="small">{item.angle}</div>
                <div className="small muted">caption: {item.caption_brief}</div>
                <div className="small muted">visual: {item.visual_brief}</div>
              </div>
            ))}
          </div>

          <div className="gate">
            <div>
              <b>Gate 6A — plan approval</b>
              <div className="small muted">
                {campaign.gates.plan_approved
                  ? `approved ${when(campaign.plan_approved_at)}`
                  : "Nothing is produced until a human approves this plan."}
              </div>
            </div>
            {campaign.gates.plan_approved ? (
              <Tag kind="ok">passed</Tag>
            ) : (
              <button className="primary" onClick={approve} disabled={busy}>
                Approve plan
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/* ---------------- the content and gate 6B ---------------- */

function Content({ campaign, onChange }) {
  const { busy, error, run } = useAction();
  const posts = campaign.posts || [];
  const blocking = posts.filter((p) => !(p.spec_check?.ok ?? true));

  const produce = () => run(async () => onChange(await api.post(`/api/campaigns/${campaign.id}/produce`, {})));
  const approve = () => run(async () => onChange(await api.post(`/api/campaigns/${campaign.id}/approve-content`, {})));
  const reload = async () => onChange(await api.get(`/api/campaigns/${campaign.id}`));

  return (
    <div className="panel">
      <div className="spread">
        <h3>Content</h3>
        <button onClick={produce} disabled={busy}>
          {busy ? "Producing…" : posts.length ? "Produce again" : "Produce the posts"}
        </button>
      </div>
      <Banner error={error} />

      {!posts.length ? (
        <Empty>Nothing produced yet. The studio writes a caption per account and generates the media.</Empty>
      ) : (
        <>
          <div className="grid two">
            {posts.map((post) => (
              <PostCard key={post.id} post={post} onChanged={reload} />
            ))}
          </div>

          <div className="gate">
            <div>
              <b>Gate 6B — content approval</b>
              <div className="small muted">
                {campaign.gates.content_approved
                  ? `approved ${when(campaign.content_approved_at)}`
                  : blocking.length
                  ? `${blocking.length} post(s) fail their platform spec and must be fixed first.`
                  : "Nothing is scheduled or published until a human approves this content."}
              </div>
            </div>
            {campaign.gates.content_approved ? (
              <Tag kind="ok">passed</Tag>
            ) : (
              <button className="primary" onClick={approve} disabled={busy || blocking.length > 0}>
                Approve content
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function PostCard({ post, onChanged }) {
  const [edit, setEdit] = useState(false);
  const [caption, setCaption] = useState(post.caption);
  const [hashtags, setHashtags] = useState((post.hashtags || []).join(" "));
  const [prompt, setPrompt] = useState("");
  const { busy, error, run } = useAction();

  useEffect(() => {
    setCaption(post.caption);
    setHashtags((post.hashtags || []).join(" "));
  }, [post.caption, post.hashtags]);

  const spec = post.spec_check || {};
  // Counted the same way the backend counts it, so the limit is visible while
  // typing rather than only after a save.
  const tags = hashtags.split(/\s+/).filter(Boolean);
  const chars = caption.length + tags.reduce((n, h) => n + h.length + 1, 0);
  const over = post.spec.caption_max > 0 && chars > post.spec.caption_max;

  const save = () =>
    run(async () => {
      await api.patch(`/api/posts/${post.id}`, {
        caption,
        hashtags: hashtags.split(/\s+/).filter(Boolean),
      });
      setEdit(false);
      await onChanged();
    });

  const regenerate = () =>
    run(async () => {
      await api.post(`/api/posts/${post.id}/regenerate`, {
        prompt: prompt || null,
        kind: post.media?.kind || "image",
      });
      setPrompt("");
      await onChanged();
    });

  const publishNow = () =>
    run(async () => {
      await api.post(`/api/runs/publish-now?post_id=${post.id}`, {});
      await onChanged();
    });

  const drop = () =>
    run(async () => {
      await api.del(`/api/posts/${post.id}`);
      await onChanged();
    });

  return (
    <div className="post-card">
      <div className="spread">
        <div>
          <b>{post.title}</b>
          <div className="small muted">
            @{post.handle} · {post.platform} · {post.placement}
          </div>
        </div>
        <div className="row" style={{ gap: 6 }}>
          <Tag kind={post.status}>{post.status}</Tag>
          <Tag kind={spec.ok ? "ok" : "bad"}>{spec.ok ? "spec ok" : "fails spec"}</Tag>
        </div>
      </div>

      <Media media={post.media} />

      <Banner error={error} />
      {(spec.issues || []).map((issue, i) => (
        <div className="issue small" key={i}>{issue}</div>
      ))}
      {(spec.warnings || []).map((w, i) => (
        <div className="warn small" key={i}>{w}</div>
      ))}

      {!edit ? (
        <>
          <div className="caption">{post.caption}</div>
          <div className="row" style={{ gap: 6, marginTop: 6 }}>
            {(post.hashtags || []).map((h) => (
              <span className="hash" key={h}>{h}</span>
            ))}
          </div>
        </>
      ) : (
        <>
          <textarea rows={5} value={caption} onChange={(e) => setCaption(e.target.value)} />
          <input value={hashtags} onChange={(e) => setHashtags(e.target.value)} placeholder="#one #two" />
          <div className="small muted">
            <span className={over ? "issue" : undefined}>
              {chars}/{post.spec.caption_max || "∞"} characters
            </span>{" "}
            · {post.spec.name} · {post.spec.note}
          </div>
          <div className="row">
            <input
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="new visual prompt (optional)"
              style={{ flex: 1 }}
            />
            <button onClick={regenerate} disabled={busy}>Regenerate media</button>
          </div>
        </>
      )}

      <div className="spread" style={{ marginTop: 10 }}>
        <div className="small muted">
          {post.scheduled_at ? `scheduled ${when(post.scheduled_at)}` : "not scheduled"}
          {post.post_url && (
            <>
              {" · "}
              <a href={post.post_url} target="_blank" rel="noreferrer">live post</a>
            </>
          )}
        </div>
        <div className="row">
          {post.editable &&
            (edit ? (
              <button className="primary" onClick={save} disabled={busy}>Save</button>
            ) : (
              <button onClick={() => setEdit(true)}>Edit</button>
            ))}
          {post.approved_at && (
            <button onClick={publishNow} disabled={busy}>Publish now</button>
          )}
          {post.editable && <button className="danger ghost" onClick={drop} disabled={busy}>Delete</button>}
        </div>
      </div>
      {post.last_error && <div className="issue small">{post.last_error}</div>}
    </div>
  );
}

export function Media({ media }) {
  if (!media) return <div className="media-box muted">no media</div>;
  return (
    <div className="media-box">
      {media.kind === "video" ? (
        <video src={media.url} controls playsInline />
      ) : (
        <img src={media.url} alt={media.prompt || ""} />
      )}
      <div className="small muted media-meta">
        {media.model || media.provider} · {media.width}×{media.height}
        {media.duration_s ? ` · ${media.duration_s}s` : ""}
        {media.cost ? ` · $${media.cost}` : ""}
      </div>
    </div>
  );
}

/* ---------------- scheduling ---------------- */

function Schedule({ campaign, onChange }) {
  const [start, setStart] = useState(toLocalInput(new Date(Date.now() + 120000).toISOString()));
  const [spacing, setSpacing] = useState(60);
  const { busy, error, run } = useAction();

  const auto = () =>
    run(async () =>
      onChange(
        await api.post(`/api/campaigns/${campaign.id}/auto-schedule`, {
          start_at: fromLocalInput(start),
          spacing_minutes: Number(spacing),
          tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
        })
      )
    );

  const setOne = (post, value) =>
    run(async () => {
      await api.patch(`/api/posts/${post.id}`, { scheduled_at: fromLocalInput(value) });
      onChange(await api.get(`/api/campaigns/${campaign.id}`));
    });

  const schedulable = (campaign.posts || []).filter((p) => p.approved_at);

  return (
    <div className="panel">
      <h3>Schedule</h3>
      <Banner error={error} />
      <div className="row" style={{ alignItems: "flex-end" }}>
        <Field label="First post at">
          <input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
        </Field>
        <Field label="Minutes apart" hint="Posts on the same account are never spaced tighter than the cooldown.">
          <input type="number" min={2} value={spacing} onChange={(e) => setSpacing(e.target.value)} />
        </Field>
        <button className="primary" onClick={auto} disabled={busy}>Spread them out</button>
      </div>

      <table>
        <thead>
          <tr>
            <th>Post</th>
            <th>Account</th>
            <th>When</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {schedulable.map((p) => (
            <tr key={p.id}>
              <td>{p.title}</td>
              <td className="muted">@{p.handle}</td>
              <td>
                <input
                  type="datetime-local"
                  value={toLocalInput(p.scheduled_at)}
                  disabled={!p.editable}
                  onChange={(e) => setOne(p, e.target.value)}
                />
              </td>
              <td><Tag kind={p.status}>{p.status}</Tag></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
