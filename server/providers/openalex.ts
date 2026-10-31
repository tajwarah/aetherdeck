// OpenAlex — an open index of scholarly works. Keyless; sorted by citations it surfaces the original,
// most-relied-upon research on a topic, with venues, authors, DOIs and (often) abstracts.
import { z } from "zod/v4";
import type { Provider } from "./types.ts";
import type { SearchResult } from "../../shared/types.ts";
import { fetchJson, stableId } from "../http.ts";

const Work = z.object({
  id: z.string(),
  doi: z.string().nullable().optional(),
  title: z.string().nullable(),
  publication_date: z.string().nullable().optional(),
  cited_by_count: z.number().optional(),
  type: z.string().nullable().optional(),
  authorships: z.array(z.object({ author: z.object({ display_name: z.string().nullable() }) })).optional(),
  primary_location: z
    .object({ landing_page_url: z.string().nullable().optional(), source: z.object({ display_name: z.string().nullable() }).nullable().optional() })
    .nullable()
    .optional(),
  abstract_inverted_index: z.record(z.string(), z.array(z.number())).nullable().optional(),
});
const Response = z.object({ results: z.array(Work) });

/** OpenAlex ships abstracts as word → positions; rebuild the text. */
export function rebuildAbstract(index: Record<string, number[]> | null | undefined): string {
  if (!index) return "";
  const words: string[] = [];
  for (const [word, positions] of Object.entries(index)) for (const p of positions) words[p] = word;
  return words.filter(Boolean).join(" ").replace(/\s+([.,;:)])/g, "$1");
}

export const openalex: Provider = {
  id: "openalex",
  label: "OpenAlex",
  supports: ["paper"],
  freshness: () => "stable",
  available: () => true,
  async search(q) {
    const topic = (q.topic || q.query).replace(/[^\p{L}\p{N}\s-]/gu, " ").trim();
    const params = new URLSearchParams({
      filter: `title.search:${topic},type:article|review|book|book-chapter|preprint`,
      sort: "cited_by_count:desc",
      "per-page": String(Math.min(q.limit, 10)),
      select: "id,doi,title,publication_date,cited_by_count,type,authorships,primary_location,abstract_inverted_index",
    });
    const contact = process.env.HORUS_CONTACT?.match(/[\w.+-]+@[\w-]+\.[\w.]+/)?.[0];
    if (contact) params.set("mailto", contact); // OpenAlex "polite pool"
    const raw = await fetchJson(`https://api.openalex.org/works?${params}`, { timeoutMs: 9000 });
    const retrievedAt = new Date().toISOString();
    const texts: Record<string, string> = {};
    const results: SearchResult[] = Response.parse(raw).results.flatMap((w) => {
      if (!w.title) return [];
      const url = w.doi ?? w.primary_location?.landing_page_url ?? w.id;
      const id = stableId("openalex", w.id);
      const abstract = rebuildAbstract(w.abstract_inverted_index);
      if (abstract) texts[id] = abstract;
      const venue = w.primary_location?.source?.display_name ?? undefined;
      const authors = (w.authorships ?? []).map((a) => a.author.display_name).filter(Boolean) as string[];
      return [{
        id,
        title: w.title.replace(/<[^>]+>/g, ""),
        canonicalUrl: url,
        domain: url.startsWith("https://doi.org") ? "doi.org" : new URL(url).hostname,
        publisher: venue ?? "OpenAlex record",
        contentType: "paper" as const,
        snippet: abstract ? abstract.slice(0, 320) + (abstract.length > 320 ? "…" : "") : `${venue ?? "Scholarly work"}${w.cited_by_count ? ` · cited ${w.cited_by_count.toLocaleString("en")} times` : ""}. No abstract available in the open index.`,
        authors: authors.slice(0, 6),
        publicationDate: w.publication_date ? `${w.publication_date}T00:00:00Z` : undefined,
        retrievedAt,
        sourceProvider: "openalex" as const,
        freshnessStatus: "live" as const,
        limitations: [
          ...(w.cited_by_count !== undefined ? [`Cited ${w.cited_by_count.toLocaleString("en")} times according to OpenAlex — influence, not proof of correctness.`] : []),
          abstract ? "Only the abstract was read." : "No abstract in the open index; metadata only.",
        ],
      }];
    });
    return { results, texts };
  },
};
