import { useEffect, useState } from "react";
import { api, useResource } from "../api.js";
import { Banner, Empty, Field, Modal, Tag, ago, useAction } from "../ui.jsx";

const TABS = [
  ["phones", "Phones"],
  ["accounts", "Accounts"],
  ["providers", "AI providers"],
];

export default function Settings() {
  const [tab, setTab] = useState("phones");

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <p>
            The three things the studio needs before it can publish: a phone it can drive, an
            account signed in on that phone, and a model that can make the media.
          </p>
        </div>
      </div>

      <div className="tabs">
        {TABS.map(([key, label]) => (
          <button key={key} className={tab === key ? "tab active" : "tab"} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </div>

      {tab === "phones" && <Phones />}
      {tab === "accounts" && <Accounts />}
      {tab === "providers" && <Providers />}
    </>
  );
}

/* ---------------- phones ---------------- */

function Phones() {
  const { data: phones, reload } = useResource("/api/phones");
  const { data: discovered, reload: rediscover } = useResource("/api/phones/discover");
  const [adding, setAdding] = useState(false);
  const [hostPort, setHostPort] = useState("");
  const { busy, error, run } = useAction();

  const connect = () =>
    run(async () => {
      await api.post("/api/phones/connect", { host_port: hostPort });
      setHostPort("");
      rediscover();
    });

  return (
    <>
      <div className="panel">
        <div className="spread">
          <h3>Devices seen by adb</h3>
          <button onClick={rediscover}>Rescan</button>
        </div>
        <Banner error={error} />
        {!discovered ? (
          <Empty>Looking…</Empty>
        ) : (
          <>
            <div className="small muted">
              {discovered.adb_available
                ? "adb is installed and answering"
                : "adb is not installed — the simulator still works end to end"}
            </div>
            <div className="stack" style={{ marginTop: 8 }}>
              {!(discovered.adb || []).length && (
                <span className="muted small">No physical devices attached.</span>
              )}
              {(discovered.adb || []).map((d) => (
                <div className="spread" key={d.serial}>
                  <span className="mono">{d.serial}</span>
                  <div className="row" style={{ gap: 6 }}>
                    <span className="muted small">{d.model || ""}</span>
                    <Tag kind={d.online ? "ok" : "warn"}>{d.online ? "ready" : "unauthorised"}</Tag>
                    <button onClick={() => setAdding({ driver: "adb", serial: d.serial, name: d.model || d.serial })}>
                      Add
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div className="row" style={{ marginTop: 12 }}>
              <input
                value={hostPort}
                onChange={(e) => setHostPort(e.target.value)}
                placeholder="192.168.1.42:5555"
                style={{ flex: 1 }}
              />
              <button onClick={connect} disabled={busy || !hostPort}>Connect over Wi-Fi</button>
            </div>
          </>
        )}
      </div>

      <div className="panel">
        <div className="spread">
          <h3>Phones in the studio</h3>
          <button className="primary" onClick={() => setAdding({ driver: "simulator", serial: "", name: "" })}>
            Add phone
          </button>
        </div>
        {!phones?.length ? (
          <Empty>No phones yet. Add the simulator to try the whole flow without hardware.</Empty>
        ) : (
          <div className="stack">
            {phones.map((p) => (
              <PhoneRow key={p.id} phone={p} onChanged={reload} />
            ))}
          </div>
        )}
      </div>

      {adding && (
        <PhoneModal
          preset={adding}
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            reload();
          }}
        />
      )}
    </>
  );
}

function PhoneRow({ phone, onChanged }) {
  const [shot, setShot] = useState(null);
  const { busy, error, run } = useAction();

  const refresh = () =>
    run(async () => {
      await api.post(`/api/phones/${phone.id}/refresh`, {});
      onChanged();
    });

  const screenshot = () => setShot(`/api/phones/${phone.id}/screenshot?t=${Date.now()}`);

  const drop = () =>
    run(async () => {
      await api.del(`/api/phones/${phone.id}`);
      onChanged();
    });

  return (
    <div className="device">
      <div className="spread">
        <div>
          <b>{phone.name}</b>{" "}
          <Tag kind={phone.driver === "adb" ? "" : "muted"}>{phone.driver}</Tag>
          <div className="small muted mono">
            {phone.serial || "virtual"} · {phone.model_name || "unknown model"}
            {phone.android_version ? ` · Android ${phone.android_version}` : ""}
            {phone.screen_w ? ` · ${phone.screen_w}×${phone.screen_h}` : ""}
          </div>
          <div className="row small" style={{ gap: 6, marginTop: 4 }}>
            {(phone.accounts || []).map((a) => (
              <span className="hash" key={a}>{a}</span>
            ))}
          </div>
        </div>
        <div className="row" style={{ gap: 6 }}>
          <Tag kind={phone.online ? "ok" : "bad"}>{phone.online ? "online" : "offline"}</Tag>
          {phone.busy_run_id && <Tag kind="warn">busy</Tag>}
          <button onClick={refresh} disabled={busy}>Refresh</button>
          <button onClick={screenshot}>Screen</button>
          <button className="danger ghost" onClick={drop} disabled={busy}>Remove</button>
        </div>
      </div>
      <Banner error={error} />
      {phone.last_error && <div className="issue small">{phone.last_error}</div>}
      {phone.last_seen && <div className="small muted">last seen {ago(phone.last_seen)}</div>}
      {shot && (
        <Modal title={`${phone.name} — live screen`} onClose={() => setShot(null)}>
          <img className="screen" src={shot} alt="phone screen" />
        </Modal>
      )}
    </div>
  );
}

function PhoneModal({ preset, onClose, onSaved }) {
  const [form, setForm] = useState({
    name: preset.name || "",
    driver: preset.driver || "simulator",
    serial: preset.serial || "",
  });
  const { busy, error, run } = useAction();

  const save = () =>
    run(async () => {
      await api.post("/api/phones", {
        name: form.name,
        driver: form.driver,
        serial: form.serial || null,
        options: form.driver === "simulator" ? { fail_first_attempts: 0 } : {},
      });
      onSaved();
    });

  return (
    <Modal
      title="Add a phone"
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={save} disabled={busy || !form.name}>
            {busy ? "Adding…" : "Add"}
          </button>
        </>
      }
    >
      <Banner error={error} />
      <Field label="Name"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
      <Field label="Driver" hint="The simulator behaves like a real handset: screens, taps, failures and all.">
        <select value={form.driver} onChange={(e) => setForm({ ...form, driver: e.target.value })}>
          <option value="simulator">Simulator</option>
          <option value="adb">Real device over adb</option>
        </select>
      </Field>
      {form.driver === "adb" && (
        <Field label="Serial" hint="From the scan above, or host:port for a wireless device.">
          <input value={form.serial} onChange={(e) => setForm({ ...form, serial: e.target.value })} />
        </Field>
      )}
    </Modal>
  );
}

/* ---------------- accounts ---------------- */

function Accounts() {
  const { data: accounts, reload } = useResource("/api/accounts");
  const { data: phones } = useResource("/api/phones");
  const [adding, setAdding] = useState(false);

  return (
    <>
      <div className="panel">
        <div className="spread">
          <h3>Instagram and X accounts</h3>
          <button className="primary" onClick={() => setAdding(true)}>Add account</button>
        </div>
        <p className="small muted">
          The studio never holds a password. You sign in once on the phone itself; the studio
          then checks by looking at the screen, not by assuming.
        </p>
        {!accounts?.length ? (
          <Empty>No accounts yet.</Empty>
        ) : (
          <div className="stack">
            {accounts.map((a) => (
              <AccountRow key={a.id} account={a} phones={phones || []} onChanged={reload} />
            ))}
          </div>
        )}
      </div>

      {adding && (
        <AccountModal
          phones={phones || []}
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            reload();
          }}
        />
      )}
    </>
  );
}

function AccountRow({ account, phones, onChanged }) {
  const { busy, error, run } = useAction();
  const [detail, setDetail] = useState(null);

  const check = () =>
    run(async () => {
      const out = await api.post(`/api/accounts/${account.id}/check-login`, {});
      setDetail(out.detail);
      onChanged();
    });

  const relink = (phone_id) =>
    run(async () => {
      await api.patch(`/api/accounts/${account.id}`, { phone_id: phone_id || null });
      onChanged();
    });

  const drop = () =>
    run(async () => {
      await api.del(`/api/accounts/${account.id}`);
      onChanged();
    });

  return (
    <div className="device">
      <div className="spread">
        <div>
          <b>@{account.handle}</b> <Tag>{account.platform}</Tag>
          <div className="small muted">
            {account.editorial_profile?.tone || "no tone set"}
            {account.cooldown_seconds > 0 && ` · cooling down ${account.cooldown_seconds}s`}
            {account.last_published_at && ` · last published ${ago(account.last_published_at)}`}
          </div>
        </div>
        <div className="row" style={{ gap: 6 }}>
          <Tag kind={account.logged_in ? "ok" : "warn"}>
            {account.logged_in ? "signed in" : "not signed in"}
          </Tag>
          <select value={account.phone_id || ""} onChange={(e) => relink(e.target.value)}>
            <option value="">no phone</option>
            {phones.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <button onClick={check} disabled={busy || !account.phone_id}>
            {busy ? "Looking…" : "Check login"}
          </button>
          <button className="danger ghost" onClick={drop} disabled={busy}>Remove</button>
        </div>
      </div>
      <Banner error={error} />
      {detail && <div className="small muted">{detail}</div>}
    </div>
  );
}

function AccountModal({ phones, onClose, onSaved }) {
  const [form, setForm] = useState({
    platform: "instagram",
    handle: "",
    phone_id: phones[0]?.id || "",
    tone: "",
    topics: "",
    style: "",
    liked: "",
  });
  const { busy, error, run } = useAction();
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const save = () =>
    run(async () => {
      await api.post("/api/accounts", {
        platform: form.platform,
        handle: form.handle.replace(/^@/, ""),
        phone_id: form.phone_id || null,
        editorial_profile: { tone: form.tone, topics: form.topics, style: form.style },
        liked_examples: form.liked.split("\n").map((s) => s.trim()).filter(Boolean),
      });
      onSaved();
    });

  return (
    <Modal
      title="Add an account"
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={save} disabled={busy || !form.handle}>
            {busy ? "Adding…" : "Add"}
          </button>
        </>
      }
    >
      <Banner error={error} />
      <Field label="Platform">
        <select value={form.platform} onChange={set("platform")}>
          <option value="instagram">Instagram</option>
          <option value="x">X</option>
        </select>
      </Field>
      <Field label="Handle"><input value={form.handle} onChange={set("handle")} placeholder="studio_test" /></Field>
      <Field label="Phone" hint="The handset this account is signed in on.">
        <select value={form.phone_id} onChange={set("phone_id")}>
          <option value="">no phone yet</option>
          {phones.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </Field>
      <Field label="Tone"><input value={form.tone} onChange={set("tone")} placeholder="direct, concrete, no hype" /></Field>
      <Field label="Topics"><input value={form.topics} onChange={set("topics")} /></Field>
      <Field label="Style"><input value={form.style} onChange={set("style")} placeholder="short sentences" /></Field>
      <Field label="Captions you like" hint="One per line. The writer uses these as examples of the voice.">
        <textarea value={form.liked} onChange={set("liked")} />
      </Field>
    </Modal>
  );
}

/* ---------------- providers ---------------- */

function Providers() {
  const { data: providers, reload } = useResource("/api/providers");
  const { data: catalog } = useResource("/api/providers/catalog");
  const [adding, setAdding] = useState(false);

  return (
    <>
      <div className="panel">
        <div className="spread">
          <h3>Image, video and text models</h3>
          <button className="primary" onClick={() => setAdding(true)} disabled={!catalog}>
            Add provider
          </button>
        </div>
        <p className="small muted">
          Keys are encrypted before they are stored and are never sent back to this screen.
          With nothing configured the studio falls back to offline generators and labels every
          asset as simulated.
        </p>
        {!providers?.length ? (
          <Empty>No providers configured — running fully offline.</Empty>
        ) : (
          <div className="stack">
            {providers.map((p) => (
              <ProviderRow key={p.id} provider={p} onChanged={reload} />
            ))}
          </div>
        )}
      </div>

      {catalog && (
        <div className="panel">
          <h3>What you can plug in</h3>
          <div className="grid two">
            {catalog.adapters.map((a) => (
              <div key={a.adapter}>
                <b>{a.label}</b>{" "}
                {a.kinds.map((k) => (
                  <Tag key={k}>{k}</Tag>
                ))}
                <div className="small muted">{a.note}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {adding && catalog && (
        <ProviderModal
          catalog={catalog}
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            reload();
          }}
        />
      )}
    </>
  );
}

function ProviderRow({ provider, onChanged }) {
  const [key, setKey] = useState("");
  const { busy, error, run } = useAction();

  const check = () =>
    run(async () => {
      await api.post(`/api/providers/${provider.id}/check`, {});
      onChanged();
    });

  const patch = (body) =>
    run(async () => {
      await api.patch(`/api/providers/${provider.id}`, body);
      setKey("");
      onChanged();
    });

  const drop = () =>
    run(async () => {
      await api.del(`/api/providers/${provider.id}`);
      onChanged();
    });

  return (
    <div className="device">
      <div className="spread">
        <div>
          <b>{provider.name}</b> <Tag>{provider.kind}</Tag>{" "}
          {provider.is_default && <Tag kind="ok">default</Tag>}
          <div className="small muted mono">
            {provider.adapter} · {provider.model || "no model set"} · {provider.base_url || "default host"}
          </div>
          <div className="small muted">
            key: {provider.has_key ? provider.key_masked : "none stored"}
            {provider.last_check_at && ` · checked ${ago(provider.last_check_at)}`}
          </div>
        </div>
        <div className="row" style={{ gap: 6 }}>
          {provider.last_check_ok === true && <Tag kind="ok">reachable</Tag>}
          {provider.last_check_ok === false && <Tag kind="bad">failing</Tag>}
          <Tag kind={provider.enabled ? "" : "muted"}>{provider.enabled ? "enabled" : "disabled"}</Tag>
          <button onClick={check} disabled={busy}>{busy ? "Checking…" : "Test"}</button>
          <button onClick={() => patch({ enabled: !provider.enabled })} disabled={busy}>
            {provider.enabled ? "Disable" : "Enable"}
          </button>
          {!provider.is_default && (
            <button onClick={() => patch({ is_default: true })} disabled={busy}>Make default</button>
          )}
          <button className="danger ghost" onClick={drop} disabled={busy}>Remove</button>
        </div>
      </div>
      <Banner error={error} />
      {provider.last_check_detail && (
        <div className={provider.last_check_ok ? "small muted" : "issue small"}>
          {provider.last_check_detail}
        </div>
      )}
      <div className="row" style={{ marginTop: 8 }}>
        <input
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="replace the API key"
          style={{ flex: 1 }}
        />
        <button onClick={() => patch({ api_key: key })} disabled={busy || !key}>Save key</button>
      </div>
    </div>
  );
}

function ProviderModal({ catalog, onClose, onSaved }) {
  const [adapterName, setAdapterName] = useState(catalog.adapters[0].adapter);
  const adapter = catalog.adapters.find((a) => a.adapter === adapterName);
  const [form, setForm] = useState({
    name: "",
    kind: adapter.kinds[0],
    base_url: adapter.base_url,
    api_key: "",
    model: "",
    is_default: true,
  });
  const { busy, error, run } = useAction();

  useEffect(() => {
    setForm((f) => ({
      ...f,
      kind: adapter.kinds.includes(f.kind) ? f.kind : adapter.kinds[0],
      base_url: adapter.base_url,
      model: "",
    }));
  }, [adapterName]);

  const models = adapter.models?.[form.kind] || [];
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const save = () =>
    run(async () => {
      await api.post("/api/providers", {
        name: form.name || `${adapter.label} ${form.kind}`,
        kind: form.kind,
        adapter: adapterName,
        base_url: form.base_url || null,
        api_key: form.api_key || null,
        model: form.model || null,
        is_default: form.is_default,
      });
      onSaved();
    });

  return (
    <Modal
      title="Add a provider"
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={save} disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </button>
        </>
      }
    >
      <Banner error={error} />
      <Field label="Service">
        <select value={adapterName} onChange={(e) => setAdapterName(e.target.value)}>
          {catalog.adapters.map((a) => (
            <option key={a.adapter} value={a.adapter}>{a.label}</option>
          ))}
        </select>
      </Field>
      <div className="small muted" style={{ marginBottom: 12 }}>{adapter.note}</div>

      <Field label="Used for">
        <select value={form.kind} onChange={set("kind")}>
          {adapter.kinds.map((k) => (
            <option key={k} value={k}>{k}</option>
          ))}
        </select>
      </Field>
      <Field label="Label"><input value={form.name} onChange={set("name")} placeholder={`${adapter.label} ${form.kind}`} /></Field>
      <Field label="Model" hint={models.length ? "Pick one, or type your own." : "Free text."}>
        <input value={form.model} onChange={set("model")} list="provider-models" />
        <datalist id="provider-models">
          {models.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      </Field>
      <Field label="Base URL" hint="Point this at your own DGX host to use a local model.">
        <input value={form.base_url} onChange={set("base_url")} />
      </Field>
      <Field label="API key" hint={adapter.key_hint}>
        <input type="password" value={form.api_key} onChange={set("api_key")} />
      </Field>
      <label className="inline-field" style={{ cursor: "pointer" }}>
        <input
          type="checkbox"
          checked={form.is_default}
          onChange={(e) => setForm({ ...form, is_default: e.target.checked })}
        />
        <span>Use this as the default {form.kind} provider</span>
      </label>
    </Modal>
  );
}
