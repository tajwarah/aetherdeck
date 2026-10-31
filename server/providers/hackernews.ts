// Hacker News, through Algolia's free search API. Keyless. Stories link to original writing — personal sites,
// independent publications, project pages — and each comes with the forum discussion around it.
import { z } from "zod/v4";
import type { Provider } from "./types.ts";
import type { SearchResult } from "../../shared/types.ts";
import { fetchJson, stableId, domainOf, decodeEntities } from "../http.ts";

const Response = z.object({
  hits: z.array(z.object({
    objectID: z.string(),
    title: z.string().nullable().optional(),
    url: z.string().nullable().optional(),
    story_text: z.string().nullable().optional(),
    created_at: z.string().optional(),
    points: z.number().nullable().optional(),
    num_comments: z.number().nullable().optional(),
  })),
});

const STOP = new Set("a an the and or of in on at to for from with by about how what why when where who which is are was were be do does did can could should would will my me i you your it its this that these those there their them they we our us vs versus".split(" "));

const plain = (html: string) => decodeEntities(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

export const hackernews: Provider = {
  id: "hackernews",
  label: "Hacker News",
  supports: ["web", "news"],
  freshness: () => "volatile",
  available: () => true,
  async search(q) {
    // Keywords only, each optional: the best stories match most of them, and a long question still finds some.
    const words = (q.topic || q.query).toLowerCase().split(/[^\p{L}\p{N}+#.]+/u).filter((w) => w.length > 1 && !STOP.has(w));
    const params = new URLSearchParams({ query: words.join(" "), optionalWords: words.join(" "), tags: "story", hitsPerPage: String(Math.min(q.limit * 3, 30)) });
    if (q.time === "today" || q.time === "recent") params.set("numericFilters", `created_at_i>${Math.floor(Date.now() / 1000) - (q.time === "today" ? 2 : 45) * 86400}`);
    const raw = await fetchJson(`https://hn.algolia.com/api/v1/search?${params}`);
    const retrievedAt = new Date().toISOString();
    const texts: Record<string, string> = {};
    // Only stories people engaged with: a few points and some discussion.
    const hits = Response.parse(raw).hits.filter((h) => h.title && (h.points ?? 0) >= 5).slice(0, q.limit);
    const results: SearchResult[] = hits.map((h) => {
      const discussion = `https://news.ycombinator.com/item?id=${h.objectID}`;
      const url = h.url || discussion;
      const id = stableId("hackernews", url);
      const text = plain(h.story_text ?? "");
      texts[id] = [h.title, text].filter(Boolean).join(". ");
      return {
        id, title: decodeEntities(h.title!), canonicalUrl: url, domain: domainOf(url), publisher: "Discussed on Hacker News",
        contentType: "web", snippet: text.slice(0, 280) || `${h.points ?? 0} points · ${h.num_comments ?? 0} comments — discussion: ${discussion}`,
        publicationDate: h.created_at, retrievedAt, sourceProvider: "hackernews", freshnessStatus: "live",
        limitations: ["Found through a forum post; the linked page is the original source."],
      };
    });
    return { results, texts };
  },
};
