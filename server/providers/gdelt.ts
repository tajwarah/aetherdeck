// GDELT DOC 2.0 — keyless global news index. It asks for at most one request every 5 seconds,
// so calls are serialized through a gate and refused (not queued forever) when the gate is busy.
import { z } from "zod/v4";
import type { Provider } from "./types.ts";
import { fetchJson, ProviderError, stableId } from "../http.ts";

const Article = z.object({
  url: z.string(),
  title: z.string(),
  seendate: z.string().optional(),
  domain: z.string().optional(),
  sourcecountry: z.string().optional(),
  language: z.string().optional(),
  socialimage: z.string().optional(),
});
const Response = z.object({ articles: z.array(Article).optional() });

const MIN_INTERVAL_MS = 5_500;
let nextSlot = 0;

function gdeltDate(s?: string): string | undefined {
  const m = s?.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z` : undefined;
}

export const gdelt: Provider = {
  id: "gdelt",
  label: "GDELT news index",
  supports: ["news"],
  freshness: () => "volatile",
  available: () => true,
  async search(q) {
    const wait = nextSlot - Date.now();
    if (wait > 6_000) throw new ProviderError("rate_limited", "GDELT allows one request every 5 s; try again shortly");
    nextSlot = Math.max(Date.now(), nextSlot) + MIN_INTERVAL_MS;
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    const timespan = q.time === "today" ? "1d" : q.time === "recent" ? "7d" : "1m";
    const params = new URLSearchParams({
      query: `${q.topic || q.query} sourcelang:english`,
      mode: "artlist",
      format: "json",
      sort: "datedesc",
      maxrecords: String(Math.min(q.limit * 2, 30)),
      timespan,
    });
    const raw = await fetchJson(`https://api.gdeltproject.org/api/v2/doc/doc?${params}`, { timeoutMs: 12_000 });
    const articles = Response.parse(raw).articles ?? [];
    const retrievedAt = new Date().toISOString();
    const seen = new Set<string>();
    const results = articles
      .filter((a) => {
        const key = a.title.toLowerCase().replace(/\W+/g, " ").trim();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, q.limit)
      .map((a) => ({
        id: stableId("gdelt", a.url),
        title: a.title,
        canonicalUrl: a.url,
        domain: (a.domain ?? "").replace(/^www\./, ""),
        publisher: (a.domain ?? "").replace(/^www\./, ""),
        contentType: "news" as const,
        snippet: `Reported by ${a.domain ?? "unknown publisher"}${a.sourcecountry ? ` (${a.sourcecountry})` : ""}. Open the article to read it — GDELT supplies headlines, not text.`,
        thumbnail: a.socialimage || undefined,
        publicationDate: gdeltDate(a.seendate),
        retrievedAt,
        sourceProvider: "gdelt" as const,
        freshnessStatus: "live" as const,
        limitations: ["Date is when GDELT first saw the article, which can trail publication slightly."],
      }));
    return { results, texts: {} };
  },
};
