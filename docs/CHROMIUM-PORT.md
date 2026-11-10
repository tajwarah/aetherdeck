# AetherDeck on Chromium: port plan

Status: decision document, written 2026-11-10. Research only; nothing in the repo or in the Chromium checkout was changed.
Chromium checkout inspected read-only: `/Volumes/ChromiumBuild/chromium/src`, `chrome/VERSION` = 158.0.8127.18.

## 1. Recommendation (read this first)

**Do not make a hard fork the first move. Port in two stages, and let stage 1 prove what stage 2 has to be.**

1. **Stage 1: AetherDeck as a Manifest V3 Chromium extension** (side panel for Cosmonaut and "ask about this page", new-tab research center, Shields, agents, ChatGPT/Gemini/other providers), talking to the existing Node server on `127.0.0.1`. Pages are ordinary Chromium tabs, so **Google sign-in is a non-issue**. It runs in any Chromium, including the Brave on your Windows test box today and your own 158 build when it finishes.
2. **Stage 2: a thin Chromium fork** (a small, rebased patch set, not a Brave-sized one), only for what an extension cannot do: the spatial window manager and the 360° room, which need an embedded-page element and offscreen capture. The checkout already contains the pieces (`<webview>` in a chrome:// page; Controlled Frame). Decide after a prototype, not now.

Why not the others, in one line each:

- (a) full UI fork now: highest cost, and the 4-weekly rebase is a permanent job. Premature before stage 1 shows which features justify it.
- (b) CEF or content_shell: **Google names CEF in its embedded-framework sign-in block**, so it reproduces the exact Electron problem. Rejected.
- (d) Electron plus system browser for Google: cheap, but a Google sign-in in the system browser does not give the Electron panes a Google session. Gmail, YouTube and "Continue with Google" inside AetherDeck panes stay broken. Only useful as a stopgap for AetherDeck's own OAuth (already done for ChatGPT in `electron/chatgpt.ts`).

## 2. What depends on Electron and what moves as is

Size: `electron/` is about 2,400 lines in 14 files; `server/` about 3,400; `shared/` about 800; `src/` about 11,800 (plus 2,100 lines of CSS).

### 2.1 Moves as is (no Electron import)

| Part | Evidence |
|---|---|
| `server/` (research orchestrator, providers, ranking, evidence, model backends: Anthropic, OpenAI-compatible, Gemini, OpenRouter, Groq, ChatGPT plan, sync, preview) | `grep` finds no `electron` import in `server/` or `shared/`. Plain Node 22, started in-process by `electron/main.ts` today, runs as `npm start` already. |
| `shared/` (Zod contracts, harvest scripts, curve and surround math, serp parsing, crx helpers, shields URL helpers) | same grep |
| Most of `src/`: Field, Hero, Earth, Logo, views (evidence, mind map, places), layout, windows model (`lib/windows.ts`), sync (`lib/sync.ts`, `useSync.ts`), Composer, Inspector, Assistant UI, Research board UI, agents UI/schedules | pure React/CSS/WebGL; 19 `src/` files touch `lib/desktop.ts`, the rest do not |
| Tests: vitest units for the above | no Electron needed |

### 2.2 Electron-only (must be replaced or dropped)

| Electron piece | What it does | Chromium equivalent |
|---|---|---|
| `<webview>` in `LivePage.tsx` + `will-attach-webview` locking in `main.ts` | every page is a webview in a glass pane | **Biggest gap.** Extensions cannot embed pages like this. See 2.3. |
| `electron/curved.ts`, `curve-gl.ts`, `surround-gl.ts`, `CurvedPage.tsx`, `Surround.tsx` (360° room) | offscreen `BrowserWindow`, `sharedTexture` frames, `sendInputEvent`, `capturePage` | No extension equivalent (`tabCapture` is a video stream of a tab, no synthetic input mapping). Needs stage 2 or an iframe-based redesign. |
| `electron/engine.ts` (agent page pool) | invisible pages in the user's session, `executeJavaScript`, `getOSProcessId`, `webRequest` skipping images | Extension: `chrome.windows.create({state:"minimized"})` plus `chrome.scripting`, or `chrome.debugger` (shows an infobar). Workable, less tidy. |
| `electron/shields.ts` | Ghostery engine via `session.webRequest.onBeforeRequest`, HTTPS upgrade, GPC, link de-tracking | MV3 has no blocking `webRequest`; use `declarativeNetRequest` rules (rule-count caps apply; figures vary by source and I did not confirm them in Chrome's own docs). Ghostery already ships an MV3 build. Per-page block counter via DNR feedback is weaker. |
| `electron/extensions.ts`, `extension-shim.ts`, `src/components/Extensions.tsx` | loads Chrome extensions into Electron and stubs missing APIs | **Disappears.** Real Chromium runs extensions natively. Net deletion of about 400 lines. |
| `electron/store.ts` (history, bookmarks, agents, research board) + `safeStorage` for keys | JSON files, OS keychain | `chrome.history`/`chrome.bookmarks` are native; board and agents go in `chrome.storage.local` or the local server. **Keys:** no `safeStorage` in an extension; `chrome.storage` is not encrypted. Keep keys in the server process (OS keychain via a small native helper) or accept plain storage with a clear warning. |
| `electron/chatgpt.ts` (OAuth PKCE, loopback :1455, `safeStorage`, `shell.openExternal`) | ChatGPT-plan sign-in | Logic moves to the server. `chrome.identity.launchWebAuthFlow` or just `chrome.tabs.create` replaces `shell.openExternal`; the loopback listener stays in Node. The "open in Safari/Edge because we are the default browser" hack becomes unnecessary. |
| `electron/main.ts` session handlers: permission prompts, downloads, context menu, popups to panes, scheme confirmation, default-browser, auto-update, global shortcut | | All native in Chromium (prompts, downloads, menus, default browser, updater of the browser itself). Re-add only: "Explore in AetherDeck" (`chrome.contextMenus`), the summon shortcut (`chrome.commands`, not global), popup-to-pane (not possible in an extension; becomes a normal new tab). |
| `electron/phone.ts` (adb scrcpy-style mirroring, AirPlay via uxplay) | spawns local binaries, clipboard | Needs a native helper. Extensions can use Native Messaging to a small host, or this feature stays in a companion app. Lowest priority. |
| `electron/sites.ts`, `apps.ts` (agent-built sites, `agent-app:` scheme, file dialogs, `page:attach`) | custom protocol, `dialog`, `shell` | `chrome.downloads`/File System Access API for files; the custom scheme needs a server route or extension page. |
| `electron/preload.ts` IPC bridge (about 100 channels, 17 events) | the interface's only door to the OS | Replaced by `chrome.runtime` messaging plus HTTP to the local server. `lib/desktop.ts` is already the single seam (`desktop.invoke/on`); implement a second backend there and most of `src/` is untouched. |

### 2.3 The structural problem

AetherDeck's identity is **one React app that owns the screen and puts every real web page inside it as a pane**. Electron allows that with `<webview>`. Stock Chromium does not give extensions an equivalent:

- A plain `<iframe>` in an extension page fails for sites with `X-Frame-Options` / `frame-ancestors` (the docs already admit this for the web build). `declarativeNetRequest` can strip those headers for the extension's own frames, but that is something to prototype, not assume.
- **Larger risk, untested:** an extension page's origin is `chrome-extension://…`, so every framed site is third-party. Sites that rely on `SameSite=Lax` session cookies may show up logged out inside the panes. This one prototype decides how far stage 1 can go with spatial panes.
- Controlled Frame (the supported `<webview>` successor) is **limited to Isolated Web Apps**. The source is in the 158 checkout (`chrome/common/controlled_frame/`, README says it is built on the Chrome Apps `<webview>`), but IWAs are a signed-bundle packaging model, and I could not verify its general-availability or install story for a consumer product.
- Chromium itself uses `<webview>` inside a chrome:// page: `chrome/browser/resources/inline_login/inline_login_app.html.ts` references it (that is the Google/Gaia sign-in dialog). So a **built-in `chrome://aetherdeck` WebUI page with `<webview>` panes is a plausible stage-2 route**; I did not trace how the tag is enabled for WebUI, and that is the first thing to read there.

## 3. The four options compared

Effort figures are my own estimates for one developer already fluent in this codebase, not measured. "Upkeep" means the 4-week Chromium cadence (stable majors every ~4 weeks; I did not re-verify the 2026 calendar).

| | (a) Patch Chromium UI (Brave/Vivaldi style) | (b) CEF / content_shell | (c) Extension + side panel | (d) Keep Electron, system browser for Google |
|---|---|---|---|---|
| What you ship | Your own browser | Your own app on Chromium | An add-on for any Chromium browser, or preloaded in your build | Today's app |
| Effort to reach feature parity | Months. All of 2.2 re-done in C++/Views or WebUI; 360° room needs Viz/compositor work | Weeks to months; CEF has no webview tag, you build the pane layer yourself; extension support is thinner than Electron's | Days for side panel, new tab and server link; 3 to 6 weeks for Shields, agents, board; spatial panes and 360° room uncertain | Nothing, but nothing is fixed |
| Upkeep per Chromium release | Heavy and permanent. Brave publishes a schedule keyed to Chromium and promises a Chromium-only release within 24 hours of security updates, which needs a dedicated team. A thin patch set (tens of files) is a few days per rebase | Moderate: CEF itself tracks Chromium and publishes a build per major (newest I found was CEF 146 on Chromium 146, Mar 2026). You wait on CEF and rebuild | Low. Extension APIs are stable; breakage is occasional (e.g. `sidePanel.open()` needs a user gesture, a 2024 report says a gesture was lost after any `await`) | Electron major every ~8 weeks; you already do it |
| **Google sign-in** | **Works in principle**: it is a real Chromium browser with a true Chrome UA. Brave worked in your Windows test. Not yet tested on your own 158 build (milestone 0) | **Blocked by policy.** Google's guidance says sign-ins from embedded frameworks, naming CEF, are blocked, and that a browser must identify itself and not spoof another browser's UA. AetherDeck currently strips "Electron" from the UA, which is the fragile hack | **Works**: pages are normal tabs in a normal browser, nothing embedded | **Works only in the other browser.** Inside AetherDeck panes it is still blocked |
| Windows / Mac / Linux | Three builds, three signing setups, three update channels. You are already building Mac | Same three builds | One package for all three; the host browser handles each OS | Already shipping all three |
| Widevine (Spotify, Netflix) | Not in plain Chromium; needs a Google licence (unverified path for a small project) | Same | Inherited from the host browser if it is Chrome or Brave | Needs Castlabs Electron (already a known limit) |
| Google account features (sync, browser sign-in) | Lost unless you obtain your own Google API keys; Google restricted third-party Chromium use of its sync APIs from March 2021 (web sign-in is a separate matter, not confirmed on current builds) | n/a | Host browser's | n/a |
| Biggest risk | Maintenance sinks the product | Wrong platform for the stated goal | Spatial window manager and 360° room cannot be reproduced; cookie behaviour in framed sites | Does not solve the goal |

### Verification status of the facts used

| Claim | Status |
|---|---|
| Google blocks sign-ins from embedded frameworks including CEF; browsers must identify themselves, no UA spoofing | **Verified** from Google's developer blog guidance (2020, effective Jan 2021). That page does not name Electron; the Chromium embedder-dev thread says Google's plan was to block "CEF (and presumably Electron)". Your own Electron test matches. |
| Google has not changed this since 2021 | **Could not verify.** No 2025 or 2026 source found; your tests are the best current evidence |
| Real Chromium or Brave signs in | **Your Windows/Brave test**; not independently sourced. Your own 158 build is untested |
| Chromium-based browsers are distinguished from "embedders" by Google | **Not documented.** The embedder-dev thread asks this question and the retrieved text shows no answer. Treat the distinction as empirical, i.e. keep testing on your build |
| CEF: Alloy bootstrap removed (about M127/128), Chrome style is the path; newest release found was 146 | **Verified** from CEF announcement and package pages; 2026 roadmap not found |
| `chrome.sidePanel` needs MV3, Chrome 114+, `open()` needs a user gesture | **Verified** from developer.chrome.com listing and extension-list threads; the gesture bug status after 127 not confirmed fixed |
| MV3 has no blocking `webRequest`; DNR rule limits | Direction verified; **numbers and MV2 removal dates conflict between blogs and were not checked against Chrome docs** |
| Controlled Frame is IWA-only and built on `<webview>` | **Verified** (Chrome docs plus the README in your 158 checkout). General availability not verified |
| `<webview>` inside a chrome:// page | **Verified present** in `inline_login_app.html.ts`; enabling mechanism not traced |
| Google API-key and sync restrictions on third-party Chromium (2021) | Verified as historical; current state unknown |
| Brave rebase process and team size | Release schedule verified; team and effort numbers **not found** |
| content_shell rebase cost | **Not found.** General knowledge only: it is a test shell, not a product (no extensions, no sync, minimal UI) |

## 4. First milestone (days): "AetherDeck Sidekick" in plain Chromium

Goal: prove Google sign-in plus the highest-value features without touching Chromium's source or waiting for the compile.

Scope, 2 to 4 days:

1. MV3 extension `chromium/` folder (new directory; no change to Electron code). Manifest with `sidePanel`, `activeTab`, `scripting`, `contextMenus`, host permission for `http://127.0.0.1:8787/*`.
2. **Side panel** = the existing `Assistant`/Cosmonaut UI, fed by `chrome.scripting.executeScript` page text (the same text `PageHandle.text()` returns today). Right-click "Explore in AetherDeck" via `chrome.contextMenus`.
3. **New-tab / action page** = the existing research map (`/api/explore`) from `npm start`. Start with the server serving the built `dist/` and the extension simply opening it in a tab; no code port needed for this step.
4. In `src/lib/desktop.ts`, add a second backend (extension messaging) behind the same `Bridge` interface so `src/` stays unchanged.
5. Sign-in checks, done by hand: Gmail, YouTube, "Continue with Google" on a third-party site, and ChatGPT sign-in, in (i) Brave, (ii) stock Chrome, (iii) your 158 build when ready.

Acceptance: ask a question about the open page in the side panel, run a research map, and sign in to Google normally in the same browser. Whether the server accepts requests from the extension (token and CORS handling in `server/index.ts`) I did not check; that is part of step 1.

## 5. The exact next three steps

1. **Today, no build needed:** on the Windows box, load a stub MV3 extension (side panel that fetches `http://127.0.0.1:8787/api/health`-style endpoint, or just the dist page) into Brave and confirm the server link works. Also run the framed-site cookie test: an extension page with an `<iframe>` to a site you are signed in to, with and without a `declarativeNetRequest` header-strip rule. **This answer decides whether spatial panes can live in an extension.**
2. **When the compile finishes (milestone 0 for stage 2):** launch the 158 build with a fresh profile and sign in to Google, YouTube, and ChatGPT; record the UA string (`navigator.userAgent`). Then `grep` in the checkout for how `inline_login` enables `<webview>` (`chrome/browser/ui/webui/signin/`), to judge whether a small `chrome://aetherdeck` WebUI patch is a few files or a few hundred.
3. **Build the Sidekick extension (section 4)** and ship it as a release asset alongside the Electron app, labelled "recommended for Google sign-in". Re-read this document with the two test results, then choose: extension only, or extension plus thin fork for spatial panes and the room.

## 6. Things I did not do or could not check

- Did not run any build, gn, ninja or git command in the Chromium checkout; only `ls`, `grep`, `cat` on files.
- Did not run the app or tests in the AetherDeck repo. The working tree has uncommitted changes (README, `electron/chatgpt.ts`, `preload.ts`, `DesktopSheets.tsx`, styles, new docs); this plan describes the code as it was on disk when read.
- Did not read every `src/` component; the Electron-dependency list for `src/` comes from `grep` for `lib/desktop.ts`, `invoke(` and `<webview>`, plus reading `main.ts`, `preload.ts`, and the top of `chatgpt.ts`, `engine.ts`, `curved.ts`, `shields.ts`, `extension-shim.ts`.
- Effort and rebase-time estimates are judgement, not measurement.

## Sources

- [Google: guidance on blocking less secure browsers and applications](https://developers.googleblog.com/guidance-to-developers-affected-by-our-effort-to-block-less-secure-browsers-and-applications/)
- [Chromium embedder-dev: Google to block sign-ins from Chromium embedders](https://groups.google.com/a/chromium.org/g/embedder-dev/c/STyM5ZNTHMM)
- [chrome.sidePanel API](https://developer.chrome.com/docs/extensions/reference/api/sidePanel)
- [Controlled Frame](https://developer.chrome.com/docs/iwa/controlled-frame)
- [Replacing blocking web request listeners (MV3)](https://developer.chrome.com/docs/extensions/develop/migrate/blocking-web-requests)
- [CEF announcement on Alloy bootstrap removal](https://groups.google.com/g/cef-announce/c/s1WaovAopFo)
- [Brave release schedule](https://github.com/brave/brave-browser/wiki/Brave-Release-Schedule)
- [chromium-packagers: Update on Google API usage in Chromium](https://groups.google.com/a/chromium.org/g/chromium-packagers/c/SG6jnsP4pWM)
