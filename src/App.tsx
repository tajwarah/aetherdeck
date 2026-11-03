import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EnvironmentModel, Evidence, ExploreRequest, InformationNode, SearchResult } from "../shared/types.ts";
import { ENGINES, SERP_READ, serpUrl, type Engine, type PageRead } from "../shared/serp.ts";
import { Field, type FieldHandle } from "./components/Field.tsx";
import { Planet } from "./components/Planet.tsx";
import { Logo } from "./components/Logo.tsx";
import { Windows } from "./components/Windows.tsx";
import { arrangeGroup, awayTabs, closeTab, frontWindow, showTab, toggleMaximize, parseOpenRequest, placeBeside, placeWindow, uid, webSearchTab, type Tab, type Win } from "./lib/windows.ts";
import type { Place } from "./components/Launcher.tsx";
import { ControlBar } from "./components/ControlBar.tsx";
import { Composer } from "./components/Composer.tsx";
import { Inspector } from "./components/Inspector.tsx";
import { ActionSheet } from "./components/ActionSheet.tsx";
import { PrivacySheet } from "./components/PrivacySheet.tsx";
import { Progress } from "./components/Progress.tsx";
import { LocationAsk, type ChosenLocation } from "./components/LocationAsk.tsx";
import { Suggested } from "./components/Suggested.tsx";
import { TimelineView } from "./views/TimelineView.tsx";
import { PlacesView } from "./views/PlacesView.tsx";
import { MindMapView } from "./views/MindMapView.tsx";
import { MediaView } from "./views/MediaView.tsx";
import { ReadingView } from "./views/ReadingView.tsx";
import type { ViewProps } from "./views/primitives.tsx";
import { crewTurn, exploreStream, getHealth, type Health } from "./lib/api.ts";
import { layoutFor } from "./lib/layout.ts";
import { usePrefs } from "./lib/prefs.ts";
import { useReducedMotion, type Vec } from "./lib/spring.ts";
import { useSync } from "./lib/useSync.ts";
import { parseInvite } from "./lib/sync.ts";
import { SyncSheet } from "./components/SyncSheet.tsx";
import { JoinSheet } from "./components/JoinSheet.tsx";
import { captureBeforeMinimize, desktop, pages, type AppInfo, type Download, type PermissionAsk } from "./lib/desktop.ts";
import { hostOf, loadDock, saveDock, siteItem, type DockItem } from "./lib/dock.ts";
import { ACCEPT, readFile } from "./lib/files.ts";
import { materials } from "./components/Assistant.tsx";
import { LibrarySheet, PermissionPrompt, SettingsSheet, type LibraryTab } from "./components/DesktopSheets.tsx";
import { AccountMenu, useAccounts } from "./components/AccountMenu.tsx";
import { AgentConsole } from "./components/AgentConsole.tsx";
import { AgentStation } from "./components/AgentStation.tsx";
import { RamBuddy } from "./components/RamBuddy.tsx";
import type { RamStats } from "./lib/ram.ts";
import { ResearchBoard } from "./components/ResearchBoard.tsx";
import { addResearch, EMPTY_BOARD, fromEnvironment, loadBoard, saveBoard, type Board } from "./lib/research.ts";
import { isPage } from "./components/Surround.tsx";
import { clickScript, labelScript, leavesTrace, loadAgents, needsApproval, runAgent, saveAgents, seeScript, skillsOf, stepText, typeScript, type Agent, type Run } from "./lib/agents.ts";
import { engineTool, inParts, type DataSets } from "./lib/agentTools.ts";
import { appUrl } from "../shared/harvest.ts";
import { askAssistant, type AgentStep } from "./lib/api.ts";

// Opened from a sync or shared-group link: read it once, then take the key out of the address bar.
const initialInvite = parseInvite(location.hash);

interface Frame {
  key: number;
  query: string;
  model: EnvironmentModel | null;
  selectedId: string | null;
  camera?: Vec;
}

const VIEWS: Record<string, (p: ViewProps) => React.ReactNode> = {
  evidence: MindMapView,
  timeline: TimelineView,
  map: PlacesView,
  comparison: PlacesView,
  clusters: MindMapView,
  media: MediaView,
  reading: ReadingView,
};

let frameKey = 0;
const TAB_BATCH = 3;
const TAB_PAUSE = 900;

export function App() {
  const reduced = useReducedMotion();
  const field = useRef<FieldHandle>(null);
  const { prefs, update, clearAll } = usePrefs();
  const [health, setHealth] = useState<Health | null>(null);
  const [frames, setFrames] = useState<Frame[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState("");
  const [composer, setComposer] = useState<{ x: number; y: number; initial?: string; addTo?: string; tabIn?: string; fromBar?: boolean; listen?: boolean } | null>(null);
  const [inspect, setInspect] = useState<{ sourceId: string; evidenceId?: string } | null>(null);
  const [action, setAction] = useState<{ source: SearchResult; kind: "contact_provider" | "prepare_reservation" } | null>(null);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [location, setLocation] = useState<ChosenLocation | null>(prefs.savedLocation);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [wins, setWins] = useState<Win[]>(() => (prefs.historyEnabled ? loadSpace() : []));
  const [overview, setOverview] = useState(false);
  const sync = useSync(wins, setWins);
  const [syncOpen, setSyncOpen] = useState<{ group?: string } | null>(null);
  const [invite, setInvite] = useState(initialInvite);
  const keepResearch = useRef<(q: string, m: EnvironmentModel | null) => void>(() => undefined);
  const abort = useRef<AbortController | null>(null);
  const fitted = useRef<{ key: number; nodes: number; complete: boolean }>({ key: -1, nodes: 0, complete: false });

  const top = frames[frames.length - 1];
  const model = top?.model ?? null;
  const sites = useMemo(() => (model?.visualization === "evidence" || model?.visualization === "clusters" ? model.sources.filter((s) => /^https?:/.test(s.canonicalUrl)).map((s) => ({ url: s.canonicalUrl, title: s.title })) : []), [model]);
  const modelRef = useRef(model);
  modelRef.current = model;
  const layout = useMemo(() => (model ? layoutFor(model) : null), [model]);

  useEffect(() => { getHealth().then(setHealth); }, []);
  // Desktop app: the person's search engine (Settings). Its results page opens in a window they can see.
  const [engine, setEngine] = useState<Engine | "off">("google");
  const loadEngine = useCallback(() => {
    void desktop?.invoke<AppInfo>("app:info").then((i) => { const e = i.config.WARPNAUT_SEARCH_ENGINE || "google"; setEngine(e in ENGINES ? (e as Engine) : "off"); });
  }, []);
  useEffect(loadEngine, [loadEngine]);
  const [engineAsk, setEngineAsk] = useState("");
  const [accounts, setAccounts] = useAccounts();
  const [accountOpen, setAccountOpen] = useState(false);

  /**
   * Search with the person's engine as they would themselves: its results page opens in a window beside the map,
   * Warpnaut reads the results off that visible page, and the window goes to the dock. If the engine asks them
   * something first (privacy choices, a check that they are a person) the window stays in front for them to
   * answer, and the map waits.
   */
  const findWithEngine = useCallback(async (query: string, signal: AbortSignal, patient: boolean): Promise<ExploreRequest["found"]> => {
    if (!desktop || engine === "off") return undefined;
    const url = serpUrl(engine, query, navigator.language.split("-")[0] || "en");
    const existing = winsRef.current.find((w) => w.page.href === url);
    const id = existing?.id ?? uid("w");
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    setWins((ws) => {
      const top = Math.max(0, ...ws.map((w) => w.z)) + 1;
      if (existing) return ws.map((w) => (w.id === id ? { ...w, minimized: false, z: top } : w));
      const page: Tab = { id: uid("t"), kind: "web", src: url, href: url, title: `${ENGINES[engine].label}: ${query}`, domain: new URL(url).hostname.replace(/^www\./, "") };
      return [...ws, { id, page, x: vw - 536, y: 84, w: 500, h: Math.min(640, vh - 210), z: top, minimized: false, origin: { x: vw - 60, y: 40 } }];
    });
    const started = Date.now();
    let asked = false;
    try {
      while (!signal.aborted && Date.now() - started < (asked && patient ? 180_000 : 20_000)) {
        await new Promise((r) => setTimeout(r, 350));
        let read: PageRead | null = null;
        try { read = (await pages.get(id)?.read<PageRead>(SERP_READ[engine])) ?? null; } catch { /* the page is between loads */ }
        if (read?.blocked && !read.hits.length) {
          if (!asked) setEngineAsk(`${ENGINES[engine].label} is asking you something in its window. Answer it there and the map fills in.`);
          asked = true;
          continue;
        }
        if (read && read.hits.length >= 3) {
          setEngineAsk("");
          void captureBeforeMinimize([id]).then(() => setWins((ws) => ws.map((w) => (w.id === id ? { ...w, minimized: true } : w))));
          return { engine, hits: read.hits.slice(0, 40) };
        }
      }
    } finally {
      setEngineAsk("");
    }
    return undefined;
  }, [engine]);
  useEffect(() => { if (initialInvite) history.replaceState(null, "", window.location.pathname + window.location.search); }, []);
  useEffect(() => { if (!sync.notice) return; const t = setTimeout(sync.dismissNotice, 6000); return () => clearTimeout(t); }, [sync.notice, sync.dismissNotice]);
  // Open windows and groups are browsing history: kept across visits only when history is on.
  useEffect(() => { saveSpace(prefs.historyEnabled ? wins : null); }, [wins, prefs.historyEnabled]);
  useEffect(() => { if (wins.filter((w) => !w.minimized).length < 2) setOverview(false); }, [wins]);

  const runRef = useRef<(q: string, o?: { fresh?: boolean }) => void>(() => undefined);
  const run = useCallback(
    async (query: string, opts: { push?: boolean; fresh?: boolean; unattended?: boolean; at?: { x: number; y: number }; loc?: ChosenLocation | null; depth?: "glance" | "standard" | "deep" } = {}) => {
      abort.current?.abort();
      const ctrl = new AbortController();
      abort.current = ctrl;
      const push = opts.push ?? true;
      const key = ++frameKey;
      const camera = field.current?.camera();
      setFrames((fs) => {
        const saved = fs.length ? [...fs.slice(0, -1), { ...fs[fs.length - 1], camera }] : fs;
        const next: Frame = { key, query, model: null, selectedId: null };
        if (opts.fresh) return [next]; // a new question starts a new path; "go deeper" extends the current one
        return push ? [...saved, next] : [...saved.slice(0, -1), next];
      });
      setComposer(null);
      setInspect(null);
      setError("");
      setDismissed(new Set());
      setStreaming(true);
      if (opts.at) field.current?.diveAt(opts.at.x, opts.at.y);
      if (prefs.historyEnabled) update((p) => ({ ...p, history: [{ query, at: new Date().toISOString() }, ...p.history.filter((h) => h.query !== query)].slice(0, 50) }));

      const loc = opts.loc === undefined ? null : opts.loc;
      try {
        let needsLocation = false;
        const found = await findWithEngine(query, ctrl.signal, !opts.unattended);
        if (ctrl.signal.aborted) return;
        let latest: EnvironmentModel | null = null;
        await exploreStream(
          { query, depth: opts.depth, ...(found ? { found } : {}), ...(loc ? { location: { lat: loc.lat, lon: loc.lon, label: loc.label, source: loc.source } } : {}) },
          (m) => {
            latest = m;
            needsLocation = m.notices.some((n) => n.code === "location_required");
            setFrames((fs) => fs.map((f) => (f.key === key ? { ...f, model: m } : f)));
          },
          ctrl.signal,
        );
        keepResearch.current(query, latest);
        // Location is sent only when a local request actually needs it, and only once the person has chosen one.
        if (needsLocation && !loc && location && !ctrl.signal.aborted) {
          setStreaming(false);
          return run(query, { push: false, loc: location, depth: opts.depth });
        }
      } catch (err) {
        if (!ctrl.signal.aborted) setError(`${(err as Error).message}. Nothing was made up — try again in a moment.`);
      } finally {
        if (abort.current === ctrl) setStreaming(false);
      }
    },
    [location, prefs.historyEnabled, update, findWithEngine],
  );

  runRef.current = run;

  // Frame the environment as it fills in: once when it first has content, again when complete.
  useEffect(() => {
    if (!top || !model || !layout) return;
    const f = fitted.current;
    const nodes = model.nodes.length;
    const isNew = f.key !== top.key;
    if (isNew && top.camera && model.complete && !streaming) return; // returning to a saved frame: camera restored
    if (isNew || (nodes > 1 && f.nodes <= 1) || (model.complete && !f.complete && !top.selectedId)) {
      if (nodes > 1 || model.complete) field.current?.fit(layout.focusBounds ?? layout.bounds, model.visualization === "reading" ? 1 : 1.05);
      fitted.current = { key: top.key, nodes, complete: model.complete };
    }
  }, [top, model, layout, streaming]);

  const goBack = useCallback(() => {
    abort.current?.abort();
    setInspect(null);
    setFrames((fs) => {
      const next = fs.slice(0, -1);
      const prev = next[next.length - 1];
      if (prev?.camera) field.current?.restore(prev.camera);
      else field.current?.reset();
      if (prev) fitted.current = { key: prev.key, nodes: prev.model?.nodes.length ?? 0, complete: true };
      return next;
    });
    setStreaming(false);
  }, []);

  const popTo = useCallback((index: number) => {
    abort.current?.abort();
    setInspect(null);
    setStreaming(false);
    setFrames((fs) => {
      const next = fs.slice(0, index + 1);
      const target = next[next.length - 1];
      if (target?.camera) field.current?.restore(target.camera);
      if (target) fitted.current = { key: target.key, nodes: target.model?.nodes.length ?? 0, complete: true };
      return next;
    });
  }, []);

  const resetAll = useCallback(() => {
    abort.current?.abort();
    setFrames([]);
    setInspect(null);
    setComposer(null);
    setStreaming(false);
    setError("");
    field.current?.reset();
  }, []);

  // Pages open as tabs in flat browser windows. The 360° view is a place you choose to go: every tab around you.
  const [surround, setSurround] = useState(false);
  const surroundRef = useRef(false);
  surroundRef.current = surround;
  const [newTab, setNewTab] = useState(0);
  const enterRoom = useCallback(() => {
    if (!desktop) return;
    setSurround(true);
    setWins((ws) => ws.map((w) => (isPage(w) && w.minimized ? { ...w, minimized: false } : w)));
  }, []);
  const floatWindows = useCallback(() => setSurround(false), []);

  /**
   * A site or video opens as a new tab of the browser window in front (or of `tabIn`), or in a window of its own
   * when none is showing. With addTo, it opens beside that window instead, in its group.
   */
  const openTab = useCallback((tab: Omit<Tab, "id">, near?: { x: number; y: number }, addTo?: string, from?: { x: number; y: number }, opts: { private?: boolean; tabIn?: string } = {}) => {
    setWins((ws) => {
      const top = Math.max(0, ...ws.map((w) => w.z)) + 1;
      const page: Tab = { ...tab, id: uid("t") };
      const anchor = addTo ? ws.find((w) => w.id === addTo) : undefined;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const away = awayTabs(ws);
      const isWebPage = tab.kind === "web" || tab.kind === "video" || tab.kind === "videosearch";
      const host = opts.tabIn ? ws.find((w) => w.id === opts.tabIn)
        : desktop && !anchor && !opts.private && isWebPage ? ws.filter((w) => isPage(w) && !w.minimized && !w.private && !away.has(w.id)).sort((a, b) => b.z - a.z)[0] : undefined;
      if (host) {
        const stack = host.stack ?? uid("s");
        const added: Win = { id: uid("w"), page, x: host.x, y: host.y, w: host.w, h: host.h, restore: host.restore, z: top, minimized: false, stack, ...(host.group ? { group: host.group } : {}), ...(host.private ? { private: true } : {}) };
        return [...ws.map((w) => (w.id === host.id ? { ...w, stack } : w)), added];
      }
      if (anchor) {
        const group = anchor.group ?? uid("g");
        const { fits, ...rect } = placeBeside(ws, anchor, vw, vh);
        const next = [...ws.map((w) => (w.id === anchor.id ? { ...w, group } : w)), { id: uid("w"), page, ...rect, z: top, minimized: false, group, origin: { x: anchor.x + anchor.w, y: anchor.y + anchor.h / 2 }, ...(anchor.private ? { private: true } : {}) }];
        return fits ? next : arrangeGroup(next, group, vw, vh); // no room beside: lay the group out side by side, shrunk to fit
      }
      return [...ws, { id: uid("w"), page, ...placeWindow(ws, vw, vh, near), z: top, minimized: false, origin: from ?? near, ...(opts.private ? { private: true } : {}) }];
    });
    setComposer(null);
    setOverview(false);
  }, []);
  /** Several pages at once, as one group of windows side by side (from sites connected on the map). */
  // The last tab closed: the room goes with it, back to home.
  const hadTabs = useRef(false);
  useEffect(() => {
    const any = wins.some((w) => isPage(w) && !w.minimized);
    if (surround && hadTabs.current && !any) setSurround(false);
    hadTabs.current = surround && any;
  }, [wins, surround]);

  const openGroup = useCallback((pages: { url: string; title: string }[], group = uid("g")) => {
    const tabs = pages.flatMap((p) => { const t = parseOpenRequest(p.url); return t ? [{ ...t, title: p.title || t.title }] : []; });
    if (!tabs.length) return;
    setWins((ws) => {
      let top = Math.max(0, ...ws.map((w) => w.z));
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const w = Math.max(360, Math.min(560, (vw - 32) / tabs.length - 16));
      const h = Math.min(640, vh - 200);
      const added: Win[] = tabs.map((t, i) => ({ id: uid("w"), page: { ...t, id: uid("t") }, x: 16 + i * (w + 16), y: 80, w, h, z: ++top, minimized: false, group, origin: { x: vw / 2, y: vh / 2 } }));
      return arrangeGroup([...ws, ...added], group, vw, vh);
    });
    setComposer(null);
    setOverview(false);
  }, []);

  /** Every site as its own tab. They arrive a few at a time, and stop if the app reaches the agent engine's memory limit. */
  const openTabs = useCallback(async (pages: { url: string; title: string }[]) => {
    const list = [...new Map(pages.map((p) => [p.url, p])).values()];
    const group = uid("g");
    for (let i = 0; i < list.length; i += TAB_BATCH) {
      if (i) {
        await new Promise((r) => setTimeout(r, TAB_PAUSE));
        const s = await desktop?.invoke<RamStats>("engine:stats").catch(() => null);
        if (s?.system && s.total > s.system * 0.5) return setError(`Opened ${i} of ${list.length} sites. Memory is near its limit, so the rest are still on the map.`);
      }
      openGroup(list.slice(i, i + TAB_BATCH), group);
    }
  }, [openGroup]);
  const minimizeAll = useCallback(() => {
    const ids = winsRef.current.filter((w) => !w.minimized).map((w) => w.id);
    // only the windows open now: one opened meanwhile (the engine's results) stays in front
    void captureBeforeMinimize(ids).then(() => setWins((ws) => ws.map((w) => (ids.includes(w.id) ? { ...w, minimized: true } : w))));
  }, []);

  // ---- the dock, files and the assistant ----
  const [dock, setDock] = useState<DockItem[]>(loadDock);
  useEffect(() => saveDock(dock), [dock]);
  const fileInput = useRef<HTMLInputElement>(null);

  /** An assistant window: for a file (read here, on this computer), a page's text, or nothing yet. */
  const openAssistant = useCallback((title: string, near?: { x: number; y: number }, beside?: string) => {
    const key = uid("a");
    openTab({ kind: "assistant", src: key, href: "", title, domain: "warpnaut" }, near, beside);
    setWins((ws) => ws.map((w) => (w.page.src === key ? { ...w, w: Math.min(480, window.innerWidth - 32), h: Math.min(600, window.innerHeight - 160) } : w)));
    return key;
  }, [openTab]);
  const loadFileInto = useCallback((key: string, file: File) => {
    materials.set(key, { kind: "loading", name: file.name });
    readFile(file, desktop?.pathFor(file) || undefined)
      .then((m) => materials.set(key, m))
      .catch((err: Error) => materials.set(key, { kind: "error", name: file.name, message: err.message }));
  }, []);
  const openFiles = useCallback((files: File[], near?: { x: number; y: number }) => {
    files.slice(0, 6).forEach((file, i) => {
      const key = openAssistant(file.name, near && { x: near.x + i * 30, y: near.y + i * 30 });
      loadFileInto(key, file);
    });
  }, [openAssistant, loadFileInto]);
  /** The AI button: about the page in front when there is one, otherwise a blank assistant. */
  const openAI = useCallback(async (near?: { x: number; y: number }) => {
    const front = frontWindow(winsRef.current);
    const page = front && front.page.kind === "web" && !front.private ? pages.get(front.id) : undefined;
    if (!page || !front) return void openAssistant("Assistant", near);
    const key = openAssistant(`About: ${page.title() || front.page.domain}`, undefined, front.id);
    materials.set(key, { kind: "loading", name: page.title() || front.page.domain });
    try {
      const text = await page.text();
      materials.set(key, text.trim() ? { kind: "page", name: page.title() || front.page.domain, url: page.url(), text } : { kind: "error", name: page.title(), message: "This page has no readable text yet." });
    } catch {
      materials.set(key, { kind: "error", name: front.page.domain, message: "This page's text couldn't be read." });
    }
  }, [openAssistant]);
  const onDockItem = useCallback((item: DockItem, at: { x: number; y: number }) => {
    if (item.action === "files") return fileInput.current?.click();
    if (item.action === "ai") return void openAI(at);
    if (item.action === "station") return setStationOpen((o) => !o);
    if (item.action === "research") return setBoardOpen((o) => !o);
    if (item.action === "phone") {
      const open = winsRef.current.find((w) => w.page.kind === "phone");
      if (open) return setWins((ws) => { const top = Math.max(0, ...ws.map((w) => w.z)) + 1; return ws.map((w) => (w.id === open.id ? { ...w, minimized: false, z: top } : w)); });
      // Kept out of sync, history and the agents' reach, as a private window is: a phone's screen is the person's alone.
      return openTab({ kind: "phone", src: "", href: "", title: "Phone", domain: "phone" }, undefined, undefined, at, { private: true });
    }
    if (!item.url) return;
    const host = hostOf(item.url);
    // A site that is already open comes forward instead of opening twice.
    const existing = winsRef.current.filter((w) => w.page.kind !== "assistant" && hostOf(w.page.href) === host).sort((a, b) => b.z - a.z)[0];
    if (existing) return setWins((ws) => showTab(ws.map((w) => (existing.stack && w.stack === existing.stack ? { ...w, minimized: false } : w)), existing.id));
    if (!desktop && host === "youtube.com") return askAtBar("play ");
    const tab = parseOpenRequest(item.url);
    if (tab) openTab({ ...tab, title: item.label }, undefined, undefined, at);
  // askAtBar is declared below and stable
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openAI, openTab]);
  const isPinned = useCallback((w: Win) => dock.some((d) => d.url && hostOf(d.url) === hostOf(w.page.href)), [dock]);
  const togglePin = useCallback((w: Win) => setDock((d) => {
    const host = hostOf(w.page.href);
    if (d.some((x) => x.url && hostOf(x.url) === host)) return d.filter((x) => !(x.url && hostOf(x.url) === host));
    const it = siteItem(w.page.href.replace(/^(https?:\/\/[^/]+).*/, "$1/"), w.page.title.length <= 18 ? w.page.title : undefined);
    return it ? [...d, it] : d;
  }), []);

  // ---- the desktop app: menu commands, links from other apps, downloads, permission prompts, updates ----
  const [findIn, setFindIn] = useState<string | null>(null);
  const [addressFocus, setAddressFocus] = useState<{ id: string; seq: number } | null>(null);
  const [library, setLibrary] = useState<LibraryTab | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [downloads, setDownloads] = useState<Download[]>([]);
  const [asks, setAsks] = useState<PermissionAsk[]>([]);
  const [appUpdate, setAppUpdate] = useState<{ version: string; ready?: boolean; manual?: boolean; url?: string } | null>(null);
  const closed = useRef<{ page: Tab; private?: boolean }[]>([]);
  const prevWins = useRef(wins);
  useEffect(() => { // remember closed windows, so Reopen Closed Window can bring them back
    const now = new Set(wins.map((w) => w.id));
    for (const w of prevWins.current) if (!now.has(w.id)) closed.current = [{ page: w.page, private: w.private }, ...closed.current].slice(0, 25);
    prevWins.current = wins;
  }, [wins]);
  const winsRef = useRef(wins);
  winsRef.current = wins;

  /** A link from a page, another app or the menu: a new tab, in the window of the page that opened it. */
  const openLink = useCallback((url: string, fromWc?: number) => {
    const tab = parseOpenRequest(url);
    if (!tab) return;
    const fromWin = fromWc === undefined ? undefined : [...pages.entries()].find(([, p]) => p.wcId() === fromWc)?.[0];
    openTab({ ...tab, kind: "web", src: tab.kind === "web" ? tab.src : tab.href }, undefined, undefined, undefined, { tabIn: fromWin });
  }, [openTab]);

  const runCommand = useRef<(name: string, value?: string) => void>(() => undefined);
  runCommand.current = (name, value) => {
    const front = frontWindow(winsRef.current);
    const page = front ? pages.get(front.id) : undefined;
    switch (name) {
      case "newWindow": if (surroundRef.current) return setNewTab((n) => n + 1); return askAtBar();
      case "privateWindow": return openTab({ kind: "web", src: "https://search.brave.com/", href: "https://search.brave.com/", title: "Private window", domain: "search.brave.com" }, undefined, undefined, undefined, { private: true });
      case "focusAddress": return front ? setAddressFocus((a) => ({ id: front.id, seq: (a?.seq ?? 0) + 1 })) : askAtBar();
      case "closeWindow": return front ? setWins((ws) => closeTab(ws, front.id)) : undefined;
      case "reopenClosed": { const c = closed.current.shift(); if (c) openTab(c.page, undefined, undefined, undefined, { private: c.private }); return; }
      case "find": return front && setFindIn(front.id);
      case "reload": return page?.reload();
      case "back": return page?.back();
      case "forward": return page?.forward();
      case "zoomIn": return page?.zoom(0.5);
      case "zoomOut": return page?.zoom(-0.5);
      case "zoomReset": return page?.zoom(0);
      case "print": return page?.print();
      case "devtools": return page?.devtools();
      case "overview": return setOverview((o) => !o);
      case "home": return minimizeAll();
      case "history": case "bookmarks": case "downloads": return setLibrary(name);
      case "bookmarkPage": return page && void desktop?.invoke("bookmarks:toggle", page.url(), page.title());
      case "settings": return setSettingsOpen(true);
      case "agent": return setAgents({ listen: true, key: Date.now() });
      case "surround": return surroundRef.current ? floatWindows() : enterRoom();
      case "openFile": return fileInput.current?.click();
      case "assistant": return void openAI();
      case "ask": return value ? void runRef.current(value, { fresh: true }) : undefined;
    }
  };

  useEffect(() => {
    if (!desktop) return;
    document.documentElement.dataset.platform = desktop.platform;
    const offs = [
      desktop.on("warpnaut:open", (p) => { const { url, from } = p as { url: string; from?: number }; openLink(url, from); }),
      desktop.on("warpnaut:command", (p) => { const { name, value } = p as { name: string; value?: string }; runCommand.current(name, value); }),
      desktop.on("warpnaut:download", (p) => { const d = p as Download; setDownloads((ds) => [d, ...ds.filter((x) => x.id !== d.id)].slice(0, 100)); }),
      desktop.on("warpnaut:permission", (p) => setAsks((a) => [...a, p as PermissionAsk])),
      desktop.on("warpnaut:update", (p) => setAppUpdate(p as { version: string })),
    ];
    void desktop.invoke<string[]>("app:ready").then((urls) => urls.forEach((u) => openLink(u)));
    return () => offs.forEach((off) => off());
  }, [openLink]);
  const askAtBar = useCallback((initial = "", listen = false) => setComposer({ x: window.innerWidth / 2 - 260, y: window.innerHeight - 100, initial, fromBar: true, listen }), []);
  const openPlace = useCallback((p: Place, at: { x: number; y: number }) => {
    if (!p.url) return askAtBar(p.compose ?? "");
    const tab = parseOpenRequest(p.url);
    if (tab) openTab({ ...tab, title: p.label }, undefined, undefined, at);
  }, [askAtBar, openTab]);
  const openUrl = useCallback((url: string, title?: string, near?: { x: number; y: number }) => {
    const tab = parseOpenRequest(url);
    if (tab) openTab({ ...tab, title: title ?? tab.title }, near);
  }, [openTab]);

  const onEscape = useCallback(() => {
    if (composer) return setComposer(null);
    if (syncOpen) return setSyncOpen(null);
    if (overview) return setOverview(false);
    if (action) return setAction(null);
    const front = frontWindow(wins); // the window in front (with its group) is minimized first; Escape never closes one
    if (front) {
      const ids = wins.filter((w) => w.id === front.id || (front.group && w.group === front.group) || (front.stack && w.stack === front.stack)).map((w) => w.id);
      return void captureBeforeMinimize(ids).then(() => setWins((ws) => ws.map((w) => (ids.includes(w.id) ? { ...w, minimized: true } : w))));
    }
    if (inspect) return setInspect(null);
    if (top?.selectedId) return setFrames((fs) => fs.map((f, i) => (i === fs.length - 1 ? { ...f, selectedId: null } : f)));
    if (frames.length) goBack();
  }, [composer, syncOpen, overview, action, wins, inspect, top, frames.length, goBack]);

  const select = useCallback(
    (node: InformationNode, at?: { x: number; y: number }) => {
      if (!model || !layout) return;
      const p = at ?? layout.pos[node.id] ?? layout.pos[`dot:${node.id}`];
      if (node.nodeType === "gap") {
        const ev = model.evidence.find((e) => `ev:${e.id}` === node.id);
        run(`${ev?.subtopic ?? node.title} ${model.intent.constraints.topic}`, { depth: "deep" });
        return;
      }
      setFrames((fs) => fs.map((f, i) => (i === fs.length - 1 ? { ...f, selectedId: node.id } : f)));
      if (node.nodeType === "subtopic") {
        // Frame the sub-question together with its findings.
        const pts = [p, ...model.nodes.filter((n) => n.parentId === node.id).map((n) => layout.pos[n.id])].filter(Boolean);
        const cx = pts.reduce((t, q) => t + q.x, 0) / pts.length;
        const cy = pts.reduce((t, q) => t + q.y, 0) / pts.length;
        field.current?.focusWorld(cx, cy, 0.95, false);
      } else if (p) field.current?.focusWorld(p.x, p.y);
      if (node.sourceIds[0]) setInspect({ sourceId: node.sourceIds[0], evidenceId: node.nodeType === "finding" ? node.id.slice(3) : undefined });
      else setInspect(null);
    },
    [model, layout, run],
  );

  // ---- the agents: one request, a crew that works the browser in view ----
  const [agents, setAgents] = useState<{ listen: boolean; key: number } | null>(null);
  const agentContext = useCallback(() => {
    const front = frontWindow(winsRef.current);
    return {
      windows: winsRef.current.filter((w) => !w.private).map((w) => ({ title: pages.get(w.id)?.title() || w.page.title, url: pages.get(w.id)?.url() || w.page.href, front: w.id === front?.id })),
      map: frames.length ? frames[frames.length - 1].query : undefined,
    };
  }, [frames]);
  /** The window whose title or address holds the words (or the front one). */
  const windowFor = (match?: string) => {
    const ws = winsRef.current;
    if (!match?.trim()) return frontWindow(ws) ?? ws[ws.length - 1];
    const m = match.toLowerCase();
    return ws.find((w) => `${pages.get(w.id)?.title() ?? w.page.title} ${pages.get(w.id)?.url() ?? w.page.href}`.toLowerCase().includes(m));
  };
  const agentAct = useCallback(async (step: AgentStep): Promise<string | void> => {
    switch (step.do) {
      case "search":
        if (!step.query) throw new Error("No search was given");
        minimizeAll();
        await run(step.query, { fresh: true, unattended: true }); // a person may not be watching, so a prompt from the engine can't hold the run
        return;
      case "open":
        if (!step.url) throw new Error("No address was given");
        openUrl(step.url);
        return;
      case "openMany":
        if (!step.urls?.length) throw new Error("No addresses were given");
        openGroup(step.urls.map((url) => ({ url, title: "" })));
        return;
      case "arrange": {
        const ids = winsRef.current.filter((w) => !w.minimized).map((w) => w.id);
        if (!ids.length) return "No windows are open.";
        const group = uid("g");
        setWins((ws) => arrangeGroup(ws.map((w) => (ids.includes(w.id) ? { ...w, group } : w)), group, window.innerWidth, window.innerHeight));
        return;
      }
      case "minimizeAll": minimizeAll(); return;
      case "focus": case "close": case "fullscreen": {
        const w = windowFor(step.match);
        if (!w) throw new Error(`No window matches “${step.match}”`);
        setWins((ws) => {
          if (step.do === "close") return ws.filter((x) => x.id !== w.id);
          const top = Math.max(0, ...ws.map((x) => x.z)) + 1;
          return ws.map((x) => (x.id !== w.id ? x : step.do === "fullscreen" && !x.restore ? { ...toggleMaximize(x, window.innerWidth, window.innerHeight), minimized: false, z: top } : { ...x, minimized: false, z: top }));
        });
        return;
      }
      case "read": {
        // A page opened a moment ago by the plan may still be loading: give it a few seconds.
        let w = windowFor(step.match);
        for (let i = 0; i < 20 && !(w && pages.get(w.id)); i++) { await new Promise((r) => setTimeout(r, 400)); w = windowFor(step.match); }
        const page = w && pages.get(w.id);
        if (!w || !page) throw new Error(step.match ? `No open page matches “${step.match}”` : "No page is open to read");
        let text = "";
        for (let i = 0; i < 15 && text.trim().length < 200; i++) { text = await page.text().catch(() => ""); if (text.trim().length < 200) await new Promise((r) => setTimeout(r, 500)); }
        if (!text.trim()) throw new Error("That page has no readable text");
        const r = await askAssistant(step.question || "Summarize this page.", [], { kind: "page", name: page.title() || w.page.title, url: page.url(), text });
        return r.answer;
      }
      case "write": {
        const r = await askAssistant(step.text || "", [], undefined);
        return r.answer;
      }
      default:
        return step.text;
    }
  }, [minimizeAll, run, openUrl, openGroup]);

  // ---- the Agent Station: agents on any model, running beside whatever the person is doing ----
  const [stationOpen, setStationOpen] = useState(false);
  const [boardOpen, setBoardOpen] = useState(false);
  const [board, setBoard] = useState<Board>(EMPTY_BOARD);
  const boardLoaded = useRef(false);
  useEffect(() => { void loadBoard().then((b) => { boardLoaded.current = true; setBoard(b); }); }, []);
  const keepBoard = useCallback((change: (b: Board) => Board) => setBoard((b) => { const next = change(b); if (boardLoaded.current) saveBoard(next); return next; }), []);
  keepResearch.current = (q, m) => { if (m?.sources.length) keepBoard((b) => (b.keep ? addResearch(b, fromEnvironment(q, m)) : b)); };
  const [crew, setCrew] = useState<Agent[]>([]);
  const [runs, setRuns] = useState<Record<string, Run>>({});
  const stops = useRef(new Map<string, AbortController>());
  useEffect(() => { void loadAgents().then(setCrew); }, []);
  const keepCrew = useCallback((change: (c: Agent[]) => Agent[]) => setCrew((c) => { const next = change(c); saveAgents(next); return next; }), []);

  /** A window an agent may touch: never a private one. */
  const agentWindow = (match?: unknown) => {
    const m = typeof match === "string" ? match : "";
    const w = winsRef.current.find((x) => x.id === m) ?? windowFor(m);
    if (!w || w.private) throw new Error(m ? `No window matches “${m}”` : "No page is open");
    return w;
  };
  const livePage = async (id: string) => {
    for (let i = 0; i < 40; i++) {
      const p = pages.get(id);
      if (p && (await p.read<string>("document.readyState").catch(() => null)) === "complete") return p;
      await new Promise((r) => setTimeout(r, 400));
    }
    const p = pages.get(id);
    if (!p) throw new Error("That page didn't open");
    return p;
  };
  const fromPage = (url: string, text: string) => `<page_content source="${url.replace(/"/g, "")}">\n${text}\n</page_content>`;

  /** What each running agent holds off the conversation: its data sets, and whether it has read email. */
  const workbench = useRef(new Map<string, { data: DataSets; readMail: boolean; signal: AbortSignal }>());

  const agentTool = useCallback(async (agent: Agent, name: string, input: Record<string, unknown>, ask: (q: string) => Promise<boolean>): Promise<string> => {
    const bench = workbench.current.get(agent.id)!;
    if (bench.readMail && leavesTrace(name, input)) {
      const target = String(input.url ?? input.fact ?? (name === "crawl_pages" ? "several pages" : "this page")).slice(0, 160);
      if (!(await ask(`${agent.name} has read your email and now wants to use ${name.replace(/_/g, " ")}: ${target}. Allow it?`))) return "The person declined this.";
    }
    const engined = await engineTool(name, input, {
      agent, data: bench.data, signal: bench.signal, openUrl,
      markMail: () => { bench.readMail = true; },
      remember: (fact) => keepCrew((c) => c.map((a) => (a.id === agent.id ? { ...a, memory: [fact.slice(0, 300), ...(a.memory ?? [])].slice(0, 30) } : a))),
      livePage: async (window) => {
        const p = await livePage(agentWindow(window).id);
        return { url: p.url(), read: <T,>(script: string) => p.read<T>(script) };
      },
    });
    if (engined !== null) return engined;
    switch (name) {
      case "list_windows":
        return JSON.stringify(winsRef.current.filter((w) => !w.private).map((w) => ({ id: w.id, title: pages.get(w.id)?.title() || w.page.title, url: pages.get(w.id)?.url() || w.page.href, minimized: !!w.minimized })));
      case "open_page": {
        const url = String(input.url ?? "");
        if (!/^https?:\/\//i.test(url)) throw new Error("Only http(s) addresses can be opened");
        const before = new Set(winsRef.current.map((w) => w.id));
        openUrl(url);
        for (let i = 0; i < 20; i++) {
          const w = winsRef.current.find((x) => !before.has(x.id));
          if (w) { const p = await livePage(w.id); return `Opened window ${w.id}: ${p.title() || url}`; }
          await new Promise((r) => setTimeout(r, 150));
        }
        throw new Error("That address couldn't be opened");
      }
      case "search_web":
        await agentAct({ agent: "scout", do: "search", query: String(input.query ?? "") });
        await new Promise((r) => setTimeout(r, 300));
        return JSON.stringify((modelRef.current?.sources ?? []).slice(0, 15).map((s) => ({ title: s.title, url: s.canonicalUrl })));
      case "read_page": {
        const w = agentWindow(input.window);
        const p = await livePage(w.id);
        return inParts(p.url(), await p.text(), Number(input.offset) || 0);
      }
      case "see_page": {
        const p = await livePage(agentWindow(input.window).id);
        return fromPage(p.url(), JSON.stringify(await p.read(seeScript)));
      }
      case "focus_window": case "close_window":
        await agentAct({ agent: "navigator", do: name === "close_window" ? "close" : "focus", match: agentWindow(input.window).id });
        return "Done";
      case "arrange_windows":
        await agentAct({ agent: "navigator", do: "arrange" });
        return "Done";
      case "save_note":
        keepCrew((c) => c.map((a) => (a.id === agent.id ? { ...a, notes: [{ title: String(input.title).slice(0, 120), text: String(input.text).slice(0, 20_000), at: Date.now() }, ...a.notes].slice(0, 50) } : a)));
        return "Saved";
      case "click": case "type_text": {
        if (agent.access === "read") throw new Error("This agent may only read");
        const p = await livePage(agentWindow(input.window).id);
        const n = Number(input.element);
        const el = await p.read<{ label: string; secret: boolean }>(labelScript(n));
        if (!el) throw new Error(`No element ${n} on the page. Use see_page again.`);
        if (el.secret) throw new Error("Password and payment fields are left to the person.");
        const site = p.url().replace(/^https?:\/\/(www\.)?/, "").split("/")[0];
        const what = name === "click" ? `${agent.name} wants to click “${el.label}” on ${site}.` : `${agent.name} wants to type “${String(input.text).slice(0, 120)}” into “${el.label}” on ${site}${input.submit ? " and submit it" : ""}.`;
        const q = needsApproval(agent.access, `${what}${input.submit ? " submit" : ""}`);
        if (q && !(await ask(what))) return "The person declined this.";
        const ok = await p.read<boolean>(name === "click" ? clickScript(n) : typeScript(n, String(input.text), !!input.submit));
        if (!ok) throw new Error("That couldn't be done");
        await new Promise((r) => setTimeout(r, 1200));
        return `Done. The page is now ${p.url()}`;
      }
      default:
        throw new Error(`Unknown tool ${name}`);
    }
  }, [agentAct, keepCrew, openUrl]);

  const startAgent = useCallback((agent: Agent) => {
    stops.current.get(agent.id)?.abort();
    const ctrl = new AbortController();
    stops.current.set(agent.id, ctrl);
    let current: Run = { agentId: agent.id, status: "working", steps: [], said: "" };
    const update = (patch: (r: Run) => Run) => { current = patch(current); const next = current; setRuns((rs) => ({ ...rs, [agent.id]: next })); };
    update((r) => r);
    workbench.current.set(agent.id, { data: new Map(), readMail: false, signal: ctrl.signal });

    runAgent(agent, {
      turn: (messages) => crewTurn({ name: agent.name, role: agent.role, task: agent.task, plan: agent.plan, access: agent.access, provider: agent.provider ?? "anthropic", model: agent.model, skills: skillsOf(agent), memory: agent.memory ?? [] }, messages, ctrl.signal) as never,
      tool: (name, input, ask) => agentTool(agent, name, input, ask),
      update,
      signal: ctrl.signal,
    }).then(() => {
      const { report, steps } = current;
      if (report) keepCrew((c) => c.map((a) => (a.id === agent.id ? { ...a, last: { at: Date.now(), report }, xp: (a.xp ?? 0) + steps.filter((s) => s.status === "done").length } : a)));
    }).catch((err) => {
      update((r) => ({ ...r, status: ctrl.signal.aborted ? "stopped" : "failed", error: ctrl.signal.aborted ? undefined : (err as Error).message, ask: undefined }));
    }).finally(() => {
      if (stops.current.get(agent.id) === ctrl) workbench.current.delete(agent.id); // a run's data goes with it
    });
  }, [agentTool, keepCrew]);
  const working = crew.filter((a) => runs[a.id]?.status === "working");
  const needsYou = working.some((a) => runs[a.id]?.ask);

  const inspectSource = model && inspect ? model.sources.find((s) => s.id === inspect.sourceId) : undefined;
  const inspectEvidence: Evidence | undefined = model && inspect?.evidenceId ? model.evidence.find((e) => e.id === inspect.evidenceId) : undefined;
  const needsLocation = !!model?.notices.some((n) => n.code === "location_required") && !streaming;
  const notices = (model?.notices ?? []).filter((n) => n.code !== "location_required" && !dismissed.has(n.code));
  const View = model ? VIEWS[model.visualization] ?? MindMapView : null;
  const dataMode = model?.dataMode ?? (health?.demo ? "sample" : "live");
  const browsing = wins.some((w) => !w.minimized);
  const home = !frames.length && !browsing;

  return (
    <div className={`app ${frames.length ? "app--env" : "app--orient"} ${inspectSource ? "app--inspecting" : ""}`}
      onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) e.preventDefault(); }}
      onDrop={(e) => { const files = [...e.dataTransfer.files]; if (files.length) { e.preventDefault(); openFiles(files, { x: e.clientX, y: e.clientY }); } }}>
      <input ref={fileInput} type="file" multiple accept={ACCEPT} hidden onChange={(e) => { const files = [...(e.target.files ?? [])]; e.target.value = ""; if (files.length) openFiles(files); }} />
      <Field
        ref={field}
        reduced={reduced}
        cursorHint={frames.length ? "Ask" : "Ask anything"}
        onBackground={(x, y) => setComposer({ x, y })}
        onKeyAsk={() => askAtBar()}
        onEscape={onEscape}
        backdrop={<>
          <Planet dim={frames.length > 0 || surround} quiet={browsing} reduced={reduced} onSeed={(q) => { minimizeAll(); run(q, { fresh: true, at: field.current?.center() }); }} />
        </>}
      >
        {model && layout && View && (
          <div className={`env env--${model.visualization}`} key={top.key}>
            <View model={model} layout={layout} selectedId={top.selectedId} onSelect={select} onPrepare={(source, kind) => setAction({ source, kind })} onOpen={openUrl} onOpenGroup={openGroup} />
          </div>
        )}
      </Field>

      <header className="topbar" data-ui>
        <button className="wordmark" onClick={resetAll} aria-label="Warpnaut — return to the beginning">
          <Logo />
          <span className="wordmark__name">Warpnaut</span>
        </button>
        {frames.length > 0 && (
          <nav className="trail" aria-label="Exploration path">
            {frames.map((f, i) => (
              <button key={f.key} className="trail__item" aria-current={i === frames.length - 1 ? "step" : undefined}
                onClick={() => popTo(i)} disabled={i === frames.length - 1}>
                {f.model?.intent.constraints.topic || f.query}
              </button>
            ))}
          </nav>
        )}
        <div className="topbar__right">
          {dataMode !== "live" && <span className={`mode mode--${dataMode}`}>{dataMode === "sample" ? "Sample data" : dataMode === "mixed" ? "Live + sample" : ""}</span>}
          <RamBuddy />
          <Clock />
          <span className="topbar__sep" aria-hidden="true" />
          <button className={`avatar ${accounts?.google ? "is-signed-in" : ""}`} onClick={() => setAccountOpen((o) => !o)} aria-label="Accounts" aria-expanded={accountOpen}
            title={accounts?.google ? "Signed in to Google" : "Accounts: sign in with Google"}>
            {prefs.preferences.name ? prefs.preferences.name.trim().charAt(0).toUpperCase()
              : <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="9" r="3.6" /><path d="M5 20c1.3-3.6 4-5.2 7-5.2s5.7 1.6 7 5.2" strokeLinecap="round" /></svg>}
          </button>
          {desktop && <button className="voice" onClick={enterRoom} aria-label="360° view" title="360° view: your tabs all around you">
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><ellipse cx="12" cy="12" rx="9" ry="4" /><path d="M6 7.5V6a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1.5M6 16.5V18a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-1.5" /></svg>
          </button>}
          <button className={`voice ${agents ? "is-on" : ""}`} onClick={() => setAgents((a) => (a ? null : { listen: true, key: Date.now() }))} aria-label="Agents: speak once" title="Agents: speak once, the crew does the rest (⌘⇧Space)">
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M4 10v4M8 7v10M12 4v16M16 8v8M20 10.5v3" /></svg>
          </button>
        </div>
      </header>

      {home && <Suggested prefs={prefs} onRun={(q) => run(q, { fresh: true, at: field.current?.center() })} />}

      {home && !composer && (
        <div className="invite" aria-hidden="true">
          <p className="invite__keys"><span className="invite__ring" />Click anywhere to ask, speak, or drop a file</p>
        </div>
      )}

      {frames.length > 0 && (
        <button className="back" data-ui onClick={goBack} aria-label="Back">
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M15 6l-6 6 6 6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
          <span>Back</span>
        </button>
      )}


      {composer && (
        <Composer
          x={composer.x}
          y={composer.y}
          initial={composer.initial}
          startListening={composer.listen}
          placeholder={composer.tabIn ? "New tab: an address or a search" : composer.addTo ? "Add a page: an address, “play …”, or a topic" : "Ask, open an address, or “play …”"}
          onSubmit={(q) => {
            const tab = parseOpenRequest(q);
            const google = `https://www.google.com/search?q=${encodeURIComponent(q)}`;
            if (composer.tabIn) return openTab(tab ?? { kind: "web", src: google, href: google, title: q, domain: "google.com" }, undefined, undefined, undefined, { tabIn: composer.tabIn });
            if (composer.addTo) return openTab(tab ?? webSearchTab(q), undefined, composer.addTo);
            if (tab) return composer.fromBar ? openTab(tab, undefined, undefined, { x: window.innerWidth / 2, y: window.innerHeight - 40 }) : openTab(tab, composer);
            minimizeAll(); // a question builds an environment; open windows step aside to the control bar
            run(q, { fresh: true, at: frames.length ? undefined : composer });
          }}
          onClose={() => setComposer(null)}
        />
      )}

      {needsLocation && top && (
        <LocationAsk
          onChoose={(loc) => {
            setLocation(loc);
            if (prefs.rememberLocation) update((p) => ({ ...p, savedLocation: loc }));
            run(top.query, { push: false, loc });
          }}
          onCancel={goBack}
        />
      )}

      <div className="dock" data-ui>
        {sync.notice && (
          <p className="notice notice--info" role="status">
            {sync.notice}
            <button className="icon-btn icon-btn--small" aria-label="Dismiss" onClick={sync.dismissNotice}>×</button>
          </p>
        )}
        {notices.map((n) => (
          <p key={n.code} className={`notice notice--${n.level}`}>
            {n.message}
            <button className="icon-btn icon-btn--small" aria-label="Dismiss" onClick={() => setDismissed((d) => new Set(d).add(n.code))}>×</button>
          </p>
        ))}
        {engineAsk && <p className="engine-ask" role="status">{engineAsk}</p>}
        {(streaming || model || error) && <Progress model={model} streaming={streaming} error={error} />}
      </div>

      {inspectSource && model && (
        <Inspector
          model={model}
          source={inspectSource}
          focusEvidence={inspectEvidence}
          kept={prefs.kept.some((k) => k.id === inspectSource.id)}
          onClose={() => setInspect(null)}
          onKeep={() => update((p) => (p.kept.some((k) => k.id === inspectSource.id)
            ? { ...p, kept: p.kept.filter((k) => k.id !== inspectSource.id) }
            : { ...p, kept: [{ id: inspectSource.id, title: inspectSource.title, canonicalUrl: inspectSource.canonicalUrl, domain: inspectSource.domain, publisher: inspectSource.publisher, contentType: inspectSource.contentType }, ...p.kept] }))}
          onDeeper={(q) => run(q, { depth: "deep" })}
          onPrepare={(kind) => setAction({ source: inspectSource, kind })}
          onOpen={(url, title) => openUrl(url, title, { x: window.innerWidth / 2 - 200, y: window.innerHeight / 2 })}
        />
      )}

      <Windows wins={wins} update={setWins} overview={overview} onOverview={setOverview} surround={surround} onRoomHome={() => { setSurround(false); minimizeAll(); }} onFloating={floatWindows} onOpenUrl={openUrl} newTab={newTab} dock={dock}
        onDock={(item, at) => { if (item.url) return onDockItem(item, at); setSurround(false); minimizeAll(); onDockItem(item, at); }}
        shared={sync.sharedGroups} sharePeers={Object.fromEntries(sync.shares.map((s) => [s.group, s.status.peers]))} onShare={(g) => { sync.shareGroup(g); setSyncOpen({ group: g }); }}
        onAddPage={(w) => setComposer({ x: w.x + w.w / 2 - 260, y: Math.max(16, w.y - 70), addTo: w.id })}
        onNewTab={(w) => setComposer({ x: w.x + w.w / 2 - 260, y: Math.max(16, w.y + 90), tabIn: w.id })}
        roomCrew={crew.map((a) => { const r = runs[a.id]; const last = r?.steps[r.steps.length - 1]; return { id: a.id, name: a.name, hue: a.hue, status: r?.ask ? "waiting" : r?.status === "working" ? "working" : "idle", doing: last ? stepText(last) : undefined }; })}
        onRoomCrew={() => setStationOpen(true)}
        onRead={(url) => { setWins((ws) => ws.filter((w) => w.page.href !== url)); run(url, { fresh: true }); }}
        onAsk={(q) => { setSurround(false); minimizeAll(); run(q, { fresh: true }); }}
        findIn={findIn} onFindClose={() => setFindIn(null)} addressFocus={addressFocus}
        ai={{ model: health?.model?.label ?? null, vision: !!health?.vision }} onConnectAI={() => (desktop ? setSettingsOpen(true) : setPrivacyOpen(true))}
        onAttach={(w, f) => { setWins((ws) => ws.map((x) => (x.id === w.id ? { ...x, page: { ...x.page, title: f.name } } : x))); loadFileInto(w.page.src, f); }}
        onPin={togglePin} pinned={isPinned} />

      {sites.length > 1 && !browsing && !surround && (
        <button className="tabs-all" data-ui onClick={() => void openTabs(sites)}>Open all {sites.length} sites as tabs</button>
      )}
      <ControlBar wins={wins} home={home} items={dock} onItems={setDock} onItem={onDockItem} aiReady={!!health?.llm}
        onLibrary={desktop ? () => setLibrary((l) => (l ? null : "history")) : undefined} onSettings={desktop ? () => setSettingsOpen(true) : () => setPrivacyOpen(true)}
        downloading={downloads.filter((d) => d.state === "progressing").length} overview={overview} onOverview={setOverview} onPlace={openPlace}
        syncState={sync.personal ? sync.personalStatus?.state ?? "connecting" : sync.shares.length ? "shared" : "off"} onSync={() => setSyncOpen({})}
        onHome={() => { setOverview(false); if (browsing) minimizeAll(); else resetAll(); }}
        onRestore={(ids) => setWins((ws) => { let top = Math.max(0, ...ws.map((w) => w.z)); return ws.map((w) => (ids.includes(w.id) ? { ...w, minimized: false, z: ++top } : w)); })} />

      {action && (
        <ActionSheet
          source={action.source}
          kind={action.kind}
          defaultName={prefs.preferences.name}
          defaultNeed={action.kind === "prepare_reservation" ? [model?.intent.constraints.topic && `Do you serve ${model.intent.constraints.topic}?`, prefs.preferences.dietary && `Dietary note: ${prefs.preferences.dietary}.`].filter(Boolean).join(" ") : ""}
          onClose={() => setAction(null)}
        />
      )}

      {syncOpen && <SyncSheet sync={sync} wins={wins} health={health} focusGroup={syncOpen.group} onClose={() => setSyncOpen(null)} />}

      {invite && (
        <JoinSheet invite={invite} hasPersonal={!!sync.personal && sync.personal.id !== invite.creds.id}
          onJoin={() => { sync.join(invite); setInvite(null); }} onClose={() => setInvite(null)} />
      )}

      {library && desktop && <LibrarySheet tab={library} downloads={downloads} onTab={setLibrary} onClose={() => setLibrary(null)} onOpen={(url) => { setLibrary(null); openLink(url); }} />}
      {boardOpen && <ResearchBoard board={board} aiReady={!!health?.llm} onChange={keepBoard} onAsk={(q) => { setBoardOpen(false); minimizeAll(); void run(q, { fresh: true, at: field.current?.center() }); }}
        onOpenPages={(pages) => { setBoardOpen(false); void openTabs(pages); }} onConnectModel={() => { setBoardOpen(false); if (desktop) setSettingsOpen(true); else setPrivacyOpen(true); }} onClose={() => setBoardOpen(false)} />}
      {stationOpen && <AgentStation reduced={reduced} onSettings={() => { setStationOpen(false); if (desktop) setSettingsOpen(true); else setPrivacyOpen(true); }} onOpenApp={(id, title) => { setStationOpen(false); openUrl(appUrl(id), title); }} agents={crew} runs={runs}
        onSave={(a) => keepCrew((c) => (c.some((x) => x.id === a.id) ? c.map((x) => (x.id === a.id ? a : x)) : [...c, a]))}
        onDelete={(id) => { stops.current.get(id)?.abort(); keepCrew((c) => c.filter((a) => a.id !== id)); }}
        onStart={startAgent} onStop={(id) => stops.current.get(id)?.abort()} onClose={() => setStationOpen(false)} />}
      {!stationOpen && working.length > 0 && (
        <button className={`station-pill is-working ${needsYou ? "is-ask" : ""}`} data-ui onClick={() => setStationOpen(true)}>
          {working.slice(0, 5).map((a) => <span key={a.id} className="mm__dot is-working" style={{ ["--hue" as string]: a.hue }} aria-hidden="true" />)}
          {needsYou ? "An agent needs you" : `${working.length} agent${working.length > 1 ? "s" : ""} working`}
        </button>
      )}
      {agents && <AgentConsole key={agents.key} listen={agents.listen} voice={health?.voice ?? null} model={health?.model?.label ?? null}
        context={agentContext} act={agentAct} onConnect={() => { setAgents(null); if (desktop) setSettingsOpen(true); else setPrivacyOpen(true); }} onClose={() => setAgents(null)} />}
      {accountOpen && <AccountMenu accounts={accounts} onAccounts={setAccounts} onOpen={(url, title) => openUrl(url, title)} onData={() => setPrivacyOpen(true)} onClose={() => setAccountOpen(false)} />}
      {settingsOpen && desktop && <SettingsSheet onClose={() => { setSettingsOpen(false); void getHealth().then(setHealth); loadEngine(); }} />}
      {asks[0] && <PermissionPrompt key={asks[0].id} ask={asks[0]} onAnswer={(ok) => { void desktop?.invoke("permission:answer", asks[0].id, ok); setAsks((a) => a.slice(1)); }} />}
      {appUpdate && (
        <p className="update-note" data-ui role="status">
          Warpnaut {appUpdate.version} {appUpdate.ready ? "is ready." : "is available."}
          {appUpdate.ready ? <button className="btn btn--small btn--primary" onClick={() => void desktop?.invoke("app:installUpdate")}>Restart to update</button>
            : appUpdate.manual && appUpdate.url && <button className="btn btn--small" onClick={() => void desktop?.invoke("app:openExternal", appUpdate.url)}>Download</button>}
          <button className="icon-btn icon-btn--small" aria-label="Dismiss" onClick={() => setAppUpdate(null)}>×</button>
        </p>
      )}

      {privacyOpen && (
        <PrivacySheet
          prefs={prefs}
          model={health?.model ?? null}
          sessionLocation={location}
          onUpdate={update}
          onForgetLocation={() => { setLocation(null); update((p) => ({ ...p, savedLocation: null })); }}
          onClearAll={() => { clearAll(); sync.forgetAll(); setLocation(null); saveSpace(null); setWins([]); void desktop?.invoke("history:clear"); void desktop?.invoke("data:clearSite"); }}
          onClose={() => setPrivacyOpen(false)}
          onRun={(q) => { setPrivacyOpen(false); run(q); }}
        />
      )}
    </div>
  );
}

/** Date and time, top right, the way a headset shows them. */
function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 15_000); return () => clearInterval(t); }, []);
  return (
    <span className="clock">
      <span>{now.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}</span>
      <span>{now.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</span>
    </span>
  );
}

const SPACE_KEY = "warpnaut.space.v1";

function loadSpace(): Win[] {
  try {
    const raw = localStorage.getItem(SPACE_KEY);
    const ws = raw ? (JSON.parse(raw) as Win[]) : [];
    return Array.isArray(ws) ? ws.filter((w) => w?.page?.href).map((w) => ({ ...w, origin: undefined })) : [];
  } catch {
    return [];
  }
}

function saveSpace(ws: Win[] | null) {
  try {
    if (ws?.length) localStorage.setItem(SPACE_KEY, JSON.stringify(ws));
    else localStorage.removeItem(SPACE_KEY);
  } catch {
    /* storage unavailable: the space lasts for this visit only */
  }
}
