# AetherDeck for Mac: where it stands and what is next

Written 2026-11-10, after the home, the page bridge and the widgets went in.

## Chromium: decision

Chromium stays **paused, not deleted**, until the Firefox build passes the checks below. It holds 36 GB of source and 4.8 GB of a half-finished build on the external drive; the build processes are stopped (not running), so they cost memory but no CPU.

Why pause and not continue: the Room, the home, the bridge and the widgets now run on Firefox, so a Chromium build would repeat all of it in C++ for months (see [CHROMIUM-PORT.md](CHROMIUM-PORT.md)). Chromium is only needed if Firefox fails one of:

1. Google sign-in keeps working on every release build (it passed on the fork on 2026-11-10).
2. Six or more live panes run smoothly on a 16 GB machine.
3. Video, drag and text selection feel right in bent panes.

Plan: when all three pass, stop the paused build, delete `chromium/src` (frees about 36 GB) and keep the Sidekick extension in `chromium/` (3 MB), which needs no checkout. If one fails, resume the build with `siso` from `out/Default`.

## Disk (external drive, 223 GB)

| What | Size | Needed for |
|---|---|---|
| `chromium/src` | 36 GB | Chromium fallback only |
| `aetherdeck-browser/engine` | 20 GB (15 GB build output) | Firefox builds |
| `mozbuild` | 3.3 GB | Firefox builds |
| Firefox source tarball | 0.8 GB | re-extracting the source |
| test profiles | about 1.4 GB left | `room6` is yours; `hm1` is the test one |

Done: 3.7 GB of scratch profiles removed. Not done (needs a decision): removing Chromium, or the tarball.

## Missing, in order

1. **Agent services in the browser**: background tabs for agents, page text, screenshots, click and type. The Agent Station opens and lists models, but "Bring aboard" and running a task are not verified, and the agent engine still calls Electron-only channels (`engine:*`).
2. **Research Station**: untested in the browser; "Open all 16 sites as tabs" collides with the 8-pane limit.
3. **Training and memory**: agents are stored in `aetherdeck-data/agents.json` in the profile; the training screens and a memory file (`agent-memory`) are not wired to the UI.
4. **Widgets**: clock, tabs and agents are in; a note and a memory widget, dragging them, and showing them over a pane are not.
5. **Not ported from the Electron app**: Settings sheet, history and bookmarks, downloads, phone mirroring, Files, voice, extensions, updates.
6. **Unverified**: video scrubbing, word selection, typing after a click, cursor shapes, pinch zoom, full screen, Windows and Linux, signing and notarization.
