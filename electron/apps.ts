// Apps agents build: single pages kept in the library and served at agent-app://<id>/, each its own origin, with no
// network and no way off the page (shared/harvest.ts, APP_POLICY).
import { ipcMain, protocol, type Session } from "electron";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { APP_ID, APP_POLICY, APP_SCHEME } from "../shared/harvest.ts";

export interface AgentApp { id: string; title: string; agent: string; at: number; size: number }

const MAX_HTML = 2 * 1024 * 1024;

/** Must run before the app is ready. */
export const registerAppScheme = () => protocol.registerSchemesAsPrivileged([{ scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

export function agentApps(dir: string) {
  mkdirSync(dir, { recursive: true });
  const indexPath = join(dir, "apps.json");
  const fileFor = (id: string) => join(dir, `${id}.html`);
  let index: AgentApp[] = [];
  try { index = JSON.parse(readFileSync(indexPath, "utf8")) as AgentApp[]; } catch { /* none yet */ }
  const keep = () => writeFileSync(indexPath, JSON.stringify(index));

  ipcMain.handle("apps:list", () => index);
  ipcMain.handle("apps:save", (_e, a: { id: string; title: string; agent: string; html: string }) => {
    if (!APP_ID.test(a.id)) throw new Error("That isn't an app id");
    const html = String(a.html);
    if (html.length > MAX_HTML) throw new Error("That app is over 2 MB");
    writeFileSync(fileFor(a.id), html);
    index = [{ id: a.id, title: String(a.title).slice(0, 80), agent: String(a.agent).slice(0, 80), at: Date.now(), size: html.length }, ...index.filter((x) => x.id !== a.id)];
    keep();
    return a.id;
  });
  ipcMain.handle("apps:remove", (_e, id: string) => {
    if (!APP_ID.test(id)) return;
    rmSync(fileFor(id), { force: true });
    index = index.filter((x) => x.id !== id);
    keep();
  });

  return {
    serve(s: Session) {
      s.protocol.handle(APP_SCHEME, (req) => {
        const url = new URL(req.url);
        if (!APP_ID.test(url.hostname) || url.pathname !== "/") return new Response("Not found", { status: 404 });
        try {
          return new Response(readFileSync(fileFor(url.hostname)), { headers: { "content-type": "text/html; charset=utf-8", "content-security-policy": APP_POLICY } });
        } catch { return new Response("This app was removed.", { status: 404 }); }
      });
    },
  };
}
