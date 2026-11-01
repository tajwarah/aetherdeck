// The agent engine: pages an agent reads without opening a window. A small pool of invisible pages in the person's
// browsing session (so their sign-ins count), loading text and layout but no images, video or fonts. Pages are reused,
// retired before they grow, closed when idle, and the pool shrinks if the app is using too much of the computer's memory.
import { app, BrowserWindow, ipcMain, net, type WebContents } from "electron";
import { mkdirSync, existsSync, writeFileSync } from "node:fs";
import { totalmem } from "node:os";
import { basename, extname, join } from "node:path";
import { CRAWL_LIMIT, isHumanCheck, linksScript, paceFor, robotsAllow, robotsRules, safeFileName, textScript } from "../shared/harvest.ts";

interface Slot { win: BrowserWindow; uses: number; idle?: NodeJS.Timeout; bare: boolean }
interface VisitOptions { waitFor?: string; timeout?: number; bare?: boolean }
interface PageText { url: string; title: string; text: string; humanCheck: boolean }

const IDLE_MS = 30_000;
const HEAVY_KB = 220 * 1024;
const ENOUGH_TEXT = 1200; // less than this and the page probably needs its scripts
const RETIRE_AFTER = 15; // navigations; a long-lived page only grows
const SKIP = new Set(["image", "media", "font", "object"]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function agentEngine(deps: { partition: string; guard: (wc: WebContents) => void; downloads: () => string }) {
  const free: Slot[] = [];
  const out = new Set<Slot>();
  const owned = new Set<number>();
  const waiting: { bare: boolean; resolve: (s: Slot | null) => void }[] = [];
  const stopped = new Set<string>();

  const memoryMB = () => {
    const pids = new Set([...free, ...out].map((s) => s.win.webContents.getOSProcessId()));
    let total = 0;
    let pages = 0;
    for (const m of app.getAppMetrics()) { total += m.memory.workingSetSize; if (pids.has(m.pid)) pages += m.memory.workingSetSize; }
    return { total: Math.round(total / 1024), pages: Math.round(pages / 1024) };
  };
  /** Three pages at once, four with plenty of memory, one when the app is already heavy. */
  const room = () => {
    const budgetMB = totalmem() / 2 ** 20 * 0.5;
    if (memoryMB().total > budgetMB) return 1;
    return totalmem() >= 16 * 2 ** 30 ? 4 : 3;
  };

  function make(bare = false): Slot {
    const win = new BrowserWindow({
      show: false, frame: false, skipTaskbar: true, width: 1280, height: 900,
      webPreferences: { partition: deps.partition, sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: !bare, images: false, webgl: false, spellcheck: false, disableDialogs: true, backgroundThrottling: false, autoplayPolicy: "document-user-activation-required", offscreen: true },
    });
    const wc = win.webContents;
    const id = wc.id;
    owned.add(id);
    wc.setFrameRate(4); // pages that wait for a frame still get one; nobody is looking
    wc.setAudioMuted(true);
    wc.setWindowOpenHandler(() => ({ action: "deny" }));
    wc.on("will-navigate", (e, url) => { if (!/^https?:/i.test(url)) e.preventDefault(); });
    wc.on("will-prevent-unload", (e) => e.preventDefault());
    wc.on("destroyed", () => owned.delete(id));
    deps.guard(wc);
    return { win, uses: 0, bare };
  }
  const retire = (s: Slot) => { clearTimeout(s.idle); free.splice(free.indexOf(s) >>> 0, 1); out.delete(s); if (!s.win.isDestroyed()) s.win.destroy(); };

  /** A page that came back big gives its memory straight back, rather than holding it while idle. */
  const heavy = (s: Slot) => {
    const pid = s.win.webContents.getOSProcessId();
    return (app.getAppMetrics().find((m) => m.pid === pid)?.memory.workingSetSize ?? 0) > HEAVY_KB;
  };

  function take(bare: boolean) {
    const s = free.find((f) => f.bare === bare);
    if (s) { free.splice(free.indexOf(s), 1); clearTimeout(s.idle); out.add(s); return Promise.resolve<Slot | null>(s); }
    if (out.size + free.length >= room() && free.length) retire(free[0]); // the wrong kind is idle: make room for this one
    if (out.size < room()) { const n = make(bare); out.add(n); return Promise.resolve<Slot | null>(n); }
    return new Promise<Slot | null>((resolve) => waiting.push({ bare, resolve }));
  }
  function give(s: Slot) {
    out.delete(s);
    if (s.win.isDestroyed()) return;
    if (s.uses >= RETIRE_AFTER || s.win.webContents.isCrashed() || heavy(s)) retire(s);
    else if (waiting[0]?.bare === s.bare && out.size < room()) { out.add(s); waiting.shift()!.resolve(s); return; }
    else { void s.win.webContents.loadURL("about:blank").catch(() => undefined); s.idle = setTimeout(() => retire(s), IDLE_MS); free.push(s); }
    if (waiting.length && out.size < room()) { const w = waiting.shift()!; const n = make(w.bare); out.add(n); w.resolve(n); }
  }

  async function arrive(s: Slot, url: string, o: VisitOptions) {
    const wc = s.win.webContents;
    s.uses++;
    const limit = o.timeout ?? 25_000;
    await Promise.race([wc.loadURL(url).catch((e: Error) => { if (!/ERR_ABORTED/.test(e.message)) throw e; }), sleep(limit)]);
    if (o.bare) return; // nothing will change: no scripts run here
    // Pages that build themselves: wait for what was asked for, or until the text stops growing.
    const until = Date.now() + (o.waitFor ? 12_000 : 5_000);
    let last = -1;
    let still = 0;
    while (Date.now() < until && still < 2) {
      await sleep(350);
      if (wc.isDestroyed()) throw new Error("That page closed");
      if (o.waitFor) { if (await wc.executeJavaScript(`!!document.querySelector(${JSON.stringify(o.waitFor)})`).catch(() => false)) return; continue; }
      const n = await wc.executeJavaScript("document.body ? document.body.innerText.length : 0").catch(() => 0) as number;
      still = n > 0 && n === last ? still + 1 : 0;
      last = n;
    }
  }

  async function visit<T>(url: string, o: VisitOptions, work: (wc: WebContents) => Promise<T>) {
    if (!/^https?:\/\//i.test(url)) throw new Error("Only http(s) addresses can be read");
    const s = await take(!!o.bare);
    if (!s) throw new Error("The engine stopped");
    try { await arrive(s, url, o); return await work(s.win.webContents); } finally { give(s); }
  }
  const pageText = (wc: WebContents) => wc.executeJavaScript(textScript) as Promise<Omit<PageText, "humanCheck">>;

  /** Text without running the page's scripts where that's enough: far less memory and time. Scripts run only if it came back thin. */
  async function read(url: string, o: VisitOptions = {}): Promise<PageText> {
    const look = (bare: boolean) => visit(url, { ...o, bare }, async (wc) => { const p = await pageText(wc); return { ...p, humanCheck: isHumanCheck(p.title, p.text) }; });
    const quick = o.waitFor ? null : await look(true).catch(() => null);
    return quick && quick.text.length >= ENOUGH_TEXT ? quick : look(false);
  }
  const run = (url: string, script: string, o: VisitOptions = {}) => visit(url, o, async (wc) => {
    const p = await pageText(wc);
    return { url: p.url, title: p.title, humanCheck: isHumanCheck(p.title, p.text), result: await wc.executeJavaScript(script) as unknown };
  });

  const robots = new Map<string, Promise<ReturnType<typeof robotsRules>>>();
  const rulesFor = (origin: string) => {
    let r = robots.get(origin);
    if (!r) {
      r = net.fetch(`${origin}/robots.txt`, { signal: AbortSignal.timeout(5000) }).then((res) => (res.ok ? res.text() : "")).then(robotsRules).catch(() => robotsRules(""));
      robots.set(origin, r);
      if (robots.size > 200) robots.delete(robots.keys().next().value!);
    }
    return r;
  };

  /** Many pages, as a guest: robots.txt is obeyed, one page at a time per site, and a site that asks for a person ends there. */
  async function crawl(runId: string, urls: string[], o: { limit?: number; follow?: string }) {
    const limit = Math.min(o.limit ?? 20, CRAWL_LIMIT);
    const pages: { url: string; title: string; text: string }[] = [];
    const skipped: { url: string; why: string }[] = [];
    const seen = new Set<string>();
    const hosts = new Map<string, string[]>();
    const add = (u: string) => {
      if (seen.has(u) || seen.size >= limit * 3) return;
      seen.add(u);
      try { const h = new URL(u).origin; hosts.set(h, [...(hosts.get(h) ?? []), u]); } catch { skipped.push({ url: u, why: "not an address" }); }
    };
    urls.forEach(add);
    stopped.delete(runId);
    const site = async (origin: string) => {
      const { rules, delay } = await rulesFor(origin);
      const queue = hosts.get(origin)!;
      while (queue.length && pages.length < limit && !stopped.has(runId)) {
        const url = queue.shift()!;
        if (!robotsAllow(rules, new URL(url).pathname + new URL(url).search)) { skipped.push({ url, why: "robots.txt asks visitors not to" }); continue; }
        try {
          const look = (bare: boolean) => visit(url, { bare }, async (wc) => {
            const page = await pageText(wc);
            return { ...page, links: o.follow ? (await wc.executeJavaScript(linksScript)) as string[] : [] };
          });
          const quick = await look(true).catch(() => null);
          const p = quick && quick.text.length >= ENOUGH_TEXT ? quick : await look(false);
          if (isHumanCheck(p.title, p.text)) { skipped.push({ url, why: "the site asks for a human check; left to the person" }); return; }
          pages.push({ url: p.url, title: p.title, text: p.text.slice(0, 3000) });
          for (const l of p.links) if (l.startsWith(origin) && l.includes(o.follow!)) add(l);
        } catch (err) { skipped.push({ url, why: (err as Error).message.slice(0, 120) }); }
        if (queue.length) await sleep(paceFor(delay));
      }
    };
    await Promise.all([...hosts.keys()].map(site));
    stopped.delete(runId);
    return { pages, skipped };
  }

  ipcMain.handle("engine:read", (_e, url: string, o?: VisitOptions) => read(url, o));
  ipcMain.handle("engine:run", (_e, url: string, script: string, o?: VisitOptions) => run(url, script, o));
  ipcMain.handle("engine:crawl", (_e, runId: string, urls: string[], o: { limit?: number; follow?: string }) => crawl(runId, urls, o ?? {}));
  ipcMain.handle("engine:stop", (_e, runId: string) => { stopped.add(runId); });
  const byKind = () => {
    const mb = { tabs: 0, gpu: 0, core: 0 };
    const pool = new Set([...free, ...out].map((s) => s.win.webContents.getOSProcessId()));
    for (const m of app.getAppMetrics()) {
      if (pool.has(m.pid)) continue;
      mb[m.type === "Tab" ? "tabs" : m.type === "GPU" ? "gpu" : "core"] += m.memory.workingSetSize / 1024;
    }
    return { tabs: Math.round(mb.tabs), gpu: Math.round(mb.gpu), core: Math.round(mb.core) };
  };
  ipcMain.handle("engine:stats", () => ({ ...memoryMB(), ...byKind(), system: Math.round(totalmem() / 2 ** 20), pages: free.length + out.size, busy: out.size, waiting: waiting.length, limit: room(), pageMemory: memoryMB().pages }));
  /** A finished piece of work, in its own folder of Downloads. Agents can write nowhere else. */
  ipcMain.handle("engine:save", (_e, name: string, content: string) => {
    const dir = join(deps.downloads(), "Agent Files");
    mkdirSync(dir, { recursive: true });
    const clean = safeFileName(name);
    const ext = /^\.(csv|json|md|txt|html)$/i.test(extname(clean)) ? extname(clean) : ".txt";
    const stem = basename(clean, extname(clean));
    let path = join(dir, `${stem}${ext}`);
    for (let i = 1; existsSync(path); i++) path = join(dir, `${stem} (${i})${ext}`);
    writeFileSync(path, String(content).slice(0, 20_000_000));
    return path;
  });

  return {
    /** The pool's pages: no pop-ups, prompts or downloads ever come from them. */
    owns: (id: number) => owned.has(id),
    /** Requests a pool page never needs. Everything else still passes through Shields. */
    skips: (id: number | undefined, resource: string) => id !== undefined && owned.has(id) && SKIP.has(resource),
    close() { for (const w of waiting.splice(0)) w.resolve(null); for (const s of [...free, ...out]) retire(s); },
  };
}
