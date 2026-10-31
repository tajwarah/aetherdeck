// YouTube Data API v3 search (free key, 10,000 units/day; one search costs 100). Optional: without a key,
// Horus says so and offers YouTube's own search page instead. Nothing is scraped.
import { z } from "zod/v4";
import { TtlCache } from "../cache.ts";
import { fetchJson } from "../http.ts";

const Search = z.object({
  items: z.array(
    z.object({
      id: z.object({ videoId: z.string().optional() }),
      snippet: z.object({
        title: z.string(),
        channelTitle: z.string(),
        publishedAt: z.string(),
        thumbnails: z.object({ medium: z.object({ url: z.string() }).optional(), default: z.object({ url: z.string() }).optional() }),
      }),
    }),
  ),
});

export interface Video { id: string; title: string; channel: string; publishedAt: string; thumbnail?: string }
const videoCache = new TtlCache<Video[]>(200);

export const videoSearchConfigured = () => !!process.env.YOUTUBE_API_KEY;

export async function searchVideos(q: string): Promise<Video[]> {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) return [];
  const k = q.toLowerCase();
  const hit = videoCache.get(k);
  if (hit) return hit.value;
  const url = new URL("https://www.googleapis.com/youtube/v3/search");
  url.search = new URLSearchParams({ part: "snippet", type: "video", maxResults: "12", safeSearch: "moderate", videoEmbeddable: "true", q, key }).toString();
  const body = Search.parse(await fetchJson(url.toString(), { timeoutMs: 8000 }));
  const items = body.items.flatMap((it) =>
    it.id.videoId
      ? [{ id: it.id.videoId, title: it.snippet.title, channel: it.snippet.channelTitle, publishedAt: it.snippet.publishedAt, thumbnail: it.snippet.thumbnails.medium?.url ?? it.snippet.thumbnails.default?.url }]
      : [],
  );
  videoCache.set(k, items, "stable");
  return items;
}
