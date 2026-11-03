# Warpnaut design guideline

*The search console as a place, not a page.* This document reads the twelve-panel concept render (01 Welcome → 12 Always With You) as a brief, states the principles behind it, fixes the visual system, and lists what the build does today and what is still concept.

## 1. Premise: search in the 2050s

By the 2050s the question "which page has this?" has disappeared. The web is read, cross-referenced and summarized by machines in the background, so what a person needs from a search console is no longer a list but a **place to stand**: somewhere to look around, notice what is near, step closer to what matters, and see where every claim comes from. Five assumptions follow from the render, and every screen in Warpnaut is held to them.

1. **The cursor is the search.** The ring of light at the center of every panel is the only persistent instrument. Where it rests, things come forward; where it moves, the space answers. There is no search box in the chrome; asking happens where you are.
2. **The environment is the result.** A question becomes a layout: evidence spokes for research, a horizon of reports for news, a distance map and comparison for places, stacked visual cards for learning. Nothing is "returned"; the space rearranges.
3. **Depth is detail.** Moving closer reveals more (panels 04 and 06). Detail is never hidden behind a click when a zoom will do, and nothing important lives only at one zoom level.
4. **The world stays visible.** The planet (01, 09, 12) is the ground you stand on: Earth at night, its upper face always rising from the bottom of the screen. It stays bright behind windows, dims while you explore, and brightens when you step back. Context is never lost to a modal.
5. **Calm, then honest.** A dark warm room, no competing colours, one warm light rising from the planet's horizon. Quiet is the default so that labels like *sample*, *unverified*, *not listed* and *AI summary* are the loudest things on screen. A 2050s console earns trust by showing its seams, not by hiding them.

## 2. The twelve moments

Each panel of the render is a moment in one session. The table maps each to what Warpnaut does and how honestly the build can do it with open data.

| # | Panel | Caption | In Warpnaut | Status |
|---|---|---|---|---|
| 01 | Welcome | The entire internet, reimagined as a space. | Home: Earth at night, real starting points standing on it as photo cards, one line of guidance, the top bar and the dock. | Built |
| 02 | Move | Your cursor is the search. | Proximity: nodes brighten as the ring passes; the ring's label names what a click will do. Click empty space to ask. | Built |
| 03 | Explore | Topics emerge as you move. | Starting points on the planet swell as the cursor approaches and name themselves on hover; source cards in an exploration carry photographs where a source has one. | Built |
| 04 | Zoom In | Drill into any topic naturally. | Semantic zoom: marks become excerpts become sourced findings as scale increases. Zoom is toward the cursor. | Built |
| 05 | See Everything | A complete view, not just links. | The lead card: photograph, title, one honest line on *why this* (how it matched), and a strip of related images, each attributed. | Built (photos only where sources have them) |
| 06 | Go Deeper | Explore visually, in layers. | The layer rail: Places · Reviews · Menus · Photos · Booking · Live availability. Each layer states whether open data has it; absent layers stay visible and dimmed, never faked. | Built (Reviews, Menus, Live availability are shown as unavailable) |
| 07 | Real World Actions | Not just information. Results. | Action card with "Book for today": prepare → review → confirm → hand-off to phone, mail or website. Warpnaut never sends. | Built |
| 08 | Personal Context | Understands you. | "Suggested for you": derived only from history kept in this browser, shown only when history is on, with the reason stated under each suggestion. | Built |
| 09 | Global Perspective | See what's happening, anywhere. | Threads of light across the sphere join the starting points; a news question becomes a timeline with dates on every item. | Built (threads); live world events need a news key |
| 10 | Learn Anything | Turn complex topics into visual journeys. | Evidence map with model-written sub-questions and verified quotes; source cards carry images. | Built |
| 11 | Travel Through Ideas | Follow connections across the web. | The trail keeps every step of an exploration; window groups link related pages with threads of light and move, minimize and restore together. | Built |
| 12 | Always With You | One cursor. The entire world. | The quiet state: planet, starting points, cursor, dock. Nothing else. | Built |

## 3. The spatial browser

Warpnaut is also a browser, in the way a headset is: the web arrives as glass panes floating in front of the planet, not as a tab strip. The look follows the reference render the build is held to (a dark warm room, Earth at night, panes tilted toward you, a dock of glass). At rest there are four things on screen: the planet, the starting points standing on it, the top bar and the dock.

**Home.** Earth at night fills the lower half of the screen and turns slowly (one turn every two minutes). Coastlines and borders are real (Natural Earth, through `world-atlas`); the lights are where large cities are. Starting points stand on the surface as small photo cards on stems of light: Zurich for quantum computing, Samarkand for the Silk Road, Mount Fuji, the Red Sea's reefs, and so on. Each photo is the lead image of the topic's Wikipedia article, credited on hover. A chain of light runs between them west to east, with a pulse travelling along each arc. Touching a card starts that exploration. Out-of-focus panes at the edges of the room (the same photographs, blurred) give the space depth; they are decoration and do nothing.

**The top bar.** The ring-and-wordmark (Warpnaut, *The internet, reimagined*) returns to the beginning. On the right: the date and time, an avatar that opens *Your data* (it shows your initial once you give a name for requests), and a voice button that opens the search field already listening. "Sample data" appears here whenever the data is not live.

**The dock** is the one fixed control, at the bottom:
- Home, the glowing globe: the first press minimizes every window, the second returns to the planet. It glows brighter while you are home.
- Search (or <kbd>/</kbd>): a question builds an environment; an address, "open …" or a video link floats a window; "play …" floats a video search.
- The most used places: YouTube (starts a video search, because YouTube's own pages refuse to be framed), Wikipedia, Images (Wikimedia Commons), Radio Garden.
- All places: a glass panel with all ten places (Search, Wikipedia, Surprise me, World map, Live winds, Radio Garden, YouTube, Archive, Images, Books). Only sites that allow being shown inside other apps are listed.
- See all windows (with two or more open), Devices and sharing, and one pill for each minimized window or group. A group comes back as one.

**A window** is one page in a frosted glass pane.
- **Opening:** it zooms out of the point that opened it (the dock icon, the search field, or the window beside it). With nothing to open from, the first window goes left of the planet, the next to the right, then the centre, then they cascade.
- **The bar** along the top of the pane carries the site's own icon, its address (with a lock) and the controls: reload, add a page beside, maximize, pop out to a browser tab, minimize and close. A page's title is shown only when it adds something to the address.
- **Moving and sizing:** drag the bar to move the pane, or focus its icon and use the arrow keys. Drag the corner to resize. Double-click the bar to maximize.
- **Depth:** windows off to the side turn toward you. Windows behind the one in use step back a little and dim. The one in use turns half as far and is outlined in warm light.

**Groups: connected pages that stay in sync.**
- **Forming one:** drop a window beside another (within about 56 px) and they link. While you drag, the pane you would join glows. "＋" on any window opens a page beside it in the same group. A topic typed there becomes a Wikipedia search, one of the few search pages that can be framed.
- **How it looks:** members are outlined in warm light, and a thread of light runs between neighbours.
- **The group ornament:** one ornament below the group names it ("earth.nullschool.net + wikipedia.org · 2"). Drag it to move the whole group. Its buttons arrange the group side by side (shrunk to fit), add a page, minimize the group, or ungroup it.
- **Moving together:** the group raises, minimizes, restores and moves as one. Escape minimizes the front window together with its group. Escape never closes a window; only × does.
- **Leaving:** drag a member well away from the others and it leaves. A group of one dissolves.
- **Saving:** with history turned on in Your data, windows and groups are kept in this browser and come back on the next visit. With history off (the default), they last for the visit only.

**Across devices and people.** The devices button in the dock opens *Devices and sharing*.
- **Your devices:** "Sync across devices" makes a personal space and shows its link as a QR code. Scanning it on a phone and choosing "Sync this device" brings every window and group there. From then on, opening, changing or closing a page on one device does the same on the others within a second. Where a window sits, its size, and whether it is minimized stay on each device, because a phone and a laptop lay the same pages out differently.
- **Sharing a group:** the share button on a group's ornament makes a separate space for that group alone and shows its link. The person who opens it sees the group, and anything either side adds, changes or closes in it reaches the other. Windows outside the group stay private.
- **How a shared group looks:** a dashed ring of light around each pane, and a "Shared · 2 here" chip on the ornament that reopens the link. A shared group never dissolves, never merges with another shared group, and dragging one of its windows never pulls private windows in. A window dropped beside it joins it, and is shared from then on.
- **Ending it:** the person who shared a group can stop sharing; everyone keeps a copy. Someone who joined can leave, which closes the group on all their devices. "Turn off everywhere" ends device sync; each device keeps what it has open.
- **The link is the key.** Each space is encrypted in the browser with AES-256-GCM, with a key that exists only in the link after the "#". Browsers never send that part to a server. The server stores scrambled data, a version number and a hash of a write token, and deletes spaces nobody has opened for 90 days. Opening a link always asks first, and the key is removed from the address bar at once.
- **How changes meet:** each window is one entry and the newest edit to it wins. A closed window leaves a dated marker so the close reaches devices that were offline. A device that comes back merges what it missed before writing.

**The desktop browser.** Warpnaut ships as a downloadable app for macOS, Windows and Linux (Electron, so Chromium renders every page). Each window holds a real page in its own process, so nothing is framed, proxied or refused. The window bar gains back, forward, reload or stop, an editable address (an address goes there; a question becomes a map) and a bookmark star. The app adds what people expect of a browser: downloads, permission prompts, find in page, zoom, print, full-screen video, private windows (purple badge, separate session, never in history or sync), a Library of history, bookmarks and downloads, Settings for keys and the default browser, and a menu with the usual shortcuts. Minimized windows stay alive, hidden, so a playing video or a sign-in survives. The YouTube refusal and the "asks not to be shown inside other apps" state belong to the website build only.

**Overview.** "See all windows" lays every lone window and every group out as tiles in a grid; a group keeps its arrangement inside its tile. Picking a tile brings it forward and returns everything to its place.

**Video.** YouTube links play in YouTube's own player (privacy-enhanced domain). Video search uses the YouTube Data API with a free key (`YOUTUBE_API_KEY`). Without it, the window says so and hands off to YouTube's own search page.

**Honest framing.** Before loading a site, the server reads its `X-Frame-Options` and `frame-ancestors` headers. A site that refuses gets a plain message with two ways out: open it in a browser tab, or read its leading paragraphs in the space. Warpnaut never proxies or rewrites a page to get around a site's choice.

**Why the chapter captions are gone.** The render's "01 Welcome … 12 Always With You" captions are storyboard labels, not interface. Shown live, they described the screen instead of helping use it, so the build no longer displays them. The twelve moments above remain the design brief.

## 4. Visual guideline

### 4.1 Light and material

One warm light, rising from the planet's horizon. The room is near black at the edges and warm brown where the atmosphere glows; the planet's lit limb is the brightest edge on screen. There are no hard edges in the environment; edges belong to type, to the cursor, and to glass.

Three materials, and only three:

- **Earth** (the planet): the night side, dark stone with darker land, faint coastlines, borders and a graticule, city lights stamped in additive gold, and an atmosphere band of warm light just outside the limb.
- **Glass** (windows, the dock, cards, sheets): warm-tinted, dark, frosted (`--glass`, 72% with a 30px backdrop blur), with a 1px highlight along the top edge.
- **Light** (the cursor, arcs, pins, active states): additive warm white with a soft halo. Light is the only thing that glows.

### 4.2 Colour

The interface is dark only: the render it follows is a night scene, and the planet's lights only read against it.

| Token | Value | Use |
|---|---|---|
| `--bg` / `--bg-deep` | `#12100d` / `#0a0908` | the room, its edges |
| `--horizon` | `#2a231c` | warm glow behind the planet's limb |
| `--glass` | `rgba(50,43,36,.72)` | windows, dock, pins, panels |
| `--surface` / `--surface-solid` | `rgba(44,38,32,.6)` / `#1d1915` | cards and sheets |
| `--ink` | `#f4ede3` | primary text |
| `--ink-2` / `--ink-3` | `#c9bdae` / `#8f8476` | secondary / tertiary |
| `--accent` | `#f2c88e` | "you can act here", citations |
| `--amber` | `#eab968` | caution: inference, cuisine-only match, sample |
| `--rose` | `#ee9c8e` | errors, recording |
| `--glow` | `rgba(255,238,210,.9)` | cursor and focus light |
| `--thread` | `#f7cf90` | arcs and threads of light; window groups |

Rule: colour means something or it is absent. Gold is for light and for actions. Amber is for caution. The only other colours on screen are photographs and the pages themselves.

### 4.3 Type

- **The system font** everywhere (San Francisco on macOS, Segoe UI on Windows): nothing is downloaded, and text looks native.
- Nothing is set in all caps larger than 11px.

### 4.4 Space and shape

- Base unit 4px. Card padding 12–14px; sheet padding 18–20px.
- Radii: image cards 18px, text cards 14px, pills 99px, photographs inside cards 12px.
- Cards are 250–300px wide at scale 1 and may grow to 1.3× on zoom-out (`--lc`) before they are replaced by marks. Labels hold 0.62–1.9× (`--ls`).
- The layout keeps a 165px vertical rhythm between findings and 440px between a sub-question and its column so nothing collides at any zoom.

### 4.5 The cursor

A 44px ring of light with a 6px inner dot and a soft 90px halo. Over an actionable node the ring grows to 56px and the halo brightens; a label beside it names the action (*Ask*, *Focus*, *Trace to source*, *Inspect listing*). It springs to the pointer with ω = 38 so it feels attached, not lagging. It disappears over chrome and on touch devices, where the native pointer and an *Ask* button take over.

### 4.6 Depth

Three planes, back to front:

1. **Planet and room**: Earth at night, its starting points, and the out-of-focus panes at the room's edges, fixed to the viewport. They never move with the camera.
2. **World**: threads, marks and cards, panned and zoomed by the camera.
3. **Windows**: floating glass panes for sites and video, above the world, with the deepest shadow in the system so they read as nearest.
4. **Chrome**: the top bar, the trail, the dock, the cursor.

Stacked cards (05, 06, 10) are drawn as a lead card with two ghosted cards behind it, offset 10/20px and faded to 55/30%. They imply a deck; moving closer brings the next card forward.

### 4.7 Motion

- Critically damped springs for the camera (ω 7.5) and the cursor (ω 38). Nothing overshoots.
- Arrivals: cards scale from 0.92 and fade in over 0.6s, staggered 45–60ms.
- Windows zoom out of their opening point (scale 0.06 → 1, with a brief blur) over 0.5s. Maximize, restore, arrange and overview glide over 0.32–0.55s; a window being dragged follows the pointer with no easing. Depth changes ease over 0.5s as focus moves.
- Performance: nothing that is hidden keeps painting. The planet is one canvas; behind windows it paints every other frame, and dimmed behind an exploration it paints once and holds still. Glass blur is used only where something actually sits behind it.
- Transitions between frames are cuts under `prefers-reduced-motion`.
- The planet turns once every two minutes and leans a few degrees toward the pointer; a pulse travels each arc in about eight seconds. Nothing on screen moves faster than a person could follow with their eye.

### 4.8 Honesty in the visual layer

- Every photograph is attributed and comes from a retrieved source: the pins' photos are Wikipedia lead images, credited on hover. No stock imagery, no generated imagery.
- A layer with no data is drawn, dimmed, and says so (*not in open data*). It is never removed, so the absence is visible.
- Sample data is dashed-bordered and labeled at every scale.
- AI-written text is labeled *AI summary*; a point whose quote could not be verified is amber and says *unverified*.
- "Book for today" prepares a request; the hand-off state always reads *Handed off — not sent.*

### 4.9 Accessibility

- Contrast ≥ 4.5:1 for all text on glass; verified against `--glass` and `--surface`.
- Every node is a button with a full label; Tab order follows reading order; Escape steps back one level.
- The cursor is decorative (`aria-hidden`); the field announces its controls.
- Reduced motion turns every spring and fade into a cut.

## 5. Component index

| Component | File | Notes |
|---|---|---|
| Planet | `src/components/Planet.tsx` | Earth at night on one canvas (d3-geo orthographic, world-atlas), city lights, arcs, photo pins on stems, depth panes; holds still while dimmed |
| Places | `src/components/Launcher.tsx` | the ten places, and the All places panel |
| Dock | `src/components/ControlBar.tsx` | Home globe, search, docked places, all places, all windows, devices, minimized windows and groups |
| Top bar | `src/App.tsx` (`Clock`) | wordmark, trail, date and time, Your data avatar, voice |
| Windows | `src/components/Windows.tsx`, `src/lib/windows.ts` | browser windows with tabs and their bar (address, controls), slots, depth, groups, overview, frame check, video search |
| Devices and sharing | `src/components/SyncSheet.tsx`, `JoinSheet.tsx`, `src/lib/sync.ts`, `useSync.ts`, `server/sync.ts` | QR and link per space, live status, share/stop/leave; encryption, merge, live connection, server store |
| Lens | `src/components/Field.tsx` | ring, dot, halo, label |
| Source card | `src/views/primitives.tsx` (`SourceChip`) | photo variant when the source has a thumbnail |
| Finding | `src/views/MindMapView.tsx` | glass, type label, citation |
| Lead card | `src/components/Inspector.tsx` | photo, title, why-this, image strip, layer rail |
| Layer rail | `src/components/LayerRail.tsx` | Places · Reviews · Menus · Photos · Booking · Live availability |
| Suggested for you | `src/components/Suggested.tsx` | from local history only |

## 6. What is concept, not yet real

- The render shows restaurant interiors, dishes and technicians at work. Warpnaut shows only images that sources publish (Wikipedia and news thumbnails today; OpenStreetMap has none). Place cards therefore carry a map mark, not a photo, until a photo provider with licensing is added.
- "Verified professionals", "Reviews", "Menus" and "Live availability" need partner data. They appear in the layer rail as unavailable.
- "Suggested for you" is local and explicit. There is no model of the person on the server.
- Many large sites (GitHub, Google, most banks and social networks) refuse to be framed. They open in a browser tab instead. A true spatial browser needs its own engine (a native shell such as Electron or a visionOS app), not a web page.
- Sync reaches only devices that can reach the Warpnaut server. On a laptop that means the same Wi-Fi (`npm run dev:lan` or `npm start`). Reaching a phone anywhere needs Warpnaut hosted online with `PUBLIC_URL` set. There are no accounts: whoever holds a link holds the space.
- Inside a window, a site runs with its own cookies only where the browser allows third-party storage, so some sign-ins work only after "Pop out".

## Pearl glass, the cursor and the dock (October 2026)

- **Pearl glass.** Windows, the dock and the ask field are frosted, light-catching panes (`--pearl*` tokens) over the warm room; page content sits inset on a dark sheet so sites read as they were made. A day theme (`:root[data-theme="day"]`) recolours the same room in champagne and white-gold, including the globe.
- **The globe** keeps real coastlines and city lights and adds a fibre network: hair-thin threads between nearby bright cities plus long-haul trunks, each carrying a slow point of light. Starting points are small luminous nodes that name themselves on hover, not photo cards.
- **No search bar.** The cursor is the instrument: a click on empty space opens a ring-and-pill field at that point (type or speak); "/" opens it from the keyboard.
- **The dock** is the person's own: the globe (home), their sites and tools (drag to reorder, right-click to move or remove, Add), minimized windows as small pictures, and a chevron for everything else.
- **Assistant windows** hold a file or a page and the questions asked about it. They are never saved or synced.

## Engine and performance (October 2026)

Warpnaut renders the web with Chromium (Blink and V8) through Electron. Its own code is small: the interface and
the server inside the app are under 4 MB; the rest of the download is Chromium itself, which cannot be trimmed
without removing browser features.

What keeps it smooth:
- The globe is projected with precomputed sines and cosines (`src/lib/globe.ts`, checked against d3 in
  `tests/unit/globe.test.ts`); land is clipped to the visible half the way d3 does it. About 2.5 ms a frame,
  down from 13. It draws at most 60 frames a second, 30 behind windows, and its canvas covers only the band
  the globe rises into.
- Dragging and resizing a window moves it on the GPU (`translate`) without rendering anything else; the app's
  state, its saved space and sync see one change, when the gesture ends.
- Window glass blurs only what shows: the bar, and the rim of the window in use. Blurring whole panes held
  the app near 52 fps with three windows open; this holds 60 at a third of the GPU work.
- The desktop window and its renderer start while the built-in server is still coming up.

## Search as a mind map, and the curved screen (October 2026)

- **Mind map** (`src/views/MindMapView.tsx`, `layoutMindMap` in `src/lib/layout.ts`). The question sits in the
  middle; branches go to both sides, balanced by height. With an AI evidence map the branches are its
  sub-questions, and each site hangs on the branch whose findings cite it most. Otherwise, and for sites
  nobody cited, branches are kinds of site: Websites, News, Discussions, Research, Video and Reference, at
  most six to a branch.
- **Cards** drag anywhere, and a branch drags with its cards. To connect sites, drop one card on another, pull
  the bead on a card's edge to another card, or press G on two cards. Connected sites form a group, drawn as a
  glowing thread. The group moves as one and **opens together** as a group of windows side by side. A click
  inspects a site; double-click or the corner button opens it.
- **Curved screen** (`shared/curve.ts`, `electron/curved.ts`, `electron/curve-gl.ts`, `CurvedPage.tsx`). In the
  desktop app a maximized window's page really bends. The page renders offscreen and each frame reaches the
  interface as a GPU texture (Electron's shared textures, so nothing is copied through the CPU). The preload
  then wraps it on a cylinder with WebGL: its sides come toward you and stand taller, and the bend is lit.
  Pointer, wheel and keys are mapped back through the same geometry to the exact point of the page and
  delivered as real input; ⌘C, ⌘V, ⌘X, ⌘A and ⌘Z go straight to the page. A still page sends no frames; an
  animating one runs at 60 fps. Entering or leaving the curve reloads the page, since the offscreen page is a
  separate one. Dropdown menus drawn by `<select>` and find-in-page work only in the flat window. In the
  web version, and for full-screen video, the frame curves and the page stays flat.
- **Your search engine, in view** (`shared/serp.ts`). In the desktop app, asking something opens the
  engine's own results page (Google by default; Bing, DuckDuckGo or Off in Settings) in a window you can
  see. Warpnaut reads the results off that page, as a reader view would, and they lead the map in the engine's
  order. The window then goes to the dock. If the engine asks you something first (privacy choices, "I'm not
  a robot"), its window stays in front and the map waits: Warpnaut never answers those for you.

## Liquid glass, accounts and agents (October 2026)

- **Liquid glass** (end of `src/styles.css`): clear tint, a light blur with saturation, a bright rim
  (`--lg-rim`) and a sheen across the top (`--lg-sheen`). Cards keep a little more body so their text reads.
- **Accounts** (`src/components/AccountMenu.tsx`): the avatar offers "Sign in with Google". Google's own page
  does the signing in, in the shared browsing session, so Gmail, YouTube and the rest know you, as in Chrome.
  Warpnaut only checks whether a sign-in cookie exists, and never sees passwords.
- **Agents** (`server/agent.ts`, `src/components/AgentConsole.tsx`). Press ⌘⇧Space from any app, or the
  sound-wave button, and say one thing. Speech becomes text through Whisper (OpenAI or Groq) or Gemini
  (`server/voice.ts`); a dictation app such as Wispr Flow types into the box too. Your model plans steps for
  four agents. Scout searches and maps; Navigator opens, groups, focuses and closes windows; Reader reads a
  page and answers; Scribe writes. Every step shows as it runs. The agents never sign in, buy, post, send or
  fill in forms.

## The curve engine, Shields and the Agent Station

**Pages are flat in windows, curved in the room** (November 2026). A browser window shows a real `<webview>` page: it is the fastest path, and every click lands where it looks. Only the 360° room draws pages offscreen on the cylinder (`CurvedPage`, `electron/curved.ts`, `electron/curve-gl.ts`), so going into or out of the room reloads each page at its current address. A repaint can arrive with an empty image beside the real frame; empty images are dropped, because drawn they blanked the page in the room.

Frames are numbered so that each is released only when its own drawing is done. Input is queued per page, because a press may pause to check for a `<select>`, whose list opens as a native menu (an offscreen popup can't be placed on the curve). Not supported on the curve: IME composition, and `<select>` inside cross-origin frames.

**Shields** (`electron/shields.ts`, `shared/shields.ts`) cover both web sessions: network blocking with Ghostery's open-source engine (MPL-2.0) and its ads and tracking lists plus URLhaus malware addresses, refreshed weekly and kept in `library/shields.bin`; https upgrades with a fallback for sites that lack it; tracking tags removed from page addresses; `Sec-GPC: 1`; and WebRTC limited to the public interface. Cosmetic filtering is off, so ads served inside a page's own content can remain. The shield on a window's bar shows the page's count and turns Shields off per site.

**The Agent Station** (`AgentStation.tsx`, `src/lib/agents.ts`, `server/claude.ts`) runs agents people define with a name, role, task and plan, on their own Claude API key. The server holds the key and makes one Messages API call per turn; the tools run in the interface, in view, and several agents can run together. Agents are kept in `library/agents.json` without keys. Page text reaches Claude inside `<page_content>` tags and is treated as data. Access is read only, ask first, or works on its own, where consequential words (buy, send, post, delete, sign in…) still ask. Password and payment fields are refused whatever the access, and private windows are out of reach.

## The agent engine and the command deck

**The engine** (`electron/engine.ts`) reads pages without opening a window: a pool of invisible pages in the person's browsing session, three at once, four on a computer with 16 GB or more, and one if the app passes half the computer's memory. Pool pages load no images, media or fonts, get four frames a second so pages that wait for a frame still build, never show dialogs, prompts or downloads, retire after 15 navigations, give their memory straight back if they come back over 220 MB, and close after 30 seconds idle. `fetch_page` and crawling read with scripts off first, and run them only when under 1,200 characters come back. Measured against a full curved window on three news and reference sites, in fresh app runs with Shields on, a pool page peaked 9 to 12% lower and read in about 3 seconds; most of the saving is the work it never does on the GPU.

**Tools by skill** (`server/claude.ts`, `src/lib/agentTools.ts`, `shared/harvest.ts`). Everyone reads pages and keeps notes. Harvest extracts lists and tables, crawls and saves files to Downloads/Agent Files. Mail reads Gmail through the signed-in session and opens drafts; no tool can send. Video reads YouTube's title, description and transcript when YouTube gives one: at the time of writing its caption files come back empty and its transcript endpoint refuses this browser when signed out, and that check isn't worked around, so agents say they have no transcript. Build writes one-page apps.

**Keeping runs small.** Models that preserve thinking reject edits to earlier turns, so nothing is trimmed afterwards. Instead a long page arrives in 12,000-character parts, and extracted rows stay on a workbench in the interface with only a preview in the conversation (`keepRows`). The request caches its tools and system prompt and follows the conversation with automatic caching. Reading tools asked for together run together; anything that acts runs in order.

**Manners.** Crawling obeys robots.txt (`robotsAllow`), takes one page at a time per site with at least a second between pages, and stops at any human check or request to slow down (`isHumanCheck`). Agents never solve or get around one.

**After email.** Mail can carry instructions from strangers. Once a run has read email, clicks, typing, memory, crawling and any address with a query need the person's yes (`leavesTrace`), whatever the agent's access.

**Built apps** (`electron/apps.ts`) live at `agent-app://<id>/`, each its own origin, under a policy with no network, forms or pop-ups (`APP_POLICY`). A page may still navigate itself under a sandbox policy, so `will-navigate` holds it to its own address. Tested against fetch, images, frames, forms, links, meta refresh, pop-ups and `location`.

**The deck** (`AgentStation.tsx`, `AgentStage.tsx`) is always dark. Agents are summoned in three steps: order, mission, powers. The stage is one 2D canvas, at most thirty frames a second, stopped when nobody is working and still under reduced motion. Each tool plays an effect (`FX`): radar for search, a sweep for reading, data spiralling in for harvesting, envelopes for mail, a waveform for video, blocks for building, a ripple for acting. Finished steps add up to a rank.

## Phones

The dock's Phone opens a window (`PhoneScreen.tsx`) kept out of sync, history and the agents' reach. Video is decoded with WebCodecs and drawn with the curve's own WebGL (`shared/curveSurface.ts`), so a phone sits on the same curved screen as a page.

**Android** (`electron/phone.ts`, `shared/phone.ts`) uses scrcpy 5.0.1 (Apache-2.0). On first use Warpnaut fetches its server, verified against the release's SHA-256, and adb from Google. The server is pushed to `/data/local/tmp`, runs through `app_process`, and removes itself when it stops, so nothing stays installed on the phone. Touch, keys, text, scrolling and paste go back over scrcpy's control socket. A dropped cable or Wi-Fi reconnects by itself, and the phone's own screen can be turned off while mirroring continues. Its sound stays on the phone.

**iPhone** is view only: iOS gives other apps no way to control it. UxPlay (GPL-3.0) receives AirPlay as a separate program, built from source on the person's computer and never shipped with Warpnaut. It forwards H.264 as RTP to a local port (`-vrtp`), which `RtpH264` rebuilds into pictures. It uses port 47000 because macOS's AirPlay Receiver holds 7000.

## The 360° browser

In the desktop app pages open as tabs of a flat browser window (`stack` in `lib/windows.ts`: windows sharing one are its tabs, shown one at a time, the one in front showing). A page opened from the dock, the bar or a link joins the browser window in front; with none showing, it gets a window of its own. The room is a place the person chooses: the top bar's 360° button or Cmd/Ctrl+Shift+U, where every tab of every window hangs side by side on the inside of a cylinder, inside the normal window or full screen. The bar's Floating windows button goes back. Home leaves the room with its tabs parked. Closing the last tab goes home.

The room's background is an environment: one of four 360° photos shipped in `public/rooms` (Seaside balcony, and Home Setup 1 to 3; Poly Haven, CC0, credited in `public/rooms/CREDITS.md`, resized to 6144 × 3072), one of three baked panoramas (night sky, studio, dusk), or the person's own 360° photo, kept in IndexedDB on this computer only (`lib/roomSky.ts`). Photos are dimmed slightly so pages stay legible. Each page is drawn with a margin around it that holds a rim of clear glass, lit along its top, and a soft shadow cast on the room, so it reads as a window floating in the space rather than a cut-out; the page in use is slightly brighter. Pages fill 0.72 radians of height, leaving the room visible around them. A full 360° photo (2:1) maps as a sphere; a wider panorama covers fewer degrees up and down and fades past its edges. Images narrower than 1.6:1 are refused. Clicks in the room send the pointer's position before each press, flush any move still waiting for its frame, count double and triple clicks themselves, and take the pointer shape from the page under it.

**Widgets** (`RoomWidgets.tsx`) hang on the room's wall beside the tabs: a clock, a note kept on this computer, the app's memory (Ram's line and a bar against the engine's limit), and the crew with what each agent is doing. They are DOM, not drawn in WebGL, so they take typing and clicks; on every `warpnaut-scene` event they are placed again with `onWall` (`shared/surround.ts`), the same geometry as the pages, scaled for the cylinder. Dragging one by its top moves it to the point of the wall under the pointer. Which are shown, and where, is saved in `warpnaut.roomWidgets`; the bar's Widgets button shows or hides each.

**Speed in the room** (measured with `top`, a YouTube video playing, three runs each). Tabs out of sight stop painting entirely (`curve:rate` 0 calls `stopPainting`; they keep running and playing) instead of painting four frames a second: with the video behind the person, the GPU process went from 15–23% to 9.5–10% and the page processes from 21–26% to 17–19%. With the video in front, it stayed within noise (GPU 24–29% against 26–34%). Other changes that remove work without a clear measured number: a press goes straight to the page when the pointer has rested on something known not to be a `<select>` (the check runs while the pointer moves, not on the press, which could wait up to 120 ms); a trackpad's many small scrolls go to the page as one per frame; frames of an unchanged size are copied into the texture they already have; nothing in the room blurs the moving scene behind it; and windows behind the one in use are darkened by a veil rather than a CSS filter, which made the compositor redraw their live page through an extra pass.

**Glass and the sidebar.** Browser windows, their tab strip and bars are clear glass (`--glass-tint`, `--glass-rim`), blurred only in the frost strips around the page. The Agent Station and the Research board are dark panes with a shared `Sidebar.tsx`: the window's three lights (close, collapse, fill the window), a title with a bell counting what waits on the person, a who row, a search, then sections of rows with the chosen one lit red (`--lit`) and red counts. It folds to a rail of icons.

**Browsing speed, November 2026** (one page open in a window, measured with `top`). Behind open pages the globe now holds still, and its seeds stop breathing: any animation behind a window made the window's frosted glass blur again on every frame. Idle went from 24% GPU and 22% for the page processes to 0% and 1%; scrolling from 14–18% GPU and 17% to 2.5% and 7%. In the room, pages render at 0.8 of the screen's pixel density (`ROOM_SHARPNESS` in `electron/curved.ts`), since a page hangs on the wall at about three quarters of its own size; with a video in front, GPU went from about 29% to 24.5–27.7% and the page processes from 26–29% to 19.5–22%.

**Never lost in the room.** A turn never leaves the person facing bare wall with every tab out of sight: beside the tabs (where the widgets hang) the room stays where it's left; otherwise it settles on the nearest tab. Tabs out of sight are counted at the left and right edges, and pressing a count turns that way.

**Extensions** (`electron/extensions.ts`, `shared/crx.ts`, `Extensions.tsx`). Chrome extensions load into the browsing session only, never private windows, and so also run in the 360° room's pages and the agents' engine. They come from the Chrome Web Store (Warpnaut downloads the CRX from Google's update service, skips its signed header and unzips it itself, refusing paths outside the folder and archives over 300 MB), from a folder, or from Chrome, Brave, Edge, Arc, Vivaldi or Chromium on the same computer. Each is staged and shown before it's added: what it can read and change, and which of its permissions Electron lacks (context menus, notifications, declarativeNetRequest and others), so it may only partly work. Added ones are copied into `extensions/` in the app's data folder and loaded at every start. A window's bar has a puzzle button for the shelf (a grid of extensions), whose tiles open an extension's popup in a floating glass card, and on a Chrome Web Store page, an Add to Warpnaut button. The manager is a deck with the shared sidebar. `<webview>`s may load `chrome-extension://` pages only for extensions that are on. Before an extension's background worker and its own pages (never a site), `electron/extension-shim.ts` fills the gaps that stopped real extensions: `storage.sync` (Electron's fails on every call) keeps its data in `storage.local`, alarms fire on timers, context menus, notifications and commands are accepted and shown nowhere, permissions are what the manifest asked for, `extension.isAllowedFileSchemeAccess` answers no, and `tabs.query({ active })` answers with the page whose bar opened the shelf (the worker asks on its own IPC channel). It is bundled unminified, because Electron copies its function into the extension by source text. With it, Dark Reader from the Chrome Web Store installs (about 3 seconds), darkens pages, and its popup works, including its On/Off for a site; without it, its popup never got past "Loading". A popup's card takes the size of the popup's own page, as Chrome sizes one.

The interface is served from one remembered local port (`interface-port` in the app's data folder), because everything it keeps in browser storage belongs to that address; a new port each launch had been starting the dock, agents and research board empty.

`shared/surround.ts` holds the geometry for both drawing and pointing, so what is seen is what is clicked. `electron/surround-gl.ts` draws one WebGL scene in the preload, where frames arrive; `Surround.tsx` describes it through the canvas's data attributes and a `warpnaut-scene` event, and maps input back to page coordinates. In the room every tab lays out at one page size (`curve:room`), so text reads at its normal size whatever size its window was.

The room sits at z-index 29: above the windows and below every sheet and prompt, so permission requests, settings and the Agent Station stay reachable. The bar holds the strip (all 360° in a line, dragged to turn), the page's address and controls, the tabs, and New tab, whose box also lists the dock. Vertical swipes scroll the page under the pointer; sideways swipes, Shift+wheel, dragging the empty wall, Alt+arrows and Ctrl+Tab turn the room, settling on the nearest tab; a pinch zooms. Sideways swipes therefore don't reach pages. A page's own full-screen button fills its panel. Find-in-page, Phone and AI windows are outside the room; tools from the new-tab box go back home to open.

Frames use shared textures on macOS and Windows. Linux, and anything with `WARPNAUT_CURVE_COPY` set, copies BGRA frames through the CPU at 1x and 30 fps, because Linux's shared textures depend on the graphics driver. Only macOS has been run.

## The name, and how the interface behaves

Warpnaut is a crew traveling the web at warp speed; its mark is an astronaut's helmet with speed lines, platinum on deep space (`build/icon.svg`, every format made by `npm run icons`). The browser was called Horus until November 2026.

Menus, sheets and bars follow Apple's conventions: system type, one tint (gold), materials rather than opaque panels, Settings as a sidebar with grouped lists, switches and segmented controls, and short motion on the iOS sheet curve. The tokens are at the top and bottom of `src/styles.css`.

Smoothness rules, each from a measurement:

- A static blur over something that repaints is the dearest thing on screen: no `filter` sits over the globe or a page.
- The globe draws at 30 frames a second at 1.5x and stops behind the room.
- The room's backdrop is baked once into a panorama, so turning costs a texture lookup per pixel.
- In the room, frames go up once per drawing, newest only. Panels out of view aren't drawn. The tab in use paints at 60, others in sight at 20, tabs behind you at 4.
- Motion runs on the clock, not the frame count, so it glides the same at any refresh rate and through a dropped frame.

## One room, the bridge and the board (November 2026)

**One mode.** The day room is gone. The interface has one dark room, and the accent, the globe and its city lights are platinum.

**The bridge** (`AgentStage.tsx`, `AgentAvatar.tsx`). The eye gave way to a crew on a deck under a viewport. An avatar is SVG moved by CSS; `moodOf` turns a run into one of fifteen moods, and each order wears its own kit. Effects still play on one canvas behind them, only while someone works. Ids of the old orders stay, so saved agents keep their kit.

**The research board** (`ResearchBoard.tsx`, `lib/research.ts`). Each finished map becomes a card in `library/research.json`, unless "Keep new searches" is off. Cards connect and group. A summary numbers each source once across the group, reads up to eight pages in the agent pool, and sends them to the person's model through the same `/api/assist` route as everything else, marked as material. `checkCitations` removes any number that isn't a source.

**Search stays visible.** Google's Custom Search API is closed to new customers and ends on January 1, 2027, and Google's terms don't allow automated queries. So Warpnaut doesn't query Google in the background: the engine's results are read from a window the person opened by asking, and any check is theirs to answer. SearXNG, Brave and Tavily remain the options for background search.

**Ram** (`RamBuddy.tsx`, `lib/ram.ts`) shows the app's memory as a sheep whose wool grows toward the engine's limit of half the computer's memory.

## Agents on any model

An agent has a `provider` and a `model`. The loop in `lib/agents.ts` still speaks Claude's blocks everywhere; `server/brains.ts` translates each turn for anything else. Ollama, local or cloud, uses its own `/api/chat`, because its OpenAI route can't set the context size and its default is only 4k on most computers. Replies stream, so only silence times out, never slowness; `think` is on where a model supports it, which keeps reasoning out of answers. Other providers use the OpenAI chat format. Older tool results shrink, since these models have no prompt cache to protect and a small context to fit. A tool call written as text is rescued only if it names a real tool. Approvals, field refusals and the rules after reading email all run in the interface, so they apply on every model.
