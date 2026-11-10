// Sign in with ChatGPT: the person signs in to ChatGPT in their own browser and approves AetherDeck using their plan,
// and AI requests then run on that plan, up to the share they allow AetherDeck in ChatGPT, instead of an API key.
// This is OpenAI's flow for open-source apps on the person's own computer: OAuth with PKCE, a callback on
// 127.0.0.1, no client secret. The first sign-in registers AetherDeck and returns its client id, kept for later
// sign-ins. Tokens are kept encrypted by the system keychain (safeStorage); the access token lasts an hour and is
// renewed from the refresh token, which is replaced on every renewal. AetherDeck never sees the password.
import { app, ipcMain, safeStorage, shell } from "electron";
import { execFile } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setChatGPT } from "../server/chatgpt.ts";

const AUTH = "https://auth.openai.com/api/accounts";
const RESOURCE = "https://api.openai.com/v1";
const SCOPE = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
const PATH = "/auth/callback";
const PORT = 1455;

/**
 * Opens the sign-in in the person's browser. When AetherDeck is their default browser it would open inside
 * AetherDeck, behind Settings, where Google also refuses "Continue with Google"; then it opens in the browser
 * the system comes with. Returns that browser's name for the person.
 */
export async function openOutside(url: string): Promise<string> {
  try {
    if (app.isDefaultProtocolClient("https")) {
      if (process.platform === "win32") { await shell.openExternal(`microsoft-edge:${url}`); return "Microsoft Edge"; }
      if (process.platform === "darwin") { await new Promise<void>((ok, fail) => execFile("open", ["-a", "Safari", url], (e) => (e ? fail(e) : ok()))); return "Safari"; }
    }
  } catch { /* that browser isn't there: the default one opens it */ }
  await shell.openExternal(url);
  return "your browser";
}

interface Saved { clientId?: string; host: string; access?: string; refresh?: string; expires?: number; idToken?: string; email?: string }
const b64url = (b: Buffer) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
/** The email in an ID token that came straight from OpenAI's token endpoint over TLS; shown to the person only. */
const emailOf = (idToken?: string) => { try { return (JSON.parse(Buffer.from(idToken!.split(".")[1], "base64url").toString()) as { email?: string }).email; } catch { return undefined; } };

export function chatgptSignIn(o: { dir: string; changed: () => void }) {
  const file = join(o.dir, "chatgpt.bin");
  let saved: Saved = { host: `urn:uuid:${randomUUID()}` };
  try { if (existsSync(file) && safeStorage.isEncryptionAvailable()) saved = { ...saved, ...(JSON.parse(safeStorage.decryptString(readFileSync(file))) as Saved) }; } catch { /* unreadable on this machine: signed out */ }
  const keep = () => { if (safeStorage.isEncryptionAvailable()) writeFileSync(file, safeStorage.encryptString(JSON.stringify(saved))); };
  const signedIn = () => !!(saved.refresh && saved.clientId);

  let renewing: Promise<string> | null = null;
  async function token(): Promise<string> {
    if (saved.access && saved.expires && Date.now() < saved.expires - 120_000) return saved.access;
    if (!signedIn()) throw new Error("Sign in with ChatGPT in Settings first.");
    // One renewal at a time: the refresh token is replaced each time, so two at once would race.
    renewing ??= (async () => {
      const res = await fetch(`${AUTH}/oauth/token`, {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "refresh_token", client_id: saved.clientId!, refresh_token: saved.refresh!, resource: RESOURCE }),
      });
      const body = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string };
      if (!res.ok || !body.access_token) {
        if (body.error === "invalid_grant") { saved = { host: saved.host, clientId: saved.clientId }; keep(); o.changed(); }
        throw new Error(body.error === "invalid_grant" ? "ChatGPT signed AetherDeck out. Sign in with ChatGPT again in Settings." : `ChatGPT sign-in couldn't be renewed (HTTP ${res.status})`);
      }
      saved = { ...saved, access: body.access_token, refresh: body.refresh_token ?? saved.refresh, expires: Date.now() + (body.expires_in ?? 3600) * 1000 };
      keep();
      return body.access_token;
    })().finally(() => { renewing = null; });
    return renewing;
  }
  setChatGPT({ ready: signedIn, token, email: () => saved.email });

  let pending: Server | null = null;
  let link = ""; // the sign-in page, for the person to open in another browser
  let cancel: (() => void) | null = null;
  async function signIn(opened: (browser: string) => void): Promise<{ email?: string }> {
    cancel?.();
    const verifier = b64url(randomBytes(48));
    const state = b64url(randomBytes(24));
    const nonce = b64url(randomBytes(24));
    const challenge = b64url(createHash("sha256").update(verifier).digest());
    // The callback listens before the browser opens. Port 1455 when it's free; later sign-ins may use another.
    const server = createServer();
    pending = server;
    const port = await new Promise<number>((ok, fail) => {
      server.once("error", () => { server.listen(0, "127.0.0.1", () => ok((server.address() as { port: number }).port)); });
      server.listen(PORT, "127.0.0.1", () => ok(PORT));
      setTimeout(() => fail(new Error("Couldn't listen for the sign-in")), 5000);
    });
    const redirect = `http://127.0.0.1:${port}${PATH}`;
    const first = !saved.clientId;
    const q = new URLSearchParams({
      client_id: saved.clientId ?? "dynamic_agent_client", ...(first ? { agent_name_hint: "AetherDeck" } : {}), ext_agent_host_id: saved.host,
      response_type: "code", redirect_uri: redirect, scope: SCOPE, resource: RESOURCE, state, nonce, code_challenge_method: "S256", code_challenge: challenge,
      ...(saved.idToken ? { id_token_hint: saved.idToken } : {}), ...(saved.email ? { login_hint: saved.email } : {}),
    });
    const back = new Promise<{ code: string; clientId?: string }>((ok, fail) => {
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
        if (!code) { page("ChatGPT didn't approve the sign-in. You can close this tab."); fail(new Error(u.searchParams.get("error_description") ?? "ChatGPT didn't approve the sign-in.")); return; }
        const issued = u.searchParams.get("client_id") ?? undefined;
        if (!first && issued && issued !== saved.clientId) { page("That sign-in didn't match. Go back to AetherDeck and try again."); fail(new Error("ChatGPT returned a different app id, so the sign-in was ignored.")); return; }
        page("Signed in. You can close this tab and go back to AetherDeck.");
        ok({ code, clientId: issued });
      });
    });
    link = `${AUTH}/authorize?${q}`;
    opened(await openOutside(link));
    const { code, clientId } = await back.finally(() => { if (pending === server) { pending = null; cancel = null; link = ""; } });
    const id = saved.clientId ?? clientId;
    if (!id) throw new Error("ChatGPT didn't return an app id for AetherDeck.");
    const res = await fetch(`${AUTH}/oauth/token`, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", client_id: id, code, code_verifier: verifier, redirect_uri: redirect, resource: RESOURCE }),
    });
    const body = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; id_token?: string; expires_in?: number; scope?: string; error?: string };
    if (!res.ok || !body.access_token) throw new Error(body.error === "invalid_grant" ? "That sign-in expired. Try again." : `ChatGPT sign-in failed (HTTP ${res.status})`);
    if (!String(body.scope ?? "").split(/\s+/).includes("chatgpt.tokens.use.direct")) throw new Error("ChatGPT didn't allow AetherDeck to use your plan. Sign in again and approve plan use.");
    if (!body.refresh_token) throw new Error("ChatGPT didn't allow AetherDeck to stay signed in.");
    saved = { host: saved.host, clientId: id, access: body.access_token, refresh: body.refresh_token, expires: Date.now() + (body.expires_in ?? 3600) * 1000, idToken: body.id_token, email: emailOf(body.id_token) };
    keep();
    o.changed();
    return { email: saved.email };
  }

  ipcMain.handle("chatgpt:status", () => ({ signedIn: signedIn(), email: saved.email, available: safeStorage.isEncryptionAvailable() }));
  ipcMain.handle("chatgpt:signIn", (e) => signIn((browser) => { if (!e.sender.isDestroyed()) e.sender.send("chatgpt:opened", { browser }); }));
  ipcMain.handle("chatgpt:cancel", () => cancel?.());
  ipcMain.handle("chatgpt:link", () => link);
  ipcMain.handle("chatgpt:signOut", () => {
    saved = { host: saved.host, clientId: saved.clientId }; // the app id stays, so signing in again is quicker
    if (existsSync(file)) rmSync(file);
    keep();
    o.changed();
  });
}
