import { describe, expect, it } from "vitest";
import { arrangeGroup, curveOf, frontWindow, overviewTiles, parseOpenRequest, placeBeside, placeWindow, regroupAfterDrop, toggleMaximize, webSearchTab, youtubeEmbed, type Win } from "../../src/lib/windows.ts";
import { frameAncestorsAllow } from "../../server/preview.ts";

const page = (domain: string) => ({ id: domain, kind: "web" as const, src: `https://${domain}`, href: `https://${domain}`, title: domain, domain });
const win = (id: string, x: number, y = 100, extra: Partial<Win> = {}): Win => ({ id, page: page(`${id}.org`), x, y, w: 400, h: 300, z: 1, minimized: false, ...extra });

describe("floating windows", () => {
  it("opens addresses as sites and YouTube links as the player", () => {
    expect(parseOpenRequest("example.com")).toMatchObject({ kind: "web", src: "https://example.com", domain: "example.com" });
    expect(parseOpenRequest("open https://en.wikipedia.org/wiki/Dhaka")).toMatchObject({ kind: "web", domain: "en.wikipedia.org" });
    expect(parseOpenRequest("https://youtu.be/dQw4w9WgXcQ")).toMatchObject({ kind: "video", src: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0" });
    expect(youtubeEmbed("https://www.youtube.com/watch?t=10&v=abc123xyz")).toContain("/embed/abc123xyz");
  });

  it("turns play/watch requests into a video search, with YouTube's own page as the hand-off", () => {
    const r = parseOpenRequest("play lofi hip hop radio");
    expect(r).toMatchObject({ kind: "videosearch", src: "lofi hip hop radio", href: "https://www.youtube.com/results?search_query=lofi%20hip%20hop%20radio" });
    expect(parseOpenRequest("kacchi biryani recipe on youtube")?.src).toBe("kacchi biryani recipe");
  });

  it("searches Wikipedia for a question added to a group", () => {
    expect(webSearchTab("monsoon rainfall")).toMatchObject({ src: "https://en.wikipedia.org/w/index.php?search=monsoon%20rainfall", title: "monsoon rainfall" });
  });

  it("leaves questions to the space", () => {
    expect(parseOpenRequest("Explain quantum computing and show me the original sources.")).toBeNull();
    expect(parseOpenRequest("Find an AC repair technician near me today.")).toBeNull();
  });

  it("reads a site's framing headers honestly", () => {
    expect(frameAncestorsAllow({ xfo: "DENY" })).toEqual({ ok: false, reason: "X-Frame-Options: deny" });
    expect(frameAncestorsAllow({ xfo: "SAMEORIGIN, SAMEORIGIN" }).ok).toBe(false);
    expect(frameAncestorsAllow({ csp: "default-src 'self'; frame-ancestors 'self' https://partner.example" }).ok).toBe(false);
    expect(frameAncestorsAllow({ csp: "frame-ancestors *" }).ok).toBe(true);
    expect(frameAncestorsAllow({ csp: "default-src 'self'" }).ok).toBe(true);
    expect(frameAncestorsAllow({}).ok).toBe(true);
  });

  it("places windows inside the viewport, cascading", () => {
    const a = placeWindow([], 1280, 820, { x: 640, y: 400 });
    expect(a).toEqual({ x: 380, y: 229, w: 520, h: 343 });
    expect(placeWindow([], 1280, 820).y).toBeGreaterThanOrEqual(100); // clear of the top bar
    // opened from nowhere in particular: left of the planet, then right, never on top of each other
    const first = placeWindow([], 1600, 1000);
    const second = placeWindow([win("w1", first.x, first.y, { w: first.w, h: first.h })], 1600, 1000);
    expect(first.x + first.w / 2).toBeLessThan(800);
    expect(second.x).toBeGreaterThanOrEqual(first.x + first.w);
    expect(placeWindow([win("w1", a.x, a.y)], 1280, 820, { x: 640, y: 400 }).x).toBe(a.x + 28);
    const small = placeWindow([], 390, 700, { x: 10, y: 10 });
    expect(small.x).toBe(16);
    expect(small.w).toBe(390 - 32);
  });

  it("maximizes and restores the same frame; the front window is the highest visible one", () => {
    const w = win("a", 100, 120, { w: 500 });
    const big = toggleMaximize(w, 1280, 820);
    expect(big).toMatchObject({ x: 16, y: 100, w: 1248, h: 560, restore: { x: 100, y: 120, w: 500, h: 300 } });
    expect(toggleMaximize(big, 1280, 820)).toMatchObject({ x: 100, y: 120, w: 500, h: 300, restore: undefined });
    expect(frontWindow([w, win("b", 0, 0, { z: 5, minimized: true }), win("c", 0, 0, { z: 3 })])?.id).toBe("c");
  });
});

describe("window groups", () => {
  it("joins a window dropped beside another, and leaves when dragged away", () => {
    const joined = regroupAfterDrop([win("a", 0), win("b", 430)], "b"); // 30px apart
    expect(joined[0].group).toBeDefined();
    expect(joined[1].group).toBe(joined[0].group);
    const left = regroupAfterDrop(joined.map((w) => (w.id === "b" ? { ...w, x: 900 } : w)), "b");
    expect(left.every((w) => w.group === undefined)).toBe(true); // a group of one dissolves
  });

  it("merges two groups when one member is dropped against the other", () => {
    const ws = [win("a", 0, 100, { group: "g1" }), win("b", 420, 100, { group: "g1" }), win("c", 900, 100, { group: "g2" }), win("d", 1320, 100, { group: "g2" })];
    const merged = regroupAfterDrop(ws.map((w) => (w.id === "c" ? { ...w, x: 850 } : w)), "c");
    expect(new Set(merged.map((w) => w.group)).size).toBe(1);
  });

  it("arranges a group side by side, centered and shrunk to fit", () => {
    const ws = arrangeGroup([win("a", 500, 300, { group: "g" }), win("b", 10, 50, { group: "g" }), win("c", 0, 0)], "g", 1000, 800);
    const [a, b] = [ws.find((w) => w.id === "a")!, ws.find((w) => w.id === "b")!];
    expect(b.x).toBeLessThan(a.x); // reading order kept from where they were
    expect(a.y).toBe(b.y);
    expect(b.x).toBe(1000 - (a.x + a.w)); // centered
    expect(ws.find((w) => w.id === "c")).toMatchObject({ x: 0, y: 0 }); // other windows untouched
  });

  it("adds a page beside its group on the side with room", () => {
    const g = [win("a", 40, 100, { group: "g" }), win("b", 470, 100, { group: "g" })];
    expect(placeBeside(g, g[0], 1600, 900).x).toBe(470 + 400 + 28);
    expect(placeBeside(g, g[0], 900, 900)).toMatchObject({ fits: false });
  });

  it("curves side windows toward the viewer and fits everything in overview", () => {
    expect(curveOf({ x: 540, y: 0, w: 200, h: 100 }, 1280)).toBeCloseTo(0);
    expect(curveOf({ x: 1000, y: 0, w: 260, h: 100 }, 1280)).toBeLessThan(0);
    expect(curveOf({ x: 0, y: 0, w: 260, h: 100 }, 1280)).toBeGreaterThan(0);
    // Three windows piled on each other spread into separate tiles; a group shares one tile and keeps its layout.
    const pile = [win("a", 300, 150), win("b", 328, 178), win("c", 356, 206, { group: "g" }), win("d", 780, 206, { group: "g" })];
    const t = overviewTiles(pile, 1280, 820);
    const at = (id: string) => { const w = pile.find((x) => x.id === id)!; const o = t.get(id)!; return { x: w.x + o.dx, y: w.y + o.dy, s: o.s }; };
    expect(Math.abs(at("a").x - at("b").x) + Math.abs(at("a").y - at("b").y)).toBeGreaterThan(200);
    expect(at("c").s).toBe(at("d").s);
    expect(at("d").x - at("c").x).toBeCloseTo((780 - 356) * at("c").s);
  });
});
