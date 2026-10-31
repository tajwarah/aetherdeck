import { describe, expect, it } from "vitest";
import { SHRINK, scaleAt, toPage, toScreen } from "../../shared/curve.ts";

describe("curved screen", () => {
  it("fills the drawing at its sides and shrinks its middle", () => {
    expect(toScreen(0, 0)).toEqual({ x: expect.closeTo(-1, 6), y: expect.closeTo(1, 6) });
    expect(toScreen(1, 1)).toEqual({ x: expect.closeTo(1, 6), y: expect.closeTo(-1, 6) });
    expect(scaleAt(0.5)).toBeCloseTo(1 - SHRINK, 6);
  });

  it("maps a pointer back to the exact point of the page under it", () => {
    for (const [u, v] of [[0.02, 0.03], [0.5, 0.5], [0.97, 0.1], [0.3, 0.92], [0.75, 0.6]]) {
      const s = toScreen(u, v);
      const p = toPage(s.x, s.y)!;
      expect(p.u).toBeCloseTo(u, 5);
      expect(p.v).toBeCloseTo(v, 5);
    }
  });

  it("finds no page above or below the bowed edges", () => {
    expect(toPage(0, 0.99)).toBeNull(); // top middle: the page curves away below it
    expect(toPage(0, -0.99)).toBeNull();
    expect(toPage(-0.999, 0.99)).not.toBeNull(); // the sides stand full height
  });
});
