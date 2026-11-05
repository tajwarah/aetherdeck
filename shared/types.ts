// Conceptual contracts shared by the server and the client.
// Schemas validate anything crossing a trust boundary (requests, providers, the LLM).
import { z } from "zod/v4";

export const IntentType = z.enum([
  "research", // explain + original sources
  "news", // what is happening, recency matters
  "local_service", // a tradesperson or service near a place
  "local_place", // restaurants, shops, venues
  "media", // images / video
  "url", // a direct address
  "explore", // anything else: general discovery
]);
export type IntentType = z.infer<typeof IntentType>;

export const RequestMode = z.enum(["discover", "understand", "act"]);
export type RequestMode = z.infer<typeof RequestMode>;

export const ContentType = z.enum(["web", "news", "encyclopedia", "paper", "place", "image", "video"]);
export type ContentType = z.infer<typeof ContentType>;

export const VisualizationKind = z.enum(["evidence", "timeline", "map", "comparison", "clusters", "media", "reading"]);
export type VisualizationKind = z.infer<typeof VisualizationKind>;

export const ProviderId = z.enum(["wikipedia", "openalex", "arxiv", "gdelt", "currents", "osm", "photon", "brave", "tavily", "searxng", "browser", "hackernews", "stackexchange", "demo", "direct"]);
export type ProviderId = z.infer<typeof ProviderId>;

export const LocationContext = z.object({
  needed: z.boolean(),
  source: z.enum(["none", "user_supplied", "device"]),
  label: z.string().optional(),
  lat: z.number().min(-90).max(90).optional(),
  lon: z.number().min(-180).max(180).optional(),
});
export type LocationContext = z.infer<typeof LocationContext>;

export const SearchIntent = z.object({
  query: z.string(),
  normalizedQuery: z.string(),
  intentType: IntentType,
  mode: RequestMode,
  constraints: z.object({
    time: z.enum(["today", "recent", "any"]),
    topic: z.string(), // the subject stripped of filler ("kacchi biryani", "ac repair")
    qualities: z.array(z.string()), // "reliable", "cheap", "open now" …
    placeHint: z.string().nullable(), // a place named inside the query
  }),
  locationContext: LocationContext,
  requestedContentTypes: z.array(ContentType),
  requestedDepth: z.enum(["glance", "standard", "deep"]),
  searchQueries: z.array(z.string()).max(4),
  providers: z.array(ProviderId),
  sourceQuality: z.string(),
  expectedOutput: VisualizationKind,
  plannedBy: z.enum(["rules", "llm"]),
});
export type SearchIntent = z.infer<typeof SearchIntent>;

export const PlaceDetails = z.object({
  lat: z.number(),
  lon: z.number(),
  distanceKm: z.number().optional(),
  address: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  website: z.string().optional(),
  openingHours: z.string().optional(),
  cuisine: z.string().optional(),
  category: z.string().optional(),
  osmUrl: z.string().optional(),
});
export type PlaceDetails = z.infer<typeof PlaceDetails>;

export const SearchResult = z.object({
  id: z.string(),
  title: z.string(),
  canonicalUrl: z.string(),
  domain: z.string(),
  publisher: z.string().optional(),
  contentType: ContentType,
  snippet: z.string(),
  thumbnail: z.string().optional(),
  authors: z.array(z.string()).optional(),
  publicationDate: z.string().optional(), // ISO
  retrievedAt: z.string(), // ISO
  sourceProvider: ProviderId,
  freshnessStatus: z.enum(["live", "cached", "sample"]),
  place: PlaceDetails.optional(),
  limitations: z.array(z.string()).optional(),
});
export type SearchResult = z.infer<typeof SearchResult>;

export const EvidenceType = z.enum([
  "direct_excerpt", // verbatim text from the source
  "ai_summary", // model-written, grounded in cited sources
  "inference", // model reasoning beyond what sources state
  "conflict", // sources disagree
  "gap", // nothing found / unverified
]);
export type EvidenceType = z.infer<typeof EvidenceType>;

export const Evidence = z.object({
  id: z.string(),
  claim: z.string(),
  sourceIds: z.array(z.string()),
  supportingExcerpt: z.string().optional(),
  evidenceType: EvidenceType,
  confidenceOrLimitations: z.string(),
  subtopic: z.string().optional(),
});
export type Evidence = z.infer<typeof Evidence>;

export const NodeType = z.enum(["intent", "subtopic", "source", "place", "event", "finding", "gap"]);
export type NodeType = z.infer<typeof NodeType>;

export const InformationNode = z.object({
  id: z.string(),
  title: z.string(),
  nodeType: NodeType,
  parentId: z.string().nullable(),
  relatedNodeIds: z.array(z.string()),
  sourceIds: z.array(z.string()),
  summary: z.string().optional(),
  visualizationHints: z.object({
    group: z.string().optional(),
    weight: z.number(), // 0..1 importance
    time: z.string().optional(), // ISO, for timelines
    lat: z.number().optional(),
    lon: z.number().optional(),
  }),
});
export type InformationNode = z.infer<typeof InformationNode>;

export const StepStatus = z.enum(["pending", "running", "done", "skipped", "failed"]);

export const AgentTask = z.object({
  id: z.string(),
  status: z.enum(["planning", "running", "done", "failed", "awaiting_confirmation", "handed_off", "cancelled"]),
  objective: z.string(),
  steps: z.array(
    z.object({ id: z.string(), label: z.string(), status: StepStatus, detail: z.string().optional() }),
  ),
  toolCalls: z.array(
    z.object({
      provider: ProviderId,
      query: z.string(),
      status: z.enum(["ok", "error", "cached", "skipped"]),
      ms: z.number(),
      count: z.number(),
      note: z.string().optional(),
    }),
  ),
  requiresConfirmation: z.boolean(),
  result: z.string().optional(),
});
export type AgentTask = z.infer<typeof AgentTask>;

export const Notice = z.object({
  level: z.enum(["info", "warning", "error"]),
  code: z.string(),
  message: z.string(),
});
export type Notice = z.infer<typeof Notice>;

export const ActionOffer = z.object({
  id: z.string(),
  kind: z.enum(["open_source", "contact_provider", "prepare_reservation", "save", "directions"]),
  label: z.string(),
  targetSourceId: z.string().optional(),
  requiresConfirmation: z.boolean(),
});
export type ActionOffer = z.infer<typeof ActionOffer>;

/**
 * The answer to the question, written first and shown in the middle of the map. Every sentence names the
 * sources it rests on; a sentence with none is never shown. "ai" when a model wrote it from the sources,
 * "extract" when it is the best sentences of the sources themselves, verbatim.
 */
export const Answer = z.object({
  sentences: z.array(z.object({ text: z.string(), sourceIds: z.array(z.string()).min(1) })),
  by: z.enum(["ai", "extract"]),
  model: z.string().optional(),
});
export type Answer = z.infer<typeof Answer>;

/** The whole spatial environment for one intent. Sent progressively; later snapshots replace earlier ones. */
export const EnvironmentModel = z.object({
  id: z.string(),
  intent: SearchIntent,
  visualization: VisualizationKind,
  dataMode: z.enum(["live", "sample", "mixed", "none"]),
  synthesisMode: z.enum(["extractive", "ai", "pending"]),
  answer: Answer.optional(),
  nodes: z.array(InformationNode),
  sources: z.array(SearchResult),
  evidence: z.array(Evidence),
  actions: z.array(ActionOffer),
  notices: z.array(Notice),
  task: AgentTask,
  complete: z.boolean(),
});
export type EnvironmentModel = z.infer<typeof EnvironmentModel>;

export const ExploreRequest = z.object({
  query: z.string().trim().min(1).max(400),
  location: z
    .object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180), label: z.string().max(200).optional(), source: z.enum(["user_supplied", "device"]) })
    .optional(),
  depth: z.enum(["glance", "standard", "deep"]).optional(),
  /** Narrow follow-up inside an existing environment ("go deeper" on a node). */
  parentQuery: z.string().max(400).optional(),
  /** Desktop app: what the person's own search engine showed for this question, in a window they could see. */
  found: z.object({
    engine: z.enum(["google", "bing", "duckduckgo"]),
    hits: z.array(z.object({ url: z.string().max(2000), title: z.string().max(400), snippet: z.string().max(800), site: z.string().max(200).optional(), age: z.string().max(60).optional() })).max(40),
  }).optional(),
});
export type ExploreRequest = z.infer<typeof ExploreRequest>;

export type StreamEvent =
  | { type: "model"; model: EnvironmentModel }
  | { type: "error"; message: string };

export const ActionDraftRequest = z.object({
  kind: z.enum(["contact_provider", "prepare_reservation"]),
  source: SearchResult,
  details: z.object({
    need: z.string().max(600),
    when: z.string().max(120),
    partySize: z.number().int().min(1).max(30).optional(),
    name: z.string().max(80).optional(),
  }),
});
export type ActionDraftRequest = z.infer<typeof ActionDraftRequest>;

export const ActionDraft = z.object({
  taskId: z.string(),
  subject: z.string(),
  body: z.string(),
  channels: z.array(
    z.object({ kind: z.enum(["phone", "email", "website", "map"]), label: z.string(), href: z.string() }),
  ),
  missing: z.array(z.string()),
  draftedBy: z.enum(["template", "llm"]),
  task: AgentTask,
});
export type ActionDraft = z.infer<typeof ActionDraft>;
