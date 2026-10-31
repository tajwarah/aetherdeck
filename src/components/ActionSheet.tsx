// Agent-oriented action: Horus gathers contact options and drafts the message; the person reviews,
// confirms, and the hand-off opens on their own device. Nothing is ever sent by Horus itself.
import { useState } from "react";
import type { ActionDraft, AgentTask, SearchResult } from "../../shared/types.ts";
import { confirmAction, draftAction } from "../lib/api.ts";

interface Props {
  source: SearchResult;
  kind: "contact_provider" | "prepare_reservation";
  defaultName: string;
  defaultNeed: string;
  onClose: () => void;
}

export function ActionSheet({ source, kind, defaultName, defaultNeed, onClose }: Props) {
  const service = kind === "contact_provider";
  const [need, setNeed] = useState(defaultNeed);
  const [when, setWhen] = useState(service ? "today if possible" : "");
  const [party, setParty] = useState(2);
  const [name, setName] = useState(defaultName);
  const [draft, setDraft] = useState<ActionDraft | null>(null);
  const [body, setBody] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<AgentTask | null>(null);
  const [copied, setCopied] = useState(false);

  async function prepare(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const d = await draftAction({ kind, source, details: { need, when, partySize: service ? undefined : party, name: name || undefined } });
      setDraft(d);
      setBody(d.body);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handOff(channel: ActionDraft["channels"][number]) {
    if (!draft || !reviewed) return;
    setBusy(true);
    try {
      let href = channel.href;
      if (channel.kind === "email") href = href.replace(/body=[^&]*/, `body=${encodeURIComponent(body)}`);
      const task = await confirmAction(draft.taskId, channel.kind);
      if (channel.kind === "website" || channel.kind === "map") {
        try { await navigator.clipboard.writeText(body); setCopied(true); } catch { /* clipboard may be blocked */ }
      }
      window.open(href, channel.kind === "phone" || channel.kind === "email" ? "_self" : "_blank", "noopener,noreferrer");
      setDone(task);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="scrim" data-ui onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <section className="sheet sheet--action" role="dialog" aria-modal="true" aria-labelledby="action-title" onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } }}>
        <header className="sheet__head">
          <div>
            <p className="sheet__kicker">{service ? "Prepare a service request" : "Prepare a booking request"}</p>
            <h2 className="sheet__title" id="action-title">{source.title}</h2>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close" autoFocus>
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
          </button>
        </header>

        <ol className="steps" aria-label="Progress">
          <li className="is-done">Found listing</li>
          <li className={draft ? "is-done" : "is-now"}>Draft</li>
          <li className={done ? "is-done" : draft ? "is-now" : ""}>Your review</li>
          <li className={done ? "is-done" : ""}>Hand-off</li>
        </ol>

        {!draft && (
          <form className="form" onSubmit={prepare}>
            <label>
              {service ? "What needs fixing?" : "Anything to mention?"}
              <textarea value={need} onChange={(e) => setNeed(e.target.value)} rows={3} maxLength={600} placeholder={service ? "e.g. Split AC not cooling, makes a clicking noise" : "e.g. Is kacchi biryani available tonight?"} required={service} />
            </label>
            <div className="form__row">
              <label>
                When
                <input value={when} onChange={(e) => setWhen(e.target.value)} maxLength={120} placeholder={service ? "today after 3 pm" : "Friday 8 pm"} required />
              </label>
              {!service && (
                <label className="form__narrow">
                  People
                  <input type="number" min={1} max={30} value={party} onChange={(e) => setParty(Number(e.target.value))} />
                </label>
              )}
            </div>
            <label>
              <span>Your name <span className="optional">optional</span></span>
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoComplete="name" />
            </label>
            <p className="fine">Used only to write the draft. Not stored on the server, not sent to the business until you choose to.</p>
            {error && <p className="error" role="alert">{error}</p>}
            <button className="btn btn--primary" disabled={busy}>{busy ? "Preparing…" : "Prepare draft"}</button>
          </form>
        )}

        {draft && !done && (
          <div className="form">
            <label>
              <span>Message <span className="optional">{draft.draftedBy === "llm" ? "drafted by AI — check it" : "from a template"}</span></span>
              <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={9} />
            </label>
            {draft.missing.length > 0 && <p className="fine">This listing doesn't include: {draft.missing.join(", ")}.</p>}
            <label className="check">
              <input type="checkbox" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} />
              I've reviewed this. Open it on my device so I can send it myself.
            </label>
            <div className="channels">
              {draft.channels.map((c) => (
                <button key={c.kind + c.href} className={`btn ${c.kind === "phone" || c.kind === "email" ? "btn--primary" : ""}`} disabled={!reviewed || busy} onClick={() => handOff(c)}>
                  {c.label}
                </button>
              ))}
            </div>
            {draft.channels.every((c) => c.kind === "map") && <p className="fine">No phone, email or website is listed. The OpenStreetMap listing may help you find a way to reach them.</p>}
            <p className="fine">Horus has no booking or messaging integration with this business. Nothing is sent until you send it yourself.</p>
            {error && <p className="error" role="alert">{error}</p>}
          </div>
        )}

        {done && (
          <div className="handoff" role="status">
            <p className="handoff__title">Handed off — not sent.</p>
            <p>{done.result}</p>
            {copied && <p className="fine">Your message was copied, so you can paste it on their site.</p>}
            <button className="btn" onClick={onClose}>Back to results</button>
          </div>
        )}
      </section>
    </div>
  );
}
