// AI settings when AetherDeck runs in an ordinary browser (including AetherDeck for Mac): the same calls the desktop
// app makes through Electron, answered by this computer's local server instead.
import type { AppInfo } from "./desktop.ts";

const call = async <T,>(path: string, body?: unknown): Promise<T> => {
  const r = await fetch(path, { method: body === undefined ? "GET" : "POST", headers: { "x-aetherdeck-settings": "1", ...(body === undefined ? {} : { "Content-Type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${r.status}`);
  return r.json() as Promise<T>;
};

type Saved = { keys: Record<string, boolean>; config: Record<string, string> };
const info = async (): Promise<AppInfo> => { const s = await call<Saved>("/api/settings"); return { version: "browser", platform: "web", keys: s.keys, contact: "", config: s.config, isDefault: false, packaged: false }; };

type SignIn = { signedIn: boolean; email?: string; pending: boolean; link?: string; error?: string };
let lastLink = "";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Sign in with ChatGPT: the server waits for OpenAI's reply on this computer; a tab here is where the person approves. */
async function chatgptSignIn(): Promise<{ email?: string }> {
  const tab = window.open("", "_blank"); // opened now, while the click still counts, and pointed at the sign-in below
  try {
    const s = await call<SignIn>("/api/chatgpt/start", {});
    lastLink = s.link ?? "";
    if (tab && lastLink) tab.location.href = lastLink; else if (!tab && lastLink) window.open(lastLink, "_blank");
    for (let i = 0; i < 600; i++) {
      await sleep(1000);
      const now = await call<SignIn>("/api/chatgpt/status");
      if (now.error) throw new Error(now.error);
      if (!now.pending) { if (now.signedIn) return { email: now.email }; throw new Error("cancelled"); }
    }
    throw new Error("The sign-in took too long. Try again.");
  } finally { lastLink = ""; try { tab?.close(); } catch { /* already closed */ } }
}

export const webBridge = {
  async invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
    if (channel === "app:info") return (await info()) as T;
    if (channel === "app:setKeys") { const [keys, , config] = args as [Record<string, string>, unknown, Record<string, string> | undefined]; return (await call<Saved>("/api/settings", { keys, config })).keys as T; }
    if (channel === "ai:models") { const [provider, key] = args as [string, string | undefined]; return call<T>("/api/ai/models", { provider, key }); }
    if (channel === "chatgpt:status") { const s = await call<SignIn>("/api/chatgpt/status"); return { signedIn: s.signedIn, email: s.email, available: true } as T; }
    if (channel === "chatgpt:signIn") return (await chatgptSignIn()) as T;
    if (channel === "chatgpt:cancel") { await call("/api/chatgpt/cancel", {}); return undefined as T; }
    if (channel === "chatgpt:link") return lastLink as T;
    if (channel === "chatgpt:signOut") { await call("/api/chatgpt/signout", {}); return undefined as T; }
    if (channel === "app:openExternal") { window.open(String(args[0]), "_blank", "noopener"); return undefined as T; }
    throw new Error("Not available in the browser");
  },
};
