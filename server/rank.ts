// Ordering results so the map shows the open web, not one site: relevance first, a little credit for being
// recent, then a diversity pass that lets no single site or source crowd out the others.
import type { ProviderId, SearchResult } from "../shared/types.ts";
import { stem } from "./evidence.ts";

/** How much a source's own ranking is trusted. Whole-web engines rank pages; keyword APIs only match words. */
const PRIOR: Record<ProviderId, number> = {
  browser: 0.6, brave: 0.5, tavily: 0.5, searxng: 0.4, openalex: 0.15, arxiv: 0.1, stackexchange: 0.2, hackernews: 0.1,
  wikipedia: 0, gdelt: 0.1, currents: 0.1, osm: 0, photon: 0, direct: 0, demo: -1,
};
/** Sources that match words rather than meaning: a result that shares no word with the request is dropped. */
const LITERAL = new Set<ProviderId>(["hackernews", "stackexchange", "gdelt", "arxiv", "openalex"]);

export const termsOf = (topic: string) => [...new Set(topic.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((t) => t.length > 2).map(stem))];

export function relevance(terms: string[], s: SearchResult): number {
  if (!terms.length) return 0.5;
  const title = s.title.toLowerCase();
  const body = `${s.snippet} ${s.publisher ?? ""}`.toLowerCase();
  const inTitle = terms.filter((t) => title.includes(t)).length / terms.length;
  const inBody = terms.filter((t) => body.includes(t)).length / terms.length;
  return inTitle * 2 + inBody * 0.8;
}

export function recency(s: SearchResult, time: "today" | "recent" | "any", now = Date.now()): number {
  const t = s.publicationDate ? Date.parse(s.publicationDate) : NaN;
  if (Number.isNaN(t)) return 0;
  const days = (now - t) / 86_400_000;
  const base = days < 30 ? 0.3 : days < 365 ? 0.15 : 0;
  return time === "any" ? base : base * 2;
}

/**
 * Greedy pick: each step takes the best remaining result after a penalty for every result already taken from
 * the same site and from the same source. Nothing is removed except literal matches that share no word with
 * the request. Exported for tests.
 */
export function rankOpenWeb(sources: SearchResult[], topic: string, time: "today" | "recent" | "any", now = Date.now()): SearchResult[] {
  const terms = termsOf(topic);
  const pool = sources
    .map((s) => ({ s, rel: relevance(terms, s) }))
    .filter(({ s, rel }) => !(LITERAL.has(s.sourceProvider) && terms.length && rel === 0))
    .map(({ s, rel }) => ({ s, score: rel + PRIOR[s.sourceProvider] + recency(s, time, now) }));
  const site = (s: SearchResult) => s.domain.replace(/^(www|en|m)\./, "");
  const perSite = new Map<string, number>();
  const perSource = new Map<string, number>();
  const out: SearchResult[] = [];
  while (pool.length) {
    let best = 0;
    let bestScore = -Infinity;
    pool.forEach(({ s, score }, i) => {
      const adjusted = score - 0.9 * (perSite.get(site(s)) ?? 0) - 0.3 * (perSource.get(s.sourceProvider) ?? 0);
      if (adjusted > bestScore) { bestScore = adjusted; best = i; }
    });
    const [{ s }] = pool.splice(best, 1);
    out.push(s);
    perSite.set(site(s), (perSite.get(site(s)) ?? 0) + 1);
    perSource.set(s.sourceProvider, (perSource.get(s.sourceProvider) ?? 0) + 1);
  }
  return out;
}
