# Step 6: Performance modes and a governor (design, not built)

Not built in this round. Steps 2–5 took the time, and the measuring tool needed repair along the way. This is the design. The hooks it needs are already in the code from steps 3–5:

- **Tunables** (hidden prefs `aetherdeck.room.perf.*`, read live): `changeDriven`, `sideMs`, `sideScale`, `coldBehind`, `snapWhileTurning`, `movingStrips`, `bgStrips`.
- **Counters:** `window.adRoomTabs.perf` gives pictures, wait and draw ms per pane, total and per pane.
- **Mode pref:** `aetherdeck.room.mode` (`"balanced"` by default), already sent to the home page, whose Earth holds still in `"lite"`.

## The three modes

| | Spatial | Balanced (default) | Lite |
|---|---|---|---|
| Layout | the ring, bent panes | the ring, bent panes | **flat tiling**: panes as flat tiles in a grid (2×2, 3×3) or a row, no 3D, no bent strips |
| Front pane | live and flat (as now) | live and flat | every *visible* tile live, no pictures at all, up to 4 |
| Side pictures | 150 ms, 1× | 250 ms, 0.75× (today's defaults) | none (tiles are live) |
| Panes behind / off screen | cold | cold | asleep after 20 s (discarded), as the 8-pane cap does today |
| While turning | 18 strips, no pictures | 6 strips, no pictures | no turning: tiles scroll or page |
| 360° view | photo | photo | plain dark (no background strips) |
| Earth | turns in front | turns in front | still |
| Widgets | shelf | shelf | shelf |

**Why Lite is a flat grid.** At rest the Pod already matches a normal tab (step 3). What costs is the 3D scene: turning makes WebRender composite about 180 transformed layers (60–100% of a core in the GPU process). Flat tiles are ordinary panels, which the compositor handles like split view. Building it means a second `place()` that sets tile rectangles instead of ring transforms, `focusPane()` for every visible tile, and hit-testing with plain rectangles.

**Switching.** A "Mode" row in the Views menu (Spatial / Balanced / Lite), plus `aetherdeck.room.mode`. Changing it re-applies the tunables and `place()`.

## The governor: degrade in a fixed order when the Pod falls behind

**Measuring.** The Pod's own frames: a rolling 2-second window of `requestAnimationFrame` intervals, counted only while the window is visible (hidden windows throttle). Plus `perf.snapMs + perf.drawMs` per second.

**Triggers.**
- *Behind:* p95 frame time over 25 ms, or more than 5 frames over 33 ms per 2 s, for two windows in a row.
- *Comfortable:* p95 under 18 ms and no frame over 33 ms for 10 s in a row.

**Order of steps down** (one step per "behind" verdict, at most one step every 2 s):
1. **Earth still** (send `mode: "lite"` to the home page only).
2. **Widgets:** close the shelf, if an agent widget is animating (it shows a small "Widgets paused" note).
3. **Picture rate:** `sideMs` 250 → 500 → 1000, then `sideScale` 75 → 50.
4. **Strips:** `movingStrips` 6 → 4; then `bgStrips` 36 → 24 (rebuilds the background once).
5. Only if still behind: suggest Lite mode in the bar ("Turning feels slow: switch to Lite?"). Never switch by itself; changing the layout under someone is worse than a slow frame.

**Stepping back up.** One step at a time, in reverse, after each "comfortable" verdict. The level is shown in the meter's tooltip, e.g. "Smoothness: picture rate lowered".

**Guardrails.**
- Theater and the focused front pane are never degraded (they are live pages, not pictures).
- Media panes are never starved (step 3's media tier stays above the governor).
- Never touches site zoom, pane size or anything that changes what a page lays out.
- Resets to the mode's defaults on entering the Pod.

**Measuring the governor.** The same 5-case table, plus a stress case with all 8 panes animated (8 YouTube panes, or 4 + WebGL demos), on the M3 and on an 8 GB M1 if one is available. Pass if the governor holds p95 under 25 ms in every resting case and keeps turning above 45 fps, without stepping down in the five normal cases on the M3.

## What step 3's numbers say about priorities

- At rest, Balanced is already at 58–60 fps on the M3 (step 3), so the governor will rarely act there.
- **Turning is the case to govern.**
  - In the best runs, turning reached 60 fps with 6 strips (step 3).
  - In the same noisy session, it ranged 32–60 fps with the GPU process at 60–100%.
  - The two biggest levers are fewer strips and no background photo. Both are in the order above.
- The glide fix (step 3) may itself have cost turning smoothness. Re-measure before building the governor, since the governor would otherwise be compensating for it.
