# Stage 2: our own Firefox-based browser (plan)

Follows [FIREFOX-FORK.md](FIREFOX-FORK.md) and the Stage 0 and 1 results in [`firefox/README.md`](../firefox/README.md). This is a plan only. Nothing in it has been built, and where a fact came from a web page rather than from running something, it says so.

## 1. What Stage 2 delivers

An application with our own name, icon, profile folder and settings that opens straight into the Room, built from Firefox's source plus our changes, on macOS first. It replaces today's way of running the Room (a script injected into a stock Firefox copy with `config.js`, which breaks the app's signature and sits under Firefox's own window).

Done means, on one machine, all of these:

1. A double-clickable app (not Firefox, not a patched copy of Firefox) that starts into the Room with Firefox's tab strip, toolbar and sidebar replaced by ours.
2. The whole Stage 1 hand-test passes in it: ring of real tabs, typing and clicking under a tilt, new-tab links become panes, 8-pane cap, 4 live, sleep and wake, address box, tab list.
3. **Google sign-in to Gmail works in a ring pane and in a normal tab on this build** (it passed on stock Firefox; a fork changes the user agent and branding, so it must be re-tested here).
4. Our own settings and data folder; it does not touch an installed Firefox profile.
5. A repeatable build from a pinned Firefox version, with a script that updates the pin.

Not part of Stage 2: Windows and Linux builds, auto-update, store distribution, the bent-page look. Those are Stage 3 and later.

## 2. Decisions

**Decided (owner, 2026-11-11): the browser is named "AetherDeck".** Working identifiers proposed from that name (not yet checked for clashes): display name `AetherDeck for Mac`, macOS bundle id `com.aetherdeck.browser`, profile folder `AetherDeckBrowser`, executable `aetherdeck`. No Mozilla or Firefox logo or wording anywhere in the shipped app; "based on Firefox" statements are for the About page and need care under Mozilla's trademark rules.

Still open, below: Firefox version, repo location, and build disk.

## 2b. Decisions the owner still has to make

| Decision | Options | Recommendation |
|---|---|---|
| Name and icon | Anything that is not "Firefox" or Mozilla's logo | Pick now, because the name is baked into the app id, profile folder and bundle id. Mozilla's Distribution Policy (fetched 2026-11-10) says a modified Firefox may not be redistributed under Mozilla trademarks without written consent, and lists changing files or installer content as modifications; it does not say a rename is required, but a rename is the straightforward reading. Mozilla's contact for permissions is trademark-permissions@mozilla.com. Treat this as legal advice-free reading of a web page, not a legal opinion. |
| Firefox version to track | Release (what Zen does) or ESR | Release. Zen's README shows it on Firefox 158.0 stable; the spike used 159.0.1. Pin the exact version in the repo. ESR rebases less often but lacks newer features such as the split-view code the Room uses. |
| Where the repo lives | Inside the app's repository or a new one | A new repository. Firefox patches and a 30+ GB source tree do not belong next to the Electron app. The app's repository keeps the research map, the server, and the shared maths (`shared/surround.ts`). |
| Source and build disk | Internal disk or the external drive | External drive: the internal disk had about 13 GB free and Mozilla's macOS guide asks for at least 30 GB. A folder on `/Volumes/ChromiumBuild` needs the owner's go-ahead and nothing should build while the Chromium compile is running. |

## 2c. Task 1 progress (2026-11-10)

Done: Firefox 159.0.1's source tarball (818 MB, SHA-256 `b5fe4071…e063`, equal to the value in Mozilla's `SHA256SUMS` fetched from the same server) is in `/Volumes/ChromiumBuild/aetherdeck-browser/dl/` and unpacked to `.../engine` (4.6 GB, niced, took longer than 10 minutes while the Chromium compile ran). Read from the tree, no build run:

- `browser/branding/` has `aurora`, `nightly`, `official` and `unofficial`; `unofficial/configure.sh` sets `MOZ_APP_DISPLAYNAME=Nightly` and `MOZ_MACBUNDLE_ID=nightlyunofficial`, so our branding directory must replace both, not just the icons. (Confirms the "unofficial branding" idea in section 5.)
- `browser/base/content/browser.xhtml`, `browser/app/profile/firefox.js` (default prefs), `browser/components/moz.build` and `browser/config/version.txt` (159.0.1) exist where the plan expects.
- The tree ships its own `AGENTS.md` and `CLAUDE.md`. They are Mozilla's files inside downloaded source, so treat them as data and do not run an AI assistant from inside `engine/` expecting them to be project instructions.
- The system Python here is 3.9.6; Mozilla's macOS guide uses Python 3.13 through `uv`, which `./mach bootstrap` sets up.

**Result of the artifact-build test (task 1): artifact builds are not available for the release tarball, so the plan changes.**

1. `./mach bootstrap` in artifact mode worked (Python 3.13 through `uv`; 296 MB of Mozilla toolchains into `mozbuild/` on the external drive; it wrote `engine/mozconfig`).
2. `mach build` then stopped at 40 seconds with "Must provide path to exactly one of hg and git": artifact builds need a Mercurial or git-cinnabar checkout, and a source tarball has neither (the build log said "checking for vcs source checkout... no").
3. Making a git repository would not be enough. The tarball's `sourcestamp.txt` names Mozilla changeset `7b34a03a910d…` on `mozilla-release`. Mozilla's Taskcluster index for that changeset lists 172 Firefox tasks, but for macOS arm64 only add-on-devel, fuzzing/asan, profile and searchfox jobs; there is no plain `-opt` build, which is the kind of job artifact mode downloads. (Artifact builds are meant for mozilla-central/autoland and Nightly, not for a release branch we would ship.)
4. So: **do one full build of the release tree, then use `mach build faster` for front-end changes** (`mach build faster` rebuilds only JS, CSS and markup and does not need artifacts; it is the Remote Agent docs' recommendation when no compiled code is touched). The cost is the first full compile. Everything else in the plan stands; the "minutes per change" claim now applies after that first build, not before it.
5. Secrets note: mach's full build log prints the whole environment, which in this session included a Claude Code token. I deleted those logs; if you run mach yourself, do not paste its logs anywhere.

Not done, needs the owner's OK: `./mach bootstrap` (downloads toolchains and may install system packages) and a first build, which must wait for the Chromium compile to finish. No git repository has been created.

## 3. How the repository is laid out

Zen's top level (from its GitHub page): `src/`, `configs/`, `prefs/`, `locales/`, `build/`, `scripts/`, `surfer.json`, `.github/workflows/`, with Firefox's source downloaded and modified in place by a tool called Surfer. I could not read Surfer's docs or how Zen stores its patches, so the layout below is a design, not a description of Zen.

```
aetherdeck-browser/
  firefox.version          # the pinned Firefox release, e.g. 159.0.1
  patches/                 # git-format patches against that release, numbered, each with a reason
  overlay/                 # new files copied into the Firefox tree as they are
    browser/components/aetherdeck/   # the Room (JS, CSS, jar.mn, moz.build)
    browser/branding/aetherdeck/     # name, icons, app id
  configs/mozconfig.mac-arm64        # build options
  prefs/aetherdeck.js                # default settings
  scripts/fetch, apply, build, package, bump    # a few short scripts
  docs/
```

Tooling: write our own thin scripts instead of depending on Surfer. The Surfer README (fetched) calls itself "prerelease / prototype", says it is a fork of Gluon "whose author has stopped working on it", and Zen's own AUR threads reported breakage that pinning versions worked around. The needed steps are short: download the pinned source, apply patches with `git am`, copy the overlay, run Mozilla's `./mach build`. Borrow Zen's ideas, not its tool.

## 4. Moving the Room from a script into the tree

What changes between `firefox/room-tabs.uc.js` and the product:

- **No autoconfig and no sandbox.** The spike evaluated the script in a sandbox because Firefox blocks `eval` and `loadSubScript` from `file:` URLs. In-tree, the Room is ordinary privileged JavaScript referenced from `browser.xhtml`, with its own CSS imported from the browser's stylesheet. The app bundle is built, not edited, so it can be signed.
- **Hooks:** a `browser/components/aetherdeck/` module (JS and CSS, `jar.mn` and `moz.build` entries) plus a small patch to `browser/base/content/browser.xhtml` to load it, and to the browser's init so the Room starts on launch.
- **Chrome replaced, not just hidden:** instead of `display: none` on the toolbox, our own top bar, tab rail and address box become the window, and Firefox's own toolbar is removed in the patch. Reuse Firefox's `gBrowser`, session store, tab discard and split-view code as the spike did.
- **Defaults** (new tab page, homepage, search engine, privacy settings, telemetry off) go in the prefs file and a policies file shipped with the app.
- **Known Stage 1 problems to fix here, not carry over:** the blank-pane watchdog (find the real cause), session restore, tab drag, find-in-page, devtools and extensions inside the ring, memory.

## 5. Building it, and what is unknown

Mozilla's artifact builds download Firefox's compiled parts so only JS, CSS and markup rebuild, which fits the front-end-only changes above. From the artifact-build docs (fetched): it works from builds Mozilla published for a revision of mozilla-central; with git it needs a clone made with git-cinnabar; **any change to C, C++ or Rust source breaks it**; and the docs do not address forks with custom branding at all. So:

1. First task, one day: try an artifact build of the pinned release with our branding and overlay. If it works, front-end iteration takes minutes. If it fails because of the branding or source layout, fall back to a full build.
2. A full build is the real cost. Mozilla's macOS guide asks for 4 GB RAM minimum and 8 GB or more recommended, plus 30 GB of free disk. I found no authoritative compile time. On this Mac (16 GB RAM, 8 cores) plan for hours, run it with the Chromium compile stopped, and **measure the first full build before promising anything**.
3. Zen's CI (read from its `build.yml`) runs macOS (x86_64 and arm64, merged into a universal DMG), Windows (x64, arm64) and Linux builds through reusable GitHub Actions workflows, with profile-guided optimization and optional sccache. For us, start with one platform, no PGO, and add CI only after a local build works.

Branding: Mozilla's source tree carries an "unofficial" branding directory meant for builds that may not use Mozilla's name; copy that into `browser/branding/aetherdeck/` and replace name and icons (from my memory of the tree, not checked against 159). Keep the `Firefox/159.0` token in the user agent: sites, and above all Google's sign-in checks, expect it, and Zen is reported to sign in to Google (a single forum post, not verified).

## 6. Signing, updates and keeping up with Mozilla

- **macOS signing:** local builds can be ad hoc signed (as the spike copy was). Shipping to other people needs an Apple Developer ID certificate and notarization (Zen's workflow file did not show its macOS notarization). Check Apple's current fee and process before relying on it.
- **Updates:** Firefox's updater uses signed MAR files and an update manifest server. Zen signs MARs in CI with `signmar` and commits manifests to a GitHub repository. For Stage 2, no auto-update: replace the app by hand. Stage 3 adds an update service.
- **Security releases:** a fork that does not rebase promptly becomes less safe than stock Firefox. Rule for the project: every Mozilla release is merged within a few days. `scripts/bump` should fetch the new version, apply patches, and fail loudly with the conflicting patch name. Watch Mozilla's security advisories.
- **Telemetry and accounts:** Mozilla's telemetry, Pocket, sponsored suggestions and Firefox Accounts endpoints must be turned off or replaced deliberately; decide per item, because Firefox Sync only works against Mozilla's servers.

## 7. Work breakdown

| # | Task | Output | Rough size |
|---|---|---|---|
| 0 | Owner decisions in section 2; OK for a folder on the external drive | Name, version, location | 1 day |
| 1 | Fetch the pinned source tarball (not a git clone) to the external drive; try an artifact build with stock branding | Written result: works or not, and how long | 1 to 2 days |
| 2 | Repo skeleton, `fetch` / `apply` / `build` scripts, branding directory | An app named ours that behaves like Firefox | 2 to 3 days |
| 3 | Port the Room into `browser/components/aetherdeck/`, remove Firefox's toolbar, own top bar and tab rail | App opens in the Room | 1 to 2 weeks |
| 4 | Fix Stage 1 issues: blank panes, session restore, tab drag, find, devtools, extensions | Stage 1 hand-test list passes | 1 to 2 weeks |
| 5 | Google sign-in test on this build, and the memory test with 8 panes | Written pass/fail | 1 day |
| 6 | `bump` script and a dry run on the next Mozilla release | Rebase proven | 2 to 3 days |

The sizes are guesses by analogy, not measurements; item 1 exists to replace the biggest guess (build time) with a number.

## 8. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Artifact builds do not work with our branding or layout | Every change needs a full compile (hours) | Item 1 tests it first; keep front-end changes isolated to limit rebuilds |
| Google's sign-in rejects the renamed build | Loses the reason for leaving Electron | Keep the Firefox token in the user agent; test in item 5; fall back to the Chromium option |
| Mozilla's trademark rules read more strictly than I understood | Cannot distribute | Rename from the start; ask Mozilla if anything is unclear; no Mozilla logo anywhere |
| Maintaining a browser's security | Real users at risk | Section 6 cadence; do not distribute widely until the rebase script has been proven |
| Chrome patches break on every Firefox release | Constant rebasing | Few patches, logic in our own files, patches carry a reason, `bump` shows exactly which one broke |
| Time and memory on this Mac | Builds fight the Chromium compile | One build at a time; external drive; stop the other compile first |

## 9. Next three steps

1. Owner picks the name and confirms the version (Firefox release) and the build location on the external drive.
2. Task 1 in section 7: fetch the pinned source and try an artifact build, and record how long it takes and whether our branding is accepted.
3. Create the new repository with the skeleton and a first patch that only changes the app name, then check that the result still signs in to Google.

## Sources

- [Mozilla Distribution Policy](https://www.mozilla.org/en-US/foundation/trademarks/distribution-policy/)
- [Zen Browser repository](https://github.com/zen-browser/desktop) and [its CI workflow](https://github.com/zen-browser/desktop/blob/dev/.github/workflows/build.yml)
- [Surfer](https://github.com/zen-browser/surfer)
- [Firefox artifact builds](https://firefox-source-docs.mozilla.org/contributing/build/artifact_builds.html)
- [Building Firefox on macOS](https://firefox-source-docs.mozilla.org/setup/macos_build.html)


## Progress note (2026-11-10): first build and branding

- First full build of Firefox 159.0.1 (unofficial branding) finished in 106 minutes. Google sign-in works in it, both in a normal tab and in the Room; Pinterest "Continue with Google" popup works.
- Room fixes found in testing: popup windows are no longer given a Room (`firefox/config.js`); Esc no longer leaves the Room (pages send Esc themselves), Alt+Shift+R does (`firefox/room-tabs.uc.js`).
- Branding: `overlay/browser/branding/aetherdeck/` (name "AetherDeck", bundle id `com.aetherdeck.browser`, our icon). `scripts/apply-overlay.sh` copies the overlay into the source tree; `configs/mozconfig.full` now uses it. Still to do: the update URLs in `pref/firefox-branding.js` still point at Mozilla, Windows `.ico` files and installer art are Mozilla's, `Assets.car` is still the unofficial one.

## Progress note (2026-11-10, evening): Room in the browser, de-Mozilla pass

- The Room is part of the browser source (`room-src/` on the build drive: `room.js`, `room-loader.js`), no autoconfig. Leaving it ends split view in two steps with the page area hidden (a WebRender panic crashed the GPU process when live pages were still on screen as the 3D transforms came off). A purple "Room" toolbar button re-enters; Alt+Shift+R toggles. Session restore tabs become panes.
- Dev gotcha: `mach build faster` keeps the same build id, so Firefox keeps OLD compiled scripts in the profile's `startupCache`. `scripts/run.sh` clears it before launching.
- De-Mozilla: `scripts/rebrand-strings.py` (UI text), `scripts/rebrand-art.py` (fox mascots, Firefox/Mozilla logos, placeholder AetherDeck mark), prefs in `overlay/.../firefox-branding.js` (no Mozilla accounts/Sync, VPN, Relay, Monitor, Normandy, welcome tours, sponsored tiles, Remote Settings top sites), emptied default bookmarks, CSS in `room-loader.js` hiding account/Firefox View/Help-to-Mozilla entries. Still Mozilla's: Windows icons and installer art, license texts (must stay), crash/telemetry plumbing compiled in (disabled by prefs), strings in non-.ftl files.

## Progress note (2026-11-10, night): spatial look in the browser

- 360° room photo behind the ring: 36 vertical strips of the CC0 Poly Haven panorama (`room-src/.../rooms/*.jpg`, pref `aetherdeck.room.background` = home-office | seaside-balcony | glasshouse | loft | none) in the same 3D scene as the panes, turning with the camera.
- Glass dock at the bottom (blur, translucent) instead of the top bar.
- Curved panes: `-moz-element()` does not draw a remote `<browser>` (tested: blank), so the panes beside the one you face are drawn as 16 bent strips of a snapshot (`browser.drawSnapshot`, JPEG, refreshed about twice a second); the pane you face stays flat, live and interactive; clicking a bent pane turns to it. Pref `aetherdeck.room.curve`.
- Open: a thin seam line where the panorama wraps; side panes are not live (about 2 fps); not yet tested with many panes, video, or on Windows/Linux.

## Progress note (2026-11-10, late): the cylinder engine

Reference: the owner's sketch (user in the middle of a cylinder, tabs on its inside surface, panorama beyond) and the Electron app.
- Layout: panes about 52 degrees apart on a cylinder (full circle once there are more than ~7), wide camera (fov 1.3), a 360 photo cylinder behind them.
- Every pane is bent round you (18 vertical canvas strips fed by `browser.drawSnapshot`, panes in view refreshed on every pass). The pane you have settled on is swapped for the real flat live page. Drag on the background or a bent pane, mouse wheel, or arrow keys turn you; letting go snaps to the nearest pane and glides there. Clicking a bent pane goes to it. Live cap raised to 6 so several tabs keep playing.
- Known: panes in view are pictures while you turn (not live), the swap to the flat live pane pops slightly, snapshot cost grows with panes, drag/wheel not yet exercised by hand.

## Progress note (2026-11-10, night 2): bent, live, free-look Room

- Every pane is bent round you, including the one you use. Pages are drawn as 18 canvas strips from `browser.drawSnapshot(…, fullViewport)` at about 25 pictures a second per pane (3 panes: 60 to 85 a second in total). The real page stays underneath, invisible.
- Input: strip `mousedown/move/up/wheel` is mapped to page coordinates (`offsetX/Y` of the strip plus its index) and sent to a small window actor (`AetherDeckInput`: `AetherDeckInputParent/Child.sys.mjs`, registered with `safeForUntrustedWebProcess: true`). The child calls `win.synthesizeMouseEvent` and `windowUtils.sendWheelEvent` in the page. `nsIDOMWindowUtils.sendMouseEvent` no longer exists in this Firefox. Verified by a real click that opened GitHub's search and another that followed a link.
- Free look: drag the room (or wheel over it) to turn and tilt; arrow keys; no snapping. Ctrl/Cmd+wheel over a pane or the −/+ buttons zoom that pane; Shift+drag moves it; Fit (or F, Esc back) fills the view; the ⤢ button toggles window full screen.
- Not verified: wheel scrolling and typing inside a bent pane, Shift+drag, Ctrl+wheel, the full screen button, text selection by dragging, hover cursors, cross-origin iframes, six live panes.

## Progress note (2026-11-10, night 3): smoother, no overlap, more rooms

- Smoothness: the camera is now one transform on a container (`#ad-room-world`, `#ad-bg-world`); each bent strip only changes when the layout, size or position changes. Before, every strip of every pane and of the panorama was restyled on every frame.
- No overlap: `place()` lays panes out side by side by their own angular width (size x pane width / radius) plus a gap; zooming one pushes its neighbours aside, and the circle grows when they no longer fit. Zoom and Fit re-lay out and turn to the pane.
- Rooms: a "Rooms" menu in the dock (pictures for the four 360 photos plus Deep space, Aurora and Plain dark); the choice is kept in the pref `aetherdeck.room.background`.
- Dock: shorter labels so it fits narrow windows.

- Resize fix (2026-11-10, night 4): the size controls (−, +, key +/-, Fit, the new size slider with a percentage, Ctrl/Cmd+wheel, pinch) all act on `targetPane()`: the pane you last clicked, otherwise the one nearest the middle of your view. Before, they did nothing until a pane had been clicked. The slider resizes live and keeps the pane in the middle while neighbours move aside.

- Curvature fix (2026-11-10, night 5): a pane's bend no longer depends on its size. Each pane bends through a fixed angle (default about 23 degrees; "Curve" slider in the Rooms menu, pref `aetherdeck.room.curveAmount`, 0 flat to 100 about 52 degrees) around its own middle, which stays on the ring: strips are placed with `translateX(x) translateZ(d) rotateY(-asin(x/Rb))`, `Rb = paneWidth / bendAngle`. Before, the pane's arc followed its size, so a 170% pane wrapped about 78 degrees. Strips overlap by 2.6px to hide hairline seams.

- Pointer accuracy (2026-11-10, night 6): clicks on the bent panes were off, worst on small targets and when zoomed. Causes found and fixed: (1) `getBoundingClientRect()` of the hidden page returns the transformed box, so the page-size correction used 435px instead of 1096px; it now uses `clientWidth/clientHeight`; (2) the browser's own hit-testing and `offsetX/Y` through nested 3D transforms are not trusted any more: one transparent layer receives every pointer event and the Room does its own ray-versus-strip maths (`pick()`, strip matrices cached in `p.S`); (3) the pane you point at is redrawn as fast as possible while you move, press or scroll (`burst`); (4) the pointer shape (hand, text) follows the page; (5) the click count is forwarded, so double-click selects a word. Verified: a click on GitHub's small search icon at 175% opened the search box.
