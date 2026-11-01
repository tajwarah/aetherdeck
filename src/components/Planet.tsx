// The planet: Earth at night, seen from orbit. Its upper face rises from the bottom of the screen and turns
// slowly; real coastlines and borders (Natural Earth, via world-atlas), city lights where large cities are,
// and fine threads of light, like optical fibre, running between them. Starting points are small luminous nodes
// that name themselves on hover. It never moves with the camera; explorations and windows float in front of it.
import { useEffect, useRef, useState } from "react";
import { geoDistance, geoGraticule10, geoInterpolate } from "d3-geo";
import { feature, mesh } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import world from "world-atlas/countries-110m.json";
import { fillShape, onSphere, project, shape, strokeShape, view, type View } from "../lib/globe.ts";

export const SEEDS = [
  { label: "Quantum computing", query: "Explain quantum computing and show me the original sources.", lat: 47.37, lon: 8.54, photo: "Quantum_computing" },
  { label: "AC repair, today", query: "Find an AC repair technician near me today.", lat: 25.2, lon: 55.27, photo: "Air_conditioning" },
  { label: "Kacchi biryani nearby", query: "Find restaurants near me that serve kacchi biryani and compare them.", lat: 17.39, lon: 78.49, photo: "Kacchi_biryani" },
  { label: "Bangladesh this week", query: "What's happening in Bangladesh today?", lat: 24.9, lon: 91.87, photo: "Bangladesh" },
  { label: "Coral reef bleaching", query: "What is the evidence on coral reef bleaching?", lat: 20.5, lon: 38.5, photo: "Coral_bleaching" },
  { label: "Climbing Mount Fuji", query: "What should I know before climbing Mount Fuji?", lat: 35.36, lon: 138.73, photo: "Mount_Fuji" },
  { label: "Northern lights", query: "Where can I see the northern lights this week?", lat: 64.96, lon: -19.0, photo: "Aurora" },
  { label: "Samarkand and the Silk Road", query: "Tell me the history of Samarkand on the Silk Road.", lat: 39.65, lon: 66.96, photo: "Samarkand" },
];

// Large cities [lat, lon, weight 1–5]: where the lights are.
const CITIES: [number, number, number][] = [
  [35.68, 139.69, 5], [34.69, 135.5, 4], [35.18, 136.9, 3], [33.59, 130.4, 2], [43.06, 141.35, 2], [37.57, 126.98, 5], [35.18, 129.08, 3],
  [39.9, 116.4, 5], [39.13, 117.2, 3], [31.23, 121.47, 5], [32.06, 118.8, 3], [30.27, 120.15, 3], [30.59, 114.3, 3], [23.13, 113.26, 5],
  [22.54, 114.06, 4], [22.32, 114.17, 4], [30.57, 104.07, 4], [29.56, 106.55, 4], [34.34, 108.94, 3], [41.8, 123.43, 3], [45.8, 126.53, 2],
  [34.75, 113.62, 3], [25.03, 121.56, 3], [14.6, 120.98, 4], [21.03, 105.85, 3], [10.82, 106.63, 3], [13.76, 100.5, 4], [3.14, 101.69, 3],
  [1.35, 103.82, 3], [-6.2, 106.85, 5], [-7.25, 112.75, 2], [23.81, 90.41, 5], [22.36, 91.78, 2], [22.57, 88.36, 4], [28.61, 77.21, 5],
  [19.08, 72.88, 5], [12.97, 77.59, 4], [13.08, 80.27, 4], [17.39, 78.49, 4], [23.02, 72.57, 3], [18.52, 73.86, 3], [26.85, 80.95, 3],
  [25.6, 85.1, 2], [26.91, 75.79, 2], [24.86, 67.0, 4], [31.55, 74.34, 4], [33.68, 73.05, 2], [27.72, 85.32, 2], [6.93, 79.86, 2],
  [34.55, 69.2, 2], [35.69, 51.39, 4], [36.3, 59.6, 2], [33.31, 44.36, 3], [24.71, 46.68, 3], [21.49, 39.19, 2], [25.2, 55.27, 3],
  [25.29, 51.53, 2], [29.37, 47.98, 2], [41.01, 28.98, 5], [39.93, 32.86, 3], [32.08, 34.78, 2], [31.95, 35.93, 2], [30.04, 31.24, 5],
  [31.2, 29.92, 3], [15.5, 32.56, 2], [9.03, 38.74, 3], [-1.29, 36.82, 3], [6.52, 3.38, 5], [12.0, 8.52, 2], [5.6, -0.19, 2], [5.36, -4.0, 2],
  [14.72, -17.47, 2], [33.57, -7.59, 3], [36.75, 3.06, 2], [36.8, 10.18, 2], [-4.44, 15.27, 3], [-8.84, 13.23, 2], [-26.2, 28.05, 3],
  [-33.92, 18.42, 2], [55.76, 37.62, 5], [59.93, 30.34, 3], [50.45, 30.52, 3], [52.23, 21.01, 3], [52.52, 13.4, 4], [53.55, 9.99, 2],
  [48.14, 11.58, 3], [50.11, 8.68, 2], [51.46, 7.01, 3], [52.37, 4.9, 3], [50.85, 4.35, 2], [48.86, 2.35, 5], [51.51, -0.13, 5],
  [53.48, -2.24, 2], [53.35, -6.26, 2], [40.42, -3.7, 4], [41.39, 2.17, 3], [38.72, -9.14, 2], [41.9, 12.5, 3], [45.46, 9.19, 3],
  [40.85, 14.27, 2], [48.21, 16.37, 2], [47.5, 19.04, 2], [50.08, 14.44, 2], [44.43, 26.1, 2], [37.98, 23.73, 2], [59.33, 18.07, 2],
  [59.91, 10.75, 1], [60.17, 24.94, 1], [55.68, 12.57, 2], [47.37, 8.54, 2], [55.0, 82.93, 2], [56.84, 60.6, 2], [43.24, 76.9, 2],
  [41.3, 69.24, 2], [47.89, 106.9, 1], [43.12, 131.9, 1], [40.71, -74.0, 5], [39.95, -75.17, 3], [42.36, -71.06, 3], [38.9, -77.04, 3],
  [33.75, -84.39, 3], [25.76, -80.19, 3], [41.88, -87.63, 4], [42.33, -83.05, 2], [43.65, -79.38, 3], [45.5, -73.57, 2], [29.76, -95.37, 3],
  [32.78, -96.8, 3], [39.74, -104.99, 2], [33.45, -112.07, 2], [34.05, -118.24, 5], [37.77, -122.42, 3], [47.61, -122.33, 2],
  [49.28, -123.12, 2], [19.43, -99.13, 5], [20.66, -103.35, 2], [25.69, -100.32, 2], [23.11, -82.37, 1], [4.71, -74.07, 3],
  [-12.05, -77.04, 3], [10.48, -66.9, 2], [-23.55, -46.63, 5], [-22.91, -43.17, 4], [-34.6, -58.38, 4], [-33.45, -70.67, 3],
  [-33.87, 151.21, 3], [-37.81, 144.96, 3], [-27.47, 153.03, 2], [-31.95, 115.86, 1], [-36.85, 174.76, 1], [64.15, -21.94, 1],
];

/** Long-haul links that make the network read as one planet, not a cluster: [from, to] as [lat, lon]. */
const TRUNKS: [[number, number], [number, number]][] = [
  [[40.71, -74.0], [51.51, -0.13]], [[51.51, -0.13], [25.2, 55.27]], [[25.2, 55.27], [19.08, 72.88]], [[19.08, 72.88], [1.35, 103.82]],
  [[1.35, 103.82], [35.68, 139.69]], [[35.68, 139.69], [34.05, -118.24]], [[34.05, -118.24], [40.71, -74.0]], [[-23.55, -46.63], [6.52, 3.38]],
  [[6.52, 3.38], [51.51, -0.13]], [[-33.87, 151.21], [1.35, 103.82]], [[55.76, 37.62], [39.9, 116.4]], [[30.04, 31.24], [41.01, 28.98]],
  [[48.86, 2.35], [30.04, 31.24]], [[23.81, 90.41], [22.32, 114.17]], [[28.61, 77.21], [55.76, 37.62]], [[-26.2, 28.05], [-1.29, 36.82]],
  [[-1.29, 36.82], [25.2, 55.27]], [[19.43, -99.13], [-23.55, -46.63]], [[37.57, 126.98], [31.23, 121.47]], [[52.52, 13.4], [59.33, 18.07]],
];

/** The fibre network: every bright city linked to its nearest bright neighbours, plus the long-haul trunks. */
const ROUTES = (() => {
  const big = CITIES.filter((c) => c[2] >= 3);
  const key = (a: number[], b: number[]) => [a[0], a[1], b[0], b[1]].join(",");
  const seen = new Set<string>();
  const out: [[number, number], [number, number]][] = [];
  for (const a of big.filter((c) => c[2] >= 4)) {
    const near = big
      .filter((b) => b !== a)
      .map((b) => ({ b, d: geoDistance([a[1], a[0]], [b[1], b[0]]) }))
      .filter((x) => x.d > 0.09 && x.d < 0.7)
      .sort((x, y) => x.d - y.d)
      .slice(0, 2);
    for (const { b } of near) {
      if (seen.has(key(b, a))) continue;
      seen.add(key(a, b));
      out.push([[a[0], a[1]], [b[0], b[1]]]);
    }
  }
  return [...out, ...TRUNKS];
})();

/** Dark stone and platinum city light. */
const PALETTE = { halo: "222, 230, 240", body: ["#4d535c", "#262a30", "#121417", "#08090b"], land: "rgba(5, 6, 8, 0.42)", coast: "rgba(224, 232, 242, 0.13)", grid: "rgba(224, 232, 242, 0.04)", border: "rgba(210, 222, 236, 0.07)", fibre: "208, 220, 234", lights: 1, rim: "232, 238, 245" };
type Palette = typeof PALETTE;

const topo = world as unknown as Topology<{ countries: GeometryCollection; land: GeometryCollection }>;
const LAND = feature(topo, topo.objects.land);
const BORDERS = mesh(topo, topo.objects.countries, (a, b) => a !== b);
const GRATICULE = geoGraticule10();

/** Points of light: a bright core per city and a scatter of suburbs around it (seeded, so it never flickers). */
const LIGHTS = (() => {
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const out: { lon: number; lat: number; a: number; r: number }[] = [];
  for (const [lat, lon, w] of CITIES) {
    out.push({ lon, lat, a: 0.95, r: 1.2 + w * 0.35 });
    const n = 4 + w * w * 3;
    for (let i = 0; i < n; i++) {
      const d = (0.25 + w * 0.32) * Math.sqrt(-2 * Math.log(rnd() + 1e-9)) * 0.6;
      const t = rnd() * Math.PI * 2;
      out.push({ lon: lon + (Math.cos(t) * d) / Math.max(0.3, Math.cos((lat * Math.PI) / 180)), lat: lat + Math.sin(t) * d, a: 0.25 + rnd() * 0.5, r: 0.5 + rnd() * 0.8 });
    }
  }
  return out;
})();

/** Where the globe sits: its upper face fills the lower half of the screen; on phones it is wider than the screen. */
export function globeGeometry(vw: number, vh: number) {
  const R = Math.max(vw * 0.62, Math.min(vh * 0.75, 640));
  const cap = Math.min(vh * 0.5, R * 0.6); // how much of it rises above the bottom edge
  return { R, cx: vw / 2, cy: vh - cap + R };
}

const CENTER_LAT = -16; // looking down at the northern band, where most of the lights are

function useViewport() {
  const [v, setV] = useState({ w: window.innerWidth, h: window.innerHeight });
  useEffect(() => {
    const on = () => setV({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return v;
}

/** A photograph for a starting point: the lead image of its Wikipedia article. */
export function Planet({ dim, quiet, reduced, onSeed }: { dim: boolean; quiet: boolean; reduced: boolean; onSeed: (query: string) => void }) {
  const { w: vw, h: vh } = useViewport();
  const { R, cx, cy } = globeGeometry(vw, vh);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pinsRef = useRef<(HTMLButtonElement | null)[]>([]);
  const tilt = useRef({ x: 0, tx: 0 });
  const t0 = useRef(performance.now()); // one clock for the planet's turn, so it never jumps back when the effect restarts


  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const dpr = Math.min(1.5, window.devicePixelRatio || 1);
    // The canvas covers only the band the globe and its halo rise into, not the empty sky above it.
    const top = bandTop(R, cy);
    canvas.width = Math.round(vw * dpr);
    canvas.height = Math.round((vh - top) * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, -top * dpr);

    const scene = sceneFor(ctx, R, cx, cy, PALETTE, vw, vh);

    const onMove = (e: PointerEvent) => { tilt.current.tx = (e.clientX / window.innerWidth - 0.5) * 6; };
    window.addEventListener("pointermove", onMove);

    let raf = 0;
    let last = -1e9;
    const frame = (now: number) => {
      // Dimmed behind an exploration: paint once, then hold still. Otherwise at most 30 frames a second (a globe
      // turning this slowly gains nothing from more, and the interface keeps the rest), and 15 behind windows.
      if (!dim) raf = requestAnimationFrame(frame);
      if (now - last < (quiet ? 62 : 30)) return;
      last = now;
      const t = tilt.current;
      t.x += (t.tx - t.x) * 0.05;
      const secs = Math.max(0, now - t0.current) / 1000; // a frame can be stamped just before the clock started
      const lon0 = 30 + (reduced ? 0 : secs * 3) + t.x; // ≈ one turn every 2 minutes
      const v = view(lon0, CENTER_LAT, R, cx, cy);
      draw(scene, v, secs);

      project(SEED_S, v, SEED_P);
      SEEDS.forEach((_, i) => {
        const el = pinsRef.current[i];
        if (!el) return;
        const x = SEED_P[i * 3], y = SEED_P[i * 3 + 1], front = SEED_P[i * 3 + 2];
        const d = Math.acos(Math.max(-1, Math.min(1, front)));
        const show = d < Math.PI / 2 - 0.12 && y < vh - 24 && y > 90;
        const live = show && !dim;
        const k = 0.62 + Math.max(0, front) * 0.45;
        el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) scale(${k.toFixed(3)})`;
        el.style.opacity = show ? String(Math.min(1, (Math.PI / 2 - 0.12 - d) * 4)) : "0";
        el.style.zIndex = String(Math.round(y));
        el.tabIndex = live ? 0 : -1;
        el.style.pointerEvents = live ? "auto" : "none";
      });
    };
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("pointermove", onMove); };
  }, [reduced, R, cx, cy, vw, vh, dim, quiet]);

  return (
    <div className={`planet ${dim ? "planet--dim" : ""}`} aria-hidden={dim}>
      <canvas ref={canvasRef} className="planet__canvas" style={{ top: bandTop(R, cy), width: vw, height: vh - bandTop(R, cy) }} aria-hidden="true" />
      {SEEDS.map((s, i) => (
        <button key={s.label} ref={(el) => { pinsRef.current[i] = el; }} className="seed" data-node data-hint="Explore" onClick={() => onSeed(s.query)} aria-label={`Explore: ${s.query}`}>
          <span className="seed__node" />
          <span className="seed__label">{s.label}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * Threads on the sphere, sampled once: the fibre network (hair-thin, each with a slow point of light) and the
 * arcs between starting points (lifted off the surface like flight paths). `lift` holds each sample's height.
 */
function threads(routes: [[number, number], [number, number]][], samples: (len: number) => number, height: (len: number) => number) {
  const ends: number[] = [];
  const pts: [number, number][] = [];
  const lift: number[] = [];
  for (const [a, b] of routes) {
    const len = geoDistance(a, b);
    const at = geoInterpolate(a, b);
    const n = samples(len);
    const h = height(len);
    for (let k = 0; k <= n; k++) { pts.push(at(k / n)); lift.push(1 + h * Math.sin((Math.PI * k) / n)); }
    ends.push(pts.length);
  }
  return { s: onSphere(pts), p: new Float32Array(pts.length * 3), lift: Float32Array.from(lift), ends };
}

const FIBRES = threads(ROUTES.map(([a, b]) => [[a[1], a[0]], [b[1], b[0]]]), (len) => Math.max(8, Math.round(len * 40)), (len) => 0.004 + len * 0.012);
// One chain of light between starting points, west to east, so the arcs never cross each other.
const CHAIN = [...SEEDS].sort((p, q) => p.lon - q.lon).map((p) => [p.lon, p.lat] as [number, number]);
const ARCS = threads(CHAIN.slice(1).map((q, i) => [CHAIN[i], q]), () => 48, (len) => Math.min(0.06, 0.012 + len * 0.035));
const LIGHT_S = onSphere(LIGHTS.map((l) => [l.lon, l.lat]));
const SHAPES = { land: shape(LAND), borders: shape(BORDERS), grid: shape(GRATICULE) };
const LIGHT_P = new Float32Array(LIGHTS.length * 3);
const SEED_S = onSphere(SEEDS.map((s) => [s.lon, s.lat]));
const SEED_P = new Float32Array(SEEDS.length * 3);
const HORIZON_LIGHTS = Math.sin(0.02); // just inside the horizon, where d3's clipping ends the land
const HORIZON_THREADS = Math.sin(0.03);

/** What does not change from frame to frame for one size: gradients and colours, built once. */
const bandTop = (R: number, cy: number) => Math.max(0, Math.floor(cy - R * 1.09) - 2);

function sceneFor(ctx: CanvasRenderingContext2D, R: number, cx: number, cy: number, pal: Palette, vw: number, vh: number) {
  const halo = ctx.createRadialGradient(cx, cy, R * 0.96, cx, cy, R * 1.09);
  halo.addColorStop(0, `rgba(${pal.halo}, 0)`);
  halo.addColorStop(0.3, `rgba(${pal.halo}, 0.42)`);
  halo.addColorStop(0.45, `rgba(${pal.halo}, 0.16)`);
  halo.addColorStop(1, `rgba(${pal.halo}, 0)`);
  const body = ctx.createRadialGradient(cx, cy - R * 0.95, R * 0.05, cx, cy - R * 0.4, R * 1.25);
  pal.body.forEach((c, i) => body.addColorStop([0, 0.3, 0.75, 1][i], c));
  const rim = ctx.createRadialGradient(cx, cy, R * 0.9, cx, cy, R);
  rim.addColorStop(0, `rgba(${pal.rim}, 0)`);
  rim.addColorStop(1, `rgba(${pal.rim}, 0.22)`);
  const fibreInk = [0, 1, 2].map((i) => `rgba(${pal.fibre}, ${(0.16 + i * 0.05) * (pal.lights < 1 ? 1.8 : 1)})`);
  const arcInk = [0.18, 0.95, 0.1, 0.6].map((a) => `rgba(${pal.fibre}, ${a})`);
  return { ctx, vw, vh, pal, halo, body, rim, fibreInk, arcInk, sprite: glowSprite() };
}

/** One thread as a line, lifted off the surface, broken where it passes behind the horizon. */
function trace(ctx: CanvasRenderingContext2D, t: typeof FIBRES, from: number, to: number, v: View) {
  ctx.beginPath();
  let pen = false;
  for (let k = from; k < to; k++) {
    if (t.p[k * 3 + 2] < HORIZON_THREADS) { pen = false; continue; }
    const h = t.lift[k];
    const x = v.cx + (t.p[k * 3] - v.cx) * h;
    const y = v.cy + (t.p[k * 3 + 1] - v.cy) * h;
    if (pen) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    pen = true;
  }
}

/** A point of light travelling along a thread, `phase` of the way from its start. */
function pulse(ctx: CanvasRenderingContext2D, sprite: HTMLCanvasElement, t: typeof FIBRES, from: number, to: number, phase: number, size: number, alpha: (facing: number) => number, v: View) {
  const k = from + Math.floor(phase * (to - from - 1));
  const facing = t.p[k * 3 + 2];
  if (facing < HORIZON_THREADS) return;
  const h = t.lift[k];
  ctx.globalAlpha = alpha(facing);
  ctx.drawImage(sprite, v.cx + (t.p[k * 3] - v.cx) * h - size / 2, v.cy + (t.p[k * 3 + 1] - v.cy) * h - size / 2, size, size);
  ctx.globalAlpha = 1;
}

function draw(sc: ReturnType<typeof sceneFor>, v: View, secs: number) {
  const { ctx, pal, sprite } = sc;
  const { cx, cy, R } = v;
  const { vw, vh } = sc;
  ctx.clearRect(0, 0, vw, vh);

  // atmosphere: a warm band of light just outside the limb; then the night side, dark stone lit faintly from above
  ctx.fillStyle = sc.halo;
  ctx.beginPath(); ctx.arc(cx, cy, R * 1.09, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = sc.body;
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();

  const bottom = vh + 4;
  for (const sh of Object.values(SHAPES)) project(sh.s, v, sh.p);
  fillShape(ctx, SHAPES.land, v, bottom); ctx.fillStyle = pal.land; ctx.fill();
  strokeShape(ctx, SHAPES.land, bottom); ctx.strokeStyle = pal.coast; ctx.lineWidth = 0.7; ctx.stroke();
  strokeShape(ctx, SHAPES.grid, bottom); ctx.strokeStyle = pal.grid; ctx.lineWidth = 0.6; ctx.stroke();
  strokeShape(ctx, SHAPES.borders, bottom); ctx.strokeStyle = pal.border; ctx.lineWidth = 0.5; ctx.stroke();

  // the fibre network: hair-thin threads hugging the surface, each carrying a slow point of light
  ctx.globalCompositeOperation = pal.lights < 1 ? "source-over" : "lighter";
  ctx.lineCap = "round";
  ctx.lineWidth = 0.6;
  project(FIBRES.s, v, FIBRES.p);
  FIBRES.ends.forEach((to, i) => {
    const from = i ? FIBRES.ends[i - 1] : 0;
    trace(ctx, FIBRES, from, to, v);
    ctx.strokeStyle = sc.fibreInk[i % 3];
    ctx.stroke();
    pulse(ctx, sprite, FIBRES, from, to, (secs * (0.05 + (i % 5) * 0.012) + i * 0.173) % 1, 8, (f) => 0.5 + f * 0.5, v);
  });

  // city lights
  ctx.globalCompositeOperation = "lighter";
  project(LIGHT_S, v, LIGHT_P);
  for (let i = 0; i < LIGHTS.length; i++) {
    const facing = LIGHT_P[i * 3 + 2];
    const x = LIGHT_P[i * 3], y = LIGHT_P[i * 3 + 1];
    if (facing < HORIZON_LIGHTS || y > bottom || x < -8 || x > vw + 8) continue;
    const fade = facing ** 0.6;
    const s = LIGHTS[i].r * 5 * (0.55 + fade * 0.45);
    ctx.globalAlpha = LIGHTS[i].a * fade * pal.lights;
    ctx.drawImage(sprite, x - s / 2, y - s / 2, s, s);
  }
  ctx.globalAlpha = 1;

  // arcs of light between starting points; Zurich to the Red Sea is the brightest, like a route being travelled
  project(ARCS.s, v, ARCS.p);
  ARCS.ends.forEach((to, i) => {
    const from = i ? ARCS.ends[i - 1] : 0;
    trace(ctx, ARCS, from, to, v);
    const lead = i === 1;
    ctx.lineWidth = lead ? 7 : 5; ctx.strokeStyle = sc.arcInk[lead ? 0 : 2]; ctx.stroke();
    ctx.lineWidth = lead ? 2.2 : 1.3; ctx.strokeStyle = sc.arcInk[lead ? 1 : 3]; ctx.stroke();
    pulse(ctx, sprite, ARCS, from, to, (secs * 0.12 + i * 0.37) % 1, 18, () => 0.9, v);
  });
  ctx.globalCompositeOperation = "source-over";

  // the lit limb: a thin rim where the atmosphere catches the light
  ctx.fillStyle = sc.rim;
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();
}

/** One soft warm point of light, drawn once and stamped for every light. */
function glowSprite() {
  const c = document.createElement("canvas");
  c.width = c.height = 32;
  const g = c.getContext("2d")!;
  const r = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  r.addColorStop(0, "rgba(246, 249, 252, 1)");
  r.addColorStop(0.18, "rgba(214, 226, 240, 0.85)");
  r.addColorStop(0.5, "rgba(170, 190, 214, 0.18)");
  r.addColorStop(1, "rgba(160, 182, 208, 0)");
  g.fillStyle = r;
  g.fillRect(0, 0, 32, 32);
  return c;
}
