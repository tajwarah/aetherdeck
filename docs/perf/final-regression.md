# Final regression pass: steps 2–5 together

Tested 2026-11-11, one throwaway profile, on an unmodified copy of the 0.2.2 app with the repo's working-tree Pod files loaded into its window. That's everything in `final.patch`: `room.js`, both input actors, and `src/App.tsx` + `src/lib/desktop.ts`, rebuilt into `dist/` and served on 8787. Apple M3, 16 GB, window 1280×911. Nothing committed or pushed.

Checks ran through automation: Firefox's own event and actor APIs, window-level mouse events, Marionette key actions, and screenshots. No real mouse, trackpad or microphone was used.

`npx tsc --noEmit` passes; `npm test`: 30 files, **252/252 pass**.

| Item | Result | Numbers / how |
|---|---|---|
| Home pane loads | **PASS** | title "AetherDeck", Earth present, dock shows YouTube / AI / Agents / Research, search bar present |
| Search / research | **NOT RUN** | the UI is there; running a search or research would use the owner's AI keys on this Mac's server, so I didn't |
| Cosmonaut | **NOT RUN** (UI present: "AI" in the dock) | needs an AI key |
| Agents deploy | **NOT RUN** (UI present: "Agents") | needs an AI key |
| Voice | **NOT RUN** | needs the microphone and the owner's voice |
| Settings: a click in a *bent* Settings pane | **PASS** | click on "Privacy & Security" → Settings went from `#sync`/`` to `#privacy` |
| Import dialog | **PASS after a fix** | `import:open` → the wizard opens in the Settings pane. **Found and fixed:** Firefox selects the Settings tab for Import, but the Pod stayed facing the home pane, which then went cold and blank (the front pane was not the selected tab, so Firefox deactivated it). The Pod now turns to whichever pane Firefox selects: the Import dialog comes to the front, live, and a real click on its **Cancel** closed it (no dialog overlay left). |
| Profile card | **PASS** | avatar ("Accounts") → card with 🧑‍🚀, "Your profile", "Kept on this computer only", **Edit** |
| More tabs swap | **PASS** | 9th tab → More tabs (count 4 → 5); **Swap in** on "Sign in – Google Accounts" → it became a pane, the faced pane went into the box, count stayed 5 |
| "More tabs (n)" counter bug | **FIXED** | it used to stay "More tabs" for tabs opened in the background until the box was opened. Now the count updates on tab changes, and a tab's address is taken from the page actually showing (session data lagged by 10 s or more for background tabs). 3 background tabs → **"More tabs (3)" after 0.5 s** |
| uBlock Origin on | **PASS** | uBlock0@raymondhill.net 1.76.0, active |
| Google sign-in page loads (no sign-in) | **PASS** | accounts.google.com → "Sign in – Google Accounts"; nothing entered |
| Cursor shapes | **PASS** | over a link: `pointer`; over paragraph text: `text`; over blank space: `default` (Wikipedia pane, through the input actor) |
| Scroll in a pane | **PASS** | wheel 600 px → page scrollY 0 → 600 |
| Typing in a pane | **PASS** | front pane DuckDuckGo (search box focused by the page): typed m-o-o-n → value "moon". The earlier Wikipedia attempt was inconclusive: at this width Wikipedia collapses its search box into a menu. |
| Widgets drag / resize / reset / Theater | **PASS** (step 5) | drag to middle → out of the safe zone; resize → no overlap, capped width; Reset; hidden in Theater, sizes kept |
| 8-pane cap | **PASS** | 13 tabs → 8 panes, the rest in More tabs |
| Sleep / wake of panes | **PASS** | `sleep()` → asleep and discarded; `wake()` → reloaded Hacker News, live |
| Entering / leaving the Pod | **PASS** | leave → toolbar back, Pod button present, `full-screen-api.ignore-widgets` false; enter → 8 panes, pref true |
| Theater + Esc | **PASS** | Theater: 1 of 8 panes active; Esc → back to the ring (step 2 has the YouTube full-screen cases) |
| Quit and relaunch, session restore | **PASS with a note** | **With "restore previous session" on** (`browser.startup.page = 3`): quit through Firefox → relaunch → in the Pod again, 9 tabs, 8 panes in the same order, Earth and YouTube included. **Note 1:** a More-tabs swap isn't remembered: on relaunch the Pod takes the first 8 tabs in tab order (Settings, swapped in, was back in More tabs and Hacker News back in the Pod). **Note 2 (for the owner):** AetherDeck's default is `browser.startup.page = 1`, so **by default nothing is restored**. A relaunch shows the Pod's three default panes, including a Gmail sign-in page. Earlier in this session that was home, GitHub and Gmail on every fresh start. |

## Bugs found and fixed in this pass

1. **Front pane cold and blank after Firefox selects another pane's tab** (Import, and anything else that selects a tab): the Pod now turns to the selected pane (`TabSelect` → `lookAt`), and its own selections don't loop back (`selecting` flag).
2. **"More tabs (n)" count stale for background tabs:** fixed as above.

## Open items for the owner

- Turn on session restore by default? (`browser.startup.page = 3` in the branding prefs.) And should the default first-run panes include a Gmail sign-in page?
- Remember More-tabs swaps across restarts (store which tabs are panes in session data, or reorder the tabs on swap).
- Run the four NOT RUN items by hand (search/research, Cosmonaut, agents deploy, voice) and do a real-mouse pass: widget dragging, YouTube's ⛶ button, trackpad turning.
- Rebuild the app (`prepare.sh` + `mach build faster` + `package-mac.sh`) to test these changes as a real build. The build drive (`/Volumes/ChromiumBuild`) wasn't mounted during this work, so nothing was built.

## Test tool note

Marionette (the test driver) kept wedging once the Pod began selecting the pane you face. A session would hang reading the selected tab, and every later session hung behind it. After start-up, the tests used a small file-based command channel inside the test profile instead. That's test tooling only; nothing in the app.
