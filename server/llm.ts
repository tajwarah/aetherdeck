// The AI layer: intent interpreter, research synthesizer and message drafter, on whichever model backend
// is configured (see models.ts). It never supplies facts of its own: it plans searches, and it writes claims
// that must cite retrieved sources with verbatim quotes. Every citation is checked before it is shown.
import { z } from "zod/v4";
import type { Answer, Evidence, SearchIntent, SearchResult } from "../shared/types.ts";
import { IntentType, VisualizationKind } from "../shared/types.ts";
import { stableId } from "./http.ts";
import { log } from "./log.ts";
import { getBackend } from "./models.ts";

export const llmEnabled = () => getBackend() !== null;

export function llmInfo() {
  const b = getBackend();
  return b ? { provider: b.provider, label: b.label(), free: b.free } : null;
}

async function parse<T>(schema: z.ZodType<T>, system: string, user: string, maxTokens: number): Promise<T | null> {
  const b = getBackend();
  return b ? b.json(schema, system, user, maxTokens) : null;
}

// --- intent ------------------------------------------------------------------

const LlmIntent = z.object({
  intentType: IntentType,
  mode: z.enum(["discover", "understand", "act"]),
  topic: z.string().describe("The subject, without filler words"),
  qualities: z.array(z.string()).describe("Requested qualities such as reliable, cheap, open now"),
  placeHint: z.string().nullable().describe("A place named in the request, or null. Never guess one."),
  time: z.enum(["today", "recent", "any"]),
  searchQueries: z.array(z.string()).describe("1-3 distinct search queries"),
  expectedOutput: VisualizationKind,
  needsMultipleSearches: z.boolean(),
});

export async function refineIntent(rules: SearchIntent): Promise<SearchIntent> {
  const out = await parse(
    LlmIntent,
    "You turn a search request into a structured retrieval plan. Do not answer the request. " +
      "intentType: research (explain + sources), news (recent events), local_service (a tradesperson nearby), " +
      "local_place (venues/restaurants nearby), media (images/video), url (a web address), explore (anything else). " +
      "expectedOutput: evidence for research, timeline for news, comparison for services or when the user compares, map for places, media, reading for url, clusters otherwise.",
    `Request: ${rules.query}`,
    1500,
  );
  if (!out) return rules;
  const local = out.intentType === "local_place" || out.intentType === "local_service";
  return {
    ...rules,
    intentType: out.intentType,
    mode: out.mode,
    // Local searches match names and tags literally, so the planner's tighter topic wins when the AI's merely adds words.
    constraints: { time: out.time, topic: local && rules.constraints.topic && out.topic.toLowerCase().includes(rules.constraints.topic) ? rules.constraints.topic : out.topic || rules.constraints.topic, qualities: out.qualities, placeHint: out.placeHint ?? rules.constraints.placeHint },
    locationContext: rules.locationContext.source === "none"
      ? { ...rules.locationContext, needed: local && !(out.placeHint ?? rules.constraints.placeHint), label: out.placeHint ?? rules.locationContext.label }
      : { ...rules.locationContext, needed: local },
    searchQueries: out.searchQueries.slice(0, out.needsMultipleSearches ? 3 : 1).filter(Boolean).length ? out.searchQueries.slice(0, 3) : rules.searchQueries,
    expectedOutput: out.expectedOutput,
    plannedBy: "llm",
  };
}

// --- synthesis ---------------------------------------------------------------

const Synthesis = z.object({
  subquestions: z.array(
    z.object({
      question: z.string().describe("At most 7 words"),
      points: z.array(
        z.object({
          claim: z.string().describe("One sentence"),
          kind: z.enum(["ai_summary", "inference", "conflict", "gap"]),
          sourceIds: z.array(z.string()),
          quote: z.string().describe("Verbatim text copied exactly from one cited source, or empty"),
        }),
      ),
    }),
  ),
});

const squash = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** Keeps only citations that point at real sources and quotes that appear in them. Exported for tests. */
export function verifyPoints(
  subquestions: z.infer<typeof Synthesis>["subquestions"],
  sources: SearchResult[],
  texts: Record<string, string>,
): Evidence[] {
  const known = new Set(sources.map((s) => s.id));
  const out: Evidence[] = [];
  for (const sq of subquestions) {
    for (const p of sq.points) {
      const ids = p.sourceIds.filter((id) => known.has(id));
      const quoteOk = p.quote && ids.some((id) => squash(texts[id] ?? "").includes(squash(p.quote)));
      let type = p.kind;
      let limitation = "Written by AI from the cited sources.";
      if ((type === "ai_summary" || type === "conflict") && ids.length === 0) {
        type = "inference";
        limitation = "No valid citation — treat as unverified.";
      } else if (type === "ai_summary" && !quoteOk) {
        limitation = "Written by AI from the cited sources; the supporting quote could not be verified.";
      } else if (type === "inference") {
        limitation = "AI inference that goes beyond what the sources state.";
      } else if (type === "conflict") {
        limitation = "Sources disagree — compare them directly.";
      } else if (type === "gap") {
        limitation = "Not covered by the retrieved sources.";
      }
      out.push({
        id: stableId("ai", sq.question + p.claim),
        claim: p.claim,
        sourceIds: ids,
        supportingExcerpt: quoteOk ? p.quote : undefined,
        evidenceType: type,
        confidenceOrLimitations: limitation,
        subtopic: sq.question,
      });
    }
  }
  return out;
}

export async function synthesize(intent: SearchIntent, sources: SearchResult[], texts: Record<string, string>): Promise<Evidence[] | null> {
  const material = sources
    .filter((s) => texts[s.id])
    .slice(0, 8)
    .map((s) => `<source id="${s.id}" title="${s.title.replace(/"/g, "'")}" publisher="${s.publisher ?? s.domain}" date="${s.publicationDate?.slice(0, 10) ?? "unknown"}">\n${texts[s.id].slice(0, 1800)}\n</source>`)
    .join("\n");
  if (!material) return null;
  try {
    const out = await parse(
      Synthesis,
      "You organize retrieved sources into an evidence map. Use ONLY the sources provided — no outside facts. " +
        "Write 3-4 short sub-questions (at most 7 words each) that a careful reader would ask, with 1-3 points each. " +
        "Each ai_summary point cites source ids and copies a short verbatim quote from one of them. " +
        "Use conflict when sources disagree, inference when you reason beyond them, gap when they do not answer a sub-question.",
      `Question: ${intent.query}\n\n${material}`,
      4000,
    );
    return out ? verifyPoints(out.subquestions, sources, texts) : null;
  } catch (err) {
    log("warn", "llm_synthesis_failed", { error: (err as Error).message });
    return null;
  }
}

// --- the answer ----------------------------------------------------------------

const Written = z.object({
  sentences: z.array(z.object({
    text: z.string().describe("One sentence of the answer"),
    sources: z.array(z.string()).describe("The ids of the sources that support this sentence"),
  })),
});

/**
 * The question answered in a few plain sentences, from the sources alone. A sentence that cites no source given
 * here is dropped, so everything shown can be traced to a site on the map.
 */
export async function writeAnswer(intent: SearchIntent, sources: SearchResult[], texts: Record<string, string>): Promise<Answer | null> {
  const given = sources.filter((s) => texts[s.id] || s.snippet).slice(0, 12);
  if (given.length < 2) return null;
  const material = given
    .map((s) => `<source id="${s.id}" title="${s.title.replace(/"/g, "'")}" site="${s.publisher ?? s.domain}" date="${s.publicationDate?.slice(0, 10) ?? "unknown"}">\n${(texts[s.id] ?? s.snippet).slice(0, 2200)}\n</source>`)
    .join("\n");
  try {
    const out = await parse(
      Written,
      "You answer a question for someone who wants to understand it, using ONLY the sources provided: no outside facts. " +
        "Write 4-6 short, plain sentences that answer it directly, the most important first. " +
        "After each sentence list the ids of the sources that support it. If the sources don't answer part of the question, say so in one sentence citing the closest source.",
      `Question: ${intent.query}\n\n${material}`,
      1800,
    );
    if (!out) return null;
    const ids = new Set(given.map((s) => s.id));
    const sentences = out.sentences
      .map((x) => ({ text: x.text.trim(), sourceIds: [...new Set(x.sources.filter((id) => ids.has(id)))] }))
      .filter((x) => x.text && x.sourceIds.length);
    return sentences.length >= 2 ? { by: "ai", sentences, model: llmInfo()?.label } : null;
  } catch (err) {
    log("warn", "llm_answer_failed", { error: (err as Error).message });
    return null;
  }
}

// --- action drafting -----------------------------------------------------------

const Draft = z.object({ subject: z.string(), body: z.string() });

export async function draftMessage(kind: string, businessName: string, need: string, when: string, partySize?: number, name?: string) {
  if (!llmEnabled()) return null;
  try {
    // The person's name never goes to the model; it is filled in here afterwards.
    const out = await parse(
      Draft,
      "Draft a short, polite message from a customer to a local business. Plain text, under 90 words. " +
        "Do not invent facts about the business, prices, or availability. Sign off exactly with [Your name].",
      `Business: ${businessName}\nPurpose: ${kind === "prepare_reservation" ? "table reservation request" : "service request"}\nNeed: ${need}\nWhen: ${when}${partySize ? `\nParty size: ${partySize}` : ""}`,
      800,
    );
    if (out && name?.trim()) out.body = out.body.replaceAll("[Your name]", name.trim());
    return out;
  } catch (err) {
    log("warn", "llm_draft_failed", { error: (err as Error).message });
    return null;
  }
}
