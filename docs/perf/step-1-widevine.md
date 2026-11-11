# Step 1: Widevine (DRM) in AetherDeck 0.2.2 for Mac

Tested 2026-11-11 on an unmodified copy of the 0.2.2 app, fresh throwaway profile, Apple M3. No code change (`step-1-widevine.patch` is empty). The CDM was fetched only by Firefox's own mechanism; nothing was signed in to.

## Results

| Question | Answer |
|---|---|
| EME on? | **Yes.** `media.eme.enabled = true`, `browser.eme.ui.enabled = true`, `media.gmp-widevinecdm.enabled = true`, `.visible = true`, `media.eme.require-app-approval = false`. |
| Settings checkbox "Play DRM-controlled content"? | **Yes, checked.** It's in Settings → **Tabs and browsing** (Firefox 159 moved it out of General). |
| Does Firefox's update server offer the CDM to our build? | **Yes.** `GMPInstallManager.checkForAddons()` asked `aus5.mozilla.org/update/3/GMP/159.0.1/20261111032014/Darwin_aarch64-gcc3/en-US/default/…/default/default/update.xml` (channel `default`, distribution `default`) and got **Widevine 4.10.3112.0** (from dl.google.com) and OpenH264 2.6.0. |
| Does it install? | **Yes.** `simpleCheckAndInstall()` (the routine Firefox's background check runs) installed both; Add-ons → Plugins shows "Widevine Content Decryption Module provided by Google Inc. 4.10.3112.0", active. Files in `<profile>/gmp-widevinecdm/4.10.3112.0/` (`libwidevinecdm.dylib` + `.sig`). On a normal profile Firefox does this by itself shortly after start; I only triggered it early. |
| Robustness levels offered (`requestMediaKeySystemAccess`) | none ✓, `SW_SECURE_CRYPTO` ✓, `SW_SECURE_DECODE` ✓; `HW_SECURE_CRYPTO`, `HW_SECURE_DECODE`, `HW_SECURE_ALL` ✗ NotSupportedError. That is **L3 (software)**, the same as Firefox on Mac. |
| Does a public DRM test stream play? | **Yes.** Shaka Player demo, "Angel One" Widevine DASH with Shaka's public test licence proxy (`cwip-shaka-proxy.appspot.com/no_auth`): MediaKeys `com.widevine.alpha` attached, licence obtained, playback advanced 8.0 s in 8 s, **199 frames shown, 0 dropped** (25 fps). It stayed at the 320×240 rendition during the short test (Shaka's adaptation hadn't moved up yet), so I can't confirm the top resolution. |
| Can I see the picture? | **Not in screenshots.** The video area is black in macOS window captures (a plain tab and the Pod alike), and Firefox's own `drawSnapshot` of the page shows the video area near-black (average 25/255). That matches Firefox protecting decrypted video from capture. **The owner needs to look at it on screen once.** |
| What in our build could block it? | Nothing found. The mozconfig doesn't disable EME (Firefox's default for macOS builds is EME with Widevine), the overlay and `policies.json` don't touch EME/GMP prefs, and uBlock Origin didn't interfere. `--with-distribution-id=com.aetherdeck` doesn't change the update query: the `distribution.id` pref is unset, so the request says `default`. |

## What this means for the Pod

- **DRM video can never show in a bent pane.** Bent panes are pictures made with `drawSnapshot`, and decrypted frames are excluded from snapshots. A Netflix/Prime-style pane would show black at the side and while turning, and only the flat live front pane (or the step-2 Theater) can show it. Step 2/3 should treat "pane playing protected media" like the media tier: live and flat, or a clear placeholder ("Protected video plays in front").
- Owner-only tests still to do: the real services (Netflix, Prime Video, Disney+, Spotify web) need the owner's own sign-in, which I didn't attempt.

## Open items for the owner (licensing)

1. **Using Mozilla's CDM distribution.** Our build fetches Widevine through Mozilla's update service (`aus5.mozilla.org`), which serves it to any build that asks, as it does for other Firefox-based browsers. Whether AetherDeck may rely on that service, or needs its own agreement with Google for Widevine, is a licensing question for the owner (and possibly Mozilla/Google), not something I can settle. The CDM itself is Google's closed-source binary under Google's licence (its `LICENSE` file is installed next to it); we don't ship it in the app or the repo.
2. **VMP (Verified Media Path), the likely real-world blocker.** On desktop, commercial services usually require the *browser* binaries to carry a VMP signature from Google's programme as well (Firefox's official builds have it). Our ad-hoc-signed build almost certainly doesn't. Shaka's test proxy doesn't check VMP, so this test passing doesn't prove Netflix or Prime will. Expect commercial services to refuse a licence or cap quality until the owner joins Google's Widevine/VMP programme. This is unverified (it needs the owner's sign-in), and I made no attempt to work around it.
