// Chrome extensions, in the browsing session (never in private windows). Electron runs a subset of Chrome's extension
// APIs: content scripts, storage, runtime, i18n, and parts of tabs and scripting work; context menus, notifications,
// declarativeNetRequest and the like do not, so an extension that leans on those is marked as one that may not work.
// Extensions come from the Chrome Web Store (its own download, unpacked here), from a folder, or from another
// Chromium browser on this computer. Each is copied into Warpnaut's own folder and loaded again at every start.
import { app, dialog, ipcMain, webContents, type BrowserWindow, type Session } from "electron";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, extname, join, sep } from "node:path";
import { storeIdOf, unzip, zipOfCrx } from "../shared/crx.ts";

interface Kept { dir: string; on: boolean; from: "store" | "folder" | "browser"; storeId?: string; added: number }
export interface ExtensionInfo {
  key: string; id: string | null; name: string; version: string; description: string; icon: string; on: boolean; from: Kept["from"];
  popup?: string; options?: string; permissions: string[]; hosts: string[]; unsupported: string[]; error?: string;
}

/** What Electron doesn't provide. An extension needing one of these may be partly or wholly broken. */
const UNSUPPORTED = new Set(["declarativeNetRequest", "declarativeNetRequestWithHostAccess", "declarativeNetRequestFeedback", "contextMenus", "notifications", "alarms", "downloads", "history", "bookmarks", "identity", "sidePanel", "offscreen", "tabGroups", "topSites", "sessions", "proxy", "debugger", "nativeMessaging", "tts", "ttsEngine", "fontSettings", "gcm", "pageCapture", "desktopCapture", "cookies", "privacy", "contentSettings", "browsingData", "commands", "omnibox", "search", "readingList", "system.cpu", "system.memory", "idle", "power", "geolocation"]);
const MAX_DOWNLOAD = 60 * 1024 * 1024;

// ---------- reading an extension's manifest ----------

function manifestOf(dir: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8").replace(/^﻿/, "")) as Record<string, unknown>;
}

/** A "__MSG_name__" string, in the extension's own default language. */
function localized(dir: string, m: Record<string, unknown>, text: unknown): string {
  const s = typeof text === "string" ? text : "";
  const key = s.match(/^__MSG_(.+)__$/)?.[1];
  if (!key) return s;
  for (const lang of [m.default_locale, "en", "en_US"].filter(Boolean) as string[]) {
    try {
      const messages = JSON.parse(readFileSync(join(dir, "_locales", lang, "messages.json"), "utf8").replace(/^﻿/, "")) as Record<string, { message: string }>;
      const hit = Object.entries(messages).find(([k]) => k.toLowerCase() === key.toLowerCase());
      if (hit) return hit[1].message;
    } catch { /* try the next language */ }
  }
  return s;
}

function iconOf(dir: string, m: Record<string, unknown>): string {
  const icons = { ...((m.action as { default_icon?: unknown })?.default_icon as Record<string, string> | undefined), ...(m.icons as Record<string, string> | undefined) };
  const sizes = Object.keys(icons).map(Number).filter((n) => n > 0).sort((a, b) => a - b);
  const pick = sizes.find((n) => n >= 64) ?? sizes[sizes.length - 1];
  const file = pick ? icons[String(pick)] : undefined;
  if (!file) return "";
  try {
    const type = { ".png": "image/png", ".svg": "image/svg+xml", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" }[extname(file).toLowerCase()];
    return type ? `data:${type};base64,${readFileSync(join(dir, file.replace(/^\//, ""))).toString("base64")}` : "";
  } catch { return ""; }
}

function describe(key: string, k: Kept, id: string | null, error?: string): ExtensionInfo {
  try {
    const m = manifestOf(k.dir);
    const perms = [...((m.permissions as string[]) ?? []), ...((m.optional_permissions as string[]) ?? [])].filter((p) => typeof p === "string");
    const hosts = [...((m.host_permissions as string[]) ?? []), ...perms.filter((p) => p.includes("://") || p === "<all_urls>"), ...((m.content_scripts as { matches?: string[] }[]) ?? []).flatMap((c) => c.matches ?? [])];
    return {
      key, id, name: localized(k.dir, m, m.name) || "Unnamed extension", version: String(m.version ?? ""), description: localized(k.dir, m, m.description), icon: iconOf(k.dir, m), on: k.on, from: k.from,
      popup: ((m.action ?? m.browser_action) as { default_popup?: string } | undefined)?.default_popup?.replace(/^\//, ""),
      options: ((m.options_ui as { page?: string } | undefined)?.page ?? (m.options_page as string | undefined))?.replace(/^\//, ""),
      permissions: perms.filter((p) => !p.includes("://") && p !== "<all_urls>"), hosts: [...new Set(hosts)], unsupported: perms.filter((p) => UNSUPPORTED.has(p)), error,
    };
  } catch (e) {
    return { key, id, name: "An extension that can't be read", version: "", description: "", icon: "", on: false, from: k.from, permissions: [], hosts: [], unsupported: [], error: String((e as Error).message ?? e) };
  }
}

// ---------- other browsers on this computer ----------

function browserRoots(): { name: string; dir: string }[] {
  const h = homedir();
  const mac = (p: string) => join(h, "Library", "Application Support", p);
  const win = (p: string) => join(process.env.LOCALAPPDATA ?? join(h, "AppData", "Local"), p);
  const lin = (p: string) => join(h, ".config", p);
  const list = process.platform === "darwin"
    ? [["Chrome", mac("Google/Chrome")], ["Brave", mac("BraveSoftware/Brave-Browser")], ["Edge", mac("Microsoft Edge")], ["Arc", mac("Arc/User Data")], ["Vivaldi", mac("Vivaldi")], ["Chromium", mac("Chromium")]]
    : process.platform === "win32"
      ? [["Chrome", win("Google/Chrome/User Data")], ["Brave", win("BraveSoftware/Brave-Browser/User Data")], ["Edge", win("Microsoft/Edge/User Data")], ["Vivaldi", win("Vivaldi/User Data")], ["Chromium", win("Chromium/User Data")]]
      : [["Chrome", lin("google-chrome")], ["Brave", lin("BraveSoftware/Brave-Browser")], ["Edge", lin("microsoft-edge")], ["Vivaldi", lin("vivaldi")], ["Chromium", lin("chromium")]];
  return list.map(([name, dir]) => ({ name, dir })).filter((b) => existsSync(b.dir));
}

/** Extensions installed in other Chromium browsers here: their newest version, themes and Chrome's own left out. */
function inOtherBrowsers() {
  const found: { browser: string; id: string; dir: string; name: string; icon: string; version: string }[] = [];
  for (const b of browserRoots()) {
    let profiles: string[] = [];
    try { profiles = readdirSync(b.dir).filter((p) => p === "Default" || /^Profile \d+$/.test(p)); } catch { continue; }
    for (const profile of profiles) {
      const base = join(b.dir, profile, "Extensions");
      let ids: string[] = [];
      try { ids = readdirSync(base).filter((id) => /^[a-p]{32}$/.test(id)); } catch { continue; }
      for (const id of ids) {
        try {
          const versions = readdirSync(join(base, id)).filter((v) => existsSync(join(base, id, v, "manifest.json"))).sort();
          const dir = join(base, id, versions[versions.length - 1]);
          const m = manifestOf(dir);
          if (m.theme || found.some((f) => f.id === id)) continue;
          found.push({ browser: b.name, id, dir, name: localized(dir, m, m.name), icon: iconOf(dir, m), version: String(m.version ?? "") });
        } catch { /* not an extension Warpnaut can read */ }
      }
    }
  }
  return found;
}

// ---------- the manager ----------

export function extensions(deps: { session: () => Session; host: () => BrowserWindow | null }) {
  const root = join(app.getPath("userData"), "extensions");
  const indexFile = join(root, "index.json");
  mkdirSync(root, { recursive: true });
  let kept: Record<string, Kept> = {};
  try { kept = JSON.parse(readFileSync(indexFile, "utf8")) as Record<string, Kept>; } catch { /* none yet */ }
  const save = () => writeFileSync(indexFile, JSON.stringify(kept, null, 1));
  const loaded = new Map<string, string>(); // key → Electron's extension id
  const errors = new Map<string, string>();
  const staged = new Map<string, { dir: string; from: Kept["from"]; storeId?: string }>();

  async function load(key: string) {
    const k = kept[key];
    try {
      // "_metadata" is Chrome's own bookkeeping; a loader that isn't Chrome refuses folders that have it.
      rmSync(join(k.dir, "_metadata"), { recursive: true, force: true });
      const ext = await deps.session().extensions.loadExtension(k.dir, { allowFileAccess: false });
      loaded.set(key, ext.id);
      errors.delete(key);
    } catch (e) { errors.set(key, String((e as Error).message ?? e)); }
  }
  const unload = (key: string) => { const id = loaded.get(key); if (id) { try { deps.session().extensions.removeExtension(id); } catch { /* already gone */ } loaded.delete(key); } };
  const list = () => Object.entries(kept).sort((a, b) => a[1].added - b[1].added).map(([key, k]) => describe(key, k, loaded.get(key) ?? null, errors.get(key)));

  /** Copies a folder in as a staged extension, so it can be looked over before it's added. */
  function stage(from: Kept["from"], fill: (dir: string) => void, storeId?: string) {
    const token = createHash("sha256").update(`${Date.now()}${Math.random()}`).digest("hex").slice(0, 16);
    const dir = join(root, ".staging", token);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    try {
      fill(dir);
      if (!existsSync(join(dir, "manifest.json"))) throw new Error("There's no manifest.json: this isn't an extension folder.");
      const m = manifestOf(dir);
      if (m.theme) throw new Error("This is a Chrome theme, not an extension.");
    } catch (e) { rmSync(dir, { recursive: true, force: true }); throw e; }
    staged.set(token, { dir, from, storeId });
    return { token, ...describe(token, { dir, on: false, from, storeId, added: Date.now() }, null) };
  }

  // The page whose bar opened the shelf: what a popup means by "the active tab".
  let activeWc = -1;
  ipcMain.handle("ext:setActive", (_e, id: number) => { activeWc = Number(id); });
  const activeTab = () => {
    const wc = webContents.fromId(activeWc);
    if (!wc || wc.isDestroyed()) return null;
    return { id: wc.id, url: wc.getURL(), title: wc.getTitle(), active: true, highlighted: true, windowId: 1, index: 0, incognito: false, pinned: false, status: wc.isLoading() ? "loading" : "complete", discarded: false, autoDiscardable: true, audible: wc.isCurrentlyAudible(), mutedInfo: { muted: wc.isAudioMuted() } };
  };
  ipcMain.handle("ext:activeTab", (e) => (e.sender.getURL().startsWith("chrome-extension://") ? activeTab() : null));
  // An extension's worker asks the same question on its own channel.
  const answered = new Set<number>();
  const ses = deps.session();
  ses.serviceWorkers.on("running-status-changed", ({ versionId }) => {
    const w = ses.serviceWorkers.getWorkerFromVersionID(versionId);
    if (!w || answered.has(versionId) || !w.scope.startsWith("chrome-extension://")) return;
    answered.add(versionId);
    try { w.ipc.handle("ext:activeTab", () => activeTab()); } catch { /* already answering */ }
  });

  ipcMain.handle("ext:list", () => ({ installed: list(), browsers: inOtherBrowsers().map(({ dir: _dir, ...b }) => b) }));

  ipcMain.handle("ext:fromStore", async (_e, text: string) => {
    const id = storeIdOf(String(text));
    if (!id) throw new Error("That isn't a Chrome Web Store link or extension id.");
    const url = `https://clients2.google.com/service/update2/crx?response=redirect&prodversion=${process.versions.chrome}&acceptformat=crx2,crx3&x=id%3D${id}%26uc`;
    const res = await fetch(url, { redirect: "follow" });
    if (!res.ok) throw new Error(`The Chrome Web Store didn't send it (${res.status}).`);
    const body = Buffer.from(await res.arrayBuffer());
    if (!body.length) throw new Error("The Chrome Web Store has no extension with that id, or it's only for Chrome.");
    if (body.length > MAX_DOWNLOAD) throw new Error("The extension is larger than 60 MB.");
    const files = unzip(zipOfCrx(body));
    return stage("store", (dir) => { for (const [name, data] of files) { const to = join(dir, name); if (!to.startsWith(dir + sep)) continue; mkdirSync(dirname(to), { recursive: true }); writeFileSync(to, data); } }, id);
  });

  ipcMain.handle("ext:fromFolder", async () => {
    const host = deps.host();
    const r = host ? await dialog.showOpenDialog(host, { title: "Choose an unpacked extension folder", properties: ["openDirectory"] }) : { canceled: true, filePaths: [] };
    if (r.canceled || !r.filePaths[0]) return null;
    return stage("folder", (dir) => cpSync(r.filePaths[0], dir, { recursive: true, filter: (src) => !src.split(sep).includes("node_modules") && !src.split(sep).includes(".git") }));
  });

  ipcMain.handle("ext:fromBrowser", (_e, id: string) => {
    const hit = inOtherBrowsers().find((b) => b.id === id);
    if (!hit) throw new Error("That extension isn't in another browser here any more.");
    return stage("browser", (dir) => cpSync(hit.dir, dir, { recursive: true }), id);
  });

  ipcMain.handle("ext:add", async (_e, token: string) => {
    const s = staged.get(token);
    if (!s) throw new Error("Look the extension over again before adding it.");
    staged.delete(token);
    const key = s.storeId ?? `local-${token}`;
    unload(key);
    const dir = join(root, key);
    rmSync(dir, { recursive: true, force: true });
    renameSync(s.dir, dir);
    kept[key] = { dir, on: true, from: s.from, storeId: s.storeId, added: Date.now() };
    save();
    await load(key);
    return list();
  });

  ipcMain.handle("ext:cancel", (_e, token: string) => { const s = staged.get(token); if (s) rmSync(s.dir, { recursive: true, force: true }); staged.delete(token); });

  ipcMain.handle("ext:toggle", async (_e, key: string, on: boolean) => {
    if (!kept[key]) return list();
    kept[key].on = !!on;
    save();
    if (on) await load(key); else unload(key);
    return list();
  });

  ipcMain.handle("ext:remove", (_e, key: string) => {
    if (!kept[key]) return list();
    unload(key);
    rmSync(kept[key].dir, { recursive: true, force: true });
    delete kept[key];
    save();
    return list();
  });

  return {
    /** Loads every extension that's on. Called once the browsing session exists. */
    async start() {
      rmSync(join(root, ".staging"), { recursive: true, force: true });
      // A few of Chrome's APIs that Electron lacks, filled in for extensions' background workers only.
      try { deps.session().registerPreloadScript({ type: "service-worker", id: "warpnaut-extension-shim", filePath: join(import.meta.dirname, "extension-shim.cjs") }); } catch { /* an older Electron: extensions run as they are */ }
      for (const [key, k] of Object.entries(kept)) if (k.on && existsSync(k.dir) && statSync(k.dir).isDirectory()) await load(key);
    },
    /** The script that fills in Chrome's missing APIs, for an extension's own pages. */
    shim: join(import.meta.dirname, "extension-shim.cjs"),
    /** Whether a chrome-extension:// address belongs to an extension that's on. */
    owns: (url: string) => { const id = url.match(/^chrome-extension:\/\/([a-p]{32})\//)?.[1]; return !!id && [...loaded.values()].includes(id); },
  };
}
