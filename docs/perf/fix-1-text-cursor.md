# Fix 1: Text and pointer marks in the Pod

Owner's report: in bent side panes text is blurry and small; pointer shapes and text carets look wrong or missing.

Code: `room.js` (cumulative patch `fixes-and-cinema.patch`; room part also in `fix-1-2-cinema-room.patch`). Tested in the dev harness (unmodified 0.2.2 app copy + the repo's Pod files, throwaway profile), Apple M3, window 1280×911.

## What I found

1. **The real cause: panes are small on screen.**
   - With 8 panes round the ring, the ring's radius grows to 1514 px. A pane then shows at only `P / R` = 599 / 1514 ≈ **0.40** of a normal tab's size.
   - The front pane is about 435 px wide in a 1280 px window, and its live page was zoomed to about **40%**.
   - At that size, body text is about 5–6 px tall, and the text caret is 1 CSS px × 0.4 ≈ **0.8 device px** wide. That's why carets looked missing.
   - Side panes are the same size, seen at an angle.
2. **Side pictures were drawn at a fixed 0.75** page pixels per page pixel. That turned out to be roughly what the screen needs at this size (0.79 device px per page px), so it wasn't the main cause. But a fixed number is wrong for other window sizes and pane zooms.
3. **A side pane under the pointer stayed at its low-resolution picture.** Since step 3, a picture is redrawn only when the page changes, so pointing at a side pane didn't sharpen it.
4. **Pointer shapes are mapped correctly.** I checked by recording where the page receives replayed moves:
   - on MDN's heading → `H1`; on its search box → the search element; on the menu → the menu button;
   - over a link `pointer`, over text `text`, over empty space `default`.

## What changed

- **Reading zoom for pages in panes:** `aetherdeck.room.perf.pageZoom`, default **125**.
  - Pages in the Pod are laid out at 125%: 877 instead of 1096 CSS px wide.
  - Text and the caret are 25% bigger in every pane, live or bent; the front pane's page now shows at about 49% instead of 40%.
  - It is re-applied every second, because Firefox resets zoom when a page navigates.
  - Tabs go back to 100% when you leave the Pod.
  - Replayed pointer coordinates are divided by the page's zoom, so clicks and pointer shapes still land on the right element.
- **Picture resolution follows the screen:** device px per page px = `dpr × (P / R) × pane size × page zoom`.
  - The pane you point at gets all of it (capped at 2); other panes 90% of it (0.75–1.6).
  - `sideScale` is now "automatic" unless set.
- **Sharpen on demand:** if the wanted resolution is higher than the picture's, the pane is redrawn even though the page didn't change (pointing at a side pane sharpens it).

## Checked

| Check | Result |
|---|---|
| Zoom on all panes | 1.25 on every non-front pane; the front pane's live page shows at 0.49 (was 0.40) |
| Pointer mapping at 125% (window-level moves over bent MDN) | heading → `H1`, header area → header copy, top → `NAV` (correct elements) |
| Pointer shapes at 125% (Wikipedia, through the input actor) | link `pointer`, text `text` |
| Scroll at 125% | wheel 600 → page scrollY 0 → 600 |
| Click in a bent Settings pane at 125% | "Privacy & Security" → `#privacy` |
| Leaving the Pod | every tab back to 100% |
| Screenshot | text in the front Wikipedia pane and the bent MDN pane visibly larger |

## fps: no regression

YouTube 1080p60, 8 panes, 10 s per run.

| Case | Before (step 3) | Reading zoom, run 1 / 2 | Final build of all fixes, run 1 / 2 |
|---|---|---|---|
| Front | 60 fps, main 9–10% | 60 / 59.9 fps, main 10% | 60 / 60 fps, p95 17.5–17.6, main 10–11% |
| Side | 58–59 fps, main 18–19% | 58.8 / 58.5, main 16% | 58.4 / 58.7, p95 17.1–17.2, main 16–17% |
| Behind | 60 fps, main 6% | 60.1 / 60, main 6–7% | 60 / 60, main 6% |
| Turning | 60 fps (first batch) | 60 / 60, 0 hitches | 59.7 / 59.7, 0–1 hitches |
| Normal tab | 60 fps, main 3–4% | — | 60 / 60.1, main 3–4% |
| Side with `pageZoom=100` (A/B) | — | 58.4 / 58.6, main 18% | — |

Side picture time went *down* slightly with the zoom (201 ms/s waited, against 218 at 100%), because pages laid out at 877 px have less to paint.

## Not fixed (design limits, for the owner to decide)

- **Panes are still small with 8 panes:** about 34% of the window width. Bigger fixes would change the layout:
  - fewer panes in view;
  - a default pane size above 100% (the bar's +/− already does it per pane);
  - or a higher default reading zoom (try `pageZoom` 150; pages then lay out at 730 px, and some sites switch to their tablet layout).
- A real-mouse check of carets and pointer shapes by the owner. I can't see the screen pointer in captures.
