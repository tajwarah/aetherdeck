// The answer, first: a few sentences that answer the question, each tied to the sources it rests on, shown in the
// middle of the map with every site around it. A connected model writes it from the sources alone; without one,
// it is the sources' own best sentences, verbatim. Before either, the top pages are read in full (within the
// budget, and only where robots.txt allows) so the answer rests on more than search snippets.
import type { Answer, SearchIntent, SearchResult } from "../shared/types.ts";
import { previewUrl } from "./preview.ts";
import type { Budget } from "./budget.ts";
import { log } from "./log.ts";

const READ_MS = 7_000;

/** The full text of the top web pages that so far only have a snippet. Returns texts by source id. */
export async function readTop(sources: SearchResult[], texts: Record<string, string>, budget: Budget, signal?: AbortSignal): Promise<Record<string, string>> {
  const want = sources
    .filter((s) => (s.contentType === "web" || s.contentType === "news") && s.freshnessStatus !== "sample" && (texts[s.id]?.length ?? 0) < 600)
    .slice(0, Math.max(0, budget.limits.sourceOpens - budget.used.sourceOpens));
  const out: Record<string, string> = {};
  await Promise.allSettled(want.map(async (s) => {
    if (signal?.aborted || !budget.take("sourceOpens")) return;
    try {
      const { text } = await Promise.race([
        previewUrl(s.canonicalUrl),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error("slow")), READ_MS)),
      ]);
      if (text.trim().length > (texts[s.id]?.length ?? 0)) out[s.id] = text.slice(0, 12_000);
    } catch (err) {
      log("info", "read_skipped", { domain: s.domain, reason: (err as Error).message });
    }
  }));
  return out;
}

const STOP = new Set("a an the and or of to in on for with by is are was were be how what why when which who do does did can could should would will it its this that these those as at from about into your you i we they them their our my me vs".split(" "));
const termsOf = (q: string) => [...new Set(q.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((t) => t.length > 2 && !STOP.has(t)).map((t) => t.replace(/(ing|ed|es|s)$/, "")))];

/**
 * Whether a result is about the question at all: it shares a word with it. What the person's own search engine
 * found is always kept (the engine already judged it); an encyclopedia article on something else is not.
 */
export function onTopic(intent: SearchIntent, s: SearchResult): boolean {
  if (s.sourceProvider === "browser" || s.place || s.freshnessStatus === "sample") return true;
  const terms = termsOf(`${intent.constraints.topic} ${intent.query}`);
  if (!terms.length) return true;
  const text = `${s.title} ${s.snippet}`.toLowerCase();
  return terms.some((t) => text.includes(t));
}

/** The sentences of a text worth quoting: whole sentences, not menus, cookie notices or headlines. */
export function sentencesOf(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+(?=[A-Z0-9“"])/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 50 && s.length <= 320 && /[.!?]$/.test(s) && !/cookie|subscribe|sign up|log in|javascript|newsletter|all rights reserved|click here/i.test(s));
}

/**
 * Without a model: the sources' own sentences that best answer the question, at most one per source, in the
 * sources' order. Verbatim, so nothing is said that a source doesn't say. Exported for tests.
 */
export function extractAnswer(intent: SearchIntent, sources: SearchResult[], texts: Record<string, string>, max = 4): Answer | undefined {
  const terms = termsOf(`${intent.constraints.topic} ${intent.query}`);
  if (!terms.length) return undefined;
  const picks: { text: string; id: string; score: number; rank: number }[] = [];
  sources.forEach((s, rank) => {
    const text = texts[s.id] ?? s.snippet;
    let best: { text: string; score: number } | null = null;
    for (const sentence of sentencesOf(text)) {
      const low = sentence.toLowerCase();
      const hits = terms.filter((t) => low.includes(t)).length;
      if (!hits) continue;
      // Sentences that explain ("is a", "works by", "uses") answer a question better than ones that mention it.
      const explains = /\b(is|are) (a|an|the)\b|\bworks? by\b|\buses?\b|\ballows?\b|\bmeans?\b|\bconsists? of\b|\bbecause\b/i.test(sentence) ? 0.8 : 0;
      const score = hits / terms.length + explains - rank * 0.03;
      if (!best || score > best.score) best = { text: sentence, score };
    }
    if (best && best.score >= 0.5) picks.push({ ...best, id: s.id, rank });
  });
  const chosen = picks.sort((a, b) => b.score - a.score).slice(0, max).sort((a, b) => a.rank - b.rank);
  if (chosen.length < 2) return undefined;
  return { by: "extract", sentences: chosen.map((c) => ({ text: c.text, sourceIds: [c.id] })) };
}
