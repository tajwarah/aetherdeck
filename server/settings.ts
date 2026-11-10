// AI settings for the browser version (no Electron): the keys and choices are kept in one file in the data folder,
// readable only by this user, and put into the server's environment. Electron keeps its own, encrypted with the keychain.
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { IncomingMessage } from "node:http";
import { listModels, AI_PROVIDERS, resetBackend } from "./models.ts";

export const SETTING_KEYS = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "OPENROUTER_API_KEY", "GROQ_API_KEY", "GEMINI_API_KEY", "OLLAMA_API_KEY", "MOONSHOT_API_KEY", "LLM_API_KEY", "BRAVE_API_KEY", "TAVILY_API_KEY", "YOUTUBE_API_KEY"] as const;
export const SETTING_CONFIG = ["LLM_PROVIDER", "LLM_MODEL", "LLM_BASE_URL", "OLLAMA_URL", "SEARXNG_URL"] as const;
type Saved = { keys: Record<string, string>; config: Record<string, string> };

const fileOf = (dir: string) => join(dir, "ai-settings.json");

function read(dir: string): Saved {
  try { const v = JSON.parse(readFileSync(fileOf(dir), "utf8")) as Partial<Saved>; return { keys: v.keys ?? {}, config: v.config ?? {} }; } catch { return { keys: {}, config: {} }; }
}

/** At start: what was saved becomes the environment, unless the person already set it there. */
export function loadSettings(dir: string) {
  const s = read(dir);
  for (const [k, v] of Object.entries({ ...s.keys, ...s.config })) if (v && process.env[k] === undefined) process.env[k] = v;
}

const status = (dir: string) => {
  const s = read(dir);
  return {
    keys: Object.fromEntries(SETTING_KEYS.map((k) => [k, Boolean(s.keys[k] || process.env[k])])),
    config: Object.fromEntries(SETTING_CONFIG.map((k) => [k, s.config[k] ?? process.env[k] ?? ""]).filter(([, v]) => v)),
    stored: existsSync(fileOf(dir)),
  };
};

/** Only the page this server itself serves may change settings: not another site, and not a rebinding trick. */
export function sameOriginOnly(req: IncomingMessage): boolean {
  const host = String(req.headers.host ?? "");
  if (!/^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(host)) return false;
  const origin = req.headers.origin;
  if (origin && origin !== `http://${host}`) return false;
  return req.headers["x-aetherdeck-settings"] === "1";
}

export function getSettings(dir: string) { return status(dir); }

export function saveSettings(dir: string, body: { keys?: Record<string, string>; config?: Record<string, string> }) {
  const s = read(dir);
  for (const [k, v] of Object.entries(body.keys ?? {})) {
    if (!(SETTING_KEYS as readonly string[]).includes(k) || typeof v !== "string" || v.length > 400) continue;
    if (v.trim()) { s.keys[k] = v.trim(); process.env[k] = v.trim(); } else { delete s.keys[k]; delete process.env[k]; }
  }
  for (const [k, v] of Object.entries(body.config ?? {})) {
    if (!(SETTING_CONFIG as readonly string[]).includes(k) || typeof v !== "string" || v.length > 400) continue;
    if (v.trim()) { s.config[k] = v.trim(); process.env[k] = v.trim(); } else { delete s.config[k]; delete process.env[k]; }
  }
  mkdirSync(dir, { recursive: true });
  const tmp = `${fileOf(dir)}.tmp`;
  writeFileSync(tmp, JSON.stringify(s), { mode: 0o600 });
  renameSync(tmp, fileOf(dir));
  try { chmodSync(fileOf(dir), 0o600); } catch { /* not supported on this system */ }
  resetBackend();
  return status(dir);
}

export async function modelsFor(dir: string, provider: string, key?: string) {
  const p = AI_PROVIDERS.find((x) => x.id === provider);
  if (!p) return { error: "Unknown provider" };
  const apiKey = !p.keyEnv ? provider : (typeof key === "string" && key.trim()) || read(dir).keys[p.keyEnv] || process.env[p.keyEnv];
  if (!apiKey && provider !== "custom") return { error: "Enter a key first." };
  try { return { models: await listModels(provider, apiKey || "none") }; } catch (err) { return { error: (err as Error).message }; }
}
