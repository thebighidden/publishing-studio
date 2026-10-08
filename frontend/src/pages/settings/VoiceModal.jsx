import { useState } from "react";
import { api } from "../../api.js";
import { Banner, Field, Modal, useAction } from "../../ui.jsx";

/** An account's brand voice: used by every caption the studio and the campaign writer draft for it. */
export default function VoiceModal({ account, onClose, onSaved }) {
  const profile = account.editorial_profile || {};
  const [form, setForm] = useState({
    tone: profile.tone || "",
    topics: profile.topics || "",
    style: profile.style || "",
    avoid: profile.avoid || "",
    signature: profile.signature || "",
    hashtags: (profile.default_hashtags || []).map((h) => `#${h.replace(/^#/, "")}`).join(" "),
    liked: (account.liked_examples || []).join("\n"),
  });
  const { busy, error, run } = useAction();
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const save = () => run(async () => {
    await api.patch(`/api/accounts/${account.id}`, {
      editorial_profile: {
        ...profile,
        tone: form.tone.trim(),
        topics: form.topics.trim(),
        style: form.style.trim(),
        avoid: form.avoid.trim(),
        signature: form.signature.trim(),
        default_hashtags: form.hashtags.split(/[\s,]+/).map((h) => h.replace(/^#/, "")).filter(Boolean).slice(0, 10),
      },
      liked_examples: form.liked.split("\n").map((s) => s.trim()).filter(Boolean).slice(0, 10),
    });
    onSaved();
  });

  return (
    <Modal
      title={`Brand voice · @${account.handle}`}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save voice"}</button>
        </>
      }
    >
      <Banner error={error} />
      <p className="small muted">The AI caption writer follows this for every post on this account.</p>
      <Field label="Tone" hint="How it sounds."><input value={form.tone} onChange={set("tone")} placeholder="warm, concrete, a little dry" /></Field>
      <Field label="Topics" hint="What the account talks about."><input value={form.topics} onChange={set("topics")} placeholder="seaside cafés, slow mornings, local food" /></Field>
      <Field label="Style" hint="How it's written."><input value={form.style} onChange={set("style")} placeholder="short sentences, no exclamation marks" /></Field>
      <Field label="Never use" hint="Words, claims or habits to stay away from."><input value={form.avoid} onChange={set("avoid")} placeholder="emoji, 'game-changer', prices" /></Field>
      <Field label="Sign-off" hint="Added to the end of every caption."><input value={form.signature} onChange={set("signature")} placeholder="— the studio team" maxLength={120} /></Field>
      <Field label="Always include these hashtags" hint="Up to 10, separated by spaces."><input value={form.hashtags} onChange={set("hashtags")} placeholder="#studio #madehere" /></Field>
      <Field label="Captions you like" hint="One per line, up to 10. The writer copies their voice, not their words.">
        <textarea value={form.liked} onChange={set("liked")} rows={4} />
      </Field>
    </Modal>
  );
}
