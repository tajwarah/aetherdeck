# Step 2: Theater (full screen stays inside the Pod)

Code: `browser/room-src/browser/components/aetherdeck/room.js` (uncommitted; diff in `step-2-theater.patch`, cumulative from the start of this work).
Tested 2026-11-11 on an unmodified copy of the 0.2.2 app with the repo's Pod files loaded into its window (harness: the app's stock Pod switched off by pref in a throwaway profile, the repo's `aetherdeck/` folder registered as `chrome://addev/` and loaded into the window). Apple M3, window 1280×911.

## What it does

- **How Theater starts:** the **Fit** button, the **F** key, or a page asking for full screen (YouTube's ⛶ button or its `f` key).
- **What it looks like:** the pane fills the view, above the bar, as the flat live page (the same path as the sharp front pane). The Pod (the 360° view) stays visible around it.
- **The other panes go cold:** `docShellIsActive = false`, `renderLayers = false`, and no pictures. The home pane is one of them, so its Earth animation stops too.
- **Clutter tucks away:** widgets, the More tabs box and the tab rail hide (`:root[data-ad-theater]`).
- **How it ends:** **Esc** (also while the page has the keyboard), **F**, the button (labelled **Exit** during Theater), or the page leaving its full screen. The pane goes back to its size and place on the ring, and every live pane is active again.
- **A page's own full screen never takes the Mac's screen:**
  - **Staying in the window.** While the Pod is open, `full-screen-api.ignore-widgets` is set on the *default* branch, so it is never saved to the profile, and is unset when you leave the Pod. Firefox then keeps the page's full screen inside the window. The page itself believes it is in full screen: `document.fullscreenElement` is set, YouTube shows its full-screen player, and Esc works as usual.
  - **Placing it in Theater.** Firefox puts the page's `<browser>` in the window's top layer, which fills the window with a black backdrop and ignores the Pod's 3D placement. A small *agent-level* style sheet (`windowUtils.loadSheetUsingURIString(..., AGENT_SHEET)`, so it can outrank Firefox's built-in `:fullscreen` rules) puts it in the Theater rectangle instead, with a transparent backdrop.
  - **The selected tab.** Firefox only lets the *selected* tab go full screen (`FullScreen.enterDomFullscreen` checks `gBrowser.selectedBrowser`), so the Pod now selects the tab of the pane you click or face (`selectPane`).
- **Theater fills the view.** Growing a pane can widen the ring, which shrinks every pane on screen, so Theater sizes the pane twice. The first try was 761×525; it's now 1123×775 in a 1280×911 window.

## Checked (automation, throwaway profile)

| Check | Result |
|---|---|
| YouTube `f` in the front pane → Theater, window not OS full screen | ✓ `document.fullscreenElement` = the pane's `<browser>`, Theater pane = YouTube, rectangle 1123×775 at (79, 30), window still 1280×911 |
| Pod visible around it, widgets hidden | ✓ (screenshot), `#ad-widgets` display none |
| Other panes cold | ✓ 7 of 8 panes `docShellIsActive=false`, `renderLayers=false`; pictures per second 0 |
| Esc (from the page) → back to the ring | ✓ full screen left, Theater ended, YouTube back to scale 1, all 8 panes active, YouTube still the sharp front pane |
| F / Fit without the page's full screen | ✓ same Theater, only that pane active, widgets hidden |

## Measurements: YouTube 1080p60, 8 panes, 10 s per run

| Case | Video shown/s (dropped) | Pod fps | p95 ms | >33 ms per 10 s | Parent CPU % (main) | GPU process % | Pictures/s |
|---|---|---|---|---|---|---|---|
| **Theater from the page's full screen** | 59.9 (0) | 60 | 18.5 | 0 | 13 (4) | 25 | 0 |
| **Theater from F**, run 1 | 60 (0) | 60 | 18.5 | 0 | 14 (5) | 24 | 0 |
| **Theater from F**, run 2 | 59.9 (0) | 60.1 | 18.6 | 0 | 14 (4) | 24 | 0 |
| Plain tab (same build, same session), run 1 | 60 (0) | 60 | 18.6 | 0 | 14 (4) | 18 | — |
| Plain tab, run 2 | 60 (0) | 60 | 18.6 | 0 | 15 (4) | 17 | — |
| *For reference, from `perf-pod-0.2.2.md`:* YouTube as the resting front pane, 0.2.2 | 60 (0) | 52–55 | 33 | 18–23 | 51–52 (42–43) | 29–32 | 20.4 |

**Theater is as smooth as a plain tab.** It runs at 60 fps with no hitches and the same main-thread load (4–5% vs 4%). The only extra cost is about 6–7 points of GPU-process CPU, for compositing the Pod around the video. Compared with 0.2.2's front pane, the main thread drops from 42% to 5%.

## Not covered / limits

- Tested with automated keys (YouTube's `f`, Esc), not a real mouse on YouTube's ⛶ button. The path is the same (`requestFullscreen` from a user gesture), but the owner should click ⛶ once.
- The page's own full-screen notice ("… is now full screen, press Esc") is Firefox's own and still shows.
- YouTube's "Something went wrong" after about 50 s (YouTube reacting to automation, seen in plain tabs too) still limits runs to about 20 s after a reload.
- A Theater pane that later navigates or closes ends Theater (closing is handled; navigation keeps it in Theater).
