// Google for agents: the pure parts of "Sign in with Google" (PKCE, the consent address, token renewal) and small
// Drive and Calendar helpers. The desktop app (electron/google.ts) holds the tokens and runs the sign-in; nothing
// here touches the disk or Electron, so it can be tested with a fake fetch. No Gmail scope is ever requested.
import { createHash, randomBytes } from "node:crypto";

export const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const TOKEN_URL = "https://oauth2.googleapis.com/token";
export const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
/** Narrow scopes only: files this app creates, calendar events, video uploads. Gmail scopes are restricted and are not asked for. */
export const SCOPES = [
  "openid", "email", "profile",
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/youtube.upload",
] as const;

export const b64url = (b: Buffer) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** A PKCE pair (RFC 7636, S256): the verifier stays here, only its hash goes in the address. */
export function pkce(random: (n: number) => Buffer = randomBytes) {
  const verifier = b64url(random(48));
  return { verifier, challenge: b64url(createHash("sha256").update(verifier).digest()) };
}

export function authUrl(o: { clientId: string; redirect: string; state: string; challenge: string; email?: string }) {
  const q = new URLSearchParams({
    client_id: o.clientId, redirect_uri: o.redirect, response_type: "code", scope: SCOPES.join(" "),
    state: o.state, code_challenge: o.challenge, code_challenge_method: "S256",
    access_type: "offline", prompt: "consent", include_granted_scopes: "true",
    ...(o.email ? { login_hint: o.email } : {}),
  });
  return `${AUTH_URL}?${q}`;
}

/** The email in an ID token that came straight from Google's token endpoint over TLS; shown to the person only. */
export const emailOf = (idToken?: string) => { try { return (JSON.parse(Buffer.from(idToken!.split(".")[1], "base64url").toString()) as { email?: string }).email; } catch { return undefined; } };

export interface GoogleTokens { access?: string; refresh?: string; expires?: number }
interface TokenBody { access_token?: string; refresh_token?: string; id_token?: string; expires_in?: number; scope?: string; error?: string }

/** Exchanges the sign-in's code for tokens. */
export async function exchangeCode(o: { clientId: string; clientSecret?: string; code: string; verifier: string; redirect: string }, fetchImpl: typeof fetch = fetch) {
  const res = await fetchImpl(TOKEN_URL, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", client_id: o.clientId, code: o.code, code_verifier: o.verifier, redirect_uri: o.redirect, ...(o.clientSecret ? { client_secret: o.clientSecret } : {}) }),
  });
  const body = (await res.json().catch(() => ({}))) as TokenBody;
  if (!res.ok || !body.access_token) throw new Error(body.error === "invalid_grant" ? "That sign-in expired. Try again." : body.error === "invalid_client" ? "Google doesn't recognise that client ID or secret. Check them in Settings." : `Google sign-in failed (HTTP ${res.status})`);
  return body;
}

/** Keeps an access token fresh from the refresh token. One renewal at a time; a revoked grant signs the person out. */
export class TokenKeeper {
  private renewing: Promise<string> | null = null;
  private o: {
    get: () => { clientId?: string; clientSecret?: string; tokens: GoogleTokens };
    set: (t: GoogleTokens) => void;
    signedOut: () => void;
    fetch?: typeof fetch;
    now?: () => number;
  };
  constructor(o: TokenKeeper["o"]) { this.o = o; }
  async token(): Promise<string> {
    const now = this.o.now ?? Date.now;
    const { clientId, clientSecret, tokens } = this.o.get();
    if (tokens.access && tokens.expires && now() < tokens.expires - 120_000) return tokens.access;
    if (!clientId || !tokens.refresh) throw new Error("Sign in with Google in Settings first.");
    this.renewing ??= (async () => {
      const res = await (this.o.fetch ?? fetch)(TOKEN_URL, {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "refresh_token", client_id: clientId, refresh_token: tokens.refresh!, ...(clientSecret ? { client_secret: clientSecret } : {}) }),
      });
      const body = (await res.json().catch(() => ({}))) as TokenBody;
      if (!res.ok || !body.access_token) {
        if (body.error === "invalid_grant") { this.o.signedOut(); throw new Error("Google signed AetherDeck out. Sign in with Google again in Settings."); }
        throw new Error(`Google sign-in couldn't be renewed (HTTP ${res.status})`);
      }
      // Google usually keeps the same refresh token; keep ours unless a new one arrives.
      this.o.set({ access: body.access_token, refresh: body.refresh_token ?? tokens.refresh, expires: now() + (body.expires_in ?? 3600) * 1000 });
      return body.access_token;
    })().finally(() => { this.renewing = null; });
    return this.renewing;
  }
}

/** Revokes a token at Google; best effort, so signing out still works offline. */
export async function revoke(token: string, fetchImpl: typeof fetch = fetch) {
  try { await fetchImpl(REVOKE_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token }) }); } catch { /* offline: the local sign-out still happens */ }
}

/* ---------- Drive (drive.file: only files AetherDeck created) ---------- */
type Api = { token: () => Promise<string>; fetch?: typeof fetch };
async function call(api: Api, url: string, init: RequestInit = {}) {
  const res = await (api.fetch ?? fetch)(url, { ...init, headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${await api.token()}` } });
  if (!res.ok) {
    const e = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(`Google answered HTTP ${res.status}${e.error?.message ? `: ${e.error.message}` : ""}`);
  }
  return res;
}

/** Creates a file in the person's Drive (multipart upload). Returns its id and link. */
export async function driveSave(api: Api, o: { name: string; content: string; mimeType?: string; folder?: string }) {
  const boundary = `aetherdeck${b64url(randomBytes(12))}`;
  const mime = o.mimeType || "text/plain";
  const meta = { name: o.name.slice(0, 200), mimeType: mime, ...(o.folder ? { parents: [o.folder] } : {}) };
  const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: ${mime}\r\n\r\n${o.content}\r\n--${boundary}--`;
  const res = await call(api, "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink", { method: "POST", headers: { "Content-Type": `multipart/related; boundary=${boundary}` }, body });
  return (await res.json()) as { id: string; name: string; webViewLink?: string };
}

/** Reads the text of a file AetherDeck created. */
export async function driveRead(api: Api, id: string, limit = 200_000) {
  if (!/^[\w-]{6,100}$/.test(id)) throw new Error("That isn't a Drive file id");
  const res = await call(api, `https://www.googleapis.com/drive/v3/files/${id}?alt=media`);
  return (await res.text()).slice(0, limit);
}

/** Lists files AetherDeck created, newest first. */
export async function driveList(api: Api, limit = 20) {
  const q = new URLSearchParams({ pageSize: String(Math.min(limit, 50)), orderBy: "modifiedTime desc", fields: "files(id,name,mimeType,modifiedTime,webViewLink)" });
  const res = await call(api, `https://www.googleapis.com/drive/v3/files?${q}`);
  return ((await res.json()) as { files?: unknown[] }).files ?? [];
}

/* ---------- Calendar (calendar.events) ---------- */
export interface CalendarEvent { id?: string; summary?: string; start?: { dateTime?: string; date?: string }; end?: { dateTime?: string; date?: string }; htmlLink?: string; location?: string }

export function eventBody(o: { title: string; start: string; end?: string; description?: string; location?: string; timeZone?: string }) {
  const allDay = /^\d{4}-\d{2}-\d{2}$/.test(o.start);
  const when = (v: string) => (allDay ? { date: v } : { dateTime: v, ...(o.timeZone ? { timeZone: o.timeZone } : {}) });
  if (!allDay && Number.isNaN(Date.parse(o.start))) throw new Error("start must be an ISO date or date-time, such as 2026-11-12T15:00:00-05:00");
  const end = o.end ?? (allDay ? o.start : new Date(Date.parse(o.start) + 3_600_000).toISOString());
  return { summary: o.title.slice(0, 300), ...(o.description ? { description: o.description.slice(0, 8000) } : {}), ...(o.location ? { location: o.location.slice(0, 300) } : {}), start: when(o.start), end: when(end) };
}

export async function calendarAdd(api: Api, o: Parameters<typeof eventBody>[0]) {
  const res = await call(api, "https://www.googleapis.com/calendar/v3/calendars/primary/events", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(eventBody(o)) });
  return (await res.json()) as CalendarEvent;
}

export async function calendarList(api: Api, o: { from?: string; to?: string; limit?: number } = {}) {
  const q = new URLSearchParams({ singleEvents: "true", orderBy: "startTime", maxResults: String(Math.min(o.limit ?? 20, 50)), timeMin: o.from ?? new Date().toISOString(), ...(o.to ? { timeMax: o.to } : {}) });
  const res = await call(api, `https://www.googleapis.com/calendar/v3/calendars/primary/events?${q}`);
  return (((await res.json()) as { items?: CalendarEvent[] }).items ?? []).map((e) => ({ id: e.id, title: e.summary, start: e.start?.dateTime ?? e.start?.date, end: e.end?.dateTime ?? e.end?.date, location: e.location, link: e.htmlLink }));
}
