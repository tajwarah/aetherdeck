// Results the person found with their own search engine, in a window they could see: the desktop app reads the
// links on that results page and sends them along with the question, and they join the map like any other
// source, in the engine's order. Nothing is fetched from the engine here.
import type { SearchResult } from "../../shared/types.ts";
import { ENGINES, type Engine, type Hit } from "../../shared/serp.ts";
import { stableId, domainOf } from "../http.ts";

/** "Mar 3, 2025 — …", "3 days ago": the date an engine prints before a snippet, when it does. */
export function dateOf(text: string, now = Date.now()): { date?: string; rest: string } {
  const rel = /^\s*(\d+)\s+(minute|hour|day|week|month|year)s?\s+ago\s*[—·-]?\s*/i.exec(text);
  if (rel) {
    const ms = { minute: 6e4, hour: 36e5, day: 864e5, week: 6048e5, month: 2592e6, year: 31536e6 }[rel[2].toLowerCase() as "day"];
    return { date: new Date(now - Number(rel[1]) * ms).toISOString(), rest: text.slice(rel[0].length) };
  }
  const abs = /^\s*([A-Z][a-z]{2,8}\.? \d{1,2}, \d{4}|\d{1,2} [A-Z][a-z]{2,8}\.? \d{4})\s*[—·-]\s*/.exec(text);
  if (abs && !Number.isNaN(Date.parse(abs[1].replace(".", "")))) return { date: new Date(abs[1].replace(".", "")).toISOString(), rest: text.slice(abs[0].length) };
  return { rest: text };
}

/** The hits off a results page, as sources for the map (with their snippets as readable text). */
export function fromHits(engine: Engine, hits: Hit[], news = false): { results: SearchResult[]; texts: Record<string, string> } {
  const retrievedAt = new Date().toISOString();
  const texts: Record<string, string> = {};
  const seen = new Set<string>();
  const results: SearchResult[] = [];
  for (const h of hits) {
    if (seen.has(h.url) || !/^https?:\/\//.test(h.url)) continue;
    seen.add(h.url);
    const { date, rest } = dateOf(h.age ? `${h.age} — ${h.snippet}` : h.snippet);
    const id = stableId("browser", h.url);
    texts[id] = rest;
    results.push({
      id, title: h.title.slice(0, 300), canonicalUrl: h.url, domain: domainOf(h.url), publisher: h.site?.slice(0, 120) || undefined,
      contentType: news ? "news" : "web", snippet: rest.slice(0, 600), publicationDate: date, retrievedAt,
      sourceProvider: "browser", freshnessStatus: "live", limitations: [`Found by ${ENGINES[engine].label}; search snippet only — open the page for full context.`],
    });
  }
  return { results, texts };
}
