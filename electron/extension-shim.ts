// Runs before an extension's background worker and its own pages (its popup, its options; never a web page): fills a
// few gaps between Electron's extension APIs and Chrome's, so extensions that touch them in passing still work.
// chrome.storage.sync keeps its data in storage.local (nothing here syncs), alarms fire on timers while the worker
// runs, context menus and notifications are accepted but shown nowhere, commands (keyboard shortcuts) list none,
// permissions are what the manifest asked for, and in a popup chrome.tabs.query answers with the page it was opened from.
import { contextBridge, ipcRenderer } from "electron";

function fill() {
  type Fn = (...a: unknown[]) => unknown;
  const c = (globalThis as unknown as { chrome?: Record<string, Record<string, unknown>> }).chrome;
  if (!c?.runtime?.id) return;
  const put = (o: Record<string, unknown> | undefined, k: string, v: unknown) => { if (o && o[k] === undefined) { try { Object.defineProperty(o, k, { value: v, configurable: true, enumerable: true }); } catch { /* fixed by the browser */ } } };
  const event = () => { const fns = new Set<Fn>(); return { addListener: (f: Fn) => void fns.add(f), removeListener: (f: Fn) => void fns.delete(f), hasListener: (f: Fn) => fns.has(f), fire: (...a: unknown[]) => fns.forEach((f) => f(...a)) }; };
  const done = <T,>(cb: unknown, value?: T) => { if (typeof cb === "function") (cb as Fn)(value); return Promise.resolve(value); };
  // Electron has a storage.sync whose every call fails ("not available"); it's replaced, or its calls rerouted.
  const tab = (globalThis as unknown as { __warpnautTab?: { get: () => Promise<unknown> } }).__warpnautTab;
  if (tab && c.tabs) {
    // "Which tab is active?" gets the page the person is on; any other question goes to Electron as before.
    const own = (c.tabs.query as Fn).bind(c.tabs);
    const query = (q: unknown, cb?: unknown) => ((q as { active?: boolean })?.active ? tab.get().then((t) => (t ? [t] : [])) : Promise.resolve(own(q)))
      .then((list) => { if (typeof cb === "function") (cb as Fn)(list); return list; });
    try { c.tabs.query = query; } catch { try { Object.defineProperty(c.tabs, "query", { value: query, configurable: true }); } catch { /* fixed */ } }
  }
  const local = c.storage?.local as Record<string, unknown> | undefined;
  if (c.storage && local) {
    try { Object.defineProperty(c.storage, "sync", { value: local, configurable: true, enumerable: true }); } catch { /* fixed: reroute instead */ }
    const sync = c.storage.sync as unknown as Record<string, unknown> | undefined;
    if (sync && sync !== local) for (const k of ["get", "set", "remove", "clear", "getBytesInUse"]) { try { sync[k] = (local[k] as Fn).bind(local); } catch { /* read-only */ } }
  }
  put(c, "contextMenus", { create: (_p: unknown, cb?: unknown) => { void done(cb); return 0; }, update: (_i: unknown, _p: unknown, cb?: unknown) => done(cb), remove: (_i: unknown, cb?: unknown) => done(cb), removeAll: (cb?: unknown) => done(cb), onClicked: event() });
  const shown = event();
  put(c, "notifications", { create: (a: unknown, b?: unknown, cb?: unknown) => done(typeof a === "string" ? cb : b, typeof a === "string" ? a : `n${Date.now()}`), clear: (_i: unknown, cb?: unknown) => done(cb, true), getAll: (cb?: unknown) => done(cb, {}), onClicked: shown, onClosed: event(), onButtonClicked: event() });
  put(c, "extension", {});
  put(c.extension, "isAllowedFileSchemeAccess", (cb?: unknown) => done(cb, false));
  put(c.extension, "isAllowedIncognitoAccess", (cb?: unknown) => done(cb, false));
  put(c, "commands", { getAll: (cb?: unknown) => done(cb, []), onCommand: event() });
  // Permissions: what the manifest asked for is what it has; nothing more can be granted here.
  const manifest = (c.runtime.getManifest as Fn | undefined)?.() as { permissions?: string[]; host_permissions?: string[] } | undefined;
  const granted = { permissions: (manifest?.permissions ?? []).filter((p) => !p.includes("://")), origins: manifest?.host_permissions ?? [] };
  const has = (want?: { permissions?: string[]; origins?: string[] }) => (want?.permissions ?? []).every((p) => granted.permissions.includes(p)) && (want?.origins ?? []).every((o) => granted.origins.length > 0 || o === "");
  put(c, "permissions", { contains: (want: unknown, cb?: unknown) => done(cb, has(want as never)), getAll: (cb?: unknown) => done(cb, granted), request: (want: unknown, cb?: unknown) => done(cb, has(want as never)), remove: (_w: unknown, cb?: unknown) => done(cb, false), onAdded: event(), onRemoved: event() });
  const timers = new Map<string, { at: number; every?: number; t: ReturnType<typeof setTimeout> }>();
  const onAlarm = event();
  const info = (name: string) => { const a = timers.get(name); return a && { name, scheduledTime: a.at, periodInMinutes: a.every }; };
  put(c, "alarms", {
    create(a: unknown, b?: unknown) {
      const name = typeof a === "string" ? a : "";
      const o = (typeof a === "string" ? b : a) as { when?: number; delayInMinutes?: number; periodInMinutes?: number } ?? {};
      clearTimeout(timers.get(name)?.t);
      const every = o.periodInMinutes;
      const at = o.when ?? Date.now() + (o.delayInMinutes ?? every ?? 0) * 60000;
      const ring = () => { onAlarm.fire(info(name)); if (every) { const next = Date.now() + every * 60000; timers.set(name, { at: next, every, t: setTimeout(ring, every * 60000) }); } else timers.delete(name); };
      timers.set(name, { at, every, t: setTimeout(ring, Math.max(0, at - Date.now())) });
      return Promise.resolve();
    },
    get: (a?: unknown, cb?: unknown) => done(typeof a === "function" ? a : cb, info(typeof a === "string" ? a : "")),
    getAll: (cb?: unknown) => done(cb, [...timers.keys()].map(info)),
    clear: (a?: unknown, cb?: unknown) => { const name = typeof a === "string" ? a : ""; clearTimeout(timers.get(name)?.t); return done(typeof a === "function" ? a : cb, timers.delete(name)); },
    clearAll: (cb?: unknown) => { timers.forEach((x) => clearTimeout(x.t)); timers.clear(); return done(cb, true); },
    onAlarm,
  });
}

// The page the person is on, for chrome.tabs.query, in the extension's worker and in its own pages.
try { contextBridge.exposeInMainWorld("__warpnautTab", { get: () => ipcRenderer.invoke("ext:activeTab") }); } catch { /* no bridge here */ }
contextBridge.executeInMainWorld({ func: fill });
