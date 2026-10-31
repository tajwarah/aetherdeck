// Direct URL lookup: fetches one public page for a reading view.
// Guards: http(s) only, no private/loopback addresses (checked on every redirect hop), robots.txt honored,
// size and time limits. Only metadata and leading paragraphs are kept.
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { SearchResult } from "../shared/types.ts";
import { fetchWithTimeout, ProviderError, stableId, domainOf, decodeEntities, USER_AGENT } from "./http.ts";

const MAX_BYTES = 1_500_000;

export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    if (v.startsWith("::ffff:")) return isPrivateAddress(v.slice(7));
    return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80");
  }
  const [a, b] = ip.split(".").map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

async function assertPublic(url: URL) {
  if (!/^https?:$/.test(url.protocol)) throw new ProviderError("blocked", "Only http and https addresses can be opened");
  if (/^(localhost|.*\.local|.*\.internal)$/i.test(url.hostname)) throw new ProviderError("blocked", "Private addresses cannot be opened");
  const addrs = isIP(url.hostname) ? [{ address: url.hostname }] : await lookup(url.hostname, { all: true }).catch(() => []);
  if (!addrs.length) throw new ProviderError("not_found", `Could not resolve ${url.hostname}`);
  if (addrs.some((a) => isPrivateAddress(a.address))) throw new ProviderError("blocked", "Private addresses cannot be opened");
}

/** Minimal robots.txt check for the "*" group (and our own agent name). */
export function robotsAllows(robots: string, path: string): boolean {
  let applies = false;
  let sawRuleForGroup = false;
  const disallow: string[] = [];
  const allow: string[] = [];
  for (const raw of robots.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const [, key, value] = m;
    if (key.toLowerCase() === "user-agent") {
      if (sawRuleForGroup) { applies = false; sawRuleForGroup = false; }
      if (value === "*" || /horus/i.test(value)) applies = true;
    } else if (applies) {
      sawRuleForGroup = true;
      if (key.toLowerCase() === "disallow" && value) disallow.push(value);
      if (key.toLowerCase() === "allow" && value) allow.push(value);
    }
  }
  const longest = (rules: string[]) => Math.max(-1, ...rules.filter((r) => path.startsWith(r.replace(/\*.*$/, ""))).map((r) => r.length));
  return longest(allow) >= longest(disallow);
}

async function getPublic(url: URL, hops = 0): Promise<Response> {
  await assertPublic(url);
  const res = await fetchWithTimeout(url.toString(), { redirect: "manual", timeoutMs: 7000, headers: { Accept: "text/html,application/xhtml+xml" } });
  if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
    if (hops >= 3) throw new ProviderError("redirects", "Too many redirects");
    return getPublic(new URL(res.headers.get("location")!, url), hops + 1);
  }
  return res;
}

/** Whether a page's own headers let another origin show it in a frame. Pure, for tests. */
export function frameAncestorsAllow(headers: { xfo?: string | null; csp?: string | null }): { ok: boolean; reason?: string } {
  const xfo = headers.xfo?.trim().toLowerCase();
  if (xfo && /^(deny|sameorigin|allow-from)/.test(xfo)) return { ok: false, reason: `X-Frame-Options: ${xfo.split(",")[0]}` };
  const fa = headers.csp?.split(";").map((d) => d.trim()).find((d) => /^frame-ancestors\b/i.test(d));
  if (fa) {
    const sources = fa.replace(/^frame-ancestors\s*/i, "").split(/\s+/).filter(Boolean);
    if (!sources.some((s) => s === "*" || /^https?:$/.test(s) || /^https?:\/\/\*$/.test(s))) return { ok: false, reason: "Content-Security-Policy frame-ancestors" };
  }
  return { ok: true };
}

const frameCache = new Map<string, { at: number; value: { frameable: boolean; reason?: string; url: string } }>();

/** Asks a site (HEAD, then GET) whether it allows being shown inside Horus. Same guards as the reading view. */
export async function frameCheck(input: string): Promise<{ frameable: boolean; reason?: string; url: string }> {
  const url = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
  const key = url.toString();
  const hit = frameCache.get(key);
  if (hit && Date.now() - hit.at < 3_600_000) return hit.value;
  await assertPublic(url);
  let res: Response;
  try {
    res = await fetchWithTimeout(key, { method: "HEAD", redirect: "manual", timeoutMs: 6000 });
    if (res.status === 405 || res.status === 403 || res.status >= 500) throw new Error("retry with GET");
  } catch {
    res = await getPublic(url);
  }
  if (res.status >= 300 && res.status < 400 && res.headers.get("location")) res = await getPublic(new URL(res.headers.get("location")!, url));
  const verdict = res.ok ? frameAncestorsAllow({ xfo: res.headers.get("x-frame-options"), csp: res.headers.get("content-security-policy") }) : { ok: false, reason: `The site answered HTTP ${res.status}` };
  const value = { frameable: verdict.ok, reason: verdict.reason, url: res.url || key };
  frameCache.set(key, { at: Date.now(), value });
  return value;
}

const meta = (html: string, name: string) =>
  html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]*content=["']([^"']*)["']`, "i"))?.[1] ??
  html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${name}["']`, "i"))?.[1];

export async function previewUrl(input: string): Promise<{ result: SearchResult; text: string }> {
  const url = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
  try {
    const robotsRes = await getPublic(new URL("/robots.txt", url));
    if (robotsRes.ok && !robotsAllows(await robotsRes.text(), url.pathname)) {
      throw new ProviderError("robots", "This site's robots.txt asks automated tools not to read this page");
    }
  } catch (err) {
    if (err instanceof ProviderError && (err.code === "robots" || err.code === "blocked" || err.code === "not_found")) throw err;
  }
  const res = await getPublic(url);
  if (!res.ok) throw new ProviderError("http", `The site answered HTTP ${res.status}`);
  if (!/html/i.test(res.headers.get("content-type") ?? "")) throw new ProviderError("unsupported", "Not an HTML page");
  const buf = await res.arrayBuffer();
  const html = new TextDecoder().decode(buf.slice(0, MAX_BYTES));

  const title = decodeEntities(meta(html, "og:title") ?? html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? url.hostname).trim();
  const description = decodeEntities(meta(html, "og:description") ?? meta(html, "description") ?? "").trim();
  const canonical = html.match(/<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']+)["']/i)?.[1];
  const published = meta(html, "article:published_time");
  const paragraphs = [...html.replace(/<(script|style|nav|footer|header)[\s\S]*?<\/\1>/gi, "").matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((m) => decodeEntities(m[1]).replace(/\s+/g, " ").trim())
    .filter((p) => p.length > 60)
    .slice(0, 8);
  const finalUrl = canonical ? new URL(canonical, url).toString() : url.toString();
  const text = [description, ...paragraphs].filter(Boolean).join("\n\n").slice(0, 4000);

  return {
    result: {
      id: stableId("url", finalUrl),
      title,
      canonicalUrl: finalUrl,
      domain: domainOf(finalUrl),
      publisher: decodeEntities(meta(html, "og:site_name") ?? domainOf(finalUrl)),
      contentType: "web",
      snippet: description || paragraphs[0]?.slice(0, 280) || "No description provided by the page.",
      thumbnail: meta(html, "og:image"),
      publicationDate: published && !Number.isNaN(Date.parse(published)) ? new Date(published).toISOString() : undefined,
      retrievedAt: new Date().toISOString(),
      sourceProvider: "direct",
      freshnessStatus: "live",
      limitations: ["Leading paragraphs only — open the original for the full page.", `Fetched as ${USER_AGENT.split(" ")[0]}.`],
    },
    text,
  };
}
