// What the desktop app keeps on this computer, in the app's own data folder: history, bookmarks and settings.
// API keys are encrypted with the operating system's keychain (safeStorage) before they are written.
import { readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import { safeStorage } from "electron";

function readJson<T>(file: string, fallback: T): T {
  try { return JSON.parse(readFileSync(file, "utf8")) as T; } catch { return fallback; }
}

function writeJson(file: string, value: unknown) {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(value));
  renameSync(tmp, file);
}

/** Keys the person can set in Settings. They become the server's environment when the app starts. */
export const KEY_NAMES = ["BRAVE_API_KEY", "TAVILY_API_KEY", "YOUTUBE_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "OPENROUTER_API_KEY", "GROQ_API_KEY", "GEMINI_API_KEY"] as const;
export type KeyName = (typeof KEY_NAMES)[number];

/** Settings that are not secret: which AI provider and model to use, and a SearXNG address. */
export const CONFIG_NAMES = ["LLM_PROVIDER", "LLM_MODEL", "SEARXNG_URL", "HORUS_SEARCH_ENGINE", "HORUS_VOICE", "HORUS_SHIELDS"] as const;
export type ConfigName = (typeof CONFIG_NAMES)[number];

export interface HistoryEntry { url: string; title: string; at: number }
export interface Bookmark { url: string; title: string; at: number }

const HISTORY_MAX = 10_000;

export class Store {
  private dir: string;
  history: HistoryEntry[];
  bookmarks: Bookmark[];
  agents: unknown[];
  private settings: { keys: Partial<Record<KeyName, string>>; contact?: string; config?: Partial<Record<ConfigName, string>>; shieldsOff?: string[] };
  private timer: NodeJS.Timeout | null = null;

  constructor(dir: string) {
    this.dir = dir;
    mkdirSync(dir, { recursive: true });
    this.history = readJson(join(dir, "history.json"), []);
    this.bookmarks = readJson(join(dir, "bookmarks.json"), []);
    this.agents = readJson(join(dir, "agents.json"), []);
    this.settings = readJson(join(dir, "settings.json"), { keys: {} });
  }

  private saveSoon() {
    if (this.timer) return;
    this.timer = setTimeout(() => this.flush(), 800);
  }

  flush() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    writeJson(join(this.dir, "history.json"), this.history);
    writeJson(join(this.dir, "bookmarks.json"), this.bookmarks);
  }

  /** A visit. A title arriving for the page just visited updates that entry instead of adding another. */
  visit(url: string, title: string) {
    if (!/^https?:/.test(url)) return;
    const last = this.history[0];
    if (last && last.url === url && Date.now() - last.at < 30 * 60_000) last.title = title || last.title;
    else this.history.unshift({ url, title: title || url, at: Date.now() });
    if (this.history.length > HISTORY_MAX) this.history.length = HISTORY_MAX;
    this.saveSoon();
  }

  searchHistory(q: string, limit = 200) {
    const s = q.trim().toLowerCase();
    return (s ? this.history.filter((h) => h.url.toLowerCase().includes(s) || h.title.toLowerCase().includes(s)) : this.history).slice(0, limit);
  }

  clearHistory() { this.history = []; this.saveSoon(); }
  removeHistory(url: string) { this.history = this.history.filter((h) => h.url !== url); this.saveSoon(); }

  toggleBookmark(url: string, title: string) {
    const had = this.bookmarks.some((b) => b.url === url);
    this.bookmarks = had ? this.bookmarks.filter((b) => b.url !== url) : [{ url, title: title || url, at: Date.now() }, ...this.bookmarks];
    this.saveSoon();
    return !had;
  }

  /** Which keys are set (never their values: those stay in this process). */
  keyStatus() {
    return Object.fromEntries(KEY_NAMES.map((k) => [k, Boolean(this.settings.keys[k])])) as Record<KeyName, boolean>;
  }

  /** The agents made in the Agent Station. They hold no keys. */
  saveAgents(agents: unknown[]) {
    this.agents = agents;
    writeJson(join(this.dir, "agents.json"), agents);
  }

  /** Sites the person turned Shields off for. */
  shieldsOff() { return this.settings.shieldsOff ?? []; }
  setShieldsOff(sites: string[]) {
    this.settings.shieldsOff = sites;
    writeJson(join(this.dir, "settings.json"), this.settings);
  }

  contact() { return this.settings.contact ?? ""; }

  config(): Partial<Record<ConfigName, string>> { return { ...(this.settings.config ?? {}) }; }

  setConfig(update: Partial<Record<ConfigName, string>>) {
    const next = { ...(this.settings.config ?? {}) };
    for (const k of CONFIG_NAMES) {
      if (!(k in update)) continue;
      const v = update[k]?.trim();
      if (v) next[k] = v; else delete next[k];
    }
    this.settings.config = next;
    writeJson(join(this.dir, "settings.json"), this.settings);
  }

  /** Keys as plain text, for the server's environment. */
  keys(): Partial<Record<KeyName, string>> {
    const out: Partial<Record<KeyName, string>> = {};
    for (const k of KEY_NAMES) {
      const v = this.settings.keys[k];
      if (!v) continue;
      try { out[k] = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(Buffer.from(v, "base64")) : Buffer.from(v, "base64").toString("utf8"); } catch { /* unreadable on this machine: treat as unset */ }
    }
    return out;
  }

  /** Set (or, with an empty value, remove) keys. */
  setKeys(update: Partial<Record<KeyName, string>>, contact?: string) {
    for (const k of KEY_NAMES) {
      if (!(k in update)) continue;
      const v = update[k]?.trim();
      if (!v) delete this.settings.keys[k];
      else this.settings.keys[k] = (safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(v) : Buffer.from(v, "utf8")).toString("base64");
    }
    if (contact !== undefined) this.settings.contact = contact.trim();
    writeJson(join(this.dir, "settings.json"), this.settings);
  }
}
