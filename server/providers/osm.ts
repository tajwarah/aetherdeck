// OpenStreetMap: Nominatim for geocoding, Overpass for nearby places.
// Keyless and community-run, so requests are user-triggered, cached, and spread across public mirrors.
// OSM has no ratings, menus, prices or live availability — results say so instead of inventing them.
import { z } from "zod/v4";
import type { Provider, ProviderQuery } from "./types.ts";
import type { PlaceDetails, SearchResult } from "../../shared/types.ts";
import { fetchJson, fetchWithTimeout, ProviderError, stableId, domainOf } from "../http.ts";
import { TtlCache } from "../cache.ts";

const OVERPASS_MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

/** Dishes and the OSM cuisine tags that plausibly serve them. */
const RELATED_CUISINES: Record<string, string[]> = {
  biryani: ["biryani", "bangladeshi", "indian", "pakistani", "hyderabadi", "mughlai", "bengali"],
  kacchi: ["biryani", "bangladeshi", "bengali", "indian", "mughlai"],
  curry: ["indian", "bangladeshi", "pakistani", "thai", "curry"],
  pizza: ["pizza", "italian"],
  sushi: ["sushi", "japanese"],
  ramen: ["ramen", "japanese", "noodle"],
  taco: ["mexican", "tex-mex", "taco"],
  burger: ["burger", "american"],
  dumpling: ["chinese", "dumpling"],
  pho: ["vietnamese", "pho"],
};

/** Trades and the OSM tags used for them. */
const SERVICE_TAGS: { match: RegExp; craft: string[]; shop: string[]; name: string }[] = [
  { match: /\b(ac|a\/c|air ?con\w*|hvac|cooling|heat pump|refrigerat\w*)\b/i, craft: ["hvac", "refrigeration"], shop: ["hvac", "air_conditioning", "appliance"], name: "(^| )(A/?C|HVAC)( |$)|air[ -]?con|cooling|refrigerat|heat ?pump" },
  { match: /\bplumb/i, craft: ["plumber"], shop: [], name: "plumb" },
  { match: /\belectric/i, craft: ["electrician"], shop: [], name: "electric" },
  { match: /\blocksmith|lock/i, craft: ["locksmith"], shop: ["locksmith"], name: "locksmith" },
  { match: /\b(mechanic|car repair|garage)/i, craft: [], shop: ["car_repair"], name: "auto|motor|garage" },
  { match: /\b(phone|laptop|computer|electronics?) repair/i, craft: [], shop: ["mobile_phone", "computer", "electronics_repair"], name: "repair" },
];

/** Case-insensitive pattern for business names that fit a trade, e.g. "ac repair" → air-con / refrigeration names. */
export function serviceNamePattern(topic: string): RegExp | null {
  const svc = SERVICE_TAGS.find((s) => s.match.test(topic));
  return svc ? new RegExp(svc.name, "i") : null;
}

const Element = z.object({
  type: z.string(),
  id: z.number(),
  lat: z.number().optional(),
  lon: z.number().optional(),
  center: z.object({ lat: z.number(), lon: z.number() }).optional(),
  tags: z.record(z.string(), z.string()).optional(),
});
const OverpassResponse = z.object({ elements: z.array(Element) });

export function haversineKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

const esc = (s: string) => s.replace(/["\\]/g, "");

export function buildOverpassQuery(q: ProviderQuery): { query: string; topicWords: string[]; related: string[] } {
  const { lat, lon } = q.location!;
  const r = Math.round((q.radiusKm ?? 3) * 1000);
  const around = `(around:${r},${lat.toFixed(5)},${lon.toFixed(5)})`;
  const topicWords = q.topic.toLowerCase().split(/\s+/).filter((w) => w.length > 2 && !/^(food|restaurants?|places?|repair|service|technician|near|best)$/.test(w));

  if (q.placeKind === "service") {
    const svc = SERVICE_TAGS.find((s) => s.match.test(q.topic)) ?? { craft: [], shop: [], name: topicWords.join("|") || "repair" };
    const parts = [
      svc.craft.length ? `nwr["craft"~"^(${svc.craft.join("|")})$"]${around};` : "",
      svc.shop.length ? `nwr["shop"~"^(${svc.shop.join("|")})$"]${around};` : "",
      svc.name ? `nwr["name"~"${esc(svc.name)}",i]["shop"]${around};nwr["name"~"${esc(svc.name)}",i]["craft"]${around};nwr["name"~"${esc(svc.name)}",i]["office"]${around};` : "",
    ].join("");
    return { query: `[out:json][timeout:15];(${parts});out center tags 60;`, topicWords, related: [] };
  }

  const related = [...new Set(topicWords.flatMap((w) => RELATED_CUISINES[w] ?? [w]))];
  const amenity = `["amenity"~"^(restaurant|fast_food|food_court|cafe)$"]`;
  const body = topicWords.length
    ? `nwr${amenity}["cuisine"~"${esc(related.join("|"))}",i]${around};nwr${amenity}["name"~"${esc(topicWords.join("|"))}",i]${around};`
    : `nwr${amenity}${around};`;
  return { query: `[out:json][timeout:15];(${body});out center tags 60;`, topicWords, related };
}

function describe(tags: Record<string, string>) {
  return (tags.cuisine ?? tags.craft ?? tags.shop ?? tags.amenity ?? "").replace(/_/g, " ").replace(/;/g, ", ");
}

export function normalizeElements(elements: z.infer<typeof Element>[], q: ProviderQuery, topicWords: string[], related: string[]) {
  const origin = q.location!;
  const retrievedAt = new Date().toISOString();
  const texts: Record<string, string> = {};
  const seen = new Set<string>();
  const scored = elements.flatMap((el) => {
    const tags = el.tags ?? {};
    const name = tags.name ?? tags["name:en"];
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (!name || lat === undefined || lon === undefined) return [];
    const dedupeKey = `${name.toLowerCase()}|${lat.toFixed(3)}|${lon.toFixed(3)}`;
    if (seen.has(dedupeKey)) return [];
    seen.add(dedupeKey);

    const distanceKm = Math.round(haversineKm(origin, { lat, lon }) * 100) / 100;
    const cuisine = (tags.cuisine ?? "").toLowerCase();
    const lname = name.toLowerCase();
    const directName = topicWords.some((w) => lname.includes(w));
    const directCuisine = topicWords.some((w) => cuisine.split(/[;,]/).includes(w));
    const relatedCuisine = related.find((c) => cuisine.includes(c));
    const match = directName ? 3 : directCuisine ? 2.5 : relatedCuisine ? 1 : q.placeKind === "service" ? 2 : 0.5;
    const score = match - distanceKm * 0.15;

    const limitations = [
      "Listing from OpenStreetMap contributors — may be incomplete or out of date.",
      "No ratings, prices, menus or live availability in this source.",
    ];
    if (q.placeKind === "food" && topicWords.length && !directName && !directCuisine && relatedCuisine) {
      limitations.unshift(`Matched by cuisine “${relatedCuisine}”; whether it serves ${topicWords.join(" ")} is not verified.`);
    }
    if (tags.opening_hours) limitations.push("Opening hours are as listed, not confirmed for today.");

    const website = tags.website ?? tags["contact:website"];
    const osmUrl = `https://www.openstreetmap.org/${el.type}/${el.id}`;
    const address = [tags["addr:housenumber"], tags["addr:street"], tags["addr:suburb"] ?? tags["addr:city"]].filter(Boolean).join(" ");
    const place: PlaceDetails = {
      lat, lon, distanceKm, osmUrl,
      address: address || undefined,
      phone: tags.phone ?? tags["contact:phone"] ?? tags["contact:mobile"],
      email: tags.email ?? tags["contact:email"],
      website,
      openingHours: tags.opening_hours,
      cuisine: tags.cuisine?.replace(/;/g, ", ").replace(/_/g, " "),
      category: describe(tags),
    };
    const id = stableId("osm", `${el.type}/${el.id}`);
    const facts = [
      place.category && `Listed as ${place.category}.`,
      `About ${distanceKm.toFixed(1)} km from the search point (straight line).`,
      place.address && `Address: ${place.address}.`,
      place.openingHours && `Opening hours listed: ${place.openingHours}.`,
      place.phone ? `Phone listed.` : `No phone number listed.`,
    ].filter(Boolean).join(" ");
    texts[id] = facts;
    const result: SearchResult = {
      id,
      title: name,
      canonicalUrl: website && /^https?:\/\//.test(website) ? website : osmUrl,
      domain: website ? domainOf(website) || "openstreetmap.org" : "openstreetmap.org",
      publisher: "OpenStreetMap contributors",
      contentType: "place",
      snippet: facts,
      retrievedAt,
      sourceProvider: "osm",
      freshnessStatus: "live",
      place,
      limitations,
    };
    return [{ result, score }];
  });
  scored.sort((a, b) => b.score - a.score);
  const results = scored.slice(0, q.limit).map((s) => s.result);
  return { results, texts: Object.fromEntries(results.map((r) => [r.id, texts[r.id]])) };
}

/**
 * Public Overpass servers are often queued for many seconds. Mirrors are raced and the losers cancelled,
 * so the person waits for the fastest healthy server rather than for each one in turn.
 */
async function overpass(query: string) {
  const ctrl = new AbortController();
  const attempts = OVERPASS_MIRRORS.map(async (url) => {
    const res = await fetchWithTimeout(url, { method: "POST", body: new URLSearchParams({ data: query }), timeoutMs: 22_000, signal: ctrl.signal });
    if (!res.ok) throw new ProviderError(res.status === 429 ? "rate_limited" : "http", `${new URL(url).host} answered ${res.status}`);
    const parsed = OverpassResponse.safeParse(await res.json().catch(() => null));
    if (!parsed.success) throw new ProviderError("bad_response", `${new URL(url).host} sent an unexpected response`);
    return parsed.data;
  });
  try {
    return await Promise.any(attempts);
  } catch (err) {
    const first = (err as AggregateError).errors?.find((e) => e instanceof ProviderError) as ProviderError | undefined;
    throw new ProviderError(first?.code ?? "network", `All OpenStreetMap servers are busy or unreachable${first ? ` (${first.message})` : ""}`);
  } finally {
    ctrl.abort();
  }
}

export const osm: Provider = {
  id: "osm",
  label: "OpenStreetMap",
  supports: ["place"],
  freshness: () => "places",
  available: () => true,
  async search(q) {
    if (!q.location) throw new ProviderError("location_required", "A location is needed for nearby places");
    let built = buildOverpassQuery(q);
    let data = await overpass(built.query);
    // Progressive widening: if the neighbourhood is sparse, look once more, further out.
    if (data.elements.filter((e) => e.tags?.name).length < 3 && (q.radiusKm ?? 3) < 8) {
      built = buildOverpassQuery({ ...q, radiusKm: 8 });
      data = await overpass(built.query);
    }
    return normalizeElements(data.elements, q, built.topicWords, built.related);
  },
};

// --- geocoding --------------------------------------------------------------

const Place = z.object({ lat: z.string(), lon: z.string(), display_name: z.string() });
const geoCache = new TtlCache<{ lat: number; lon: number; label: string } | null>(200);
let lastGeocode = 0;

export async function geocode(text: string): Promise<{ lat: number; lon: number; label: string } | null> {
  const key = text.trim().toLowerCase();
  const hit = geoCache.get(key);
  if (hit) return hit.value;
  // Nominatim policy: at most one request per second.
  const wait = lastGeocode + 1100 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastGeocode = Date.now();
  const raw = await fetchJson(`https://nominatim.openstreetmap.org/search?${new URLSearchParams({ q: text, format: "json", limit: "1", "accept-language": "en" })}`);
  const first = z.array(Place).parse(raw)[0];
  const value = first ? { lat: Number(first.lat), lon: Number(first.lon), label: first.display_name.split(",").slice(0, 3).join(",").trim() } : null;
  geoCache.set(key, value, "stable");
  return value;
}
