// The curved screen's geometry, shared by the drawing (electron/curve-gl.ts) and the pointer (CurvedPage):
// the page is wrapped on the inside of a cylinder and seen from in front of it, so its sides come toward you
// and stand taller than its middle. Coordinates: u, v ∈ [0, 1] across and down the page; x, y ∈ [-1, 1] across
// and up the drawing (normalized device coordinates).

/** At full bend: how far the page wraps around you (radians) and how much smaller its middle looks than its sides. */
export const ARC = 0.95;
export const SHRINK = 0.075;

export interface Curve { arc: number; r: number; d: number }

/** The cylinder for a bend from 0 to 1: a small window bends gently, a full screen bends all the way. */
export function curveFor(bend = 1): Curve {
  const arc = ARC * bend;
  const shrink = SHRINK * bend;
  const r = 1 / (2 * Math.sin(arc / 2)); // chord of the arc = page width = 1
  const z0 = r * (1 - Math.cos(arc / 2)); // how far the middle sits behind the sides
  return { arc, r, d: ((1 - shrink) * z0) / shrink }; // d: the viewing distance that shrinks the middle by `shrink`
}

const FULL = curveFor(1);

/** Perspective scale for a column: 1 at the sides, smallest in the middle. */
export function scaleAt(u: number, c: Curve = FULL): number {
  const a = (u - 0.5) * c.arc;
  const z = c.r * (Math.cos(a) - Math.cos(c.arc / 2));
  return c.d / (c.d + z);
}

/** Where a point of the page lands in the drawing. */
export function toScreen(u: number, v: number, c: Curve = FULL): { x: number; y: number } {
  const a = (u - 0.5) * c.arc;
  const s = scaleAt(u, c);
  return { x: 2 * c.r * Math.sin(a) * s, y: (1 - 2 * v) * s };
}

/** The page point under a point of the drawing, or null when it is above or below the page. */
export function toPage(x: number, y: number, c: Curve = FULL): { u: number; v: number } | null {
  if (x < -1 || x > 1) return null;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (toScreen(mid, 0.5, c).x < x) lo = mid; else hi = mid;
  }
  const u = (lo + hi) / 2;
  const v = (1 - y / scaleAt(u, c)) / 2;
  return v < 0 || v > 1 ? null : { u, v };
}
