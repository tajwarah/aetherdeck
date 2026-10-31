// Surround mode's room: you stand at the centre of a cylinder of radius 1, and your pages hang on its wall all the
// way around you. Everything here is plain geometry, shared by the drawing (electron/surround-gl.ts) and the
// pointer (Surround.tsx), so that what you see is what you click. Angles are radians; yaw 0 is straight ahead.

export interface Panel { id: string; yaw: number; width: number; height: number }
export interface View { yaw: number; fov: number; aspect: number }

export const TAU = Math.PI * 2;
export const FOV = { min: 0.75, start: 1.08, max: 1.5 };
const HEIGHT = 0.8;
const GAP = 0.07;

/** The shortest turn from one direction to another, between -π and π. */
export const turn = (a: number) => { const t = (a + Math.PI) % TAU; return (t < 0 ? t + TAU : t) - Math.PI; };

/** Hangs pages side by side around the room, the first straight ahead. Too many to fit? They all shrink to fit. */
export function layoutPanels(items: { id: string; aspect: number }[]): Panel[] {
  const widths = items.map((i) => HEIGHT * Math.min(2.6, Math.max(0.4, i.aspect)));
  const needed = widths.reduce((a, b) => a + b + GAP, 0);
  const s = needed > TAU ? TAU / needed : 1;
  let at = -(widths[0] ?? 0) * s / 2;
  return items.map((item, i) => {
    const width = widths[i] * s;
    const yaw = turn(at + width / 2);
    at += width + GAP * s;
    return { id: item.id, yaw, width, height: HEIGHT * s };
  });
}

/** Where a point of a panel lands on screen (-1 to 1 across and up), or null behind you. */
export function toView(v: View, p: Panel, u: number, h: number) {
  const a = p.yaw + (u - 0.5) * p.width - v.yaw;
  if (Math.cos(a) <= 0.01) return null;
  const f = 1 / Math.tan(v.fov / 2);
  return { x: (Math.tan(a) * f) / v.aspect, y: (((0.5 - h) * p.height) / Math.cos(a)) * f };
}

/** The direction and height on the wall under a point of the screen. */
export function toWall(v: View, x: number, y: number) {
  const f = 1 / Math.tan(v.fov / 2);
  const side = (x * v.aspect) / f;
  return { yaw: turn(Math.atan(side) + v.yaw), height: y / f / Math.hypot(side, 1) };
}

/** The panel and the point of it under a point of the screen. */
export function hitPanel(v: View, panels: Panel[], x: number, y: number) {
  const w = toWall(v, x, y);
  for (const p of panels) {
    const u = 0.5 + turn(w.yaw - p.yaw) / p.width;
    const h = 0.5 - w.height / p.height;
    if (u >= 0 && u <= 1 && h >= 0 && h <= 1) return { panel: p, u, v: h };
  }
  return null;
}

/** The same point of a panel, wherever the pointer has wandered to during a drag. */
export function onPanel(v: View, p: Panel, x: number, y: number) {
  const w = toWall(v, x, y);
  return { u: Math.min(1, Math.max(0, 0.5 + turn(w.yaw - p.yaw) / p.width)), v: Math.min(1, Math.max(0, 0.5 - w.height / p.height)) };
}

/** Whether any of a panel can be seen from this view. */
export function inView(v: View, p: Panel): boolean {
  return Math.abs(turn(v.yaw - p.yaw)) < Math.atan(Math.tan(v.fov / 2) * v.aspect) + p.width / 2 + 0.05;
}
