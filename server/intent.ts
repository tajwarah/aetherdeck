// Deterministic intent planner. It always runs (fast, free, testable); the LLM planner refines it when configured.
import type { ContentType, IntentType, LocationContext, ProviderId, RequestMode, SearchIntent, VisualizationKind } from "../shared/types.ts";

const URL_RE = /^(https?:\/\/)?([a-z0-9-]+\.)+[a-z]{2,}(:\d+)?(\/\S*)?$/i;

const SERVICE_RE = /\b(repair|repairs|technician|plumber|plumbing|electrician|mechanic|locksmith|cleaner|cleaning|installer|installation|hvac|handyman|contractor|servicing)\b/i;
const FOOD_RE = /\b(restaurants?|cafes?|caf[eé]|food|eat|eating|dinner|lunch|breakfast|brunch|biryani|kacchi|pizza|sushi|ramen|burgers?|tacos?|curry|bakery|bar|bars|pub|dumplings?|pho|takeaway|delivery)\b/i;
const PLACE_RE = /\b(hotels?|shops?|stores?|pharmac(y|ies)|gyms?|museums?|parks?|hospitals?|clinics?)\b/i;
const NEARBY_RE = /\b(near me|nearby|around me|close to me|near here|in my area|local)\b/i;
const NEWS_RE = /\b(news|today|latest|happening|breaking|this week|right now|headlines|update on|current events)\b/i;
const RESEARCH_RE = /\b(explain|how does|how do|why does|why do|what is|what are|research|papers?|study|studies|evidence|original sources?|science|theory|mechanism)\b/i;
const MEDIA_RE = /\b(images?|photos?|pictures?|videos?|watch|footage|gallery)\b/i;
const COMPARE_RE = /\b(compare|comparison|versus|vs\.?|which is better|best)\b/i;

const QUALITY_WORDS = ["reliable", "verified", "cheap", "affordable", "best", "top rated", "open now", "today", "fast", "family friendly", "halal", "vegetarian", "vegan"];

const FILLER = new Set(
  ("find show me tell give get a an the some any good great reliable verified nice please i want need looking for " +
    "near nearby me around close to here in my area local today now right that which who serve serves serving " +
    "and or compare comparison them those these it its with for of on about to explain how does do work works working " +
    "what is are why original sources source research papers paper study studies evidence the latest news happening " +
    "update updates on whats what's going than best top rated open cheap affordable fast can you could would " +
    "this week month year day days yesterday tonight recent recently currently " +
    "restaurants restaurant places place images image photos photo pictures picture videos video watch").split(/\s+/),
);

/** Dish and trade words survive even though they look like filler for other intents. */
const KEEP_FOR_LOCAL = new Set(["repair", "technician", "service"]);

export function normalizeQuery(q: string): string {
  return q
    .normalize("NFKC")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractPlaceHint(q: string): string | null {
  // "in Dhanmondi", "near Gulshan 2", "around Brooklyn" — but not "near me"
  const m = q.match(/\b(?:in|near|around|at)\s+(?!me\b|my\b|here\b|the\b|a\b|an\b|today\b|town\b)([A-Z][\p{L}\d'’.-]*(?:[ ,]+[A-Z\d][\p{L}\d'’.-]*){0,3})/u);
  return m ? m[1].replace(/[,\s]+$/, "") : null;
}

export function extractTopic(q: string, intentType: IntentType, placeHint: string | null): string {
  let text = q.toLowerCase();
  if (placeHint && intentType !== "news") text = text.replace(placeHint.toLowerCase(), " ");
  text = text.replace(/\bair[- ]?condition(er|ing)s?\b/g, "ac").replace(/\ba\/c\b/g, "ac");
  const words = text.replace(/[^\p{L}\p{N}\s'-]/gu, " ").split(/\s+/).filter(Boolean);
  const local = intentType === "local_service";
  const kept = words.filter((w) => !FILLER.has(w) || (local && KEEP_FOR_LOCAL.has(w)));
  // Strip trailing role words that don't describe the subject ("ac repair technician" → "ac repair")
  while (kept.length > 1 && /^(technicians?|services?|providers?|companies|company|shops?)$/.test(kept[kept.length - 1])) kept.pop();
  return kept.join(" ").trim() || words.slice(0, 4).join(" ");
}

export function classify(q: string): IntentType {
  const s = q.trim();
  if (!/\s/.test(s) && URL_RE.test(s)) return "url";
  if (SERVICE_RE.test(s) && (NEARBY_RE.test(s) || /\b(technician|plumber|electrician|mechanic|locksmith|handyman|contractor)\b/i.test(s))) return "local_service";
  if ((FOOD_RE.test(s) || PLACE_RE.test(s)) && (NEARBY_RE.test(s) || /\b(restaurants?|cafes?|serves?|to eat)\b/i.test(s) || extractPlaceHint(s))) return "local_place";
  if (MEDIA_RE.test(s)) return "media";
  if (NEWS_RE.test(s) && !/\b(explain|how does|paper)\b/i.test(s)) return "news";
  if (RESEARCH_RE.test(s)) return "research";
  return "explore";
}

const PLAN: Record<IntentType, { mode: RequestMode; content: ContentType[]; providers: ProviderId[]; viz: VisualizationKind; quality: string }> = {
  research: { mode: "understand", content: ["encyclopedia", "paper", "web"], providers: ["wikipedia", "openalex", "arxiv", "brave"], viz: "evidence", quality: "Prefer primary research (preprints, journals) and reference works; label preprints." },
  news: { mode: "discover", content: ["news", "encyclopedia"], providers: ["currents", "gdelt", "brave", "wikipedia"], viz: "timeline", quality: "Original publishers with publication dates; show several outlets." },
  local_service: { mode: "act", content: ["place", "web"], providers: ["osm", "brave"], viz: "comparison", quality: "Listed businesses only; never infer availability, ratings or prices." },
  local_place: { mode: "discover", content: ["place", "web"], providers: ["osm", "brave"], viz: "map", quality: "Listed venues only; distances computed from the user-approved location." },
  media: { mode: "discover", content: ["image", "video", "encyclopedia"], providers: ["brave", "wikipedia"], viz: "media", quality: "Show the page each image or video comes from." },
  url: { mode: "discover", content: ["web"], providers: [], viz: "reading", quality: "Fetch only the requested page, honoring robots.txt." },
  explore: { mode: "discover", content: ["encyclopedia", "web", "paper"], providers: ["wikipedia", "brave", "openalex"], viz: "clusters", quality: "Broad, reputable overview first." },
};

export function planIntent(
  rawQuery: string,
  location?: { lat: number; lon: number; label?: string; source: "user_supplied" | "device" },
  depth: SearchIntent["requestedDepth"] = "standard",
): SearchIntent {
  const query = normalizeQuery(rawQuery);
  const intentType = classify(query);
  const placeHint = intentType === "local_place" || intentType === "local_service" || intentType === "news" ? extractPlaceHint(query) : null;
  const topic = intentType === "url" ? query : extractTopic(query, intentType, placeHint);
  const plan = PLAN[intentType];
  const lower = query.toLowerCase();
  const qualities = QUALITY_WORDS.filter((w) => lower.includes(w));
  const time: SearchIntent["constraints"]["time"] = /\b(today|right now|tonight|breaking)\b/i.test(query) ? "today" : NEWS_RE.test(query) ? "recent" : "any";

  const isLocal = intentType === "local_place" || intentType === "local_service";
  const locationContext: LocationContext = location
    ? { needed: isLocal, source: location.source, label: location.label, lat: location.lat, lon: location.lon }
    : { needed: isLocal && !placeHint, source: "none", label: placeHint ?? undefined };

  let viz = plan.viz;
  if (intentType === "local_place" && COMPARE_RE.test(query)) viz = "comparison";

  const searchQueries = [
    intentType === "research" ? topic : intentType === "url" ? query : query,
    ...(intentType === "research" && topic !== query ? [`${topic} review`] : []),
    ...(intentType === "news" && placeHint ? [`${placeHint} news`] : []),
  ].slice(0, 4);

  return {
    query,
    normalizedQuery: lower,
    intentType,
    mode: plan.mode,
    constraints: { time, topic, qualities, placeHint },
    locationContext,
    requestedContentTypes: plan.content,
    requestedDepth: depth,
    searchQueries,
    providers: plan.providers,
    sourceQuality: plan.quality,
    expectedOutput: viz,
    plannedBy: "rules",
  };
}
