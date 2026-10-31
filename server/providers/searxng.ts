// SearXNG — a free, open-source metasearch engine you run yourself (or an instance you trust). It asks many
// engines at once, so results come from across the web. Enabled when SEARXNG_URL is set and the instance
// allows the JSON format (search.formats: [html, json] in its settings.yml).
import { z } from "zod/v4";
import type { Provider } from "./types.ts";
import type { SearchResult } from "../../shared/types.ts";
import { fetchJson, ProviderError, stableId, domainOf } from "../http.ts";

const Response = z.object({
  results: z.array(z.object({ url: z.string(), title: z.string(), content: z.string().optional(), engine: z.string().optional(), publishedDate: z.string().nullable().optional() })),
});

export const searxng: Provider = {
  id: "searxng",
  label: "SearXNG",
  supports: ["web", "news"],
  freshness: (q) => (q.kind === "news" ? "volatile" : "stable"),
  available: () => /^https?:\/\//.test(process.env.SEARXNG_URL ?? ""),
  async search(q) {
    const base = process.env.SEARXNG_URL?.replace(/\/$/, "");
    if (!base) throw new ProviderError("not_configured", "SEARXNG_URL is not set");
    const params = new URLSearchParams({ q: q.query, format: "json", categories: q.kind === "news" ? "news" : "general" });
    if (q.time === "today") params.set("time_range", "day");
    const raw = await fetchJson(`${base}/search?${params}`, { headers: { Accept: "application/json" } });
    const retrievedAt = new Date().toISOString();
    const texts: Record<string, string> = {};
    const results: SearchResult[] = Response.parse(raw).results.slice(0, q.limit).map((r) => {
      const id = stableId("searxng", r.url);
      texts[id] = r.content ?? "";
      const date = r.publishedDate && !Number.isNaN(Date.parse(r.publishedDate)) ? new Date(r.publishedDate).toISOString() : undefined;
      return {
        id, title: r.title, canonicalUrl: r.url, domain: domainOf(r.url), publisher: r.engine ? `via ${r.engine}` : undefined,
        contentType: q.kind === "news" ? "news" : "web", snippet: r.content ?? "", publicationDate: date, retrievedAt,
        sourceProvider: "searxng", freshnessStatus: "live", limitations: ["Search snippet only — open the page for full context."],
      };
    });
    return { results, texts };
  },
};
