import { describe, expect, it } from "vitest";
import { extractAnswer, onTopic, sentencesOf } from "../../server/answer.ts";
import { planIntent } from "../../server/intent.ts";
import type { SearchResult } from "../../shared/types.ts";

const src = (id: string, snippet = ""): SearchResult => ({
  id, title: id, canonicalUrl: `https://${id}.example/`, domain: `${id}.example`, contentType: "web", snippet,
  retrievedAt: new Date(0).toISOString(), sourceProvider: "browser", freshnessStatus: "live", limitations: [],
});

describe("the answer", () => {
  it("keeps whole sentences and drops page furniture", () => {
    const s = sentencesOf("Menu Home About. An AI agent is a program that perceives its environment and acts to reach a goal. Accept cookies to continue using this website today please. Short.");
    expect(s).toEqual(["An AI agent is a program that perceives its environment and acts to reach a goal."]);
  });

  it("answers in the sources' own words, one sentence per source, in their order", () => {
    const intent = planIntent("How do AI agents work?");
    const sources = [src("a"), src("b"), src("c")];
    const texts = {
      a: "Welcome to our blog about many things. AI agents work by looping: they plan a step, call a tool, and read the result before choosing the next step.",
      b: "An AI agent is a system that uses a language model to decide which actions to take toward a goal.",
      c: "Our team loves pizza and long walks on the beach during the summer months.",
    };
    const a = extractAnswer(intent, sources, texts)!;
    expect(a.by).toBe("extract");
    expect(a.sentences.map((x) => x.sourceIds[0])).toEqual(["a", "b"]);
    expect(a.sentences[0].text).toContain("AI agents work by looping");
  });

  it("says nothing when the sources don't answer", () => {
    const intent = planIntent("How do AI agents work?");
    expect(extractAnswer(intent, [src("x")], { x: "Nothing relevant is written here at all, only filler about gardening tools." })).toBeUndefined();
  });
});

describe("what stays on the map", () => {
  it("drops an open source about something else, and keeps what the person's engine found", () => {
    const intent = planIntent("How do AI agents work?");
    const wiki = { ...src("w"), title: "DeepSeek", snippet: "A Chinese company founded in 2023.", sourceProvider: "wikipedia" as const };
    const agent = { ...src("x"), title: "Intelligent agent", snippet: "In artificial intelligence, an agent acts.", sourceProvider: "wikipedia" as const };
    const found = { ...src("g"), title: "Unrelated title", snippet: "", sourceProvider: "browser" as const };
    expect(onTopic(intent, wiki)).toBe(false);
    expect(onTopic(intent, agent)).toBe(true);
    expect(onTopic(intent, found)).toBe(true);
  });
});
