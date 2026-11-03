import { describe, expect, it } from "vitest";
import { inView, hitPanel, layoutPanels, onPanel, TAU, toView, turn, type View } from "../../shared/surround.ts";

const view: View = { yaw: 0.4, fov: 1.08, aspect: 16 / 10 };
const items = (n: number, aspect = 1.6) => Array.from({ length: n }, (_, i) => ({ id: `w${i}`, aspect }));

describe("hanging pages around the room", () => {
  it("puts the first page straight ahead", () => expect(layoutPanels(items(3))[0].yaw).toBeCloseTo(0, 6));
  it("never overlaps two pages, however many there are", () => {
    for (const n of [2, 5, 12, 30]) {
      const ps = layoutPanels(items(n));
      for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) expect(Math.abs(turn(ps[i].yaw - ps[j].yaw))).toBeGreaterThanOrEqual((ps[i].width + ps[j].width) / 2 - 1e-9);
      expect(ps.reduce((a, p) => a + p.width, 0)).toBeLessThanOrEqual(TAU);
    }
  });
  it("copes with an empty room", () => expect(layoutPanels([])).toEqual([]));
});

describe("what you see is what you click", () => {
  const ps = layoutPanels(items(4));
  it.each([[0.5, 0.5], [0.1, 0.2], [0.9, 0.8], [0.3, 0.95]])("maps a pointer back to the page at %s, %s", (u, v) => {
    const look = { ...view, yaw: ps[1].yaw };
    const s = toView(look, ps[1], u, v)!;
    const hit = hitPanel(look, ps, s.x, s.y)!;
    expect(hit.panel.id).toBe("w1");
    expect(hit.u).toBeCloseTo(u, 6);
    expect(hit.v).toBeCloseTo(v, 6);
  });
  it("finds nothing on the empty wall", () => expect(hitPanel({ ...view, yaw: 0 }, layoutPanels(items(1)), 0, 0.98)).toBeNull());
  it("doesn't draw what's behind you", () => expect(toView({ ...view, yaw: Math.PI }, ps[0], 0.5, 0.5)).toBeNull());
  it("works across the point behind you, where the angle wraps", () => {
    const p = { id: "x", yaw: Math.PI - 0.05, width: 0.6, height: 0.9 };
    const look = { ...view, yaw: Math.PI };
    expect(hitPanel(look, [p], 0, 0)?.panel.id).toBe("x");
  });
  it("keeps a drag on its page when the pointer wanders off", () => {
    expect(onPanel(view, ps[0], 1, 1).u).toBeGreaterThanOrEqual(0);
    expect(onPanel(view, ps[0], 1, 1).v).toBeLessThanOrEqual(1);
  });
});

describe("inView", () => {
  const panel = { id: "a", yaw: 0, width: 1, height: 0.8 };
  it("sees what is ahead, and not what is behind you", () => {
    expect(inView({ yaw: 0, fov: 1, aspect: 1.5 }, panel)).toBe(true);
    expect(inView({ yaw: Math.PI, fov: 1, aspect: 1.5 }, panel)).toBe(false);
  });
  it("still sees a panel with only its edge in the window", () => {
    const side = Math.atan(Math.tan(0.5) * 1.5);
    expect(inView({ yaw: side + 0.45, fov: 1, aspect: 1.5 }, panel)).toBe(true);
    expect(inView({ yaw: side + 0.6, fov: 1, aspect: 1.5 }, panel)).toBe(false);
  });
});

describe("things hung on the wall", () => {
  it("sit where the wall is, grow toward the sides, and hide behind you", async () => {
    const { onWall, toWall } = await import("../../shared/surround.ts");
    const v = { yaw: 0.3, fov: 1.08, aspect: 1.6 };
    const ahead = onWall(v, 0.3, 0)!;
    expect(ahead.x).toBeCloseTo(0);
    expect(ahead.up).toBeCloseTo(1);
    const side = onWall(v, 0.8, 0.1)!;
    const back = toWall(v, side.x, side.y);
    expect(back.yaw).toBeCloseTo(0.8);
    expect(back.height).toBeCloseTo(0.1);
    expect(side.across).toBeGreaterThan(side.up);
    expect(onWall(v, 0.3 + Math.PI, 0)).toBeNull();
  });
});
