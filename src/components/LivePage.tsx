// A real page, in the desktop app: a <webview> (its own Chromium process) inside a glass pane, and the controls
// on the pane's bar (back, forward, reload, the address, bookmark). Any site loads here; nothing is framed.
import { useEffect, useRef, useState } from "react";
import { desktop, pages } from "../lib/desktop.ts";
import { parseOpenRequest, type Tab, type Win } from "../lib/windows.ts";

export interface LiveState { loading: boolean; back: boolean; fwd: boolean; url: string; bookmarked?: boolean; error?: string }

/** Electron's <webview> element, as much of it as Horus uses. */
type WebviewEl = HTMLElement & {
  src: string;
  loadURL(url: string): Promise<void>;
  executeJavaScript(code: string, userGesture?: boolean): Promise<unknown>;
  capturePage(): Promise<{ resize(o: { width: number }): { toDataURL(): string } }>;
  getURL(): string;
  getTitle(): string;
  goBack(): void;
  goForward(): void;
  canGoBack(): boolean;
  canGoForward(): boolean;
  reload(): void;
  stop(): void;
  findInPage(text: string, opts?: { forward?: boolean; findNext?: boolean }): number;
  stopFindInPage(action: "clearSelection" | "keepSelection" | "activateSelection"): void;
  getZoomLevel(): number;
  setZoomLevel(n: number): void;
  getWebContentsId(): number;
};

const domainOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };

/** What a desktop window first loads: the page itself; for video, YouTube's own page (a real browser can show it). */
export const liveSrc = (t: Tab) => (t.kind === "web" ? t.src : t.href);

interface PageProps {
  win: Win;
  finding: boolean;
  onFindClose: () => void;
  onState: (s: LiveState) => void;
  /** The page moved: the window's page follows, so groups and sync carry the real address. */
  onNavigate: (page: Partial<Tab>) => void;
  onFocus: () => void;
  onFullscreen: (on: boolean) => void;
}

export function LivePage({ win, finding, onFindClose, onState, onNavigate, onFocus, onFullscreen }: PageProps) {
  const ref = useRef<WebviewEl | null>(null);
  const ready = useRef(false);
  const [initial] = useState(() => liveSrc(win.page));
  const [error, setError] = useState<{ code: number; text: string; url: string } | null>(null);
  const cb = useRef({ onState, onNavigate, onFocus, onFullscreen, private: !!win.private });
  cb.current = { onState, onNavigate, onFocus, onFullscreen, private: !!win.private };

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const state = (extra: Partial<LiveState> = {}) => {
      if (!ready.current) return;
      cb.current.onState({ loading: false, back: v.canGoBack(), fwd: v.canGoForward(), url: v.getURL(), ...extra });
    };
    const on = (name: string, fn: (e: Event & Record<string, unknown>) => void) => { v.addEventListener(name, fn as EventListener); return () => v.removeEventListener(name, fn as EventListener); };
    const offs = [
      on("dom-ready", () => { ready.current = true; state(); }),
      on("did-start-loading", () => { setError(null); state({ loading: true }); }),
      on("did-stop-loading", () => state()),
      on("did-navigate", (e) => {
        const url = String(e.url);
        cb.current.onNavigate({ src: url, href: url, domain: domainOf(url), kind: "web" });
        if (!cb.current.private) void desktop?.invoke("history:visit", url, v.getTitle());
        state();
      }),
      on("did-navigate-in-page", (e) => {
        if (!e.isMainFrame) return;
        const url = String(e.url);
        cb.current.onNavigate({ src: url, href: url, domain: domainOf(url), kind: "web" });
        if (!cb.current.private) void desktop?.invoke("history:visit", url, v.getTitle());
        state();
      }),
      on("page-title-updated", (e) => {
        const title = String(e.title);
        cb.current.onNavigate({ title });
        if (!cb.current.private) void desktop?.invoke("history:visit", v.getURL(), title);
      }),
      on("page-favicon-updated", (e) => { const icon = (e.favicons as string[])?.[0]; if (icon) cb.current.onNavigate({ icon }); }),
      on("did-fail-load", (e) => {
        if (!e.isMainFrame || e.errorCode === -3) return; // -3: aborted by a newer navigation
        setError({ code: Number(e.errorCode), text: String(e.errorDescription), url: String(e.validatedURL) });
        state();
      }),
      on("focus", () => cb.current.onFocus()),
      on("enter-html-full-screen", () => cb.current.onFullscreen(true)),
      on("leave-html-full-screen", () => cb.current.onFullscreen(false)),
    ];
    pages.set(win.id, {
      back: () => v.canGoBack() && v.goBack(),
      forward: () => v.canGoForward() && v.goForward(),
      reload: () => v.reload(),
      stop: () => v.stop(),
      load: (url) => { void v.loadURL(url).catch(() => undefined); },
      find: (text, next, back) => { if (text) v.findInPage(text, { findNext: !next ? false : true, forward: !back }); },
      stopFind: () => { if (ready.current) v.stopFindInPage("clearSelection"); },
      zoom: (step) => { if (ready.current) v.setZoomLevel(step === 0 ? 0 : v.getZoomLevel() + step); },
      print: () => { void desktop?.invoke("page:print", v.getWebContentsId()); },
      devtools: () => { void desktop?.invoke("page:devtools", v.getWebContentsId()); },
      url: () => (ready.current ? v.getURL() : initial),
      title: () => (ready.current ? v.getTitle() : win.page.title),
      wcId: () => (ready.current ? v.getWebContentsId() : -1),
      capture: async () => (ready.current ? (await v.capturePage()).resize({ width: 240 }).toDataURL() : ""),
      read: async <T,>(script: string) => (ready.current ? ((await v.executeJavaScript(script, false)) as T) : null),
      text: async () => (ready.current ? String(await v.executeJavaScript("document.body ? document.body.innerText : ''", false)).slice(0, 400_000) : ""),
    });
    return () => { for (const off of offs) off(); pages.delete(win.id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [win.id]);

  // The window's page changed from elsewhere (another device, a shared group): go there.
  const want = liveSrc(win.page);
  useEffect(() => {
    const v = ref.current;
    if (v && ready.current && want && v.getURL() !== want) void v.loadURL(want).catch(() => undefined);
  }, [want]);

  return (
    <>
      <webview ref={ref as never} className="win__frame" src={initial} partition={win.private ? "horus-private" : "persist:web"} allowpopups="true" />
      {finding && <FindBar onClose={onFindClose} />}
      {error && (
        <div className="win__state win__state--blocked">
          <p className="win__big">This page didn’t load.</p>
          <p className="fine">{domainOf(error.url)}: {error.text || `error ${error.code}`}</p>
          <div className="win__actions"><button className="btn btn--primary" onClick={() => { setError(null); ref.current?.reload(); }}>Try again</button></div>
        </div>
      )}
    </>
  );
}

export function FindBar({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState("");
  const [count, setCount] = useState<{ active: number; total: number } | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  useEffect(() => {
    const v = ref.current?.closest(".win__body")?.querySelector("webview");
    if (!v) return desktop?.on("curve:found", (p) => { const r = p as { id: string; active: number; total: number }; if (r.id === winId()) setCount({ active: r.active, total: r.total }); });
    const h = (e: Event) => { const r = (e as unknown as { result: { activeMatchOrdinal: number; matches: number } }).result; setCount({ active: r.activeMatchOrdinal, total: r.matches }); };
    v.addEventListener("found-in-page", h);
    return () => v.removeEventListener("found-in-page", h);
  }, []);
  const winId = () => ref.current?.closest("[data-window]")?.getAttribute("data-window") ?? "";
  const find = (next = false, back = false) => pages.get(winId())?.find(text, next, back);
  const close = () => { pages.get(winId())?.stopFind(); onClose(); };
  return (
    <div className="findbar" role="search">
      <input ref={ref} value={text} aria-label="Find in page" placeholder="Find in page"
        onChange={(e) => { setText(e.target.value); if (e.target.value) pages.get(winId())?.find(e.target.value); else { pages.get(winId())?.stopFind(); setCount(null); } }}
        onKeyDown={(e) => { if (e.key === "Enter") find(true, e.shiftKey); if (e.key === "Escape") { e.stopPropagation(); close(); } }} />
      <span className="findbar__count">{text && count ? `${count.active} of ${count.total}` : ""}</span>
      <button className="orn" aria-label="Previous match" onClick={() => find(true, true)}>‹</button>
      <button className="orn" aria-label="Next match" onClick={() => find(true)}>›</button>
      <button className="orn" aria-label="Close find" onClick={close}>×</button>
    </div>
  );
}

const I = ({ d }: { d: string }) => <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>;

/** The bar's middle: back, forward, reload or stop, the address (type an address to go there, or a question to
 *  see it as a map), and a star to bookmark the page. */
export function LiveControls({ win, live, onAsk, focusSeq }: { win: Win; live?: LiveState; onAsk: (q: string) => void; focusSeq: number }) {
  const page = () => pages.get(win.id);
  const url = live?.url || liveSrc(win.page);
  const [draft, setDraft] = useState<string | null>(null);
  const [starred, setStarred] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (focusSeq) { input.current?.focus(); input.current?.select(); } }, [focusSeq]);
  useEffect(() => {
    let alive = true;
    void desktop?.invoke<{ url: string }[]>("bookmarks:list").then((bs) => { if (alive) setStarred(bs.some((b) => b.url === url)); });
    return () => { alive = false; };
  }, [url]);
  const go = (q: string) => {
    const s = q.trim();
    if (!s) return;
    const tab = parseOpenRequest(s);
    if (tab && (tab.kind === "web" || tab.kind === "video")) page()?.load(tab.kind === "web" ? tab.src : tab.href);
    else onAsk(s);
    setDraft(null);
    input.current?.blur();
  };
  const shown = url.replace(/^https:\/\//, "").replace(/\/$/, "");
  const [blocked, setBlocked] = useState(0);
  const [shieldOff, setShieldOff] = useState(false);
  useEffect(() => {
    setBlocked(0);
    void desktop?.invoke<{ allowed: string[]; on: boolean }>("shields:status").then((s) => setShieldOff(!s.on || s.allowed.includes(domainOf(url))));
    return desktop?.on("horus:shields", (p) => { const r = p as { wc: number; blocked: number }; if (r.wc === page()?.wcId()) setBlocked(r.blocked); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);
  return (
    <>
      <button className="orn" aria-label="Back" title="Back" disabled={!live?.back} onClick={() => page()?.back()}><I d="M15 5l-7 7 7 7" /></button>
      <button className="orn" aria-label="Forward" title="Forward" disabled={!live?.fwd} onClick={() => page()?.forward()}><I d="M9 5l7 7-7 7" /></button>
      {live?.loading
        ? <button className="orn" aria-label="Stop" title="Stop loading" onClick={() => page()?.stop()}><I d="M7 7l10 10M17 7 7 17" /></button>
        : <button className="orn" aria-label="Reload" title="Reload" onClick={() => page()?.reload()}><I d="M19 12a7 7 0 1 1-2.05-4.95M19 5v4h-4" /></button>}
      <button className={`orn shield ${shieldOff ? "is-off" : ""}`} aria-label={shieldOff ? "Shields are off for this site. Turn them on" : `Shields: ${blocked} blocked on this page. Turn off for this site`}
        title={shieldOff ? "Shields off for this site" : `${blocked} ads and trackers blocked here. Click to turn Shields off for this site`}
        onClick={() => void desktop?.invoke<boolean>("shields:toggleSite", url).then((off) => { setShieldOff(off); page()?.reload(); })}>
        <I d="M12 3l7 3v6c0 4.4-3 7.6-7 9-4-1.4-7-4.6-7-9V6l7-3Z" />{!shieldOff && blocked > 0 && <span className="shield__n">{blocked > 99 ? "99+" : blocked}</span>}
      </button>
      <label className={`win__addr win__addr--live ${live?.loading ? "is-loading" : ""}`}>
        {win.private
          ? <span className="win__private" title="Private: not kept in history, not synced">Private</span>
          : <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2">{url.startsWith("https:") ? <><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></> : <path d="M12 8v5M12 16v.5M4 20h16L12 4Z" />}</svg>}
        <input ref={input} aria-label="Address" spellCheck={false} value={draft ?? shown}
          onFocus={(e) => { setDraft(url); requestAnimationFrame(() => e.target.select()); }}
          onBlur={() => setDraft(null)} onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") go(e.currentTarget.value); if (e.key === "Escape") { e.stopPropagation(); setDraft(null); e.currentTarget.blur(); } }} />
        {!win.private && (
          <button type="button" className={`win__star ${starred ? "is-on" : ""}`} aria-label={starred ? "Remove bookmark" : "Bookmark this page"} aria-pressed={starred}
            onClick={() => void desktop?.invoke<boolean>("bookmarks:toggle", url, page()?.title() ?? win.page.title).then(setStarred)}>
            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill={starred ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"><path d="m12 4 2.4 5 5.4.6-4 3.7 1.1 5.4L12 16l-4.9 2.7 1.1-5.4-4-3.7 5.4-.6Z" /></svg>
          </button>
        )}
      </label>
    </>
  );
}
