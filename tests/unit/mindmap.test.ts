import { describe, expect, it } from "vitest";
import { kindOfSite, layoutMindMap } from "../../src/lib/layout.ts";
import { groupsOf } from "../../src/views/MindMapView.tsx";
import { dateOf } from "../../server/providers/browser.ts";
import type { EnvironmentModel, InformationNode, SearchResult } from "../../shared/types.ts";

const site = (id: string, over: Partial<SearchResult> = {}): SearchResult => ({
  id, title: `Title ${id}`, canonicalUrl: `https://${id}.example.com/`, domain: `${id}.example.com`, contentType: "web", snippet: "",
  retrievedAt: "2026-10-01T00:00:00Z", sourceProvider: "brave", freshnessStatus: "live", limitations: [], ...over,
});
const node = (n: Partial<InformationNode> & { id: string }): InformationNode => ({ title: n.id, nodeType: "source", parentId: "root", relatedNodeIds: [], sourceIds: [], visualizationHints: { weight: 1 }, ...n });
const modelOf = (sources: SearchResult[], extra: InformationNode[] = []): EnvironmentModel => ({
  nodes: [node({ id: "root", nodeType: "intent", parentId: null }), ...extra, ...sources.map((s) => node({ id: `src:${s.id}`, sourceIds: [s.id] }))],
  sources, visualization: "clusters", intent: { query: "q" }, evidence: [],
} as unknown as EnvironmentModel);

describe("mind map", () => {
  it("sorts sites into kinds", () => {
    expect(kindOfSite(site("a", { contentType: "paper" }))).toBe("Research");
    expect(kindOfSite(site("b", { domain: "www.reddit.com" }))).toBe("Discussions");
    expect(kindOfSite(site("c", { domain: "youtube.com" }))).toBe("Video");
    expect(kindOfSite(site("d"))).toBe("Websites");
  });

  it("puts every site on a branch, balances the sides and never stacks two leaves", () => {
    const sources = Array.from({ length: 15 }, (_, i) => site(`s${i}`, { contentType: i < 3 ? "news" : "web" }));
    const l = layoutMindMap(modelOf(sources));
    const leaves = l.branches!.flatMap((b) => b.leaves);
    expect(new Set(leaves).size).toBe(15);
    expect(l.branches!.every((b) => b.leaves.length <= 6)).toBe(true);
    expect(new Set(l.branches!.map((b) => b.side)).size).toBe(2);
    for (const b of l.branches!) {
      const ys = b.leaves.map((id) => l.pos[id].y).sort((p, q) => p - q);
      ys.slice(1).forEach((y, i) => expect(y - ys[i]).toBeGreaterThanOrEqual(100));
      for (const id of b.leaves) expect(Math.sign(l.pos[id].x)).toBe(b.side);
    }
  });

  it("hangs a site on the sub-question whose findings cite it", () => {
    const sources = [site("a"), site("b")];
    const extra = [
      node({ id: "sub:0", nodeType: "subtopic", title: "Why?" }),
      node({ id: "ev:1", nodeType: "finding", parentId: "sub:0", relatedNodeIds: ["src:b"], sourceIds: ["b"] }),
    ];
    const m = modelOf(sources, extra);
    m.nodes.find((n) => n.id === "src:b")!.relatedNodeIds = ["ev:1"];
    const l = layoutMindMap(m);
    expect(l.branches!.find((b) => b.id === "sub:0")!.leaves).toEqual(["ev:1", "src:b"]);
    expect(l.branches!.some((b) => b.leaves.includes("src:a") && b.label === "Websites")).toBe(true);
  });

  it("joins connected sites into groups", () => {
    expect(groupsOf([["a", "b"], ["c", "d"], ["b", "e"]]).map((g) => g.sort())).toEqual([["a", "b", "e"], ["c", "d"]]);
    expect(groupsOf([])).toEqual([]);
  });
});

describe("search engine dates", () => {
  it("reads the date an engine prints before a snippet", () => {
    const now = Date.parse("2026-10-29T12:00:00Z");
    expect(dateOf("3 days ago — Heat pumps work", now)).toEqual({ date: "2026-10-26T12:00:00.000Z", rest: "Heat pumps work" });
    expect(dateOf("Mar 3, 2025 — A review", now).rest).toBe("A review");
    expect(dateOf("Mar 3, 2025 — A review", now).date?.slice(0, 7)).toBe("2025-03");
    expect(dateOf("No date here", now)).toEqual({ rest: "No date here" });
  });
});
