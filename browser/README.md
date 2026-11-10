# AetherDeck for Mac

AetherDeck is a browser whose window is the **Pod**, like a space pod: your real tabs bent round you on a 3D ring, a 360° photo behind them, and the AetherDeck home, Cosmonaut, agents and research in the first pane.

It is built on the open-source code of Mozilla Firefox (the release pinned in [`firefox.version`](firefox.version)), with its own name, icon, profile and front-end. **AetherDeck is not Mozilla or Firefox, and is not made or endorsed by Mozilla.** Firefox is a trademark of the Mozilla Foundation.

## Install (macOS, Apple silicon)

1. Download `AetherDeck-<version>-mac-arm64.dmg` from the [Releases](https://github.com/tajwarah/aetherdeck/releases) page and drag **AetherDeck** into Applications.
2. It is not signed with an Apple Developer ID yet. The first time, open it, then go to **System Settings → Privacy & Security → Open Anyway**. Or run `xattr -dr com.apple.quarantine "/Applications/AetherDeck.app"`.
3. It opens straight into the Pod (leave it and come back with the **Pod** button in the toolbar, or Alt+Shift+P). The first pane is AetherDeck's home: the ⚙️ there holds AI settings (an API key, Ollama on your computer, any OpenAI-compatible address, or **Sign in with ChatGPT**).

The app carries its own copy of [Node.js](https://nodejs.org) and starts AetherDeck's local server on `127.0.0.1:8787` when it opens (only this computer can reach it), and stops it when you quit. If an AetherDeck server is already running, it uses that one. Your settings, keys and ChatGPT sign-in are kept in `~/Library/Application Support/AetherDeck/Server/`, in files only your user account can read; your browsing profile is in `~/Library/Application Support/AetherDeck/Browser/`, separate from any Firefox profile.

Not yet: Intel Macs, Windows, Linux, automatic updates, Developer ID signing and notarization.

## What is in this folder

| Path | What it is |
|---|---|
| `overlay/` | Files copied into the Firefox source: the `aetherdeck` branding (name, icons, About window, default preferences). |
| `room-src/` | The Pod (called the Room in the code), as a browser component (`browser/components/aetherdeck/`): `room.js` (the ring, panes, dock, widgets), `room-loader.js`, the page bridge and input actors, `AetherDeckServer.sys.mjs` (starts the bundled server), and the 360° photos. |
| `configs/` | Mozilla build configurations (`mozconfig.full`: optimized, no crash reporter, no updater, no telemetry upload). |
| `scripts/` | `fetch.sh` (download and verify the Firefox source), `prepare.sh` (copy our files in and replace Mozilla's name and artwork in the interface), `mach`, `run.sh`, `package-mac.sh`. |

## Build it

You need macOS on Apple silicon, Xcode, [uv](https://docs.astral.sh/uv/) (`uv python install 3.13`), Rust 1.90+ (`brew install rustup`), Node 22+, and about 40 GB of free disk for the Firefox source and build.

```bash
export AETHERDECK_WORK=/Volumes/Big/aetherdeck-browser   # where the Firefox source and build go (default: browser/work)
browser/scripts/fetch.sh            # Firefox source, checked against Mozilla's SHA-256 list
browser/scripts/mach bootstrap      # Mozilla's toolchains, once
browser/scripts/prepare.sh          # AetherDeck branding and the Pod into the source
browser/scripts/mach build          # the first build takes a few hours
browser/scripts/run.sh dev          # run it on a test profile
browser/scripts/package-mac.sh --skip-build   # the .dmg, in $AETHERDECK_WORK/release/
```

After changing only `room-src/` or `overlay/`, `prepare.sh` and `mach build faster` take about a minute.

## Licences and Mozilla's rules

- Firefox's source is under the [Mozilla Public License 2.0](https://www.mozilla.org/MPL/2.0/). Files taken from it and changed here (the branding folder is derived from Mozilla's unofficial branding) keep their MPL-2.0 headers, and this folder is their source, as the MPL requires. The release's `about:license` page lists every licence in the browser.
- AetherDeck uses its own name, icon, wordmark, maker name and profile folder, as Mozilla's trademark policy asks of builds made from its code. It doesn't use the Firefox name or logo, and the interface's "Firefox" and "Mozilla" wording is replaced, except in licence and legal text.
- No Mozilla accounts, Sync, Pocket, VPN, studies or promotions are switched on, and the crash reporter and updater are left out of the build.
- AetherDeck's own code is under the [Apache License 2.0](../LICENSE). The bundled Node.js is under the MIT licence (its licence is in the app at `Contents/Resources/aetherdeck/bin/NODE-LICENSE`).
