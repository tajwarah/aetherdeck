# Fix 4: Panes overlapping round the ring

Owner's report (rebuilt app): the left pane (NASA) overlapped the centre pane (OpenStreetMap), which overlapped the right pane (AetherDeck home).

Code: `room.js` `place()` (patch: `fixes-and-cinema.patch`).

## Cause

The overlap was at the ring's **seam**, where the last pane meets the first. NASA, OpenStreetMap and home are panes 6, 7 and 0.

- `place()` gives each pane its width as an angle (`width / radius`) plus a fixed **0.07 rad gap**. When 8 panes don't fit round the circle, it widens the ring by `total / 2π`.
- That shrinks the panes' angles but **not the gaps**, so the total still came to more than a full turn: 8 × 0.727 + 8 × 0.07 = 6.37 rad against 6.28.
- The last pane therefore met the first with only 0.710 rad between their centres, against 0.797 everywhere else. The 0.087 rad shortfall ate the whole gap at the seam. Bent panes' edges also curl slightly towards you (their edges reach about 0.012 rad further round than their arc), which made the panes overlap there.

It doesn't depend on window size or the reading zoom (pane geometry is in the Pod's own units), and the moving strips use the same outline. Pane size (+/−, slider, Fit) and the curve amount do change it, and those are covered below.

## Fix

- **True angular half-widths.** Each pane's share of the circle is now `atan(half-width / (radius − curl))`, where curl is how far its bent edges come towards you at the current curve amount and pane size. That's the angle its edges really reach.
- **Gaps always fit.** When the panes are too many or too big, the ring's radius is solved (iteratively) so that **panes plus every gap** add up to exactly one turn.
- **Curve changes re-lay the ring.** Letting go of the curve slider in Views re-lays the ring at the new curl.

## Checked: angular gap between every pair of neighbours, seam included (rad; 0 or less would be an overlap)

| Layout | Ring radius | Gaps (pane 0→1 … 7→0) | Smallest |
|---|---|---|---|
| Before the fix (from the layout read in the Pod) | 1514 | 0.07 × 7, seam ≈ −0.017 after curl | **overlap at the seam** |
| 8 panes, all 100% | 1528 | 0.07 0.07 0.07 0.07 0.07 0.07 0.07 0.073 | 0.07 |
| One pane at 220% (enlarged with the slider) | 1734 | 0.07 … 0.072 | 0.07 |
| Worst case: curve raised to 100% *without* re-laying out | 1734 | 0.043 … 0.004 | 0.004 (still no overlap) |
| Back to 100% | 1528 | as the first row | 0.07 |

Screenshot at the seam (OpenStreetMap in front): clear gaps to NASA on the left and home on the right (`lag/ov2.png` in the scratch folder; before: `ov1.png`, home touching OpenStreetMap).

The window was also resized to 900 × 760 and 760 × 760 during the controls audit: the geometry doesn't depend on window size, and no overlap appeared.

fps after the fix: see `controls-audit.md` (same final run).
