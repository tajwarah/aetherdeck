// Pure maths and rules behind the Room (chromium/room.html): the ring of panes in CSS 3D, the camera, which panes stay
// awake. The ring reuses shared/surround.ts, the same layout the Electron 360° room draws (pane order, gap, shrink-to-fit
// all the way round, the page ahead is the one in use). No chrome.* or DOM here; tests are in tests/unit/room.test.ts.
import { FOV, layoutPanels, turn, type Panel } from "../../shared/surround.ts";
import { nextPaneId, type PaneState } from "./panesLogic.ts";

export { FOV, turn };

/** Every pane gets the same page size, as in the Electron room (Surround.tsx ROOM_ASPECT), so text reads at its proper size. */
export const ROOM_ASPECT = 1.45;
export const PANE_W = 1100;
export const PANE_H = Math.round(PANE_W / ROOM_ASPECT);

/** At most this many panes in the room, and at most this many with a live page at once. */
export const MAX_ROOM_PANES = 8;
export const MAX_AWAKE = 6;
/** A pane that has been out of the nearest MAX_AWAKE for this long is put to sleep (its page is dropped). */
export const SLEEP_AFTER_MS = 20_000;
/** A pane further than this (radians) from where the camera looks sits behind a shield: a click turns to it. */
export const SHIELD_ANGLE = 0.35;

/** Session rule ids 6000..6999 belong to the Room (the Panes page uses 5000.., the cookie test 4242). */
export const ROOM_RULE_BASE = 6000;
export const roomRuleId = (paneId: number) => ROOM_RULE_BASE + paneId;
export const isRoomRuleId = (id: number) => id >= ROOM_RULE_BASE && id < ROOM_RULE_BASE + 1000;

export function addRoomPane(panes: readonly PaneState[], url = ""): PaneState[] {
  if (panes.length >= MAX_ROOM_PANES) return [...panes];
  return [...panes, { id: nextPaneId(panes), url, strip: false }];
}

export interface Ring { panels: Panel[]; radius: number }

/**
 * Where the panes stand: surround.ts gives each its direction and angular width on a ring you stand in the middle of; the
 * radius is the one at which a flat pane PANE_W wide, facing the centre, spans exactly that angle. Past about five panes
 * surround.ts shrinks them all to fit the 360°, which here means the ring simply grows.
 */
export function ringFor(ids: readonly string[]): Ring {
  const panels = layoutPanels(ids.map((id) => ({ id, aspect: ROOM_ASPECT })));
  const w = panels[0]?.width ?? layoutPanels([{ id: "x", aspect: ROOM_ASPECT }])[0].width;
  return { panels, radius: PANE_W / (2 * Math.tan(w / 2)) };
}

/** CSS `perspective` for a stage this tall and a vertical field of view (the same f = 1/tan(fov/2) as surround.ts). */
export const perspectiveFor = (stageHeight: number, fov: number) => stageHeight / 2 / Math.tan(fov / 2);

/** The camera: you stand in the ring's middle (pushed `back` pixels away from it when pulled back), looking along `yaw`. */
export const worldTransform = (yaw: number, perspective: number, back = 0) => `translateZ(${(perspective - back).toFixed(2)}px) rotateY(${yaw.toFixed(5)}rad)`;

/** A pane on the ring, facing the middle. CSS rotateY turns left for positive angles, surround.ts yaw is to the right. */
export const paneTransform = (yaw: number, radius: number) => `rotateY(${(-yaw).toFixed(5)}rad) translateZ(${(-radius).toFixed(2)}px)`;

/** How far back to stand to see the ring from inside its far side. */
export const overviewBack = (radius: number) => radius * 0.85;

export const clampFov = (fov: number) => Math.min(FOV.max, Math.max(FOV.min, fov));

export const shielded = (lookYaw: number, paneYaw: number, overview: boolean, direct: boolean) =>
  !direct && (overview || Math.abs(turn(paneYaw - lookYaw)) > SHIELD_ANGLE);

/** The panes that should have a live page: the `cap` nearest to where the camera looks. */
export function nearestIds(panels: readonly { id: string; yaw: number }[], lookYaw: number, cap = MAX_AWAKE): string[] {
  return [...panels].sort((a, b) => Math.abs(turn(a.yaw - lookYaw)) - Math.abs(turn(b.yaw - lookYaw))).slice(0, cap).map((p) => p.id);
}

export const sleepDue = (outSince: number | null, now: number) => outSince !== null && now - outSince >= SLEEP_AFTER_MS;

/** The next (1) or previous (-1) pane in ring order from the one nearest the camera. */
export function stepFrom(panels: readonly Panel[], lookYaw: number, dir: 1 | -1): Panel | undefined {
  if (!panels.length) return undefined;
  const at = panels.findIndex((p) => p.id === nearestIds(panels, lookYaw, 1)[0]);
  return panels[(at + dir + panels.length) % panels.length];
}

/** Turning by a drag of `dx` pixels at this perspective distance (about a pixel per 1/perspective radians near the middle). */
export const yawForDrag = (dx: number, perspective: number) => -Math.atan(dx / perspective);
