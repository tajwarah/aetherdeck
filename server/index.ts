// Warpnaut API — a small node:http server. Credentials stay here; the browser never sees them.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { z } from "zod/v4";
import { ActionDraftRequest, ExploreRequest } from "../shared/types.ts";
import { explore } from "./orchestrator.ts";
import { prepareAction, confirmAction } from "./actions.ts";
import { geocode } from "./providers/osm.ts";
import { frameCheck } from "./preview.ts";
import { searchVideos, videoSearchConfigured } from "./providers/youtube.ts";
import { providerStatus, demoForced } from "./providers/index.ts";
import { llmEnabled, llmInfo } from "./llm.ts";
import { assist, AssistRequest } from "./assist.ts";
import { TranscribeRequest, transcribe, voiceService } from "./voice.ts";
import { AgentRequest, planAgents } from "./agent.ts";
import { listBrains } from "./brains.ts";
import { AgentTurn, agentTurn, claudeReady, DraftPlan, draftPlan } from "./claude.ts";
import { getBackend } from "./models.ts";
import { log } from "./log.ts";
import { contactConfigured } from "./http.ts";
import { MAX_BLOB, SyncError, SyncStore, validId, validToken } from "./sync.ts";
import { networkInterfaces } from "node:os";

const MAX_BODY = 32 * 1024;

export interface ServerOptions {
  port: number;
  /** 127.0.0.1 inside the desktop app; all interfaces for `npm start` and `npm run dev:lan`. */
  host?: string;
  /** The built interface (vite build output). */
  dist: string;
  /** Where sync spaces are kept. */
  dataDir: string;
  /** Desktop app: every request must carry this token (set as a cookie by the app), so other programs on the
   *  computer cannot use the API or the keys behind it. */
  token?: string;
}

/** This machine's addresses on the local network, so a phone on the same Wi-Fi can be given a link it can open. */
function lanAddresses() {
  return Object.values(networkInterfaces()).flat().filter((a) => a && a.family === "IPv4" && !a.internal).map((a) => a!.address);
}

// Per-IP sliding window: protects the keyless public providers we depend on.
const hits = new Map<string, number[]>();
function rateLimited(ip: string, limit = 30, windowMs = 60_000) {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < windowMs);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > limit;
}

async function readBody(req: IncomingMessage, max = MAX_BODY): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > max) throw Object.assign(new Error("Request too large"), { status: 413 });
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw Object.assign(new Error("Invalid JSON"), { status: 400 });
  }
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "geolocation=(self), microphone=(self), camera=()",
};

/** The interface can reach the agent engine, so nothing it didn't ship with may run in it. */
const INTERFACE_POLICY = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src * data: blob:; media-src * data: blob:; connect-src 'self' blob: data:; font-src 'self' data:; frame-src *; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'none'";

const MIME: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon", ".woff2": "font/woff2" };

async function serveStatic(DIST: string, path: string, res: ServerResponse) {
  const safe = normalize(path).replace(/^(\.\.[/\\])+/, "");
  let file = join(DIST, safe);
  try {
    if (!(await stat(file)).isFile()) throw new Error();
  } catch {
    file = join(DIST, "index.html");
  }
  try {
    const data = await readFile(file);
    res.writeHead(200, { "Content-Type": MIME[extname(file)] ?? "application/octet-stream", ...(file.endsWith(".html") ? { "Content-Security-Policy": INTERFACE_POLICY } : {}), ...(file.includes("/assets/") || file.includes("/rooms/") ? { "Cache-Control": "public, max-age=31536000, immutable" } : {}) });
    res.end(data);
  } catch {
    send(res, 404, { error: "Not built. Run npm run build, or use npm run dev." });
  }
}

const tokenOk = (req: IncomingMessage, token: string) => {
  const cookie = /(?:^|;\s*)warpnaut_token=([\w-]+)/.exec(req.headers.cookie ?? "")?.[1];
  return cookie === token || req.headers["x-warpnaut-token"] === token;
};

/** Starts the API (and, when built, the interface). Resolves with the port it listens on. */
export function startServer(opts: ServerOptions): Promise<{ port: number; close: () => void }> {
  const sync = new SyncStore(opts.dataDir);
  const server = createServer(async (req, res) => {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
  const url = new URL(req.url ?? "/", "http://localhost");
  const ip = req.socket.remoteAddress ?? "unknown";
  if (opts.token && !tokenOk(req, opts.token)) return send(res, 403, { error: "Forbidden" });
  try {
    if (url.pathname === "/api/health") {
      return send(res, 200, { ok: true, demo: demoForced(), llm: llmEnabled(), model: llmInfo(), vision: getBackend()?.vision ?? false, voice: voiceService()?.label ?? null, claude: claudeReady(), providers: providerStatus(), videoSearch: videoSearchConfigured(), sync: true, publicUrl: process.env.PUBLIC_URL || null, lan: lanAddresses() });
    }

    if (url.pathname === "/api/explore" && req.method === "POST") {
      if (rateLimited(ip)) return send(res, 429, { error: "Too many searches — wait a moment." });
      const parsed = ExploreRequest.safeParse(await readBody(req));
      if (!parsed.success) return send(res, 400, { error: "Invalid request", issues: z.prettifyError(parsed.error) });
      res.writeHead(200, { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" });
      const ctrl = new AbortController();
      res.on("close", () => ctrl.abort());
      try {
        await explore(parsed.data, (model) => { if (!res.writableEnded) res.write(JSON.stringify({ type: "model", model }) + "\n"); }, ctrl.signal);
      } catch (err) {
        log("error", "explore_failed", { error: (err as Error).stack });
        res.write(JSON.stringify({ type: "error", message: "Something went wrong while exploring. Nothing was fabricated; please try again." }) + "\n");
      }
      return res.end();
    }

    // Files and pages handed to the assistant: up to ~16 MB (a large PDF or photo, base64).
    if (url.pathname === "/api/assist" && req.method === "POST") {
      if (rateLimited(`assist:${ip}`, 20)) return send(res, 429, { error: "Too many questions — wait a moment." });
      const parsed = AssistRequest.safeParse(await readBody(req, 24 * 1024 * 1024));
      if (!parsed.success) return send(res, 400, { error: "Invalid request", issues: z.prettifyError(parsed.error) });
      try {
        return send(res, 200, await assist(parsed.data));
      } catch (err) {
        const e = err as Error & { status?: number };
        log("warn", "assist_failed", { error: e.message });
        return send(res, e.status ?? 502, { error: e.message });
      }
    }

    // Voice: one recording to text (Whisper or Gemini), and the agents' plan for a request.
    if (url.pathname === "/api/transcribe" && req.method === "POST") {
      if (rateLimited(`voice:${ip}`, 30)) return send(res, 429, { error: "Too many recordings — wait a moment." });
      const parsed = TranscribeRequest.safeParse(await readBody(req, 16 * 1024 * 1024));
      if (!parsed.success) return send(res, 400, { error: "Invalid recording" });
      try {
        return send(res, 200, await transcribe(parsed.data));
      } catch (err) {
        const e = err as Error & { status?: number };
        log("warn", "transcribe_failed", { error: e.message });
        return send(res, e.status ?? 502, { error: e.message });
      }
    }
    if (url.pathname === "/api/agent" && req.method === "POST") {
      if (rateLimited(`agent:${ip}`, 20)) return send(res, 429, { error: "Too many requests — wait a moment." });
      const parsed = AgentRequest.safeParse(await readBody(req, 256 * 1024));
      if (!parsed.success) return send(res, 400, { error: "Invalid request", issues: z.prettifyError(parsed.error) });
      try {
        return send(res, 200, await planAgents(parsed.data));
      } catch (err) {
        const e = err as Error & { status?: number };
        log("warn", "agent_failed", { error: e.message });
        return send(res, e.status ?? 502, { error: e.status ? e.message : "The model's plan couldn't be read. Try saying it another way." });
      }
    }

    // Agents: what they can think with, one turn of their work, and a plan drafted for a new one.
    if (url.pathname === "/api/crew/brains" && req.method === "GET") return send(res, 200, { brains: await listBrains() });
    if (url.pathname === "/api/crew/turn" && req.method === "POST") {
      if (rateLimited(`claude:${ip}`, 60)) return send(res, 429, { error: "Too many requests — wait a moment." });
      const parsed = AgentTurn.safeParse(await readBody(req, 4 * 1024 * 1024));
      if (!parsed.success) return send(res, 400, { error: "Invalid request", issues: z.prettifyError(parsed.error) });
      try {
        return send(res, 200, await agentTurn(parsed.data));
      } catch (err) {
        const e = err as Error & { status?: number };
        log("warn", "claude_turn_failed", { error: e.message, status: e.status });
        return send(res, e.status ?? 502, { error: e.status === 401 ? e.message.replace(/^401.*/, "The model's provider didn't accept this API key.") : e.message });
      }
    }
    if (url.pathname === "/api/crew/plan" && req.method === "POST") {
      if (rateLimited(`claude:${ip}`, 60)) return send(res, 429, { error: "Too many requests — wait a moment." });
      const parsed = DraftPlan.safeParse(await readBody(req));
      if (!parsed.success) return send(res, 400, { error: "Describe the task first" });
      try {
        return send(res, 200, await draftPlan(parsed.data));
      } catch (err) {
        const e = err as Error & { status?: number };
        log("warn", "claude_plan_failed", { error: e.message, status: e.status });
        return send(res, e.status ?? 502, { error: e.status === 401 ? "The model's provider didn't accept this API key." : "The plan couldn't be drafted. Try again, or write it yourself." });
      }
    }

    if (url.pathname === "/api/geocode" && req.method === "GET") {
      const q = z.string().trim().min(2).max(200).safeParse(url.searchParams.get("q"));
      if (!q.success) return send(res, 400, { error: "Provide a place name" });
      if (rateLimited(`geo:${ip}`, 20)) return send(res, 429, { error: "Too many lookups" });
      const place = await geocode(q.data).catch(() => undefined);
      if (place === undefined) return send(res, 502, { error: "Place lookup is unavailable right now" });
      return place ? send(res, 200, place) : send(res, 404, { error: "No place found with that name" });
    }

    // Floating windows: video search for "play …" (needs a free YouTube Data API key).
    if (url.pathname === "/api/videos" && req.method === "GET") {
      const q = z.string().trim().min(1).max(200).safeParse(url.searchParams.get("q"));
      if (!q.success) return send(res, 400, { error: "Say what to play" });
      if (!videoSearchConfigured()) return send(res, 200, { configured: false, items: [] });
      if (rateLimited(`video:${ip}`, 20)) return send(res, 429, { error: "Too many searches" });
      try {
        return send(res, 200, { configured: true, items: await searchVideos(q.data) });
      } catch (err) {
        log("warn", "video_search_failed", { error: (err as Error).message });
        return send(res, 502, { error: "Video search is unavailable right now" });
      }
    }

    // Floating windows: can this page be shown inside Warpnaut, or must it open in its own tab?
    if (url.pathname === "/api/frameable" && req.method === "GET") {
      const q = z.string().trim().min(3).max(2000).safeParse(url.searchParams.get("url"));
      if (!q.success) return send(res, 400, { error: "Provide a web address" });
      if (rateLimited(`frame:${ip}`, 40)) return send(res, 429, { error: "Too many lookups" });
      try {
        return send(res, 200, await frameCheck(q.data));
      } catch (err) {
        return send(res, 200, { frameable: false, reason: (err as Error).message, url: q.data });
      }
    }

    // Sync spaces (see server/sync.ts): encrypted blobs, written with a token derived from the link's key.
    const space = url.pathname.match(/^\/api\/sync\/([\w-]+)(\/events)?$/);
    if (space) {
      const [, id, events] = space;
      const token = String(req.headers["x-sync-auth"] ?? "");
      if (!validId(id) || !validToken(token)) return send(res, 400, { error: "Invalid sync link" });
      if (rateLimited(`sync:${ip}`, 300)) return send(res, 429, { error: "Syncing too fast — wait a moment" });
      try {
        if (events && req.method === "GET") {
          res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no", Connection: "keep-alive" });
          const write = (e: unknown) => { if (!res.writableEnded) res.write(`data: ${JSON.stringify(e)}\n\n`); };
          const stop = await sync.subscribe(id, token, write);
          const ping = setInterval(() => { if (!res.writableEnded) res.write(": ping\n\n"); }, 20_000);
          res.on("close", () => { clearInterval(ping); stop(); });
          return;
        }
        if (!events && req.method === "GET") return send(res, 200, await sync.get(id, token));
        if (!events && req.method === "PUT") {
          const body = z.object({ base: z.number().int().min(0), blob: z.string().min(1).max(MAX_BLOB) }).safeParse(await readBody(req, MAX_BLOB + 1024));
          if (!body.success) return send(res, 400, { error: "Invalid sync update" });
          if (body.data.base === 0 && rateLimited(`sync-new:${ip}`, 30, 3_600_000)) return send(res, 429, { error: "Too many new spaces from here" });
          return send(res, 200, await sync.put(id, token, body.data.base, body.data.blob));
        }
        if (!events && req.method === "DELETE") { await sync.remove(id, token); return send(res, 200, { ok: true }); }
        return send(res, 405, { error: "Method not allowed" });
      } catch (err) {
        if (err instanceof SyncError) return send(res, err.status, { error: err.message, ...(err.v ? { v: err.v } : {}) });
        throw err;
      }
    }

    if (url.pathname === "/api/actions/draft" && req.method === "POST") {
      const parsed = ActionDraftRequest.safeParse(await readBody(req));
      if (!parsed.success) return send(res, 400, { error: "Invalid request", issues: z.prettifyError(parsed.error) });
      if (parsed.data.source.freshnessStatus === "sample") return send(res, 400, { error: "Sample listings can't be contacted." });
      return send(res, 200, await prepareAction(parsed.data));
    }

    const confirm = url.pathname.match(/^\/api\/actions\/([\w-]{36})\/confirm$/);
    if (confirm && req.method === "POST") {
      const body = z.object({ channel: z.enum(["phone", "email", "website", "map"]), confirmed: z.literal(true) }).safeParse(await readBody(req));
      if (!body.success) return send(res, 400, { error: "Explicit confirmation is required" });
      const task = confirmAction(confirm[1], body.data.channel);
      return task ? send(res, 200, task) : send(res, 404, { error: "That request expired — prepare it again." });
    }

    if (url.pathname.startsWith("/api/")) return send(res, 404, { error: "Not found" });
    return serveStatic(opts.dist, url.pathname, res);
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    if (status >= 500) log("error", "request_failed", { path: url.pathname, error: (err as Error).stack });
    if (!res.headersSent) send(res, status, { error: status >= 500 ? "Internal error" : (err as Error).message });
    else res.end();
  }
});

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port, opts.host, () => {
      if (!contactConfigured) log("warn", "contact_missing", { hint: "Set WARPNAUT_CONTACT (an email or URL). Wikimedia and OpenStreetMap ask API clients to identify themselves and throttle anonymous ones." });
      log("info", "listening", { port: opts.port, llm: llmInfo()?.provider ?? "off", demo: demoForced(), providers: providerStatus().filter((p) => p.configured).map((p) => p.id) });
      const addr = server.address();
      resolve({ port: typeof addr === "object" && addr ? addr.port : opts.port, close: () => server.close() });
    });
  });
}
