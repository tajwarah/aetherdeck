# AetherDeck Sidekick (Chromium extension)

AetherDeck as an add-on for a real Chromium browser (Chrome, Brave, Edge, or your own Chromium build). Pages are ordinary tabs, so signing in to Google works the way it does in any browser. Background and the decision behind this: [docs/CHROMIUM-PORT.md](../docs/CHROMIUM-PORT.md).

What it does today:

- **Side panel:** Cosmonaut, the same Assistant as the desktop app, answering about the page in the tab beside it. The page text is read in the browser and sent to your AI model only with a question you ask.
- **Right-click → "Explore “…” in AetherDeck"** on selected text opens the research map with that question. **"Ask Cosmonaut about this page"** opens the side panel.
- **Home page** (right-click the toolbar button → "Open the AetherDeck research map"): server status and a search box that opens the research map.
- **Framed-site cookie test** (`cookie-test.html`): a small test page, see below.

Not in the extension (yet): the spatial windows, the 360° room, Shields, agents' page engine, phone mirroring. They need the Electron app, or the stage 2 plan in the doc above.

The extension talks to the **AetherDeck server on your computer**, which holds the AI keys. It does not contain any.

## 1. Build and start

```bash
npm install
npm run build                              # the interface the research map is served from
npx vite build --config chromium/vite.config.ts    # the extension, into chromium/dist
npm start                                  # the server, on http://127.0.0.1:8787
```

Give the server an AI model in `.env` (one key, as in [the guide](../docs/GUIDE.md)); without one the map still works from open sources and the side panel says no model is connected.

When the server starts it creates `data/sync/extension-token` (or `AETHERDECK_DATA_DIR/extension-token`), a random secret readable only by you, and prints its path. The extension must present this token; anything without it is refused.

## 2. Load it unpacked

Chrome, Brave or Edge: open `chrome://extensions` (Brave: `brave://extensions`), turn on **Developer mode**, press **Load unpacked**, choose the `chromium/dist` folder. Then pin the **AetherDeck Sidekick** button.

Then open the extension's **Options** (right-click the button → Options), paste the token from `extension-token`, and press **Save and test**. It should say "Connected".

The extension id is fixed by the key in `manifest.json` (`dpdakialhkiilacahidebgkpmcoenmop`), and the server already allows that id. For a different build with another id, start the server with `AETHERDECK_EXTENSION_ID=<id>`.

Windows: the same steps; paths use `\`. Your own Chromium build: start it with a fresh profile and do the same.

## 3. By-hand checklist

Do these in the browser you are testing, in normal tabs, and note which pass. (Google sign-in is the point of the exercise.)

- [ ] **Gmail:** open mail.google.com and sign in.
- [ ] **YouTube:** open youtube.com; it recognises the Google sign-in.
- [ ] **Continue with Google** on a third-party site (any site offering it): the Google window opens and completes.
- [ ] **ChatGPT:** sign in to chatgpt.com (or use the server's ChatGPT sign-in if you have set it up).
- [ ] **Side panel:** on any ordinary article, open the panel, ask "Summarize this page." An answer arrives and says which model it came from.
- [ ] **Right-click → Explore:** select a few words on a page, choose "Explore … in AetherDeck": a tab opens and starts the research map.
- [ ] **Refusals:** on `chrome://extensions` the panel says it can't read the page (expected).
- [ ] **Server stopped:** stop `npm start`; the panel says AetherDeck isn't running.
- [ ] **Wrong token:** change one character in Options; Save and test says the server refused it.
- [ ] Record the browser name, version and the `Browser:` line from the cookie test report (below).

## 4. The framed-site cookie test (please run on the Windows Brave machine)

Open the extension's home page (right-click the toolbar button → "Open the AetherDeck research map"), follow **Framed-site cookie test**, or open `chrome-extension://dpdakialhkiilacahidebgkpmcoenmop/cookie-test.html` directly.

It answers one question: **when a site is shown inside an extension page (how AetherDeck's spatial panes would work), does it still see your cookies and sign-in?** Three tests:

1. A harmless probe on httpbin.org (a public test service): set one cookie in a normal tab, then show it back in a frame.
2. A site you are signed in to, framed as it is.
3. The same site with the framing block (`X-Frame-Options`, `Content-Security-Policy`) removed for that tab by a temporary rule. The browser asks permission for that one site.

Answer the radio buttons under each frame, press **Copy report**, and paste it back. The report holds the browser string, the date, the site's address (not its content), and your answers. **Remove the probe cookie** cleans up afterwards.

## 5. Panes: real sites side by side, with a window fallback

Open it from the toolbar button's right-click menu → **Open AetherDeck Panes**, or the **Panes** link on the home page, or `chrome-extension://dpdakialhkiilacahidebgkpmcoenmop/panes.html`.

Two panes to start (up to four), each with its own address bar, reload, **Window** and **Close pane** buttons; **+ Add pane** adds one, **Tidy windows** re-places the pane windows. Panes and the "always a window" sites are remembered.

**How a site is shown.** Each pane is an iframe on the extension page. Sites that allow framing (Pinterest) just work, signed in, as the cookie test showed. Sites that refuse (GitHub, YouTube) show a bar at the bottom of the pane once they fail: **Allow framing for this site**. Only that click installs a rule, so nothing is changed for a site you never had trouble with.

**The rule, and why it is this narrow** (`chromium/src/panesLogic.ts`, `buildRule`):

- Only `sub_frame` requests (never a page you open in a tab), only in the Panes tab itself (`tabIds`), only the one site the pane shows (`requestDomains`), and the browser asks you for permission for that exact host first (`*://host/*`, not its subdomains).
- It removes two response headers, `X-Frame-Options` and `Content-Security-Policy`, nothing else. Removing the CSP drops the site's other script protections too, but only inside that pane; do not use Allow framing for a site you do not trust.
- **Never** for `google.com` and everything under it, `gmail.com`, `googlemail.com` or `accounts.youtube.com` (`NEVER_STRIP`): the code returns no rule for them. Plain YouTube pages are allowed because the cookie test showed they load signed in; if a pane on `youtube.com` is redirected to Google sign-in, that host is not covered, so it fails and you get the window fallback. A rule on `youtube.com` itself still excludes `accounts.youtube.com`.
- The rule is removed when the pane is closed, when its address changes, when the page closes, and swept again when the page opens (leftovers are session rules, which also vanish when the browser restarts). Rule ids are 5000 + the pane number, so they never touch the cookie test's rule (4242).
- Limit: the rule covers every frame request to that host in that tab, not only the first one. Any link inside the pane to the same host is also unprotected.

**The tile fallback.** Google mail and account pages (`mail.google.com`, `accounts.google.com`, `myaccount.google.com`, `gmail.com`, `accounts.youtube.com`) are not even tried in a frame: the pane offers **Open as window**. So does any pane that fails to load, and **Always as window** adds the site to your own list (shown at the bottom, removable). The window is a real browser popup (`chrome.windows.create`, type `popup`), placed over the pane's slot from its screen rectangle, so sign-in works as in any browser. The extension keeps a registry (pane → window id, in session storage): **Close pane** closes its window and **Close window** closes it without removing the pane. **Tidy windows** moves each pane's window back over its slot, which you want after moving or resizing the Panes window. Closing the Panes tab leaves the windows open; reopening it picks them up again.

**What it can and cannot tell about a failed pane.**

- With **Turn on blocked-site detection** (an optional permission, `webNavigation`, which the browser describes as reading your browsing history; this page only looks at errors of its own frames) the pane learns that a frame was refused or failed and says so, with the error.
- Without it, or if the browser does not report it for a frame, the only signals are a 15 second load timeout and the pane's own Window button. A refused frame still fires the normal `load` event, and a page cannot look inside a cross-origin frame, so **a blank or error page inside a frame cannot be detected without that permission, and a page that loads but shows nothing is never detected**.
- The detection matches an error to a pane by the pane's host, so a refusal after a redirect to another host may not be attributed.
- Window placement is approximate: it assumes the browser toolbar sits above the page, and a popup has a title bar of its own, so it can be a few dozen pixels off. Tidy repeats the same estimate.

**By-hand test list for Panes** (reload the extension first; allow the prompts):

- [ ] Open Panes. Pane 1: `pinterest.com`. It loads signed in (no rule needed).
- [ ] Pane 2: `github.com`. If it shows an error or blank page, press **Allow framing for this site**, accept the prompt: it reloads signed in. (With detection on, the bar appears by itself.)
- [ ] **+ Add pane**: `youtube.com`, same steps. Signed in? Note what happens if it redirects to Google sign-in (expected: fails, offers a window).
- [ ] **+ Add pane**: `mail.google.com`. It must show the "Open as window" card, never a frame. Press it: a popup lands over the pane; sign-in works; it is the real Gmail.
- [ ] Move the Panes window, press **Tidy windows**: the Gmail window follows its slot.
- [ ] In the Panes tab's console (F12) run `await chrome.declarativeNetRequest.getSessionRules()`. Expect one rule for github.com and one for youtube.com (hosts you allowed), none for Google.
- [ ] **Close pane** on github.com: its rule is gone from the same list. **Close pane** on Gmail: its window closes.
- [ ] Close the Panes tab and run the same console line from another extension page (e.g. the cookie test): no pane rules.
- [ ] Mark one site with **Always as window**; it appears at the bottom, and from then on its pane shows the "Open as window" card instead of a frame; the × removes it.
- [ ] Record what did not work and the browser version.

## 6. The Room: panes on a ring, in CSS 3D

Open: **Alt+Shift+R**, the toolbar button's right-click menu → "Open the AetherDeck Room", the omnibox (type `ad`, a space, then `github.com`), the Room link on the home page, or (Room flavour) the toolbar button and every new tab.

**Two flavours.** `chromium/dist` is the normal build (toolbar button = side panel, new tabs untouched). `chromium/dist-room` adds `chrome_url_overrides.newtab` (so every new tab is the Room), makes the toolbar button open the Room, and makes `webNavigation` a normal permission. A manifest override cannot be switched off while running, hence a second build with its own key (id `jdohkdnhibacjeldkakehjfjciaijfle`, already allowed by the server). Build both:

```bash
nice -n 19 npx vite build --config chromium/vite.config.ts
SIDEKICK_FLAVOUR=room nice -n 19 npx vite build --config chromium/vite.config.ts
```

Reload: `chrome://extensions` → press the reload arrow on the loaded extension (a manifest change such as the new shortcuts and omnibox needs the reload, not just a page refresh). To try the Room flavour, load `chromium/dist-room` as a second unpacked extension (the two have different ids, so both can be loaded; unload one if you do not want two toolbar buttons or two `ad` keywords). Set shortcuts at `chrome://extensions/shortcuts`.

**How it is built.** `chromium/src/roomLogic.ts` takes the ring from `shared/surround.ts` (`layoutPanels`: pane order, the 0.07 gap, shrink-to-fit past about five panes, first pane straight ahead, 1.45 aspect, same field of view limits and the same `exp(-11 dt)` glide and 4.4 coasting as `Surround.tsx`). Each pane is an iframe 1100×759 `rotateY(-yaw) translateZ(-R)`, with R chosen so a flat pane spans exactly the angle `surround.ts` gives it. The camera is the transform of the parent: `perspective` from the same `1/tan(fov/2)` focal length, `translateZ(P) rotateY(yaw)`. The browser hit-tests transformed iframes itself.

**Controls.** Arrows, `1`-`9`, the dots in the strip at the bottom: fly to a pane. `0`/`O` or Show all: pull back to see the ring from its far side. Drag the empty background (or a shielded pane): look around, with coasting, then settle on the nearest pane. Wheel on the background, or `+`/`-`: zoom. Keys only reach the Room while the focus is outside a pane's page, so **the extension shortcuts (Alt+Shift+R, Alt+Shift+Left/Right, Alt+Shift+O) are the ones that work while you type inside a site.**

**Shields.** As in the Electron room, the pane ahead of you is the one in use: a pane more than 0.35 rad (about 20°) off where you look has a transparent shield; clicking it turns to it. Nearer panes, tilted or not, take real clicks, scrolling and typing. **Direct** switches every shield off, to test a strongly tilted pane.

**Links that open a new tab.** `chrome.webNavigation.onCreatedNavigationTarget` sees a new tab made from a Room tab; the address (waiting for it past `about:blank` if need be) goes to the Room as a new pane at the end of the ring, and the tab is closed only after the Room confirms it took it (so at 8 panes, or if the Room is gone, the tab stays as the browser opened it). Frames are sandboxed without top-navigation, so `target=_top` and `top.location` cannot replace the Room; popups escape the sandbox so they become tabs, then panes. Cannot intercept: a new pane always goes to the end of the ring, not beside the page that opened it (the event does not say which pane); `window.open` that stays `about:blank` and is filled by script has no address to hand over, so its tab remains; downloads and `mailto:`/app links are not panes. This page-hijack protection is only in the Room; the Panes page frames have no sandbox.

**Google mail and accounts: live mirror.** Those hosts never get a framing rule. The pane's card offers **Mirror here (live, view-only)**: it opens the site in a real popup window, then asks the browser's own sharing prompt (`getDisplayMedia`) for you to pick that window or its tab, and shows the stream in a `<video>` on the ring. Click the picture to bring the real window forward and type there. **Open as window** still works too. I did not use `chrome.tabCapture`: it needs the extension to be invoked on the target tab first (toolbar click or shortcut on that very tab), which a popup we open ourselves never is. The mirror is a picture: no clicks go through it, and the sharing prompt appears each time and shows the browser's "sharing" banner.

**Limits and memory.** At most 8 panes and 6 live pages: the 6 nearest to where the camera is heading stay awake; others are dropped (blanked, shown as "Asleep") after 20 seconds out of range and reload when you turn back, so their scroll position and unsaved input are lost. The corner readout shows live panes and this page's JS heap; the sites' own memory is in other processes: use the browser's Task Manager (Shift+Esc).

### How this differs from the Electron 360° room (and what stage 2 would add)

| | Electron room | This Room |
|---|---|---|
| Shape | One continuous cylinder; pages bent around you in WebGL (`electron/surround-gl.ts`, `curve-gl.ts`) | Flat panels placed on a ring, each facing the middle; the seams show as straight edges, with perspective, not a bent page |
| Pixels | Offscreen frames copied to textures | The browser draws the real iframes; sharp, accelerated, no copy |
| Input | `sendInputEvent` mapped through `hitPanel` maths | Native hit-testing of the transformed iframe; wheel, IME, drag, text selection are the browser's |
| Background, sky, widgets, curved bend, photo sky | Yes | No (a flat dark backdrop) |
| Pages | Any page, framing irrelevant | Only pages that allow framing, or after a narrow per-site rule; Google mail/accounts as live mirror or window |
| Cross-pane effects (reflections, bend, blur, camera fly with depth of field) | Yes | No |

The curved look needs the page's pixels as a WebGL texture. An extension cannot read a cross-origin iframe's pixels (no capture API for a frame; `tabCapture` and `getDisplayMedia` only give whole tabs or windows, with a prompt), so the bend is not reachable here. CSS can bend nothing but its own rectangles. You can approximate curvature by slicing each pane into several narrow panels, but only for content that is not a cross-origin frame, so not for real sites. Expect: a convincing walk-in ring of live sites with real input, a smooth camera and a fly-in, and sign-in working where the frame is allowed. Do not expect the bent-page look, Google mail inside the ring as a live interactive page, or the Electron app's widgets and sky. Only stage 2 (a Chromium fork with compositor access) delivers a true bent page and live Gmail in the ring: the compositor can place and distort any surface, including those from other sites, with real input.

**By-hand test list for the Room** (load `dist` or `dist-room`, reload, allow the prompts; for the Room flavour also check a new tab):

- [ ] Alt+Shift+R opens the Room (and focuses it if already open). The three empty panes show suggestion buttons.
- [ ] Type `pinterest.com` in the Room's address box, then `github.com`, then `youtube.com`: each becomes a pane and the camera flies to it. For GitHub and YouTube, press **Allow framing for this site** if the bar appears.
- [ ] Press **Show all**: the ring is visible from inside its far side. Click a pane: you fly to it.
- [ ] Turn partway (arrow keys or drag the background) so a pane sits tilted ahead, within about 20° of centre: click a link in it and type into a search field. Both reach the page. Press **Direct: on** and do the same in a pane further to the side.
- [ ] In Pinterest or GitHub, open a link that opens a new tab (`target=_blank`, e.g. a GitHub external link, or Ctrl/Cmd-click): a new pane appears at the end of the ring and the tab closes.
- [ ] Add `mail.google.com`: the card appears (no frame). **Mirror here**, pick the window that opened in the sharing prompt: Gmail shows live on the ring; click it: the real window comes forward. Close the pane: the window closes.
- [ ] Type `ad github.com` in the address bar (omnibox): a pane opens in the Room.
- [ ] Open 8 panes: **+ Pane** greys out. With more than six, leave one out of sight for over 20 seconds: it shows "Asleep" and wakes when you turn to it. Watch the corner readout and Shift+Esc.
- [ ] Alt+Shift+Left/Right and Alt+Shift+O work while the cursor is inside a pane.
- [ ] `await chrome.declarativeNetRequest.getSessionRules()` in the Room's console: rules only for hosts you allowed, ids from 6000, none for Google. Close the Room tab: they are gone.
- [ ] Room flavour only: a new tab opens the Room. Record what did not work and the browser version.

## 7. What the server lets the extension do

Changes are in `server/extension.ts` (with tests in `tests/unit/extension.test.ts`) and one hook in `server/index.ts`. Nothing about the desktop app's own token, or web access, changed.

- A request is from an extension only if its `Origin` is `chrome-extension://<id>`; web pages cannot send that.
- Only listed ids may call (the Sidekick's own, plus `AETHERDECK_EXTENSION_ID`). Any other extension origin gets 403.
- The extension must send `X-AetherDeck-Token` matching `extension-token`. A program on your computer that only fakes the `Origin` header still gets 403.
- Only `/api/health`, `/api/assist` and `/api/explore` are open to it. Everything else answers 404 to an extension.
- CORS names that one origin (never `*`) and allows no cookies.

Limits you should know: the token sits in the extension's storage on your computer, unencrypted. And if you run the server for other computers (`npm run dev:lan` or a host), serve it over HTTPS, since the token travels in a header.

## Files

```
chromium/public/manifest.json    the extension (Manifest V3; permissions: sidePanel, activeTab, scripting, contextMenus,
                                 storage, declarativeNetRequestWithHostAccess for the cookie test; pages optional)
chromium/public/background.js    toolbar button opens the panel; the right-click commands
chromium/sidepanel.html + src/   the React side panel (Assistant from ../src/components)
chromium/public/options.*        server address and token
chromium/public/home.*           server status and search box
chromium/public/cookie-test.*    the framed-site cookie test
chromium/panes.html + src/panes.ts, panesLogic.ts   Panes: sites side by side, the narrow rule, window tiles
                                 (rules and refuse lists are in panesLogic.ts, tested in tests/unit/panes.test.ts)
chromium/room.html + src/room.ts, roomLogic.ts   the Room (tests/unit/room.test.ts)
chromium/vite.config.ts          builds the pages into chromium/dist (SIDEKICK_FLAVOUR=room: chromium/dist-room)
../src/lib/extensionBridge.ts    the extension backend behind `desktop` (src/lib/desktop.ts), and the /api rewrite
```
