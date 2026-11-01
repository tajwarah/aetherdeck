// The Agent Station: a starship bridge for a crew of Claude agents. Summon one, give it a name, a mission and powers,
// then watch it work on deck. Several can run at once; each asks before anything that needs you.
import { useEffect, useRef, useState } from "react";
import { ACCESS, MODELS, ORDERS, SKILLS, moodOf, rankOf, skillsOf, stepText, type Agent, type Run, type Skill } from "../lib/agents.ts";
import { claudePlan } from "../lib/api.ts";
import { desktop } from "../lib/desktop.ts";
import { Markdown } from "./Assistant.tsx";
import { AgentAvatar } from "./AgentAvatar.tsx";
import { AgentStage } from "./AgentStage.tsx";
import { Logo } from "./Logo.tsx";

const blank = (): Agent => ({ id: `a${Date.now().toString(36)}`, name: "", role: "", task: "", plan: [], access: "ask", model: MODELS[0].id, hue: 205, notes: [], skills: ["harvest"], memory: [], xp: 0 });


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
  if (!desktop) return <p className="fine">Claude agents run in the desktop app.</p>;
  return (
    <form className="deck__key" onSubmit={(e) => { e.preventDefault(); if (key.trim()) void save(); }}>
      <span><b>Power the deck.</b> Agents run on your own Anthropic account. Create a key at console.anthropic.com; it's encrypted in your keychain.</span>
      <input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk-ant-…" aria-label="Claude API key" autoComplete="off" data-keys />
      <button className="deck__btn deck__btn--go" disabled={!key.trim() || busy}>{busy ? "Checking…" : "Connect"}</button>
      {error && <p className="agents__error" role="alert">{error}</p>}
    </form>
  );
}

/** Three short steps: choose an order, give it a mission, grant its powers. Editing starts at the mission. */
function Summon({ agent, isNew, onSave, onCancel, onDelete, claude }: { agent: Agent; isNew: boolean; onSave: (a: Agent) => void; onCancel: () => void; onDelete?: () => void; claude: boolean }) {
  const [step, setStep] = useState(isNew ? 0 : 1);
  const [a, setA] = useState(agent);
  const [planText, setPlanText] = useState(agent.plan.join("\n"));
  const [drafting, setDrafting] = useState(false);
  const [igniting, setIgniting] = useState(false);
  const [error, setError] = useState("");
  const set = (p: Partial<Agent>) => setA((x) => ({ ...x, ...p }));
  const order = ORDERS.find((o) => o.id === a.order);
  const roll = () => { const names = order?.names ?? ORDERS[0].names; set({ name: names.filter((n) => n !== a.name)[Math.floor(Math.random() * (names.length - 1))] }); };
  function pick(o: (typeof ORDERS)[number]) {
    set({ order: o.id, hue: o.hue, skills: o.skills, access: o.access, role: o.role, name: o.names[Math.floor(Math.random() * o.names.length)] });
    setPlanText(o.plan.join("\n"));
    setStep(1);
  }
  const toggle = (s: Skill) => set({ skills: skillsOf(a).includes(s) ? skillsOf(a).filter((x) => x !== s) : [...skillsOf(a), s] });
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
  function ignite() {
    const done = { ...a, name: a.name.trim(), plan: planText.split("\n").map((l) => l.trim()).filter(Boolean) };
    if (!isNew) return onSave(done);
    setIgniting(true);
    setTimeout(() => onSave(done), 950);
  }
  const ready = a.name.trim() && a.task.trim();
  return (
    <div className={`summon ${igniting ? "is-igniting" : ""}`} style={{ ["--hue" as string]: a.hue }} data-keys>
      {igniting && <div className="summon__flare" aria-hidden="true"><AgentAvatar hue={a.hue} order={a.order} mood="salute" size={150} /><b>{a.name} reports for duty</b></div>}
      <header className="summon__head">
        <ol className="summon__steps">{["Crew", "Mission", "Powers"].map((s, i) => <li key={s} className={i === step ? "is-on" : i < step ? "is-past" : ""}>{s}</li>)}</ol>
        <button className="deck__icon" onClick={onCancel} aria-label="Cancel">×</button>
      </header>
      {step === 0 && (
        <div className="summon__orders">
          {ORDERS.map((o) => (
            <button key={o.id} className="order" style={{ ["--hue" as string]: o.hue }} onClick={() => pick(o)}>
              <AgentAvatar hue={o.hue} order={o.id} mood="hello" size={84} /><b>{o.name}</b><small>{o.tagline}</small>
            </button>
          ))}
        </div>
      )}
      {step === 1 && (
        <div className="summon__form">
          <label>Name
            <span className="summon__name"><input value={a.name} onChange={(e) => set({ name: e.target.value })} maxLength={80} autoFocus placeholder="Name your agent" /><button className="deck__btn" onClick={roll} aria-label="Roll a name">Roll</button></span>
          </label>
          <label>Mission<textarea rows={4} value={a.task} onChange={(e) => set({ task: e.target.value })} placeholder="What should it do? Be specific." maxLength={4000} /></label>
          {order && <div className="summon__ideas">{order.tasks.map((t) => <button key={t} className="deck__chip" onClick={() => set({ task: t })}>{t}</button>)}</div>}
          <div className="summon__swatches" role="radiogroup" aria-label="Colour">{[205, 150, 190, 280, 340, 18].map((h) => <button key={h} role="radio" aria-checked={a.hue === h} aria-label={`Hue ${h}`} className={a.hue === h ? "is-on" : ""} style={{ ["--hue" as string]: h }} onClick={() => set({ hue: h })} />)}</div>
          <footer className="summon__foot">
            {onDelete && <button className="deck__btn deck__btn--danger" onClick={onDelete}>Release</button>}
            {isNew && <button className="deck__btn" onClick={() => setStep(0)}>Back</button>}
            <button className="deck__btn deck__btn--go" disabled={!ready} onClick={() => setStep(2)}>Powers</button>
          </footer>
        </div>
      )}
      {step === 2 && (
        <div className="summon__form">
          <div className="powers">{SKILLS.map((s) => <button key={s.id} className={`power ${skillsOf(a).includes(s.id) ? "is-on" : ""}`} aria-pressed={skillsOf(a).includes(s.id)} onClick={() => toggle(s.id)}><b>{s.label}</b><small>{s.hint}</small></button>)}</div>
          <fieldset className="leash"><legend>How free is it?</legend>
            {ACCESS.map((o) => <label key={o.id} className={a.access === o.id ? "is-on" : ""}><input type="radio" name="access" checked={a.access === o.id} onChange={() => set({ access: o.id })} /><b>{o.label}</b><small>{o.hint}</small></label>)}
          </fieldset>
          <label>Mind<select value={a.model} onChange={(e) => set({ model: e.target.value })}>{MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select></label>
          <label>Plan, one step per line<textarea rows={4} value={planText} onChange={(e) => setPlanText(e.target.value)} placeholder="Leave empty and the agent works it out" /></label>
          {error && <p className="agents__error" role="alert">{error}</p>}
          <footer className="summon__foot">
            <button className="deck__btn" onClick={() => setStep(1)}>Back</button>
            <button className="deck__btn" disabled={!a.task.trim() || drafting || !claude} onClick={() => void draft()}>{drafting ? "Drafting…" : "Draft the plan"}</button>
            <button className="deck__btn deck__btn--go" disabled={!ready || igniting} onClick={ignite}>{isNew ? "Bring aboard" : "Save"}</button>
          </footer>
        </div>
      )}
    </div>
  );
}

interface Stats { total: number; pageMemory: number; pages: number; busy: number; waiting: number; limit: number }
function EngineBar({ runs }: { runs: Record<string, Run> }) {
  const [s, setS] = useState<Stats | null>(null);
  useEffect(() => {
    if (!desktop) return;
    const read = () => void desktop!.invoke<Stats>("engine:stats").then(setS).catch(() => undefined);
    read();
    const t = setInterval(read, 2000);
    return () => clearInterval(t);
  }, []);
  const used = Object.values(runs).reduce((n, r) => ({ input: n.input + (r.used?.input ?? 0), cached: n.cached + (r.used?.cached ?? 0) }), { input: 0, cached: 0 });
  const seen = used.input + used.cached;
  return (
    <footer className="deck__engine" aria-label="Engine">
      <span><i>Agent pages</i>{s ? `${s.busy} of ${s.limit}` : "–"}</span>
      <span><i>Queued</i>{s?.waiting ?? 0}</span>
      <span><i>Page memory</i>{s ? `${s.pageMemory} MB` : "–"}</span>
      <span><i>App memory</i>{s ? `${(s.total / 1024).toFixed(1)} GB` : "–"}</span>
      <span><i>From cache</i>{seen ? `${Math.round((used.cached / seen) * 100)}%` : "–"}</span>
    </footer>
  );
}

interface AppInfo { id: string; title: string; agent: string }
interface Props {
  agents: Agent[];
  runs: Record<string, Run>;
  claude: boolean;
  provider?: string;
  reduced: boolean;
  onKeySaved: () => void;
  onSave: (a: Agent) => void;
  onDelete: (id: string) => void;
  onStart: (a: Agent) => void;
  onStop: (id: string) => void;
  onOpenApp: (id: string, title: string) => void;
  onClose: () => void;
}

export function AgentStation({ agents, runs, claude, provider, reduced, onKeySaved, onSave, onDelete, onStart, onStop, onOpenApp, onClose }: Props) {
  const [picked, setPicked] = useState<string | null>(agents[0]?.id ?? null);
  const [editing, setEditing] = useState<Agent | null>(agents.length ? null : blank());
  const [apps, setApps] = useState<AppInfo[]>([]);
  const steps = useRef<HTMLOListElement>(null);
  const agent = agents.find((a) => a.id === picked);
  const run = agent && runs[agent.id];
  const builtSomething = Object.values(runs).flatMap((r) => r.steps).filter((s) => s.tool === "build_app" && s.status === "done").length;
  useEffect(() => { void desktop?.invoke<AppInfo[]>("apps:list").then(setApps).catch(() => undefined); }, [builtSomething]);
  useEffect(() => { steps.current?.lastElementChild?.scrollIntoView({ block: "nearest" }); }, [run?.steps.length]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); if (editing && agents.length) setEditing(null); else onClose(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose, editing, agents.length]);
  const forget = (i: number) => agent && onSave({ ...agent, memory: agent.memory?.filter((_, n) => n !== i) });

  return (
    <aside className="deck" role="dialog" aria-label="Agent Station" data-ui>
      <header className="deck__head">
        <Logo />
        <div><h2>Agent Station</h2><p>{agents.length ? `${agents.length} in your crew` : "Bring your first agent aboard"}</p></div>
        <button className="deck__btn deck__btn--go" onClick={() => setEditing(blank())}>Summon</button>
        <button className="deck__icon" onClick={onClose} aria-label="Close the Agent Station">×</button>
      </header>
      {!claude && <KeyGate provider={provider} onSaved={onKeySaved} />}
      <div className="deck__body">
        <ul className="deck__crew">
          {agents.map((a) => {
            const r = runs[a.id];
            return (
              <li key={a.id}>
                <button className={`crew ${a.id === picked ? "is-on" : ""} ${r?.status === "working" ? "is-working" : ""}`} style={{ ["--hue" as string]: a.hue }} onClick={() => { setPicked(a.id); setEditing(null); }}>
                  <AgentAvatar hue={a.hue} order={a.order} mood={moodOf(a, r)} size={38} />
                  <span><b>{a.name}</b><small>{r?.ask ? "Needs you" : r?.status === "working" ? "Working" : rankOf(a.xp)}</small></span>
                </button>
              </li>
            );
          })}
          {apps.length > 0 && <li className="deck__label">Built apps</li>}
          {apps.map((x) => <li key={x.id}><button className="crew crew--app" onClick={() => onOpenApp(x.id, x.title)}><span><b>{x.title}</b><small>by {x.agent}</small></span></button></li>)}
        </ul>
        <div className="deck__stage">
          <AgentStage agents={agents} runs={runs} picked={picked} reduced={reduced} onPick={(id) => { setPicked(id); setEditing(null); }} />
          {editing && <Summon key={editing.id} agent={editing} isNew={!agents.some((a) => a.id === editing.id)} claude={claude} onCancel={() => setEditing(null)} onSave={(a) => { onSave(a); setPicked(a.id); setEditing(null); }}
            onDelete={agents.some((a) => a.id === editing.id) ? () => { onDelete(editing.id); setEditing(null); setPicked(null); } : undefined} />}
        </div>
        <section className="deck__side" style={{ ["--hue" as string]: agent?.hue ?? 205 }}>
          {agent ? (
            <>
              <div className="deck__who">
                <AgentAvatar hue={agent.hue} order={agent.order} mood={moodOf(agent, run)} size={56} />
                <div><h3>{agent.name}</h3><p>{rankOf(agent.xp)} · {agent.xp ?? 0} XP</p></div>
                <button className="deck__btn" onClick={() => setEditing(agent)}>Edit</button>
                {run?.status === "working"
                  ? <button className="deck__btn" onClick={() => onStop(agent.id)}>Stop</button>
                  : <button className="deck__btn deck__btn--go" disabled={!claude} onClick={() => onStart(agent)}>Run</button>}
              </div>
              <p className="deck__task">{agent.task}</p>
              {run?.ask && (
                <div className="deck__ask" role="alert">
                  <p>{run.ask.question}</p>
                  <div><button className="deck__btn deck__btn--go" onClick={() => run.ask?.answer(true)}>Allow</button><button className="deck__btn" onClick={() => run.ask?.answer(false)}>Decline</button></div>
                </div>
              )}
              {run && (
                <ol className="deck__log" ref={steps} aria-live="polite">
                  {run.steps.map((s) => <li key={s.id} className={`is-${s.status}`}>{stepText(s)}{s.status === "declined" ? " (declined)" : s.status === "failed" ? `: ${s.output}` : ""}</li>)}
                </ol>
              )}
              {run?.error && <p className="agents__error" role="alert">{run.error}</p>}
              {(run?.report ?? agent.last?.report) && <div className="deck__report"><Markdown text={run?.report ?? agent.last!.report} /></div>}
              {agent.notes.length > 0 && (
                <section className="deck__notes">
                  <h4>Saved</h4>
                  {agent.notes.map((n) => <details key={n.at}><summary>{n.title}</summary><Markdown text={n.text} /></details>)}
                </section>
              )}
              {!!agent.memory?.length && (
                <section className="deck__notes">
                  <h4>Remembers</h4>
                  <ul>{agent.memory.map((m, i) => <li key={m}>{m}<button className="deck__icon" onClick={() => forget(i)} aria-label={`Forget: ${m}`}>×</button></li>)}</ul>
                </section>
              )}
            </>
          ) : <p className="deck__hint">Choose an agent, or summon a new one.</p>}
        </section>
      </div>
      <EngineBar runs={runs} />
    </aside>
  );
}
