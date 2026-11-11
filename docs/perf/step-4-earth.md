# Step 4: The home pane's Earth turns only when it is in front

Code (uncommitted; `step-4-earth.patch` is cumulative):

- `room.js`: `notifyHome()`
- `src/App.tsx`: the `pod:view` state, passed to `<Earth still>`
- `src/lib/desktop.ts`: `RoomBridge` type with the optional `on`

`npx tsc --noEmit` passes. The web app was rebuilt into `dist/` (`npx vite build`), so the local server on 8787 serves it.

## What it does

- **The Pod tells the home page whether it is the one in front.** It uses the existing bridge event channel (`AetherDeckBridge.emit("pod:view", { front, mode })` → `window.aetherdeckRoom.on("pod:view")`). It sends this when the front pane changes, on entering and leaving the Pod, and once a second as a backstop; it only sends when the value changed.
- **When the Earth turns:**
  - **Turns:** home is the flat front pane, or the Theater pane; or the Pod is closed (a normal tab, where Firefox's own hidden-tab rule already stops it).
  - **Holds still** (it is drawn once, then not redrawn): home is beside you; or Lite mode (`aetherdeck.room.mode = "lite"`, used by step 6).
  - **Behind you:** the home pane is cold (step 3), so the page is hidden and Earth stops by its existing `document.hidden` check.

## Measurements

Home pane beside you (GitHub in front, YouTube 1080p60 playing in view), 6 s per run, CPU from the processes' own counters. Old behaviour forced by sending `front: true` to the page:

| Earth | Home page process CPU % | GPU process CPU % |
|---|---|---|
| Turning (old: front forced true), run 1 | 7.2 | 39.9 |
| Still (new), run 1 | 6.5 | 37.5 |
| Turning, run 2 | 7.6 | 39.7 |
| Still, run 2 | 6.5 | 37.1 |

Whole-Pod runs (10 s, same layout): Pod fps 58.0–58.6 turning vs 57.8–58.2 still, GPU 28–29% vs 26–27%.

**The saving is small: about 1 point of the home page's CPU and 2–3 points of the GPU process.** Earth was already cheap (30 fps WebGL, low-power context, one quad). The bigger win for the home pane came from step 3: behind you it is cold (0% for its pictures), and its WebGL frames don't produce paint notes, so a turning Earth beside you no longer costs pictures.

## Limits

- The home page's process stays at about 6.5% CPU with Earth still. Something else on the page is busy (it sends about 4 paint notes a second either way); not investigated.
- Lite mode exists only as the pref; the switch to choose it is step 6.
