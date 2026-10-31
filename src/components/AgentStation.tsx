// The Agent Station: make agents with a name, a role, a task and a plan, run them with your own Claude API key,
// and watch them work the browser. Several can run at once; each asks before anything that needs you.
import { useEffect, useRef, useState } from "react";
import { ACCESS, MODELS, TEMPLATES, type Agent, type Run } from "../lib/agents.ts";
import { claudePlan } from "../lib/api.ts";
import { desktop } from "../lib/desktop.ts";
import { Markdown } from "./Assistant.tsx";

const HUES = [38, 200, 150, 290, 340, 90];
const blank = (hue: number): Agent => ({ id: `a${Date.now().toString(36)}`, name: "", role: "", task: "", plan: [], access: "ask", model: MODELS[0].id, hue, notes: [] });

const TOOL_WORDS: Record<string, string> = { list_windows: "Looked at the windows", open_page: "Opened a page", search_web: "Searched the web", read_page: "Read a page", see_page: "Looked over a page", focus_window: "Brought a window forward", close_window: "Closed a window", arrange_windows: "Arranged the windows", save_note: "Saved a note", click: "Clicked", type_text: "Typed" };
const stepText = (s: Run["steps"][number]) => {
  const i = s.input as { url?: string; query?: string; title?: string; text?: string };
  return `${TOOL_WORDS[s.tool] ?? s.tool}${i.url ? `: ${i.url.replace(/^https?:\/\/(www\.)?/, "").slice(0, 60)}` : i.query ? `: ${i.query}` : i.title ? `: ${i.title}` : ""}`;
};

/** The key, asked for in place. It goes to the keychain through Settings' own path and is never shown again. */
function KeyGate({ provider, onSaved }: { provider?: string; onSaved: () => void }) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save() {
    setBusy(true);
    setError("");
    const check = await desktop!.invoke<{ error?: string }>("ai:models", "anthropic", key.trim());
    if (check.error) { setBusy(false); setError(check.error); return; }
    // Agents use this key; the AI that was already answering searches stays as it is.
    await desktop!.invoke("app:setKeys", { ANTHROPIC_API_KEY: key.trim() }, undefined, provider ? { LLM_PROVIDER: provider } : undefined);
    setKey("");
    setBusy(false);
    onSaved();
  }
  if (!desktop) return <p className="fine">Claude agents run in the Horus desktop app.</p>;
  return (
    <form className="station__key" onSubmit={(e) => { e.preventDefault(); if (key.trim()) void save(); }}>
      <h3 className="sheet__h">Add your Claude API key</h3>
      <p className="fine">Agents run on your own Anthropic account, and you pay Anthropic for what they use. The key is encrypted in your computer's keychain. Create one at console.anthropic.com.</p>
      <div className="station__row">
        <input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk-ant-…" aria-label="Claude API key" autoComplete="off" data-keys />
        <button className="btn btn--primary" disabled={!key.trim() || busy}>{busy ? "Checking…" : "Save key"}</button>
      </div>
      {error && <p className="agents__error" role="alert">{error}</p>}
    </form>
  );
}

function Editor({ agent, onSave, onCancel, onDelete, claude }: { agent: Agent; onSave: (a: Agent) => void; onCancel: () => void; onDelete?: () => void; claude: boolean }) {
  const [a, setA] = useState(agent);
  const [planText, setPlanText] = useState(agent.plan.join("\n"));
  const [drafting, setDrafting] = useState(false);
  const [error, setError] = useState("");
  const set = (p: Partial<Agent>) => setA((x) => ({ ...x, ...p }));
  async function draft() {
    setDrafting(true);
    setError("");
    try {
      const r = await claudePlan(a.task, a.role);
      if (!a.role) set({ role: r.role });
      setPlanText(r.plan.join("\n"));
    } catch (err) { setError((err as Error).message); }
    setDrafting(false);
  }
  const ready = a.name.trim() && a.task.trim();
  return (
    <form className="station__form" data-keys onSubmit={(e) => { e.preventDefault(); if (ready) onSave({ ...a, name: a.name.trim(), plan: planText.split("\n").map((l) => l.trim()).filter(Boolean) }); }}>
      {!agent.name && (
        <div className="station__templates" aria-label="Start from a template">
          {TEMPLATES.map((t) => <button type="button" key={t.name} className="chip" onClick={() => { set(t); setPlanText(t.plan.join("\n")); }}>{t.name}</button>)}
        </div>
      )}
      <label>Name<input value={a.name} onChange={(e) => set({ name: e.target.value })} placeholder="Price Watcher" maxLength={80} autoFocus /></label>
      <label>Role<input value={a.role} onChange={(e) => set({ role: e.target.value })} placeholder="What this agent is good at" maxLength={1000} /></label>
      <label>Task<textarea rows={3} value={a.task} onChange={(e) => set({ task: e.target.value })} placeholder="What should it do? Be specific." maxLength={4000} /></label>
      <label>Plan, one step per line
        <textarea rows={5} value={planText} onChange={(e) => setPlanText(e.target.value)} placeholder="Leave empty and the agent works it out" />
      </label>
      <button type="button" className="btn" disabled={!a.task.trim() || drafting || !claude} onClick={() => void draft()}>{drafting ? "Drafting…" : "Draft the plan with Claude"}</button>
      <fieldset className="station__access">
        <legend>What it may do</legend>
        {ACCESS.map((o) => <label key={o.id}><input type="radio" name="access" checked={a.access === o.id} onChange={() => set({ access: o.id })} /><span>{o.label}<small>{o.hint}</small></span></label>)}
      </fieldset>
      <label>Model
        <select value={a.model} onChange={(e) => set({ model: e.target.value })}>{MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select>
      </label>
      {error && <p className="agents__error" role="alert">{error}</p>}
      <div className="station__row">
        <button className="btn btn--primary" disabled={!ready}>Save agent</button>
        <button type="button" className="btn" onClick={onCancel}>Cancel</button>
        {onDelete && <button type="button" className="btn station__delete" onClick={onDelete}>Delete</button>}
      </div>
    </form>
  );
}

interface Props {
  agents: Agent[];
  runs: Record<string, Run>;
  claude: boolean;
  provider?: string;
  onKeySaved: () => void;
  onSave: (a: Agent) => void;
  onDelete: (id: string) => void;
  onStart: (a: Agent) => void;
  onStop: (id: string) => void;
  onClose: () => void;
}

export function AgentStation({ agents, runs, claude, provider, onKeySaved, onSave, onDelete, onStart, onStop, onClose }: Props) {
  const [picked, setPicked] = useState<string | null>(agents[0]?.id ?? null);
  const [editing, setEditing] = useState<Agent | null>(agents.length ? null : blank(HUES[0]));
  const steps = useRef<HTMLOListElement>(null);
  const agent = agents.find((a) => a.id === picked);
  const run = agent && runs[agent.id];
  useEffect(() => { steps.current?.lastElementChild?.scrollIntoView({ block: "nearest" }); }, [run?.steps.length]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return (
    <aside className="station" role="dialog" aria-label="Agent Station" data-ui>
      <header className="station__head">
        <div><p className="sheet__kicker">Your agents, on Claude</p><h2 className="sheet__title">Agent Station</h2></div>
        <button className="btn" onClick={() => { setPicked(null); setEditing(blank(HUES[agents.length % HUES.length])); }}>New agent</button>
        <button className="icon-btn" onClick={onClose} aria-label="Close the Agent Station">×</button>
      </header>
      {!claude && <KeyGate provider={provider} onSaved={onKeySaved} />}
      <div className="station__body">
        <ul className="station__list">
          {agents.map((a) => {
            const r = runs[a.id];
            return (
              <li key={a.id}>
                <button className={`station__agent ${a.id === picked && !editing ? "is-on" : ""}`} style={{ ["--hue" as string]: a.hue }} onClick={() => { setPicked(a.id); setEditing(null); }}>
                  <span className={`mm__dot ${r?.status === "working" ? "is-working" : ""}`} aria-hidden="true" />
                  <span><b>{a.name}</b><small>{r?.ask ? "Needs you" : r?.status === "working" ? "Working…" : a.role || a.task}</small></span>
                </button>
              </li>
            );
          })}
          {!agents.length && !editing && <li className="fine">No agents yet.</li>}
        </ul>
        <div className="station__main">
          {editing ? (
            <Editor agent={editing} claude={claude} onCancel={() => setEditing(null)} onSave={(a) => { onSave(a); setPicked(a.id); setEditing(null); }}
              onDelete={agents.some((a) => a.id === editing.id) ? () => { onDelete(editing.id); setEditing(null); setPicked(null); } : undefined} />
          ) : agent ? (
            <>
              <div className="station__who">
                <div><h3>{agent.name}</h3><p className="fine">{agent.role}</p></div>
                <button className="btn" onClick={() => setEditing(agent)}>Edit</button>
                {run?.status === "working"
                  ? <button className="btn" onClick={() => onStop(agent.id)}>Stop</button>
                  : <button className="btn btn--primary" disabled={!claude} onClick={() => onStart(agent)}>Run</button>}
              </div>
              <p className="station__task">{agent.task}</p>
              {agent.plan.length > 0 && <ol className="station__plan">{agent.plan.map((p, i) => <li key={i}>{p}</li>)}</ol>}
              {run?.ask && (
                <div className="station__ask" role="alert">
                  <p>{run.ask.question}</p>
                  <div className="station__row">
                    <button className="btn btn--primary" onClick={() => run.ask?.answer(true)}>Allow</button>
                    <button className="btn" onClick={() => run.ask?.answer(false)}>Decline</button>
                  </div>
                </div>
              )}
              {run && (
                <ol className="agents__steps" ref={steps} aria-live="polite">
                  {run.steps.map((s) => <li key={s.id} className={`agents__step is-${s.status === "running" ? "running" : s.status === "done" ? "done" : "failed"}`} style={{ ["--hue" as string]: agent.hue }}><span className="agents__what">{stepText(s)}{s.status === "declined" ? " (declined)" : s.status === "failed" ? `: ${s.output}` : ""}</span></li>)}
                </ol>
              )}
              {run?.error && <p className="agents__error" role="alert">{run.error}</p>}
              {(run?.report ?? agent.last?.report) && <div className="agents__out"><Markdown text={run?.report ?? agent.last!.report} /></div>}
              {agent.notes.length > 0 && (
                <section className="station__notes">
                  <h4 className="sheet__h">Saved</h4>
                  {agent.notes.map((n) => <details key={n.at}><summary>{n.title}</summary><Markdown text={n.text} /></details>)}
                </section>
              )}
            </>
          ) : <p className="fine">Pick an agent, or make a new one.</p>}
        </div>
      </div>
    </aside>
  );
}
