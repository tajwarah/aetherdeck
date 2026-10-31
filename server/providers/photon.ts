// Photon (komoot) — fast full-text search over OpenStreetMap, bounded to a box around the person's location.
// Answers in about a second where Overpass can queue for twenty, so it gives the first view of nearby places;
// richer Overpass listings merge in when they arrive.
import { z } from "zod/v4";
import type { Provider, ProviderQuery } from "./types.ts";
import { fetchJson, ProviderError } from "../http.ts";
import { normalizeElements, serviceNamePattern } from "./osm.ts";

const Feature = z.object({
  geometry: z.object({ coordinates: z.tuple([z.number(), z.number()]) }),
  properties: z.object({
    osm_type: z.string(),
    osm_id: z.number(),
    osm_key: z.string().optional(),
    osm_value: z.string().optional(),
    name: z.string().optional(),
    street: z.string().optional(),
    housenumber: z.string().optional(),
    district: z.string().optional(),
    city: z.string().optional(),
  }),
});
const Response = z.object({ features: z.array(Feature) });

const FOOD_VALUES = new Set(["restaurant", "fast_food", "food_court", "cafe"]);
const SERVICE_KEYS = new Set(["craft", "shop", "office"]);

const SERVICE_SYNONYMS: [RegExp, string[]][] = [
  [/\b(ac|air ?con\w*|hvac|cooling)\b/i, ["air conditioner", "refrigeration", "air condition", "ac repair"]],
  [/plumb/i, ["plumber", "plumbing"]],
  [/electric/i, ["electrician", "electrical"]],
  [/lock/i, ["locksmith"]],
];

export function photonQueries(q: ProviderQuery): string[] {
  if (q.placeKind === "service") {
    return SERVICE_SYNONYMS.find(([re]) => re.test(q.topic))?.[1] ?? [q.topic];
  }
  const words = q.topic.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  return [...new Set([q.topic, ...words])].filter(Boolean).slice(0, 3);
}

export function bbox(lat: number, lon: number, km: number) {
  const dLat = km / 111;
  const dLon = km / (111 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
  return [lon - dLon, lat - dLat, lon + dLon, lat + dLat].map((n) => n.toFixed(4)).join(",");
}

export const photon: Provider = {
  id: "photon",
  label: "OpenStreetMap search",
  supports: ["place"],
  freshness: () => "places",
  available: () => true,
  async search(q) {
    if (!q.location) throw new ProviderError("location_required", "A location is needed for nearby places");
    const { lat, lon } = q.location;
    const box = bbox(lat, lon, Math.max(q.radiusKm ?? 3, 5));
    const settled = await Promise.allSettled(
      photonQueries(q).map(async (text) =>
        Response.parse(await fetchJson(`https://photon.komoot.io/api/?${new URLSearchParams({ q: text, lat: String(lat), lon: String(lon), limit: "20", bbox: box, lang: "en" })}`, { timeoutMs: 6000 })).features,
      ),
    );
    const features = settled.flatMap((s) => (s.status === "fulfilled" ? s.value : []));
    if (!features.length && settled.every((s) => s.status === "rejected")) {
      throw (settled[0] as PromiseRejectedResult).reason;
    }
    const elements = features
      // OSM tagging of small businesses is uneven (a repair shop may be tagged as a building), so for trades
      // the name decides; for food the amenity tag does.
      .filter((f) => {
        const { osm_key: key = "", osm_value: value = "", name = "" } = f.properties;
        if (q.placeKind !== "service") return key === "amenity" && FOOD_VALUES.has(value);
        const pattern = serviceNamePattern(q.topic);
        return pattern ? pattern.test(name) : SERVICE_KEYS.has(key);
      })
      .map((f) => ({
        type: ({ N: "node", W: "way", R: "relation" } as Record<string, string>)[f.properties.osm_type] ?? "node",
        id: f.properties.osm_id,
        lat: f.geometry.coordinates[1],
        lon: f.geometry.coordinates[0],
        tags: Object.fromEntries(
          Object.entries({
            name: f.properties.name,
            [f.properties.osm_key ?? "amenity"]: f.properties.osm_value,
            "addr:street": f.properties.street,
            "addr:housenumber": f.properties.housenumber,
            "addr:suburb": f.properties.district ?? f.properties.city,
          }).filter(([, v]) => v),
        ) as Record<string, string>,
      }));
    const topicWords = q.topic.toLowerCase().split(/\s+/).filter((w) => w.length > 2 && !/^(repair|service|technician)$/.test(w));
    const out = normalizeElements(elements, q, topicWords, []);
    for (const r of out.results) r.limitations = [...(r.limitations ?? []), "Found by name search; contact details may load from the full listing."];
    return out;
  },
};
