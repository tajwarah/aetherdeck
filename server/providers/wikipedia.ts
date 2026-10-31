// Wikipedia via the MediaWiki Action API — keyless, one request returns search hits with intro text.
import { z } from "zod/v4";
import type { Provider } from "./types.ts";
import { fetchJson, stableId } from "../http.ts";

const Page = z.object({
  pageid: z.number(),
  title: z.string(),
  index: z.number().optional(),
  extract: z.string().optional(),
  fullurl: z.string().optional(),
  canonicalurl: z.string().optional(),
  touched: z.string().optional(),
  thumbnail: z.object({ source: z.string() }).optional(),
});
const Response = z.object({ query: z.object({ pages: z.array(Page) }).optional() });

export const wikipedia: Provider = {
  id: "wikipedia",
  label: "Wikipedia",
  supports: ["encyclopedia", "web", "image"],
  freshness: () => "stable",
  available: () => true,
  async search(q) {
    const params = new URLSearchParams({
      action: "query",
      format: "json",
      formatversion: "2",
      generator: "search",
      gsrsearch: q.topic || q.query,
      gsrlimit: String(Math.min(q.limit, 8)),
      prop: "extracts|info|pageimages",
      exintro: "1",
      explaintext: "1",
      exlimit: String(Math.min(q.limit, 8)),
      inprop: "url",
      piprop: "thumbnail",
      pithumbsize: "480",
      origin: "*",
    });
    const raw = await fetchJson(`https://en.wikipedia.org/w/api.php?${params}`);
    const pages = Response.parse(raw).query?.pages ?? [];
    pages.sort((a, b) => (a.index ?? 99) - (b.index ?? 99));
    const retrievedAt = new Date().toISOString();
    const texts: Record<string, string> = {};
    const results = pages
      .filter((p) => (p.extract ?? "").length > 40 && !/may refer to:?$/.test((p.extract ?? "").trim()))
      .map((p) => {
        const id = stableId("wikipedia", String(p.pageid));
        const extract = (p.extract ?? "").replace(/\s+/g, " ").trim();
        texts[id] = extract;
        return {
          id,
          title: p.title,
          canonicalUrl: p.canonicalurl ?? p.fullurl ?? `https://en.wikipedia.org/?curid=${p.pageid}`,
          domain: "en.wikipedia.org",
          publisher: "Wikipedia",
          contentType: "encyclopedia" as const,
          snippet: extract.slice(0, 280) + (extract.length > 280 ? "…" : ""),
          thumbnail: p.thumbnail?.source,
          retrievedAt,
          sourceProvider: "wikipedia" as const,
          freshnessStatus: "live" as const,
          limitations: [
            "Collaboratively edited encyclopedia — a summary of other sources, not original research.",
            ...(p.touched ? [`Page last changed ${p.touched.slice(0, 10)}.`] : []),
          ],
        };
      });
    return { results, texts };
  },
};
