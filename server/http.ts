// Outbound HTTP with timeouts and an identifying User-Agent (required by OSM and Wikimedia policies).
const contact = process.env.WARPNAUT_CONTACT?.trim();
export const USER_AGENT = `Warpnaut/0.1 (spatial search prototype${contact ? `; ${contact}` : "; contact not configured"})`;
export const contactConfigured = Boolean(contact);

export class ProviderError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

/** Hosts that ask for gentle, mostly serial access. */
const HOST_CONCURRENCY: Record<string, number> = {
  "en.wikipedia.org": 2,
  "nominatim.openstreetmap.org": 1,
  "export.arxiv.org": 1,
  "photon.komoot.io": 3,
};
const gates = new Map<string, { active: number; queue: (() => void)[] }>();

async function withHostGate<T>(url: string, fn: () => Promise<T>): Promise<T> {
  const host = new URL(url).hostname;
  const limit = HOST_CONCURRENCY[host];
  if (!limit) return fn();
  const gate = gates.get(host) ?? { active: 0, queue: [] };
  gates.set(host, gate);
  if (gate.active >= limit) await new Promise<void>((resolve) => gate.queue.push(resolve));
  gate.active++;
  try {
    return await fn();
  } finally {
    gate.active--;
    gate.queue.shift()?.();
  }
}

export function fetchWithTimeout(url: string, init: RequestInit & { timeoutMs?: number } = {}) {
  return withHostGate(url, () => rawFetch(url, init));
}

async function rawFetch(url: string, init: RequestInit & { timeoutMs?: number }) {
  const { timeoutMs = 8000, ...rest } = init;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  rest.signal?.addEventListener("abort", () => ctrl.abort(), { once: true });
  try {
    return await fetch(url, {
      ...rest,
      signal: ctrl.signal,
      headers: { "User-Agent": USER_AGENT, ...(rest.headers ?? {}) },
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      throw rest.signal?.aborted ? new ProviderError("cancelled", "Cancelled") : new ProviderError("timeout", `Timed out after ${timeoutMs / 1000} s`);
    }
    throw new ProviderError("network", (err as Error).message);
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchJson(url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<unknown> {
  const res = await fetchWithTimeout(url, init);
  const text = await res.text();
  if (!res.ok) throw new ProviderError(res.status === 429 ? "rate_limited" : "http", `HTTP ${res.status}`);
  try {
    return JSON.parse(text);
  } catch {
    // Some public APIs answer rate limits with a 200 and a plain-text explanation.
    if (/limit requests|rate limit|too many/i.test(text)) throw new ProviderError("rate_limited", "Provider asked us to slow down");
    throw new ProviderError("bad_response", "Response was not JSON");
  }
}

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function stableId(provider: string, key: string): string {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return `${provider}-${(h >>> 0).toString(36)}`;
}

export function decodeEntities(s: string): string {
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&");
}
