# Controls audit: every button in the Pod's bar and overlays, with real mouse clicks

How it was checked, for each control, at **1280 × 911** and at **760 × 760** (plus a probe at 900 × 760):

1. Find the control and its rectangle. Check that it is **on screen**, **not covered** (the element at its centre is the control itself), **not clipped** (`scrollWidth`/`scrollHeight` within its box), and that its text is centred.
2. Post a **real macOS mouse click** (a `CGEvent` mouse-move, -down and -up at its centre on screen) to the test window. **Safety:** before every click the test window is brought to the front, and the click is posted only if the window under that exact point is the test window. Some clicks were skipped this way while the Claude app's window was on top.
3. Check that the control received a **trusted** click (`isTrusted`) and **did its job**, then undo it.

The test window is a throwaway copy of the app with a throwaway profile. Nothing was signed in to.

## Problems found and fixed

| # | Problem | Cause | Fix |
|---|---|---|---|
| 1 | At 900 px wide, **More tabs, ⤢ and Leave were outside the window**: unreachable | the bar never wraps and its buttons were allowed to shrink | buttons never shrink (`flex: none`); the address box gives way first; the "Drag to look around" hint hides below 1440 px, the meter and the slider's length below 1000 px; **below 860 px the bar wraps onto two centred rows** |
| 2 | **Widgets** button squeezed: text spilling out (clipped, text 10–21 px off centre); Fit and Views text off centre by 2–4 px | same shrinking | same |
| 3 | **The Tabs list never appeared** (button worked, list stayed hidden: rows measured 0×0) | its CSS rule looked for it inside `<body>`, but it sits beside `<body>` | rule matches both (`body.ad-room ~ #ad-room-rail.open`) |
| 4 | Address box only 98 px wide at 1280 px | the hint text took the room | the hint gives way below 1440 px: the box is 246 px at 1280 |
| 5 | Cinema prompt closed by itself after 20 s (too short to read and decide) | timeout | 60 s |

## Result after the fixes

✓ = on screen, uncovered, unclipped, received a trusted real click and did its job.

| Control | 1280 × 911 | 760 × 760 (bar on two rows) | Notes |
|---|---|---|---|
| Address box ("Open a site as a pane, or search") | ✓ (246 px wide) | ✓ (245 px) | focused by the click |
| Tabs | ✓ | ✓ | opens the tab list |
| Tab list: a row | ✓ | ✓ | turns to that pane (marked "trusted: false" by the script only because the list redraws itself on click; the trusted click on the row was recorded) |
| Tab list: ✕ close | ✓ | ✓ | closed a throwaway tab (11 → 10 tabs) |
| Smaller − | ✓ | ✓ | pane scale below 100% |
| Size slider | ✓ | ✓ | pane scale changed |
| Bigger + | ✓ | ✓ | pane scale above 100% |
| Fit | ✓ | ✓ | Theater on (undone) |
| Cinema | ✓ | ✓ | cinema on (undone) |
| Home ⌂ | ✓ | ✓ | trusted click recorded (recentres; no visible state to check) |
| Views | ✓ | ✓ (second row) | opens the views menu |
| Views: "Plain dark" | ✓ | ✓ | background changed |
| Views: "Home office" | ✓ | ✓ | background photo back |
| Widgets (bar) | ✓ | ✓ | opens the shelf |
| Shelf tab ("Widgets ›" / "‹ Widgets") | ✓ | ✓ | closes / opens the shelf |
| Shelf: Reset | ✓ | ✓ | widgets back in the column |
| More tabs | ✓ | ✓ | opens the box |
| More tabs box: Swap in | ✓ | ✓ | the tab became a pane |
| Full screen ⤢ | ✓ | ✓ | window full screen (undone at once) |
| Leave | ✓ | ✓ | left the Pod (re-entered) |
| Meter ("8 live of 8 panes") | shown at 1280, hidden below 1000 px | hidden | information only; truncates with "…", full text in its tooltip |
| **Cosmonaut side panel** (home pane in front) | | | |
| – message box ("Ask Cosmonaut") | ✓ | — | focused by the click |
| – send ("Ask") | not clicked | — | disabled while the box is empty (correct); not sent, to avoid using the owner's AI key |
| – attach (paperclip) | ✓ | — | opened the macOS file chooser (then cancelled with Esc) |
| – minimise | ✓ | — | panel minimised |
| – close | ✓ | — | panel closed |
| **Cinema prompt** (Netflix landing page in a pane) | | | |
| – "Remember for netflix.com" | ✓ | — | ticked |
| – "Watch in Cinema" | ✓ | — | cinema on; `netflix.com: auto` saved; next load went straight to the cinema |

## fps after the overlap fix and the bar changes (final code)

YouTube 1080p60, 8 panes, 10 s per run, 2 runs:

| Case | Pod fps | p95 ms | >33 ms per 10 s | Main thread % |
|---|---|---|---|---|
| Front | 60 / 59.9 | 17.5–17.7 | 0 | 10 |
| Side | 57.7 / 59.6 | 16.7–17.5 | 0–1 | 16–17 |
| Behind | 60 / 60.1 | 17.4 | 0 | 5–7 |
| Turning | 59.9 / 60 | 16.7 | 0 | 10 |
| Normal tab | 60 / 60 | 17.7 | 0 | 3–4 |

No regression. `npx tsc --noEmit` passes; `npm test` 252/252.

Not checked with real clicks: the More tabs box's drag-a-row-onto-a-pane (a drag, not a click), widget drag/resize by hand (checked with window-level events in step 5), and the Cosmonaut panel at 760 px (the home pane's own layout; the panel's size is proportional, `placeSide`).
