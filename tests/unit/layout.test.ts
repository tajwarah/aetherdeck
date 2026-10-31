import { describe, expect, it } from "vitest";
import { fitCamera, layoutFor, projectKm } from "../../src/lib/layout.ts";
import { buildNodes, chooseVisualization } from "../../server/environment.ts";
import { planCalls } from "../../server/orchestrator.ts";
import { planIntent } from "../../server/intent.ts";
import type { EnvironmentModel, Evidence, SearchResult } from "../../shared/types.ts";

const src = (i: number, extra: Partial<SearchResult> = {}): SearchResult => ({
  id: `s${i}`, title: `Source ${i}`, canonicalUrl: `https://ex.org/${i}`, domain: "ex.org", contentType: "encyclopedia",
  snippet: "", retrievedAt: "2026-01-01T00:00:00Z", sourceProvider: "wikipedia", freshnessStatus: "live", ...extra,
});

function model(query: string, sources: SearchResult[], evidence: Evidence[] = [], loc?: { lat: number; lon: number }): EnvironmentModel {
  const intent = planIntent(query, loc && { ...loc, source: "user_supplied" });
  const visualization = chooseVisualization(intent, sources);
  return {
    id: "m", intent, visualization, dataMode: "live", synthesisMode: "extractive",
    nodes: buildNodes(intent, visualization, sources, evidence), sources, evidence, actions: [], notices: [],
    task: { id: "t", status: "done", objective: "", steps: [], toolCalls: [], requiresConfirmation: false }, complete: true,
  };
}

describe("adaptive visualization", () => {
  it("chooses a different structure for each kind of task", () => {
    expect(model("Explain quantum computing", [src(1)]).visualization).toBe("evidence");
    expect(model("What's happening in Bangladesh today?", [src(1, { publicationDate: "2026-10-01T00:00:00Z" }), src(2, { publicationDate: "2026-10-02T00:00:00Z" })]).visualization).toBe("timeline");
    expect(model("kacchi biryani restaurants near me compare", [src(1, { place: { lat: 23.75, lon: 90.38 } })], [], { lat: 23.75, lon: 90.37 }).visualization).toBe("comparison");
    // A timeline needs dates; without them the system falls back rather than faking an order.
    expect(model("latest news on volcanoes", [src(1)]).visualization).toBe("clusters");
  });

  it("lays out every node and keeps evidence cards from colliding", () => {
    const ev: Evidence[] = ["what", "how", "shown", "limits"].flatMap((q) => [0, 1, 2].map((j) => ({
      id: `${q}${j}`, claim: "c", sourceIds: [`s${j}`], evidenceType: "direct_excerpt" as const, confidenceOrLimitations: "", subtopic: q,
    })));
    const m = model("Explain quantum computing", [src(0), src(1), src(2)], ev);
    const l = layoutFor(m);
    for (const n of m.nodes) expect(l.pos[n.id], n.id).toBeDefined();
    const cards = m.nodes.filter((n) => n.nodeType === "finding").map((n) => l.pos[n.id]);
    for (let i = 0; i < cards.length; i++) for (let j = i + 1; j < cards.length; j++) {
      const overlapX = Math.abs(cards[i].x - cards[j].x) < 270 * 1.3;
      const overlapY = Math.abs(cards[i].y - cards[j].y) < 110 * 1.3;
      expect(overlapX && overlapY, `cards ${i} and ${j}`).toBe(false);
    }
  });

  it("projects distances and fits the camera", () => {
    const p = projectKm({ lat: 0, lon: 0 }, { lat: 0, lon: 1 });
    expect(p.x).toBeCloseTo(111.3, 0);
    const cam = fitCamera({ minX: -500, minY: -250, maxX: 500, maxY: 250 }, 1000, 500);
    expect(cam.s).toBeLessThan(1);
    expect(cam.x).toBeCloseTo(500, 0);
  });

  it("plans parallel provider calls per intent, and only sample data in demo mode", () => {
    const research = planCalls(planIntent("Explain quantum computing"), undefined, false).map((c) => c.provider.id);
    expect(research).toEqual(["brave", "tavily", "searxng", "openalex", "arxiv", "hackernews", "wikipedia"]);
    const local = planCalls(planIntent("ac repair near me"), { lat: 1, lon: 1 }, false).map((c) => c.provider.id);
    expect(local).toEqual(["photon", "osm", "brave"]);
    expect(new Set(planCalls(planIntent("Explain quantum computing"), undefined, true).map((c) => c.provider.id))).toEqual(new Set(["demo"]));
  });
});
