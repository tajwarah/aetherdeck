// Horus desktop: the spatial interface as a real browser. The interface runs in one window; every page is a
// <webview> (its own Chromium process) placed in a glass pane, so any site loads, nothing is framed or proxied.
// This process owns what a browser must: sessions and cookies, downloads, permission prompts, popups, the
// context menu, history and bookmarks, keys kept in the OS keychain, default-browser links, and updates.
import { app, BrowserWindow, Menu, globalShortcut, systemPreferences, clipboard, dialog, ipcMain, session, shell, webContents, type MenuItemConstructorOptions, type Session, type WebContents } from "electron";
import { randomBytes } from "node:crypto";
import { cpSync, existsSync } from "node:fs";
import { basename, extname, join } from "node:path";
import electronUpdater from "electron-updater";
import { CONFIG_NAMES, KEY_NAMES, Store, type ConfigName, type KeyName } from "./store.ts";
import { curvedPages } from "./curved.ts";
import { phones } from "./phone.ts";
import { shields } from "./shields.ts";
import pkg from "../package.json" with { type: "json" };

const DEV_URL = process.env.HORUS_DEV_URL; // `npm run desktop:dev`: the interface comes from Vite
const WEB = "persist:web";
const PRIVATE = "horus-private"; // not persisted: gone when the app quits
const HOMEPAGE = (pkg as { homepage?: string }).homepage; // the GitHub page, once package.json names it

let win: BrowserWindow | null = null;
let store: Store;
let curved: ReturnType<typeof curvedPages> | undefined;
let shield: ReturnType<typeof shields>;
let phone: ReturnType<typeof phones> | undefined;
const pending: string[] = []; // links opened before the interface was ready

if (!app.requestSingleInstanceLock()) app.quit();

// Sites see an ordinary Chrome, not "Electron" (some refuse to work otherwise).
app.userAgentFallback = app.userAgentFallback.replace(/ Electron\/\S+/, "").replace(/ horus\/\S+/i, "");

const isUrl = (s: string) => /^https?:\/\//i.test(s);
const send = (channel: string, payload?: unknown) => win?.webContents.send(channel, payload);

function openLink(url: string, from?: number) {
  if (!isUrl(url)) return;
  if (!win) { pending.push(url); return; }
  if (win.isMinimized()) win.restore();
  win.focus();
  send("horus:open", { url, from });
}

app.on("open-url", (e, url) => { e.preventDefault(); openLink(url); }); // macOS: Horus as the default browser
app.on("second-instance", (_e, argv) => { for (const a of argv) if (isUrl(a)) openLink(a); if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
for (const a of process.argv.slice(1)) if (isUrl(a)) pending.push(a);

// ---------- sessions: what every page runs inside ----------
const asked = new Map<number, (ok: boolean) => void>();
const remembered = new Map<string, boolean>(); // origin|permission → answer, for this run of the app
let askSeq = 0;
const ALWAYS = new Set(["fullscreen", "clipboard-sanitized-write", "pointerLock"]);
const ASK = new Set(["media", "geolocation", "notifications", "clipboard-read", "midi", "midiSysex", "idle-detection", "window-management", "display-capture"]);

async function googleAccount() {
  const jar = session.fromPartition(WEB).cookies;
  const [sid, yt] = await Promise.all([jar.get({ domain: ".google.com", name: "SID" }), jar.get({ domain: ".youtube.com", name: "LOGIN_INFO" })]);
  return { google: sid.length > 0, youtube: yt.length > 0 };
}

function setUpSession(s: Session) {
  s.setPermissionRequestHandler((wc, permission, callback, details) => {
    if (ALWAYS.has(permission)) return callback(true);
    if (!ASK.has(permission) || !win) return callback(false);
    const origin = (() => { try { return new URL(details.requestingUrl ?? wc.getURL()).origin; } catch { return "this page"; } })();
    const key = `${origin}|${permission}`;
    if (remembered.has(key)) return callback(remembered.get(key)!);
    const id = ++askSeq;
    asked.set(id, (ok) => { remembered.set(key, ok); callback(ok); });
    const media = (details as { mediaTypes?: string[] }).mediaTypes;
    send("horus:permission", { id, origin, permission, media });
  });
  s.setPermissionCheckHandler((_wc, permission) => ALWAYS.has(permission));

  s.on("will-download", (_e, item) => {
    const dir = app.getPath("downloads");
    const name = item.getFilename() || "download";
    let path = join(dir, name);
    for (let i = 1; existsSync(path); i++) path = join(dir, `${basename(name, extname(name))} (${i})${extname(name)}`);
    item.setSavePath(path);
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    let last = 0;
    const report = (force = false) => {
      if (!force && Date.now() - last < 250) return;
      last = Date.now();
      send("horus:download", { id, name: basename(path), path, url: item.getURL(), received: item.getReceivedBytes(), total: item.getTotalBytes(), state: item.getState(), paused: item.isPaused() });
    };
    downloads.set(id, item);
    report(true);
    item.on("updated", () => report());
    item.once("done", () => { report(true); downloads.delete(id); });
  });
}
const downloads = new Map<string, Electron.DownloadItem>();

// ---------- pages: popups, context menu ----------
app.on("web-contents-created", (_e, wc) => {
  if (wc.getType() === "webview") setUpPage(wc);
});

/** A page in a window (a <webview>, or a curved window's offscreen page): popups, its menu, other schemes. */
function setUpPage(wc: WebContents) {
  // A link that opens a new window opens a new pane beside this one, in its group.
  wc.setWindowOpenHandler(({ url }) => { openLink(url, wc.id); return { action: "deny" }; });
  shield.guard(wc);
  wc.on("context-menu", (_ev, p) => pageMenu(wc, p).popup());
  // Leaving the page for another scheme (mailto:, zoom:, …) goes to the app that handles it, after asking.
  wc.on("will-navigate", (ev, url) => {
    if (/^(https?|about|blob|data):/i.test(url)) return;
    ev.preventDefault();
    void dialog.showMessageBox(win!, { type: "question", buttons: ["Open", "Cancel"], defaultId: 0, message: `Open this link in another app?`, detail: url }).then((r) => { if (r.response === 0) void shell.openExternal(url); });
  });
}

function pageMenu(wc: WebContents, p: Electron.ContextMenuParams) {
  const t: MenuItemConstructorOptions[] = [];
  if (p.linkURL) {
    t.push({ label: "Open Link in New Window", click: () => openLink(p.linkURL, wc.id) });
    t.push({ label: "Open Link in Default Browser", click: () => void shell.openExternal(p.linkURL) });
    t.push({ label: "Copy Link", click: () => clipboard.writeText(p.linkURL) });
    t.push({ label: "Save Link As…", click: () => wc.downloadURL(p.linkURL) });
    t.push({ type: "separator" });
  }
  if (p.mediaType === "image" && p.srcURL) {
    t.push({ label: "Open Image in New Window", click: () => openLink(p.srcURL, wc.id) });
    t.push({ label: "Save Image As…", click: () => wc.downloadURL(p.srcURL) });
    t.push({ label: "Copy Image", click: () => wc.copyImageAt(p.x, p.y) });
    t.push({ label: "Copy Image Address", click: () => clipboard.writeText(p.srcURL) });
    t.push({ type: "separator" });
  }
  if (p.isEditable) {
    if (p.misspelledWord) {
      for (const s of p.dictionarySuggestions.slice(0, 4)) t.push({ label: s, click: () => wc.replaceMisspelling(s) });
      t.push({ type: "separator" });
    }
    t.push({ role: "undo" }, { role: "redo" }, { type: "separator" }, { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" }, { type: "separator" });
  } else if (p.selectionText) {
    const q = p.selectionText.trim().slice(0, 200);
    t.push({ role: "copy" }, { label: `Explore “${q.length > 30 ? `${q.slice(0, 30)}…` : q}” in Horus`, click: () => send("horus:command", { name: "ask", value: q }) }, { type: "separator" });
  }
  t.push(
    { label: "Back", enabled: wc.navigationHistory.canGoBack(), click: () => wc.navigationHistory.goBack() },
    { label: "Forward", enabled: wc.navigationHistory.canGoForward(), click: () => wc.navigationHistory.goForward() },
    { label: "Reload", click: () => wc.reload() },
    { type: "separator" },
    { label: "Save Page As…", click: () => void savePage(wc) },
    { label: "Print…", click: () => wc.print() },
    { label: "Inspect Element", click: () => wc.inspectElement(p.x, p.y) },
  );
  return Menu.buildFromTemplate(t);
}

async function savePage(wc: WebContents) {
  const r = await dialog.showSaveDialog(win!, { defaultPath: join(app.getPath("downloads"), `${(wc.getTitle() || "page").replace(/[\\/:*?"<>|]/g, "-")}.html`) });
  if (!r.canceled && r.filePath) await wc.savePage(r.filePath, "HTMLComplete");
}

/** Horus used to be called NEXUS: history, bookmarks, agents and phone tools come across, once. */
function bringOldData() {
  const old = join(app.getPath("appData"), "nexus");
  const dir = app.getPath("userData");
  if (!existsSync(old) || existsSync(join(dir, "library"))) return;
  for (const name of ["library", "phone"]) if (existsSync(join(old, name))) cpSync(join(old, name), join(dir, name), { recursive: true, verbatimSymlinks: true });
}

// ---------- the interface window ----------
function command(name: string) { return () => send("horus:command", { name }); }

/** One shortcut, from anywhere on the computer: Horus comes forward and the agents start listening. */
const AGENT_KEYS = "CommandOrControl+Shift+Space";
function summonAgents() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  send("horus:command", { name: "agent" });
}

function appMenu() {
  const mac = process.platform === "darwin";
  const t: MenuItemConstructorOptions[] = [
    ...(mac ? [{ role: "appMenu" as const, submenu: [{ role: "about" as const }, { type: "separator" as const }, { label: "Settings…", accelerator: "Cmd+,", click: command("settings") }, { label: "Connect Claude…", click: command("settings") }, { type: "separator" as const }, { role: "services" as const }, { type: "separator" as const }, { role: "hide" as const }, { role: "hideOthers" as const }, { role: "unhide" as const }, { type: "separator" as const }, { role: "quit" as const }] }] : []),
    { label: "File", submenu: [
      { label: "New Window", accelerator: "CmdOrCtrl+T", click: command("newWindow") },
      { label: "New Private Window", accelerator: "CmdOrCtrl+Shift+N", click: command("privateWindow") },
      { label: "Open File…", accelerator: "CmdOrCtrl+O", click: command("openFile") },
      { label: "Ask AI About This Page", accelerator: "CmdOrCtrl+Shift+A", click: command("assistant") },
      // the same keys work from any app (registered globally below); here they show in the menu
      { label: "Agents: Speak Once", accelerator: AGENT_KEYS, registerAccelerator: false, click: summonAgents },
      { label: "Open Location…", accelerator: "CmdOrCtrl+L", click: command("focusAddress") },
      { label: "Reopen Closed Window", accelerator: "CmdOrCtrl+Shift+T", click: command("reopenClosed") },
      { type: "separator" },
      { label: "Close Window", accelerator: "CmdOrCtrl+W", click: command("closeWindow") },
      { label: "Print…", accelerator: "CmdOrCtrl+P", click: command("print") },
      ...(mac ? [] : [{ type: "separator" as const }, { label: "Settings", accelerator: "Ctrl+,", click: command("settings") }, { role: "quit" as const }]),
    ] },
    { label: "Edit", submenu: [{ role: "undo" }, { role: "redo" }, { type: "separator" }, { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "pasteAndMatchStyle" }, { role: "selectAll" }, { type: "separator" }, { label: "Find in Page…", accelerator: "CmdOrCtrl+F", click: command("find") }] },
    { label: "View", submenu: [
      { label: "Reload Page", accelerator: "CmdOrCtrl+R", click: command("reload") },
      { label: "Zoom In", accelerator: "CmdOrCtrl+Plus", click: command("zoomIn") },
      { label: "Zoom In", accelerator: "CmdOrCtrl+=", visible: false, click: command("zoomIn") },
      { label: "Zoom Out", accelerator: "CmdOrCtrl+-", click: command("zoomOut") },
      { label: "Actual Size", accelerator: "CmdOrCtrl+0", click: command("zoomReset") },
      { type: "separator" },
      { label: "See All Windows", accelerator: mac ? "Ctrl+Up" : "Alt+Up", click: command("overview") },
      { label: "Home", accelerator: "CmdOrCtrl+Shift+H", click: command("home") },
      { type: "separator" },
      { role: "togglefullscreen" },
      { label: "360° View", accelerator: "CmdOrCtrl+Shift+U", click: command("surround") },
      { label: "Developer Tools for Page", accelerator: mac ? "Alt+Cmd+I" : "Ctrl+Shift+I", click: command("devtools") },
      ...(app.isPackaged ? [] : [{ role: "toggleDevTools" as const, label: "Developer Tools for Horus", accelerator: mac ? "Alt+Cmd+J" : "Ctrl+Shift+J" }]),
    ] },
    { label: "History", submenu: [
      { label: "Back", accelerator: "CmdOrCtrl+[", click: command("back") },
      { label: "Forward", accelerator: "CmdOrCtrl+]", click: command("forward") },
      { label: "Back", accelerator: "Alt+Left", visible: false, click: command("back") },
      { label: "Forward", accelerator: "Alt+Right", visible: false, click: command("forward") },
      { type: "separator" },
      { label: "Show History", accelerator: "CmdOrCtrl+Y", click: command("history") },
      { label: "Downloads", accelerator: "CmdOrCtrl+Shift+J", click: command("downloads") },
    ] },
    { label: "Bookmarks", submenu: [
      { label: "Bookmark This Page", accelerator: "CmdOrCtrl+D", click: command("bookmarkPage") },
      { label: "Show Bookmarks", accelerator: "CmdOrCtrl+Shift+B", click: command("bookmarks") },
    ] },
    { role: "windowMenu" },
    { role: "help", submenu: HOMEPAGE ? [{ label: "Horus on GitHub", click: () => void shell.openExternal(HOMEPAGE) }] : [] },
  ];
  return Menu.buildFromTemplate(t);
}

async function createWindow(target: string | Promise<string>) {
  const mac = process.platform === "darwin";
  let url = "";
  win = new BrowserWindow({
    width: 1500, height: 940, minWidth: 720, minHeight: 520,
    backgroundColor: "#0b0b0d", show: false, title: "Horus",
    titleBarStyle: mac ? "hiddenInset" : "hidden",
    ...(mac ? { trafficLightPosition: { x: 18, y: 22 } } : { titleBarOverlay: { color: "#0b0b0d", symbolColor: "#f5f5f7", height: 44 } }),
    webPreferences: { preload: join(import.meta.dirname, "preload.cjs"), contextIsolation: true, sandbox: true, webviewTag: true, spellcheck: true },
  });
  win.once("ready-to-show", () => win?.show());
  win.on("enter-full-screen", () => send("horus:fullscreen", true));
  win.on("leave-full-screen", () => send("horus:fullscreen", false));
  win.on("closed", () => { win = null; curved?.closeAll(); phone?.stopAll(); });

  const wc = win.webContents;
  // Pages may only be <webview>s running web content in a locked-down process: no preload, no Node.
  wc.on("will-attach-webview", (e, prefs, params) => {
    delete (prefs as { preload?: string }).preload;
    prefs.nodeIntegration = false;
    prefs.contextIsolation = true;
    prefs.sandbox = true;
    prefs.webSecurity = true;
    const okSrc = /^(https?:|about:blank)/i.test(params.src ?? "");
    if (!okSrc || (params.partition !== WEB && params.partition !== PRIVATE)) e.preventDefault();
  });
  // The interface itself never navigates away; its links open as panes.
  wc.on("will-navigate", (e, to) => { if (!to.startsWith(url)) { e.preventDefault(); openLink(to); } });
  wc.setWindowOpenHandler(({ url: to }) => { openLink(to); return { action: "deny" }; });
  // The interface may use the microphone (voice); nothing else.
  wc.session.setPermissionRequestHandler((_w, permission, cb) => cb(permission === "media" || permission === "clipboard-sanitized-write"));
  // The window (and its renderer process) starts while the server is still coming up; the page loads once it is.
  url = await target;
  await win.loadURL(url);
}

/** Which keys are available: saved in Settings, or (in development) from the project's .env. */
function keyStatus() {
  return Object.fromEntries(KEY_NAMES.map((k) => [k, Boolean(process.env[k])])) as Record<KeyName, boolean>;
}
const envConfig = () => Object.fromEntries(CONFIG_NAMES.filter((k) => process.env[k]).map((k) => [k, process.env[k]!]));

// ---------- requests from the interface ----------
function handlers() {
  ipcMain.handle("app:info", () => ({ version: app.getVersion(), platform: process.platform, keys: keyStatus(), contact: store.contact(), config: { ...envConfig(), ...store.config() }, isDefault: app.isDefaultProtocolClient("https"), packaged: app.isPackaged }));
  ipcMain.handle("app:setKeys", async (_e, update: Partial<Record<KeyName, string>>, contact?: string, config?: Partial<Record<ConfigName, string>>) => {
    const clean = Object.fromEntries(Object.entries(update ?? {}).filter(([k, v]) => (KEY_NAMES as readonly string[]).includes(k) && typeof v === "string" && v.length < 400));
    store.setKeys(clean, typeof contact === "string" ? contact.slice(0, 200) : undefined);
    if (config) store.setConfig(Object.fromEntries(Object.entries(config).filter(([k, v]) => (CONFIG_NAMES as readonly string[]).includes(k) && typeof v === "string" && v.length < 400)));
    // Take effect now: the server runs in this process and reads its keys from the environment.
    for (const k of Object.keys(clean)) delete process.env[k];
    for (const k of CONFIG_NAMES) if (config && k in config) delete process.env[k];
    Object.assign(process.env, store.keys(), store.config());
    if (typeof contact === "string") process.env.HORUS_CONTACT = contact.slice(0, 200);
    (await import("../server/models.ts")).resetBackend();
    return keyStatus();
  });
  // The models a key can use, which also proves the key works. A key typed but not yet saved can be tried.
  ipcMain.handle("ai:models", async (_e, provider: string, key?: string) => {
    const { AI_PROVIDERS, listModels } = await import("../server/models.ts");
    const p = AI_PROVIDERS.find((x) => x.id === provider);
    if (!p) return { error: "Unknown provider" };
    const apiKey = (typeof key === "string" && key.trim()) || store.keys()[p.keyEnv as KeyName] || process.env[p.keyEnv];
    if (!apiKey) return { error: "Enter a key first." };
    try { return { models: await listModels(provider, apiKey) }; } catch (err) { return { error: (err as Error).message }; }
  });
  ipcMain.handle("app:restart", () => { store.flush(); app.relaunch(); app.exit(0); });
  ipcMain.handle("app:setDefault", () => {
    app.setAsDefaultProtocolClient("http");
    app.setAsDefaultProtocolClient("https");
    if (process.platform === "win32") void shell.openExternal("ms-settings:defaultapps");
    return app.isDefaultProtocolClient("https");
  });
  ipcMain.handle("shields:status", () => shield.status());
  ipcMain.handle("shields:toggleSite", (_e, url: string) => shield.toggleSite(String(url)));
  ipcMain.handle("agents:list", () => store.agents);
  ipcMain.handle("agents:save", (_e, agents: unknown[]) => { if (Array.isArray(agents)) store.saveAgents(agents.slice(0, 100)); });
  ipcMain.handle("app:fullscreen", (_e, on: boolean) => win?.setFullScreen(Boolean(on)));
  ipcMain.handle("app:toggleFullscreen", () => win?.setFullScreen(!win.isFullScreen()));
  ipcMain.handle("app:openExternal", (_e, url: string) => { if (isUrl(url)) void shell.openExternal(url); });
  ipcMain.handle("app:ready", () => pending.splice(0));

  ipcMain.handle("permission:answer", (_e, id: number, ok: boolean) => { asked.get(id)?.(Boolean(ok)); asked.delete(id); });

  ipcMain.handle("history:visit", (_e, url: string, title: string) => store.visit(String(url).slice(0, 4000), String(title ?? "").slice(0, 400)));
  ipcMain.handle("history:search", (_e, q: string) => store.searchHistory(String(q ?? "")));
  ipcMain.handle("history:remove", (_e, url: string) => store.removeHistory(String(url)));
  ipcMain.handle("history:clear", () => { store.clearHistory(); return session.fromPartition(WEB).clearCache(); });
  ipcMain.handle("data:clearSite", () => session.fromPartition(WEB).clearStorageData());
  // Google and YouTube: signed in once in a page, signed in everywhere (one browsing session, as in Chrome).
  // Only whether a Google sign-in cookie exists is checked; no cookie value ever leaves the session.
  // The agents' voice: macOS asks the person once whether Horus may use the microphone.
  ipcMain.handle("app:microphone", async () => (process.platform === "darwin" ? systemPreferences.getMediaAccessStatus("microphone") === "granted" || systemPreferences.askForMediaAccess("microphone") : true));
  ipcMain.handle("account:google", () => googleAccount());
  ipcMain.handle("account:googleSignOut", async () => {
    const jar = session.fromPartition(WEB).cookies;
    const all = (await jar.get({})).filter((c) => /(^|\.)(google\.[a-z.]+|youtube\.com|accounts\.google\.com)$/.test((c.domain ?? "").replace(/^\./, "")));
    await Promise.all(all.map((c) => jar.remove(`http${c.secure ? "s" : ""}://${(c.domain ?? "").replace(/^\./, "")}${c.path ?? "/"}`, c.name)));
    return googleAccount();
  });
  ipcMain.handle("bookmarks:list", () => store.bookmarks);
  ipcMain.handle("bookmarks:toggle", (_e, url: string, title: string) => store.toggleBookmark(String(url).slice(0, 4000), String(title ?? "").slice(0, 400)));

  ipcMain.handle("downloads:open", (_e, path: string) => shell.openPath(path));
  ipcMain.handle("downloads:show", (_e, path: string) => shell.showItemInFolder(path));
  ipcMain.handle("downloads:cancel", (_e, id: string) => downloads.get(id)?.cancel());
  ipcMain.handle("downloads:folder", () => shell.openPath(app.getPath("downloads")));

  ipcMain.handle("page:print", (_e, id: number) => webContents.fromId(id)?.print());
  ipcMain.handle("page:devtools", (_e, id: number) => webContents.fromId(id)?.openDevTools({ mode: "detach" }));
}

function updates() {
  if (!app.isPackaged) return;
  const { autoUpdater } = electronUpdater;
  // Unsigned macOS builds cannot install updates themselves: tell the person instead.
  autoUpdater.autoDownload = process.platform !== "darwin";
  autoUpdater.on("update-available", (i) => send("horus:update", { version: i.version, manual: process.platform === "darwin", url: HOMEPAGE ? `${HOMEPAGE}/releases/latest` : undefined }));
  autoUpdater.on("update-downloaded", (i) => send("horus:update", { version: i.version, ready: true }));
  ipcMain.handle("app:installUpdate", () => autoUpdater.quitAndInstall());
  autoUpdater.checkForUpdates().catch(() => undefined);
}

app.whenReady().then(async () => {
  bringOldData();
  app.setAboutPanelOptions({ applicationName: "Horus", applicationVersion: app.getVersion(), copyright: "Your tabs, all around you." });
  store = new Store(join(app.getPath("userData"), "library"));
  // Development only: the project's .env (keys for trying things out). Released builds use Settings alone.
  if (!app.isPackaged && existsSync(join(import.meta.dirname, "..", ".env"))) process.loadEnvFile(join(import.meta.dirname, "..", ".env"));
  // The person's own keys, kept encrypted, become the server's environment.
  Object.assign(process.env, store.keys(), store.config());
  if (store.contact()) process.env.HORUS_CONTACT = store.contact();
  shield = shields({ dir: join(app.getPath("userData"), "library"), enabled: () => process.env.HORUS_SHIELDS !== "off", allowed: () => store.shieldsOff(), setAllowed: (sites) => store.setShieldsOff(sites), report: (p) => send("horus:shields", p) });
  void shield.load();
  shield.attach(session.fromPartition(WEB));
  shield.attach(session.fromPartition(PRIVATE));
  setUpSession(session.fromPartition(WEB));
  session.fromPartition(WEB).cookies.on("changed", (_e, c) => { if (c.name === "SID" || c.name === "LOGIN_INFO") void googleAccount().then((a) => send("horus:account", a)); });
  setUpSession(session.fromPartition(PRIVATE));
  handlers();
  curved = curvedPages({ host: () => win, setUpPage, partitions: new Set([WEB, PRIVATE]) });
  phone = phones({ dir: join(app.getPath("userData"), "phone"), send });
  Menu.setApplicationMenu(appMenu());

  const ready = (async () => {
    const { startServer } = await import("../server/index.ts");
    if (DEV_URL) {
      await startServer({ port: Number(process.env.HORUS_API_PORT ?? 8787), host: "127.0.0.1", dist: join(import.meta.dirname, "..", "dist"), dataDir: join(app.getPath("userData"), "sync") });
      return DEV_URL;
    }
    const token = randomBytes(24).toString("base64url");
    const { port } = await startServer({ port: 0, host: "127.0.0.1", dist: join(import.meta.dirname, "..", "dist"), dataDir: join(app.getPath("userData"), "sync"), token });
    const url = `http://127.0.0.1:${port}/`;
    await session.defaultSession.cookies.set({ url, name: "horus_token", value: token, httpOnly: true, sameSite: "strict" });
    return url;
  })();
  await createWindow(ready);
  const url = await ready;
  updates();
  // Another app may already own the keys; then the agents are still a click away in the top bar.
  if (!globalShortcut.register(AGENT_KEYS, summonAgents)) console.warn("Horus: the agents shortcut is taken by another app");
  app.on("activate", () => { if (!win) void createWindow(url); });
});

app.on("will-quit", () => globalShortcut.unregisterAll());
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("before-quit", () => { store?.flush(); phone?.stopAll(); });
