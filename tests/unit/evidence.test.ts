import { describe, expect, it } from "vitest";
import { dedupeResults, extractEvidence, splitSentences } from "../../server/evidence.ts";
import { verifyPoints } from "../../server/llm.ts";
import { planIntent } from "../../server/intent.ts";
import type { SearchResult } from "../../shared/types.ts";

const src = (id: string, extra: Partial<SearchResult> = {}): SearchResult => ({
  id, title: `Title ${id}`, canonicalUrl: `https://example.org/${id}`, domain: "example.org", contentType: "encyclopedia",
  snippet: "s", retrievedAt: "2026-01-01T00:00:00Z", sourceProvider: "wikipedia", freshnessStatus: "live", ...extra,
});

describe("extractive evidence", () => {
  const intent = planIntent("Explain quantum computing");
  const texts = {
    a: "A quantum computer is a computer that uses quantum states to process information. It works by using qubits in superposition. However, noise remains a major challenge for building large machines.",
    b: "This is a list of quantum computing companies. Researchers demonstrated a 50 qubit processor in an experiment.",
  };
  const sources = [src("a", { title: "Quantum computing" }), src("b", { contentType: "paper" })];

  it("only quotes sentences that exist in the sources", () => {
    const ev = extractEvidence(intent, sources, texts);
    const direct = ev.filter((e) => e.evidenceType === "direct_excerpt");
    expect(direct.length).toBeGreaterThan(2);
    for (const e of direct) {
      expect(texts[e.sourceIds[0] as "a" | "b"]).toContain(e.supportingExcerpt);
    }
  });

  it("drops meta sentences and marks unanswered sub-questions as gaps", () => {
    expect(splitSentences(texts.b).some((s) => s.startsWith("This is a list"))).toBe(false);
    const ev = extractEvidence(intent, [src("c")], { c: "Completely unrelated sentence about gardening and soil." });
    expect(ev.every((e) => e.evidenceType === "gap")).toBe(true);
  });
});

describe("citation verification", () => {
  const sources = [src("a")];
  const texts = { a: "Qubits can be in superposition of 0 and 1." };

  it("keeps verified quotes and downgrades citations to unknown sources", () => {
    const out = verifyPoints(
      [{ question: "Q", points: [
        { claim: "Qubits use superposition.", kind: "ai_summary", sourceIds: ["a"], quote: "superposition of 0 and 1" },
        { claim: "Invented fact.", kind: "ai_summary", sourceIds: ["zzz"], quote: "nope" },
        { claim: "Misquoted.", kind: "ai_summary", sourceIds: ["a"], quote: "qubits are classical" },
      ] }],
      sources, texts,
    );
    expect(out[0]).toMatchObject({ evidenceType: "ai_summary", supportingExcerpt: "superposition of 0 and 1" });
    expect(out[1]).toMatchObject({ evidenceType: "inference", sourceIds: [] });
    expect(out[2].supportingExcerpt).toBeUndefined();
    expect(out[2].confidenceOrLimitations).toMatch(/could not be verified/);
  });
});

describe("result dedupe", () => {
  it("merges the same URL from two providers and keeps same-named branches apart", () => {
    const merged = dedupeResults([src("a"), src("b", { canonicalUrl: "https://www.example.org/a/" })]);
    expect(merged).toHaveLength(1);
    const place = (id: string, lat: number) => src(id, { title: "Kacchi Bhai", contentType: "place", canonicalUrl: `https://osm.org/${id}`, place: { lat, lon: 90, osmUrl: `https://osm.org/${id}` } });
    expect(dedupeResults([place("x", 23.7), place("y", 23.8)])).toHaveLength(2);
    expect(dedupeResults([place("x", 23.7), place("x", 23.7)])).toHaveLength(1);
  });
});
