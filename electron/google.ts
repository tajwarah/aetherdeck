// Sign in with Google, for agents: Drive files, Calendar events and YouTube uploads without going through Google's
// web pages (which refuse sign-in inside Electron). This is Google's desktop-app OAuth: PKCE, a callback on
// 127.0.0.1 and the person's own OAuth client ID, entered in Settings (nothing is built in). The consent page opens in
// the system browser. The refresh token is kept encrypted by the system keychain (safeStorage); the access token lasts
// an hour and is renewed from it. No Gmail scope is requested. AetherDeck never sees the Google password.
import { ipcMain, safeStorage } from "electron";
import { randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { authUrl, b64url, calendarAdd, calendarList, driveList, driveRead, driveSave, emailOf, exchangeCode, pkce, revoke, SCOPES, TokenKeeper, type GoogleTokens } from "../server/google.ts";
import { openOutside } from "./chatgpt.ts";

const PATH = "/auth/google";
interface Saved extends GoogleTokens { clientId?: string; clientSecret?: string; email?: string }

export function googleSignIn(o: { dir: string }) {
  const file = join(o.dir, "google.bin");
  let saved: Saved = {};
  try { if (existsSync(file) && safeStorage.isEncryptionAvailable()) saved = JSON.parse(safeStorage.decryptString(readFileSync(file))) as Saved; } catch { /* unreadable on this machine: signed out */ }
  const keep = () => { if (safeStorage.isEncryptionAvailable()) writeFileSync(file, safeStorage.encryptString(JSON.stringify(saved))); };
  const signedIn = () => !!(saved.refresh && saved.clientId);
  const keeper = new TokenKeeper({
    get: () => ({ clientId: saved.clientId, clientSecret: saved.clientSecret, tokens: saved }),
    set: (t) => { saved = { ...saved, ...t }; keep(); },
    signedOut: () => { saved = { clientId: saved.clientId, clientSecret: saved.clientSecret }; keep(); },
  });
  const api = { token: () => keeper.token() };

  let pending: Server | null = null;
  let link = ""; // the consent page, for the person to open in another browser
  let cancel: (() => void) | null = null;
  async function signIn(opened: (browser: string) => void): Promise<{ email?: string }> {
    if (!saved.clientId) throw new Error("Add your Google client ID in Settings first.");
    cancel?.();
    const { verifier, challenge } = pkce();
    const state = b64url(randomBytes(24));
    // The callback listens (on 127.0.0.1, never "localhost") before the browser opens.
    const server = createServer();
    pending = server;
    const port = await new Promise<number>((ok, fail) => {
      server.once("error", fail);
      server.listen(0, "127.0.0.1", () => ok((server.address() as { port: number }).port));
    });
    const redirect = `http://127.0.0.1:${port}${PATH}`;
    const back = new Promise<string>((ok, fail) => {
      const timer = setTimeout(() => { server.close(); fail(new Error("The sign-in took too long. Try again.")); }, 10 * 60_000);
      cancel = () => { clearTimeout(timer); server.close(); fail(new Error("cancelled")); };
      server.on("request", (req, res) => {
        const u = new URL(req.url ?? "/", redirect);
        if (u.pathname !== PATH) { res.writeHead(404).end(); return; }
        const page = (msg: string) => res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(`<!doctype html><meta charset="utf-8"><title>AetherDeck</title><body style="font:16px system-ui;background:#0b0a14;color:#eee;display:grid;place-items:center;height:100vh;margin:0"><p>${msg}</p>`);
        clearTimeout(timer);
        server.close();
        if (u.searchParams.get("state") !== state) { page("That sign-in didn't match. Go back to AetherDeck and try again."); fail(new Error("The sign-in didn't match, so it was ignored.")); return; }
        const code = u.searchParams.get("code");
        if (!code) { page("Google didn't approve the sign-in. You can close this tab."); fail(new Error(u.searchParams.get("error") === "access_denied" ? "You didn't approve the sign-in." : "Google didn't approve the sign-in.")); return; }
        page("Signed in. You can close this tab and go back to AetherDeck.");
        ok(code);
      });
    });
    link = authUrl({ clientId: saved.clientId, redirect, state, challenge, email: saved.email });
    opened(await openOutside(link));
    const code = await back.finally(() => { if (pending === server) { pending = null; cancel = null; link = ""; } });
    const body = await exchangeCode({ clientId: saved.clientId, clientSecret: saved.clientSecret, code, verifier, redirect });
    if (!body.refresh_token) throw new Error("Google didn't allow AetherDeck to stay signed in. Remove AetherDeck at myaccount.google.com/permissions and sign in again.");
    const granted = String(body.scope ?? "").split(/\s+/);
    const missing = SCOPES.filter((s) => s.startsWith("https://") && !granted.includes(s));
    saved = { clientId: saved.clientId, clientSecret: saved.clientSecret, access: body.access_token, refresh: body.refresh_token, expires: Date.now() + (body.expires_in ?? 3600) * 1000, email: emailOf(body.id_token) };
    keep();
    if (missing.length) throw new Error("You signed in, but some permissions were left unticked, so some tools won't work. Sign in again and tick them all.");
    return { email: saved.email };
  }

  ipcMain.handle("google:status", () => ({ signedIn: signedIn(), email: saved.email, available: safeStorage.isEncryptionAvailable(), hasClient: !!saved.clientId, clientId: saved.clientId, hasSecret: !!saved.clientSecret }));
  ipcMain.handle("google:setClient", (_e, clientId: unknown, clientSecret: unknown) => {
    const id = typeof clientId === "string" ? clientId.trim().slice(0, 200) : "";
    if (id && !/^[\w.-]+\.apps\.googleusercontent\.com$/.test(id)) throw new Error("That doesn't look like a Google client ID. It ends in .apps.googleusercontent.com.");
    // A new client means the old refresh token no longer applies.
    if (id !== saved.clientId) saved = {};
    saved = { ...saved, clientId: id || undefined, clientSecret: typeof clientSecret === "string" && clientSecret.trim() ? clientSecret.trim().slice(0, 200) : id ? saved.clientSecret : undefined };
    if (!saved.clientId && existsSync(file)) rmSync(file);
    else keep();
  });
  ipcMain.handle("google:signIn", (e) => signIn((browser) => { if (!e.sender.isDestroyed()) e.sender.send("google:opened", { browser }); }));
  ipcMain.handle("google:cancel", () => cancel?.());
  ipcMain.handle("google:link", () => link);
  ipcMain.handle("google:signOut", async () => {
    const t = saved.refresh ?? saved.access;
    saved = { clientId: saved.clientId, clientSecret: saved.clientSecret };
    keep();
    if (t) await revoke(t);
  });
  // What agents use. Each needs the person to be signed in; the renderer never sees a token.
  ipcMain.handle("google:api", async (_e, action: string, a: Record<string, unknown> = {}) => {
    if (!signedIn()) throw new Error("Google isn't signed in. Tell the person to press Sign in with Google in Settings; agents never sign in.");
    const s = (v: unknown, n = 200_000) => String(v ?? "").slice(0, n);
    switch (action) {
      case "drive_save": return driveSave(api, { name: s(a.name, 200) || "AetherDeck file", content: s(a.content, 5_000_000), mimeType: a.mimeType ? s(a.mimeType, 100) : undefined });
      case "drive_read": return driveRead(api, s(a.id, 100));
      case "drive_list": return driveList(api, Number(a.limit) || 20);
      case "calendar_add": return calendarAdd(api, { title: s(a.title, 300), start: s(a.start, 40), end: a.end ? s(a.end, 40) : undefined, description: a.description ? s(a.description, 8000) : undefined, location: a.location ? s(a.location, 300) : undefined, timeZone: a.timeZone ? s(a.timeZone, 60) : undefined });
      case "calendar_list": return calendarList(api, { from: a.from ? s(a.from, 40) : undefined, to: a.to ? s(a.to, 40) : undefined, limit: Number(a.limit) || undefined });
      default: throw new Error(`Unknown Google action ${action}`);
    }
  });
}
