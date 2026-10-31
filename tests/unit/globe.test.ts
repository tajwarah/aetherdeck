import { describe, expect, it } from "vitest";
import { geoDistance, geoOrthographic } from "d3-geo";
import { onSphere, project, view } from "../../src/lib/globe.ts";

describe("globe projection", () => {
  it("matches d3's rotated orthographic projection and its distance from the centre", () => {
    const pts: [number, number][] = [[8.54, 47.37], [139.69, 35.68], [-74, 40.71], [55.27, 25.2], [-46.63, -23.55], [0, 0], [179, -60]];
    for (const [lon0, lat0] of [[30, -16], [123.4, -16], [-80, 10]]) {
      const proj = geoOrthographic().scale(640).translate([512, 900]).rotate([-lon0, -lat0]);
      const out = new Float32Array(pts.length * 3);
      project(onSphere(pts), view(lon0, lat0, 640, 512, 900), out);
      pts.forEach((p, i) => {
        const facing = Math.cos(geoDistance(p, [lon0, lat0]));
        expect(out[i * 3 + 2]).toBeCloseTo(facing, 4);
        if (facing > 0.01) {
          const [x, y] = proj(p)!;
          expect(out[i * 3]).toBeCloseTo(x, 1);
          expect(out[i * 3 + 1]).toBeCloseTo(y, 1);
        }
      });
    }
  });
});
