// Lets the AetherDeck Sidekick browser extension (chromium/) call this server, and nothing else on a web page can.
//
// The rules, all checked here and covered by tests/unit/extension.test.ts:
//  - A request is "from an extension" when its Origin header is chrome-extension://<id>. Web pages cannot set that
//    origin, so only a browser running an extension can send it.
//  - Only extension ids on the list may call: the Sidekick's own (its manifest pins the key, so the id never changes)
//    plus any in AETHERDECK_EXTENSION_ID (comma separated). Any other extension origin is refused outright.
//  - An allowed extension must also carry the extension token (X-AetherDeck-Token). The token is a random secret kept
//    in a file next to the server's data (or AETHERDECK_EXTENSION_TOKEN), so another program on the computer that
//    merely fakes the Origin header still gets a 403.
//  - Only a short list of endpoints is open to it, and CORS names the one extension origin: never "*", no cookies.
//  - Everything else (the desktop app's own token cookie, plain web pages) behaves exactly as before.
import { randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** The Sidekick's id, from the public key in chromium/public/manifest.json. */
export const SIDEKICK_ID = "dpdakialhkiilacahidebgkpmcoenmop";
/** The Room flavour (chromium/dist-room, with the new-tab override) has its own pinned key, so both can be loaded at once. */
export const ROOM_ID = "jdohkdnhibacjeldkakehjfjciaijfle";

/** What the extension may ask for: its health check, one question about a page, and the research map. */
export const EXTENSION_PATHS = new Set(["/api/health", "/api/assist", "/api/explore"]);

const ID = /^[a-p]{32}$/;

export function allowedExtensionIds(env: string | undefined = process.env.AETHERDECK_EXTENSION_ID): Set<string> {
  const ids = new Set([SIDEKICK_ID, ROOM_ID]);
  for (const part of (env ?? "").split(",")) { const id = part.trim().toLowerCase(); if (ID.test(id)) ids.add(id); }
  return ids;
}

export type Caller =
  | { kind: "other" }                       // a web page, the desktop app, a script: the usual rules
  | { kind: "extension"; origin: string }   // an allowed extension
  | { kind: "refused" };                    // some other extension

/** Who is calling, from the Origin header alone. */
export function callerOf(origin: string | undefined, ids: Set<string>): Caller {
  if (!origin) return { kind: "other" };
  const m = /^(chrome|moz)-extension:\/\/([^/]+)$/i.exec(origin);
  if (!m) return { kind: "other" };
  return m[1].toLowerCase() === "chrome" && ids.has(m[2].toLowerCase()) ? { kind: "extension", origin } : { kind: "refused" };
}

export function tokenMatches(given: string | string[] | undefined, token: string): boolean {
  if (typeof given !== "string" || !token) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** CORS for one named extension origin. Credentials (cookies) are never allowed. */
export function corsFor(origin: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-AetherDeck-Token",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}

/** The token: from the environment, else from `extension-token` in the data folder (made on first use, owner-only). */
export function extensionToken(dataDir: string, env: string | undefined = process.env.AETHERDECK_EXTENSION_TOKEN): { token: string; file?: string } {
  const fromEnv = env?.trim();
  if (fromEnv && fromEnv.length >= 16) return { token: fromEnv };
  const file = join(dataDir, "extension-token");
  try {
    const saved = existsSync(file) ? readFileSync(file, "utf8").trim() : "";
    if (saved.length >= 32) return { token: saved, file };
    mkdirSync(dataDir, { recursive: true });
    const token = randomBytes(32).toString("base64url");
    writeFileSync(file, token + "\n", { mode: 0o600 });
    try { chmodSync(file, 0o600); } catch { /* not supported on this file system */ }
    return { token, file };
  } catch {
    return { token: randomBytes(32).toString("base64url") }; // read-only folder: the token lasts for this run only
  }
}

/** The decision for one request. `answer` is what to send straight back (preflight, refusal); `headers` are added to a normal reply. */
export type Verdict =
  | { go: false; status: number; body?: unknown; headers: Record<string, string> }
  | { go: true; extension: boolean; headers: Record<string, string> };

export function judge(req: Pick<IncomingMessage, "method" | "headers">, pathname: string, ids: Set<string>, token: string): Verdict {
  const who = callerOf(req.headers.origin, ids);
  if (who.kind === "other") return { go: true, extension: false, headers: {} };
  if (who.kind === "refused") return { go: false, status: 403, body: { error: "Forbidden" }, headers: {} };
  const headers = corsFor(who.origin);
  // A preflight carries no custom headers, so it cannot carry the token; it only reveals what is allowed.
  if (req.method === "OPTIONS") return { go: false, status: 204, headers };
  if (!tokenMatches(req.headers["x-aetherdeck-token"], token)) return { go: false, status: 403, body: { error: "Missing or wrong extension token. Copy it from the server's extension-token file into the extension's options." }, headers };
  if (!EXTENSION_PATHS.has(pathname)) return { go: false, status: 404, body: { error: "Not available to the extension" }, headers };
  return { go: true, extension: true, headers };
}
