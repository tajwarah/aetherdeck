# Cinema Pod: design and first prototype

Goal: in the Pod you put one tab "in the cinema". You sit in a theatre, and that tab's page is on the cinema screen. It must be cheap on the GPU, and DRM video must show, which rules out bent pictures (`drawSnapshot` can't capture decrypted frames; step 1).

Code: `room.js` (prototype; patch `fix-1-2-cinema-room.patch` / `fixes-and-cinema.patch`).

## Design

| Piece | Approach | Why |
|---|---|---|
| The room | A **still auditorium drawn in CSS** (`#ad-cinema`): dark gradient, curtains at both sides, a soft glow from the screen, three rows of seat silhouettes along the bottom. It is drawn once and never changes. | No 3D, no 360° photo, no WebGL: the compositor has one static layer. A licensed or CC0 cinema photo can replace the gradients later (a single flat image, same cost). |
| The screen | **The tab's own live page**, flat, in a fixed 16:9 rectangle: 84% of the width or 66% of the height, 7% from the top. Its page is zoomed so it lays out as a 1280-px-wide tab. | A live page is the only way DRM video shows, and the cheapest way to show video (no pictures at all). |
| The Pod's 3D | Switched off while in the cinema. Hidden: the 360° background, the bent strips, the pointer layer and the widget shelf. `apply()` does nothing 3D. | Nothing to composite but the room image and one page. |
| Other panes | **Cold** (`docShellIsActive=false`, `renderLayers=false`) and hidden, with no pictures. The cinema pane is the only active page. Media panes elsewhere are also cold in the prototype, so audio from another pane pauses with its page's own background rules. | Cheapest possible; a "keep audio playing" exception is easy to add if wanted. |
| Full screen | A page's own ⛶ in the cinema fills the cinema screen (same agent-sheet rule as Theater, with the screen's rectangle). Esc goes back to the page on the screen. | The video gets the whole screen, with no popup. |
| Controls | A **Cinema** button in the Pod's bar (it reads **Leave cinema** while in it). **Esc** leaves too, unless the page is in full screen, where Esc first leaves full screen. Leaving the Pod or closing the tab also ends the cinema. On leaving, the tab returns to its place on the ring as the front pane, at the normal reading zoom. | |

## Checked (dev harness, throwaway profile, YouTube 1080p60, 8 panes)

| Check | Result |
|---|---|
| Cinema on the YouTube pane | screen at (106, 64), 1069×601 (16:9) in a 1280×911 window; page zoom 0.835 (1280-px layout); 1 of 8 panes active; button reads "Leave cinema" |
| Look | screenshot: auditorium with curtains and seat rows, YouTube on the screen, the Pod's bar below |
| YouTube `f` in the cinema | full-screen `<browser>` exactly on the screen, (106, 64) 1069×601; the window stays a window |
| Esc ×2 | first leaves YouTube's full screen; then leaves the cinema: back in the Pod, YouTube the front pane (zoom 0.49 = 1.25 × ring scale), 360° background back, panes in view active again |

## Measurements (8 s each)

| Case | Video shown/s (dropped) | Pod fps | p95 ms | >33 ms | Parent CPU % (main) | GPU proc % | Pictures/s |
|---|---|---|---|---|---|---|---|
| **Cinema, YouTube page on the screen** | 60 (0) | 60 | 18.1 | 0 | 16 (5) | 21 | 0 |
| **Cinema, YouTube in full screen on the screen** | 60 (0) | 60 | 18.2 | 0 | 17 (5) | 21 | 0 |
| Normal tab (same session, same build) | 60 (0) | 60–60.1 | 17.6 | 0 | 15–17 (3–4) | 17–19 | — |
| Pod, YouTube as the front pane (for comparison) | 60 (0) | 60 | 17.5–17.6 | 0 | 18–19 (10–11) | 29–30 | 7.8 |

**The cinema costs about what a normal tab costs:** main thread 5% against 3–4%, and GPU-process CPU 21% against 17–19%. That's cheaper than the Pod itself (GPU 29–30%, main 10–11%), because nothing 3D is composited and no pictures are made.

## Rule: streaming and DRM pages are offered the Cinema (built)

Protected (DRM) video can't be shown in a bent pane: decrypted frames are left out of pane pictures. So the Pod offers the Cinema whenever a pane is about to show some.

**Decision: a one-click prompt the first time, then remembered per site.**
- **Why not automatic from the start?** It would yank a tab out of the ring when someone only meant to browse a service's catalogue.
- **Why not prompt every time?** That would nag regular viewers.

**When it's offered:**
1. **The page starts protected media in any frame.** Firefox announces this in the page's process as `mediakeys-request`, with status `available` or `cdm-created`. The Pod's own input actor now observes that topic (`observers: ["mediakeys-request"]`) and tells the Pod (`AetherDeckPaneEME`). Clear Key is ignored: it isn't protected from capture.
2. **A pane loads a known streaming service:** netflix.com, primevideo.com, amazon.\*/gp/video, disneyplus.com, max.com, hbomax.com, hulu.com, tv.apple.com, peacocktv.com, paramountplus.com, crunchyroll.com. This is checked 1.5 s after the page loads. It catches services before playback starts, e.g. while signing in or browsing the catalogue.

**The prompt:**
- A small card at the top of the Pod: "*Tab name* plays protected video, which can't show on a bent pane. Watch it in the Cinema?", or "…is a streaming service: its videos are protected…".
- **[Watch in Cinema]**, **[Not now]**, and **☐ Remember for *site***.
- It stays 60 s and isn't shown inside the Cinema. It's asked once per page, unless protected playback actually starts.

**Remembered** in `aetherdeck.room.cinemaSites` (`{ "netflix.com": "auto" | "never" }`):
- **auto:** the next time that site loads or starts protected media, the pane goes straight to the Cinema.
- **never:** no more prompts for that site.
- Removing the pref, or one entry, resets it. A settings row for it is a follow-up.

**A pane that's already in front** (live and flat) can show DRM video as it is. The prompt still appears, since turning away would turn it black.

### Checked (dev harness, throwaway profile, real mouse clicks)

| Check | Result |
|---|---|
| Netflix landing page (public, no sign-in) loaded in a pane | prompt appeared: "Netflix – Watch TV Shows Online… is a streaming service…" |
| Real clicks: "Remember for netflix.com", then "Watch in Cinema" | cinema on with Netflix on the screen; pref saved `{"netflix.com":"auto"}` |
| Left the cinema, reloaded Netflix | went **straight to the Cinema**, no prompt |
| Widevine test stream (Shaka "Angel One", Shaka's public test licence) in an ordinary pane | `AetherDeckPaneEME` with `com.widevine.alpha`; prompt "Shaka Player Demo plays protected video, which can't show on a bent pane. Watch it in the Cinema?" |

## Not done (next steps)

- **DRM in the cinema is untested.** The path is the same as a normal tab (a live page), which played Widevine in step 1. Netflix-type services need the owner's sign-in, and probably Google's browser signing (step 1's open item).
- **A real cinema image** instead of CSS gradients (needs a CC0/licensed photo), and dimming the room's glow from the video's colours (one sampled colour per second would be cheap; not built).
- **Choosing the tab from More tabs or a link** ("Watch in cinema"), and remembering it across restarts.
- **Head-room / seat position:** a small parallax when the window resizes, or a "closer / farther" control to change the screen's size.
- **Audio from other panes** pauses in the cinema in this prototype (their pages are cold). Decide whether a playing pane should keep its sound.
