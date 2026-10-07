import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, useResource } from "../api.js";
import { Banner, Empty, Field, Modal, Tag, ago, useAction } from "../ui.jsx";

const BLANK = {
  name: "",
  goal: "",
  audience: "",
  message: "",
  key_facts: "",
  account_ids: [],
};

export default function Campaigns() {
  const { data: campaigns, reload } = useResource("/api/campaigns");
  const { data: accounts } = useResource("/api/accounts");
  const [draft, setDraft] = useState(null);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Campaigns</h1>
          <p>
            A campaign starts as a brief. The writer turns it into a plan you approve, then the
            studio produces the posts you approve again before anything is scheduled.
          </p>
        </div>
        <button className="primary" onClick={() => setDraft(BLANK)}>
          New campaign
        </button>
      </div>

      {!campaigns?.length ? (
        <Empty>No campaigns yet. Start with a brief.</Empty>
      ) : (
        <div className="panel">
          <table>
            <thead>
              <tr>
                <th>Campaign</th>
                <th>Stage</th>
                <th>Gates</th>
                <th>Posts</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link to={`/campaigns/${c.id}`}>
                      <b>{c.name}</b>
                    </Link>
                    <div className="small muted">{c.goal || "no goal set"}</div>
                  </td>
                  <td>
                    <Tag kind={c.status === "done" ? "ok" : ""}>{c.status.replace("_", " ")}</Tag>
                  </td>
                  <td>
                    <div className="row" style={{ gap: 6 }}>
                      <Tag kind={c.gates.plan_approved ? "ok" : "warn"}>
                        6A {c.gates.plan_approved ? "passed" : "pending"}
                      </Tag>
                      <Tag kind={c.gates.content_approved ? "ok" : "warn"}>
                        6B {c.gates.content_approved ? "passed" : "pending"}
                      </Tag>
                    </div>
                  </td>
                  <td>
                    {c.post_count}
                    {c.blocking_specs > 0 && (
                      <div className="issue small">{c.blocking_specs} fail spec</div>
                    )}
                  </td>
                  <td className="muted small">{ago(c.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {draft && (
        <BriefModal
          accounts={accounts || []}
          onClose={() => setDraft(null)}
          onSaved={() => {
            setDraft(null);
            reload();
          }}
        />
      )}
    </>
  );
}

function BriefModal({ accounts, onClose, onSaved }) {
  const [form, setForm] = useState(BLANK);
  const { busy, error, run } = useAction();
  const navigate = useNavigate();

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const toggleAccount = (id) =>
    setForm({
      ...form,
      account_ids: form.account_ids.includes(id)
        ? form.account_ids.filter((a) => a !== id)
        : [...form.account_ids, id],
    });

  const save = () =>
    run(async () => {
      const created = await api.post("/api/campaigns", form);
      onSaved();
      navigate(`/campaigns/${created.id}`);
    });

  return (
    <Modal
      title="New campaign"
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={save} disabled={busy || !form.name}>
            {busy ? "Creating…" : "Create"}
          </button>
        </>
      }
    >
      <Banner error={error} />
      <Field label="Name">
        <input value={form.name} onChange={set("name")} placeholder="Spring launch" />
      </Field>
      <Field label="Goal">
        <input value={form.goal} onChange={set("goal")} placeholder="What should this achieve?" />
      </Field>
      <Field label="Audience">
        <input value={form.audience} onChange={set("audience")} placeholder="Who is it for?" />
      </Field>
      <Field label="Core message">
        <textarea value={form.message} onChange={set("message")} />
      </Field>
      <Field label="Key facts" hint="Anything the copy must get right: dates, numbers, names.">
        <textarea value={form.key_facts} onChange={set("key_facts")} />
      </Field>
      <Field label="Accounts" hint="The first account's platform decides the master asset's aspect ratio.">
        <div className="stack">
          {!accounts.length && <span className="muted small">No accounts yet — add one in Settings.</span>}
          {accounts.map((a) => (
            <label key={a.id} className="inline-field" style={{ cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={form.account_ids.includes(a.id)}
                onChange={() => toggleAccount(a.id)}
              />
              <span>
                @{a.handle} <span className="muted">{a.platform}</span>
              </span>
              {!a.ready && <Tag kind="warn">not ready</Tag>}
            </label>
          ))}
        </div>
      </Field>
    </Modal>
  );
}
