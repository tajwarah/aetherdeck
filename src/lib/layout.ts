// Pure layout: positions information nodes in world space for each visualization.
// World units are CSS pixels at camera scale 1; (0,0) is the center of the environment.
import type { EnvironmentModel, InformationNode, SearchResult } from "../../shared/types.ts";

export interface Pt { x: number; y: number }
export interface Bounds { minX: number; minY: number; maxX: number; maxY: number }
export interface Layout {
  pos: Record<string, Pt & { angle?: number }>;
  bounds: Bounds;
  /** What the first view should frame, when that is less than everything (outer rings stay to be explored). */
  focusBounds?: Bounds;
  /** Timeline day ticks */
  ticks?: { x: number; label: string }[];
  /** Map: kilometres → world units, rings to draw, and where the map sits */
  map?: { center: Pt; unitsPerKm: number; rings: number[]; radius: number };
  /** Cluster group label positions */
  groups?: { label: string; x: number; y: number; count: number }[];
  /** Mind map: the branches around the question, each with its leaves (findings and sites) in order. */
  branches?: Branch[];
}

export interface Branch { id: string; label: string; side: 1 | -1; hue: number; leaves: string[]; subtopic?: string }


function boundsOf(points: Pt[], pad: { x: number; y: number }): Bounds {
  if (!points.length) return { minX: -400, minY: -300, maxX: 400, maxY: 300 };
  return {
    minX: Math.min(...points.map((p) => p.x)) - pad.x,
    minY: Math.min(...points.map((p) => p.y)) - pad.y,
    maxX: Math.max(...points.map((p) => p.x)) + pad.x,
    maxY: Math.max(...points.map((p) => p.y)) + pad.y,
  };
}

export function layoutTimeline(nodes: InformationNode[]): Layout {
  const pos: Layout["pos"] = { root: { x: 0, y: -520 } };
  const dated = nodes.filter((n) => n.visualizationHints.time && n.id !== "root").sort((a, b) => Date.parse(a.visualizationHints.time!) - Date.parse(b.visualizationHints.time!));
  const undated = nodes.filter((n) => !n.visualizationHints.time && n.id !== "root");
  const width = Math.max(1100, dated.length * 210);
  const t0 = dated.length ? Date.parse(dated[0].visualizationHints.time!) : 0;
  const t1 = dated.length ? Date.parse(dated[dated.length - 1].visualizationHints.time!) : 1;
  const span = Math.max(1, t1 - t0);
  let prevX = -Infinity;
  const xs: number[] = [];
  dated.forEach((n) => {
    let x = -width / 2 + ((Date.parse(n.visualizationHints.time!) - t0) / span) * width;
    x = Math.max(x, prevX + 120); // never stack two headlines on the same spot
    xs.push(x);
    prevX = x;
  });
  const shift = xs.length ? (xs[0] + xs[xs.length - 1]) / 2 : 0;
  dated.forEach((n, i) => {
    const above = i % 2 === 0;
    const level = Math.floor(i / 2) % 3;
    pos[n.id] = { x: xs[i] - shift, y: (above ? -1 : 1) * (150 + level * 135) };
  });
  undated.forEach((n, i) => {
    pos[n.id] = { x: -width / 2 - shift - 420, y: i * 170 - ((undated.length - 1) * 170) / 2 };
  });
  // Day ticks
  const ticks: Layout["ticks"] = [];
  if (dated.length) {
    const seen = new Set<string>();
    dated.forEach((n, i) => {
      const day = n.visualizationHints.time!.slice(0, 10);
      if (seen.has(day)) return;
      seen.add(day);
      ticks.push({ x: xs[i] - shift - 40, label: new Date(`${day}T12:00:00Z`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) });
    });
  }
  return { pos, ticks, bounds: boundsOf(Object.values(pos), { x: 220, y: 120 }) };
}

/** Equirectangular projection around an origin; fine at neighbourhood scale. */
export function projectKm(origin: { lat: number; lon: number }, p: { lat: number; lon: number }) {
  const kx = 111.32 * Math.cos((origin.lat * Math.PI) / 180);
  return { x: (p.lon - origin.lon) * kx, y: -(p.lat - origin.lat) * 110.57 };
}

export const COMPARE_COLUMNS = 4;
export const COMPARE_COL_W = 180;
export const COMPARE_LABEL_W = 104;

export function layoutPlaces(model: EnvironmentModel): Layout {
  const { lat, lon } = model.intent.locationContext;
  const origin = lat !== undefined && lon !== undefined ? { lat, lon } : null;
  const places = model.nodes.filter((n) => n.nodeType === "place");
  const comparison = model.visualization === "comparison";
  const radius = comparison ? 200 : 300;
  const center = { x: 0, y: 0 };
  const kms = places.map((n) => (origin && n.visualizationHints.lat !== undefined ? projectKm(origin, { lat: n.visualizationHints.lat, lon: n.visualizationHints.lon! }) : { x: 0, y: 0 }));
  const maxKm = Math.max(0.5, ...kms.map((k) => Math.hypot(k.x, k.y)));
  const niceMax = [0.5, 1, 2, 3, 5, 8, 12, 20].find((r) => r >= maxKm) ?? Math.ceil(maxKm);
  const unitsPerKm = radius / niceMax;
  const rings = [0.25, 0.5, 1, 2, 3, 5, 8, 12, 20].filter((r) => r <= niceMax && r * unitsPerKm >= 50).slice(-3);
  const pos: Layout["pos"] = { root: { ...center } };
  const placed: Pt[] = [];
  places.forEach((n, i) => {
    let p = { x: center.x + kms[i].x * unitsPerKm, y: center.y + kms[i].y * unitsPerKm };
    // Listings at (nearly) the same spot fan out around it so every pin stays clickable.
    const twins = placed.filter((q) => Math.hypot(q.x - p.x, q.y - p.y) < 22).length;
    if (twins) p = { x: p.x + Math.cos(twins * 2.1) * 24, y: p.y + Math.sin(twins * 2.1) * 24 };
    placed.push(p);
    pos[`dot:${n.id}`] = p;
  });
  const pts: Pt[] = [{ x: center.x - radius, y: center.y - radius - 40 }, { x: center.x + radius, y: center.y + radius + 60 }];
  if (comparison) {
    // One table, to the right of the map: columns are places, rows are attributes.
    const cols = Math.min(COMPARE_COLUMNS, places.length);
    const width = (COMPARE_LABEL_W + cols * COMPARE_COL_W + 16) * 1.3; // drawn at up to 1.3× (--lc)
    pos.table = { x: center.x + radius + 70 + width / 2, y: 0 };
    pts.push({ x: center.x + radius + 70 + width, y: -300 }, { x: center.x + radius + 70 + width, y: 300 });
  } else {
    const cols = 2;
    places.slice(0, 8).forEach((n, i) => {
      const p = { x: center.x + radius + 290 + (i % cols) * 410, y: -radius + 90 + Math.floor(i / cols) * 210 };
      pos[n.id] = p;
      pts.push(p);
    });
  }
  return { pos, map: { center, unitsPerKm, rings, radius }, bounds: boundsOf(pts, { x: 140, y: 110 }) };
}

export function layoutMedia(nodes: InformationNode[]): Layout {
  const pos: Layout["pos"] = { root: { x: 0, y: -360 } };
  const items = nodes.filter((n) => n.id !== "root");
  const cols = Math.min(5, Math.max(2, Math.ceil(Math.sqrt(items.length * 1.6))));
  items.forEach((n, i) => {
    pos[n.id] = { x: ((i % cols) - (cols - 1) / 2) * 290, y: Math.floor(i / cols) * 270 - 120 };
  });
  return { pos, bounds: boundsOf(Object.values(pos), { x: 180, y: 160 }) };
}

export function layoutReading(nodes: InformationNode[]): Layout {
  const pos: Layout["pos"] = { root: { x: 0, y: -380 } };
  nodes.filter((n) => n.id !== "root").forEach((n, i) => (pos[n.id] = { x: 0, y: 40 + i * 400 }));
  return { pos, bounds: { minX: -420, minY: -480, maxX: 420, maxY: 520 } };
}

// ---------- the mind map ----------

/** Branch colours: warm, quiet hues that sit in the pearl-and-gold room. */
export const BRANCH_HUES = [38, 352, 160, 220, 280, 18, 190, 60];
const BX = 430; // question → branch (the question is drawn up to 1.9× when zoomed out, see --ls)
const LX = 820; // question → leaves
// Room per leaf: cards are drawn at up to 1.3× (see --lc), and a finding's three lines stand taller than a site.
const SITE_H = 112;
const FINDING_H = 150;
const BLOCK_GAP = 56;
const MAX_LEAVES = 6;

const FORUM = /(^|\.)(reddit\.com|quora\.com|stackoverflow\.com|stackexchange\.com|news\.ycombinator\.com|discourse\.|forum|forums\.)/;
/** What kind of site a result is, for grouping when no AI has organized them. Exported for tests. */
export function kindOfSite(s: SearchResult): string {
  if (s.contentType === "paper") return "Research";
  if (s.contentType === "encyclopedia") return "Reference";
  if (s.contentType === "news") return "News";
  if (s.contentType === "video" || /(^|\.)(youtube\.com|youtu\.be|vimeo\.com)$/.test(s.domain)) return "Video";
  if (s.publisher?.startsWith("Forum") || s.sourceProvider === "stackexchange" || FORUM.test(s.domain)) return "Discussions";
  return "Websites";
}
const KIND_ORDER = ["Websites", "News", "Discussions", "Research", "Video", "Reference"];

/**
 * A mind map: the question in the middle, branches to either side, and on each branch its findings and then
 * the sites themselves. With an AI evidence map the branches are its sub-questions and each site hangs on the
 * branch that cites it most; otherwise (and for sites nobody cited) branches are kinds of site. Pure.
 */
export function layoutMindMap(model: EnvironmentModel): Layout {
  const sourceOf = new Map(model.sources.map((s) => [s.id, s]));
  const subs = model.nodes.filter((n) => n.nodeType === "subtopic");
  const findings = model.nodes.filter((n) => n.nodeType === "finding" || n.nodeType === "gap");
  const sites = model.nodes.filter((n) => (n.nodeType === "source" || n.nodeType === "event") && sourceOf.has(n.sourceIds[0]));
  const parentOf = new Map(findings.map((f) => [f.id, f.parentId]));
  const raw: Omit<Branch, "side" | "hue">[] = subs.map((s) => ({ id: s.id, label: s.title, subtopic: s.id, leaves: findings.filter((f) => f.parentId === s.id).map((f) => f.id) }));
  const placed = new Set<string>();
  for (const site of sites) {
    // the branch whose findings cite this site most
    const votes = new Map<string, number>();
    for (const r of site.relatedNodeIds) { const b = parentOf.get(r); if (b) votes.set(b, (votes.get(b) ?? 0) + 1); }
    const best = [...votes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    const branch = best && raw.find((b) => b.id === best);
    if (branch && branch.leaves.length < MAX_LEAVES + 3) { branch.leaves.push(site.id); placed.add(site.id); }
  }
  const byKind = new Map<string, string[]>();
  for (const site of sites) {
    if (placed.has(site.id)) continue;
    const k = kindOfSite(sourceOf.get(site.sourceIds[0])!);
    byKind.set(k, [...(byKind.get(k) ?? []), site.id]);
  }
  for (const k of [...byKind.keys()].sort((a, b) => KIND_ORDER.indexOf(a) - KIND_ORDER.indexOf(b))) {
    const ids = byKind.get(k)!;
    for (let i = 0; i < ids.length; i += MAX_LEAVES) {
      raw.push({ id: `kind:${k}:${i}`, label: i ? `More ${k.toLowerCase()}` : k, leaves: ids.slice(i, i + MAX_LEAVES) });
    }
  }
  const isFinding = new Set(findings.map((f) => f.id));
  const leafH = (id: string) => (isFinding.has(id) ? FINDING_H : SITE_H);
  const blockH = (b: { leaves: string[] }) => Math.max(SITE_H, b.leaves.reduce((t, id) => t + leafH(id), 0)) + BLOCK_GAP;
  // Balance the two sides by height: each branch goes to the shorter side, right first.
  const sideH = { 1: 0, [-1]: 0 } as Record<1 | -1, number>;
  const branches: Branch[] = raw.map((b, i) => {
    const side: 1 | -1 = sideH[1] <= sideH[-1] ? 1 : -1;
    sideH[side] += blockH(b);
    return { ...b, side, hue: BRANCH_HUES[i % BRANCH_HUES.length] };
  });
  const pos: Layout["pos"] = { root: { x: 0, y: 0 } };
  for (const side of [1, -1] as const) {
    const mine = branches.filter((b) => b.side === side);
    let y = -sideH[side] / 2;
    for (const b of mine) {
      const h = blockH(b);
      const cy = y + h / 2;
      pos[b.id] = { x: side * BX, y: Math.round(cy * 0.92) };
      let ly = cy - b.leaves.reduce((t, id) => t + leafH(id), 0) / 2;
      for (const id of b.leaves) { pos[id] = { x: side * LX, y: Math.round(ly + leafH(id) / 2) }; ly += leafH(id); }
      y += h;
    }
  }
  const pts = Object.values(pos);
  return { pos, branches, bounds: boundsOf(pts, { x: 200, y: 130 }) };
}

export function layoutFor(model: EnvironmentModel): Layout {
  switch (model.visualization) {
    case "evidence":
    case "clusters": return layoutMindMap(model);
    case "timeline": return layoutTimeline(model.nodes);
    case "map":
    case "comparison": return layoutPlaces(model);
    case "media": return layoutMedia(model.nodes);
    case "reading": return layoutReading(model.nodes);
    default: return layoutMindMap(model);
  }
}

/** Camera that fits bounds into a viewport, never zooming in past `maxScale`. */
export function fitCamera(b: Bounds, vw: number, vh: number, maxScale = 1) {
  const w = b.maxX - b.minX;
  const h = b.maxY - b.minY;
  const s = Math.min(maxScale, (vw * 0.92) / w, (vh * 0.86) / h);
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  return { s, x: vw / 2 - cx * s, y: vh / 2 - cy * s };
}

export function sourceFor(model: EnvironmentModel, node: InformationNode): SearchResult | undefined {
  return model.sources.find((s) => s.id === node.sourceIds[0]);
}
