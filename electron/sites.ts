// What agents make that lives on this computer: websites, and the files a person chooses for an agent to post.
//
// Websites are project folders in a place the person approved (asked once, with a system dialog), served on this
// computer only, at http://127.0.0.1:<port>/<site>/, a link that opens in a window. Several agents can work on one
// site by its name. Nothing outside the approved folder is read or written, and nothing is served beyond this
// computer.
//
// Files to post are only ever ones the person picked in a system dialog for that agent. attach_files puts them
// into a page's file field the way the person would, through the page's own file input.
import { app, dialog, ipcMain, shell, webContents, type BrowserWindow } from "electron";
import { createServer, type Server } from "node:http";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, posix, resolve, sep } from "node:path";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".htm": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8", ".xml": "application/xml", ".webmanifest": "application/manifest+json",
};
const MAX_FILE = 1024 * 1024;
const MAX_SITE = 20 * 1024 * 1024;
export const siteName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "site";

/** A path inside a site, or null when it would leave it or isn't a kind of file a site is made of. Exported for tests. */
export function sitePath(p: string): string | null {
  // Web paths, with forward slashes on every system; the file system turns them into its own when writing.
  const clean = posix.normalize(String(p).replace(/\\/g, "/").replace(/^\/+/, ""));
  if (!clean || clean === "." || clean.startsWith("..") || clean.split("/").includes("..") || /^[a-z]:/i.test(clean)) return null;
  return TYPES[extname(clean).toLowerCase()] ? clean : null;
}

export function agentSites(o: { dir: string; win: () => BrowserWindow | null }) {
  const config = join(o.dir, "sites.json");
  let root: string | null = null;
  try { root = (JSON.parse(readFileSync(config, "utf8")) as { root?: string }).root ?? null; } catch { /* not chosen yet */ }
  let server: Server | null = null;
  let port = 0;

  /** The approved folder, asking the person the first time. */
  async function approvedRoot(agent: string): Promise<string> {
    if (root && existsSync(root)) return root;
    const fallback = join(app.getPath("documents"), "AetherDeck Sites");
    const w = o.win();
    const opts = {
      type: "question" as const, buttons: ["Allow", "Choose another folder…", "Don't allow"], defaultId: 0, cancelId: 2,
      message: `${agent} wants to build a website on this computer.`,
      detail: `Its files go in ${fallback} and open at a link only this computer can see. Agents can only write inside this folder.`,
    };
    const { response } = w ? await dialog.showMessageBox(w, opts) : await dialog.showMessageBox(opts);
    if (response === 2) throw new Error("The person didn't allow a website folder on this computer.");
    let chosen = fallback;
    if (response === 1) {
      const r = w ? await dialog.showOpenDialog(w, { properties: ["openDirectory", "createDirectory"], title: "Where should agents build websites?" }) : await dialog.showOpenDialog({ properties: ["openDirectory", "createDirectory"] });
      if (r.canceled || !r.filePaths[0]) throw new Error("No folder was chosen for websites.");
      chosen = r.filePaths[0];
    }
    mkdirSync(chosen, { recursive: true });
    root = chosen;
    writeFileSync(config, JSON.stringify({ root }));
    return root;
  }

  async function serve(): Promise<number> {
    if (server) return port;
    server = createServer((req, res) => {
      try {
        const [, site, ...rest] = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname).split("/");
        const file = sitePath(rest.join("/") || "index.html") ?? (rest.length ? null : "index.html");
        if (!root || !site || site !== siteName(site) || !file) { res.writeHead(404).end("Not found"); return; }
        const base = resolve(root, site);
        let full = resolve(base, file);
        if (!full.startsWith(base + sep)) { res.writeHead(404).end("Not found"); return; }
        if (existsSync(full) && statSync(full).isDirectory()) full = join(full, "index.html");
        if (!existsSync(full)) { res.writeHead(404).end("Not found"); return; }
        res.writeHead(200, { "content-type": TYPES[extname(full).toLowerCase()] ?? "application/octet-stream", "cache-control": "no-store" }).end(readFileSync(full));
      } catch { res.writeHead(400).end("Bad request"); }
    });
    await new Promise<void>((ok) => server!.listen(0, "127.0.0.1", ok));
    port = (server.address() as { port: number }).port;
    return port;
  }

  ipcMain.handle("sites:write", async (_e, a: { agent: string; name: string; files: { path: string; content: string }[] }) => {
    const folder = await approvedRoot(String(a.agent).slice(0, 80));
    const name = siteName(String(a.name));
    const base = resolve(folder, name);
    let total = 0;
    const wrote: string[] = [];
    for (const f of (a.files ?? []).slice(0, 60)) {
      const p = sitePath(f.path);
      const content = String(f.content ?? "");
      if (!p) throw new Error(`${f.path} isn't a file a website can have here (HTML, CSS, JavaScript, JSON, SVG, text)`);
      if (content.length > MAX_FILE) throw new Error(`${p} is over 1 MB`);
      total += content.length;
      if (total > MAX_SITE) throw new Error("That's over 20 MB at once");
      const full = resolve(base, p);
      if (!full.startsWith(base + sep)) throw new Error(`${f.path} would leave the site's folder`);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, content);
      wrote.push(p);
    }
    const at = await serve();
    return { url: `http://127.0.0.1:${at}/${name}/`, folder: base, files: wrote };
  });
  ipcMain.handle("sites:list", async () => {
    if (!root || !existsSync(root)) return [];
    const at = await serve();
    return readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory() && d.name === siteName(d.name))
      .map((d) => ({ name: d.name, url: `http://127.0.0.1:${at}/${d.name}/`, at: statSync(join(root!, d.name)).mtimeMs }))
      .sort((a, b) => b.at - a.at);
  });
  ipcMain.handle("sites:reveal", (_e, name: string) => { if (root) shell.showItemInFolder(join(root, siteName(name), "index.html")); });

  // ---- files the person chose for an agent to post ----
  const chosen = new Map<string, string>(); // name shown to the agent → path

  ipcMain.handle("media:pick", async (_e, a: { agent: string; purpose: string }) => {
    const w = o.win();
    const opts = {
      title: `${String(a.agent).slice(0, 60)} needs files: ${String(a.purpose).slice(0, 120)}`,
      properties: ["openFile", "multiSelections"] as ("openFile" | "multiSelections")[],
      filters: [{ name: "Videos and images", extensions: ["mp4", "mov", "m4v", "webm", "jpg", "jpeg", "png", "gif", "webp", "heic"] }, { name: "Any file", extensions: ["*"] }],
    };
    const r = w ? await dialog.showOpenDialog(w, opts) : await dialog.showOpenDialog(opts);
    if (r.canceled) return [];
    return r.filePaths.map((p) => {
      let name = basename(p);
      for (let i = 2; chosen.has(name) && chosen.get(name) !== p; i++) name = `${i}-${basename(p)}`;
      chosen.set(name, p);
      return { name, mb: Math.round((statSync(p).size / 1048576) * 10) / 10 };
    });
  });

  ipcMain.handle("page:attach", async (_e, a: { wc: number; files: string[]; element?: string }) => {
    const paths = (a.files ?? []).map((n) => chosen.get(String(n)));
    if (!paths.length || paths.some((p) => !p || !existsSync(p))) throw new Error("Only files the person chose with pick_files can be attached");
    const wc = webContents.fromId(Number(a.wc));
    if (!wc || wc.isDestroyed()) throw new Error("That window is gone");
    const dbg = wc.debugger;
    const mine = !dbg.isAttached();
    if (mine) dbg.attach("1.3");
    try {
      // The field: the element the agent named when it's a file field, or else the page's file field that's free.
      const find = `(() => { const named = ${a.element ?? "null"}; if (named && named.tagName === "INPUT" && named.type === "file") return named;
        const all = [...document.querySelectorAll('input[type=file]')].filter((i) => !i.disabled); return all[all.length - 1] || null; })()`;
      const r = await dbg.sendCommand("Runtime.evaluate", { expression: find }) as { result: { objectId?: string; subtype?: string } };
      if (!r.result.objectId || r.result.subtype === "null") throw new Error("There's no file field on the page yet. Click the page's upload button first, then try again.");
      await dbg.sendCommand("DOM.setFileInputFiles", { files: paths, objectId: r.result.objectId });
      return `Attached ${paths.length} file${paths.length === 1 ? "" : "s"}: ${a.files.join(", ")}`;
    } finally {
      if (mine) dbg.detach();
    }
  });

}
