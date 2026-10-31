// Turning the globe cheaply. Every point on it is kept as the sines and cosines of its longitude and latitude,
// so one frame's view costs a few multiplications per point instead of d3's projection stream and a great-circle
// distance. Matches d3-geo's orthographic projection rotated by [-lon, -lat] (tests/unit/globe.test.ts).
import { geoDistance, geoInterpolate } from "d3-geo";

const RAD = Math.PI / 180;

/** Points as [lon, lat] in degrees, packed as cos λ, sin λ, cos φ, sin φ. */
export function onSphere(points: readonly (readonly [number, number])[]): Float64Array {
  const out = new Float64Array(points.length * 4);
  points.forEach(([lon, lat], i) => {
    out[i * 4] = Math.cos(lon * RAD);
    out[i * 4 + 1] = Math.sin(lon * RAD);
    out[i * 4 + 2] = Math.cos(lat * RAD);
    out[i * 4 + 3] = Math.sin(lat * RAD);
  });
  return out;
}

export interface View { cl: number; sl: number; cp: number; sp: number; R: number; cx: number; cy: number }

/** Looking down at [lon, lat], the globe of radius R centred on (cx, cy). */
export function view(lon: number, lat: number, R: number, cx: number, cy: number): View {
  return { cl: Math.cos(-lon * RAD), sl: Math.sin(-lon * RAD), cp: Math.cos(-lat * RAD), sp: Math.sin(-lat * RAD), R, cx, cy };
}

/**
 * Projects every point of `s` into `out` (three numbers each): screen x, screen y, and how squarely it faces the
 * viewer, the cosine of its distance from the centre of the view (1 at the centre, 0 at the horizon, below 0 hidden).
 */
export function project(s: Float64Array, v: View, out: Float32Array) {
  const { cl, sl, cp, sp, R, cx, cy } = v;
  for (let i = 0, j = 0, k = 0; j < s.length; i++, j += 4, k += 3) {
    const cosL = s[j] * cl - s[j + 1] * sl;
    const sinL = s[j + 1] * cl + s[j] * sl;
    const x = cosL * s[j + 2];
    const z = s[j + 3];
    out[k] = cx + R * sinL * s[j + 2];
    out[k + 1] = cy - R * (z * cp + x * sp);
    out[k + 2] = x * cp - z * sp;
  }
}

type Line = [number, number][];
/** Every ring or line of a GeoJSON shape, grouped by polygon (a line is a group of one). */
function linesOf(g: { type: string; coordinates?: unknown; geometries?: unknown[]; features?: unknown[]; geometry?: unknown }): Line[][] {
  if (g.type === "FeatureCollection") return (g.features as typeof g[]).flatMap(linesOf);
  if (g.type === "Feature") return linesOf(g.geometry as typeof g);
  if (g.type === "GeometryCollection") return (g.geometries as typeof g[]).flatMap(linesOf);
  if (g.type === "LineString") return [[g.coordinates as Line]];
  if (g.type === "MultiLineString") return (g.coordinates as Line[]).map((l) => [l]);
  if (g.type === "Polygon") return [g.coordinates as Line[]];
  if (g.type === "MultiPolygon") return g.coordinates as Line[][];
  return [];
}

/** A shape on the sphere, every step at most a degree long, so its edges follow great circles like d3 draws them. */
export function shape(g: Parameters<typeof linesOf>[0]) {
  const pts: [number, number][] = [];
  const ends: number[] = [];
  const groups: number[] = []; // where each polygon's rings end, as a count of rings
  for (const group of linesOf(g)) for (const [r, line] of group.entries()) {
    if (r === group.length - 1) groups.push(ends.length + 1);
    line.forEach((q, i) => {
      if (i) {
        const a = line[i - 1];
        const n = Math.ceil(geoDistance(a, q) / (Math.PI / 180));
        if (n > 1) { const at = geoInterpolate(a, q); for (let k = 1; k < n; k++) pts.push(at(k / n)); }
      }
      pts.push([q[0], q[1]]);
    });
    ends.push(pts.length);
  }
  return { s: onSphere(pts), p: new Float32Array(pts.length * 3), ends, groups };
}
export type Shape = ReturnType<typeof shape>;

/** Lines, ending exactly at the horizon, and left out past the bottom of the screen. */
export function strokeShape(ctx: CanvasRenderingContext2D, sh: Shape, bottom: number) {
  ctx.beginPath();
  const p = sh.p;
  let from = 0;
  for (const to of sh.ends) {
    for (let k = from; k < to; k++) {
      const x = p[k * 3], y = p[k * 3 + 1], d = p[k * 3 + 2];
      const first = k === from;
      const px = p[k * 3 - 3], py = p[k * 3 - 2], pd = p[k * 3 - 1];
      const shown = d >= 0, wasShown = !first && pd >= 0;
      // one point past the bottom still draws, so the line reaches the edge of the screen
      const below = y > bottom && (first || py > bottom);
      if (shown && !below) {
        if (first || !wasShown) {
          if (first) ctx.moveTo(x, y);
          else { const t = pd / (pd - d); ctx.moveTo(px + (x - px) * t, py + (y - py) * t); ctx.lineTo(x, y); }
        } else if (py > bottom && y > bottom) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      } else if (wasShown && !shown) {
        const t = pd / (pd - d);
        ctx.lineTo(px + (x - px) * t, py + (y - py) * t);
      } else if (shown) ctx.moveTo(x, y);
    }
    from = to;
  }
}

/**
 * Areas, clipped to the half of the globe that faces the viewer. A ring cut by the horizon becomes runs of
 * visible points, each entering and leaving at the rim; a polygon's runs (its holes' too) are joined along the
 * rim, each exit to the next entry going round one way, as d3 does. Polygons with nothing on screen are left out.
 */
export function fillShape(ctx: CanvasRenderingContext2D, sh: Shape, v: View, bottom: number, dir: 1 | -1 = RIM_DIR) {
  ctx.beginPath();
  const p = sh.p;
  let ring = 0;
  for (const last of sh.groups) {
    const rings: { from: number; n: number; hidden: number }[] = [];
    let onScreen = false;
    for (; ring < last; ring++) {
      const from = ring ? sh.ends[ring - 1] : 0, to = sh.ends[ring];
      const n = to - from - (sameEnds(p, from, to) ? 1 : 0); // rings repeat their first point at the end
      let hidden = -1, seen = false;
      for (let k = from; k < from + n; k++) {
        if (p[k * 3 + 2] >= 0) { seen = true; if (p[k * 3 + 1] <= bottom) onScreen = true; } else if (hidden < 0) hidden = k;
      }
      if (seen) rings.push({ from, n, hidden });
    }
    if (!onScreen) continue;
    const runs: Run[] = [];
    for (const r of rings) {
      if (r.hidden >= 0) { runs.push(...runsOf(p, r.from, r.n, r.hidden, v)); continue; }
      for (let k = r.from; k < r.from + r.n; k++) if (k === r.from) ctx.moveTo(p[k * 3], p[k * 3 + 1]); else ctx.lineTo(p[k * 3], p[k * 3 + 1]);
      ctx.closePath();
    }
    if (runs.length) joinRuns(ctx, runs, v, dir);
  }
}

/** Which way round the rim joins exits to entries, for rings wound as world-atlas winds them. */
const RIM_DIR: 1 | -1 = 1;

const sameEnds = (p: Float32Array, from: number, to: number) => to - from > 1 && p[from * 3] === p[(to - 1) * 3] && p[from * 3 + 1] === p[(to - 1) * 3 + 1] && p[from * 3 + 2] === p[(to - 1) * 3 + 2];

interface Run { pts: number[]; enter: number; leave: number }

/** The visible stretches of a ring, starting from one of its hidden points; each begins and ends on the rim. */
function runsOf(p: Float32Array, from: number, n: number, hidden: number, v: View): Run[] {
  const runs: Run[] = [];
  let cur: number[] | null = null;
  const rim = (a: number, b: number) => {
    const da = p[a * 3 + 2], db = p[b * 3 + 2], t = da / (da - db);
    const x = p[a * 3] + (p[b * 3] - p[a * 3]) * t - v.cx, y = p[a * 3 + 1] + (p[b * 3 + 1] - p[a * 3 + 1]) * t - v.cy;
    return Math.atan2(y, x);
  };
  let enter = 0;
  for (let i = 0; i < n; i++) {
    const a = from + ((hidden - from + i) % n), b = from + ((hidden - from + i + 1) % n);
    const va = p[a * 3 + 2] >= 0, vb = p[b * 3 + 2] >= 0;
    if (!va && vb) { enter = rim(a, b); cur = []; }
    if (vb && cur) cur.push(p[b * 3], p[b * 3 + 1]);
    if (va && !vb && cur) { runs.push({ pts: cur, enter, leave: rim(a, b) }); cur = null; }
  }
  return runs;
}

function joinRuns(ctx: CanvasRenderingContext2D, runs: Run[], v: View, dir: 1 | -1) {
  const used = new Set<Run>();
  const TAU = Math.PI * 2;
  for (const start of runs) {
    if (used.has(start)) continue;
    let run = start;
    ctx.moveTo(v.cx + Math.cos(run.enter) * v.R, v.cy + Math.sin(run.enter) * v.R);
    for (let guard = 0; guard <= runs.length; guard++) {
      used.add(run);
      for (let i = 0; i < run.pts.length; i += 2) ctx.lineTo(run.pts[i], run.pts[i + 1]);
      // the next entry met going round the rim from this exit
      let next = start, best = Infinity;
      for (const r of runs) {
        const d = (((r.enter - run.leave) * dir) % TAU + TAU) % TAU;
        if (d < best && (r === start || !used.has(r))) { best = d; next = r; }
      }
      ctx.arc(v.cx, v.cy, v.R, run.leave, run.leave + best * dir, dir < 0);
      if (next === start) break;
      run = next;
    }
    ctx.closePath();
  }
}
