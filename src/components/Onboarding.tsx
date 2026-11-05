// The first thing after installing: a short setup, every step skippable and changeable later in Settings. A mind for
// AetherDeck (the person's ChatGPT plan, a key, or free on this computer), Google (signed in on Google's own page, in
// a window; AetherDeck never sees the password), a search engine, the sites in the dock, a room for the 360° view,
// and privacy. Nothing is sent anywhere until the person chooses it.
import { useEffect, useState } from "react";
import { desktop } from "../lib/desktop.ts";
import { siteItem, type DockItem } from "../lib/dock.ts";
import { SKIES, chooseSky, chosenSky, type SkyId } from "../lib/roomSky.ts";
import { AI_CHOICES, ChatGPTPlan } from "./DesktopSheets.tsx";
import { LogoDust } from "./Logo.tsx";

const DONE = "aetherdeck.welcomed";
export const welcomed = () => { try { return localStorage.getItem(DONE) === "1"; } catch { return true; } };
export const welcomeAgain = () => { try { localStorage.removeItem(DONE); } catch { /* nothing kept */ } };

const SIGN_IN = "https://accounts.google.com/ServiceLogin?continue=https%3A%2F%2Fwww.youtube.com%2Fsignin%3Faction_handle_signin%3Dtrue%26next%3D%252F";
const SITES: [string, string][] = [
  ["YouTube", "https://www.youtube.com/"], ["Gmail", "https://mail.google.com/"], ["Google Docs", "https://docs.google.com/"], ["Spotify", "https://open.spotify.com/"],
  ["Facebook", "https://www.facebook.com/"], ["Instagram", "https://www.instagram.com/"], ["X", "https://x.com/"], ["LinkedIn", "https://www.linkedin.com/"],
  ["Notion", "https://www.notion.so/"], ["Canva", "https://www.canva.com/"], ["ChatGPT", "https://chatgpt.com/"], ["GitHub", "https://github.com/"],
];
const ENGINES = [["google", "Google", "What most people use"], ["bing", "Bing", "Microsoft's search"], ["duckduckgo", "DuckDuckGo", "Doesn't track your searches"]] as const;
const STEPS = ["Welcome", "AI", "Google", "Search", "Your dock", "Room", "Privacy"];

interface Props {
  dock: DockItem[];
  onDock: (d: DockItem[]) => void;
  history: boolean;
  onHistory: (on: boolean) => void;
  onOpen: (url: string, title: string) => void;
  onDone: () => void;
}

export function Onboarding({ dock, onDock, history, onHistory, onOpen, onDone }: Props) {
  const [step, setStep] = useState(0);
  const [parked, setParked] = useState(false); // the Google window is up; setup waits in a pill
  const [google, setGoogle] = useState(false);
  const [engine, setEngine] = useState("google");
  const [provider, setProvider] = useState<string>("gemini");
  const [key, setKey] = useState("");
  const [aiNote, setAiNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [sky, setSky] = useState<SkyId>(chosenSky());
  const [isDefault, setIsDefault] = useState<boolean | null>(null);

  useEffect(() => {
    void desktop?.invoke<{ config: Record<string, string>; isDefault: boolean }>("app:info").then((i) => { if (i.config.AETHERDECK_SEARCH_ENGINE) setEngine(i.config.AETHERDECK_SEARCH_ENGINE); setIsDefault(i.isDefault); });
    void desktop?.invoke<{ google: boolean }>("account:google").then((a) => setGoogle(!!a?.google));
  }, [parked]);

  const finish = () => { try { localStorage.setItem(DONE, "1"); } catch { /* asked again next time */ } onDone(); };
  const next = () => (step === STEPS.length - 1 ? finish() : setStep(step + 1));
  const p = AI_CHOICES.find((a) => a.id === provider) ?? AI_CHOICES[0];

  async function connectKey() {
    setBusy(true); setAiNote("");
    const r = await desktop!.invoke<{ models?: { id: string; name: string }[]; error?: string }>("ai:models", provider, key);
    if (r.error || !r.models?.length) { setBusy(false); setAiNote(r.error ?? "No models were listed for that key."); return; }
    await desktop!.invoke("app:setKeys", p.key && key ? { [p.key]: key } : {}, undefined, { LLM_PROVIDER: provider, LLM_MODEL: r.models[0].id });
    setBusy(false); setKey(""); setAiNote(`Connected: ${p.label}, ${r.models[0].name}.`);
  }
  const pickEngine = (id: string) => { setEngine(id); void desktop?.invoke("app:setKeys", {}, undefined, { AETHERDECK_SEARCH_ENGINE: id }); };
  const hasSite = (url: string) => dock.some((d) => d.url === url);
  const toggleSite = (label: string, url: string) => {
    if (hasSite(url)) return onDock(dock.filter((d) => d.url !== url));
    const it = siteItem(url, label);
    if (!it) return;
    const firstTool = dock.findIndex((d) => d.action);
    onDock(firstTool < 0 ? [...dock, it] : [...dock.slice(0, firstTool), it, ...dock.slice(firstTool)]);
  };

  if (parked) {
    return (
      <div className="onb-pill" data-ui role="status">
        <span>{google ? "Signed in to Google." : "Sign in on Google's page, then come back."}</span>
        <button className="deck__btn deck__btn--go" onClick={() => { setParked(false); setStep(3); }}>Continue setup</button>
      </div>
    );
  }

  return (
    <div className="onb" data-ui role="dialog" aria-modal="true" aria-label="Set up AetherDeck" data-keys>
      <div className="onb__card">
        <ol className="onb__steps" aria-label="Steps">{STEPS.map((s, i) => <li key={s} className={i === step ? "is-on" : i < step ? "is-past" : ""} aria-current={i === step ? "step" : undefined}>{s}</li>)}</ol>

        {step === 0 && (
          <section className="onb__body onb__hello">
            <LogoDust width={150} />
            <h1>Welcome to AetherDeck</h1>
            <p className="onb__lead">The exploratory browser, with Cosmonaut. A minute of setup and it's yours.</p>
            <ul className="onb__promises">
              <li><b>Yours.</b> Open source, on your computer. No account with us, no tracking, nothing sold.</li>
              <li><b>Your AI.</b> Use your ChatGPT plan, your own key, or a free model on this computer.</li>
              <li><b>Your say.</b> Agents ask before anything that posts, sends, buys or signs in.</li>
            </ul>
          </section>
        )}

        {step === 1 && (
          <section className="onb__body">
            <h2>Give AetherDeck a mind</h2>
            <p className="onb__lead">It answers your questions, maps research and runs your agents. Pick one now; you can add more later.</p>
            <ChatGPTPlan />
            <div className="group onb__key">
              <div className="group__row">
                <span>Or an API key</span>
                <select value={provider} onChange={(e) => { setProvider(e.target.value); setAiNote(""); }} aria-label="Provider">{AI_CHOICES.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}</select>
              </div>
              {p.key && <label className="group__row"><span>Key</span><input type="password" autoComplete="off" spellCheck={false} placeholder="Paste your key" value={key} onChange={(e) => setKey(e.target.value)} /></label>}
              <p className="onb__fine">{p.note} {p.key ? "Kept encrypted by your system keychain." : ""}</p>
              <div className="onb__connect"><button className="btn btn--small btn--primary" disabled={busy || (!!p.key && !key)} onClick={() => void connectKey()}>{busy ? "Checking…" : `Connect ${p.label}`}</button></div>
              {aiNote && <p className="onb__note" role="status">{aiNote}</p>}
            </div>
          </section>
        )}

        {step === 2 && (
          <section className="onb__body">
            <h2>Sign in to Google</h2>
            <p className="onb__lead">One sign-in covers YouTube, Gmail, Docs and Drive, so you and your agents can use them. Google's own page opens in a window: you sign in there, and AetherDeck never sees your password.</p>
            {google
              ? <p className="onb__ok">You're signed in to Google.</p>
              : <button className="btn btn--primary onb__big" onClick={() => { onOpen(SIGN_IN, "Sign in to Google"); setParked(true); }}>Sign in with Google</button>}
          </section>
        )}

        {step === 3 && (
          <section className="onb__body">
            <h2>Your search engine</h2>
            <p className="onb__lead">Questions are mapped from what your engine finds, read off its page as you'd see it.</p>
            <div className="onb__choices">{ENGINES.map(([id, label, about]) => <button key={id} className={`onb__choice ${engine === id ? "is-on" : ""}`} aria-pressed={engine === id} onClick={() => pickEngine(id)}><b>{label}</b><small>{about}</small></button>)}</div>
          </section>
        )}

        {step === 4 && (
          <section className="onb__body">
            <h2>Your dock</h2>
            <p className="onb__lead">The sites you use most, one click away. Drag to reorder them any time.</p>
            <div className="onb__sites">{SITES.map(([label, url]) => <button key={url} className={`onb__site ${hasSite(url) ? "is-on" : ""}`} aria-pressed={hasSite(url)} onClick={() => toggleSite(label, url)}>{label}</button>)}</div>
          </section>
        )}

        {step === 5 && (
          <section className="onb__body">
            <h2>A room for the 360° view</h2>
            <p className="onb__lead">Your tabs hang all around you in it. You can use your own 360° photo later.</p>
            <div className="onb__rooms">
              {SKIES.map((s) => (
                <button key={s.id} className={`onb__room ${sky === s.id ? "is-on" : ""}`} aria-pressed={sky === s.id} onClick={() => { chooseSky(s.id); setSky(s.id); }}>
                  {s.thumb ? <img src={s.thumb} alt="" /> : <span className={`onb__drawn onb__drawn--${s.id}`} />}<b>{s.label}</b>
                </button>
              ))}
            </div>
          </section>
        )}

        {step === 6 && (
          <section className="onb__body">
            <h2>Privacy, your way</h2>
            <label className="onb__toggle"><input type="checkbox" checked={history} onChange={(e) => onHistory(e.target.checked)} /><span><b>Keep my history</b><small>Off by default. When it's on, past searches can suggest what to explore next. Everything stays on this computer.</small></span></label>
            <div className="onb__toggle">
              <span><b>Make AetherDeck your default browser</b><small>Links from other apps open here.</small></span>
              {isDefault ? <span className="onb__ok">It is</span> : <button className="btn btn--small" onClick={() => void desktop?.invoke<boolean>("app:setDefault").then(setIsDefault)}>Make default</button>}
            </div>
          </section>
        )}

        <footer className="onb__foot">
          {step > 0 && <button className="btn" onClick={() => setStep(step - 1)}>Back</button>}
          <button className="btn btn--quiet" onClick={finish}>Skip setup</button>
          <button className="btn btn--primary" onClick={next}>{step === 0 ? "Let's set it up" : step === STEPS.length - 1 ? "Start exploring" : "Continue"}</button>
        </footer>
      </div>
    </div>
  );
}
