import { describe, expect, it } from "vitest";
import { rankOpenWeb } from "../../server/rank.ts";
import { looksTechnical } from "../../server/providers/stackexchange.ts";
import type { SearchResult } from "../../shared/types.ts";

const r = (id: string, domain: string, title: string, provider: SearchResult["sourceProvider"], extra: Partial<SearchResult> = {}): SearchResult => ({
  id, title, canonicalUrl: `https://${domain}/${id}`, domain, contentType: "web", snippet: "", retrievedAt: "2026-10-01T00:00:00Z",
  sourceProvider: provider, freshnessStatus: "live", ...extra,
});

describe("rankOpenWeb", () => {
  it("does not let one site fill the top of the list", () => {
    const wiki = [1, 2, 3, 4].map((i) => r(`w${i}`, "en.wikipedia.org", `Emperor penguin ${i}`, "wikipedia"));
    const web = [r("a", "antarctica.gov.au", "Emperor penguins of Antarctica", "brave"), r("b", "audubon.org", "Emperor penguin field guide", "brave"), r("c", "blog.example.net", "Watching emperor penguins", "hackernews")];
    const top4 = rankOpenWeb([...wiki, ...web], "emperor penguin", "any").slice(0, 4);
    expect(top4.filter((s) => s.domain === "en.wikipedia.org").length).toBeLessThanOrEqual(1);
    expect(new Set(top4.map((s) => s.domain)).size).toBe(4);
  });

  it("keeps everything relevant and drops literal matches that share no word with the request", () => {
    const out = rankOpenWeb([r("a", "a.com", "Emperor penguin", "brave"), r("b", "news.ycombinator.com", "Show HN: my database", "hackernews")], "emperor penguin", "any");
    expect(out.map((s) => s.id)).toEqual(["a"]);
  });

  it("gives recent pages a little credit", () => {
    const now = Date.parse("2026-10-29T00:00:00Z");
    const out = rankOpenWeb([r("old", "a.com", "Mars rover", "brave", { publicationDate: "2019-01-01T00:00:00Z" }), r("new", "b.com", "Mars rover", "brave", { publicationDate: "2026-10-20T00:00:00Z" })], "mars rover", "recent", now);
    expect(out[0].id).toBe("new");
  });
});

describe("looksTechnical", () => {
  it("spots programming questions", () => {
    expect(looksTechnical("rust borrow checker error")).toBe(true);
    expect(looksTechnical("best restaurants with a view")).toBe(false);
  });
});
