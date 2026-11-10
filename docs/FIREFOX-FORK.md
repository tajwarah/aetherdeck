# AetherDeck for Mac: a Zen-style Firefox fork (plan)

Status: plan, written after the one-day spike in [`firefox/`](../firefox/README.md). Nothing here is built yet beyond that spike.

## 1. Decision

Build AetherDeck as its own browser by forking Firefox, the way Zen does, and put the Room in the browser's own window. Do it in stages, cheapest proof first, and only start the expensive full-compile work once the first two stages show the Room works with real tabs.

Why Firefox and not the Chromium checkout that is already compiling: Firefox draws its own window (tabs, sidebar, toolbar, the area where pages go) with HTML/XUL, CSS and JavaScript. Changing that is editing text files, with no C++ and no multi-hour rebuild. Chromium draws its window in native C++ (Views), so moving a tab strip or putting pages on a 3D ring means compositor and C++ work. That is why a Zen is feasible on Firefox and why a Chromium equivalent would take months. (Zen is described as a Firefox fork built as a patch set applied to Firefox's source, with MPL-2.0 licensing: [overview](https://unsubbed.pages.dev/tools/zen-browser/), unverified against Zen's repository.)

## 2. What the spike proved, and what it did not

Proved (Firefox 159.0.1, macOS 27, details in `firefox/README.md`):

- Real pages (`<browser remote>`, not iframes) render live on a CSS 3D ring across the browser window: GitHub, Pinterest, Google's Gmail sign-in page.
- Gmail's sign-in page was **not refused** as a pane. No framing rules, no mirror, no popup workaround.
- A click at a screen point in a pane tilted about 20° reached the page at exactly the coordinates a projective-geometry calculation predicts (to the pixel), and typing in a tilted pane worked.

- **Stage 0 result (owner, by hand, 2026-11-10): Google sign-in works in both places.** Signed in to a real Google account and reached the Gmail inbox, once in a pane on the 3D ring (live, signed in, tilted) and once in a normal Firefox tab, in the same unmodified Firefox 159.0.1 copy.
- A first attempt was blocked with "Couldn't sign you in. This browser or app may not be secure." That run had remote control (Marionette) switched on, which makes the browser report `navigator.webdriver = true`, and Google refuses automated browsers. With remote control off, sign-in worked. The spike script now leaves it off unless `AD_MARIONETTE=1`. Lesson for tests: never test Google sign-in in a browser started with remote control.
- Not yet checked: a fork's own user agent and branding (the test used stock Firefox with a script, not a fork), repeated or long-lived sign-in (cookie persistence, 2-step prompts), other Google surfaces (Drive, YouTube, "Sign in with Google" popups), and an observation that Google's security alert email described the new sign-in as "on Windows" although this is a Mac (cause unknown).

Not proved, and the first things to check:

- Scrolling, selection, drag, IME, video, fullscreen and popups in tilted panes; 6 to 8 live panes of memory and speed; real mouse (not Marionette's synthetic one); Windows and Linux.
- Everything about turning the spike's own `<browser>` elements into real tabs (section 4).

## 3. Options considered

| Option | What it is | Verdict |
|---|---|---|
| A. Autoconfig scripts on stock Firefox | Ship `config.js` + a chrome script (what the spike does, what fx-autoconfig and userChrome.js mods do: [fx-autoconfig](https://github.com/MrOtherGuy/fx-autoconfig)). Needs an edit to the app bundle; changes need a restart ([userchrome.org](https://www.userchrome.org/what-is-userchrome-js.html)). | Right for prototyping, wrong as a product: it breaks the signature, the user keeps Mozilla's logo and updates (which overwrite the edit), and the tab strip and address bar stay under the overlay. |
| B. Patch-set fork (Zen model) | A repository of patches and branding files applied to Firefox's source, built into our own app with our own name, icon, update channel and defaults. | **Recommended product path.** |
| C. Own Firefox source tree, patches committed in-tree | Same result as B but we carry a full fork and rebase by merge. | Heavier for one person; B's patch-set model rebases more easily. |
| D. Chromium C++ fork | Months of compositor and Views work on the checkout that is compiling now. | Keep only as the fallback if Firefox fails the Google sign-in test. |
| E. Electron app (existing) | Already built; Google blocks sign-in from embedded Electron per earlier findings, and the curved look needs offscreen frames and WebGL. | Keep as is until B reaches parity. |

## 4. How the Room works in a fork

Everything except branding and packaging is front-end code, in a new `browser/components/aetherdeck/` module plus CSS, loaded by the browser window like Firefox's own components:

1. **Window chrome:** hide Firefox's tab strip and toolbar, or move them into a slim overlay. Firefox now ships vertical tabs and a sidebar, so most of the shell can be restyled instead of rebuilt (to verify in the target version). Zen does this kind of restyle with CSS and small JS, plus patches.
2. **Panes as real tabs (the hard, unproven part).** The spike used its own `<browser>` elements. A product needs the ring to show real tabs: history, sessions, sign-in state, extensions, find, devtools, tab-to-tab drag all depend on `gBrowser`. Firefox keeps non-selected tabs' browsers inactive and hidden. The cheapest lead is the machinery behind Firefox's split view, which shows more than one tab's browser at once (Zen builds its split view the same way, unverified); the work is to keep N tabs' browsers active and place their containers on the 3D ring. If that proves too invasive, fall back to the spike's own browsers wired to tab objects. This is Stage 1's job.
3. **Camera, shields, fly-in, sleep policy:** reuse `chromium/src/roomLogic.ts` and `shared/surround.ts`. They are plain TypeScript and already tested (`tests/unit/room.test.ts`).
4. **New windows and links:** handle `target=_blank` and `window.open` by adding a pane (Firefox has hooks for this; Chromium needed the webNavigation workaround).
5. **AetherDeck features:** the server (`server/`), Cosmonaut and the research map stay as they are; the browser talks to the local server as the extension does today, with a privileged page instead of an extension token.

What stays flat: panes are flat panels on a ring with perspective, not one continuous bent page (a bent look needs the page's pixels in a texture; Gecko's compositor could do it but that is C++ work, Stage 4 at the earliest).

## 5. Stages

**Stage 0: the Google question. Done for stock Firefox (passed, see section 2).** Remaining: repeat once on the actual fork build in Stage 2 (its user agent and branding differ), and on Windows/Linux. If a fork build is blocked, fix the user agent handling or fall back to option D.

**Stage 1: real tabs on the ring, still autoconfig on a stock Firefox (about 1 week). First pass done: see `firefox/README.md` "Stage 1".** It confirmed that Firefox's own split-view machinery (`gBrowser.showSplitViewPanels`) keeps several real tabs live at once and that their panels can be 3D-transformed; typing in a non-selected real tab under a tilt works, and a `target=_blank` link becomes a new pane through a plain `TabOpen` handler. Second pass added a pane cap (8), a live cap with Firefox's tab discard (default now 4), an address box and a tab rail; a woken pane reloads. Open items: memory is about 2.7 GB resident across 18 processes at 8 panes / 4 live for heavy sites (3.6 to 5.2 GB at 6 live), session restore, drag, find, devtools and extensions in the ring, and Windows/Linux. The rest of this stage: Rework `room.uc.js` so panes are real tabs (section 4.2), with hidden stock chrome (CSS), a vertical tab list, new-window handling, wheel/select/video checks, and memory numbers for 6 to 8 live panes. Deliverable: a signed-off video and a written list of what Firefox's tab machinery refused to do.

**Stage 2: the fork repo, front-end only (about 1 to 2 weeks). The detailed plan is in [FIREFOX-STAGE2.md](FIREFOX-STAGE2.md).** A new repository (not inside the app code) holding patches, branding and defaults against a pinned Firefox release, Surfer-style. Front-end-only patches can be built with Mozilla's artifact builds, which download Firefox's compiled parts and rebuild only JS/CSS, [reportedly in minutes](https://firefox-source-docs.mozilla.org/contributing/build/artifact_builds.html) (anecdotal timing; it only works while no C++ or Rust is changed, so it covers Stages 1 and 2 only). Deliverable: our own named app that opens straight into the Room.

**Stage 3: full builds and distribution (open-ended).** Full source builds in CI for macOS, Windows and Linux; macOS signing and notarization (needs an Apple developer account), Windows signing, an update service, crash reporting off or ours, and Mozilla-branding removal.

**Stage 4: the bent-page look and compositor effects (months, optional).** Only if the flat ring is not enough.

## 6. Constraints and costs for this machine

- 16 GB RAM, 8 cores. Mozilla's macOS guide recommends 8 GB or more of RAM and at least 30 GB free disk ([Building Firefox on macOS](https://firefox-source-docs.mozilla.org/setup/macos_build.html)). The internal disk has about 13 GB free, so the Firefox source and build must live on the external volume (`/Volumes/ChromiumBuild` has about 186 GB free) or another drive. That volume holds the Chromium checkout; a separate folder on it would need the owner's go-ahead, and nothing should be built there while the Chromium compile is running.
- Full Firefox compiles are long (I found no authoritative figure; plan for hours on this hardware), which is exactly why Stages 1 and 2 stay front-end-only.
- Firefox needs to be started through LaunchServices (`open -n`) on this macOS 27 machine; starting the binary directly hangs before any window (see `firefox/README.md`).

## 7. Risks

| Risk | Why it matters | Mitigation |
|---|---|---|
| Google blocks sign-in from the fork build | Would kill the main reason to leave Electron | Stock Firefox passed Stage 0; re-test on every fork build; keep option D alive |
| Real tabs cannot be active and 3D-transformed at once | The whole Room depends on it | Stage 1 tests exactly this; fallback is own `<browser>` elements as in the spike |
| Brand and trademark | A fork cannot ship under Firefox's name or logo; Mozilla's rules distinguish official builds from modified ones, and I could not find the current policy text in my searches | Read Mozilla's Distribution and Trademark policies before Stage 2; ship a different name and icon |
| Security updates | A fork must pull in Firefox's security releases promptly, or it becomes the least safe browser on the machine | Pin to Firefox ESR or release and rebase on every Mozilla release; automate it in CI |
| Rebase cost | Patches against Firefox's front-end break often | Keep patches few and front-end only; put logic in our own module |
| One person maintaining a browser | Time | Stages are shippable alone; stop after Stage 2 if the Room is the only goal |
| Surfer/Zen tooling instability | Reports of build breakage and version pinning in the AUR threads | Do not depend on Zen's tooling for the build; borrow the idea, not the tool |

## 8. Next three steps

1. Stage 1: make panes real tabs, hide Firefox's own chrome, record a short demo (Stage 0 passed).
2. Read Mozilla's trademark and distribution policy pages, and pick a name, before any fork repository exists.
3. Decide where the Firefox source lives (the internal disk is too small; see section 6) and get the owner's OK for a folder on the external volume.

## Sources

- [Zen Browser overview](https://unsubbed.pages.dev/tools/zen-browser/)
- [fx-autoconfig](https://github.com/MrOtherGuy/fx-autoconfig)
- [userchrome.org: what is userChrome.js](https://www.userchrome.org/what-is-userchrome-js.html)
- [Firefox artifact builds](https://firefox-source-docs.mozilla.org/contributing/build/artifact_builds.html)
- [Building Firefox on macOS](https://firefox-source-docs.mozilla.org/setup/macos_build.html)
- [Google: sign in with a supported browser](https://support.google.com/accounts/answer/7675428)
- [Mozilla support: "This browser or app may not be secure" on Firefox](https://support.mozilla.org/de/questions/1418984)
- [Zen build docs (third-party reports of surfer commands)](https://docs.zen-browser.app/contribute/desktop/building)
