import type { ContentType, ProviderId, SearchResult } from "../../shared/types.ts";
import type { Freshness } from "../cache.ts";

export interface ProviderQuery {
  query: string;
  topic: string;
  kind: ContentType;
  limit: number;
  time?: "today" | "recent" | "any";
  location?: { lat: number; lon: number };
  /** For place searches: what we're looking for. */
  placeKind?: "food" | "service" | "general";
  radiusKm?: number;
}

/** What a provider hands back: normalized results plus private full text for evidence extraction. */
export interface ProviderOutput {
  results: SearchResult[];
  texts: Record<string, string>;
}

export interface Provider {
  id: Exclude<ProviderId, "direct">;
  label: string;
  /** Content types this provider can actually answer. */
  supports: ContentType[];
  freshness: (q: ProviderQuery) => Freshness;
  available: () => boolean;
  search: (q: ProviderQuery) => Promise<ProviderOutput>;
}
