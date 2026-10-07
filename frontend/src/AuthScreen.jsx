import { useState } from "react";
import { api } from "./api.js";
import { Banner, Field, useAction } from "./ui.jsx";

export default function AuthScreen({ configured, onAuthenticated }) {
  const [form, setForm] = useState({ username: "", password: "", confirm: "" });
  const { busy, error, run } = useAction();
  const setup = !configured;

  const submit = (event) => {
    event.preventDefault();
    if (setup && form.password !== form.confirm) return;
    run(async () => {
      const result = await api.post(setup ? "/api/auth/setup" : "/api/auth/login", {
        username: form.username,
        password: form.password,
      });
      onAuthenticated(result);
    });
  };

  const mismatch = setup && form.confirm && form.password !== form.confirm;

  return (
    <div className="auth-shell">
      <div className="auth-art">
        <div className="brand auth-brand">
          <div className="brand-mark">P</div>
          <div className="brand-copy">
            <b>Publish Studio</b>
            <span>Your editorial workspace</span>
          </div>
        </div>
        <div className="auth-quote">
          <div className="eyebrow">Private by design</div>
          <h1>Everything you publish, under your control.</h1>
          <p>Campaigns, provider keys, devices, and publishing evidence stay inside your local studio.</p>
        </div>
        <div className="auth-foot">Local workspace · encrypted credentials · verified publishing</div>
      </div>

      <main className="auth-main">
        <form className="auth-card" onSubmit={submit}>
          <div className="eyebrow">{setup ? "First-time setup" : "Welcome back"}</div>
          <h1>{setup ? "Secure your studio." : "Sign in to continue."}</h1>
          <p className="muted">
            {setup
              ? "Create the administrator account used to protect this local workspace."
              : "Use your studio administrator credentials."}
          </p>
          <Banner error={error} />
          <Field label="Username">
            <input
              autoComplete="username"
              autoFocus
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
              placeholder="studio-admin"
              required
              minLength={3}
            />
          </Field>
          <Field label="Password" hint={setup ? "Use at least 10 characters." : undefined}>
            <input
              type="password"
              autoComplete={setup ? "new-password" : "current-password"}
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              required
              minLength={10}
            />
          </Field>
          {setup && (
            <Field label="Confirm password">
              <input
                type="password"
                autoComplete="new-password"
                value={form.confirm}
                onChange={(e) => setForm({ ...form, confirm: e.target.value })}
                required
                minLength={10}
              />
              {mismatch && <div className="issue small">Passwords do not match.</div>}
            </Field>
          )}
          <button className="primary auth-submit" disabled={busy || mismatch || !form.username || form.password.length < 10}>
            {busy ? "Please wait…" : setup ? "Create administrator" : "Sign in"}
          </button>
          <div className="auth-note">The studio does not store or type your Instagram or X password.</div>
        </form>
      </main>
    </div>
  );
}
