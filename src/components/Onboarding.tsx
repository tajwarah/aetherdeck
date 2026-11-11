// The first thing after installing: a short setup, every step skippable and changeable later in Settings. A local profile
// (a name and a picture, kept on this computer), a mind for AetherDeck (the person's ChatGPT plan, a key, or free on this
// computer), Google (signed in on Google's own page; AetherDeck never sees the password), a search engine, ad blocking, the
// sites in the dock, a tour of the Pod, bringing bookmarks and passwords from another browser, and the default browser.
// Nothing is sent anywhere until the person chooses it.
import { useEffect, useState } from "react";
import { desktop, roomBridge } from "../lib/desktop.ts";
import { webBridge } from "../lib/webSettings.ts";
import { loadProfile, saveProfile, AVATARS } from "../lib/profile.ts";
import { siteItem, type DockItem } from "../lib/dock.ts";
import { SKIES, chooseSky, chosenSky, type SkyId } from "../lib/roomSky.ts";
import { AI_CHOICES, ChatGPTPlan } from "./DesktopSheets.tsx";
import { LogoDust } from "./Logo.tsx";

const DONE = "aetherdeck.welcomed";
export const welcomed = () => { try { return localStorage.getItem(DONE) === "1"; } catch { return true; } };

const SIGN_IN = "https://accounts.google.com/ServiceLogin?continue=https%3A%2F%2Fwww.youtube.com%2Fsignin%3Faction_handle_signin%3Dtrue%26next%3D%252F";
const SITES: [string, string][] = [
  ["YouTube", "https://www.youtube.com/"], ["Gmail", "https://mail.google.com/"], ["Google Docs", "https://docs.google.com/"], ["Spotify", "https://open.spotify.com/"],
  ["Facebook", "https://www.facebook.com/"], ["Instagram", "https://www.instagram.com/"], ["X", "https://x.com/"], ["LinkedIn", "https://www.linkedin.com/"],
  ["Notion", "https://www.notion.so/"], ["Canva", "https://www.canva.com/"], ["ChatGPT", "https://chatgpt.com/"], ["GitHub", "https://github.com/"],
];
const ENGINES = [["google", "Google", "What most people use"], ["bing", "Bing", "Microsoft's search"], ["duckduckgo", "DuckDuckGo", "Doesn't track your searches"]] as const;
type StepId = "welcome" | "you" | "ai" | "google" | "search" | "ads" | "dock" | "sky" | "tour" | "import" | "finish";
/** AetherDeck for Mac (the browser) sets the browser's own things too: ads, importing, and a tour of the Pod it lives in. */
const MAC = !desktop && !!roomBridge;
const STEPS: [StepId, string][] = MAC
  ? [["welcome", "Welcome"], ["you", "You"], ["ai", "AI"], ["google", "Google"], ["search", "Search"], ["ads", "Ads"], ["dock", "Dock"], ["tour", "The Pod"], ["import", "Your stuff"], ["finish", "Finish"]]
  : [["welcome", "Welcome"], ["you", "You"], ["ai", "AI"], ["google", "Google"], ["search", "Search"], ["dock", "Your dock"], ["sky", "Pod"], ["finish", "Privacy"]];
/** Calls the desktop app, or in AetherDeck for Mac the browser (its own settings) or the local server (AI, keys). */
const BROWSER = new Set(["browser:status", "app:setDefault", "search:setDefault", "adblock:set", "import:open"]);
const call = <T,>(channel: string, ...args: unknown[]): Promise<T> =>
  desktop ? desktop.invoke<T>(channel, ...args) : roomBridge && BROWSER.has(channel) ? roomBridge.invoke<T>(channel, ...args) : webBridge.invoke<T>(channel, ...args);

interface Props {
  dock: DockItem[];
  onDock: (d: DockItem[]) => void;
  history: boolean;
  onHistory: (on: boolean) => void;
  onOpen: (url: string, title: string) => void;
  onDone: () => void;
}

export function Onboarding({ dock, onDock, history, onHistory, onOpen, onDone }: Props) {
  const [at, setStep] = useState(0);
  const step = STEPS[at][0];
  const [profile, setProfile] = useState(loadProfile);
  const [adblock, setAdblock] = useState<boolean | null>(null);
  const [imported, setImported] = useState("");
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
    if (MAC) void call<{ isDefault: boolean; adblock: boolean | null; engine: string }>("browser:status").then((b) => {
      setIsDefault(b.isDefault); setAdblock(b.adblock);
      const e = ENGINES.find(([, label]) => label === b.engine)?.[0]; if (e) setEngine(e);
    }).catch(() => undefined);
  }, [parked]);

  const finish = () => { saveProfile(profile); try { localStorage.setItem(DONE, "1"); } catch { /* asked again next time */ } onDone(); };
  const next = () => { if (step === "you") saveProfile(profile); if (at === STEPS.length - 1) finish(); else setStep(at + 1); };
  const p = AI_CHOICES.find((a) => a.id === provider) ?? AI_CHOICES[0];

  async function connectKey() {
    setBusy(true); setAiNote("");
    const r = await call<{ models?: { id: string; name: string }[]; error?: string }>("ai:models", provider, key);
    if (r.error || !r.models?.length) { setBusy(false); setAiNote(r.error ?? "No models were listed for that key."); return; }
    await call("app:setKeys", p.key && key ? { [p.key]: key } : {}, undefined, { LLM_PROVIDER: provider, LLM_MODEL: r.models[0].id });
    setBusy(false); setKey(""); setAiNote(`Connected: ${p.label}, ${r.models[0].name}.`);
  }
  const pickEngine = (id: string) => {
    setEngine(id);
    void call("app:setKeys", {}, undefined, { AETHERDECK_SEARCH_ENGINE: id }).catch(() => undefined);
    if (MAC) void call("search:setDefault", id).catch(() => undefined); // the address bar's engine too
  };
  const setAds = (on: boolean) => { setAdblock(on); void call<boolean | null>("adblock:set", on).then((r) => { if (r !== null) setAdblock(r); }).catch(() => undefined); };
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
        <button className="deck__btn deck__btn--go" onClick={() => { setParked(false); setStep(STEPS.findIndex(([id]) => id === "search")); }}>Continue setup</button>
      </div>
    );
  }

  return (
    <div className="onb" data-ui role="dialog" aria-modal="true" aria-label="Set up AetherDeck" data-keys>
      <div className="onb__card">
        <ol className="onb__steps" aria-label="Steps">{STEPS.map(([id, label], i) => <li key={id} className={i === at ? "is-on" : i < at ? "is-past" : ""} aria-current={i === at ? "step" : undefined}>{label}</li>)}</ol>

        {step === "welcome" && (
          <section className="onb__body onb__hello">
            <LogoDust width={150} />
            <h1>Welcome to AetherDeck</h1>
            <p className="onb__lead">{MAC ? "Your tabs, all around you in your pod, with Cosmonaut and a crew of agents. A minute of setup and it's yours." : "The exploratory browser, with Cosmonaut. A minute of setup and it's yours."}</p>
            <ul className="onb__promises">
              <li><b>Yours.</b> Open source, on your computer. No account with us, no tracking, nothing sold.</li>
              <li><b>Your AI.</b> Use your ChatGPT plan, your own key, or a free model on this computer.</li>
              <li><b>Your say.</b> Agents ask before anything that posts, sends, buys or signs in.</li>
            </ul>
          </section>
        )}

        {step === "you" && (
          <section className="onb__body">
            <h2>Who's flying?</h2>
            <p className="onb__lead">A name and a picture for your profile. They stay on this computer: there's no AetherDeck account and nothing is sent anywhere.</p>
            <label className="onb__name"><span>Your name</span><input value={profile.name} maxLength={40} placeholder="Your name" autoFocus onChange={(e) => setProfile({ ...profile, name: e.target.value })} /></label>
            <div className="onb__avatars" role="radiogroup" aria-label="Your picture">
              {AVATARS.map((a) => <button key={a} role="radio" aria-checked={profile.avatar === a} className={`onb__avatar ${profile.avatar === a ? "is-on" : ""}`} onClick={() => setProfile({ ...profile, avatar: a })}>{a}</button>)}
            </div>
          </section>
        )}

        {step === "ads" && (
          <section className="onb__body">
            <h2>Block ads and trackers?</h2>
            <p className="onb__lead">AetherDeck blocks ads, trackers and known malware sites by itself, with nothing to install (it's uBlock Origin, built in). Pages load faster and fewer companies follow you around.</p>
            <div className="onb__choices">
              <button className={`onb__choice ${adblock !== false ? "is-on" : ""}`} aria-pressed={adblock !== false} onClick={() => setAds(true)}><b>Yes, block them</b><small>Recommended. You can allow a site any time from the uBlock button.</small></button>
              <button className={`onb__choice ${adblock === false ? "is-on" : ""}`} aria-pressed={adblock === false} onClick={() => setAds(false)}><b>No, show ads</b><small>Turn it back on later in Add-ons.</small></button>
            </div>
            {adblock === null && <p className="onb__fine">The blocker is still being set up; your choice is applied when it's ready.</p>}
          </section>
        )}

        {step === "tour" && (
          <section className="onb__body">
            <h2>Life in your pod</h2>
            <p className="onb__lead">Your tabs hang on a curved ring all around you, like screens in a space pod.</p>
            <ul className="onb__tour">
              <li><b>Look around</b><span>Drag the view, swipe with two fingers, or use ← and →. Double-click the view or press ⌂ to come back to the pane you were using.</span></li>
              <li><b>Use any page</b><span>Click, type and scroll in any pane as usual. ⌘ + scroll zooms a pane; Shift + drag moves it; Fit fills the view with it.</span></li>
              <li><b>Tabs and pods</b><span>Every new tab joins the ring (up to 8). Sites you open together from the home, the map or the dock line up side by side.</span></li>
              <li><b>The dock</b><span>Your sites, Cosmonaut, Agents, Research and Files, one click away on the home pane.</span></li>
              <li><b>Keys</b><span>⌥⇧P steps in and out of the pod. The <b>Pod</b> button in the toolbar brings you back. Views changes what's outside your window.</span></li>
            </ul>
          </section>
        )}

        {step === "import" && (
          <section className="onb__body">
            <h2>Bring your stuff along</h2>
            <p className="onb__lead">Bookmarks, history and saved passwords from the browser you used before. It all stays on this computer.</p>
            <div className="onb__choices">
              <button className={`onb__choice ${imported === "" ? "is-on" : ""}`} aria-pressed={imported === ""} onClick={() => setImported("")}><b>Start fresh</b><small>Nothing to bring.</small></button>
              {([["safari", "Safari"], ["chrome", "Chrome"], ["firefox", "Firefox"]] as const).map(([id, label]) => (
                <button key={id} className={`onb__choice ${imported === id ? "is-on" : ""}`} aria-pressed={imported === id} onClick={() => { setImported(id); void call("import:open", id).catch(() => undefined); }}><b>From {label}</b><small>Opens the import window.</small></button>
              ))}
            </div>
          </section>
        )}

        {step === "ai" && (
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
              <p className="onb__fine">{p.note} {p.key ? (desktop ? "Kept encrypted by your system keychain." : "Kept in a private file on this computer.") : ""}</p>
              <div className="onb__connect"><button className="btn btn--small btn--primary" disabled={busy || (!!p.key && !key)} onClick={() => void connectKey()}>{busy ? "Checking…" : `Connect ${p.label}`}</button></div>
              {aiNote && <p className="onb__note" role="status">{aiNote}</p>}
            </div>
          </section>
        )}

        {step === "google" && (
          <section className="onb__body">
            <h2>Sign in to Google</h2>
            <p className="onb__lead">One sign-in covers YouTube, Gmail, Docs and Drive, so you and your agents can use them. Google's own page opens {MAC ? "in your pod" : "in a window"}: you type your email and password there, on Google's page, and AetherDeck never sees or keeps them.</p>
            {google
              ? <p className="onb__ok">You're signed in to Google.</p>
              : <button className="btn btn--primary onb__big" onClick={() => { onOpen(SIGN_IN, "Sign in to Google"); setParked(true); }}>Sign in with Google</button>}
          </section>
        )}

        {step === "search" && (
          <section className="onb__body">
            <h2>Your search engine</h2>
            <p className="onb__lead">Questions are mapped from what your engine finds, read off its page as you'd see it.</p>
            <div className="onb__choices">{ENGINES.map(([id, label, about]) => <button key={id} className={`onb__choice ${engine === id ? "is-on" : ""}`} aria-pressed={engine === id} onClick={() => pickEngine(id)}><b>{label}</b><small>{about}</small></button>)}</div>
          </section>
        )}

        {step === "dock" && (
          <section className="onb__body">
            <h2>Your dock</h2>
            <p className="onb__lead">The sites you use most, one click away. Drag to reorder them any time.</p>
            <div className="onb__sites">{SITES.map(([label, url]) => <button key={url} className={`onb__site ${hasSite(url) ? "is-on" : ""}`} aria-pressed={hasSite(url)} onClick={() => toggleSite(label, url)}>{label}</button>)}</div>
          </section>
        )}

        {step === "sky" && (
          <section className="onb__body">
            <h2>The view from your pod</h2>
            <p className="onb__lead">In the 360° pod your tabs hang all around you, with this view outside. You can use your own 360° photo later.</p>
            <div className="onb__rooms">
              {SKIES.map((s) => (
                <button key={s.id} className={`onb__room ${sky === s.id ? "is-on" : ""}`} aria-pressed={sky === s.id} onClick={() => { chooseSky(s.id); setSky(s.id); }}>
                  {s.thumb ? <img src={s.thumb} alt="" /> : <span className={`onb__drawn onb__drawn--${s.id}`} />}<b>{s.label}</b>
                </button>
              ))}
            </div>
          </section>
        )}

        {step === "finish" && (
          <section className="onb__body">
            <h2>{MAC ? `Almost there${profile.name.trim() ? `, ${profile.name.trim()}` : ""}` : "Privacy, your way"}</h2>
            <label className="onb__toggle"><input type="checkbox" checked={history} onChange={(e) => onHistory(e.target.checked)} /><span><b>Keep my history</b><small>Off by default. When it's on, past searches can suggest what to explore next. Everything stays on this computer.</small></span></label>
            <div className="onb__toggle">
              <span><b>Make AetherDeck your default browser</b><small>Links from other apps open here.</small></span>
              {isDefault ? <span className="onb__ok">It is</span> : <button className="btn btn--small" onClick={() => void call<boolean>("app:setDefault").then(setIsDefault).catch(() => undefined)}>Make default</button>}
            </div>
            <p className="onb__fine">Like to talk instead of type? The microphone button works in AetherDeck, and <a href="https://openwhispr.com" target="_blank" rel="noopener noreferrer">OpenWhispr</a> (free, optional) types what you say into any text box with a hotkey.</p>
          </section>
        )}

        <footer className="onb__foot">
          {at > 0 && <button className="btn" onClick={() => setStep(at - 1)}>Back</button>}
          <button className="btn btn--quiet" onClick={finish}>Skip setup</button>
          <button className="btn btn--primary" onClick={next}>{at === 0 ? "Let's set it up" : at === STEPS.length - 1 ? "Start exploring" : "Continue"}</button>
        </footer>
      </div>
    </div>
  );
}
