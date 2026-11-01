// The desktop app's own sheets: Library (history, bookmarks, downloads), Settings (keys, default browser,
// updates) and the prompt a page triggers when it asks for the camera, microphone, location or notifications.
import { useEffect, useState } from "react";
import { desktop, type AppInfo, type Download, type HistoryEntry, type PermissionAsk } from "../lib/desktop.ts";

export type LibraryTab = "history" | "bookmarks" | "downloads";

const Close = ({ onClose }: { onClose: () => void }) => (
  <button className="icon-btn" onClick={onClose} aria-label="Close" autoFocus>
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
  </button>
);

const when = (t: number) => {
  const d = new Date(t);
  const today = new Date().toDateString() === d.toDateString();
  return today ? d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
};
const size = (n: number) => (n > 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);

export function LibrarySheet({ tab, downloads, onTab, onOpen, onClose }: { tab: LibraryTab; downloads: Download[]; onTab: (t: LibraryTab) => void; onOpen: (url: string) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<HistoryEntry[]>([]);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    if (tab === "history") void desktop?.invoke<HistoryEntry[]>("history:search", q).then((r) => { if (alive) setItems(r); });
    if (tab === "bookmarks") void desktop?.invoke<HistoryEntry[]>("bookmarks:list").then((r) => { if (alive) setItems(r.filter((b) => !q || `${b.title} ${b.url}`.toLowerCase().includes(q.toLowerCase()))); });
    return () => { alive = false; };
  }, [tab, q, tick]);

  return (
    <aside className="sheet sheet--library" data-ui role="dialog" aria-label="Library" onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } }}>
      <header className="sheet__head">
        <div><p className="sheet__kicker">Kept on this computer</p><h2 className="sheet__title">Library</h2></div>
        <Close onClose={onClose} />
      </header>
      <div className="tabs" role="tablist">
        {(["history", "bookmarks", "downloads"] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={`tabs__tab ${tab === t ? "is-on" : ""}`} onClick={() => onTab(t)}>{t[0].toUpperCase() + t.slice(1)}</button>
        ))}
      </div>
      {tab !== "downloads" && <input className="library__search" type="search" placeholder={`Search ${tab}`} aria-label={`Search ${tab}`} value={q} onChange={(e) => setQ(e.target.value)} />}
      {tab !== "downloads" ? (
        <ul className="library__list">
          {!items.length && <li className="fine">{tab === "history" ? (q ? "Nothing matches." : "Pages you visit appear here. Private windows are never kept.") : "Press the star in a window's address to keep a page here."}</li>}
          {items.map((h) => (
            <li key={`${h.url}${h.at}`} className="library__item">
              <button className="library__open" onClick={() => onOpen(h.url)}>
                <span className="library__title">{h.title}</span>
                <span className="library__url">{h.url.replace(/^https?:\/\//, "")}</span>
              </button>
              <span className="library__when">{when(h.at)}</span>
              <button className="icon-btn icon-btn--small" aria-label={`Remove ${h.title}`} onClick={() => void desktop?.invoke(tab === "history" ? "history:remove" : "bookmarks:toggle", h.url, h.title).then(() => setTick((n) => n + 1))}>×</button>
            </li>
          ))}
        </ul>
      ) : (
        <ul className="library__list">
          {!downloads.length && <li className="fine">Files you download appear here. They are saved to your Downloads folder.</li>}
          {downloads.map((d) => (
            <li key={d.id} className="library__item">
              <button className="library__open" disabled={d.state !== "completed"} onClick={() => void desktop?.invoke("downloads:open", d.path)}>
                <span className="library__title">{d.name}</span>
                <span className="library__url">{d.state === "progressing" ? `${size(d.received)}${d.total ? ` of ${size(d.total)}` : ""}` : d.state === "completed" ? size(d.total || d.received) : d.state === "cancelled" ? "Cancelled" : "Failed"}</span>
                {d.state === "progressing" && d.total > 0 && <span className="library__bar"><i style={{ width: `${(d.received / d.total) * 100}%` }} /></span>}
              </button>
              {d.state === "progressing"
                ? <button className="btn btn--small btn--quiet" onClick={() => void desktop?.invoke("downloads:cancel", d.id)}>Cancel</button>
                : d.state === "completed" && <button className="btn btn--small btn--quiet" onClick={() => void desktop?.invoke("downloads:show", d.path)}>Show</button>}
            </li>
          ))}
        </ul>
      )}
      <footer className="sheet__actions">
        {tab === "history" && <button className="btn btn--small btn--danger" onClick={() => { if (confirm("Clear all browsing history and the page cache?")) void desktop?.invoke("history:clear").then(() => setTick((n) => n + 1)); }}>Clear history</button>}
        {tab === "downloads" && <button className="btn btn--small" onClick={() => void desktop?.invoke("downloads:folder")}>Open Downloads folder</button>}
      </footer>
    </aside>
  );
}

const AI = [
  { id: "anthropic", label: "Anthropic", key: "ANTHROPIC_API_KEY", url: "https://console.anthropic.com/settings/keys", note: "Claude models. Paid per use; billed by Anthropic." },
  { id: "openai", label: "OpenAI", key: "OPENAI_API_KEY", url: "https://platform.openai.com/api-keys", note: "GPT models. Paid per use; billed by OpenAI." },
  { id: "openrouter", label: "OpenRouter", key: "OPENROUTER_API_KEY", url: "https://openrouter.ai/keys", note: "Many models from one key, including free ones." },
  { id: "groq", label: "Groq", key: "GROQ_API_KEY", url: "https://console.groq.com/keys", note: "Fast open models; has a free tier." },
  { id: "gemini", label: "Gemini", key: "GEMINI_API_KEY", url: "https://aistudio.google.com/apikey", note: "Has a free tier; Google may use free-tier data to improve its products." },
  { id: "ollama", label: "Ollama, on this computer", key: "", url: "https://ollama.com/download", note: "Free and private: nothing leaves your computer. Needs the Ollama app and a downloaded model." },
  { id: "ollama-cloud", label: "Ollama Cloud", key: "OLLAMA_API_KEY", url: "https://ollama.com/settings/keys", note: "Open models on Ollama's computers, so yours can be small. See its plans at ollama.com/pricing." },
  { id: "lmstudio", label: "LM Studio, on this computer", key: "", url: "https://lmstudio.ai", note: "Free and private. Start LM Studio's local server first." },
] as const;

const VOICE_CHOICES = [["", "Automatic", ""], ["openai", "Whisper · OpenAI", "OPENAI_API_KEY"], ["groq", "Whisper · Groq", "GROQ_API_KEY"], ["gemini", "Gemini", "GEMINI_API_KEY"]] as const;

const ENGINE_CHOICES = [["google", "Google"], ["bing", "Bing"], ["duckduckgo", "DuckDuckGo"], ["off", "Off"]] as const;

const SEARCH: { name: string; label: string; help: string; url: string }[] = [
  { name: "BRAVE_API_KEY", label: "Brave Search", help: "An independent index of the whole web, with forums and news. Free plan available.", url: "https://brave.com/search/api/" },
  { name: "TAVILY_API_KEY", label: "Tavily", help: "Web search made for research, with readable extracts. 1,000 free searches a month.", url: "https://app.tavily.com/" },
];

const open = (url: string) => (e: React.MouseEvent) => { e.preventDefault(); void desktop?.invoke("app:openExternal", url); };

const PAGES = [
  { id: "ai", label: "AI and Claude", tint: "#c8743c", icon: "M12 3.5l1.9 4.6 4.6 1.9-4.6 1.9L12 16.5l-1.9-4.6L5.5 10l4.6-1.9Z" },
  { id: "search", label: "Search", tint: "#0a84ff", icon: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14ZM16 16l4.5 4.5" },
  { id: "voice", label: "Voice", tint: "#ff375f", icon: "M12 4a2.5 2.5 0 0 0-2.5 2.5v5a2.5 2.5 0 0 0 5 0v-5A2.5 2.5 0 0 0 12 4ZM6 11.5a6 6 0 0 0 12 0M12 17.5V21" },
  { id: "privacy", label: "Shields", tint: "#30a46c", icon: "M12 3l7 3v5c0 4.6-3 8-7 10-4-2-7-5.4-7-10V6Z" },
  { id: "general", label: "General", tint: "#8e8e93", icon: "M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7ZM12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" },
] as const;

export function SettingsSheet({ onClose }: { onClose: () => void }) {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [provider, setProvider] = useState<string>("anthropic");
  const [aiKey, setAiKey] = useState("");
  const [models, setModels] = useState<{ id: string; name: string }[] | null>(null);
  const [model, setModel] = useState("");
  const [checking, setChecking] = useState(false);
  const [aiError, setAiError] = useState("");
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [searx, setSearx] = useState<string | null>(null);
  const [contact, setContact] = useState<string | null>(null);
  const [saved, setSaved] = useState("");
  const [page, setPage] = useState<(typeof PAGES)[number]["id"]>("ai");
  useEffect(() => {
    void desktop?.invoke<AppInfo>("app:info").then((i) => {
      setInfo(i);
      const current = i.config.LLM_PROVIDER ?? AI.find((a) => a.key && i.keys[a.key])?.id;
      if (current) setProvider(current);
      if (i.config.LLM_MODEL) setModel(i.config.LLM_MODEL);
    });
  }, []);
  // Escape closes the sheet wherever focus is (a button that becomes disabled drops focus to the page).
  useEffect(() => {
    const on = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", on, true);
    return () => window.removeEventListener("keydown", on, true);
  }, [onClose]);
  const p = AI.find((a) => a.id === provider) ?? AI[0];
  const connected = info ? (info.config.LLM_PROVIDER ? AI.find((a) => a.id === info.config.LLM_PROVIDER && (!a.key || info.keys[a.key])) : AI.find((a) => a.key && info.keys[a.key])) : undefined;

  const check = async () => {
    setChecking(true);
    setAiError("");
    const r = await desktop!.invoke<{ models?: { id: string; name: string }[]; error?: string }>("ai:models", provider, aiKey);
    setChecking(false);
    if (r.error || !r.models) { setModels(null); setAiError(r.error ?? "No models were listed."); return; }
    setModels(r.models);
    if (!r.models.some((m) => m.id === model)) setModel(r.models[0]?.id ?? "");
  };
  const apply = async (keys: Record<string, string>, config?: Record<string, string>, note = "Saved. In use now.") => {
    const k = await desktop!.invoke<Record<string, boolean>>("app:setKeys", keys, contact ?? undefined, config);
    const fresh = await desktop!.invoke<AppInfo>("app:info");
    setInfo({ ...fresh, keys: k });
    setSaved(note);
  };
  /** One step: the key is checked, the best model is chosen, and it's in use. Models can be changed afterwards. */
  const connect = async () => {
    setChecking(true);
    setAiError("");
    const r = await desktop!.invoke<{ models?: { id: string; name: string }[]; error?: string }>("ai:models", provider, aiKey);
    setChecking(false);
    if (r.error || !r.models?.length) { setAiError(r.error ?? "No models were listed."); return; }
    const best = r.models.find((m) => m.id === model) ?? r.models.find((m) => m.id === "claude-opus-5-5") ?? r.models[0];
    await apply(aiKey && p.key ? { [p.key]: aiKey } : {}, { LLM_PROVIDER: provider, LLM_MODEL: best.id }, `Connected to ${p.label} · ${best.name}.`);
    setModel(best.id);
    setModels(r.models);
    setAiKey("");
  };
  const pickModel = (id: string) => { setModel(id); void apply({}, { LLM_PROVIDER: provider, LLM_MODEL: id }, `Using ${id}.`); };
  const disconnect = () => connected && void apply(connected.key ? { [connected.key]: "" } : {}, { LLM_PROVIDER: "", LLM_MODEL: "" }, `${connected.label} disconnected. Warpnaut works without AI.`).then(() => setModel(""));

  const save = () => void apply(Object.fromEntries(Object.entries(draft).filter(([, v]) => v)), searx !== null ? { SEARXNG_URL: searx } : undefined).then(() => { setDraft({}); setSearx(null); });
  const dirty = Object.values(draft).some(Boolean) || contact !== null || searx !== null;

  return (
    <div className="scrim" data-ui onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <section className="prefs" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <nav className="prefs__side" aria-label="Settings">
          <h2 className="prefs__title" id="settings-title">Settings</h2>
          {PAGES.map((x) => (
            <button key={x.id} className={`prefs__item ${page === x.id ? "is-on" : ""}`} aria-current={page === x.id ? "page" : undefined} onClick={() => { setPage(x.id); setSaved(""); }}>
              <span className="prefs__tile" style={{ background: x.tint }}><svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill="none" stroke="#fff" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d={x.icon} /></svg></span>
              {x.label}
            </button>
          ))}
          <p className="prefs__version">Warpnaut {info?.version}</p>
        </nav>
        <div className="prefs__main">
          <header className="prefs__head">
            <h3>{PAGES.find((x) => x.id === page)?.label}</h3>
            <Close onClose={onClose} />
          </header>
          {saved && <p className="prefs__saved" role="status">{saved}</p>}

          {page === "ai" && <>
            <div className="group">
              <div className="group__row">
                <span>Status</span>
                <span className={connected ? "group__ok" : "group__dim"}>{connected ? `${connected.label}${info?.config.LLM_MODEL ? ` · ${info.config.LLM_MODEL}` : ""}` : "Not connected"}</span>
                {connected && <button className="btn btn--small" onClick={disconnect}>Disconnect</button>}
              </div>
              <div className="group__row">
                <span>Provider</span>
                <select value={provider} aria-label="AI provider" onChange={(e) => { setProvider(e.target.value); setModels(null); setAiError(""); }}>
                  {AI.map((a) => <option key={a.id} value={a.id}>{a.label}{info?.keys[a.key] ? " ✓" : ""}</option>)}
                </select>
              </div>
              {p.key && <label className="group__row">
                <span>API key</span>
                <input type="password" autoComplete="off" spellCheck={false} placeholder={info?.keys[p.key] ? "Saved ••••••••" : "Paste your key"} value={aiKey} onChange={(e) => { setAiKey(e.target.value); setSaved(""); setAiError(""); }} />
              </label>}
              {models && (
                <div className="group__row">
                  <span>Model</span>
                  <select value={model} aria-label="Model" onChange={(e) => pickModel(e.target.value)}>
                    {models.map((m) => <option key={m.id} value={m.id}>{m.name !== m.id ? `${m.name}` : m.id}</option>)}
                  </select>
                </div>
              )}
            </div>
            <div className="prefs__actions">
              {aiError && <span className="fine fine--error" role="alert">{aiError}</span>}
              {(!p.key || info?.keys[p.key]) && !aiKey && !models && <button className="btn" disabled={checking} onClick={() => void check()}>{checking ? "Checking…" : "Choose model"}</button>}
              <button className="btn btn--primary" disabled={checking || (!!p.key && !aiKey && !info?.keys[p.key])} onClick={() => void connect()}>{checking ? "Checking…" : `Connect ${p.label}`}</button>
            </div>
            <p className="group__note">{p.note} {p.key ? <>A key is separate from a ChatGPT or Claude subscription: <a href={p.url} onClick={open(p.url)}>create one with {p.label}</a>.</> : <a href={p.url} onClick={open(p.url)}>Get {p.label}</a>} {p.key && <>It's encrypted with your system keychain and sent only to {p.label}.</>} This model powers research maps, the assistant and file reading. Each agent chooses its own.</p>
          </>}

          {page === "search" && <>
            <p className="group__title">Search engine</p>
            <div className="seg" role="radiogroup" aria-label="Search engine">
              {ENGINE_CHOICES.map(([id, label]) => {
                const on = (info?.config.WARPNAUT_SEARCH_ENGINE || "google") === id;
                return <button key={id} role="radio" aria-checked={on} className={`seg__opt ${on ? "is-on" : ""}`} onClick={() => void apply({}, { WARPNAUT_SEARCH_ENGINE: id }, id === "off" ? "Search in the browser is off." : `Searching with ${label}.`)}>{label}</button>;
              })}
            </div>
            <p className="group__note">Your engine's results page opens beside the map, as if you had searched yourself. If it asks you something first, its window stays in front for you to answer. Off: Warpnaut uses the services below and open sources only.</p>
            <p className="group__title">Search services</p>
            <div className="group">
              {SEARCH.map((k) => (
                <label key={k.name} className="group__row">
                  <span>{k.label}{info?.keys[k.name] && <button className="link" onClick={(e) => { e.preventDefault(); void apply({ [k.name]: "" }, undefined, `${k.label} removed.`); }}> Remove</button>}</span>
                  <input type="password" autoComplete="off" spellCheck={false} placeholder={info?.keys[k.name] ? "Saved ••••••••" : "Not set"} value={draft[k.name] ?? ""} onChange={(e) => { setSaved(""); setDraft((d) => ({ ...d, [k.name]: e.target.value })); }} />
                </label>
              ))}
              <label className="group__row">
                <span>SearXNG address</span>
                <input placeholder="https://searx.example.org" value={searx ?? info?.config.SEARXNG_URL ?? ""} onChange={(e) => { setSaved(""); setSearx(e.target.value); }} />
              </label>
              <label className="group__row">
                <span>YouTube Data API key</span>
                <input type="password" autoComplete="off" spellCheck={false} placeholder={info?.keys.YOUTUBE_API_KEY ? "Saved ••••••••" : "Not set"} value={draft.YOUTUBE_API_KEY ?? ""} onChange={(e) => { setSaved(""); setDraft((d) => ({ ...d, YOUTUBE_API_KEY: e.target.value })); }} />
              </label>
              <label className="group__row">
                <span>Contact for open data</span>
                <input placeholder="you@example.com" value={contact ?? info?.contact ?? ""} onChange={(e) => { setSaved(""); setContact(e.target.value); }} />
              </label>
            </div>
            <div className="prefs__actions"><button className="btn btn--primary" disabled={!dirty} onClick={save}>Save</button></div>
            <p className="group__note">{SEARCH.map((k, i) => <span key={k.name}>{i ? " · " : ""}<a href={k.url} onClick={open(k.url)}>Get a {k.label} key</a></span>)}. Wikipedia and OpenStreetMap ask apps to say who they are; the contact is sent to them, nowhere else.</p>
          </>}

          {page === "voice" && <>
            <p className="group__title">Speech to text</p>
            <div className="seg" role="radiogroup" aria-label="Speech to text">
              {VOICE_CHOICES.map(([id, label, key]) => {
                const on = (info?.config.WARPNAUT_VOICE || "") === id;
                return <button key={id} role="radio" aria-checked={on} disabled={!!key && !info?.keys[key]} title={key && !info?.keys[key] ? "Add this key under AI and Claude first" : undefined} className={`seg__opt ${on ? "is-on" : ""}`} onClick={() => void apply({}, { WARPNAUT_VOICE: id }, `Voice: ${label}.`)}>{label}</button>;
              })}
            </div>
            <p className="group__note">Press ⌘⇧Space from any app and say one thing: four agents search, open, read and write for you. Automatic uses the first key you have: OpenAI's Whisper, then Groq's Whisper, then Gemini. Claude has no speech to text, so voice needs one of those keys; dictation apps such as Wispr Flow also work.</p>
          </>}

          {page === "privacy" && <Shields />}

          {page === "general" && (
            <div className="group">
              <div className="group__row">
                <span>Default browser</span>
                {info?.isDefault ? <span className="group__ok">Warpnaut opens your links</span> : <button className="btn btn--small" onClick={() => void desktop?.invoke<boolean>("app:setDefault").then((isDefault) => setInfo((i) => (i ? { ...i, isDefault } : i)))}>Make default</button>}
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

const WHAT: Record<string, string> = {
  media: "use your camera or microphone", geolocation: "know your location", notifications: "show notifications", "clipboard-read": "read your clipboard",
  midi: "use MIDI devices", midiSysex: "use MIDI devices", "idle-detection": "know when you're idle", "window-management": "manage windows on your screens", "display-capture": "see your screen",
};

export function PermissionPrompt({ ask, onAnswer }: { ask: PermissionAsk; onAnswer: (ok: boolean) => void }) {
  const what = ask.permission === "media" && ask.media?.length
    ? `use your ${ask.media.map((m) => (m === "video" ? "camera" : "microphone")).join(" and ")}`
    : WHAT[ask.permission] ?? `use ${ask.permission}`;
  return (
    <div className="permission" data-ui role="alertdialog" aria-labelledby="perm-text">
      <p id="perm-text"><strong>{ask.origin.replace(/^https?:\/\//, "")}</strong> wants to {what}.</p>
      <div className="sheet__row">
        <button className="btn btn--small btn--primary" onClick={() => onAnswer(true)}>Allow</button>
        <button className="btn btn--small" onClick={() => onAnswer(false)} autoFocus>Block</button>
      </div>
    </div>
  );
}

/** The Shields section of Settings. */
function Shields() {
  const [s, setS] = useState<{ on: boolean; ready: boolean; blocked: number; allowed: string[] } | null>(null);
  const load = () => void desktop?.invoke<typeof s>("shields:status").then(setS);
  useEffect(load, []);
  if (!s) return null;
  const set = (on: boolean) => void desktop?.invoke("app:setKeys", {}, undefined, { WARPNAUT_SHIELDS: on ? "" : "off" }).then(load);
  return (
    <>
      <div className="group">
        <label className="group__row">
          <span>Protect every page</span>
          <input className="switch" type="checkbox" role="switch" checked={s.on} onChange={(e) => set(e.target.checked)} />
        </label>
        <div className="group__row">
          <span>Status</span>
          <span className="group__dim">{s.on ? (s.ready ? `${s.blocked.toLocaleString()} blocked since Warpnaut started` : "Getting the block lists ready…") : "Off"}</span>
        </div>
        {s.allowed.length > 0 && <div className="group__row"><span>Off for</span><span className="group__dim">{s.allowed.join(", ")}</span></div>}
      </div>
      <p className="group__note">Free and open source: blocks ads, trackers and known malware addresses (Ghostery's engine with community lists), moves pages to https, removes tracking tags from links, asks sites not to sell your data, and hides your local network address from WebRTC.</p>
    </>
  );
}
