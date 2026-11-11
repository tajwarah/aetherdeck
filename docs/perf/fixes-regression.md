# Regression after fixes 1–3 and the cinema prototype

Same harness and machine as `final-regression.md` (unmodified 0.2.2 copy + the repo's working-tree Pod files, throwaway profile, Apple M3). Rerun for everything these changes touch. `npx tsc --noEmit` passes; `npm test`: **252/252**.

| Item | Result | Numbers |
|---|---|---|
| Pod fps, 5 cases × 2 runs (YouTube 1080p60, 8 panes) | **PASS** | front 60/60 · side 58.4/58.7 · behind 60/60 · turning 59.7/59.7 (0–1 hitches) · normal tab 60/60.1; main thread 10–11 / 16–17 / 6 / 12 / 3–4% |
| Reading zoom applied / removed | **PASS** | 1.25 on non-front panes in the Pod; 1.00 after leaving; 1.25 again after entering |
| Pointer shapes at 125% (actor) | **PASS** | link `pointer`, text `text` |
| Pointer mapping at 125% (window-level moves on a bent pane) | **PASS** | heading → `H1`, header → header copy, top → `NAV` |
| Scroll at 125% | **PASS** | 0 → 600 for a 600 px wheel |
| Click in a bent Settings pane at 125% | **PASS** | `#privacy` |
| More tabs count | **PASS** | "More tabs (1)" right after a background tab opened |
| F / Fit Theater | **PASS** | on, button "Exit"; off again |
| Page full screen in its pane | **PASS** | 435×245 at the pane's own spot, no notice, Esc back; 60 fps, main 6% |
| Leaving the Pod restores Firefox's full-screen behaviour | **PASS** | `ignore-widgets` false, `warning.timeout` 3000 |
| Widget shelf after re-entering | **PASS** | closed ("Widgets ›") |
| Cosmonaut side panel | **PASS** | (545, 84) 315×386, on screen, clear of the dock |
| Cinema on / full screen / Esc out | **PASS** | screen 1069×601; full screen on the screen; back to the ring with YouTube in front |
| Cinema cost | **PASS** | 60 fps, main 5%, GPU process 21% (normal tab: 3–4%, 17–19%) |

Not rerun this round (unchanged code paths): Import dialog, profile card, uBlock, Google sign-in page, sleep/wake, session restore, agent widgets. They passed in `final-regression.md` and nothing they use changed, except that pages now lay out at 125% in the Pod.
