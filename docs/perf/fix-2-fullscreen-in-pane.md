# Fix 2: A page's full screen stays inside its pane

Owner's report: full screen (Theater) showed as a large black-bordered rectangle floating over the Pod, with heavy letterbox bars and an "Exit" button on top. It should be inside the pane, in the same place, with no black frame and no popup look.

Code: `room.js` + `AetherDeckInputChild.sys.mjs` (patches: `fixes-and-cinema.patch`, `fix-1-2-cinema-room.patch`).

## Cause

A page's full screen (YouTube ⛶ or `f`) went through step 2's Theater, which:

- enlarged the pane to fill the view (1123×775);
- drew the page's full screen there with a big shadow: the "floating box";
- the video (16:9) inside a 1.45:1 rectangle got black bars above and below;
- relabelled the bar's Fit button to "Exit";
- and Firefox showed its "… is now full screen, Exit Full Screen (Esc)" notice at the top: the "popup".

## What changed

- **A page's full screen is now in place:**
  - The pane keeps its own place and size on the ring; the Pod turns to it if needed.
  - The page's full-screen `<browser>` is placed exactly in the pane's own rectangle, trimmed to the video's shape. The child actor answers `videoAspect` with the playing video's width ÷ height (16:9 assumed until it answers). So the video fills its area with **no letterbox bars**; the Pod shows above and below.
  - No shadow and no border; the pane's own 8 px corners.
  - The pane's own background (and the panel's inner backgrounds) are transparent while its page is in full screen, so there's no white or dark frame round the video.
  - The bar keeps "Fit"; "Exit" is used only for the F / Fit Theater.
  - Firefox's full-screen notice is off while the Pod is open (`full-screen-api.warning.timeout` = 0 on the default branch, never saved; restored to its default of 3000 when you leave the Pod). Esc still leaves full screen, and the page is visibly in its pane, not taking over the screen.
- **Unchanged:**
  - the other panes still go cold during full screen;
  - Esc or the page's own button ends it;
  - F / Fit still makes the bigger Theater (filling the view) for when you want that.

## Checked

| Check | Result |
|---|---|
| YouTube `f` in the front pane | full-screen `<browser>` at (423, 334) 435×245: the pane's own width at x = 423 (pane 423, 306, 435×300), 16:9 height, centred in the pane |
| Pane size unchanged | scale 1 |
| Notice | `full-screen-api.warning.timeout` = 0 in the Pod; 3000 again after leaving |
| Window | not OS full screen (window 1280×911) |
| Look | screenshot: the video fills its pane, no frame or bars, Pod and neighbouring panes visible, bar unchanged ("Fit") |
| Esc | full screen ended, Theater state cleared, all panes in view active again, YouTube still the front pane at scale 1 |

## Measurements: YouTube 1080p60, 8 panes, 8 s

| Case | Video shown/s (dropped) | Pod fps | p95 ms | >33 ms | Parent CPU % (main) | GPU proc % | Pictures/s |
|---|---|---|---|---|---|---|---|
| Full screen in the pane | 60 (0) | 60 | 18.6 | 0 | 20 (6) | 22 | 0 |
| Normal tab (same session) | 60 (0) | 60–60.1 | 17.6 | 0 | 15–17 (3–4) | 17–19 | — |

## Limits

- The pane is still small (fix 1): a video in its own pane is about 435 px wide in a 1280 px window. For a big picture, use **Fit** (Theater) or the **Cinema** (`cinema-pod.md`).
- Tested with YouTube's `f` key and Esc (automated keys), not a real click on ⛶.
