// Stack Exchange — answered questions from Stack Overflow, for technical requests. Keyless (300 requests a day
// per address). Only questions with an accepted or upvoted answer are kept.
import { z } from "zod/v4";
import type { Provider } from "./types.ts";
import type { SearchResult } from "../../shared/types.ts";
import { fetchJson, stableId, decodeEntities } from "../http.ts";

const Response = z.object({
  items: z.array(z.object({
    question_id: z.number(), title: z.string(), link: z.string(), score: z.number(), is_answered: z.boolean(),
    answer_count: z.number(), tags: z.array(z.string()).optional(), last_activity_date: z.number().optional(), body: z.string().optional(),
  })).default([]),
});

/** Requests that read as programming questions. Exported for tests. */
export const looksTechnical = (q: string) =>
  /\b(code|coding|program\w*|python|javascript|typescript|java|rust|golang|c\+\+|c#|sql|api|bug|error|exception|compile\w*|function|regex|linux|bash|docker|kubernetes|react|node(js)?|css|html|git|npm|library|framework|algorithm|database|server)\b/i.test(q);

export const stackexchange: Provider = {
  id: "stackexchange",
  label: "Stack Overflow",
  supports: ["web"],
  freshness: () => "stable",
  available: () => true,
  async search(q) {
    const params = new URLSearchParams({ order: "desc", sort: "relevance", q: q.query, site: "stackoverflow", pagesize: String(Math.min(q.limit * 2, 20)), filter: "withbody" });
    const raw = await fetchJson(`https://api.stackexchange.com/2.3/search/advanced?${params}`);
    const retrievedAt = new Date().toISOString();
    const texts: Record<string, string> = {};
    const results: SearchResult[] = Response.parse(raw).items.filter((i) => i.is_answered && i.score > 0).slice(0, q.limit).map((i) => {
      const id = stableId("stackexchange", i.link);
      const body = decodeEntities((i.body ?? "").replace(/<pre>[\s\S]*?<\/pre>/g, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
      texts[id] = body;
      return {
        id, title: decodeEntities(i.title), canonicalUrl: i.link, domain: "stackoverflow.com", publisher: "Stack Overflow", contentType: "web",
        snippet: `${i.answer_count} answers · score ${i.score}${i.tags?.length ? ` · ${i.tags.slice(0, 4).join(", ")}` : ""}`,
        publicationDate: i.last_activity_date ? new Date(i.last_activity_date * 1000).toISOString() : undefined,
        retrievedAt, sourceProvider: "stackexchange", freshnessStatus: "live", limitations: ["The question only — open it for the answers."],
      };
    });
    return { results, texts };
  },
};
