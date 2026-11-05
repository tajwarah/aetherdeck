// Search engines' own results pages, as a person sees them in a window. AetherDeck can lay the results of a page
// the person opened out as a map: it reads the links on that visible page (as a reader view would) and never
// fetches, clicks, accepts or solves anything on it. A consent screen or a "are you a person" check is left
// for the person to answer in the window.
export type Engine = "google" | "bing" | "duckduckgo";
export const ENGINES: Record<Engine, { label: string; home: string }> = {
  google: { label: "Google", home: "https://www.google.com/" },
  bing: { label: "Bing", home: "https://www.bing.com/" },
  duckduckgo: { label: "DuckDuckGo", home: "https://duckduckgo.com/" },
};

/** One result as read off the page. */
export interface Hit { url: string; title: string; snippet: string; site?: string; age?: string }
/** What a results page shows: its results, or that the engine wants something from the person first. */
export interface PageRead { hits: Hit[]; blocked?: "consent" | "verify" }

/** The engine's ordinary results page for a query. */
export function serpUrl(engine: Engine, query: string, lang = "en", news = false, page = 0) {
  const q = encodeURIComponent(query);
  if (engine === "google") return `https://www.google.com/search?q=${q}&hl=${lang}${news ? "&tbm=nws" : ""}${page ? `&start=${page * 10}` : ""}`;
  if (engine === "bing") return `https://www.bing.com/${news ? "news/" : ""}search?q=${q}${page ? `&first=${page * 10 + 1}` : ""}`;
  return `https://html.duckduckgo.com/html/?q=${q}`;
}

/**
 * When an engine changes its layout, the reader written for it finds nothing. This one reads any results page:
 * every link with a heading in it (or a long title) that leads off the engine's own site, through its redirect
 * when there is one, minus ads. Run inside the page; changes nothing.
 */
const ANY_RESULTS = `(() => {
  const own = location.hostname.replace(/^www\\./, "").split(".").slice(-2).join(".");
  const out = (href) => { try {
    const u = new URL(href, location.href);
    if (u.pathname === "/url") return u.searchParams.get("q") || u.searchParams.get("url") || "";
    if (u.pathname.startsWith("/ck/")) { const v = (u.searchParams.get("u") || "").replace(/^a1/, ""); return atob(v.replace(/-/g, "+").replace(/_/g, "/")); }
    if (u.pathname === "/l/") return u.searchParams.get("uddg") || "";
    return u.hostname.endsWith(own) || !/^https?:$/.test(u.protocol) ? "" : u.href;
  } catch { return ""; } };
  const hits = [], seen = new Set();
  const main = document.querySelector("main, #b_results, #rso, #search, #links, [role=main]") || document.body;
  for (const a of main.querySelectorAll("a[href]")) {
    if (a.closest("[data-text-ad], .b_ad, #tads, #bottomads, .result--ad, [aria-label*='Sponsored'], [aria-label*='Ads']")) continue;
    const head = a.querySelector("h2, h3, [role=heading]") || (a.closest("h2, h3") ? a : null);
    const title = (head ? head.innerText : "").trim();
    if (title.length < 12) continue;
    const url = out(a.href);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const box = a.closest("li, article, .g, .MjjYud, .b_algo, .result, div[data-hveid]") || a.parentElement;
    const snippet = box ? box.innerText.split("\\n").map((l) => l.trim()).filter((l) => l.length > 40 && l !== title && !/^https?:|›/.test(l)).slice(0, 2).join(" ") : "";
    hits.push({ url, title: title.slice(0, 300), snippet: snippet.slice(0, 400), site: "" });
  }
  return hits;
})()`;

/** An engine's own reader first, the general one when it finds fewer than three results. */
const withFallback = (read: string) => `(() => { const r = ${read}; if (r.hits.length >= 3 || r.blocked) return r; const more = ${ANY_RESULTS}; return more.length > r.hits.length ? { hits: more, blocked: undefined } : r; })()`;

// Run inside the results page the person is looking at. Each returns { hits, blocked } and changes nothing.
const OWN_READ: Record<Engine, string> = {
  google: `(() => {
    const blocked = location.hostname.startsWith("consent.") ? "consent"
      : location.pathname.startsWith("/sorry") || document.querySelector("#captcha-form, iframe[src*='recaptcha']") ? "verify" : undefined;
    const hits = [], seen = new Set();
    const clean = (href) => { try { const u = new URL(href); if (/(^|\\.)google\\./.test(u.hostname) && u.pathname === "/url") return u.searchParams.get("q") || u.searchParams.get("url") || ""; return /(^|\\.)google\\.[a-z.]+$/.test(u.hostname) ? "" : href; } catch { return ""; } };
    const root = document.querySelector("#rso") || document.querySelector("#search") || document.body;
    for (const head of root.querySelectorAll("a h3, a [role=heading]")) {
      const a = head.closest("a"); const url = clean(a.href);
      if (!url || seen.has(url) || a.closest("#tads, #bottomads, [data-text-ad]")) continue;
      seen.add(url);
      const box = a.closest(".MjjYud, .g, .SoaBEf, [data-news-cluster-id]") || a.parentElement?.parentElement?.parentElement || a;
      const title = head.innerText.trim();
      let snippet = (box.querySelector(".VwiC3b, [data-sncf], .GI74Re, .Y3v8qd") || {}).innerText || "";
      if (!snippet) snippet = box.innerText.split("\\n").filter((l) => l.trim() && l.trim() !== title && !/^https?:|›/.test(l)).slice(-2).join(" ");
      const site = ((box.querySelector(".VuuXrf, .MgUUmf, .NUnG9d") || {}).innerText || "").split("\\n")[0];
      const age = ((box.querySelector(".OSrXXb, .LfVVr, .YsWzw") || {}).innerText || "").trim();
      hits.push({ url, title, snippet: snippet.trim().slice(0, 400), site, age });
    }
    return { hits, blocked: hits.length ? undefined : blocked };
  })()`,
  bing: `(() => {
    const blocked = document.querySelector("#b_captcha, .captcha, #challenge-form") ? "verify" : undefined;
    const clean = (href) => { try { const u = new URL(href); if (u.hostname.endsWith("bing.com") && u.pathname.startsWith("/ck/")) { const v = (u.searchParams.get("u") || "").replace(/^a1/, ""); return atob(v.replace(/-/g, "+").replace(/_/g, "/")); } return u.hostname.endsWith("bing.com") ? "" : href; } catch { return ""; } };
    const hits = [], seen = new Set();
    for (const li of document.querySelectorAll("#b_results > li.b_algo, .news-card, .newsitem")) {
      const a = li.querySelector("h2 a, a.title"); if (!a) continue;
      const url = clean(a.href); if (!url || seen.has(url)) continue; seen.add(url);
      const snippet = (li.querySelector(".b_caption p, .b_lineclamp2, .b_lineclamp3, .snippet") || {}).innerText || "";
      const site = (li.querySelector(".tptt, .source") || {}).innerText || "";
      hits.push({ url, title: a.innerText.trim(), snippet: snippet.trim().slice(0, 400), site });
    }
    return { hits, blocked: hits.length ? undefined : blocked };
  })()`,
  duckduckgo: `(() => {
    const blocked = document.querySelector(".anomaly-modal, form#challenge-form") ? "verify" : undefined;
    const hits = [], seen = new Set();
    for (const r of document.querySelectorAll(".result:not(.result--ad)")) {
      const a = r.querySelector("a.result__a"); if (!a) continue;
      let url = a.href; try { const u = new URL(url); if (u.pathname === "/l/") url = u.searchParams.get("uddg") || ""; } catch { url = ""; }
      if (!url || seen.has(url)) continue; seen.add(url);
      hits.push({ url, title: a.innerText.trim(), snippet: ((r.querySelector(".result__snippet") || {}).innerText || "").trim().slice(0, 400), site: "" });
    }
    return { hits, blocked: hits.length ? undefined : blocked };
  })()`,
};

export const SERP_READ: Record<Engine, string> = {
  google: withFallback(OWN_READ.google),
  bing: withFallback(OWN_READ.bing),
  duckduckgo: withFallback(OWN_READ.duckduckgo),
};
