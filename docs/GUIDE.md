# AetherDeck guide

Everything that isn't on the front page: how AetherDeck works, how to build and run it, its architecture, data sources,
privacy model, tests and known limits. The design system and its history are in [DESIGN.md](DESIGN.md).

## How it works

- **The cursor is the search box.** Click empty space (or press /) and a small field opens where you clicked; type, or press the microphone and speak. An address opens a window; anything else becomes a map. A window's address bar works too, or right-click selected text → *Explore in AetherDeck*. AetherDeck queries its sources and draws the question at the centre with the websites, papers and findings around it. Click any site to open it in a window; everything you open stays connected.
- **Windows, not tabs.** Each page is a glass pane with its own bar: back, forward, reload, address, bookmark, add a page beside, maximize, minimize, close. Drop one beside another to group them; groups move, minimize and restore together. A link a page opens in a new window appears beside it, in its group.
- **Resize from any edge or corner**; double-click a window's bar to maximize.
- **Your dock.** The bottom dock holds your own sites and tools. Drag to reorder, right-click to move or remove, **Add** to pin an address (or the pin button on any window's bar). Clicking a site that is already open brings its window forward. Minimized windows wait at the right of the dock as small pictures of themselves. The chevron holds all places, all windows, history, devices and Settings. Your dock is kept in this browser.
- **Files and Cosmonaut.** Drop a PDF, Word document, spreadsheet, text file or image anywhere (or press **Files** in the dock, Cmd/Ctrl + O) and it opens in its own window: read on your computer, with page count, a picture of the first page and the text AetherDeck read. With an AI model connected, ask Cosmonaut for a summary, key numbers or next steps, or ask your own questions. **AI** in the dock (Cmd/Ctrl + Shift + A) does the same for the page in front of you. The file's text is sent to your model only with a question you ask, and the window says which model. Nothing is kept or synced.
- **Private windows** (Cmd/Ctrl + Shift + N) use a separate session that disappears when you quit; they're never kept in history or synced.
- **Shortcuts:** Cmd/Ctrl + O open a file, Shift + A ask AI about this page, T new, W close, Shift + T reopen closed, L address, F find, R reload, [ and ] back/forward, + / − / 0 zoom, D bookmark, Y history, Shift + J downloads, P print.

## Build it yourself

```bash
git clone https://github.com/tajwarah/aetherdeck.git && cd aetherdeck
npm install
npm run desktop:dev   # the desktop app with live reload
npm run dist:mac      # or dist:win / dist:linux: installers in release/
```

To publish a release: push a tag (`git tag v0.2.0 && git push --tags`). The **Release** workflow builds macOS, Windows and Linux installers on GitHub's machines and attaches them to a draft release; read it over and press **Publish**.

AetherDeck also still runs as a website (below), where pages that refuse to be framed open in a normal tab instead.

## Run as a website (development)

```bash
npm install
npm run dev          # API on :8787, app on http://localhost:5173
```

Optional, in `aetherdeck/.env` (copy `.env.example`):

| Variable | What it turns on |
|---|---|
| `AETHERDECK_CONTACT` | **Recommended.** An email or URL added to the User-Agent. Wikimedia and OpenStreetMap ask API clients to identify themselves and throttle anonymous ones (you will see `rate_limited` notices without it). |
| `BRAVE_API_KEY` | General web, news, images and video via Brave Search. Without it, news and media coverage is limited to open sources. |
| **One** model key: `OPENROUTER_API_KEY`, `GROQ_API_KEY`, `GEMINI_API_KEY`, `MOONSHOT_API_KEY` or `ANTHROPIC_API_KEY` | AI intent planning, AI-organized evidence maps with verified citations, and AI-drafted requests. Free tiers work; see below. Without a key, a deterministic planner runs and findings are verbatim excerpts. |
| `YOUTUBE_API_KEY` | Video search for "play …" in floating windows (YouTube Data API v3, free quota ≈ 100 searches a day). Pasted video links play without it. |
| `PUBLIC_URL` | The address other devices use for sync and share links, once AetherDeck is hosted (e.g. `https://aetherdeck.example.com`). Without it, links use this computer's Wi-Fi address. |
| `AETHERDECK_DATA_DIR` | Where encrypted sync spaces are stored (default `aetherdeck/data/sync`). |
| `AETHERDECK_DEMO=1` | Sample data only, for offline demos and tests. Shown as "Sample data" in the UI. |

### Running the AI layer for free

Any OpenAI-compatible endpoint works, so free tiers are enough. Get a key yourself and put it in `aetherdeck/.env`:

- **OpenRouter** (simplest): create a key at openrouter.ai/keys and set `OPENROUTER_API_KEY`. With `LLM_MODEL` empty, AetherDeck reads OpenRouter's live model list at startup and picks a `:free` model. It prefers Kimi when one is offered, then DeepSeek, Qwen, gpt-oss, Nemotron and Gemma. The free roster changes often; in late October 2026 no Kimi model was free, so it picks the next best. Free use is capped per day.
- **Groq**: `GROQ_API_KEY`, default model `openai/gpt-oss-120b`.
- **Google Gemini**: `GEMINI_API_KEY`, default `gemini-3-flash-preview`, falling back to Flash-Lite when overloaded. Free-tier content may be used to improve Google products.
- **Kimi direct** (Moonshot): `MOONSHOT_API_KEY`. The newest Kimi K2 is auto-picked; a small top-up may be required.
- **Anything else** OpenAI-compatible (a local Ollama or LM Studio server, Together, etc.): `LLM_PROVIDER=custom`, `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`.

The backend asks for JSON-schema output. If an endpoint rejects that, it falls back to plain JSON mode, then to prompt-only. Every reply is validated against the schema, with one repair attempt; otherwise AetherDeck falls back to verbatim excerpts. Every citation the model writes is checked against the retrieved text. "Your data" shows which model receives your questions. Your name is never sent to the model when drafting requests.

Production: `npm run build && npm start` serves the built app and API from one Node process on `AETHERDECK_API_PORT` (default 8787).

## Try the three scenarios

- **Research:** "Explain quantum computing and show me the original sources." This gives an evidence map: the question at the center, four sub-questions around it, findings along each spoke, and sources on the outer ring. Sources come from Wikipedia, OpenAlex (most-cited peer-reviewed work) and arXiv. Click a sub-question to zoom in, and click a finding to open its source with full provenance.
- **Local action:** "Find an AC repair technician near me today." AetherDeck first asks where to look (your device location, or a typed neighbourhood). It then compares real OpenStreetMap listings. **Prepare a request** drafts a message. You review it, confirm, and it opens on your own phone, mail app or browser. AetherDeck never sends anything itself and never claims a booking was made.
- **Discovery:** "Find restaurants near me that serve kacchi biryani and compare them." This gives a distance map plus a comparison table. A place matched only by cuisine tag (not by name) says that serving kacchi is unverified.

Also try: "What's happening in Bangladesh today?" (timeline), or "photos of the aurora" (media view, needs Brave).

**Browse:**
- **Open a page.** Pick a place in the dock, or press the grid for all of them (Wikipedia, World map, Live winds, Radio Garden, Archive…), or type an address into search. It floats in a glass pane.
- **Video.** "play lofi hip hop" opens video search (needs a free `YOUTUBE_API_KEY`); pasted YouTube links play without it.
- **Group pages.** "＋" on a window opens a page beside it in the same group. Dropping one window next to another also links them. A group moves, arranges, minimizes and restores as one.
- **Your phone.** Open *Devices and sharing* (the devices button in the dock), choose "Sync across devices", and scan the QR code. Groups you open on one device appear on the other, and closes travel too. Start AetherDeck with `npm run dev:lan` so the phone can reach it on the same Wi-Fi.
- **Share a group.** The share button on a group's ornament gives a link for that group only. Whatever either person adds, changes or closes in it reaches the other.
- **See everything.** "See all windows" in the dock shows every window and group as a tile.
- **Sites that refuse to be framed** (GitHub, Google…) say so and offer a browser tab, or a reading view in the space.

**Controls:** click empty space or press <kbd>/</kbd> to ask, use the 🎤 for voice where the browser supports it, scroll to zoom toward the cursor, drag to pan, arrow keys and <kbd>+</kbd>/<kbd>−</kbd>, <kbd>Tab</kbd> through items, <kbd>Esc</kbd> to step back. On touch, pinch to zoom and use the Ask button.

## Design

The interface follows the twelve-moment concept (01 Welcome → 12 Always With You), read as a headset-style spatial browser:
- the AetherDeck home: the mark alone, which dissolves into light under the pointer, above Earth at night (NASA Black Marble) turning slowly under a peach-to-lavender horizon;
- a top bar (wordmark, date and time, your data, voice) and one glass dock (your sites and tools, windows, devices);
- dark frosted glass windows, each with its own bar (site icon, address, controls), that turn toward you and link into groups;
- a cursor that is a ring of light;
- glass cards that carry a source's own photograph;
- a layer rail that shows what open data can and cannot provide;
- suggestions that come only from this browser. The principles, tokens, materials, motion and honesty rules are in [docs/DESIGN.md](DESIGN.md), along with a table of what is built and what is still concept.

## Architecture

```
electron/main.ts         the desktop browser: runs the server inside the app (127.0.0.1, locked with a per-launch token),
                         page sessions, downloads, permission prompts, popups → new panes, context menu, app menu and
                         shortcuts, default-browser links, auto-update; store.ts keeps history, bookmarks and encrypted keys
electron/preload.ts      the one bridge to the interface: a fixed list of requests and events. Pages get no preload at all.
src/components/LivePage.tsx  a real page: an Electron <webview> in a pane, its bar controls, find in page
src/components/DesktopSheets.tsx  Library (history, bookmarks, downloads), Settings (keys, default browser), permission prompt
src/                     React + TypeScript (Vite). No UI framework; CSS, SVG, DOM.
  components/Field.tsx   camera (spring pan/zoom toward pointer), cursor instrument, proximity, keyboard, pinch
  components/Hero.tsx    the home: the mark; Earth.tsx the turning night Earth (WebGL 2); Logo.tsx the mark and its dissolve
  components/Launcher.tsx the ten places and the All places panel; ControlBar.tsx the dock
  components/Windows.tsx glass browser windows with tabs and a bar (address, controls), depth, groups, overview; lib/windows.ts is the pure model
  lib/sync.ts            sync spaces: AES-256-GCM in the browser (key only in the link's #), per-window merge, live client
  lib/useSync.ts         runs the personal space and shared groups, reconciles them with the windows on screen
  components/SyncSheet.tsx  Devices and sharing: QR codes, links, status, share/stop/leave; JoinSheet.tsx asks before joining
  components/LayerRail.tsx  Place · Reviews · Menus · Photos · Booking · Live availability, each marked available or not
  components/Suggested.tsx  "Suggested for you", from history kept in this browser only
  lib/layout.ts          pure layouts per visualization: evidence · timeline · map/comparison · clusters · media · reading
  views/                 one renderer per visualization, sharing one design language (photo cards when a source has an image)
  components/            composer (type/voice), inspector (lead card: photo, why-this, image strip, layers, provenance), action sheet, privacy, progress
server/                  Node 22+ running TypeScript directly (type stripping); node:http, no framework
  intent.ts              deterministic intent planner (always runs; free, testable)
  llm.ts                 intent refinement, evidence synthesis, drafting; citations verified
  models.ts              model backends: Anthropic, or any OpenAI-compatible API (OpenRouter, Groq, Gemini, Moonshot/Kimi, custom)
  orchestrator.ts        agent workflow: interpret → locate → retrieve (parallel) → read → compare → compose
  providers/             provider abstraction, one file each; all results normalized to SearchResult
  evidence.ts            verbatim-sentence extraction, sub-questions, dedupe
  environment.ts         InformationNodes + visualization choice + offered actions
  actions.ts             prepare → confirm → hand-off (no sending)
  sync.ts                encrypted sync spaces: versioned compare-and-swap writes, live events, 90-day expiry; cannot read them
  preview.ts             direct URL reading view (SSRF guard, robots.txt, size/time limits)
  cache.ts / budget.ts   TTL cache by freshness class; per-request limits on calls, opens, LLM, time
shared/types.ts          Zod schemas = the data contracts (SearchIntent, SearchResult, Evidence, InformationNode, AgentTask…)
```

**Progressive rendering.** `/api/explore` streams NDJSON snapshots of the whole environment model. The first view appears before any provider answers, and each provider adds to it as it lands. For example, Photon's local results come back in about a second, and the slower Overpass listings merge in afterwards.

**Interaction is local.** Moving, zooming and focusing never touch the network. Search starts only when you ask or pick a target. Springs run on `requestAnimationFrame` outside React, and `prefers-reduced-motion` turns every transition into a cut.

**Semantic zoom.** Headings keep a readable on-screen size as you zoom (`--ls`). Cards shrink later (`--lc`). Detail is revealed by zoom level: at overview, findings are marks; closer in, they become excerpts; closer still, you get snippets and limitations.

### Sources

| Provider | Key | Used for | Notes |
|---|---|---|---|
| Wikipedia (MediaWiki API) | none | reference, background, images | intro extracts |
| OpenAlex | none | original research, most-cited first | DOIs, venues, authors, abstracts |
| arXiv | none | recent preprints | title-phrase match; labeled "may not be peer reviewed" |
| Wikipedia Current events + "Year in X" chronologies | none | news | every item must cite an external original report, or it is dropped |
| GDELT DOC 2.0 | none | news headlines | 1 request / 5 s; often rate-limited on shared IPs |
| Photon (komoot) | none | fast local search over OSM | bounded box around the chosen location |
| OpenStreetMap Overpass | none | local listings with tags (hours, phone, website) | public mirrors raced; often slow |
| Nominatim | none | place-name geocoding | 1 request / s, cached |
| Brave Search | `BRAVE_API_KEY` | the whole web, forum threads, news, images, video | snippets only |
| Tavily | `TAVILY_API_KEY` | the whole web, news | readable extracts |
| SearXNG (self-hosted) | `SEARXNG_URL` | the whole web, through many engines | your own instance, JSON format on |
| Hacker News (Algolia) | none | original writing, independent sites, discussion | stories with some engagement only |
| Stack Overflow | none | answered programming questions | technical requests only |
| Sample data | none | offline demo / fallback | always labeled; local placeholders are explicitly "not a real business" |

Results are ranked for the open web (`server/rank.ts`): relevance to the request first, a little credit for being recent, then a diversity pass that penalizes every further result from the same site or the same source, so no single site (Wikipedia included) fills the top. Duplicates are merged by address and title. Keyword-only sources whose result shares no word with the request are dropped. Without a whole-web engine configured, the map says so instead of passing the open sources off as the web.

## Connecting an AI model

In the desktop app: **Settings** (the gear in the top bar, or Cmd/Ctrl + ,) → **AI and Claude**. The quickest way is **Sign in with ChatGPT**, which uses your Plus or Pro plan. Or choose Anthropic, OpenAI, OpenRouter, Groq or Gemini, paste an API key, press **Check key and list models** (this proves the key works and lists what it can use), pick a default model and **Connect**. It takes effect at once, no restart. The same model plans research maps, writes cited summaries, and answers questions about files and pages.

An API key is not the same as a ChatGPT Plus or Claude subscription. Create it in the provider's console (links are in Settings); usage is billed there per request. OpenRouter, Groq and Gemini have free tiers. Keys are encrypted with the operating system's keychain and sent only to that provider. **Disconnect** removes the key; AetherDeck keeps working without AI (verbatim excerpts instead of summaries, and files can still be opened and read).

## Trust and privacy

- Every finding is either a **verbatim excerpt** or (with the AI layer) an **AI summary**, **inference**, **disagreement** or **gap**, and it is labeled as such. AI points must cite retrieved source ids and quote them. Quotes are checked against the retrieved text. Unverifiable citations are downgraded to "inference — unverified" (`verifyPoints` in `server/llm.ts`).
- The inspector shows the publisher, canonical URL, publication date (or "no date given"), retrieval time, live/cached/sample status, the provider, every point the source supports, and its known limitations.
- Location is asked for only when a local request needs it. It is never sent with other queries, and device coordinates are rounded to about 100 m. It is kept for the session only, unless you choose to remember it.
- History is **off by default**. History, kept items and preferences live only in this browser, under **Your data**, with per-item delete and "Erase everything". The server stores no history. Its caches are in-memory: news for 3 minutes, places for 30 minutes, reference for 6 hours. Logs omit query text unless `AETHERDECK_LOG_QUERIES=1`.
- Device sync and shared groups are **end-to-end encrypted**. Pages, titles and addresses are encrypted in the browser with a key that exists only after the "#" of the link, which browsers never send. The server stores ciphertext, a version and a hash of a write token derived from the key. Anyone with a link can read and change that space, so the sheet says to keep device links private. Nothing joins until you confirm.
- Credentials stay on the server. The API validates every input with Zod, rate-limits per IP, caps body size, and requires an explicit `confirmed: true` before any hand-off.

## Tests

```bash
npm test             # 196 unit tests: the research answer, agent powers and schedules, ChatGPT plan requests, the curved screen, tabs, agents and voice, mind map layout and grouping, open-web ranking and diversity, dock order, model adapter, intent routing, evidence, citation verification, dedupe, parsers, SSRF/robots, cache, budget, layouts,
                     # windows and groups, sync merge/encryption/links, the sync store
npm run test:e2e     # 26 Playwright tests (desktop + mobile; 6 desktop-only) against sample data: orientation, research + provenance,
                     # location gate, action prepare/confirm/hand-off, privacy erase, keyboard + reduced motion, floating windows, groups, overview,
                     # laptop-to-phone sync, sharing a group with another person
npm run typecheck
```

E2E needs Playwright's browser once: `npx playwright install --only-shell chromium`.

## Known limitations

- **Protected video and music (Netflix, Spotify, Disney+, some of YouTube Music).** These need Widevine DRM, which stock Electron does not include, so Spotify's web player browses but won't play. Fixing it means building on Castlabs' Electron fork with Widevine and getting the app signed by them (VMP).
- **Open-web search needs a key.** Without Brave, Tavily or SearXNG, results come from open sources only (forums, research, news, the encyclopedia), and the map says so.
- **Not yet in the desktop browser:** a password manager (use your system's, or a password manager app), tab sync of open windows to other browsers, and reading-list/PDF annotation. Chrome extensions work, with a few Chrome APIs stubbed. Chromium's own PDF viewer, spellcheck and video playback work.
- **Some sign-ins refuse embedded browsers.** Google may block sign-in inside apps built on Electron. "Open in your other browser" on the window bar is the way out.
- **Unsigned builds.** The first release isn't code-signed, so macOS and Windows warn on first launch (see Download), and macOS can't update itself.
- **Device sync in the desktop app** works between devices that can reach the same AetherDeck server; the desktop app's built-in server is private to the computer. A hosted sync server is the next step for phone ↔ laptop sync of the downloadable app.

- **No proprietary index.** AetherDeck searches what its providers expose. It does not crawl or index the web.
- **News without Brave is thin.** GDELT rate-limits shared IPs, and the Wikipedia-curated sources lag real time. A "today" question says when nothing from today was found, and dates are shown on every item.
- **Local data is OpenStreetMap.** Coverage of small businesses varies by city. There are no ratings, menus, prices or live availability, so none are shown. Distances are straight-line, not travel time.
- **No booking integration.** The action workflow drafts and hands off to phone, email, the website or the OSM listing. Real booking needs a partner API, such as a reservation platform. The `prepareAction` / `confirmAction` boundary is where it would plug in.
- **Without a model key,** sub-questions are fixed templates and findings are verbatim sentences picked by keyword cues. Disagreements are not detected. With the key, both are AI-organized and checked.
- **Voice** uses the browser's Web Speech API (Chrome and Safari), which may send audio to the browser vendor's speech service.
- **Sync needs a reachable server.** On your own computer, links work for devices on the same Wi-Fi (`npm run dev:lan` or `npm start`). To reach your phone anywhere, host AetherDeck online and set `PUBLIC_URL`. There are no accounts: a link is the only key, and a lost link cannot be recovered.
- **Not built yet:** user accounts and server-side preferences (PostgreSQL), Redis, a background job queue, monitoring, or deployment config. None were needed for this milestone. Add them when traffic or features require it.
- The AI paths have unit tests (model choice, JSON-mode fallback, repair, rate limits) and file analysis was run against Gemini's free tier. Anthropic and OpenAI were checked for key validation only (no paid calls were made in testing). Free models vary in JSON reliability; if one struggles, choose a stronger one in Settings.
