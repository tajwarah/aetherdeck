// Extractive evidence: verbatim sentences from retrieved sources, grouped under sub-questions.
// This runs without any AI and never writes a sentence the source did not contain.
import type { Evidence, SearchIntent, SearchResult } from "../shared/types.ts";
import { stableId } from "./http.ts";

export interface Subquestion { id: string; question: string; cues: RegExp }

export function subquestionsFor(intent: SearchIntent): Subquestion[] {
  const t = intent.constraints.topic;
  switch (intent.intentType) {
    case "research":
    case "explore":
      return [
        { id: "what", question: `What is ${t}?`, cues: /\b(is an?|are|refers? to|defined as|is the|describes?)\b/i },
        { id: "how", question: "How does it work?", cues: /\b(works? by|uses?|using|based on|relies on|mechanism|process|algorithm|method|principle|exploit\w*)\b/i },
        { id: "shown", question: "What has been demonstrated?", cues: /\b(demonstrat\w*|experiment\w*|achiev\w*|show(s|ed|n)|result\w*|measured|observed|implement\w*|built)\b/i },
        { id: "limits", question: "What is uncertain or unsolved?", cues: /\b(challeng\w*|limit\w*|difficult\w*|noise|error\w*|however|remain\w*|open (problem|question)|unclear|disput\w*|debate\w*|decoheren\w*)\b/i },
      ];
    case "news":
      return [
        { id: "events", question: `What is being reported about ${t}?`, cues: /./ },
        { id: "context", question: "Background", cues: /./ },
      ];
    default:
      return [];
  }
}

export function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+(?=[A-Z0-9“"(])/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 40 && s.length <= 420)
    .filter((s) => !/^(this|the following) (is|article|page|list|timeline)\b/i.test(s)); // meta sentences describe the page, not the subject
}

/** Crude stem so "computing" matches "computer" and "computers". */
export function stem(w: string) {
  return w.length > 5 ? w.replace(/(ations?|ings?|ers?|ed|es|s)$/, "") : w;
}

function terms(topic: string) {
  return topic.toLowerCase().split(/\s+/).filter((w) => w.length > 2).map(stem);
}

export function scoreSentence(sentence: string, topicTerms: string[], cue: RegExp, position: number): number {
  const lower = sentence.toLowerCase();
  const overlap = topicTerms.filter((t) => lower.includes(t)).length / Math.max(1, topicTerms.length);
  const cueHit = cue.test(sentence) ? 1 : 0;
  return overlap * 1.2 + cueHit * 1.5 + Math.max(0, 0.6 - position * 0.1);
}

/**
 * Picks the best verbatim sentence per (sub-question, source), at most `perQuestion` per sub-question,
 * never reusing a sentence. Sub-questions with nothing found become explicit gaps.
 */
export function extractEvidence(
  intent: SearchIntent,
  sources: SearchResult[],
  texts: Record<string, string>,
  perQuestion = 3,
): Evidence[] {
  const subs = subquestionsFor(intent);
  if (!subs.length) return [];
  const topicTerms = terms(intent.constraints.topic);
  const used = new Set<string>();
  const out: Evidence[] = [];

  for (const sub of subs) {
    const candidates: { source: SearchResult; sentence: string; score: number }[] = [];
    for (const source of sources) {
      const text = texts[source.id];
      if (!text) continue;
      const sentences = splitSentences(text);
      // Sources whose title *is* the topic (the main article, a namesake paper) speak to it most directly.
      const title = source.title.toLowerCase();
      const titleFit = topicTerms.filter((t) => title.includes(t)).length / Math.max(1, topicTerms.length) - (title.split(/\s+/).length > topicTerms.length + 2 ? 0.3 : 0);
      sentences.forEach((sentence, i) => {
        if (!sub.cues.test(sentence)) return;
        candidates.push({ source, sentence, score: scoreSentence(sentence, topicTerms, sub.cues, i) + titleFit * 0.6 });
      });
    }
    candidates.sort((a, b) => b.score - a.score);
    const picked: typeof candidates = [];
    const perSource = new Map<string, number>();
    for (const c of candidates) {
      if (picked.length >= perQuestion) break;
      if (used.has(c.sentence) || c.score < 0.9) continue;
      if ((perSource.get(c.source.id) ?? 0) >= 1) continue;
      picked.push(c);
      used.add(c.sentence);
      perSource.set(c.source.id, 1);
    }
    for (const p of picked) {
      out.push({
        id: stableId("ev", `${sub.id}|${p.source.id}|${p.sentence}`),
        claim: p.sentence,
        sourceIds: [p.source.id],
        supportingExcerpt: p.sentence,
        evidenceType: "direct_excerpt",
        confidenceOrLimitations: p.source.contentType === "paper"
          ? "Verbatim from the abstract; the full paper was not read."
          : p.source.freshnessStatus === "sample"
            ? "Sample text written for the offline demo."
            : "Verbatim from the source.",
        subtopic: sub.question,
      });
    }
    if (!picked.length && intent.intentType !== "news") {
      out.push({
        id: stableId("gap", sub.id + intent.query),
        claim: `No retrieved source directly addressed “${sub.question}”`,
        sourceIds: [],
        evidenceType: "gap",
        confidenceOrLimitations: "Try going deeper on this question, or open the sources.",
        subtopic: sub.question,
      });
    }
  }
  return out;
}

/** Collapses near-duplicate results across providers (same URL or same title), keeping the richer one. */
export function dedupeResults(results: SearchResult[]): SearchResult[] {
  const byKey = new Map<string, SearchResult>();
  const norm = (u: string) => u.replace(/^https?:\/\/(www\.)?/, "").replace(/[#?].*$/, "").replace(/\/$/, "").toLowerCase();
  const titleKey = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  for (const r of results) {
    // Places: the same OSM object (or same name at the same spot) is one place; same-named branches are not.
    const keys = r.place
      ? [`o:${r.place.osmUrl ?? norm(r.canonicalUrl)}`, `p:${titleKey(r.title)}|${r.place.lat.toFixed(3)}|${r.place.lon.toFixed(3)}`]
      : [`u:${norm(r.canonicalUrl)}`, `t:${titleKey(r.title)}|${r.contentType}`];
    const existingKey = keys.find((k) => byKey.has(k));
    if (existingKey) {
      const existing = byKey.get(existingKey)!;
      const richer = r.place ? Object.keys(r.place).length > Object.keys(existing.place ?? {}).length : r.snippet.length > existing.snippet.length;
      if (richer && r.freshnessStatus !== "sample") {
        for (const k of keys) byKey.set(k, { ...r, id: existing.id });
      }
      continue;
    }
    for (const k of keys) byKey.set(k, r);
  }
  return [...new Set(byKey.values())];
}
