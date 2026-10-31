// Brave Search API — general web, news, images and video. Enabled when BRAVE_API_KEY is set.
import { z } from "zod/v4";
import type { Provider } from "./types.ts";
import type { ContentType, SearchResult } from "../../shared/types.ts";
import { fetchJson, ProviderError, stableId, domainOf, decodeEntities } from "../http.ts";

const Item = z.object({
  title: z.string(),
  url: z.string(),
  description: z.string().optional(),
  page_age: z.string().optional(),
  age: z.string().optional(),
  profile: z.object({ name: z.string().optional() }).optional(),
  meta_url: z.object({ hostname: z.string().optional() }).optional(),
  thumbnail: z.object({ src: z.string().optional() }).optional(),
  properties: z.object({ url: z.string().optional() }).optional(),
  extra_snippets: z.array(z.string()).optional(),
  source: z.string().optional(),
});
const Forum = Item.extend({ data: z.object({ forum_name: z.string().optional(), title: z.string().optional() }).optional() });
const Web = z.object({
  web: z.object({ results: z.array(Item) }).optional(),
  // Forum threads and fresh reporting come back alongside web pages when asked for.
  discussions: z.object({ results: z.array(Forum) }).optional(),
  news: z.object({ results: z.array(Item) }).optional(),
});
const List = z.object({ results: z.array(Item).optional() });

const ENDPOINT: Partial<Record<ContentType, string>> = {
  web: "web/search",
  encyclopedia: "web/search",
  paper: "web/search",
  place: "web/search",
  news: "news/search",
  image: "images/search",
  video: "videos/search",
};

export const brave: Provider = {
  id: "brave",
  label: "Brave Search",
  supports: ["web", "news", "image", "video", "place", "paper", "encyclopedia"],
  freshness: (q) => (q.kind === "news" ? "volatile" : q.kind === "place" ? "places" : "stable"),
  available: () => Boolean(process.env.BRAVE_API_KEY),
  async search(q) {
    const key = process.env.BRAVE_API_KEY;
    if (!key) throw new ProviderError("not_configured", "BRAVE_API_KEY is not set");
    const path = ENDPOINT[q.kind] ?? "web/search";
    const params = new URLSearchParams({ q: q.query, count: String(Math.min(q.limit, 20)) });
    if (q.kind === "news" || q.time === "today") params.set("freshness", q.time === "today" ? "pd" : "pw");
    if (q.kind === "web" || q.kind === "place") params.set("extra_snippets", "true");
    if (q.kind === "web") params.set("result_filter", "web,discussions,news");
    if (q.kind === "web" && q.time === "recent") params.set("freshness", "py");
    const headers: Record<string, string> = { Accept: "application/json", "X-Subscription-Token": key };
    if (q.location) {
      headers["X-Loc-Lat"] = String(q.location.lat);
      headers["X-Loc-Long"] = String(q.location.lon);
    }
    const raw = await fetchJson(`https://api.search.brave.com/res/v1/${path}?${params}`, { headers });
    type Found = z.infer<typeof Item> & { forum?: string; isNews?: boolean };
    let items: Found[];
    if (path === "web/search") {
      const w = Web.parse(raw);
      const forums: Found[] = (w.discussions?.results ?? []).slice(0, 3).map((d) => ({ ...d, forum: d.data?.forum_name ?? d.profile?.name }));
      const news: Found[] = (w.news?.results ?? []).slice(0, 3).map((n) => ({ ...n, isNews: true }));
      items = [...(w.web?.results ?? []).slice(0, q.limit), ...forums, ...news];
    } else items = (List.parse(raw).results ?? []).slice(0, q.limit);
    const retrievedAt = new Date().toISOString();
    const texts: Record<string, string> = {};
    const kindOf = (it: Found): ContentType => (it.isNews ? "news" : q.kind === "news" || q.kind === "image" || q.kind === "video" ? q.kind : "web");
    const results: SearchResult[] = items.map((it) => {
      const id = stableId("brave", it.url);
      const snippet = decodeEntities(it.description ?? "");
      texts[id] = [snippet, ...(it.extra_snippets ?? []).map(decodeEntities)].join(" ");
      return {
        id,
        title: decodeEntities(it.title),
        canonicalUrl: it.url,
        domain: it.meta_url?.hostname?.replace(/^www\./, "") ?? domainOf(it.url),
        publisher: it.forum ? `Forum · ${it.forum}` : it.profile?.name ?? it.source,
        contentType: kindOf(it),
        snippet,
        thumbnail: it.properties?.url ?? it.thumbnail?.src,
        publicationDate: it.page_age && !Number.isNaN(Date.parse(it.page_age)) ? new Date(it.page_age).toISOString() : undefined,
        retrievedAt,
        sourceProvider: "brave",
        freshnessStatus: "live",
        limitations: ["Search snippet only — open the page for full context."],
      };
    });
    return { results, texts };
  },
};
