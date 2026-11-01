// Search engines' own results pages, as a person sees them in a window. Warpnaut can lay the results of a page
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

// Run inside the results page the person is looking at. Each returns { hits, blocked } and changes nothing.
export const SERP_READ: Record<Engine, string> = {
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

