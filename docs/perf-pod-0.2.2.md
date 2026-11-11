# Pod performance on AetherDeck 0.2.2: measurements (2026-11-11)

Measured, not changed: no repo code was touched. All numbers come from a throwaway copy of the released 0.2.2 app on a fresh throwaway profile.

## Setup

- **Machine:** Apple M3, 16 GB, macOS. Browser window 1280×911 CSS px at 2× (2560×1822 device px), kept in front during runs (a hidden window stops drawing, which makes numbers meaningless).
- **App:** the 0.2.2 DMG's AetherDeck.app, copied unmodified. macOS refused to start a copy with a changed `omni.ja`, so the instrumented Pod (`room.js` plus counters and four pref switches, below) was loaded into a second browser window at runtime and the first window was closed. Everything else is the shipped build, including built-in uBlock Origin.
- **Pod:** 8 panes, all live (8 of 8 on 16 GB): AetherDeck home, github.com/tajwarah/aetherdeck, **YouTube**, Wikipedia (Space station), MDN, Hacker News, NASA, OpenStreetMap. YouTube is pane 3; GitHub and Wikipedia are its neighbours.
- **Video:** "COSTA RICA IN 4K 60fps HDR (ULTRA HD)" (youtube.com/watch?v=LXb3EKWsInQ), played at **1920×1080, 60 fps** (YouTube's own quality setting, `hd1080`), tab muted by the browser.
- **Each run:** reload the video, put the camera in place, wait 8 s, then measure for 10 s. Every case was run twice; tables give the range of the two runs.

### What each column means

- **Video shown / dropped:** from the page's own `video.getVideoPlaybackQuality()` (frames presented per second, frames dropped). This is what the page renders, *not* what you see in a bent pane (see "YT pictures").
- **Pod fps, p95, >33 ms:** `requestAnimationFrame` in the browser window: frames per second, 95th-percentile frame time, and frames slower than 33 ms (a visible hitch) per 10 s.
- **CPU %:** `ChromeUtils.requestProcInfo` CPU time over the 10 s, as % of one core. *Parent* is the browser process (*main* is its main thread, where the Pod's JavaScript runs). *GPU* is the GPU **process's CPU time** (WebRender), not GPU utilisation. *YT* is the YouTube page's content process (noisy because each run starts 8 s after a reload).
- **Pictures/s, wait, draw:** the Pod's pane redraws (`browser.drawSnapshot` + 18 `drawImage` strips). *wait* = ms per second spent awaiting `drawSnapshot`; *draw* = ms per second spent in the 18 `drawImage` calls (main thread).
- **YT pictures/s (ms each):** how often the YouTube pane's bent picture is redrawn, and how long one picture takes. **When YouTube is not the resting front pane, this is the video's frame rate as you see it.**

### A caveat about YouTube

After about 50 seconds YouTube shows "Something went wrong. Refresh or try again later." This happens **in a plain tab too**, so it is not the Pod. It is most likely YouTube reacting to the automation driver used for these tests (it marks the browser as automated). Each run therefore reloads the video and finishes within about 20 s of the reload. An early attempt to mute the video from inside the page hit the same error sooner; muting at the tab level did not.

## 1. Baseline: the five cases

| Case | Video shown/s (dropped) | Pod fps | p95 ms | >33 ms per 10 s | Parent CPU % (main) | GPU proc CPU % | YT proc % | Pictures/s | wait ms/s | draw ms/s | YT pictures/s (ms each) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1. YouTube is the resting front pane (flat, live) | 60 (0) | 52–55 | 33 | 18–23 | 51–52 (42–43) | 29–32 | 12–26 | 20.4–20.5 | 397–419 | 82–85 | live page, no pictures |
| 2. YouTube is a side pane in view (front is GitHub) | 60 (0–4) | **41–43** | **50–51** | **52–65** | **69–71 (64–66)** | 32–36 | 20–25 | 14.5–17.1 | 811–896 | 74–77 | **5.5–7 (45–69 ms)** |
| 3. YouTube behind you (front is NASA) | 60 (0) | 52–57 | 33 | 6–17 | 41–48 (38–44) | 21–27 | 10–43 | 18.7–21.6 | 380–505 | 72–81 | 0.7 |
| 4. Turning (camera glides pane to pane, non-stop) | 60 (0) | **27–28** | **83** | **97–115** | **78 (67–68)** | **93** | 26–33 | 14.9–15.5 | 630–632 | 138–148 | 1.8 (83 ms) |
| 5. Same video, normal tab, same build | 60 (0) | **60** | 18–19 | 0 | **12–13 (3)** | 14–17 | 14–39 | 0 | 0 | 0 | — |

**What the baseline shows**

1. **The video itself never struggles.** In every case the page decodes and presents 60 fps with almost no drops (4 dropped frames in one run). The lag is not YouTube decoding.
2. **The Pod costs the main thread 13–22× more than a normal tab.** Parent main thread: 3% in a normal tab vs 42–68% in the Pod. The extra work is the pane pictures: about 20 a second at rest, each taking a 18-strip `drawImage` pass.
3. **YouTube in a side pane looks like 5–7 fps.** The page plays at 60 fps, but you only see a new picture every 140–180 ms, because each picture of the YouTube pane takes 45–69 ms and the loop redraws panes one after another. This is the "far too laggy YouTube" case.
4. **Turning halves the Pod's frame rate.** 27–28 fps, p95 83 ms, about 100 hitches per 10 s, and the GPU process at 93% CPU (WebRender compositing the 3D scene: 8 panes × 18 strips plus 36 background strips).
5. **YouTube behind you keeps running at full cost.** It still decodes all 60 frames a second, as your hypothesis (b) said: every live pane's docshell is forced active.
6. **Hypothesis (c) does not hold here.** As the resting front pane, YouTube is a flat live page inside the 3D parent and shows 60 fps with 0 drops. The front-pane case is still not as smooth as a normal tab (52–55 fps and 18–23 hitches per 10 s), but that comes from the side panes' pictures (82–85 ms/s of `drawImage` on the main thread), not the video.

## 2. A/B: one switch at a time, then all three

Switches (prefs read live by the instrumented copy; off = the shipped behaviour):

- **(i) `inactiveOut`:** panes out of view (more than 1.5 rad from where you look) get `docShellIsActive = false` and `renderLayers = false` every second.
- **(ii) `skipOut`:** no pictures at all for panes out of view (shipped: one every 1.5 s).
- **(iii) `sideMs=250, sideScalePct=75`:** side panes in view redrawn every 250 ms instead of 100 ms, at 0.75× resolution instead of 1×.

| Run | Video shown/s (dropped) | Pod fps | p95 ms | >33 ms per 10 s | Parent CPU % (main) | GPU proc % | Pictures/s | wait ms/s | draw ms/s | YT pictures/s (ms each) |
|---|---|---|---|---|---|---|---|---|---|---|
| **Front: YouTube resting in front** | | | | | | | | | | |
| baseline | 60 (0) | 52–55 | 33 | 18–23 | 51–52 (42–43) | 29–32 | 20.4–20.5 | 397–419 | 82–85 | live |
| (i) inactive out of view | 60 (0) | 46–55 | 33–50 | 11–43 | 44–67 (38–54) | 23–36 | 18.9–20.4 | 350–567 | 72–109 | live |
| (ii) skip out of view | 60 (0) | 52–56 | 33 | 8–22 | 43–53 (35–42) | 21–30 | 18.6–18.8 | 312–388 | 73–86 | live |
| (iii) 250 ms, 0.75× | 60 (0) | **57–58** | 19–32 | **8–9** | **27 (20)** | 18–21 | 10.9–11.0 | 197–200 | **23** | live |
| (i)+(ii)+(iii) | 60 (0) | **58** | **18–19** | **2–5** | **22 (15)** | 21 | 7.6–7.8 | 129–131 | **16** | live |
| **Side: YouTube in view beside GitHub** | | | | | | | | | | |
| baseline | 60 (0–4) | 41–43 | 50–51 | 52–65 | 69–71 (64–66) | 32–36 | 14.5–17.1 | 811–896 | 74–77 | 5.5–7 (45–69) |
| (iii) 250 ms, 0.75× | 60 (0) | **57** | 33 | **1–3** | **33–34 (28–29)** | 17–20 | 11.1–11.4 | 321–446 | 23–24 | 3.9–4 (30–61) |
| (i)+(ii)+(iii) | 60 (0) | **57–58** | 18–31 | **3** | **27 (23)** | 19–20 | 7.9–8.0 | 286 | 17 | 4 (31–32) |
| **Behind: YouTube behind you** | | | | | | | | | | |
| baseline | 60 (0) | 52–57 | 33 | 6–17 | 41–48 (38–44) | 21–27 | 18.7–21.6 | 380–505 | 72–81 | 0.7 |
| (i) inactive out of view | 60 (0) | 55 | 33 | 8–13 | 44 (39–40) | 17–18 | 20.6–21.3 | 405–409 | 76–77 | 0.6 |
| (ii) skip out of view | 60 (0) | 36–57 | 19–83 | 3–57 | 36–74 (32–67) | 16–31 | 14.5–19.4 | 304–620 | 66–165 | 0 |
| (i)+(ii)+(iii) | 60 (0) | **59** | **18–19** | 3–7 | **19–20 (15–16)** | 16 | 7.8 | 136–137 | 18–19 | 0 |
| **Turning** | | | | | | | | | | |
| baseline | 60 (0) | 27–28 | 83 | 97–115 | 78 (67–68) | 93 | 14.9–15.5 | 630–632 | 138–148 | 1.8 (83) |
| (i) inactive out of view | 60 (0) | 28 | 83–98 | 96–99 | 73–74 (61–65) | 77–87 | 12.8–15.9 | 615–696 | 117–135 | 1.2–2.5 |
| (i)+(ii)+(iii) | 60 (0) | 32–33 | 68 | 86–90 | 75–76 (63–64) | 81–86 | 14.6–15.4 | 569–588 | 129–138 | 2.3 (54–57) |
| **Normal tab** (reference) | 60 (0) | 60 | 18–19 | 0 | 12–13 (3) | 14–17 | 0 | 0 | 0 | — |

**Reading the A/B**

- **(iii) is the big win.** On its own it takes the resting Pod from 41–55 fps to 57–58 fps, cuts main-thread CPU by more than half (64–66% → 28–29% with YouTube at the side, 42–43% → 20% with it in front) and cuts `drawImage` time from about 80 to 23 ms/s. With YouTube at the side, hitches fall from 52–65 to 1–3 per 10 s. The cost: side panes update 4 times a second instead of about 7, and look slightly softer.
- **(ii) on its own: small or noisy.** Out-of-view pictures are only one every 1.5 s per pane, so skipping them saves a little (pictures 20.5 → 18.7/s). One of the two "behind" runs was much worse (36 fps, YouTube process 79%); I believe that run caught YouTube still loading after the reload, but I can't prove it.
- **(i) on its own: no measurable gain, and one bad run.** "Front" was 46 fps / 67% parent in one run and 55 fps / 44% in the other. It also did not stop the hidden video decoding within the window measured: Firefox only suspends a hidden video's decoding after about 10 s (`media.suspend-bkgnd-video.delay-ms`), and each run measures from 8 to 18 s after the reload. So these runs can't show (i)'s effect on video. A longer run (YouTube behind you for over a minute) would be needed, and YouTube's automation error gets in the way of that.
- **All three together** give the best resting numbers: 57–59 fps, p95 18–19 ms in front and behind, parent CPU 19–27% (main 15–23%), GPU process 16–21%. That's close to the normal tab's 60 fps. Parent CPU is still about 2× the tab's, and pictures still run at 8 a second.
- **None of them fixes turning.** All three together: 32–33 fps, p95 68 ms, GPU process 81–86%. While turning, the Pod already redraws only the pane you're on, but it redraws that one continuously (`every = 0`), and WebRender recomposites the whole 3D scene each frame. Turning needs its own fix (ideas at the end, untested).
- **(iv) a video pane shown flat and live instead of bent:** not built as a separate switch, because the resting front pane already is exactly that path. Compare case 1 with case 2: flat and live, the video is seen at 60 fps; bent at the side, at 5.5–7 pictures a second. The page itself plays 60 fps in both. Making a *side* pane live and flat would mean a second flat live page next to the front one, which the Pod doesn't do today (the input and zoom code assume one), so I didn't try it.

## 3. Profiler: top costs

Captured with the built-in Gecko profiler (`Services.profiler`, 1 ms interval, `js` + `stackwalk` + `cpu`), 8 s each, weighted by each thread's CPU time. The release XUL has no symbols (the symbol files are on the build drive, which wasn't mounted), so Firefox's own unlabelled native frames can't be named; system-library frames were named with `atos` against the running process.

**Pod with YouTube at the side (case 2):**

| # | Cost | % of one core | Where |
|---|---|---|---|
| 1 | Unlabelled native work on the main thread, outside any JavaScript, under the event loop (`nsAppShell::ProcessGeckoEvents`) | **52%** | Browser main thread. The hottest leaves are `mach_msg2_trap` (IPC, 7%), `_platform_memmove` (about 8%), `__mmap` (1%) and one tight cluster of unnamed XUL code. **Inference:** this is the work done when each `drawSnapshot` reply arrives: receiving the painted recording over IPC, copying it, allocating a new bitmap and rasterising it on the CPU. The evidence: it is under 2% in the normal-tab profile, and it falls in step with the picture rate in the A/B (main thread 64–66% → 23% when pictures drop from 15 to 8 a second at 0.56× the pixels). Not proven by name, because there are no symbols. |
| 2 | `CanvasRenderingContext2D.drawImage` (the 18 strips per picture) | 6.7% (11.3% when turning) | Browser main thread, inside `snapPane` |
| 3 | Pages painting themselves for the snapshots (`PWindowGlobal::Msg_DrawSnapshot`, `nsLayoutUtils::PaintFrame`, `nsDisplayList::PaintRoot`) | 4.6% in the YouTube process, plus similar in each in-view page | Content processes |
| 4 | YouTube's own JavaScript and garbage collection (`Major GC`, `Incremental GC`) | about 5% GC + 3% JS in the YouTube process | Same as in a normal tab: not caused by the Pod |
| 5 | WebRender in the GPU process (`RenderThread::UpdateAndRender`, `WRRenderBackend`) | 5% + 13% at rest | GPU process |

**While turning (case 4)** the order changes: main thread 60% (unlabelled snapshot work 35%, `drawImage` 11.3%, the window's own refresh, layout and paint 7.5%), and the GPU process does the most work: `RenderThread::UpdateAndRender` 29–31% and `WRRenderBackend` 18% of a core in the profiled threads. In total the GPU process uses 81–93% of a core according to process CPU time, compositing about 180 transformed layers a frame.

**Normal tab (case 5):** the browser main thread stays under 2%. The busiest threads are YouTube's process (9%) and WebRender (4% + 3%).

Profile files (raw Gecko format, can be loaded in profiler.firefox.com), in the scratch folder: `profile-side.json`, `profile-turn.json`, `profile-plaintab.json`.

## 4. Windows and Linux: what changes for `drawSnapshot`

From how Firefox implements `drawSnapshot`, **not measured** (no Windows or Linux build exists yet), and not re-checked against the source because the source drive wasn't mounted:

- `browser.drawSnapshot` uses Firefox's cross-process paint. Each content process paints its page into a **recording** of drawing commands, sends it to the browser process, and the browser process **replays it on the CPU** (Skia, software) into a bitmap that becomes the `ImageBitmap`. This path doesn't read pixels back from the GPU and doesn't use the compositor's output, on any platform. So the main cost found here (cost 1 above) will be about the same on Windows and Linux, and scales with picture rate × pixels.
- **What differs is video.** A video frame inside a snapshot must reach that CPU replay as pixels:
  - **macOS:** hardware-decoded frames are IOSurfaces, which the CPU can map directly. That's relatively cheap, and it's what was measured here.
  - **Windows:** hardware-decoded frames are D3D11 textures. Each snapshot needs a GPU → CPU copy through a staging texture, which can stall the GPU and costs more per picture. Expect a YouTube side pane to cost more there than on the Mac.
  - **Linux:** with VA-API decoding, frames are DMA-BUF surfaces and need mapping or readback (cost depends on the driver). With software decoding, frames are already in memory (cheap to snapshot, but decoding itself costs far more CPU). Many Linux setups also run WebRender in software, which would make the turning case (all compositing) much heavier.
- `drawImage` into the 18 strip canvases runs on the browser main thread on every platform. Whether those canvases are GPU-accelerated depends on Firefox's per-platform defaults for accelerated canvas, so the 7–11% measured here may differ.

## 5. Summary for decisions

1. The lag is the Pod's pane pictures, not video decoding: the page renders 60 fps with no drops in every case.
2. Fix (iii) (side panes every 250 ms at 0.75×) gives most of the gain on its own: resting Pod 57–58 fps, main thread down by more than half. Adding (i) and (ii) brings it to 58–59 fps with p95 18–19 ms.
3. A video in a side pane can't look smooth with pictures: it is seen at 4–7 a second however the rate is tuned. Only the flat live front pane shows it at 60 fps.
4. Turning stays at about 30 fps with every switch tried: the cost is the continuous redraw of the pane you're on plus WebRender compositing. **Untested ideas** for a next round:
   - Don't redraw any picture while the camera moves, and use the last ones.
   - Use fewer strips per pane while moving (for example 6 instead of 18).
   - Composite the 36 background strips as one pre-rendered layer.
5. Hypothesis (b) is confirmed: hidden YouTube keeps decoding all 60 fps. Hypothesis (i) didn't show a gain within 18 s of a reload, because Firefox waits about 10 s before suspending hidden video. It needs a longer test, which YouTube's automation error currently prevents.
