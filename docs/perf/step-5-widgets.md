# Step 5: Widgets, off the critical path

Code: `room.js` (uncommitted; `step-5-widgets.patch` is cumulative).

## What changed

- **A shelf on the left edge, closed by default.** A "Widgets ›" tab sits on the left edge of the Pod. It, or the Widgets button in the bar, opens and closes the shelf; while open it reads "‹ Widgets" and has a **Reset** tab below it.
  - The open/closed state is kept in a new pref, `aetherdeck.room.widgetShelfOpen` (default false). The old `aetherdeck.room.widgets` (default *shown*) is no longer read.
  - When an agent places a widget, the shelf opens so you see it.
- **A fixed safe zone in the middle of the view:** 22–78% of the width, 10–82% of the height (where the front pane is). No widget can sit there: a widget dragged or resized into it moves to the nearest place outside.
- **Snap grid:** 16 px; positions are rounded to it.
- **No overlap:**
  - a widget that would overlap another moves down its column, then to the next column;
  - widgets are never wider than the band beside the safe zone, so they always fit (at 1280 px wide: at most 241 px);
  - only if the screen is truly full does one overlap another, rather than falling off screen.
- **Defaults:** a column down the left edge, clear of the shelf tab (x = 32, y = 16, 112, 208…); agent widgets join below.
- **One-click reset:** **Reset** puts every widget back in the column, hidden ones included. Double-clicking one widget still resets just that one.
- **Theater:** the shelf and widgets hide; they come back afterwards.
- **Flat glass:** `rgba(30,26,52,.86)` instead of a gradient with `backdrop-filter: blur(14px)`. A blur has to be recomputed under each widget whenever what's behind it moves.
- **Bug fixed along the way:** a hidden widget measures 0×0. The resize watcher used to save that size during Theater, which shrank every widget to the CSS minimum, 130×64. It now ignores widgets that aren't rendered.

## Checked (automation, throwaway profile)

| Check | Result |
|---|---|
| Closed by default | ✓ only the "Widgets ›" tab shows; 0 widgets displayed |
| Open: layout | ✓ 3 widgets at (32,16), (32,112), (32,208) [checked at x=16 before the shelf-tab shift]; 0 in the safe zone, 0 overlaps, 0 off the grid |
| Agent widget (saved through the bridge, `widgets:save`) | ✓ joins the column below, 0 overlaps; still a sandboxed `data:` page with an opaque origin (`isNullPrincipal` true) |
| Real drag (window-level mouse events) to the middle of the window (640, 455) | ✓ ended at (1008, 416): just right of the zone, on the grid |
| Resize to 300×200 (overlapping the widget below) | ✓ capped to 265 px wide [before the last 24 px change] and moved to (16, 304): 0 overlaps, 0 in the zone |
| Reset | ✓ dragged widget back at the top of the column |
| Theater | ✓ `#ad-widgets` and `#ad-shelf` display none; back after; sizes kept (the bug above) |
| Flat glass | ✓ `backdrop-filter: none` |

## Measurements: does showing widgets cost frames?

YouTube 1080p60, 8 panes, 10 s per run, 3 built-in widgets.

| Run | Pod fps (round 1 / round 2) | >33 ms | GPU proc % |
|---|---|---|---|
| Turning, shelf closed | 59.8 / 34.9 | 0 / 56 | 60 / 70 |
| Turning, shelf open (flat) | 59.8 / 35.5 | 1 / 76 | 66 / 104 |
| Turning, shelf open (old blur, injected for the test) | 59.7 / 46.3 | 1 / 31 | 59 / 76 |
| Side, shelf closed | 57.6 / 53.0 | 7 / 26 | 27 / 47 |
| Side, shelf open (flat) | 58.2 / 58.0 | 2 / 1 | 26 / 26 |
| Side, shelf open (blur) | 58.4 / 58.3 | 4 / 1 | 28 / 26 |

**No measurable difference between closed, flat and blur.** Round 1 is flat across all six. Round 2 was disturbed for every setting, including the "closed" ones, even dropping 25 video frames with the shelf closed. That points to the machine, not the widgets. With only a few small widgets, the blur's cost is lost in the noise on an M3. The redesign keeps them off the critical path (closed by default, out of the middle, no blur) rather than measurably speeding anything up today. More or bigger agent widgets would make the difference larger.

## Not covered

- A real mouse drag of a widget by hand, and the CSS resize corner by hand (the test resized by setting the size).
- Narrow windows: the zone is proportional; below about 760 px wide the side band is just 130 px, the minimum widget width.
