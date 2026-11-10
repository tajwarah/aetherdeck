import { describe, expect, it } from "vitest";
import { buildRule } from "../../chromium/src/panesLogic.ts";
import { addRoomPane, clampFov, FOV, isRoomRuleId, MAX_ROOM_PANES, nearestIds, overviewBack, paneTransform, PANE_W, perspectiveFor, ringFor, roomRuleId, shielded, SLEEP_AFTER_MS, sleepDue, stepFrom, worldTransform, yawForDrag } from "../../chromium/src/roomLogic.ts";

describe("the ring", () => {
  it("puts the first pane straight ahead and the rest to its right, in order", () => {
    const { panels } = ringFor(["1", "2", "3"]);
    expect(panels[0].yaw).toBeCloseTo(0, 5);
    expect(panels[1].yaw).toBeGreaterThan(panels[0].yaw);
    expect(panels[2].yaw).toBeGreaterThan(panels[1].yaw);
  });
  it("shrinks the panes' angle to fit all the way round and grows the radius to keep their pixel width", () => {
    const few = ringFor(["1", "2", "3"]);
    const many = ringFor(["1", "2", "3", "4", "5", "6", "7", "8"]);
    expect(many.panels[0].width).toBeLessThan(few.panels[0].width);
    expect(many.radius).toBeGreaterThan(few.radius);
    // a flat pane PANE_W wide at that radius spans exactly the panel's angle
    expect(2 * many.radius * Math.tan(many.panels[0].width / 2)).toBeCloseTo(PANE_W, 3);
  });
  it("has a radius even with no panes", () => {
    expect(ringFor([]).radius).toBeGreaterThan(0);
  });
});

describe("the camera's CSS", () => {
  it("looks at a pane by turning the world the way the pane sits", () => {
    expect(paneTransform(0.5, 800)).toBe("rotateY(-0.50000rad) translateZ(-800.00px)");
    expect(worldTransform(0.5, 600)).toBe("translateZ(600.00px) rotateY(0.50000rad)");
    expect(worldTransform(0, 600, 200)).toBe("translateZ(400.00px) rotateY(0.00000rad)");
  });
  it("uses the surround.ts focal length", () => {
    expect(perspectiveFor(800, FOV.start)).toBeCloseTo(400 / Math.tan(FOV.start / 2), 6);
    expect(clampFov(0.1)).toBe(FOV.min);
    expect(clampFov(9)).toBe(FOV.max);
  });
  it("pulls back to see the ring from inside its far side", () => {
    expect(overviewBack(1000)).toBeGreaterThan(500);
    expect(overviewBack(1000)).toBeLessThan(1000);
  });
  it("turns against a drag", () => {
    expect(yawForDrag(100, 600)).toBeLessThan(0);
    expect(yawForDrag(-100, 600)).toBeGreaterThan(0);
  });
});

describe("shields and sleep", () => {
  it("lets near panes take clicks, shields far ones and all of them in the overview, unless direct mode", () => {
    expect(shielded(0, 0.2, false, false)).toBe(false);
    expect(shielded(0, 0.9, false, false)).toBe(true);
    expect(shielded(0, 0, true, false)).toBe(true);
    expect(shielded(0, 0.9, true, true)).toBe(false);
    expect(shielded(3.0, -3.0, false, false)).toBe(false); // across the ±π seam: 0.28 rad apart
  });
  it("keeps the nearest panes awake, across the seam", () => {
    const panels = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => ({ id: String(i), yaw: -3 + i * 0.8 }));
    expect(nearestIds(panels, 0, 3)).toEqual(["4", "3", "5"]);
    expect(nearestIds(panels, 0, 99)).toHaveLength(8);
    expect(nearestIds([{ id: "a", yaw: 3.1 }, { id: "b", yaw: 0 }], -3.1, 1)).toEqual(["a"]);
  });
  it("puts a pane to sleep only after it has been out of the set a while", () => {
    expect(sleepDue(null, 1e9)).toBe(false);
    expect(sleepDue(1000, 1000 + SLEEP_AFTER_MS - 1)).toBe(false);
    expect(sleepDue(1000, 1000 + SLEEP_AFTER_MS)).toBe(true);
  });
  it("steps to the next and previous pane round the ring", () => {
    const { panels } = ringFor(["1", "2", "3"]);
    expect(stepFrom(panels, panels[0].yaw, 1)?.id).toBe("2");
    expect(stepFrom(panels, panels[0].yaw, -1)?.id).toBe("3");
    expect(stepFrom([], 0, 1)).toBeUndefined();
  });
});

describe("room panes", () => {
  it("are capped at eight", () => {
    let panes = addRoomPane([]);
    for (let i = 0; i < 12; i++) panes = addRoomPane(panes);
    expect(panes).toHaveLength(MAX_ROOM_PANES);
  });
  it("keep their rules apart from the Panes page, and still never for Google", () => {
    expect(isRoomRuleId(roomRuleId(2))).toBe(true);
    expect(isRoomRuleId(5002)).toBe(false);
    expect(isRoomRuleId(4242)).toBe(false);
    expect(buildRule(1, "mail.google.com", 9)).toBeNull();
    expect(buildRule(1, "accounts.google.com", 9)).toBeNull();
  });
});
