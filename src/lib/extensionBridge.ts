// The second backend behind `desktop` (src/lib/desktop.ts): AetherDeck running inside the Sidekick browser extension
// (chromium/) instead of the Electron app. Same Bridge shape, so code that asks `desktop.invoke(...)` works in both;
// what a browser extension cannot do is refused with a clear error rather than failing silently.
import type { Bridge } from "./desktop.ts";

/** The few parts of the `chrome` object used here (the project has no @types/chrome). */
interface Chrome {
  runtime: { id?: string; getManifest(): { version: string }; onMessage: { addListener(fn: (m: unknown) => void): void; removeListener(fn: (m: unknown) => void): void } };
  storage: { local: { get(keys: string | string[]): Promise<Record<string, unknown>>; set(items: Record<string, unknown>): Promise<void> } };
  tabs: { create(p: { url: string }): Promise<unknown> };
}
const chromeApi = () => (globalThis as unknown as { chrome?: Chrome }).chrome;

/** True on the extension's own pages (chrome-extension://…), never on a web page or in Electron. */
export const inExtension = () => typeof location !== "undefined" && location.protocol === "chrome-extension:" && !!chromeApi()?.runtime?.id;

export const DEFAULT_SERVER = "http://127.0.0.1:8787";

export interface SidekickSettings { server: string; token: string }

/** Where the AetherDeck server is and the token it gave this extension (set on the options page). */
export async function sidekickSettings(): Promise<SidekickSettings> {
  const s = await chromeApi()!.storage.local.get(["server", "token"]);
  const server = typeof s.server === "string" && /^https?:\/\//.test(s.server) ? s.server.replace(/\/+$/, "") : DEFAULT_SERVER;
  return { server, token: typeof s.token === "string" ? s.token : "" };
}

/**
 * Pages of the interface call `fetch("/api/…")`. Inside the extension that path means nothing, so it is sent to the
 * AetherDeck server with the token. Only /api/ paths are touched; every other request goes out as it was.
 */
export function installExtensionFetch() {
  const real = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof input === "string" && input.startsWith("/api/")) {
      const { server, token } = await sidekickSettings();
      const headers = new Headers(init?.headers);
      if (token) headers.set("X-AetherDeck-Token", token);
      return real(server + input, { ...init, headers });
    }
    return real(input, init);
  };
}

const platform = () => (/mac/i.test(navigator.platform) ? "darwin" : /win/i.test(navigator.platform) ? "win32" : "linux");

/** Channels an extension can honour. The rest are the desktop app's and say so. */
async function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
  const c = chromeApi()!;
  switch (channel) {
    case "app:info": return { version: c.runtime.getManifest().version, platform: platform(), keys: {}, contact: "", config: {}, isDefault: false, packaged: true };
    case "app:ready": return [];
    case "app:openExternal": { const url = String(args[0] ?? ""); if (/^https?:\/\//i.test(url)) await c.tabs.create({ url }); return undefined; }
    case "research:load": return ((await c.storage.local.get("research")).research as unknown) ?? null;
    case "research:save": await c.storage.local.set({ research: args[0] }); return undefined;
    case "agents:list": return ((await c.storage.local.get("agents")).agents as unknown) ?? [];
    case "agents:save": await c.storage.local.set({ agents: args[0] }); return undefined;
    default: throw new Error(`Not available in the browser extension: ${channel}`);
  }
}

/** Commands from the extension's background page (the context menu) arrive as messages and look like the desktop app's events. */
function on(channel: string, fn: (payload: unknown) => void): () => void {
  const c = chromeApi()!;
  const handler = (m: unknown) => { const msg = m as { channel?: string; payload?: unknown } | null; if (msg && msg.channel === channel) fn(msg.payload); };
  c.runtime.onMessage.addListener(handler);
  return () => c.runtime.onMessage.removeListener(handler);
}

export function extensionBridge(): Bridge | null {
  if (!inExtension()) return null;
  return { platform: platform(), invoke: invoke as Bridge["invoke"], on, pathFor: () => "" };
}
