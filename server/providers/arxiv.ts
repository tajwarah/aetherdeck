// arXiv API — keyless access to preprint metadata and abstracts. Atom XML parsed without a dependency.
import type { Provider } from "./types.ts";
import { fetchWithTimeout, ProviderError, stableId, decodeEntities } from "../http.ts";

function tag(xml: string, name: string): string | undefined {
  const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`));
  return m ? decodeEntities(m[1]).replace(/\s+/g, " ").trim() : undefined;
}

export function parseArxivFeed(xml: string, retrievedAt: string) {
  const entries = xml.split("<entry>").slice(1).map((e) => e.split("</entry>")[0]);
  const texts: Record<string, string> = {};
  const results = entries.flatMap((e) => {
    const absUrl = tag(e, "id");
    const title = tag(e, "title");
    const summary = tag(e, "summary");
    if (!absUrl || !title || !summary) return [];
    const authors = [...e.matchAll(/<name>([\s\S]*?)<\/name>/g)].map((m) => decodeEntities(m[1]).trim());
    const id = stableId("arxiv", absUrl);
    texts[id] = summary;
    const published = tag(e, "published");
    return [{
      id,
      title,
      canonicalUrl: absUrl.replace(/^http:/, "https:").replace(/v\d+$/, ""),
      domain: "arxiv.org",
      publisher: "arXiv",
      contentType: "paper" as const,
      snippet: summary.slice(0, 320) + (summary.length > 320 ? "…" : ""),
      authors: authors.slice(0, 6),
      publicationDate: published,
      retrievedAt,
      sourceProvider: "arxiv" as const,
      freshnessStatus: "live" as const,
      limitations: ["Preprint — may not be peer reviewed. Only the abstract was read."],
    }];
  });
  return { results, texts };
}

export const arxiv: Provider = {
  id: "arxiv",
  label: "arXiv",
  supports: ["paper"],
  freshness: () => "stable",
  available: () => true,
  async search(q) {
    const terms = (q.topic || q.query).split(/\s+/).map((t) => t.replace(/[^\p{L}\p{N}-]/gu, "")).filter((t) => t.length > 1).slice(0, 6);
    // The exact phrase in the title keeps arXiv's relevance ranking on-topic.
    const searchQuery = terms.length > 1 ? `ti:"${terms.join(" ")}"` : `all:${terms[0] ?? ""}`;
    const url = `https://export.arxiv.org/api/query?search_query=${encodeURIComponent(searchQuery)}&sortBy=relevance&max_results=${Math.min(q.limit, 8)}`;
    const res = await fetchWithTimeout(url, { timeoutMs: 10_000 });
    if (!res.ok) throw new ProviderError(res.status === 429 ? "rate_limited" : "http", `HTTP ${res.status}`);
    return parseArxivFeed(await res.text(), new Date().toISOString());
  },
};
