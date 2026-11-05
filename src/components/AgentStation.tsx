// The Agent Station: mission control for a crew of agents, each on the model the person chose. Give any task to the
// deploy bar and a crewmate (or a new agent drafted for it) takes it on; the board shows every agent live: what it's
// doing, how far along it is, what it needs from you, and when it next runs. Several can run at once; each asks
// before anything that needs you. The bridge, the crew on deck, is a view away.
import { useCallback, useEffect, useRef, useState } from "react";
import { ACCESS, ORDERS, SKILLS, doingText, isLocal, moodOf, nextRun, orderFor, rankOf, scheduleText, skillsOf, stepText, type Agent, type Run, type Schedule, type Skill } from "../lib/agents.ts";
import { crewPlan, getBrains, type Brain } from "../lib/api.ts";
import { desktop } from "../lib/desktop.ts";
import { Markdown } from "./Assistant.tsx";
import { AgentAvatar } from "./AgentAvatar.tsx";
import { AgentStage } from "./AgentStage.tsx";
import { Logo } from "./Logo.tsx";
import { Glyph, GLYPHS, Sidebar, type SideSection } from "./Sidebar.tsx";

const blank = (): Agent => ({ id: `a${Date.now().toString(36)}`, name: "", role: "", task: "", plan: [], access: "ask", provider: "", model: "", hue: 205, notes: [], skills: ["harvest"], memory: [], xp: 0 });


const COST: Record<Brain["cost"], string> = { local: "Free, on this computer", free: "Free tier or plan", paid: "Paid per use" };

/** Choosing a mind: everything connected, cheapest first, with what each one costs. */
function MindSelect({ brains, provider, model, onPick }: { brains: Brain[]; provider?: string; model: string; onPick: (provider: string, model: string) => void }) {
  const ready = brains.filter((b) => b.ready);
  const current = `${provider ?? "anthropic"}\n${model}`;
  const known = ready.some((b) => b.id === (provider ?? "anthropic") && b.models.some((m) => m.id === model));
  return (
    <select value={known ? current : ""} onChange={(e) => { const [p, m] = e.target.value.split("\n"); onPick(p, m); }}>
      {!known && <option value="">{model ? `${model} (not connected)` : "Choose a model"}</option>}
      {ready.map((b) => <optgroup key={b.id} label={`${b.label}: ${COST[b.cost]}`}>{b.models.map((m) => <option key={m.id} value={`${b.id}\n${m.id}`}>{m.name}</option>)}</optgroup>)}
    </select>
  );
}

/** Shown until some model is connected: the free ways first. */
function ConnectGate({ brains, onRefresh, onSettings }: { brains: Brain[]; onRefresh: () => void; onSettings: () => void }) {
  const open = (url: string) => void (desktop ? desktop.invoke("app:openExternal", url) : window.open(url));
  const note = (id: string) => brains.find((b) => b.id === id)?.note;
  return (
    <div className="deck__key">
      <span><b>Connect a model.</b> Agents can run free on your computer, on Ollama's cloud, or on your own API key.</span>
      <ul className="deck__ways">
        <li><b>Free on this computer</b> {note("ollama") ?? "Ollama is ready."}</li>
        <li><b>Cloud without a big computer</b> {note("ollama-cloud") ?? "Ollama Cloud is ready."}</li>
      </ul>
      <button className="deck__btn" onClick={() => open("https://ollama.com/download")}>Get Ollama</button>
      <button className="deck__btn" onClick={onSettings}>Add a key</button>
      <button className="deck__btn deck__btn--go" onClick={onRefresh}>Check again</button>
    </div>
  );
}

/** Three short steps: choose an order, give it a mission, grant its powers. Editing starts at the mission. */
function Summon({ agent, isNew, brains, onSave, onCancel, onDelete }: { agent: Agent; isNew: boolean; brains: Brain[]; onSave: (a: Agent) => void; onCancel: () => void; onDelete?: () => void }) {
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
      const r = await crewPlan(a.task, a.role, a.provider ?? "anthropic", a.model);
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
          <label>Model<MindSelect brains={brains} provider={a.provider} model={a.model} onPick={(provider, model) => set({ provider, model })} /></label>
          <Repeat value={a.schedule} onChange={(schedule) => set({ schedule })} />
          <label>Plan, one step per line<textarea rows={4} value={planText} onChange={(e) => setPlanText(e.target.value)} placeholder="Leave empty and the agent works it out" /></label>
          {error && <p className="agents__error" role="alert">{error}</p>}
          <footer className="summon__foot">
            <button className="deck__btn" onClick={() => setStep(1)}>Back</button>
            <button className="deck__btn" disabled={!a.task.trim() || drafting || !a.model} onClick={() => void draft()}>{drafting ? "Drafting…" : "Draft the plan"}</button>
            <button className="deck__btn deck__btn--go" disabled={!ready || !a.model || igniting} onClick={ignite}>{isNew ? "Bring aboard" : "Save"}</button>
          </footer>
        </div>
      )}
    </div>
  );
}

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
/** How often it runs by itself. A new schedule counts from now, so nothing runs the moment it's set. */
function Repeat({ value, onChange }: { value?: Schedule; onChange: (s: Schedule | undefined) => void }) {
  const set = (p: Partial<Schedule>) => onChange({ every: value?.every ?? "day", at: value?.at ?? "09:00", day: value?.day ?? 1, ...p, last: Date.now() });
  return (
    <fieldset className="repeat"><legend>Runs by itself</legend>
      <select value={value?.every ?? "off"} onChange={(e) => (e.target.value === "off" ? onChange(undefined) : set({ every: e.target.value as Schedule["every"] }))} aria-label="How often">
        <option value="off">Only when I run it</option><option value="hour">Every hour</option><option value="day">Every day</option><option value="week">Every week</option>
      </select>
      {value?.every === "week" && <select value={value.day ?? 1} onChange={(e) => set({ day: Number(e.target.value) })} aria-label="Day">{DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}</select>}
      {value && value.every !== "hour" && <input type="time" value={value.at ?? "09:00"} onChange={(e) => set({ at: e.target.value })} aria-label="At" />}
      {value && <small>While AetherDeck is open. Anything that posts, sends or buys still waits for you.</small>}
    </fieldset>
  );
}

/** One line for any task: a crewmate takes it, or a new agent is drafted for it. */
function DeployBar({ agents, runs, brains, onDeploy, onNew }: { agents: Agent[]; runs: Record<string, Run>; brains: Brain[]; onDeploy: (a: Agent, task: string) => void; onNew: (a: Agent) => void }) {
  const [task, setTask] = useState("");
  const [who, setWho] = useState("new");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const brain = brains.find((b) => b.ready);
  async function go() {
    const t = task.trim();
    if (!t) return;
    setError("");
    if (who !== "new") { const a = agents.find((x) => x.id === who); if (a) { onDeploy(a, t); setTask(""); } return; }
    if (!brain) { setError("Connect a model first."); return; }
    setBusy(true);
    const o = orderFor(t);
    const a: Agent = { ...blank(), order: o.id, hue: o.hue, skills: o.skills, access: o.access, role: o.role, name: o.names[Math.floor(Math.random() * o.names.length)], task: t, provider: brain.id, model: brain.models[0]?.id ?? "", plan: [] };
    try { const r = await crewPlan(t, a.role, a.provider!, a.model); a.plan = r.plan; } catch { /* it works the steps out itself */ }
    setBusy(false);
    setTask("");
    onNew(a);
  }
  return (
    <form className="deploy" onSubmit={(e) => { e.preventDefault(); void go(); }} data-keys>
      <span className="deploy__orb" aria-hidden="true" />
      <input value={task} onChange={(e) => setTask(e.target.value)} placeholder="Give the crew any task: research, build a site, post my videos, fill a form…" aria-label="A task for the crew" maxLength={4000} />
      <select value={who} onChange={(e) => setWho(e.target.value)} aria-label="Who takes it">
        <option value="new">A new agent for it</option>
        {agents.map((a) => <option key={a.id} value={a.id} disabled={runs[a.id]?.status === "working"}>{a.name}{runs[a.id]?.status === "working" ? " (busy)" : ""}</option>)}
      </select>
      <button className="deck__btn deck__btn--go" disabled={!task.trim() || busy}>{busy ? "Drafting…" : "Deploy"}</button>
      {error && <p className="agents__error" role="alert">{error}</p>}
    </form>
  );
}

const STATUS: Record<string, string> = { working: "Working", done: "Done", failed: "Hit a snag", stopped: "Stopped" };
const ago = (t: number) => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };
const when = (t: number) => new Date(t).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });

/** The board: every agent at a glance, live. */
function Board({ agents, runs, picked, onPick, onStart, onStop }: { agents: Agent[]; runs: Record<string, Run>; picked: string | null; onPick: (id: string) => void; onStart: (a: Agent) => void; onStop: (id: string) => void }) {
  const counts = { working: 0, waiting: 0, done: 0, scheduled: agents.filter((a) => a.schedule).length };
  for (const a of agents) { const r = runs[a.id]; if (r?.ask) counts.waiting++; else if (r?.status === "working") counts.working++; else if (r?.status === "done") counts.done++; }
  return (
    <div className="board">
      <div className="board__kpis">
        <span><b>{counts.working}</b>working</span><span className={counts.waiting ? "is-hot" : ""}><b>{counts.waiting}</b>need you</span>
        <span><b>{counts.done}</b>done this session</span><span><b>{counts.scheduled}</b>on a schedule</span>
      </div>
      {!agents.length && <p className="board__empty">No agents yet. Give the crew a task above, and an agent is drafted for it.</p>}
      <div className="board__grid">
        {agents.map((a) => {
          const r = runs[a.id];
          const last = r?.steps[r.steps.length - 1];
          const state = r?.ask ? "waiting" : r?.status ?? (a.schedule ? "scheduled" : "idle");
          const line = r?.ask ? r.ask.question : r?.status === "working" ? (last?.status === "running" ? doingText(last) : r.said || "Thinking it through…") : r?.error ?? (r?.report ?? a.last?.report ?? a.task);
          const plan = Math.max(a.plan.length, 1);
          const done = r ? r.steps.filter((x) => x.status === "done").length : 0;
          return (
            <article key={a.id} className={`mission is-${state} ${picked === a.id ? "is-picked" : ""}`} style={{ ["--hue" as string]: a.hue }}>
              <button className="mission__open" onClick={() => onPick(a.id)} aria-label={`${a.name}: open`}>
                <AgentAvatar hue={a.hue} order={a.order} mood={moodOf(a, r)} size={46} />
                <span className="mission__who"><b>{a.name}</b><small>{r?.from && r.from !== "you" ? `Helping ${r.from}` : rankOf(a.xp)}</small></span>
                <span className={`mission__state is-${state}`}>{r?.ask ? "Needs you" : STATUS[r?.status ?? ""] ?? (a.schedule ? "Scheduled" : "Ready")}</span>
              </button>
              <p className="mission__task">{r?.task ?? a.task}</p>
              <p className="mission__line">{line.replace(/[#*_`>]/g, "").slice(0, 180)}</p>
              {r?.status === "working" && <span className="mission__bar" aria-label={`${r.steps.length} steps so far`}><i style={{ width: `${Math.min(96, (done / (plan * 3)) * 100 + 6)}%` }} /></span>}
              <footer className="mission__foot">
                <small>{r?.status === "working" ? `${r.steps.length} steps · ${done} done` : a.schedule ? `${scheduleText(a.schedule)} · next ${when(nextRun(a.schedule, a.schedule.last ?? Date.now()))}` : a.last ? `Last run ${ago(a.last.at)}` : "Not run yet"}</small>
                {r?.ask ? <span className="mission__acts"><button className="deck__btn deck__btn--go" onClick={() => r.ask?.answer(true)}>Allow</button><button className="deck__btn" onClick={() => r.ask?.answer(false)}>Decline</button></span>
                  : r?.status === "working" ? <button className="deck__btn" onClick={() => onStop(a.id)}>Stop</button>
                  : <button className="deck__btn deck__btn--go" onClick={() => onStart(a)}>Run</button>}
              </footer>
            </article>
          );
        })}
      </div>
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
  const used = Object.values(runs).reduce((n, r) => ({ input: n.input + (r.used?.input ?? 0), output: n.output + (r.used?.output ?? 0), cached: n.cached + (r.used?.cached ?? 0) }), { input: 0, output: 0, cached: 0 });
  const seen = used.input + used.cached;
  return (
    <footer className="deck__engine" aria-label="Engine">
      <span><i>Agent pages</i>{s ? `${s.busy} of ${s.limit}` : "–"}</span>
      <span><i>Queued</i>{s?.waiting ?? 0}</span>
      <span><i>Page memory</i>{s ? `${s.pageMemory} MB` : "–"}</span>
      <span><i>App memory</i>{s ? `${(s.total / 1024).toFixed(1)} GB` : "–"}</span>
      <span><i>Tokens used</i>{(seen + used.output).toLocaleString("en")}</span>
      <span><i>From cache</i>{seen ? `${Math.round((used.cached / seen) * 100)}%` : "–"}</span>
    </footer>
  );
}

interface AppInfo { id: string; title: string; agent: string; kind?: "app" | "artifact" }
interface SiteInfo { name: string; url: string }
interface Props {
  agents: Agent[];
  runs: Record<string, Run>;
  reduced: boolean;
  onSettings: () => void;
  onSave: (a: Agent) => void;
  onDelete: (id: string) => void;
  onStart: (a: Agent, task?: string) => void;
  onOpenUrl: (url: string, title?: string) => void;
  onStop: (id: string) => void;
  onOpenApp: (id: string, title: string) => void;
  onClose: () => void;
}

export function AgentStation({ agents, runs, reduced, onSettings, onSave, onDelete, onStart, onStop, onOpenApp, onOpenUrl, onClose }: Props) {
  const [view, setView] = useState<"board" | "bridge">("board");
  const [sites, setSites] = useState<SiteInfo[]>([]);
  const [picked, setPicked] = useState<string | null>(agents[0]?.id ?? null);
  const [editing, setEditing] = useState<Agent | null>(agents.length ? null : blank());
  const [apps, setApps] = useState<AppInfo[]>([]);
  const [brains, setBrains] = useState<Brain[] | null>(null);
  const refresh = useCallback(() => { void getBrains().then(setBrains).catch(() => setBrains([])); }, []);
  useEffect(refresh, [refresh]);
  const ready = brains?.some((b) => b.ready) ?? false;
  const runnable = (a: Agent) => !!brains?.some((b) => b.ready && b.id === (a.provider || "anthropic") && b.models.some((m) => m.id === a.model));
  const fresh = () => { const b = brains?.find((x) => x.ready); return { ...blank(), provider: b?.id ?? "", model: b?.models[0]?.id ?? "" }; };
  const steps = useRef<HTMLOListElement>(null);
  const agent = agents.find((a) => a.id === picked);
  const run = agent && runs[agent.id];
  const builtSomething = Object.values(runs).flatMap((r) => r.steps).filter((s) => ["build_app", "make_artifact", "build_site"].includes(s.tool) && s.status === "done").length;
  useEffect(() => {
    void desktop?.invoke<AppInfo[]>("apps:list").then(setApps).catch(() => undefined);
    void desktop?.invoke<SiteInfo[]>("sites:list").then(setSites).catch(() => undefined);
  }, [builtSomething]);
  useEffect(() => { steps.current?.lastElementChild?.scrollIntoView({ block: "nearest" }); }, [run?.steps.length]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); if (editing && agents.length) setEditing(null); else onClose(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose, editing, agents.length]);
  const forget = (i: number) => agent && onSave({ ...agent, memory: agent.memory?.filter((_, n) => n !== i) });
  const [find, setFind] = useState("");
  const [folded, setFolded] = useState(false);
  const [wide, setWide] = useState(false);
  const choose = (id: string) => { setPicked(id); setEditing(null); };
  const waiting = agents.filter((a) => runs[a.id]?.ask);
  const working = agents.filter((a) => runs[a.id]?.status === "working").length;
  const match = (text: string) => !find.trim() || text.toLowerCase().includes(find.trim().toLowerCase());
  const sections: SideSection[] = [
    { label: "Crew", items: agents.filter((a) => match(`${a.name} ${a.role}`)).map((a) => {
      const r = runs[a.id];
      return { id: a.id, label: a.name, on: a.id === picked && !editing, hint: r?.ask ? "Needs you" : r?.status === "working" ? "Working" : rankOf(a.xp),
        icon: <AgentAvatar hue={a.hue} order={a.order} mood={moodOf(a, r)} size={24} />, badge: r?.ask ? "!" : r?.status === "working" ? r.steps.length : undefined, onClick: () => choose(a.id) };
    }) },
    { label: "Artifacts", items: apps.filter((x) => x.kind === "artifact" && match(x.title)).map((x) => ({ id: x.id, label: x.title, hint: `Made by ${x.agent}`, icon: <Glyph d={GLYPHS.star} />, onClick: () => onOpenApp(x.id, x.title) })) },
    { label: "Websites", items: sites.filter((x) => match(x.name)).map((x) => ({ id: x.url, label: x.name, hint: x.url, icon: <Glyph d={GLYPHS.link} />, onClick: () => onOpenUrl(x.url, x.name) })) },
    { label: "Built apps", items: apps.filter((x) => x.kind !== "artifact" && match(x.title)).map((x) => ({ id: x.id, label: x.title, hint: `Built by ${x.agent}`, icon: <Glyph d={GLYPHS.app} />, onClick: () => onOpenApp(x.id, x.title) })) },
    { label: "General", items: [
      { id: "summon", label: "Summon an agent", icon: <Glyph d={GLYPHS.plus} />, act: true, on: !!editing && !agents.some((a) => a.id === editing.id), onClick: () => setEditing(fresh()) },
      { id: "settings", label: "Models and keys", icon: <Glyph d={GLYPHS.gear} />, act: true, onClick: onSettings },
      { id: "close", label: "Leave the station", icon: <Glyph d={GLYPHS.out} />, act: true, onClick: onClose },
    ] },
  ];

  return (
    <aside className={`deck ${wide ? "is-wide" : ""}`} role="dialog" aria-label="Agent Station" data-ui>
      <Sidebar title="Agent Station" alerts={waiting.length} onAlerts={() => waiting[0] && choose(waiting[0].id)} collapsed={folded} onCollapse={setFolded} onClose={onClose} onWide={() => setWide((w) => !w)}
        who={{ icon: <Logo />, name: "Your crew", detail: agents.length ? `${agents.length} agent${agents.length === 1 ? "" : "s"}${working ? ` · ${working} working` : ""}` : "Bring your first agent aboard", onClick: () => setEditing(fresh()) }}
        search={{ value: find, placeholder: "Search the crew", onChange: setFind }} sections={sections} />
      <div className="deck__main">
      {brains && !ready && <ConnectGate brains={brains} onRefresh={refresh} onSettings={onSettings} />}
      <div className="deck__body">
        <div className="deck__stage">
          <div className="deck__top">
            <DeployBar agents={agents} runs={runs} brains={brains ?? []} onDeploy={(a, task) => { choose(a.id); onStart(a, task); }} onNew={(a) => { onSave(a); setPicked(a.id); onStart(a); }} />
            <div className="deck__views" role="tablist" aria-label="View">
              <button role="tab" aria-selected={view === "board"} className={view === "board" ? "is-on" : ""} onClick={() => setView("board")}>Board</button>
              <button role="tab" aria-selected={view === "bridge"} className={view === "bridge" ? "is-on" : ""} onClick={() => setView("bridge")}>Bridge</button>
            </div>
          </div>
          {view === "board"
            ? <Board agents={agents} runs={runs} picked={picked} onPick={choose} onStart={(a) => onStart(a)} onStop={onStop} />
            : <AgentStage agents={agents} runs={runs} picked={picked} reduced={reduced} onPick={(id) => { setPicked(id); setEditing(null); }} />}
          {editing && <Summon key={editing.id} agent={editing.model ? editing : { ...editing, provider: brains?.find((b) => b.ready)?.id ?? "", model: brains?.find((b) => b.ready)?.models[0]?.id ?? "" }} isNew={!agents.some((a) => a.id === editing.id)} brains={brains ?? []} onCancel={() => setEditing(null)} onSave={(a) => { onSave(a); setPicked(a.id); setEditing(null); }}
            onDelete={agents.some((a) => a.id === editing.id) ? () => { onDelete(editing.id); setEditing(null); setPicked(null); } : undefined} />}
        </div>
        <section className="deck__side" style={{ ["--hue" as string]: agent?.hue ?? 205 }}>
          {agent ? (
            <>
              <div className="deck__who">
                <AgentAvatar hue={agent.hue} order={agent.order} mood={moodOf(agent, run)} size={56} />
                <div><h3>{agent.name}</h3><p>{rankOf(agent.xp)} · {agent.model}{isLocal(agent) ? " · free" : ""}</p></div>
                <button className="deck__btn" onClick={() => setEditing(agent)}>Edit</button>
                {run?.status === "working"
                  ? <button className="deck__btn" onClick={() => onStop(agent.id)}>Stop</button>
                  : <button className="deck__btn deck__btn--go" disabled={!runnable(agent)} title={runnable(agent) ? undefined : "Its model isn't connected. Press Edit to choose another."} onClick={() => onStart(agent)}>Run</button>}
              </div>
              <p className="deck__task">{run?.task ?? agent.task}{agent.schedule && <small className="deck__when">{scheduleText(agent.schedule)}</small>}</p>
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
      </div>
    </aside>
  );
}
