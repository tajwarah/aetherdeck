// Floating windows: the model, and how a typed request becomes one. Pure; the layer that draws them is Windows.tsx.
// One window shows one page. Windows that belong together form a group: linked by a thread of light,
// moved, arranged, minimized and restored together.

export type TabKind = "web" | "video" | "videosearch" | "assistant" | "phone";

export interface Tab {
  id: string;
  kind: TabKind;
  /** What the frame loads (for video, an embed address; for video search, the query). */
  src: string;
  /** What a person would open in their own browser. */
  href: string;
  title: string;
  domain: string;
  /** The site's own icon, once the page has told the desktop app. */
  icon?: string;
}

export interface Rect { x: number; y: number; w: number; h: number }

export interface Win extends Rect {
  id: string;
  page: Tab;
  z: number;
  minimized: boolean;
  /** Group id; windows sharing it are linked. */
  group?: string;
  /** Where the window grew from (screen point), so it zooms out of the click that opened it. */
  origin?: { x: number; y: number };
  /** The frame to return to after maximizing. */
  restore?: Rect;
  /** Private window (desktop app): its own short-lived session; never in history, never synced. */
  private?: boolean;
}

/** Ids are random: windows and groups travel between devices, so they must not collide with another device's. */
export const uid = (p: string) => `${p}${Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(36).padStart(2, "0")).join("")}`;

const URL_RE = /^(https?:\/\/)?([a-z0-9-]+\.)+[a-z]{2,}(:\d+)?(\/\S*)?$/i;
const YT_ID = /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{6,})/i;

export function domainOf(href: string) {
  try { return new URL(href).hostname.replace(/^www\./, ""); } catch { return href; }
}

/** A YouTube page address → the embed address the player accepts, or null. */
export function youtubeEmbed(href: string): string | null {
  const id = href.match(YT_ID)?.[1];
  return id ? `https://www.youtube-nocookie.com/embed/${id}?rel=0` : null;
}

/** The video a search result opens as. */
export function videoTab(id: string, title: string): Omit<Tab, "id"> {
  return { kind: "video", src: `https://www.youtube-nocookie.com/embed/${id}?rel=0&autoplay=1`, href: `https://www.youtube.com/watch?v=${id}`, title, domain: "youtube.com" };
}

/**
 * Turns a typed request into something to open in a window, or null when it is a question for the space.
 * Addresses open as sites; YouTube links and "play/watch …" open the player.
 */
export function parseOpenRequest(text: string): Omit<Tab, "id"> | null {
  const t = text.trim();
  const opened = t.replace(/^(open|go to|visit|browse)\s+/i, "");
  if (!/\s/.test(opened) && URL_RE.test(opened)) {
    const href = /^https?:\/\//i.test(opened) ? opened : `https://${opened}`;
    const embed = youtubeEmbed(href);
    if (embed) return { kind: "video", src: embed, href, title: "YouTube", domain: "youtube.com" };
    return { kind: "web", src: href, href, title: domainOf(href), domain: domainOf(href) };
  }
  const play = t.match(/^(?:play|watch|youtube)\s+(.+?)(?:\s+on youtube)?$/i) ?? t.match(/^(.+?)\s+on youtube$/i);
  if (play) {
    const q = play[1].replace(/[.?!]$/, "").trim();
    return { kind: "videosearch", src: q, href: `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`, title: `▶ ${q}`, domain: "youtube.com" };
  }
  return null;
}

export const DEFAULT_SIZE = { w: 760, h: 500 };
const GAP = 28;
const TOP = 100; // below the top bar
const BOTTOM = 160; // above the dock, leaving room for a group's ornament

/** Where a new window lands: near the pointer, cascading, always within the viewport. */
/** Where new windows go when nothing opened them from a point: around you, left and right of the planet first. */
const SLOTS = [{ x: 0.3, y: 0.36 }, { x: 0.72, y: 0.34 }, { x: 0.5, y: 0.44 }];

export function placeWindow(existing: Win[], vw: number, vh: number, near?: { x: number; y: number }): Rect {
  const w = Math.min(DEFAULT_SIZE.w, vw - 32, Math.max(520, Math.round(vw * 0.36)));
  const h = Math.min(DEFAULT_SIZE.h, vh - TOP - BOTTOM, Math.round(w * 0.66));
  const open = existing.filter((e) => !e.minimized);
  if (!near && vw >= 1100) {
    const clamp = (r: Rect) => ({ ...r, x: Math.round(Math.min(Math.max(16, r.x), vw - w - 16)), y: Math.round(Math.min(Math.max(TOP, r.y), vh - h - BOTTOM)) });
    const free = SLOTS.map((s) => clamp({ x: vw * s.x - w / 2, y: vh * s.y - h / 2, w, h })).find((r) => open.every((o) => overlap(r, o) < 0.25));
    if (free) return free;
  }
  const step = 28 * (open.length % 6);
  const x = Math.round(Math.min(Math.max(16, (near?.x ?? vw / 2) - w / 2 + step), vw - w - 16));
  const y = Math.round(Math.min(Math.max(TOP, (near?.y ?? vh / 2) - h / 2 + step), vh - h - BOTTOM));
  return { x, y, w, h };
}

/** Maximize, or return to the frame it had before. */
export function toggleMaximize(w: Win, vw: number, vh: number): Win {
  if (w.restore) return { ...w, ...w.restore, restore: undefined };
  return { ...w, restore: { x: w.x, y: w.y, w: w.w, h: w.h }, x: 16, y: TOP, w: vw - 32, h: vh - TOP - BOTTOM };
}

/** The front-most visible window, if any. */
export const frontWindow = (ws: Win[]) => ws.filter((w) => !w.minimized).sort((a, b) => b.z - a.z)[0];

export const membersOf = (ws: Win[], group?: string) => (group ? ws.filter((w) => w.group === group) : []);

export function boundsOf(ws: Rect[]): Rect {
  const x = Math.min(...ws.map((w) => w.x));
  const y = Math.min(...ws.map((w) => w.y));
  return { x, y, w: Math.max(...ws.map((w) => w.x + w.w)) - x, h: Math.max(...ws.map((w) => w.y + w.h)) - y };
}

/** How much of a is covered by b, 0–1. */
function overlap(a: Rect, b: Rect) {
  const w = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const h = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return (w * h) / (a.w * a.h);
}

/** Shortest gap between two rectangles' edges (0 when they overlap). */
export function edgeGap(a: Rect, b: Rect) {
  const dx = Math.max(0, b.x - (a.x + a.w), a.x - (b.x + b.w));
  const dy = Math.max(0, b.y - (a.y + a.h), a.y - (b.y + b.h));
  return Math.hypot(dx, dy);
}

export const SNAP = 56;

/**
 * After a window is dropped: if it lands near another window it joins that window's group (making one if needed);
 * if it has drifted away from every window of its own group, it leaves. Groups of one dissolve.
 */
export function regroupAfterDrop(ws: Win[], id: string, shared: ReadonlySet<string> = new Set()): Win[] {
  const moved = ws.find((w) => w.id === id);
  if (!moved) return ws;
  const others = ws.filter((w) => w.id !== id && !w.minimized);
  const near = others.filter((w) => edgeGap(moved, w) <= SNAP).sort((a, b) => edgeGap(moved, a) - edgeGap(moved, b))[0];
  let next = ws;
  if (moved.group && shared.has(moved.group)) {
    // A shared window stays in its group wherever it is dropped: dragging never shares or unshares anything else.
  } else if (near?.group && shared.has(near.group)) {
    // Dropped beside a shared group: only this window joins it (and is shared with the same people).
    next = ws.map((w) => (w.id === id ? { ...w, group: near.group } : w));
  } else if (near) {
    const gid = near.group ?? moved.group ?? uid("g");
    const oldGroup = moved.group && moved.group !== gid ? moved.group : undefined;
    next = ws.map((w) => (w.id === id || w.id === near.id || (oldGroup && w.group === oldGroup) ? { ...w, group: gid } : w));
  } else if (moved.group) {
    next = ws.map((w) => (w.id === id ? { ...w, group: undefined } : w));
  }
  return dissolveSingles(next, shared);
}

/** A group of one is no group, except a shared one: it stays open to the people it is shared with. */
export function dissolveSingles(ws: Win[], shared: ReadonlySet<string> = new Set()): Win[] {
  const count = new Map<string, number>();
  ws.forEach((w) => w.group && count.set(w.group, (count.get(w.group) ?? 0) + 1));
  return ws.map((w) => (w.group && !shared.has(w.group) && (count.get(w.group) ?? 0) < 2 ? { ...w, group: undefined } : w));
}

/** Lay a group out side by side in reading order, centered, the same height, shrinking to fit the screen. */
export function arrangeGroup(ws: Win[], group: string, vw: number, vh: number): Win[] {
  const members = membersOf(ws, group).sort((a, b) => a.x - b.x);
  if (!members.length) return ws;
  const h = Math.min(vh - TOP - BOTTOM, Math.max(...members.map((m) => m.h)));
  const natural = members.reduce((t, m) => t + m.w, 0) + GAP * (members.length - 1);
  const k = Math.min(1, (vw - 32) / natural);
  let x = Math.round((vw - natural * k) / 2);
  const y = Math.round(TOP + (vh - TOP - BOTTOM - h) / 2);
  const placed = new Map<string, Rect>();
  members.forEach((m) => {
    const w = Math.round(m.w * k);
    placed.set(m.id, { x, y, w, h });
    x += w + Math.round(GAP * k);
  });
  return ws.map((w) => (placed.has(w.id) ? { ...w, ...placed.get(w.id)!, restore: undefined, minimized: false } : w));
}

/** Where a page added to a group goes: beside the group, on whichever side has room. `fits` is false when neither side does. */
export function placeBeside(ws: Win[], anchor: Win, vw: number, vh: number): Rect & { fits: boolean } {
  const b = boundsOf(membersOf(ws, anchor.group).length ? membersOf(ws, anchor.group) : [anchor]);
  const w = Math.min(anchor.w, DEFAULT_SIZE.w);
  const h = anchor.h;
  if (b.x + b.w + GAP + w <= vw - 16) return { x: b.x + b.w + GAP, y: anchor.y, w, h, fits: true };
  if (b.x - GAP - w >= 16) return { x: b.x - GAP - w, y: anchor.y, w, h, fits: true };
  return { x: Math.min(vw - w - 16, anchor.x + 40), y: Math.min(vh - h - BOTTOM, anchor.y + 40), w, h, fits: false };
}

/** How far a window turns toward the viewer: windows off to the side curve in, like panes arranged around you. */
export function curveOf(r: Rect, vw: number) {
  const offset = (r.x + r.w / 2 - vw / 2) / (vw / 2);
  return Math.max(-12, Math.min(12, -offset * 12));
}

/**
 * Overview: every lone window and every group gets a tile in a grid, scaled to fit; a group keeps its own layout
 * inside its tile. Returns, per window, the translate and scale to apply on top of its real position.
 */
export function overviewTiles(ws: Win[], vw: number, vh: number): Map<string, { dx: number; dy: number; s: number }> {
  const units = [...new Map(ws.map((w) => [w.group ?? w.id, ws.filter((x) => (x.group ?? x.id) === (w.group ?? w.id))])).values()];
  const out = new Map<string, { dx: number; dy: number; s: number }>();
  if (!units.length) return out;
  const cols = Math.ceil(Math.sqrt(units.length * (vw / Math.max(1, vh - TOP - BOTTOM)) / 1.6));
  const rows = Math.ceil(units.length / cols);
  const tw = (vw - 32) / cols;
  const th = (vh - TOP - BOTTOM + 60) / rows;
  units.forEach((members, i) => {
    const b = boundsOf(members);
    const s = Math.min(1, (tw * 0.84) / b.w, (th * 0.74) / b.h);
    const cx = 16 + tw * (i % cols) + tw / 2;
    const cy = TOP - 30 + th * Math.floor(i / cols) + th / 2;
    members.forEach((m) => out.set(m.id, { s, dx: cx + (m.x - (b.x + b.w / 2)) * s - m.x, dy: cy + (m.y - (b.y + b.h / 2)) * s - m.y }));
  });
  return out;
}

export function groupName(members: Win[]) {
  const names = [...new Set(members.map((m) => (m.page.kind === "web" ? m.page.domain.replace(/^(en\.)?(m\.)?/, "") : m.page.kind === "assistant" ? m.page.title : "YouTube")))];
  return names.length <= 2 ? names.join(" + ") : `${names[0]} + ${names.length - 1} more`;
}

/** A question typed into "Add page": searched on Wikipedia, one of the few search pages that allow being framed. */
export function webSearchTab(q: string): Omit<Tab, "id"> {
  const href = `https://en.wikipedia.org/w/index.php?search=${encodeURIComponent(q)}`;
  return { kind: "web", src: href, href, title: q, domain: "en.wikipedia.org" };
}
