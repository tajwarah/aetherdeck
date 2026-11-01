// The agent workflow for one intent: interpret → locate → retrieve (parallel) → read → compare → compose.
// It emits a fresh EnvironmentModel snapshot after each meaningful step so the client renders progressively.
import { randomUUID } from "node:crypto";
import type { AgentTask, EnvironmentModel, Evidence, ExploreRequest, Notice, SearchIntent, SearchResult } from "../shared/types.ts";
import type { Provider, ProviderOutput, ProviderQuery } from "./providers/types.ts";
import { PROVIDERS, demoForced, webEngines } from "./providers/index.ts";
import { looksTechnical } from "./providers/stackexchange.ts";
import { rankOpenWeb } from "./rank.ts";
import { geocode } from "./providers/osm.ts";
import { planIntent } from "./intent.ts";
import { llmEnabled, llmInfo, refineIntent, synthesize } from "./llm.ts";
import { extractEvidence, dedupeResults } from "./evidence.ts";
import { buildActions, buildNodes, chooseVisualization } from "./environment.ts";
import { previewUrl } from "./preview.ts";
import { fromHits } from "./providers/browser.ts";
import { Budget } from "./budget.ts";
import { TtlCache } from "./cache.ts";
import { ProviderError } from "./http.ts";
import { log } from "./log.ts";

const cache = new TtlCache<ProviderOutput>(400);

export interface PlannedCall { provider: Provider; q: ProviderQuery }

/** Which providers to ask, for what, given the intent. Pure — exported for tests. */
export function planCalls(intent: SearchIntent, loc: { lat: number; lon: number } | undefined, demo: boolean): PlannedCall[] {
  const topic = intent.constraints.topic;
  const query = intent.searchQueries[0] ?? intent.query;
  const time = intent.constraints.time;
  const deep = intent.requestedDepth === "deep";
  const base = { query, topic, time, location: loc };
  const P = PROVIDERS;
  // Every whole-web engine that is configured (planned even when not, so the trace shows what was skipped).
  const web = (kind: "web" | "news", limit: number): PlannedCall[] => [
    { provider: P.brave, q: { ...base, kind, limit } },
    { provider: P.tavily, q: { ...base, kind, limit: Math.min(limit, 8) } },
    { provider: P.searxng, q: { ...base, kind, limit } },
  ];
  let calls: PlannedCall[];
  switch (intent.intentType) {
    case "research":
      // The whole web first, then scholarship, forums and the encyclopedia as one voice among many.
      calls = [
        ...web("web", deep ? 12 : 10),
        { provider: P.openalex, q: { ...base, kind: "paper", limit: deep ? 8 : 4 } },
        { provider: P.arxiv, q: { ...base, kind: "paper", limit: deep ? 5 : 3 } },
        { provider: P.hackernews, q: { ...base, kind: "web", limit: 4 } },
        { provider: P.wikipedia, q: { ...base, kind: "encyclopedia", limit: deep ? 3 : 1 } },
      ];
      break;
    case "news":
      calls = [
        ...web("news", 10),
        { provider: P.currents, q: { ...base, kind: "news", limit: 12 } },
        { provider: P.gdelt, q: { ...base, kind: "news", limit: 12 } },
        { provider: P.hackernews, q: { ...base, kind: "news", limit: 4, time: time === "any" ? "recent" : time } },
        { provider: P.wikipedia, q: { ...base, kind: "encyclopedia", limit: 1 } },
      ];
      break;
    case "local_service":
    case "local_place": {
      const placeKind = intent.intentType === "local_service" ? "service" : "food";
      calls = [
        { provider: P.photon, q: { ...base, kind: "place", limit: 12, placeKind, radiusKm: 4 } },
        { provider: P.osm, q: { ...base, kind: "place", limit: 12, placeKind, radiusKm: 3 } },
        { provider: P.brave, q: { ...base, query: `${topic} ${intent.locationContext.label ?? ""}`.trim(), kind: "place", limit: 6 } },
      ];
      break;
    }
    case "media":
      calls = [
        { provider: P.brave, q: { ...base, kind: "image", limit: 12 } },
        { provider: P.brave, q: { ...base, kind: "video", limit: 6 } },
        { provider: P.wikipedia, q: { ...base, kind: "image", limit: 8 } },
      ];
      break;
    default:
      calls = [
        ...web("web", 10),
        { provider: P.hackernews, q: { ...base, kind: "web", limit: 5 } },
        { provider: P.openalex, q: { ...base, kind: "paper", limit: 2 } },
        { provider: P.wikipedia, q: { ...base, kind: "encyclopedia", limit: 2 } },
      ];
  }
  if (["research", "explore"].includes(intent.intentType) && looksTechnical(intent.query)) calls.push({ provider: P.stackexchange, q: { ...base, kind: "web", limit: 3 } });
  if (demo) {
    const kinds = [...new Set(calls.map((c) => c.q.kind))];
    return kinds.map((kind) => ({ provider: P.demo, q: { ...calls.find((c) => c.q.kind === kind)!.q } }));
  }
  return calls;
}

const cacheKey = (c: PlannedCall) =>
  JSON.stringify([c.provider.id, c.q.kind, c.q.query, c.q.topic, c.q.time, c.q.limit, c.q.placeKind, c.q.location && [c.q.location.lat.toFixed(3), c.q.location.lon.toFixed(3)]]);

function rankSources(intent: SearchIntent, sources: SearchResult[]): SearchResult[] {
  const terms = intent.constraints.topic.toLowerCase().split(/\s+/).filter((t) => t.length > 2);
  if (intent.intentType === "news") {
    // Newest first, but no one outlet twice in a row near the top.
    const dated = [...sources].sort((a, b) => Date.parse(b.publicationDate ?? "0") - Date.parse(a.publicationDate ?? "0"));
    return rankOpenWeb(dated, intent.constraints.topic || intent.query, "today");
  }
  if (intent.intentType === "local_place" || intent.intentType === "local_service") {
    // Name matches first, then nearest; listings with contact details edge ahead of bare ones.
    const fit = (s: SearchResult) => {
      const name = s.title.toLowerCase();
      const named = terms.some((t) => name.includes(t)) ? 2 : 0;
      const contact = s.place?.phone || s.place?.website ? 0.4 : 0;
      return named + contact - (s.place?.distanceKm ?? 5) * 0.25;
    };
    return [...sources].sort((a, b) => fit(b) - fit(a)).slice(0, 14);
  }
  return rankOpenWeb(sources, intent.constraints.topic || intent.query, intent.constraints.time);
}

export async function explore(req: ExploreRequest, emit: (m: EnvironmentModel) => void, signal?: AbortSignal): Promise<void> {
  const budget = new Budget();
  const notices: Notice[] = [];
  const task: AgentTask = {
    id: randomUUID(),
    status: "planning",
    objective: req.query,
    steps: [
      { id: "interpret", label: "Interpreting", status: "running" },
      { id: "retrieve", label: "Searching", status: "pending" },
      { id: "read", label: "Reading", status: "pending" },
      { id: "compare", label: "Comparing", status: "pending" },
      { id: "compose", label: "Arranging", status: "pending" },
    ],
    toolCalls: [],
    requiresConfirmation: false,
  };
  const step = (id: string, status: AgentTask["steps"][number]["status"], detail?: string) => {
    const s = task.steps.find((x) => x.id === id)!;
    s.status = status;
    if (detail !== undefined) s.detail = detail;
  };

  // 1. Interpret
  let intent = planIntent(req.parentQuery ? `${req.query}` : req.query, req.location, req.depth);
  if (llmEnabled() && intent.intentType !== "url" && budget.take("llmCalls")) {
    const t0 = Date.now();
    try {
      intent = await Promise.race([
        refineIntent(intent),
        new Promise<SearchIntent>((_, rej) => setTimeout(() => rej(new Error("intent timeout")), 8_000)),
      ]);
    } catch (err) {
      log("warn", "intent_llm_fallback", { error: (err as Error).message });
      notices.push({ level: "info", code: "llm_fallback", message: "AI planning was slow, so the built-in planner was used." });
    }
    log("info", "llm_intent", { ms: Date.now() - t0, by: intent.plannedBy });
  }
  step("interpret", "done", intent.plannedBy === "llm" ? `Planned by ${llmInfo()?.label ?? "AI"}` : "Planned by rules");

  let sources: SearchResult[] = [];
  let texts: Record<string, string> = {};
  let evidence: Evidence[] = [];
  let synthesisMode: EnvironmentModel["synthesisMode"] = "pending";
  const demo = demoForced();

  const snapshot = (complete: boolean): EnvironmentModel => {
    const viz = chooseVisualization(intent, sources);
    const modes = new Set(sources.map((s) => (s.freshnessStatus === "sample" ? "sample" : "live")));
    return {
      id: task.id,
      intent,
      visualization: viz,
      dataMode: modes.size === 0 ? "none" : modes.size === 2 ? "mixed" : modes.has("sample") ? "sample" : "live",
      synthesisMode,
      nodes: buildNodes(intent, viz, sources, evidence),
      sources,
      evidence,
      actions: buildActions(intent, sources),
      notices: [...notices],
      task: structuredClone(task),
      complete,
    };
  };

  // 2. Locate (local intents only). Never guess a location.
  let loc: { lat: number; lon: number } | undefined =
    intent.locationContext.lat !== undefined ? { lat: intent.locationContext.lat, lon: intent.locationContext.lon! } : undefined;
  const isLocal = intent.intentType === "local_place" || intent.intentType === "local_service";
  if (isLocal && !loc && intent.constraints.placeHint) {
    try {
      const g = await geocode(intent.constraints.placeHint);
      if (g) {
        loc = { lat: g.lat, lon: g.lon };
        intent = { ...intent, locationContext: { needed: true, source: "user_supplied", label: g.label, lat: g.lat, lon: g.lon } };
      }
    } catch (err) {
      log("warn", "geocode_failed", { error: (err as Error).message });
    }
  }
  if (isLocal && !loc) {
    intent = { ...intent, locationContext: { ...intent.locationContext, needed: true } };
    notices.push({ level: "info", code: "location_required", message: "Where should I look? Share your location or name a neighbourhood — nothing is searched until you do." });
    task.status = "done";
    for (const s of task.steps.slice(1)) s.status = "skipped";
    emit(snapshot(true));
    return;
  }

  task.status = "running";
  step("retrieve", "running");
  emit(snapshot(false));

  // 3. Retrieve — independent calls in parallel, each cached, each emitting as it lands.
  if (intent.intentType === "url") {
    try {
      budget.take("providerCalls");
      const t0 = Date.now();
      const { result, text } = await previewUrl(intent.query);
      sources = [result];
      texts = { [result.id]: text };
      evidence = text.split("\n\n").filter((p) => p.trim()).slice(0, 6).map((p, i) => ({
        id: `para-${i}`,
        claim: p,
        sourceIds: [result.id],
        supportingExcerpt: p,
        evidenceType: "direct_excerpt" as const,
        confidenceOrLimitations: "Verbatim from the page.",
      }));
      task.toolCalls.push({ provider: "direct", query: intent.query, status: "ok", ms: Date.now() - t0, count: 1 });
    } catch (err) {
      const e = err as ProviderError;
      task.toolCalls.push({ provider: "direct", query: intent.query, status: "error", ms: 0, count: 0, note: e.message });
      notices.push({ level: "warning", code: `url_${e.code ?? "error"}`, message: `Couldn't open that page: ${e.message}. You can still open it in your browser.` });
    }
  } else {
    const planned = planCalls(intent, loc, demo);
    const skipped = planned.filter((c) => !c.provider.available());
    // What the person's own engine found, in a window they could see (desktop app): the engine's order, first.
    if (req.found?.hits.length) {
      const own = fromHits(req.found.engine, req.found.hits, intent.intentType === "news");
      task.toolCalls.push({ provider: "browser", query: intent.query, status: "ok", ms: 0, count: own.results.length });
      sources = rankSources(intent, dedupeResults([...sources, ...own.results]));
      texts = { ...texts, ...own.texts };
    }
    if (!req.found?.hits.length && !webEngines().length && intent.intentType !== "local_place" && intent.intentType !== "local_service") {
      notices.push({ level: "info", code: "web_search_not_configured", message: "Whole-web search isn't connected yet, so these come from open sources only (forums, research, news, the encyclopedia). In the desktop app, Warpnaut maps what Google finds; here, add a Brave Search or Tavily key in Settings for results from across the web." });
    }
    for (const c of skipped) task.toolCalls.push({ provider: c.provider.id, query: c.q.query, status: "skipped", ms: 0, count: 0, note: "not configured" });
    const runnable = planned.filter((c) => c.provider.available());
    step("retrieve", "running", `Asking ${[...new Set(runnable.map((c) => c.provider.label))].join(", ")}`);

    const merge = (out: ProviderOutput) => {
      sources = rankSources(intent, dedupeResults([...sources, ...out.results]));
      texts = { ...texts, ...out.texts };
    };

    await Promise.allSettled(
      runnable.map(async (c) => {
        if (signal?.aborted) return;
        const key = cacheKey(c);
        const hit = cache.get(key);
        if (hit) {
          const cachedResults = hit.value.results.map((r) => (r.freshnessStatus === "live" ? { ...r, freshnessStatus: "cached" as const } : r));
          task.toolCalls.push({ provider: c.provider.id, query: c.q.query, status: "cached", ms: 0, count: cachedResults.length });
          merge({ results: cachedResults, texts: hit.value.texts });
          emit(snapshot(false));
          return;
        }
        if (!budget.take("providerCalls")) {
          task.toolCalls.push({ provider: c.provider.id, query: c.q.query, status: "skipped", ms: 0, count: 0, note: "budget" });
          return;
        }
        const t0 = Date.now();
        try {
          const out = await c.provider.search(c.q);
          cache.set(key, out, c.provider.freshness(c.q));
          task.toolCalls.push({ provider: c.provider.id, query: c.q.query, status: "ok", ms: Date.now() - t0, count: out.results.length });
          merge(out);
          emit(snapshot(false));
        } catch (err) {
          const e = err as ProviderError;
          task.toolCalls.push({ provider: c.provider.id, query: c.q.query, status: "error", ms: Date.now() - t0, count: 0, note: e.message });
          notices.push({ level: "warning", code: `${c.provider.id}_${e.code ?? "error"}`, message: `${c.provider.label} unavailable: ${e.message}` });
          log("warn", "provider_failed", { provider: c.provider.id, code: e.code, error: e.message });
        }
      }),
    );

    // Honest fallback: if every live source failed, say so and offer clearly-labeled sample data.
    const anyAnswered = task.toolCalls.some((t) => t.status === "ok" || t.status === "cached");
    if (!sources.length && !demo && !anyAnswered) {
      const sample = planCalls(intent, loc, true);
      for (const c of sample) {
        const out = await c.provider.search(c.q);
        merge(out);
      }
      if (sources.length) {
        notices.push({ level: "warning", code: "sample_fallback", message: "Live sources were unreachable. What you see is labeled sample data, not real results." });
      }
    }
  }
  const okCalls = task.toolCalls.filter((t) => t.status === "ok" || t.status === "cached").length;
  step("retrieve", sources.length ? "done" : "failed", `${sources.length} results from ${okCalls} ${okCalls === 1 ? "source" : "sources"}`);
  if (!sources.length) {
    notices.push({ level: "warning", code: "no_results", message: isLocal ? "Nothing listed nearby matched. Try a wider area or different words." : "No results. Try different words." });
  } else if (intent.intentType === "news" && intent.constraints.time === "today" && sources.some((s) => s.contentType === "news")) {
    const newest = Math.max(...sources.filter((s) => s.contentType === "news").map((s) => Date.parse(s.publicationDate ?? "0")));
    if (Date.now() - newest > 36 * 3600_000) {
      notices.push({ level: "info", code: "nothing_today", message: `Nothing from today was found in open news sources. The newest item is from ${new Date(newest).toUTCString().slice(5, 16)} — dates are shown on every report.` });
    }
  } else if (intent.intentType === "news" && !sources.some((s) => s.contentType === "news")) {
    notices.push({ level: "info", code: "no_recent_news", message: `No reports about “${intent.constraints.topic}” were found in the open news sources for the past week. Background reading is shown instead.` });
  }

  // 4. Read — use the text providers returned (intros, abstracts, listings), within the open budget.
  const readable = sources.filter((s) => texts[s.id]);
  const opened = readable.slice(0, budget.limits.sourceOpens);
  budget.take("sourceOpens", opened.length);
  step("read", opened.length ? "done" : "skipped", opened.length ? `Read ${opened.length} ${opened.length === 1 ? "source" : "sources"}` : "Headlines and listings only");

  // 5. Compare — AI synthesis with verified citations when configured; verbatim excerpts otherwise.
  step("compare", "running");
  emit(snapshot(false));
  const wantsEvidence = ["research", "explore"].includes(intent.intentType) || (intent.intentType === "news" && llmEnabled());
  if (wantsEvidence && opened.length) {
    let ai: Evidence[] | null = null;
    if (llmEnabled() && budget.take("llmCalls")) {
      // Show verbatim excerpts at once; the AI map replaces them when (and if) it arrives.
      evidence = extractEvidence(intent, opened, texts);
      synthesisMode = "pending";
      step("compare", "running", `AI organizing evidence (${llmInfo()?.label ?? "model"}) — excerpts shown meanwhile`);
      emit(snapshot(false));
      const t0 = Date.now();
      ai = await synthesize(intent, opened, texts);
      log("info", "llm_synthesis", { ms: Date.now() - t0, points: ai?.length ?? 0 });
    }
    if (ai && ai.length) {
      evidence = ai;
      synthesisMode = "ai";
      const dropped = ai.filter((e) => e.evidenceType === "inference" && e.sourceIds.length === 0).length;
      step("compare", "done", `${ai.length} points${dropped ? `, ${dropped} unverified` : ""}`);
    } else {
      evidence = extractEvidence(intent, opened, texts);
      synthesisMode = "extractive";
      if (llmEnabled()) notices.push({ level: "info", code: "llm_synthesis_unavailable", message: "The AI model didn't return a usable evidence map in time, so exact excerpts are shown." });
      step("compare", "done", `${evidence.filter((e) => e.evidenceType === "direct_excerpt").length} excerpts`);
      if (!llmEnabled()) {
        notices.push({ level: "info", code: "extractive", message: "Showing exact sentences from sources. AI summaries and disagreement detection turn on when a model key is set (free options: OpenRouter, Groq, Gemini)." });
      }
    }
  } else {
    synthesisMode = "extractive";
    step("compare", "skipped");
  }

  step("compose", "done");
  task.status = "done";
  task.result = `${sources.length} sources, ${evidence.length} evidence points`;
  emit(snapshot(true));
  log("info", "explore_done", { query: req.query, intent: intent.intentType, sources: sources.length, calls: budget.used.providerCalls, ms: Date.now() - budget.started });
}
