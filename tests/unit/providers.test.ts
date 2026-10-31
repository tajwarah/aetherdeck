import { describe, expect, it } from "vitest";
import { parseArxivFeed } from "../../server/providers/arxiv.ts";
import { rebuildAbstract } from "../../server/providers/openalex.ts";
import { parseDay, parseYearPage } from "../../server/providers/currents.ts";
import { buildOverpassQuery, haversineKm, normalizeElements } from "../../server/providers/osm.ts";
import { photonQueries } from "../../server/providers/photon.ts";
import { isPrivateAddress, robotsAllows } from "../../server/preview.ts";
import { TtlCache } from "../../server/cache.ts";
import { Budget } from "../../server/budget.ts";

describe("provider normalization", () => {
  it("parses arXiv Atom entries", () => {
    const xml = `<feed><entry><id>http://arxiv.org/abs/1801.00862v3</id><published>2018-01-02T00:00:00Z</published><title>Quantum Computing in the NISQ era</title><summary>Noisy devices.</summary><author><name>John Preskill</name></author></entry></feed>`;
    const { results, texts } = parseArxivFeed(xml, "2026-01-01T00:00:00Z");
    expect(results[0]).toMatchObject({ canonicalUrl: "https://arxiv.org/abs/1801.00862", authors: ["John Preskill"], contentType: "paper" });
    expect(texts[results[0].id]).toBe("Noisy devices.");
  });

  it("rebuilds OpenAlex abstracts", () => {
    expect(rebuildAbstract({ Qubits: [0], are: [1], fragile: [2], ".": [3] })).toBe("Qubits are fragile.");
  });

  it("keeps only current-events items that cite an external report and match the topic", () => {
    const html = `<ul><li>Floods hit <a href="/wiki/Bangladesh" title="Bangladesh">Bangladesh</a>, displacing thousands. <a class="external text" href="https://www.reuters.com/x">(Reuters)</a></li><li>Unrelated news. <a class="external text" href="https://bbc.co.uk/y">(BBC)</a></li><li>Bangladesh item with no source.</li></ul>`;
    const rows = parseDay(html, "2026-10-27", ["bangladesh"], "now");
    expect(rows).toHaveLength(1);
    expect(rows[0].result).toMatchObject({ domain: "reuters.com", publicationDate: "2026-10-27T12:00:00Z" });
  });

  it("reads dated, cited events from a year chronology", () => {
    const html = `<h2 id="Events">Events</h2><h3 id="October">October</h3><ul><li>20 October – A bus collision kills 14.<sup class="reference"><a href="#cite&#95;note-41">[41]</a></sup></li><li>21 October – Uncited claim.</li></ul><h2 id="Deaths">Deaths</h2><ol class="references"><li id="cite&#95;note-41"><a class="external text" href="https://news.example/bus">Bus crash</a> <i>Example News</i></li></ol>`;
    const rows = parseYearPage(html, 2026, "now", Date.UTC(2026, 9, 1));
    expect(rows).toHaveLength(1);
    expect(rows[0].result).toMatchObject({ canonicalUrl: "https://news.example/bus", publisher: "Example News" });
  });

  it("never invents place details and flags cuisine-only matches", () => {
    const q = { query: "q", topic: "kacchi biryani", kind: "place" as const, limit: 10, placeKind: "food" as const, location: { lat: 23.75, lon: 90.38 } };
    const { results } = normalizeElements(
      [
        { type: "node", id: 1, lat: 23.751, lon: 90.381, tags: { name: "Kacchi Bhai", amenity: "restaurant" } },
        { type: "node", id: 2, lat: 23.76, lon: 90.39, tags: { name: "Dhaka Kitchen", amenity: "restaurant", cuisine: "bangladeshi" } },
        { type: "node", id: 3, lat: 23.76, lon: 90.39, tags: { amenity: "restaurant" } },
      ],
      q, ["kacchi", "biryani"], ["biryani", "bangladeshi"],
    );
    expect(results.map((r) => r.title)).toEqual(["Kacchi Bhai", "Dhaka Kitchen"]);
    expect(results[0].place?.phone).toBeUndefined();
    expect(results[1].limitations?.[0]).toMatch(/not verified/);
    expect(results[0].place!.distanceKm!).toBeCloseTo(haversineKm(q.location, { lat: 23.751, lon: 90.381 }), 1);
  });

  it("builds trade-specific searches", () => {
    const base = { query: "q", kind: "place" as const, limit: 5, location: { lat: 1, lon: 2 } };
    expect(buildOverpassQuery({ ...base, topic: "ac repair", placeKind: "service" }).query).toContain('"craft"~"^(hvac|refrigeration)$"');
    expect(photonQueries({ ...base, topic: "ac repair", placeKind: "service" })).toContain("refrigeration");
  });
});

describe("safety and limits", () => {
  it("blocks private addresses for URL previews", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "192.168.0.1", "169.254.1.1", "::1", "::ffff:10.0.0.1", "fd00::1"]) expect(isPrivateAddress(ip)).toBe(true);
    expect(isPrivateAddress("93.184.216.34")).toBe(false);
  });

  it("honours robots.txt", () => {
    const robots = "User-agent: *\nDisallow: /private\nAllow: /private/ok\n\nUser-agent: OtherBot\nDisallow: /";
    expect(robotsAllows(robots, "/public")).toBe(true);
    expect(robotsAllows(robots, "/private/x")).toBe(false);
    expect(robotsAllows(robots, "/private/ok/1")).toBe(true);
  });

  it("expires volatile entries sooner than stable ones", () => {
    let now = 0;
    const cache = new TtlCache<string>(10, () => now);
    cache.set("news", "n", "volatile");
    cache.set("paper", "p", "stable");
    now = 4 * 60 * 1000;
    expect(cache.get("news")).toBeUndefined();
    expect(cache.get("paper")?.value).toBe("p");
  });

  it("enforces call budgets", () => {
    const b = new Budget({ providerCalls: 2 });
    expect(b.take("providerCalls")).toBe(true);
    expect(b.take("providerCalls")).toBe(true);
    expect(b.take("providerCalls")).toBe(false);
  });
});
