// Tavily — a web search API built for AI research: whole-web results with readable extracts and dates.
// Enabled when TAVILY_API_KEY is set (free tier: 1,000 searches a month).
import { z } from "zod/v4";
import type { Provider } from "./types.ts";
import type { SearchResult } from "../../shared/types.ts";
import { fetchJson, ProviderError, stableId, domainOf } from "../http.ts";

const Response = z.object({
  results: z.array(z.object({ title: z.string(), url: z.string(), content: z.string().optional(), published_date: z.string().nullable().optional() })),
});

export const tavily: Provider = {
  id: "tavily",
  label: "Tavily",
  supports: ["web", "news"],
  freshness: (q) => (q.kind === "news" ? "volatile" : "stable"),
  available: () => Boolean(process.env.TAVILY_API_KEY),
  async search(q) {
    const key = process.env.TAVILY_API_KEY;
    if (!key) throw new ProviderError("not_configured", "TAVILY_API_KEY is not set");
    const body = {
      query: q.query,
      max_results: Math.min(q.limit, 20),
      search_depth: "basic",
      topic: q.kind === "news" ? "news" : "general",
      ...(q.time === "today" ? { time_range: "day" } : q.time === "recent" ? { time_range: "month" } : {}),
    };
    const raw = await fetchJson("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
    });
    const retrievedAt = new Date().toISOString();
    const texts: Record<string, string> = {};
    const results: SearchResult[] = Response.parse(raw).results.map((r) => {
      const id = stableId("tavily", r.url);
      texts[id] = r.content ?? "";
      const date = r.published_date && !Number.isNaN(Date.parse(r.published_date)) ? new Date(r.published_date).toISOString() : undefined;
      return {
        id, title: r.title, canonicalUrl: r.url, domain: domainOf(r.url), contentType: q.kind === "news" ? "news" : "web",
        snippet: (r.content ?? "").slice(0, 300), publicationDate: date, retrievedAt, sourceProvider: "tavily", freshnessStatus: "live",
        limitations: ["Search extract — open the page for full context."],
      };
    });
    return { results, texts };
  },
};
