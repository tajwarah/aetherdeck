# AetherDeck Room in Firefox (spike)

> The spike grew into AetherDeck for Mac. Its Stage 1 script (`room-tabs.uc.js`) is now the browser's Room at [`browser/room-src/`](../browser/room-src/browser/components/aetherdeck/room.js); see [browser/README.md](../browser/README.md). This folder keeps the original Stage 0 spike.

A one-day test of the question: can the Room be the browser's own window, with real pages (not iframes) on a 3D ring?
Answer from this spike (Firefox 159.0.1, macOS): yes. Findings are at the bottom.

## What it is

- `config.js` + `config-prefs.js`: Firefox "autoconfig". It runs at startup and loads `room.uc.js` into every browser window with chrome privileges (the same mechanism fx-autoconfig and Zen's mods build on).
- `room.uc.js`: draws a full-window overlay with a CSS 3D ring (`perspective`, `preserve-3d`, `rotateY(-yaw) translateZ(-R)`, the same maths as `chromium/src/roomLogic.ts` / `shared/surround.ts`) and puts a real `<browser type="content" remote="true">` element in each pane. Keys: ← → turn, 0 show all, Esc or the bar button leaves the Room (hides it; restart to get it back). `window.adRoom` exposes the camera for tests.
- `run-spike.sh`: starts a COPY of Firefox with a throwaway profile. Your installed Firefox is never touched.

## Run it

```bash
firefox/run-spike.sh /path/to/a/COPY/of/Firefox.app /tmp/aetherdeck-ff-profile
```

It copies the autoconfig files into that app copy (this voids Mozilla's signature, so the script re-signs it ad hoc), then starts it through `open -n`. Starting the binary straight from a shell hangs before any window on macOS 27 (found the hard way), so do not do that. Set `AD_ROOM_URLS=https://a.com,https://b.com` in the environment to choose the panes. The script also starts Marionette (port 2828) and allows system access for it, for automated tests; do not leave that running on a machine you care about.

## Findings

Verified here, by screenshots and by driving the window with Marionette:

1. Real pages render in tilted, perspective-projected panes, live: GitHub, Pinterest, and Google's Gmail sign-in page.
2. **Gmail was not refused.** `mail.google.com` redirected to `accounts.google.com/v3/signin/identifier` and drew the normal sign-in form in its ring pane. A `<browser>` element is a top-level page, so there are no framing headers to fight and no header-removal rules.
3. **Clicks map exactly under a 20° tilt.** A synthetic mouse click at a screen point in a tilted pane arrived in the page at the coordinates the exact projective (homography) inverse of the pane's quad predicts: (665, 367) and (305, 586), to the pixel.
4. **Typing works in a tilted pane**: clicked an input, typed "hello", the page received "hello".
5. Show all (pull back, wide field of view) works with live content in all three panes.

6. **Google sign-in works** (owner, by hand): signed in to Gmail inside a tilted ring pane and in a normal tab. An earlier attempt was blocked ("This browser or app may not be secure") because that run had Marionette on, which sets `navigator.webdriver`; the script now starts without it unless `AD_MARIONETTE=1`. Never test Google sign-in with remote control on.

Not verified:

- Whether Google accepts a fork build (stock Firefox passed; a fork changes user agent and branding).
- Wheel scrolling, text selection, drag, IME, video playback and fullscreen in a tilted pane; popups and new-tab links (panes' own `window.open` is not handled yet, they would open Firefox tabs underneath); performance and memory with 6 to 8 live panes; behaviour at steeper angles.
- Anything on Windows or Linux.
- That synthetic events (Marionette actions) are equivalent to a real mouse. They go through the same widget and hit-testing path, but a hand test is still needed.

## Stage 1: real tabs on the ring (`room-tabs.uc.js`)

The script has since moved into AetherDeck for Mac ([`browser/`](../browser/README.md)); the notes below describe it as it was in the spike.

How it works: it opens ordinary tabs with `gBrowser.addTab`, calls Firefox's own `gBrowser.showSplitViewPanels(tabs)` (Firefox 159's split-view machinery, which inserts each tab's browser, sets `docShellIsActive = true` and marks the panel `split-view-panel-active`), then gives each panel a 3D transform on the same ring maths and hides Firefox's toolbox and sidebar with CSS. It re-asserts `docShellIsActive` on every `TabSelect`, because Firefox deactivates the tab you switch away from.

Verified here (Firefox 159.0.1, macOS, synthetic input through Marionette, remote control off for the Google test and on for these):

1. Several real tabs are live at once (`docShellIsActive` true for all) and each is a normal tab, shown on the ring with perspective; the toolbar and sidebar are hidden.
2. Typing into an input in a **non-selected real tab under a tilt** worked ("hello" arrived).
3. A `target=_blank` link clicked in a tilted real tab opened a new Firefox tab, which the `TabOpen` handler adopted as the next ring pane and flew to; 4 of 4 clicks that landed on a loaded page did this (earlier attempts clicked before the test page had loaded and did nothing). No `webNavigation`-style workaround is needed.
4. Closing a tab removes its pane (`TabClose` handler).

Added in the second pass (all tested through Marionette on Firefox 159.0.1):

- **Pane cap:** at most 8 panes. A link-opened tab beyond that is left outside the Room (a notice shows in the bar); the address box and `addPane` refuse past 8.
- **Sleep:** only the 6 panes nearest the camera stay live. Others are discarded with Firefox's own `gBrowser.discardBrowser` after 20 seconds out of range (or at once when the live count would exceed 6) and wake when the camera turns back; a woken pane reloads its page, so scroll position and typed text are lost. In a run with 8 panes the bar read "6 live of 8" and stayed at 6 after turning to a sleeping pane.
- **Address box** in the bar: an address opens as a new pane (turning to it), other text searches DuckDuckGo. Tested: refused at the cap with a message, accepted after closing a pane.
- The window's own blank tab is now the first pane, so nothing hides behind the ring.
- Bugs found and fixed while testing: a pane made by the Room was adopted twice by the link handler (it counted twice); a pane put to sleep before its first page loaded came back blank; a woken pane showed its panel but did not reload.
- **Known workaround, cause not found:** some panes created while the Room was open stayed on `about:blank` without ever loading. A watchdog now reloads a live pane that is still blank 8 seconds after it was made (up to 3 tries). In the last run every one of the 8 panes ended up with a real page, but the watchdog fired on most of them, so treat this as a patch over something not understood.
- **Memory is still heavy.** 8 panes (6 live) across 35 Firefox processes added up to about 3.6 to 5.2 GB resident across runs (overcounts shared pages; one run with 11 panes before the hard cap showed about 6.5 GB). That is for heavy sites (BBC, NYT, Wikipedia, HN, GitHub, Pinterest). It is not a number to ship on a 16 GB machine without a lower live cap or lighter sites; a cap of 4 live is the first thing to try.

Third pass:

- **Live cap is now 4 by default** (`AD_ROOM_LIVE=2..8` to change). With 8 panes and 4 live on the same heavy sites, the Firefox processes added up to about 2.7 GB resident across 18 processes (versus 3.6 to 5.2 GB across 35 to 40 at 6 live). Still an overestimate of unique memory, and still the number to keep watching.
- **Tab list:** a "Tabs" button in the bar opens a left rail listing every pane (number, page title, host, "asleep" state) with a close button; clicking a row turns the camera to that pane. Tested: the rail lists all 8 panes and a click sets the camera target to that pane's direction. Not looked at on screen (another Firefox window was in front during the test).

Findings that need work:

- Memory: with 7 live panes plus a few other tabs, the Firefox processes added up to about 3.8 GB resident (an overestimate, since shared pages are counted per process; the main process alone was about 610 MB). Not acceptable for 6 to 8 panes on a 16 GB machine without a cap and sleep policy (suspend panes behind the camera, as the extension Room does).
- Firefox's split-view footer (a `split-view-footer` element with the page address) had to be hidden with CSS. Other split-view styling may leak in at other sizes.
- Not tested: session restore, tab drag/reorder, find-in-page, devtools, pinned tabs, private windows, tab groups, extensions, wheel scroll and text selection in a tilted pane, video, many panes, window resize, and any OS other than macOS.
- Tab list: there is none; the ring is the only view (no vertical tab strip yet).

## What a real version needs

This script is an overlay on a stock Firefox, with the tab strip and address bar still underneath. A real product would hide or replace Firefox's chrome (Zen does this with its own CSS and JS, and a patch set on Firefox's source), make the ring panes proper tabs (so history, sessions, sign-in state and extensions work), handle new-window requests, and ship as a fork. Gecko build with artifact builds keeps front-end-only work to minutes, per Mozilla's documentation.
