# Fix 3: Cosmonaut and the agents' chat open as a side panel

Owner's report: the Cosmonaut/agent chat opened as a floating box in the middle of the home pane and sat behind or under the dock. It should open smoothly as a side panel docked to the right, never under the dock, with a short slide-in.

Code (patch `fix-3-cosmonaut-panel.patch`):

- `src/lib/windows.ts`: new `placeSide()`
- `src/App.tsx`: assistant windows use it, in `openTab` and `openAssistant`
- `src/components/Windows.tsx`: `is-side` class
- `src/styles.css`: slide-in, and the `.agents` console as a right panel

`npx tsc --noEmit` passes, `npm test` 252/252, and `dist/` is rebuilt (`vite build`).

## Cause

- **Cosmonaut ("AI" in the dock) opens as an ordinary window.** `placeWindow` put it in the middle (360 px around the middle of a 877×604 home pane). Then `openAssistant` resized it to 480×600, clipped to the page, which in a pane reached the bottom.
- **Windows are below the dock.** The windows layer has `z-index: 28`; the dock bar (`.controlbar`) has `z-index: 32`. So the window's lower part was under the dock.
- **The agents' console (`.agents`) was a centred box** at the top, up to `100vh - 200px` tall.

## What changed

- **Cosmonaut is a side panel on the right.**
  - It runs from just below the top bar (y = 84) to just above the dock bar. The dock bar's top is 116 px above the bottom, and the panel stops 132 px above it.
  - Width `min(420, max(300, 36% of the width))`, 16 px from the right edge.
  - It slides in from the right in 0.26 s (`win-side-in`) and is still a normal window (move, resize, minimise, close).
  - It never overlaps the dock, so the dock's higher layer doesn't matter.
  - Opening "About: this page" beside a window (the desktop app) is unchanged.
- **The agents' console (`.agents`) is the same kind of panel:** top 84 px, 16 px from the right, at most `100vh - 216px` tall (above the dock), up to 420 px wide, sliding in from the right.

## Checked (home pane in the Pod, 877×604 CSS px)

| Check | Result |
|---|---|
| "AI" in the dock → Cosmonaut | panel at (545, 84), 315×386; right edge 860 ≤ 876 (on screen); bottom 470 < dock-bar top 486: **no overlap with the dock**; screenshot shows it docked right, between the top bar and the dock |
| Before the second fix (the `openAssistant` resize) | it was 480×442 and ran off the right edge and over the dock. That's what the resize did; now fixed |
| Agents console | the CSS is changed as above. **Not seen on screen:** the dock's "Agents" button opens the Agent Station (a full workspace), not this console. The console opens from the voice/agents flow, which needs the owner's microphone and AI key. |

## Limits

- Two Cosmonaut panels opened one after another land in the same spot (the newer on top). That's fine for one chat; a second could stack below in a later pass.
- The Agent Station (the "Agents" button) is unchanged: a full-page workspace, not a chat panel.
