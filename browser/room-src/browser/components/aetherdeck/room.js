// AetherDeck's Pod (the Room in the code) (a browser-window script): the ring shows REAL TABS, not browser elements of its own.
// It creates ordinary tabs with gBrowser, asks Firefox's own split-view machinery (gBrowser.showSplitViewPanels) to keep
// several tabs' browsers inserted, active and visible at once, then places their panels on a CSS 3D ring.
// The ring maths is the same as chromium/src/roomLogic.ts (shared/surround.ts layout), written out here in plain JS.
// Loaded into every normal browser window by room-loader.js (browser/base/content/browser.xhtml).
(function () {
  const PW = 1100, PH = Math.round(1100 / 1.45), TAU = Math.PI * 2;
  const URLS = (Services.env.get("AD_ROOM_URLS") || "http://127.0.0.1:8787/?room=1,https://github.com,https://mail.google.com").split(",");
  // Problems go to the console; the file log in the profile only when aetherdeck.room.debug is on (it costs disk writes).
  const DEBUG = Services.prefs.getBoolPref("aetherdeck.room.debug", false);
  const log = (m) => {
    window.dump("[room-tabs] " + m + "\n");
    if (DEBUG) try { window.IOUtils.writeUTF8(window.PathUtils.join(window.PathUtils.profileDir, "aetherdeck-room.log"), new Date().toISOString() + " " + m + "\n", { mode: "appendOrCreate" }); } catch (e) {}
  };
  const turn = (a) => { const t = (a + Math.PI) % TAU; return (t < 0 ? t + TAU : t) - Math.PI; };
  const system = Services.scriptSecurityManager.getSystemPrincipal();
  const gBrowser = window.gBrowser;

  // The ring: panes stand on the inside of a cylinder around you, close together (about 52 degrees apart for a few panes,
  // evenly round the whole circle once there are too many for that).
  function ring(n) {
    const step = Math.min(0.9, TAU / Math.max(1, n));
    const wAng = step * 0.9;
    const yaws = [];
    for (let i = 0; i < n; i++) yaws.push(turn(i * step));
    return { yaws, radius: PW / (2 * Math.tan(wAng / 2)), step };
  }

  // Eight panes in the Pod; how many stay live depends on the Mac's memory (all eight from 16 GB). Asleep panes keep their
  // last picture and wake when you turn to them. More tabs than eight wait in the "More tabs" box.
  const RAM_GB = (() => { try { return Services.sysinfo.getProperty("memsize") / 2 ** 30; } catch (e) { return 8; } })();
  const MAX_PANES = 8, MAX_LIVE = Math.max(2, Math.min(8, Number(Services.env.get("AD_ROOM_LIVE")) || (RAM_GB >= 15 ? 8 : RAM_GB >= 7 ? 6 : 4))), SLEEP_AFTER_MS = 20000;
  let lastTarget = null, sizeRange = null, sizeLabel = null; // the dock's size slider (built with the dock)
  const cam = { yaw: 0, pitch: 0, fov: 1.3, back: 0, target: null, tpitch: 0 };
  const panes = []; // { tab, url, yaw, outSince, asleep }
  let adding = false;
  let layout = ring(URLS.length);
  const panels = () => gBrowser.tabpanels;

  // Style: the tab panels fill the window (above the toolbars) and each tab's panel stands on the ring.
  const style = document.createElement("style");
  style.id = "ad-room-css";
  style.textContent = `
    body.ad-room #tabbrowser-tabpanels { position: fixed !important; inset: 0 !important; z-index: 1000; overflow: hidden;
      background: radial-gradient(ellipse at 50% 40%, #14141c, #07070a 70%); transform-style: preserve-3d; perspective-origin: 50% 50%; }
    body.ad-room #tabbrowser-tabpanels > .browserSidebarContainer { display: none !important; }
    body.ad-room #tabbrowser-tabpanels > .browserSidebarContainer.ad-room-pane { display: flex !important; visibility: visible !important;
      position: absolute !important; left: 50% !important; top: 50% !important; width: ${PW}px !important; height: ${PH}px !important;
      margin: ${-PH / 2}px 0 0 ${-PW / 2}px !important; flex: none !important; order: 0 !important; border: 1px solid #333; border-radius: 8px;
      overflow: hidden; backface-visibility: hidden; background: #fff; }
    body.ad-room #navigator-toolbox, body.ad-room #sidebar-main, body.ad-room #sidebar-box, body.ad-room #statuspanel { display: none !important; }
    body.ad-room split-view-footer { display: none !important; }
    body.ad-room .browserSidebarContainer.ad-room-pane.ad-asleep::after { content: "Asleep to save memory. Turn to it to wake it."; position: absolute; inset: 0; display: flex;
      align-items: center; justify-content: center; background: #0e0e13; color: #9a9aa6; font: 15px system-ui; z-index: 3; }
    #ad-more { position: fixed; right: 12px; bottom: 92px; z-index: 1600; width: 300px; max-height: 50vh; overflow: auto; display: none; padding: 8px; border-radius: 14px;
      background: rgba(20,18,32,.94); border: 1px solid rgba(214,202,255,.35); box-shadow: 0 18px 50px rgba(0,0,0,.5); color: #f6f1ff; font: 13px system-ui; }
    #ad-more.open { display: block; }
    #ad-more .h { margin: 2px 4px 8px; font-weight: 600; } #ad-more .h small { display: block; font-weight: 400; opacity: .7; margin-top: 2px; }
    #ad-more .t { display: flex; align-items: center; gap: 8px; padding: 7px 8px; border-radius: 9px; cursor: grab; }
    #ad-more .t:hover { background: rgba(255,255,255,.08); }
    #ad-more .t img { width: 16px; height: 16px; flex: none; }
    #ad-more .t span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    #ad-more .t button { flex: none; border: 0; border-radius: 7px; padding: 3px 8px; background: #6c56d8; color: #fff; font: 12px system-ui; cursor: pointer; }
    #ad-more-ghost { position: fixed; z-index: 2100; pointer-events: none; padding: 6px 10px; border-radius: 9px; background: #6c56d8; color: #fff; font: 12px system-ui; max-width: 240px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    #ad-room-rail { position: fixed; top: 34px; left: 0; bottom: 0; width: 210px; z-index: 1500; overflow: auto; background: #0b0b0fe6; color: #ececf1; font: 12px system-ui; padding: 6px; display: none; }
    /* The rail sits beside <body>, not in it: "body.ad-room #ad-room-rail" never matched, so the Tabs list never showed. */
    body.ad-room ~ #ad-room-rail.open, body.ad-room #ad-room-rail.open { display: block; }
    #ad-room-rail .item { display: flex; align-items: center; gap: 6px; padding: 5px 6px; border-radius: 6px; cursor: pointer; }
    #ad-room-rail .item:hover, #ad-room-rail .item.here { background: #1d1d26; }
    #ad-room-rail .item .t { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    #ad-room-rail .item .h { color: #9a9aa6; font-size: 11px; }
    #ad-room-rail .item.asleep .t { opacity: .5; }
    #ad-room-rail .item button { margin: 0; padding: 0 5px; border: 0; background: transparent; color: #9a9aa6; cursor: pointer; }
    #ad-widgets { display: none; position: fixed; inset: 0; z-index: 1003; pointer-events: none; }
    /* The widget shelf: a tab on the left edge; widgets show only while it is open (closed by default). */
    #ad-shelf { display: none; position: fixed; left: 0; top: 50%; transform: translateY(-50%); z-index: 1004; flex-direction: column; gap: 6px; }
    body.ad-room ~ #ad-shelf, body.ad-room #ad-shelf { display: flex; }
    :root[data-ad-theater] #ad-shelf { display: none !important; }
    #ad-shelf button { writing-mode: vertical-rl; border: 1px solid rgba(214,202,255,.35); border-left: 0; border-radius: 0 10px 10px 0; padding: 10px 5px;
      background: rgba(30,26,52,.86); color: #f6f1ff; font: 12px system-ui; letter-spacing: .06em; cursor: pointer; }
    #ad-shelf button:hover { background: rgba(60,48,110,.9); }
    #ad-shelf .reset { display: none; }
    #ad-shelf.open .reset { display: block; }
    body.ad-room ~ #ad-widgets, body.ad-room #ad-widgets { display: block; }
    .ad-widget { position: absolute; box-sizing: border-box; min-width: 130px; min-height: 64px; max-width: 520px; max-height: 300px; padding: 10px 14px; border-radius: 16px;
      border: 1px solid rgba(214,202,255,.32); background: rgba(30,26,52,.86);
      color: #f6f1ff; font: 13px system-ui; pointer-events: auto; cursor: grab; box-shadow: 0 10px 34px rgba(0,0,0,.35); resize: both; overflow: hidden; container-type: size; user-select: none; }
    .ad-widget.dragging { cursor: grabbing; opacity: .9; }
    .ad-widget .k { opacity: .7; font-size: clamp(9px, 8cqh, 13px); letter-spacing: .08em; text-transform: uppercase; }
    .ad-widget .v { font-size: clamp(16px, 34cqh, 72px); font-weight: 300; margin-top: 2px; line-height: 1.1; white-space: nowrap; }
    .ad-widget .s { opacity: .75; margin-top: 2px; font-size: clamp(10px, 11cqh, 16px); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .ad-widget .x { position: absolute; top: 6px; right: 8px; width: 18px; height: 18px; border: 0; border-radius: 50%; background: rgba(0,0,0,.35); color: #fff; font: 13px/18px system-ui; padding: 0; cursor: pointer; opacity: 0; }
    .ad-widget:hover .x { opacity: 1; }
    .ad-widget.agent { padding: 6px 8px 12px; display: flex; flex-direction: column; gap: 4px; }
    .ad-widget.agent .bar { display: flex; align-items: center; gap: 6px; font-size: 11px; opacity: .85; padding-right: 22px; }
    .ad-widget.agent .bar b { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
    .ad-widget.agent .bar button { border: 0; background: rgba(0,0,0,.3); color: #fff; border-radius: 6px; font: 11px system-ui; padding: 1px 6px; cursor: pointer; }
    .ad-widget.agent browser, .ad-widget.agent pre { flex: 1; min-height: 0; width: 100%; border: 0; border-radius: 10px; background: #fff; pointer-events: auto; }
    .ad-widget.agent pre { margin: 0; padding: 6px; overflow: auto; background: #0b0b10; color: #cfd2ff; font: 11px ui-monospace, Menlo, monospace; white-space: pre-wrap; user-select: text; cursor: text; }
    #ad-room-hud input { flex: 0 1 320px; padding: 3px 8px; border: 1px solid #555; border-radius: 6px; background: #111; color: #fff; font: 13px system-ui; }
    #ad-room-hud .meter { margin-left: auto; color: #9a9aa6; font-size: 12px; }
    #ad-room-hud button { margin-left: 0; }
    #ad-room-hud { position: fixed; top: 0; left: 0; right: 0; height: 34px; z-index: 2000; display: flex; gap: 8px; align-items: center;
      padding: 0 12px; background: #0b0b0fcc; color: #ececf1; font: 13px system-ui; }
    #ad-room-hud button { margin-left: auto; padding: 2px 10px; border: 1px solid #555; border-radius: 6px; background: #222; color: #fff; cursor: pointer; }

    body.ad-room #tabbrowser-tabpanels { background: none !important; pointer-events: none !important; }
    body.ad-room .browserSidebarContainer.ad-room-pane { pointer-events: auto; }
    #ad-room-bg { display: none; position: fixed; inset: 0; z-index: 999; overflow: hidden; pointer-events: none; transform-style: preserve-3d;
      perspective-origin: 50% 50%; background: radial-gradient(ellipse at 50% 40%, #14141c, #07070a 70%); }
    body.ad-room ~ #ad-room-bg, body.ad-room #ad-room-bg { display: block; }
    .ad-bg-strip { position: absolute; left: 50%; top: 50%; background-repeat: no-repeat; backface-visibility: hidden; }
    #ad-bg-world, #ad-room-world { position: absolute; inset: 0; transform-style: preserve-3d; pointer-events: none; }
    #ad-room-bg[data-kind="space"] { background: radial-gradient(1.5px 1.5px at 20% 30%, #fff, transparent), radial-gradient(1px 1px at 70% 20%, #cfe, transparent), radial-gradient(1.5px 1.5px at 45% 75%, #fff, transparent), radial-gradient(1px 1px at 85% 60%, #fdf, transparent), radial-gradient(2px 2px at 10% 80%, #fff, transparent), radial-gradient(1px 1px at 60% 50%, #fff, transparent), radial-gradient(ellipse at 30% 20%, #1a1244 0%, #070716 55%, #02020a 100%); background-size: 340px 340px, 260px 260px, 420px 420px, 300px 300px, 380px 380px, 220px 220px, 100% 100%; }
    #ad-room-bg[data-kind="aurora"] { background: radial-gradient(ellipse at 20% 90%, #0b6e6a 0%, transparent 55%), radial-gradient(ellipse at 80% 100%, #5b2a8c 0%, transparent 60%), radial-gradient(ellipse at 50% 0%, #0d2a4d 0%, transparent 70%), #05060d; }
    #ad-room-bg[data-kind="none"] { background: radial-gradient(ellipse at 50% 40%, #14141c, #07070a 70%); }
    #ad-room-bgmenu { display: none; position: fixed; right: 24px; bottom: 76px; z-index: 2100; width: 300px; padding: 10px; border-radius: 16px; background: rgba(24,24,34,.78);
      backdrop-filter: blur(22px) saturate(1.5); border: 1px solid rgba(255,255,255,.16); box-shadow: 0 10px 40px rgba(0,0,0,.5); color: #ececf1; font: 13px system-ui; flex-wrap: wrap; gap: 8px; }
    #ad-room-bgmenu.open { display: flex; }
    #ad-room-bgmenu .row { width: 100%; display: flex; align-items: center; padding: 6px 4px 2px; border-top: 1px solid rgba(255,255,255,.12); margin-top: 4px; }
    #ad-room-bgmenu .it { width: 132px; cursor: pointer; border-radius: 10px; padding: 4px; border: 1px solid transparent; }
    #ad-room-bgmenu .it:hover { background: rgba(255,255,255,.08); }
    #ad-room-bgmenu .it.on { border-color: #8f73ff; background: rgba(143,115,255,.16); }
    #ad-room-bgmenu .th { height: 66px; border-radius: 8px; background-size: cover; background-position: center; margin-bottom: 4px; background-color: #111; }
    #ad-room-bgmenu .th.space { background-image: radial-gradient(1.5px 1.5px at 30% 40%, #fff, transparent), radial-gradient(1px 1px at 70% 60%, #fff, transparent), radial-gradient(ellipse at 30% 20%, #1a1244, #02020a); }
    #ad-room-bgmenu .th.aurora { background-image: radial-gradient(ellipse at 20% 100%, #0b6e6a, transparent 60%), radial-gradient(ellipse at 80% 100%, #5b2a8c, transparent 60%), linear-gradient(#05060d, #05060d); }
    #ad-room-bgmenu .th.none { background-image: radial-gradient(ellipse at 50% 40%, #14141c, #07070a); }
    #ad-room-hud { top: auto !important; bottom: 18px !important; left: 50% !important; right: auto !important; transform: translateX(-50%);
      width: min(1180px, calc(100% - 48px)); height: 46px !important; border-radius: 16px; background: rgba(28,28,38,.42) !important;
      backdrop-filter: blur(22px) saturate(1.5); -moz-backdrop-filter: blur(22px) saturate(1.5); border: 1px solid rgba(255,255,255,.16);
      box-shadow: 0 10px 40px rgba(0,0,0,.45), inset 0 1px 0 rgba(255,255,255,.12); letter-spacing: .02em; }
    #ad-room-hud input { background: rgba(0,0,0,.35) !important; border: 1px solid rgba(255,255,255,.18) !important; border-radius: 10px !important; }
    #ad-room-hud button { background: rgba(255,255,255,.1) !important; border: 1px solid rgba(255,255,255,.2) !important; border-radius: 10px !important; }
    #ad-room-rail { top: 0 !important; bottom: 86px !important; }
    #ad-room-hud, #ad-room-hud * { white-space: nowrap; }
    #ad-room-hud .meter { overflow: hidden; text-overflow: ellipsis; min-width: 0; }
    #ad-room-hud input { min-width: 120px; }
    #ad-room-curves { display: none; position: fixed; inset: 0; z-index: 1001; overflow: hidden; pointer-events: none; transform-style: preserve-3d; perspective-origin: 50% 50%; }
    body.ad-room ~ #ad-room-curves, body.ad-room #ad-room-curves { display: block; }
    .ad-curve-strip { position: absolute; left: 50%; top: 50%; pointer-events: none; backface-visibility: hidden; }
    #ad-room-drag { display: none; position: fixed; inset: 0; z-index: 1002; cursor: grab; }
    body.ad-room ~ #ad-room-drag, body.ad-room #ad-room-drag { display: block; }
    body.ad-room .browserSidebarContainer.ad-room-pane.ad-side { opacity: 0.001 !important; pointer-events: none !important; }
    /* The pane you're facing, at rest: the live page itself, flat and at the screen's own resolution, above the Pod's layers. */
    body.ad-room.ad-focusing #tabbrowser-tabpanels { z-index: 1003 !important; }
    body.ad-room .browserSidebarContainer.ad-room-pane.ad-focus { transform: none !important; opacity: 1 !important; pointer-events: auto !important; z-index: 10 !important; border-color: transparent !important; box-shadow: 0 18px 60px rgba(0,0,0,.45); }
    body.ad-room .browserSidebarContainer.ad-room-pane.ad-input { transform: none !important; pointer-events: auto !important; opacity: 0.001 !important; z-index: 5 !important; }
    #ad-room-curves.ad-passthru, #ad-room-curves.ad-passthru *, #ad-room-drag.ad-passthru { pointer-events: none !important; }
    /* The bar at any window width: buttons never shrink below their text (they used to be squeezed until it spilled out, and
       at 900 px "More tabs", "⤢" and "Leave" were pushed off the window); the address box gives way first, then the hint,
       the meter and the slider's length; below 860 px the bar wraps onto two centred rows. */
    #ad-room-hud > * { flex-shrink: 0; }
    #ad-room-hud button { flex: none !important; }
    #ad-room-hud input:not([type=range]) { flex: 1 1 200px !important; min-width: 80px !important; }
    #ad-room-hud .meter { flex: 0 1 auto !important; min-width: 0 !important; }
    @media (max-width: 1440px) { #ad-room-hud > span:first-child { display: none; } } /* the hint gives its room to the address box */
    @media (max-width: 1000px) { #ad-room-hud .meter { display: none; } #ad-room-hud input[type=range] { width: 64px !important; flex-basis: 64px !important; } }
    @media (max-width: 860px) { #ad-room-hud { flex-wrap: wrap; height: auto !important; min-height: 46px; padding: 6px 10px !important; row-gap: 6px; justify-content: center; } }
    /* Theater: one pane fills the view, flat and live; widgets tuck away. */
    :root[data-ad-theater] #ad-widgets, :root[data-ad-theater] #ad-more, :root[data-ad-theater] #ad-room-rail { display: none !important; }
    /* Cinema: a still auditorium (drawn once: no 3D, no photo, no pictures) and one live page on its screen. */
    #ad-cinema { display: none; position: fixed; inset: 0; z-index: 999; pointer-events: none;
      background:
        radial-gradient(ellipse 60% 42% at 50% 36%, rgba(150, 140, 210, .18), transparent 72%),
        linear-gradient(90deg, #2a070c 0, #5b1520 3.5%, #3a0b12 6%, transparent 10%, transparent 90%, #3a0b12 94%, #5b1520 96.5%, #2a070c 100%),
        radial-gradient(circle at 50% 100%, #000 58%, transparent 60%) 0 100% / 64px 46px repeat-x,
        radial-gradient(circle at 50% 100%, #07060a 58%, transparent 60%) 22px calc(100% - 34px) / 52px 38px repeat-x,
        radial-gradient(circle at 50% 100%, #0c0a12 58%, transparent 60%) 8px calc(100% - 62px) / 42px 30px repeat-x,
        linear-gradient(180deg, #0b0910 0%, #08070c 60%, #040306 100%); }
    :root[data-ad-cinema] #ad-cinema { display: block; }
    :root[data-ad-cinema] #ad-room-bg, :root[data-ad-cinema] #ad-room-curves, :root[data-ad-cinema] #ad-room-drag, :root[data-ad-cinema] #ad-shelf { display: none !important; }
    :root[data-ad-cinema] #tabbrowser-tabpanels { perspective: none !important; z-index: 1003 !important; }
    :root[data-ad-cinema] #tabbrowser-tabpanels > .browserSidebarContainer.ad-room-pane:not(.ad-cinema-screen) { visibility: hidden !important; }
    :root[data-ad-cinema] body.ad-room #tabbrowser-tabpanels > .browserSidebarContainer.ad-room-pane.ad-cinema-screen { position: fixed !important; transform: none !important; margin: 0 !important;
      left: var(--ad-cin-x) !important; top: var(--ad-cin-y) !important; width: var(--ad-cin-w) !important; height: var(--ad-cin-h) !important; opacity: 1 !important;
      pointer-events: auto !important; border: 0 !important; border-radius: 4px !important; box-shadow: 0 0 120px rgba(160, 150, 230, .22), 0 0 0 1px rgba(255,255,255,.06) !important; }
    #ad-cinema-ask { position: fixed; top: 18px; left: 50%; transform: translateX(-50%); z-index: 2050; width: min(460px, calc(100% - 32px)); box-sizing: border-box;
      padding: 12px 14px; border-radius: 14px; background: rgba(24, 20, 38, .96); border: 1px solid rgba(214, 202, 255, .4); box-shadow: 0 16px 50px rgba(0,0,0,.5);
      color: #f6f1ff; font: 13px/1.4 system-ui; display: grid; gap: 8px; }
    #ad-cinema-ask b { font-weight: 600; } #ad-cinema-ask .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    #ad-cinema-ask button { flex: none; border: 1px solid rgba(255,255,255,.2); border-radius: 9px; padding: 5px 12px; background: rgba(255,255,255,.1); color: #fff; font: 13px system-ui; cursor: pointer; }
    #ad-cinema-ask button.go { background: #6c56d8; border-color: #6c56d8; }
    #ad-cinema-ask label { margin-left: auto; display: flex; gap: 6px; align-items: center; opacity: .85; cursor: pointer; }
    :root[data-ad-cinema] #ad-cinema-ask { display: none; }
    :root[data-ad-pane-fs] .browserSidebarContainer.ad-room-pane.ad-focus { background: transparent !important; border-color: transparent !important; box-shadow: none !important; }
    :root[data-ad-pane-fs] .browserSidebarContainer.ad-room-pane.ad-focus * { background: transparent !important; }
  `;
  document.documentElement.append(style);
  // A page's own full screen (a video's ⛶ button) stays inside the Pod: Firefox puts the page's <browser> in the window's
  // "top layer", filling the window with a black backdrop. This sheet (agent level, so it can outrank Firefox's built-in
  // full-screen rules) puts it in the Theater rectangle instead, with the Pod still visible around it.
  try {
    const fsCss = `:root[data-ad-theater] .browserSidebarContainer browser:fullscreen { position: fixed !important; inset: auto !important;
        left: var(--ad-fs-x, 4vw) !important; top: var(--ad-fs-y, 4vh) !important; width: var(--ad-fs-w, 92vw) !important; height: var(--ad-fs-h, 84vh) !important;
        border-radius: 8px !important; box-shadow: none !important; }
      :root[data-ad-theater] .browserSidebarContainer browser:fullscreen::backdrop { background: transparent !important; }`;
    window.windowUtils.loadSheetUsingURIString("data:text/css," + encodeURIComponent(fsCss), window.windowUtils.AGENT_SHEET);
  } catch (e) { log("full-screen sheet failed: " + e); }

  const hud = document.createElementNS("http://www.w3.org/1999/xhtml", "div");
  hud.id = "ad-room-hud";
  const X = "http://www.w3.org/1999/xhtml";
  const title = document.createElementNS(X, "span");
  title.textContent = "Drag to look around";
  const addr = document.createElementNS(X, "input");
  addr.placeholder = "Open a site as a pane, or search";
  addr.spellcheck = false;
  const meter = document.createElementNS(X, "span");
  meter.className = "meter";
  const leaveBtn = document.createElementNS(X, "button");
  leaveBtn.textContent = "Leave";
  leaveBtn.title = "Leave the Pod (Alt+Shift+P)";
  const railBtn = document.createElementNS(X, "button");
  railBtn.textContent = "Tabs";
  const mk = (label, tip, fn) => { const b = document.createElementNS(X, "button"); b.textContent = label; b.title = tip; b.addEventListener("click", fn); b.style.cssText = "margin-left:0;min-width:30px;"; return b; };
  const zoomOutBtn = mk("−", "Smaller (the pane you last clicked)", () => zoomPane(targetPane(), 1 / 1.15));
  const zoomInBtn = mk("+", "Bigger (the pane you last clicked)", () => zoomPane(targetPane(), 1.15));
  const fitBtn = mk("Fit", "Fill the view with this pane (F, Esc to go back)", () => theater());
  sizeRange = document.createElementNS(X, "input");
  sizeRange.type = "range"; sizeRange.min = "40"; sizeRange.max = "320"; sizeRange.step = "5"; sizeRange.value = "100";
  sizeRange.title = "Size of the pane you are facing";
  sizeRange.style.cssText = "width:92px;flex:0 0 92px;margin:0;padding:0;accent-color:#8f73ff;";
  sizeRange.addEventListener("input", () => setScale(targetPane(), Number(sizeRange.value) / 100));
  sizeLabel = document.createElementNS(X, "span");
  sizeLabel.style.cssText = "min-width:38px;font-size:12px;color:#c9c9d4;";
  sizeLabel.textContent = "100%";
  const homeBtn = mk("⌂", "Back to the pane you were using (also: Home key, double-click the pod)", () => recenter());
  const roomsBtn = mk("Views", "Pick the view outside your pod", () => toggleBgMenu());
  roomsBtn.style.minWidth = "54px";
  const fsBtn = mk("⤢", "Full screen", () => { window.fullScreen = !window.fullScreen; });
  let widgetsOn = false; // the shelf: closed by default
  try { widgetsOn = window.Services.prefs.getBoolPref("aetherdeck.room.widgetShelfOpen", false); } catch (e) {}
  const widgetsBtn = mk("Widgets", "Open or close the widget shelf (clock, tabs, agents' widgets)", () => {
    setShelf(!widgetsOn);
  });
  widgetsBtn.style.opacity = widgetsOn ? "1" : ".55";
  const moreBtn = mk("More tabs", "Tabs beyond the eight in your pod: swap one in", () => toggleMore());
  const cinemaBtn = mk("Cinema", "Watch the pane you're facing on a cinema screen (Esc to come back)", () => (cinemaOf ? endCinema() : cinema(targetPane())));
  cinemaBtn.style.flex = "none";
  moreBtn.style.minWidth = "84px";
  hud.append(title, addr, railBtn, zoomOutBtn, sizeRange, sizeLabel, zoomInBtn, fitBtn, cinemaBtn, homeBtn, roomsBtn, widgetsBtn, moreBtn, fsBtn, meter, leaveBtn);
  const rail = document.createElementNS(X, "div");
  rail.id = "ad-room-rail";
  document.documentElement.append(rail);
  railBtn.addEventListener("click", () => { rail.classList.toggle("open"); drawRail(); });
  document.documentElement.append(hud);
  const say = (m) => { title.textContent = m; window.setTimeout(() => { title.textContent = "Drag to look around"; }, 4000); };

  // The 360° photo behind the ring: a cylinder of vertical strips in the same 3D scene, turning with the camera.
  const BG_CHOICES = [
    { id: "home-office", name: "Home office" },
    { id: "glasshouse", name: "Glasshouse" },
    { id: "loft", name: "Photo loft" },
    { id: "seaside-balcony", name: "Seaside balcony" },
    { id: "space", name: "Deep space" },
    { id: "aurora", name: "Aurora" },
    { id: "none", name: "Plain dark" },
  ];
  let BG_NAME = (() => { try { return Services.prefs.getStringPref("aetherdeck.room.background", "home-office"); } catch (e) { return "home-office"; } })();
  const CURVE_ON = (() => { try { return Services.prefs.getBoolPref("aetherdeck.room.curve", true); } catch (e) { return true; } })();
  const BG_R = 2400, BG_H = 7400;
  let BG_N = 36, BG_W = (2 * Math.PI * BG_R) / BG_N;
  let bgEl = null, bgWorld = null;
  const isPhoto = (n) => ["home-office", "glasshouse", "loft", "seaside-balcony"].includes(n);
  function bgUrl(n) { return "chrome://browser/content/aetherdeck/rooms/" + n + ".jpg"; }
  function ensureBg() {
    if (bgEl) return;
    bgEl = document.createElementNS(X, "div");
    bgEl.id = "ad-room-bg";
    bgWorld = document.createElementNS(X, "div");
    bgWorld.id = "ad-bg-world";
    bgEl.append(bgWorld);
    // Static strips: a ring of the panorama. Turning the camera moves the one container, not every strip.
    BG_N = clamp(tune("bgStrips", 36), 8, 72); BG_W = (2 * Math.PI * BG_R) / BG_N;
    for (let j = 0; j < BG_N; j++) {
      const d = document.createElementNS(X, "div");
      d.className = "ad-bg-strip";
      const a = ((j + 0.5) / BG_N) * TAU - Math.PI;
      d.dataset.j = String(j);
      d.style.cssText = `width:${BG_W + 3}px;height:${BG_H}px;margin:${-BG_H / 2}px 0 0 ${-BG_W / 2}px;` +
        `transform:rotateY(${-a}rad) translateZ(${-BG_R}px);`;
      bgWorld.append(d);
    }
    // Same parent as the tab panels, so it shares their stacking context and sits just below them (z-index 999 vs 1000).
    gBrowser.tabpanels.parentNode.insertBefore(bgEl, gBrowser.tabpanels);
    setBackground(BG_NAME, false);
  }
  function setBackground(name, save) {
    BG_NAME = name;
    if (save !== false) { try { Services.prefs.setStringPref("aetherdeck.room.background", name); } catch (e) {} }
    if (!bgEl) return;
    bgEl.dataset.kind = isPhoto(name) ? "photo" : name;
    for (const d of bgWorld.children) {
      if (isPhoto(name)) {
        const j = Number(d.dataset.j);
        d.style.display = "block";
        d.style.backgroundImage = `url(${bgUrl(name)})`;
        d.style.backgroundSize = `${BG_N * BG_W}px ${(BG_N * BG_W) / 2}px`;
        d.style.backgroundPosition = `${-j * BG_W}px 50%`;
      } else { d.style.display = "none"; d.style.backgroundImage = "none"; }
    }
    try { if (isPhoto(name)) { const im = new window.Image(); im.onload = () => log("bg image loaded " + name + " " + im.naturalWidth + "x" + im.naturalHeight); im.onerror = () => log("bg image FAILED " + name); im.src = bgUrl(name); } } catch (e) {}
    updateBgMenu();
  }
  function applyBg(P) {
    if (!bgEl) return;
    if (bgEl.dataset.persp !== String(P)) { bgEl.dataset.persp = String(P); bgEl.style.perspective = P + "px"; }
    bgWorld.style.transform = `translateZ(${P - cam.back}px) rotateX(${cam.pitch}rad) rotateY(${cam.yaw}rad)`;
  }
  // A small menu of rooms (with pictures) opened from the dock.
  let bgMenu = null;
  function updateBgMenu() { if (!bgMenu) return; for (const it of bgMenu.children) if (it.dataset.id) it.classList.toggle("on", it.dataset.id === BG_NAME); }
  function toggleBgMenu() {
    if (!bgMenu) {
      bgMenu = document.createElementNS(X, "div");
      bgMenu.id = "ad-room-bgmenu";
      for (const c of BG_CHOICES) {
        const it = document.createElementNS(X, "div");
        it.className = "it"; it.dataset.id = c.id;
        const th = document.createElementNS(X, "div");
        th.className = "th " + (isPhoto(c.id) ? "" : c.id);
        if (isPhoto(c.id)) th.style.backgroundImage = `url(chrome://browser/content/aetherdeck/rooms/thumbs/${c.id}.jpg)`;
        const nm = document.createElementNS(X, "span"); nm.textContent = c.name;
        it.append(th, nm);
        it.addEventListener("click", () => { setBackground(c.id); });
        bgMenu.append(it);
      }
      const row = document.createElementNS(X, "div");
      row.className = "row";
      const lab = document.createElementNS(X, "span"); lab.textContent = "Curve";
      const rg = document.createElementNS(X, "input"); rg.type = "range"; rg.min = "0"; rg.max = "100"; rg.step = "5"; rg.value = String(curveAmount);
      rg.style.cssText = "flex:1;margin:0 8px;accent-color:#8f73ff;";
      const val = document.createElementNS(X, "span"); val.textContent = curveAmount + "%"; val.style.minWidth = "36px";
      rg.addEventListener("change", () => place());
      rg.addEventListener("input", () => { curveAmount = Number(rg.value); val.textContent = curveAmount + "%"; try { Services.prefs.setIntPref("aetherdeck.room.curveAmount", curveAmount); } catch (e) {} layoutVer++; apply(); });
      row.append(lab, rg, val);
      bgMenu.append(row);
      document.documentElement.append(bgMenu);
      updateBgMenu();
    }
    bgMenu.classList.toggle("open");
  }

  // ---- The cylinder engine ----
  // You sit in the middle of a cylinder with the panorama beyond it. Every pane is a bent surface round you: vertical canvas
  // strips fed by pictures of the page (browser.drawSnapshot). The real page stays underneath, invisible, and the mouse and
  // wheel are passed to it (windowUtils), so a bent pane is live and usable. You look around freely (drag the room, wheel
  // over it, arrow keys); Ctrl/Cmd + wheel over a pane zooms it; Shift + drag over a pane moves it; "Fit" fills the view.
  const CURVE_N = 18;
  let curveAmount = (() => { try { return Services.prefs.getIntPref("aetherdeck.room.curveAmount", 45); } catch (e) { return 45; } })(); // 0 flat .. 100 strongly bent
  const SNAP_FPS_MS = 16;
  let curveEl = null, worldEl = null, dragEl = null, raf = 0, lastFrame = 0, activePane = null, layoutVer = 0, widgetVer = -1;
  const look = { on: false, x: 0, y: 0, yaw: 0, pitch: 0 };
  const press = { on: false, pane: null, lx: 0, ly: 0 };
  const stats = { snaps: 0, t0: Date.now() };
  const perf = { snaps: 0, snapMs: 0, drawMs: 0, perPane: {} };
  let tiersAt = 0; // when the panes' tiers were last set (setTiers)
  const wu = window.windowUtils;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function paneGeom(p) {
    const sc = p.scale || 1;
    return { sc, sw: (PW / CURVE_N) * sc, h: PH * sc };
  }

  function ensureLayers() {
    if (!dragEl) {
      // One transparent layer above the bent panes receives every pointer event; we work out ourselves which pane and which
      // point of the page it landed on (the browser's own hit-testing through nested 3D transforms is not reliable).
      dragEl = document.createElementNS(X, "div");
      dragEl.id = "ad-room-drag";
      gBrowser.tabpanels.parentNode.insertBefore(dragEl, gBrowser.tabpanels.nextSibling);
      dragEl.addEventListener("mousedown", layerDown);
      dragEl.addEventListener("mousemove", layerMove);
      dragEl.addEventListener("wheel", layerWheel, { passive: false });
      dragEl.addEventListener("dblclick", (e) => { if (!pick(e.clientX, e.clientY)) recenter(); });
      dragEl.addEventListener("MozMagnifyGestureUpdate", (e) => { const h = pick(e.clientX, e.clientY) || { p: targetPane() }; e.preventDefault(); zoomPane(h.p, clamp(1 + e.delta * 0.012, 0.9, 1.1)); });
    }
    if (!curveEl) {
      curveEl = document.createElementNS(X, "div");
      curveEl.id = "ad-room-curves";
      worldEl = document.createElementNS(X, "div");
      worldEl.id = "ad-room-world";
      curveEl.append(worldEl);
      gBrowser.tabpanels.parentNode.insertBefore(curveEl, gBrowser.tabpanels.nextSibling);
    }
    const strips = (n) => {
      const list = [], ctx = [];
      for (let i = 0; i < n; i++) {
        const c = document.createElementNS(X, "canvas");
        c.className = "ad-curve-strip";
        c.width = 8; c.height = 8;
        c.style.display = "none";
        worldEl.append(c);
        list.push(c);
        ctx.push(c.getContext("2d"));
      }
      return [list, ctx];
    };
    for (const p of panes) {
      if (p.curve) continue;
      [p.curve, p.ctx] = strips(CURVE_N);
      // While the view moves, a few wide strips stand in for the eighteen narrow ones (fewer layers to composite per frame).
      const n = clamp(tune("movingStrips", 6), 2, CURVE_N);
      if (n < CURVE_N) [p.coarse, p.cctx] = strips(n);
    }
  }
  const stripsOf = (p) => [...(p.curve || []), ...(p.coarse || [])];

  // --- looking around (free, no snapping) ---
  function startLook(e) {
    if (e.button !== 0) return;
    look.on = true; look.x = e.clientX; look.y = e.clientY; look.yaw = cam.yaw; look.pitch = cam.pitch;
    cam.target = null;
    window.addEventListener("mousemove", onLookMove, true);
    window.addEventListener("mouseup", onLookEnd, true);
    e.preventDefault();
  }
  function onLookMove(e) {
    if (!look.on) return;
    cam.yaw = turn(look.yaw - (e.clientX - look.x) * 0.0042);
    cam.pitch = clamp(look.pitch + (e.clientY - look.y) * 0.003, -0.5, 0.5);
    apply();
    e.preventDefault();
  }
  function onLookEnd() {
    window.removeEventListener("mousemove", onLookMove, true);
    window.removeEventListener("mouseup", onLookEnd, true);
    look.on = false;
    apply(); // back to the fine strips, and the pane in front can come into focus
  }
  function onWheelRoom(e) {
    cam.target = null;
    cam.yaw = turn(cam.yaw + e.deltaX * 0.002);
    cam.pitch = clamp(cam.pitch - e.deltaY * 0.002, -0.5, 0.5);
    apply();
    e.preventDefault();
  }

  // --- passing the mouse to the real page underneath ---
  // A small window actor (AetherDeckInput) lives in every page; it replays the pointer into the page in the page's own
  // coordinates (windowUtils in the content process), so a bent pane is live and usable.
  try {
    window.ChromeUtils.registerWindowActor("AetherDeckInput", {
      parent: { esModuleURI: "chrome://browser/content/aetherdeck/AetherDeckInputParent.sys.mjs" },
      // Paints and media from every frame (a video is often in an iframe): the Pod redraws a pane's picture only when it changed.
      child: { esModuleURI: "chrome://browser/content/aetherdeck/AetherDeckInputChild.sys.mjs",
        events: { MozAfterPaint: {}, play: { capture: true }, playing: { capture: true }, pause: { capture: true }, ended: { capture: true }, emptied: { capture: true } },
        observers: ["mediakeys-request"] },
      allFrames: true,
      safeForUntrustedWebProcess: true,
      matches: ["*://*/*", "about:*", "file:///*"],
    });
  } catch (e) { if (!/already/i.test(String(e))) log("registering the input actor failed: " + e); }
  // The page bridge: AetherDeck's own pages (served from this computer) get window.aetherdeckRoom.
  try {
    window.ChromeUtils.registerWindowActor("AetherDeckBridge", {
      parent: { esModuleURI: "chrome://browser/content/aetherdeck/AetherDeckBridgeParent.sys.mjs" },
      child: { esModuleURI: "chrome://browser/content/aetherdeck/AetherDeckBridgeChild.sys.mjs", events: { DOMWindowCreated: {} } },
      allFrames: false,
      // Web pages run in "untrusted" content processes; without this the bridge never reached AetherDeck's own page. Safe:
      // the parent checks the requesting page's real origin (from the parent process) on every request.
      safeForUntrustedWebProcess: true,
      matches: ["http://127.0.0.1/*", "http://localhost/*"], // match patterns can't name a port: the child checks it
    });
  } catch (e) { if (!/already/i.test(String(e))) log("registering the bridge actor failed: " + e); }
  function panelOf2(p) { return document.getElementById(p.tab.linkedPanel); }
  // Where did the pointer land? A ray from the eye through the pointer, against each strip's plane (the strip transforms are
  // cached as matrices when the layout is applied). The nearest strip hit wins.
  function camMatrix(P) {
    return new window.DOMMatrix().translateSelf(0, 0, P - cam.back).rotateAxisAngleSelf(1, 0, 0, (cam.pitch * 180) / Math.PI).rotateAxisAngleSelf(0, 1, 0, (cam.yaw * 180) / Math.PI);
  }
  function pick(cx, cy, only) {
    if (!curveEl) return null;
    const r = curveEl.getBoundingClientRect();
    const sx = cx - (r.left + r.width / 2), sy = cy - (r.top + r.height / 2);
    const P = Number(curveEl.dataset.persp);
    const W = camMatrix(P);
    const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const E = [0, 0, P], d = [sx, sy, -P];
    let best = null;
    for (const p of panes) {
      if (only && p !== only) continue;
      if (!p.S || !p.bentNow) continue;
      if (Math.abs(turn(p.yaw + (p.off || 0) - cam.yaw)) > 2.2 && !only) continue;
      const g = paneGeom(p);
      for (let i = 0; i < CURVE_N; i++) {
        const M = W.multiply(p.S[i]);
        const tp = (x, y, z) => { const q = M.transformPoint(new window.DOMPoint(x, y, z, 1)); return [q.x, q.y, q.z]; };
        const O = tp(0, 0, 0), A = sub(tp(1, 0, 0), O), B = sub(tp(0, 1, 0), O);
        const n = cross(A, B);
        const den = dot(d, n);
        if (Math.abs(den) < 1e-9) continue;
        const t = dot(sub(O, E), n) / den;
        if (t <= 0) continue;
        const H = [E[0] + t * d[0], E[1] + t * d[1], E[2] + t * d[2]];
        const HO = sub(H, O);
        const lx = dot(HO, A) / dot(A, A), ly = dot(HO, B) / dot(B, B);
        if (Math.abs(lx) <= g.sw / 2 + 1.3 && Math.abs(ly) <= g.h / 2 && (!best || t < best.t)) best = { p, i, t, x: lx + g.sw / 2, y: ly + g.h / 2 };
      }
    }
    return best;
  }
  // A hit on the pane -> a point in the page's own coordinates.
  function pagePoint(hit) {
    const p = hit.p, g = paneGeom(p);
    const u = (hit.i * g.sw + hit.x) / g.sc, v = hit.y / g.sc; // 0..PW, 0..PH on the pane
    // The page's real viewport is a few pixels smaller than the pane; the picture is stretched over the pane, so scale back.
    const kx = (p.vw || PW) / PW, ky = (p.vh || PH) / PH;
    // ...and the page is laid out at its page zoom (the reading zoom), so its own pixels are bigger than the pane's.
    const z = p.tab.linkedBrowser?.fullZoom || 1;
    return { u: clamp((u * kx) / z, 0, (p.vw || PW) / z - 0.5), v: clamp((v * ky) / z, 0, (p.vh || PH) / z - 0.5) };
  }
  function actorOf(p) {
    try {
      const a = p.tab.linkedBrowser.browsingContext.currentWindowGlobal.getActor("AetherDeckInput");
      // Only plain keywords from the page; anything else (none, an image) would leave no visible pointer.
      a.onCursor = (c) => { if (dragEl) dragEl.style.cursor = /^[a-z-]{3,20}$/.test(c || "") && c !== "none" && c !== "auto" ? c : "default"; };
      return a;
    } catch (e) { if (!p.actorErr) { p.actorErr = true; log("getActor failed: " + String(e).slice(0, 200)); } return null; }
  }
  function sendMouse(p, type, pt, button, clicks) {
    const b = p.tab.linkedBrowser;
    // Firefox's own pages (Settings, Add-ons, the import window) run in this process, inside the Pod's tilted layer: hit-testing
    // a click maps it back through the tilt and misses. Flatten that page's layer for the instant of the event and deliver it
    // straight to its window. It's invisible either way (the pane on screen is a picture).
    if (b && !b.isRemoteBrowser && b.contentWindow) {
      const panel = document.getElementById(p.tab.linkedPanel);
      try {
        panel?.classList.add("ad-input"); panel?.getBoundingClientRect();
        b.contentWindow.synthesizeMouseEvent(type, pt.u, pt.v, { button: button || 0, clickCount: clicks || 0 }, { toWindow: true, isDOMEventSynthesized: true });
      } catch (e) { log("in-process click failed: " + e); }
      finally { panel?.classList.remove("ad-input"); }
      if (type === "mousemove") { const a = actorOf(p); if (a) try { a.sendAsyncMessage("mouse", { type, x: pt.u, y: pt.v, cursorOnly: true }); } catch (e) {} }
      return;
    }
    const a = actorOf(p);
    if (a) { try { a.sendAsyncMessage("mouse", { type, x: pt.u, y: pt.v, button: button || 0, clicks: clicks || 0 }); } catch (e) { log("send failed: " + String(e).slice(0, 200)); } }
  }
  function setActive(p) {
    activePane = p; lastTarget = p; syncSize();
    selectPane(p);
    try { p.tab.linkedBrowser.focus(); } catch (e) {}
  }
  function layerDown(e) {
    if (e.button !== 0) return;
    const hit = e.altKey ? null : pick(e.clientX, e.clientY);
    if (!hit) { startLook(e); return; }
    const p = hit.p;
    if (e.shiftKey) { startMovePane(e, p); return; }
    setActive(p);
    const pt = pagePoint(hit);
    press.on = true; press.pane = p; press.lx = pt.u; press.ly = pt.v;
    burst(900);
    sendMouse(p, "mousedown", pt, 0, Math.min(3, e.detail || 1));
    window.addEventListener("mouseup", onPressUp, true);
    e.preventDefault();
  }
  let lastHover = 0;
  function layerMove(e) {
    const now = Date.now();
    if (press.on) {
      const hit = pick(e.clientX, e.clientY, press.pane);
      if (hit) { const pt = pagePoint(hit); press.lx = pt.u; press.ly = pt.v; burst(500); sendMouse(press.pane, "mousemove", pt, 0, 0); }
      return;
    }
    if (now - lastHover < 40) return;
    lastHover = now;
    const hit = pick(e.clientX, e.clientY);
    if (!hit) { dragEl.style.cursor = "grab"; return; }
    if (activePane !== hit.p) { activePane = hit.p; lastTarget = hit.p; syncSize(); }
    burst(350);
    sendMouse(hit.p, "mousemove", pagePoint(hit), 0, 0);
  }
  function onPressUp(e) {
    window.removeEventListener("mouseup", onPressUp, true);
    if (!press.on) return;
    press.on = false;
    burst(500);
    sendMouse(press.pane, "mouseup", { u: press.lx, v: press.ly }, 0, Math.min(3, e.detail || 1));
  }
  function layerWheel(e) {
    const hit = pick(e.clientX, e.clientY);
    if (!hit) { onWheelRoom(e); return; }
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) { zoomPane(hit.p, Math.exp(-e.deltaY * 0.004)); return; }
    const pt = pagePoint(hit);
    burst(600);
    const a = actorOf(hit.p);
    if (a) a.sendAsyncMessage("wheel", { x: pt.u, y: pt.v, dx: e.deltaX, dy: e.deltaY, mode: e.deltaMode, shift: e.shiftKey });
  }

  // The pane the size controls act on: the one you last clicked, otherwise the one nearest the middle of your view.
  function nearestPane() {
    let best = null, bd = 9;
    for (const p of panes) { const d = Math.abs(turn(p.yaw + (p.off || 0) - cam.yaw)); if (d < bd) { bd = d; best = p; } }
    return best;
  }
  function targetPane() { return (activePane && panes.includes(activePane)) ? activePane : nearestPane(); }
  function syncSize() {
    const t = targetPane();
    if (!sizeRange || !t) return;
    const v = Math.round((t.scale || 1) * 100);
    if (Number(sizeRange.value) !== v) sizeRange.value = String(v);
    if (sizeLabel) sizeLabel.textContent = v + "%";
  }
  // --- zoom, move, fit ---
  function zoomPane(p, k) {
    if (!p) return;
    p.scale = clamp((p.scale || 1) * k, 0.4, 3.2);
    place();
    const i = panes.indexOf(p); if (i >= 0) lookAt(i);
    syncSize();
  }
  // The slider: resize live, keeping the pane in the middle of the view while its neighbours move aside.
  function setScale(p, v) {
    if (!p) return;
    p.scale = clamp(v, 0.4, 3.2);
    place();
    cam.target = null; cam.yaw = turn(p.yaw + (p.off || 0)); apply();
    if (sizeLabel) sizeLabel.textContent = Math.round(p.scale * 100) + "%";
  }
  const mv = { on: false, p: null, x: 0, y: 0, off: 0, voff: 0 };
  function startMovePane(e, p) {
    mv.on = true; mv.p = p; mv.x = e.clientX; mv.y = e.clientY; mv.off = p.off || 0; mv.voff = p.voff || 0;
    window.addEventListener("mousemove", onMoveMove, true);
    window.addEventListener("mouseup", onMoveUp, true);
    e.preventDefault();
  }
  function onMoveMove(e) {
    if (!mv.on) return;
    mv.p.off = mv.off + (e.clientX - mv.x) * 0.0042;
    mv.p.voff = mv.voff + (e.clientY - mv.y) * 1.2;
    layoutVer++;
    apply();
  }
  function onMoveUp() { window.removeEventListener("mousemove", onMoveMove, true); window.removeEventListener("mouseup", onMoveUp, true); mv.on = false; apply(); }
  let theaterOf = null, theaterPrev = 1;
  // Theater: one pane fills the view as a flat live page (the same path as the sharp front pane), the Pod stays around it,
  // every other pane goes cold (not drawn, not rendering, no pictures), widgets tuck away. F, the Fit button or a page's own
  // full screen starts it; F, Esc, the button or leaving the page's full screen ends it.
  let theaterFS = false, theaterPrevVoff = 0, fsAspect = 0;
  function theater(p, opts = {}) {
    p = p || targetPane() || panes[0];
    if (!p) return;
    if (theaterOf === p) { endTheater(); return; }
    if (theaterOf) endTheater(true);
    theaterOf = p; theaterPrev = p.scale || 1; theaterPrevVoff = p.voff || 0; theaterFS = !!opts.fs;
    document.documentElement.setAttribute("data-ad-theater", "true");
    if (!opts.fs) { fitBtn.textContent = "Exit"; fitBtn.title = "Back to the ring (F or Esc)"; }
    cam.back = 0; cam.fov = 1.3;
    // Fill the view, above the bar. Growing a pane can widen the ring (and so shrink every pane on screen): size it twice.
    const fill = () => {
      const H = window.innerHeight || 800, Wd = window.innerWidth || 1200, P = (H / 2) / Math.tan(cam.fov / 2);
      const k = Math.min((0.94 * Wd) / PW, (H - 96) / PH);
      p.scale = clamp((k * layout.radius) / P, 0.5, 8);
      p.voff = -40 * (layout.radius / P); // a little above the middle, clear of the bar
      place();
    };
    // A page's own full screen stays in its pane, same place and size (the video fills the pane); F / Fit fills the view.
    if (opts.fs) document.documentElement.setAttribute("data-ad-pane-fs", "true"); else { fill(); fill(); }
    cam.target = turn(p.yaw + (p.off || 0)); cam.tpitch = 0; kick(); apply();
    setTiers();
    placeFullscreen();
  }
  function endTheater(quiet) {
    const p = theaterOf;
    if (!p) return;
    theaterOf = null; theaterFS = false; fsAspect = 0;
    document.documentElement.removeAttribute("data-ad-theater"); document.documentElement.removeAttribute("data-ad-pane-fs");
    fitBtn.textContent = "Fit"; fitBtn.title = "Fill the view with this pane (F, Esc to go back)";
    if (document.fullscreenElement) try { document.exitFullscreen(); } catch (e) {}
    if (panes.includes(p)) { p.scale = theaterPrev; p.voff = theaterPrevVoff; }
    setTiers();
    if (quiet) return;
    place();
    const i = panes.indexOf(p); if (i >= 0) lookAt(i);
    updateWidgets();
  }
  // Where the pane sits on screen when it is the flat front pane: its size there and its offset from the middle.
  function screenBox(p) {
    const H = window.innerHeight || 800, Wd = window.innerWidth || 1200, P = (H / 2) / Math.tan(cam.fov / 2);
    const k = (P / layout.radius) * (p.scale || 1);
    const w = Math.round(PW * k), h = Math.round(PH * k), dy = Math.round((p.voff || 0) * (P / layout.radius));
    return { k, w, h, x: Math.round((Wd - w) / 2), y: Math.round((H - h) / 2 + dy), dy };
  }
  // A page in full screen is drawn in the Theater rectangle (see the agent sheet at the top).
  function placeFullscreen() {
    if (!theaterOf) return;
    const b = screenBox(theaterOf), st = document.documentElement.style;
    let { x, y, w, h } = b;
    if (theaterFS) { // the pane's own rectangle, trimmed to the video's shape, so the video fills it without black bars
      const a = fsAspect || 16 / 9;
      if (w / h > a) { const nw = Math.round(h * a); x += Math.round((w - nw) / 2); w = nw; } else { const nh = Math.round(w / a); y += Math.round((h - nh) / 2); h = nh; }
    }
    st.setProperty("--ad-fs-x", x + "px"); st.setProperty("--ad-fs-y", y + "px"); st.setProperty("--ad-fs-w", w + "px"); st.setProperty("--ad-fs-h", h + "px");
  }
  // Firefox only lets the selected tab's page go full screen, so the pane you use is the selected tab.
  let selecting = false;
  function selectPane(p) {
    if (!p || gBrowser.selectedTab === p.tab || document.fullscreenElement) return;
    selecting = true;
    try { gBrowser.selectedTab = p.tab; } catch (e) {} finally { selecting = false; }
  }
  // The other way round: when something else selects a pane's tab (Firefox opening Import in Settings, a link that
  // focuses its tab, a keyboard shortcut), the Pod turns to that pane, so the pane in front and the selected tab agree.
  gBrowser.tabContainer.addEventListener("TabSelect", () => {
    if (selecting || !document.body.classList.contains("ad-room") || theaterOf) return;
    const i = panes.findIndex((q) => q.tab === gBrowser.selectedTab);
    if (i >= 0 && panes[i] !== focused) window.setTimeout(() => { if (gBrowser.selectedTab === panes[i]?.tab) lookAt(i); }, 0);
  });
  // A page asked for full screen (Firefox has already put its <browser> in full screen, inside the window because of
  // full-screen-api.ignore-widgets, set while the Pod is open): make it the Theater pane. It leaving full screen ends it.
  document.addEventListener("fullscreenchange", () => {
    const el = document.fullscreenElement;
    if (cinemaOf) { // the page's full screen is the cinema screen
      if (el && el.localName === "browser") document.documentElement.setAttribute("data-ad-theater", "true"); else document.documentElement.removeAttribute("data-ad-theater");
      placeCinema(); return;
    }
    if (el && el.localName === "browser" && document.body.classList.contains("ad-room")) {
      const p = panes.find((q) => q.tab.linkedBrowser === el);
      if (!p) return;
      if (theaterOf !== p) theater(p, { fs: true }); else { theaterFS = true; document.documentElement.setAttribute("data-ad-pane-fs", "true"); placeFullscreen(); }
      try {
        p.tab.linkedBrowser.browsingContext.currentWindowGlobal.getActor("AetherDeckInput").sendQuery("videoAspect").then((a) => {
          if (theaterOf === p && a > 0.3 && a < 4) { fsAspect = a; placeFullscreen(); }
        }, () => {});
      } catch (e) {}
    } else if (!el && theaterFS) endTheater();
  });
  // ---- Cinema (prototype): one tab on a cinema screen. The Pod's 3D scene, bent panes, pictures and 360° photo are all
  // switched off; a still auditorium (CSS, drawn once) surrounds one flat live page; every other pane is cold. DRM video
  // (which can't be drawn into a bent pane's picture) plays here as on any normal tab.
  let cinemaOf = null, cinemaEl = null;
  function cinemaRect() {
    const W = window.innerWidth || 1200, H = window.innerHeight || 800;
    const w = Math.round(Math.min(W * 0.84, (H * 0.66 * 16) / 9)), h = Math.round((w * 9) / 16);
    return { x: Math.round((W - w) / 2), y: Math.round(H * 0.07), w, h };
  }
  function placeCinema() {
    if (!cinemaOf) return;
    const r = cinemaRect(), st = document.documentElement.style;
    for (const [k, v] of [["x", r.x], ["y", r.y], ["w", r.w], ["h", r.h]]) { st.setProperty("--ad-cin-" + k, v + "px"); st.setProperty("--ad-fs-" + k, v + "px"); }
    const b = cinemaOf.tab.linkedBrowser;
    const z = r.w / 1280; // lay the page out as a 1280-pixel-wide tab, scaled to the screen
    try { if (b && Math.abs(b.fullZoom - z) > 0.001) b.fullZoom = z; } catch (e) {}
  }
  function cinema(p) {
    if (!p || !document.body.classList.contains("ad-room")) return;
    if (theaterOf) endTheater(true);
    unfocus();
    if (p.asleep) wake(p);
    cinemaOf = p;
    if (!cinemaEl) { cinemaEl = document.createElementNS(X, "div"); cinemaEl.id = "ad-cinema"; gBrowser.tabpanels.parentNode.insertBefore(cinemaEl, gBrowser.tabpanels); }
    document.getElementById(p.tab.linkedPanel)?.classList.add("ad-cinema-screen");
    (p.curve || []).concat(p.coarse || []).forEach((c) => { c.style.visibility = "hidden"; });
    document.documentElement.setAttribute("data-ad-cinema", "true");
    cinemaBtn.textContent = "Leave cinema";
    selectPane(p);
    placeCinema();
    setTiers();
    try { p.tab.linkedBrowser.focus(); } catch (e) {}
  }
  function endCinema() {
    const p = cinemaOf;
    if (!p) return;
    cinemaOf = null;
    if (document.fullscreenElement) try { document.exitFullscreen(); } catch (e) {}
    document.documentElement.removeAttribute("data-ad-cinema"); document.documentElement.removeAttribute("data-ad-theater");
    document.getElementById(p.tab.linkedPanel)?.classList.remove("ad-cinema-screen");
    (p.curve || []).concat(p.coarse || []).forEach((c) => { c.style.visibility = ""; });
    cinemaBtn.textContent = "Cinema";
    try { p.tab.linkedBrowser.fullZoom = pageZoom(); } catch (e) {}
    setTiers();
    layoutVer++; apply();
    const i = panes.indexOf(p); if (i >= 0) lookAt(i);
  }
  // ---- When the Cinema is offered: a pane's page starts protected (DRM) media, or loads a known streaming service. The first
  // time for a site it asks, with one click to go ("Watch in Cinema"); "Remember for <site>" keeps the answer: always go
  // straight to the Cinema, or never ask. Kept in the pref aetherdeck.room.cinemaSites ({ host: "auto" | "never" }).
  const STREAMING = /(^|\.)(netflix\.com|primevideo\.com|disneyplus\.com|max\.com|hbomax\.com|hulu\.com|tv\.apple\.com|peacocktv\.com|paramountplus\.com|crunchyroll\.com)$/;
  const cinemaSites = () => { try { return JSON.parse(Services.prefs.getStringPref("aetherdeck.room.cinemaSites", "{}")) || {}; } catch (e) { return {}; } };
  const hostOf = (p) => { try { return new URL(tabUrl(p.tab)).hostname.replace(/^www\./, ""); } catch (e) { return ""; } };
  const isStreaming = (p) => { const h = hostOf(p); if (STREAMING.test(h)) return true; try { const u = new URL(tabUrl(p.tab)); return /(^|\.)amazon\./.test(u.hostname) && u.pathname.startsWith("/gp/video"); } catch (e) { return false; } };
  let askEl = null, askFor = null, askTimer = 0;
  function offerCinema(p, why) {
    if (!p || !document.body.classList.contains("ad-room") || cinemaOf === p) return;
    const host = hostOf(p), choice = cinemaSites()[host];
    if (choice === "never") return;
    if (choice === "auto") { cinema(p); return; }
    if (p.askedFor === tabUrl(p.tab) && why !== "protected") return; // once per page, unless protected media actually started
    p.askedFor = tabUrl(p.tab);
    askFor = p;
    if (!askEl) {
      askEl = document.createElementNS(X, "div"); askEl.id = "ad-cinema-ask"; askEl.setAttribute("role", "dialog");
      document.documentElement.append(askEl);
    }
    askEl.replaceChildren();
    const t = document.createElementNS(X, "div");
    const b = document.createElementNS(X, "b"); b.textContent = (p.tab.label || host).slice(0, 60);
    t.append(b, document.createTextNode(why === "protected"
      ? " plays protected video, which can't show on a bent pane. Watch it in the Cinema?"
      : " is a streaming service: its videos are protected and can't show on a bent pane. Watch it in the Cinema?"));
    const row = document.createElementNS(X, "div"); row.className = "row";
    const go = document.createElementNS(X, "button"); go.className = "go"; go.textContent = "Watch in Cinema";
    const no = document.createElementNS(X, "button"); no.textContent = "Not now";
    const lab = document.createElementNS(X, "label"); const cb = document.createElementNS(X, "input"); cb.type = "checkbox";
    lab.append(cb, document.createTextNode("Remember for " + (host || "this site")));
    const done = (answer) => {
      window.clearTimeout(askTimer); askEl.remove(); askEl = null;
      if (cb.checked && host) { const m = cinemaSites(); m[host] = answer ? "auto" : "never"; try { Services.prefs.setStringPref("aetherdeck.room.cinemaSites", JSON.stringify(m)); } catch (e) {} }
      if (answer && panes.includes(p)) cinema(p);
    };
    go.addEventListener("click", () => done(true)); no.addEventListener("click", () => done(false));
    row.append(go, no, lab);
    askEl.append(t, row);
    window.clearTimeout(askTimer); askTimer = window.setTimeout(() => { if (askEl && askFor === p) { askEl.remove(); askEl = null; } }, 60000);
  }
  gBrowser.tabpanels.addEventListener("AetherDeckPaneEME", (e) => { const p = paneOfBrowser(e.target); if (p) offerCinema(p, "protected"); }, true);
  let fsWarnDefault = null;
  function fullscreenStaysInWindow(on) {
    // Default branch: never saved to the profile, so a normal window's full screen is untouched after a restart.
    try { Services.prefs.getDefaultBranch("").setBoolPref("full-screen-api.ignore-widgets", on); } catch (e) { log("full-screen pref failed: " + e); }
    try {
      const d = Services.prefs.getDefaultBranch("");
      if (on && fsWarnDefault === null) { fsWarnDefault = d.getIntPref("full-screen-api.warning.timeout", 3000); d.setIntPref("full-screen-api.warning.timeout", 0); }
      if (!on && fsWarnDefault !== null) { d.setIntPref("full-screen-api.warning.timeout", fsWarnDefault); fsWarnDefault = null; }
    } catch (e) {}
  }

  // The glide: ease the camera to cam.target (and pitch) when asked to look at something.
  function frame(t) {
    raf = 0;
    if (!document.body.classList.contains("ad-room")) return;
    const dt = Math.min(0.05, ((t - lastFrame) / 1000) || 0.016);
    lastFrame = t;
    if (!look.on && cam.target !== null) {
      const d = turn(cam.target - cam.yaw), dp = cam.tpitch - cam.pitch;
      if (Math.abs(d) < 0.0008 && Math.abs(dp) < 0.0008) { cam.yaw = cam.target; cam.pitch = cam.tpitch; }
      else { const k = 1 - Math.exp(-9 * dt); cam.yaw = turn(cam.yaw + d * k); cam.pitch += dp * k; }
      // Ask for the next frame first, so this frame's apply() knows the view is still moving.
      if (Math.abs(turn(cam.target - cam.yaw)) > 0.0008 || Math.abs(cam.tpitch - cam.pitch) > 0.0008) raf = window.requestAnimationFrame(frame);
      apply();
      if (!raf) setTiers(); // came to rest: tiers follow the new view straight away
    }
  }
  function kick() { if (!raf) { lastFrame = window.performance.now(); raf = window.requestAnimationFrame(frame); } }

  // The camera is ONE transform on the world container; each strip only changes when the layout, size or position changes.
  // ---- Widgets: small panes of glass in front of the Pod (a clock, the tabs, the agents), kept off the critical path:
  // - a shelf on the left edge, closed by default (the "Widgets" tab or button opens it; Theater hides it);
  // - never in the middle of the view (a fixed safe zone the panes use), never on top of each other, on a 16 px grid;
  // - drag to move, pull the corner to resize, × to hide one, double-click to put one back, "Reset" puts them all back.
  // Their spots and sizes are kept in the pref aetherdeck.room.widgetLayout.
  const widgets = {};
  const WIDGET_IDS = [["clock", "Time"], ["tabs", "Tabs"], ["crew", "Agents"]];
  let agentCount = null, agentsAt = 0, widgetLayer = null;
  const defaultSpot = (i) => ({ x: 32, y: 16 + i * 96, w: 174, h: 82, hidden: false }); // a column down the left edge, clear of the shelf tab
  const GRID = 16;
  const safeZone = () => { const W = window.innerWidth, H = window.innerHeight; return { l: W * 0.22, r: W * 0.78, t: H * 0.1, b: H * 0.82 }; };
  // Where a widget may sit: on the grid, on screen above the bar, outside the safe zone, not on another widget.
  function fitSpot(id, sp) {
    const W = window.innerWidth, H = window.innerHeight, z = safeZone();
    // A widget is never wider than the band beside the safe zone, so it always fits there.
    const w = Math.min(sp.w, W - 16, Math.max(130, Math.floor(z.l - 40))), h = Math.min(sp.h, H - 110);
    let x = clamp(Math.round(sp.x / GRID) * GRID, 32, Math.max(32, W - w - 8)), y = clamp(Math.round(sp.y / GRID) * GRID, 8, Math.max(8, H - h - 96));
    const inZone = (ax, ay) => ax < z.r && ax + w > z.l && ay < z.b && ay + h > z.t;
    if (inZone(x, y)) {
      const fits = (o) => o.x >= 32 && o.x + w <= W - 8 && o.y >= 8 && o.y + h <= H - 96;
      const opts = [{ x: Math.floor((z.l - w - 8) / GRID) * GRID, y }, { x: Math.ceil((z.r + 8) / GRID) * GRID, y }, { x, y: Math.floor((z.t - h - 8) / GRID) * GRID }, { x, y: Math.ceil((z.b + 8) / GRID) * GRID }].filter(fits);
      opts.sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y));
      if (opts[0]) ({ x, y } = opts[0]);
    }
    const others = Object.entries(widgets).filter(([k, el]) => k !== id && el.style.display !== "none").map(([, el]) => ({ x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight }));
    const hits = (ax, ay) => others.some((o) => ax < o.x + o.w + 8 && ax + w + 8 > o.x && ay < o.y + o.h + 8 && ay + h + 8 > o.y);
    const x0 = x, y0 = y;
    let free = !(hits(x, y) || inZone(x, y));
    for (let guard = 0; guard < 400 && !free; guard++) {
      y += GRID; // down the column, then the next column (left of the zone first, then right of it)
      if (y + h > H - 96) { y = 8; x += GRID * 12; if (x + w > W - 8) break; }
      free = !(hits(x, y) || inZone(x, y));
    }
    if (!free) { x = x0; y = y0; } // the screen is full: overlapping beats falling off it
    return { ...sp, x, y, w, h };
  }
  let widgetLayout = {};
  try { widgetLayout = JSON.parse(Services.prefs.getStringPref("aetherdeck.room.widgetLayout", "{}")) || {}; } catch (e) { widgetLayout = {}; }
  const saveLayout = () => { try { Services.prefs.setStringPref("aetherdeck.room.widgetLayout", JSON.stringify(widgetLayout)); } catch (e) {} };
  function spotOf(id) { const i = WIDGET_IDS.findIndex(([w]) => w === id); return { ...(id.startsWith("aw-") ? { x: 16, y: 110, w: 220, h: 150, hidden: false } : defaultSpot(i)), ...(widgetLayout[id] || {}) }; }
  function placeWidget(el, id) {
    const sp = fitSpot(id, spotOf(id));
    el.style.width = sp.w + "px"; el.style.height = sp.h + "px";
    el.style.left = sp.x + "px"; el.style.top = sp.y + "px";
  }
  function widgetEl(id, key) {
    if (widgets[id]) return widgets[id];
    if (!widgetLayer) { widgetLayer = document.createElementNS(X, "div"); widgetLayer.id = "ad-widgets"; document.documentElement.appendChild(widgetLayer); }
    const el = document.createElementNS(X, "div");
    el.className = "ad-widget";
    for (const c of ["k", "v", "s"]) { const d = document.createElementNS(X, "div"); d.className = c; el.append(d); }
    const xb = document.createElementNS(X, "button");
    xb.className = "x"; xb.textContent = "×"; xb.title = "Hide this widget (the Widgets button brings it back)";
    el.append(xb);
    el.querySelector(".k").textContent = key;
    el.querySelector(".x").addEventListener("click", (e) => { e.stopPropagation(); widgetLayout[id] = { ...spotOf(id), hidden: true }; saveLayout(); updateWidgets(); });
    el.addEventListener("dblclick", () => { const hidden = spotOf(id).hidden; widgetLayout[id] = { ...defaultSpot(WIDGET_IDS.findIndex(([w]) => w === id)), hidden }; saveLayout(); placeWidget(el, id); });
    // Move: drag from anywhere but the resize corner.
    el.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || e.target.classList.contains("x")) return;
      const r = el.getBoundingClientRect();
      if (e.clientX > r.right - 18 && e.clientY > r.bottom - 18) return; // the resize corner
      e.preventDefault(); e.stopPropagation();
      const dx = e.clientX - r.left, dy = e.clientY - r.top;
      el.classList.add("dragging"); el.setPointerCapture(e.pointerId);
      const move = (ev) => { el.style.left = ev.clientX - dx + "px"; el.style.top = ev.clientY - dy + "px"; };
      const up = () => {
        el.classList.remove("dragging"); el.removeEventListener("pointermove", move); el.removeEventListener("pointerup", up);
        widgetLayout[id] = fitSpot(id, { ...spotOf(id), x: el.offsetLeft, y: el.offsetTop }); saveLayout(); placeWidget(el, id);
      };
      el.addEventListener("pointermove", move); el.addEventListener("pointerup", up);
    });
    // Resize: the CSS corner handle; remember the size once it settles.
    let rt = 0;
    new window.ResizeObserver(() => { window.clearTimeout(rt); rt = window.setTimeout(() => { if (el.style.display === "none" || !el.getClientRects().length || !el.offsetWidth) return; const w = el.offsetWidth, h = el.offsetHeight, sp = spotOf(id); if (Math.abs(w - sp.w) > 2 || Math.abs(h - sp.h) > 2) { widgetLayout[id] = fitSpot(id, { ...sp, x: el.offsetLeft, y: el.offsetTop, w, h }); saveLayout(); placeWidget(el, id); } }, 400); }).observe(el);
    el.addEventListener("wheel", (e) => e.stopPropagation(), { passive: true });
    widgetLayer.append(el);
    placeWidget(el, id);
    return (widgets[id] = el);
  }
  // The shelf: a tab on the left edge that opens and closes the widgets, with "Reset" while open.
  const shelf = document.createElementNS(X, "div");
  shelf.id = "ad-shelf";
  const shelfBtn = document.createElementNS(X, "button");
  shelfBtn.title = "Open or close the widget shelf";
  shelfBtn.addEventListener("click", () => setShelf(!widgetsOn));
  const resetBtn = document.createElementNS(X, "button");
  resetBtn.className = "reset"; resetBtn.textContent = "Reset"; resetBtn.title = "Put every widget back in its place (hidden ones too)";
  resetBtn.addEventListener("click", () => { widgetLayout = {}; saveLayout(); reflowWidgets(); });
  shelf.append(shelfBtn, resetBtn);
  document.documentElement.append(shelf);
  shelf.classList.toggle("open", widgetsOn);
  shelfBtn.textContent = widgetsOn ? "‹ Widgets" : "Widgets ›";
  function setShelf(on) {
    widgetsOn = on;
    try { Services.prefs.setBoolPref("aetherdeck.room.widgetShelfOpen", on); } catch (e) {}
    widgetsBtn.style.opacity = on ? "1" : ".55";
    shelf.classList.toggle("open", on);
    shelfBtn.textContent = on ? "‹ Widgets" : "Widgets ›";
    reflowWidgets();
  }
  // Lay every shown widget out again, one after another, so each one fits around those already placed.
  function reflowWidgets() {
    updateWidgets();
    const shown = WIDGET_IDS.map(([id]) => id).filter((id) => widgets[id] && widgets[id].style.display !== "none");
    const disp = shown.map((id) => widgets[id].style.display);
    for (const id of shown) widgets[id].style.display = "none";
    shown.forEach((id, i) => { widgets[id].style.display = disp[i]; placeWidget(widgets[id], id); });
  }
  const setWidget = (el, v, sub) => { const a = el.querySelector(".v"), b = el.querySelector(".s"); if (a.textContent !== v) a.textContent = v; if (b.textContent !== sub) b.textContent = sub; };
  window.addEventListener("resize", () => reflowWidgets());

  // ---- Widgets agents make (the pod_widget tool): each runs its own HTML in a sandboxed page of its own, with an opaque
  // origin (no cookies or storage, not AetherDeck's page, so no bridge), no network (strict CSP), and no popups, navigation,
  // forms, downloads or dialogs. Scripts may run inside it. Moved, resized and hidden like the others; </> shows its code,
  // × deletes it. Kept in widgets.json in this profile's AetherDeck data.
  let agentWidgets = [];
  const AW_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; media-src data:";
  const SANDBOX = 0xfffff & ~0x80; // every sandbox flag but "no scripts"
  async function loadAgentWidgets() { agentWidgets = (await readData("widgets", [])).filter((w) => w && typeof w.id === "string"); drawAgentWidgets(); }
  function widgetDoc(w) { return `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${AW_CSP}"><style>html,body{margin:0;font:13px system-ui}</style>${w.html}`; }
  function drawAgentWidgets() {
    if (!widgetLayer) widgetEl("clock", "Time"); // makes the layer
    const ids = new Set(agentWidgets.map((w) => "aw-" + w.id));
    for (const k of Object.keys(widgets)) if (k.startsWith("aw-") && !ids.has(k)) { widgets[k].remove(); delete widgets[k]; }
    agentWidgets.forEach((w, i) => {
      const id = "aw-" + w.id;
      if (!WIDGET_IDS.some(([x]) => x === id)) WIDGET_IDS.push([id, w.title]);
      if (!widgetLayout[id]) widgetLayout[id] = { x: 32, y: 16, w: w.w || 220, h: w.h || 150, hidden: false };
      let el = widgets[id];
      if (el && el.dataset.ver === String(w.updated)) return;
      if (el) { el.remove(); delete widgets[id]; }
      el = document.createElementNS(X, "div");
      el.className = "ad-widget agent"; el.dataset.ver = String(w.updated);
      const bar = document.createElementNS(X, "div"); bar.className = "bar";
      const t = document.createElementNS(X, "b"); t.textContent = w.title; t.title = `Made by ${w.agent || "an agent"}. Runs sandboxed: no access to your pages, cookies, files or the internet.`;
      const code = document.createElementNS(X, "button"); code.textContent = "</>"; code.title = "Show what this widget runs";
      bar.append(t, code);
      const xb = document.createElementNS(X, "button"); xb.className = "x"; xb.textContent = "×"; xb.title = "Delete this widget";
      xb.addEventListener("click", (e) => {
        e.stopPropagation();
        if (!Services.prompt.confirm(window, "Delete widget", `Delete “${w.title}”, made by ${w.agent || "an agent"}?`)) return;
        agentWidgets = agentWidgets.filter((x) => x.id !== w.id); void writeData("widgets", agentWidgets); delete widgetLayout[id]; saveLayout(); drawAgentWidgets();
      });
      const view = document.createXULElement("browser");
      for (const [k, v] of [["type", "content"], ["remote", "true"], ["maychangeremoteness", "true"], ["disableglobalhistory", "true"], ["messagemanagergroup", "aetherdeck-widget"]]) view.setAttribute(k, v);
      el.append(bar, view, xb);
      code.addEventListener("click", (e) => {
        e.stopPropagation();
        const pre = el.querySelector("pre");
        if (pre) { pre.remove(); view.hidden = false; return; }
        const p2 = document.createElementNS(X, "pre"); p2.textContent = w.html; view.hidden = true; el.insertBefore(p2, xb);
      });
      // Move by the title bar (the page inside takes its own clicks).
      bar.addEventListener("pointerdown", (e) => {
        if (e.button !== 0 || e.target === code) return;
        e.preventDefault(); e.stopPropagation();
        const r = el.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
        el.classList.add("dragging"); bar.setPointerCapture(e.pointerId);
        const move = (ev) => { el.style.left = ev.clientX - dx + "px"; el.style.top = ev.clientY - dy + "px"; };
        const up = () => { el.classList.remove("dragging"); bar.removeEventListener("pointermove", move); bar.removeEventListener("pointerup", up); widgetLayout[id] = fitSpot(id, { ...spotOf(id), x: el.offsetLeft, y: el.offsetTop }); saveLayout(); placeWidget(el, id); };
        bar.addEventListener("pointermove", move); bar.addEventListener("pointerup", up);
      });
      let rt = 0;
      new window.ResizeObserver(() => { window.clearTimeout(rt); rt = window.setTimeout(() => { const sp = spotOf(id); if (el.style.display !== "none" && el.getClientRects().length && el.offsetWidth && (Math.abs(el.offsetWidth - sp.w) > 2 || Math.abs(el.offsetHeight - sp.h) > 2)) { widgetLayout[id] = fitSpot(id, { ...sp, x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight }); saveLayout(); placeWidget(el, id); } }, 400); }).observe(el);
      widgetLayer.append(el);
      widgets[id] = el;
      placeWidget(el, id);
      window.setTimeout(() => {
        try {
          view.browsingContext.sandboxFlags = SANDBOX;
          // Started by the browser itself (Firefox refuses top-level data: pages started by anyone else); the page still gets
          // an opaque origin of its own (checked: documentPrincipal.isNullPrincipal) and the sandbox flags above.
          view.loadURI(Services.io.newURI("data:text/html;charset=utf-8," + encodeURIComponent(widgetDoc(w))), { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });
        } catch (e) { log("agent widget failed: " + e); }
      }, 0);
    });
    updateWidgets();
  }
  function updateWidgets() {
    const show = widgetsOn && document.body.classList.contains("ad-room") && panes.length > 0;
    const els = WIDGET_IDS.map(([id, key]) => (id.startsWith("aw-") ? widgets[id] : widgetEl(id, key)));
    WIDGET_IDS.forEach(([id], i) => { if (els[i]) els[i].style.display = show && !spotOf(id).hidden ? (id.startsWith("aw-") ? "flex" : "block") : "none"; });
    if (!show) return;
    const [clock, tabs, crew] = els;
    const now = new Date();
    setWidget(clock, now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }), now.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" }));
    const live = panes.filter((p) => !p.asleep).length;
    setWidget(tabs, String(panes.length), live + " live, " + (panes.length - live) + " asleep");
    if (Date.now() - agentsAt > 15000) {
      agentsAt = Date.now();
      window.IOUtils.readUTF8(dataFile("agents")).then((t) => { try { agentCount = JSON.parse(t).length; } catch (e) { agentCount = 0; } }, () => { agentCount = 0; });
    }
    setWidget(crew, agentCount === null ? "-" : String(agentCount), agentCount === 1 ? "agent on the crew" : "agents on the crew");
  }

  function applyCurves(P) {
    if (!curveEl) return;
    if (curveEl.dataset.persp !== String(P)) { curveEl.dataset.persp = String(P); curveEl.style.perspective = P + "px"; }
    worldEl.style.transform = `translateZ(${P - cam.back}px) rotateX(${cam.pitch}rad) rotateY(${cam.yaw}rad)`;
    for (const p of panes) {
      const el = panelOf2(p);
      const bent = CURVE_ON && !!p.hasSnap && !p.asleep;
      if (p.bentNow !== bent) { p.bentNow = bent; p.geomVer = -1; el?.classList.toggle("ad-side", CURVE_ON && !!p.hasSnap); }
      const coarse = bent && !!p.coarse && p.coarseReady && moving() && tune("movingStrips", 6) < CURVE_N;
      if (p.coarseNow !== coarse) { p.coarseNow = coarse; p.geomVer = -1; }
      if (p.geomVer === layoutVer) continue;
      p.geomVer = layoutVer;
      const g = paneGeom(p);
      // How bent a pane is does not depend on its size: the whole pane bends through the same angle (0 to about 52 degrees),
      // with its middle on the ring. Zooming a pane makes it bigger, not more curved.
      const bend = (curveAmount / 100) * 0.9;
      const Rb = bend < 0.02 ? 1e9 : (PW * g.sc) / bend;
      const base = p.yaw + (p.off || 0);
      const lay = (list, n, show, keep) => (list || []).forEach((strip, i) => {
        strip.style.display = show ? "block" : "none";
        if (!show && !keep) return;
        const sw = (PW * g.sc) / n;
        strip.style.width = sw + 2.6 + "px";
        strip.style.height = g.h + "px";
        strip.style.margin = `${-g.h / 2}px 0 0 ${-sw / 2}px`;
        const x = (i - (n - 1) / 2) * sw;
        const th = Math.asin(clamp(x / Rb, -0.99, 0.99));
        const d = Rb - Math.sqrt(Math.max(0, Rb * Rb - x * x));
        strip.style.transform = `rotateY(${-base}rad) translateY(${p.voff || 0}px) translateZ(${-layout.radius}px) translateX(${x}px) translateZ(${d}px) rotateY(${-th}rad)`;
        if (n !== CURVE_N) return;
        const deg = (a) => (a * 180) / Math.PI;
        (p.S || (p.S = []))[i] = new window.DOMMatrix().rotateAxisAngleSelf(0, 1, 0, deg(-base)).translateSelf(0, p.voff || 0, 0).translateSelf(0, 0, -layout.radius).translateSelf(x, 0, 0).translateSelf(0, 0, d).rotateAxisAngleSelf(0, 1, 0, deg(-th));
      });
      // The fine strips keep their geometry while hidden (hit-testing uses it).
      lay(p.curve, CURVE_N, bent && !coarse, bent);
      if (p.coarse) lay(p.coarse, p.coarse.length, coarse, false);
    }
    if (widgetVer !== layoutVer) { widgetVer = layoutVer; updateWidgets(); } // shows or hides them with the Pod
  }

  // Pictures of the pages: redrawn only when the page changed (its frames report paints) or plays media, at a modest rate for
  // panes beside you, never for panes behind you or while the view turns (the last pictures are shown).
  let snapRunning = false, snapMode, burstUntil = 0;
  // Tunables (hidden prefs aetherdeck.room.perf.*), read live: the performance governor and measurements change them.
  const tune = (n, d) => { try { return Services.prefs.getIntPref("aetherdeck.room.perf." + n, d); } catch (e) { return d; } };
  const moving = () => !!(raf || look.on || mv.on);
  // Reading zoom: a pane is shown at about 40% of a normal tab's size (8 panes round the ring), which made text tiny and the
  // text caret thinner than a pixel. Pages in panes are laid out a little narrower and bigger (125% by default), so text
  // and the caret are 25% larger in every pane, live or bent. Back to 100% when you leave the Pod.
  const pageZoom = () => clamp(tune("pageZoom", 125), 50, 300) / 100;
  function applyPageZoom() {
    const z = pageZoom();
    for (const p of panes) {
      if (p.asleep || p === focused || p === cinemaOf) continue; // those two have their own zoom
      const b = p.tab.linkedBrowser;
      try { if (b && Math.abs((b.fullZoom || 1) - z) > 0.001) b.fullZoom = z; } catch (e) {}
    }
  }
  const paneOfBrowser = (b) => panes.find((p) => p.tab.linkedBrowser === b);
  gBrowser.tabpanels.addEventListener("AetherDeckPaneChanged", (e) => { const p = paneOfBrowser(e.target); if (p) p.dirty = true; }, true);
  gBrowser.tabpanels.addEventListener("AetherDeckPaneMedia", (e) => {
    const p = paneOfBrowser(e.target);
    if (!p) return;
    p.media ??= new Set();
    if (e.detail?.media) p.media.add(e.detail.frame); else p.media.delete(e.detail?.frame);
    setTiers();
  }, true);
  const playing = (p) => !!p.media && p.media.size > 0;
  // A page that navigates away takes its media with it.
  try {
    gBrowser.addTabsProgressListener({
      onLocationChange(b, wp, req, loc, flags) {
        if (!wp?.isTopLevel || (flags & Ci.nsIWebProgressListener.LOCATION_CHANGE_SAME_DOCUMENT)) return;
        const p = paneOfBrowser(b);
        if (p) { p.media?.clear(); p.dirty = true; window.setTimeout(() => { if (panes.includes(p) && isStreaming(p)) offerCinema(p, "streaming"); }, 1500); }
      },
    });
  } catch (e) { log("progress listener failed: " + e); }
  function burst(ms) { burstUntil = Math.max(burstUntil, Date.now() + ms); }
  // Pixels per CSS pixel to capture a pane at: the screen's density for the pane you're using (2 on Retina, more when it is
  // zoomed bigger, at most 3), and a little less for the others, which redraw more often than you look at them.
  // Pixels per page pixel to draw a pane's picture at: what the pane really takes on screen (device pixels per CSS pixel of
  // the page when it faces you: the screen's density times how big the ring shows it), so text in a bent pane is as sharp
  // as the screen allows. The pane you point at gets all of it; the others a little less (they are seen at an angle).
  function sharpness(p) {
    const dpr = window.devicePixelRatio || 1;
    const H = window.innerHeight || 800, P = (H / 2) / Math.tan(cam.fov / 2);
    const onScreen = dpr * (P / layout.radius) * (p.scale || 1) * pageZoom(); // device pixels per page pixel
    if (raf || look.on) return 1;
    if (p === activePane) return clamp(onScreen, 1, 2);
    const side = tune("sideScale", 0); // 0: automatic
    return side ? side / 100 : clamp(onScreen * 0.9, 0.75, 1.6);
  }
  async function snapPane(p, scale) {
    const b = p.tab.linkedBrowser;
    if (!b || typeof b.drawSnapshot !== "function") return;
    const r = b.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
    p.vw = b.clientWidth || PW; p.vh = b.clientHeight || PH; // layout size (getBoundingClientRect would be the transformed box)
    let bmp = null;
    const t0 = window.performance.now();
    // The whole visible page (fullViewport), scaled: with an explicit rectangle the scale changes what part is captured.
    try { bmp = await b.drawSnapshot(0, 0, 0, 0, scale, "white", true); } catch (e) { /* not painted yet */ }
    const t1 = window.performance.now();
    if (!bmp) return;
    const cut = (list, ctx) => {
      const n = list.length, sw = bmp.width / n, cw = Math.max(1, Math.ceil(sw));
      for (let i = 0; i < n; i++) {
        const c = list[i];
        if (c.width !== cw || c.height !== bmp.height) { c.width = cw; c.height = bmp.height; }
        ctx[i].drawImage(bmp, i * sw, 0, sw, bmp.height, 0, 0, cw, bmp.height);
      }
    };
    cut(p.curve, p.ctx);
    if (p.coarse) { cut(p.coarse, p.cctx); p.coarseReady = true; }
    if (bmp.close) bmp.close();
    if (!p.hasSnap) { p.hasSnap = true; apply(); }
    // What the pictures cost (read by the performance governor and by measurements: window.adRoomTabs.perf).
    const t2 = window.performance.now();
    stats.snaps++; perf.snaps++; perf.snapMs += t1 - t0; perf.drawMs += t2 - t1;
    const pp = perf.perPane[p.tab.label.slice(0, 20)] ??= { n: 0, ms: 0 }; pp.n++; pp.ms += t2 - t0;
    p.lastSnapMs = t2 - t0; p.snapScale = scale;
  }
  async function snapLoop() {
    if (snapRunning) return;
    snapRunning = true;
    try {
      while (document.body.classList.contains("ad-room") && CURVE_ON) {
        ensureLayers();
        const now = Date.now();
        // While you are pointing, clicking or scrolling in a pane, redraw that pane as fast as possible (nothing else), so
        // what you see keeps up with what you do.
        if (now < burstUntil && activePane && activePane.curve && !activePane.asleep && activePane !== focused) {
          try { await snapPane(activePane, sharpness(activePane)); } catch (e) {}
          await new Promise((r) => window.setTimeout(r, 0));
          continue;
        }
        // While the view turns, the last pictures are shown (redrawing them is what made turning slow).
        const changeDriven = tune("changeDriven", 1), sideMs = tune("sideMs", 250);
        if (!moving() || tune("snapWhileTurning", 0)) for (const p of panes) {
          if (p.asleep || !p.curve || p === focused) continue; // the focused pane is live on screen, no picture needed
          if (theaterOf && p !== theaterOf) continue; // Theater: the others are cold
          if (cinemaOf) continue; // the cinema screen is live; nothing else is drawn
          const inView = Math.abs(turn(p.yaw + (p.off || 0) - cam.yaw)) < 1.5;
          if (!inView && p.hasSnap) continue; // behind you: its last picture waits until you turn back
          // A sharper picture is wanted than the one shown (you pointed at a side pane): draw it again, changed or not.
          if (p.hasSnap && !p.dirty && sharpness(p) > (p.snapScale || 0) + 0.05) p.dirty = true;
          if (changeDriven && p.hasSnap && !p.dirty && !playing(p)) continue; // nothing new on the page
          const every = p === activePane ? 33 : sideMs;
          if (p.lastSnap && now - p.lastSnap < every) continue;
          p.lastSnap = now; p.dirty = false;
          try { await snapPane(p, sharpness(p)); } catch (e) { if (!p.snapErr) { p.snapErr = true; log("snapshot failed: " + String(e).slice(0, 120)); } }
        }
        if (DEBUG && now - stats.t0 > 6000) { log("snapshots per second: " + Math.round((stats.snaps * 1000) / (now - stats.t0))); stats.snaps = 0; stats.t0 = now; }
        // A window you can't see (minimized, or another app's full screen in front) needs no fresh pictures.
        await new Promise((r) => window.setTimeout(r, document.hidden || window.windowState === window.STATE_MINIMIZED ? 500 : SNAP_FPS_MS));
      }
    } finally { snapRunning = false; }
  }

  // ---- The front pane, sharp: when the view comes to rest facing a pane, that pane shows its live page flat, sized to the
  // exact space it takes on screen, with the page zoom raised by the same factor (so its layout doesn't change) - which is
  // what a normal tab is. Native scrolling, selection and the pointer work on it. Turning puts the bent picture back.
  let focused = null, settleTimer = 0;
  const FOCUS_SNAP = 0.2; // within this angle of a pane, the view eases onto it when you stop
  function canFocus() { return CURVE_ON && !look.on && !press.on && cam.back === 0 && Math.abs(cam.pitch) < 0.03 && Math.abs(cam.fov - 1.3) < 0.01 && document.body.classList.contains("ad-room"); }
  function nearestFacing() { let best = null, bd = 9; for (const p of panes) { const d = Math.abs(turn(p.yaw + (p.off || 0) - cam.yaw)); if (d < bd) { bd = d; best = p; } } return best ? { p: best, d: bd } : null; }
  function unfocus() {
    if (!focused) return;
    const p = focused; focused = null;
    document.body.classList.remove("ad-focusing");
    const el = document.getElementById(p.tab.linkedPanel);
    if (el) { el.classList.remove("ad-focus"); for (const k of ["width", "height", "margin"]) el.style.removeProperty(k); }
    const b = p.tab.linkedBrowser;
    try { if (b && p.zoomBefore) b.fullZoom = p.zoomBefore; } catch (e) {}
    (p.curve || []).forEach((c) => { c.style.visibility = ""; });
    notifyHome();
  }
  function focusPane(p) {
    if (focused === p) return;
    unfocus();
    const b = p.tab.linkedBrowser, el = document.getElementById(p.tab.linkedPanel);
    if (!b || !el || p.asleep) return;
    const H = window.innerHeight || 800, P = (H / 2) / Math.tan(cam.fov / 2);
    const k = (P / layout.radius) * (p.scale || 1); // how big the pane looks on screen, per CSS pixel of the page
    const W = Math.round(PW * k), Hh = Math.round(PH * k);
    p.zoomBefore = pageZoom();
    el.style.setProperty("width", W + "px", "important"); el.style.setProperty("height", Hh + "px", "important");
    el.style.setProperty("margin", `${Math.round(-Hh / 2 + (p.voff || 0) * (P / layout.radius))}px 0 0 ${Math.round(-W / 2)}px`, "important");
    p.focusZoom = p.zoomBefore * k;
    const zoomIt = () => { try { if (focused === p && Math.abs(b.fullZoom - p.focusZoom) > 0.001) b.fullZoom = p.focusZoom; } catch (e) {} };
    zoomIt(); window.setTimeout(zoomIt, 80); window.setTimeout(zoomIt, 400); // Firefox's site zoom can reset it right after
    el.classList.add("ad-focus");
    document.body.classList.add("ad-focusing");
    (p.curve || []).forEach((c) => { c.style.visibility = "hidden"; });
    focused = p;
    if (b.docShellIsActive === false) b.docShellIsActive = true;
    selectPane(p);
    notifyHome();
    if (theaterOf === p) placeFullscreen();
  }
  function settle() {
    window.clearTimeout(settleTimer);
    settleTimer = window.setTimeout(() => {
      if (!canFocus() || raf) return;
      const n = nearestFacing();
      if (!n || n.p.asleep || !n.p.hasSnap) return;
      if (n.d < 0.004) { focusPane(n.p); return; }
      if (n.d < FOCUS_SNAP) { cam.target = turn(n.p.yaw + (n.p.off || 0)); cam.tpitch = 0; kick(); } // ease onto it; focuses when it stops
    }, 220);
  }

  function apply() {
    if (!document.body.classList.contains("ad-room")) return; // a stray resize after leaving must not put 3D transforms back
    if (cinemaOf) { placeCinema(); return; } // the cinema has no 3D scene to move
    if (focused && (Math.abs(turn(focused.yaw + (focused.off || 0) - cam.yaw)) > 0.004 || !canFocus())) unfocus();
    settle();
    if (Date.now() - tiersAt > 200) setTiers(); // panes coming into view warm up as you turn
    const H = window.innerHeight || 800;
    const P = (H / 2) / Math.tan(cam.fov / 2);
    const tp = panels();
    tp.style.perspective = P + "px";
    applyBg(P);
    ensureLayers();
    applyCurves(P);
    { const t = targetPane(); if (t !== lastTarget) { lastTarget = t; syncSize(); } }
    for (const p of panes) {
      if (p.hasSnap && CURVE_ON) continue; // bent pane: the real page stays where it is, invisible
      const el = document.getElementById(p.tab.linkedPanel);
      if (el) el.style.transform = `translateZ(${P - cam.back}px) rotateX(${cam.pitch}rad) rotateY(${cam.yaw - p.yaw}rad) translateZ(${-layout.radius}px)`;
    }
  }

  // Panes sit side by side on the cylinder, each as wide (as an angle) as its own size, with a gap between: zooming one pane
  // pushes its neighbours aside instead of overlapping them. If they no longer fit the circle, the circle grows.
  function place() {
    unfocus(); // sizes change: it refocuses at the new size once the view rests
    const R0 = PW / (2 * Math.tan(0.405)); // radius that makes a normal pane about 46 degrees wide
    const gap = 0.07;
    // Each pane's true half-width as an angle seen from the middle: a bent pane's edges curl towards you, so they reach a
    // little further round than its arc length (the pane in front, shown flat, reaches less far).
    const bend = (curveAmount / 100) * 0.9;
    const halfOf = (p, r) => {
      const sc = p.scale || 1, x = (sc * PW) / 2, Rb = bend < 0.02 ? 1e9 : (PW * sc) / bend;
      const d = Rb - Math.sqrt(Math.max(0, Rb * Rb - x * x));
      return Math.atan2(x, Math.max(1, r - d));
    };
    const totalAt = (r) => panes.reduce((t, p) => t + 2 * halfOf(p, r) + gap, 0);
    // Too many (or too big) panes for one turn: widen the ring until panes AND every gap fit exactly once round. (Scaling
    // only the panes left the gaps over, so the last pane overlapped the first.)
    let R = R0;
    for (let k = 0; k < 30 && totalAt(R) > TAU; k++) R *= Math.max(1.0005, (totalAt(R) - panes.length * gap) / (TAU - panes.length * gap));
    layout = { yaws: [], radius: R, step: 0 };
    const wOf = (p, r) => 2 * halfOf(p, r);
    let at = -wOf(panes[0] || { scale: 1 }, R) / 2; // pane 0 is centred on yaw 0
    panes.forEach((p, i) => {
      const w = wOf(p, R);
      p.yaw = turn(at + w / 2);
      layout.yaws.push(p.yaw);
      at += w + gap;
    });
    layoutVer++;
    apply();
  }

  const tabUrl = (t) => {
    // The page actually showing (the parent knows it at once; session data and currentURI can lag for background tabs).
    try { const u = t.linkedBrowser?.browsingContext?.currentWindowGlobal?.documentURI?.spec; if (u && u !== "about:blank") return u; } catch (e) {}
    try {
      const st = JSON.parse(window.SessionStore.getTabState(t));
      const e = st.entries?.[Math.max(0, (st.index || 1) - 1)];
      if (e?.url) return e.url;
    } catch (e) {}
    return t.linkedBrowser?.currentURI?.spec || "";
  };
  const blank = (u) => !u || u === "about:blank" || u === "about:newtab" || u === "about:home";
  // Every ordinary tab of the window belongs on the ring (tabs that came back late from session restore, or that the Room
  // missed for any reason), up to the cap.
  function adoptAll() {
    for (const t of gBrowser.tabs) {
      if (panes.length >= MAX_PANES) break;
      if (panes.some((p) => p.tab === t)) continue;
      const u = tabUrl(t);
      if (blank(u)) continue;
      panes.push({ tab: t, url: u, lastUrl: u, yaw: 0, outSince: null, asleep: false, born: Date.now() });
      log("adopted tab " + u);
    }
  }
  let enteredOnce = false;
  function enter() {
    ensureBg();
    try {
      adoptAll();
      // A split view left over from a restored session would fight the ring: clear it before the Room sets its own up.
      gBrowser.tabpanels.removeTabsFromSplitview([...gBrowser.tabs]);
      gBrowser.tabpanels.splitViewPanels = [];
    } catch (e) { log("enter cleanup failed: " + e); }
    document.body.classList.add("ad-room");
    fullscreenStaysInWindow(true);
    gBrowser.showSplitViewPanels(panes.map((p) => p.tab));
    for (const p of panes) {
      const el = document.getElementById(p.tab.linkedPanel);
      el?.classList.add("ad-room-pane");
      if (p.tab.linkedBrowser) { p.tab.linkedBrowser.docShellIsActive = true; p.tab.linkedBrowser.renderLayers = true; }
    }
    place();
    if (!enteredOnce) { enteredOnce = true; cam.yaw = panes[0] ? panes[0].yaw : 0; cam.pitch = 0; cam.target = null; }
    apply();
    hud.hidden = false;
    applyPageZoom();
    window.setTimeout(snapLoop, 300);
    notifyHome();
  }

  function leave() {
    if (cinemaOf) endCinema();
    endTheater(true);
    unfocus();
    fullscreenStaysInWindow(false);
    cam.target = null;
    // Hide the page area while the layout changes: WebRender panicked ("pictures caches don't support complex transforms") when
    // live pages were still on screen as the 3D transforms came off.
    panels().style.visibility = "hidden";
    // Two steps, one frame apart: first take the 3D transforms off while the Room's 3D context still exists (switching both off in
    // one go made WebRender panic and the GPU process crash), then drop the Room layout and Firefox's split view.
    for (const p of panes) { const el = document.getElementById(p.tab.linkedPanel); if (el) el.style.removeProperty("transform"); }
    panels().style.removeProperty("perspective");
    hud.hidden = true;
    window.setTimeout(() => {
      document.body.classList.remove("ad-room");
      for (const p of panes) document.getElementById(p.tab.linkedPanel)?.classList.remove("ad-room-pane");
      try {
        const tabs = panes.map((p) => p.tab);
        gBrowser.tabpanels.removeTabsFromSplitview(tabs);
        gBrowser.tabpanels.splitViewPanels = [];
        for (const t of tabs) {
          document.getElementById(t.linkedPanel)?.querySelectorAll("split-view-footer").forEach((f) => f.remove());
          const b = t.linkedBrowser;
          if (b && t !== gBrowser.selectedTab) b.docShellIsActive = false;
        }
      } catch (e) { log("leave cleanup failed: " + e); }
      window.setTimeout(() => { panels().style.removeProperty("visibility"); }, 200);
      notifyHome(); // outside the Pod the home is a normal tab: its Earth turns when you can see it
      for (const p of panes) { try { if (p.tab.linkedBrowser) p.tab.linkedBrowser.fullZoom = 1; } catch (e) {} } // ordinary tabs again
    }, 150);
  }

  // A link or window.open inside a pane opens an ordinary new tab in Firefox: adopt it as the next pane (this is what the
  // Chromium extension needed webNavigation for). Tabs that the Room itself made are already in `panes`.
  gBrowser.tabContainer.addEventListener("TabOpen", (e) => {
    // Outside the Pod too: a new tab (Cmd+T, a link, the address bar) belongs in the Pod, so it brings you back in.
    const tab = e.target;
    if (!enteredOnce || adding || panes.some((p) => p.tab === tab)) return; // before the first entry, start() gathers tabs itself
    if (panes.length >= MAX_PANES) { say("Your pod holds " + MAX_PANES + " panes: this tab is in More tabs, swap it in from there."); drawMore(); return; }
    panes.push({ tab, url: "", yaw: 0, outSince: null, asleep: false, born: Date.now() });
    window.setTimeout(() => { try { enter(); lookAt(panes.length - 1); } catch (err) { log("adopt failed: " + err); } }, 400);
  });
  // A dialog a page opens (alert, "Leave page?", a sign-in prompt) is drawn by Firefox around the page, which a bent pane
  // can't show or click. While one is open the Pod steps aside to that tab as a normal page, then comes back.
  let dialogLeft = false;
  window.addEventListener("DOMWillOpenModalDialog", onDialog, true);
  function onDialog(e) {
    if (!document.body.classList.contains("ad-room")) return;
    const b = e.target?.localName === "browser" ? e.target : null; // Firefox fires it on the page's <browser> element
    const tab = b ? gBrowser.getTabForBrowser(b) : null;
    if (!tab || !panes.some((p) => p.tab === tab)) return;
    dialogLeft = true;
    leave();
    window.setTimeout(() => { gBrowser.selectedTab = tab; }, 200);
  }
  window.addEventListener("DOMModalDialogClosed", () => {
    if (!dialogLeft) return;
    dialogLeft = false;
    window.setTimeout(() => { if (!document.body.classList.contains("ad-room")) enter(); }, 300);
  }, true);
  // Firefox deactivates the tab you switch away from; in the Pod the panes keep the activity their tier gives them:
  // - media: a pane playing audio or video stays active wherever it is (never starved);
  // - in view (and the selected tab): active;
  // - behind you: cold (no painting or rendering; its last picture stays), warmed again just before it comes into view;
  // - Theater: only the Theater pane (and media panes) are active.
  function setTiers() {
    if (!document.body.classList.contains("ad-room")) return;
    tiersAt = Date.now();
    const cold = tune("coldBehind", 1), at = cam.target ?? cam.yaw;
    for (const p of panes) {
      if (p.asleep) continue;
      const b = p.tab.linkedBrowser;
      if (!b) continue;
      const near = Math.abs(turn(p.yaw + (p.off || 0) - at)) < 1.85 || Math.abs(turn(p.yaw + (p.off || 0) - cam.yaw)) < 1.85;
      const on = cinemaOf ? p === cinemaOf : playing(p) || (theaterOf ? p === theaterOf : (!cold || near || p === focused || p.tab === gBrowser.selectedTab));
      if (b.docShellIsActive !== on) b.docShellIsActive = on;
      if (b.renderLayers !== on) b.renderLayers = on;
    }
  }
  const keepActive = () => setTiers();
  // The home pane's Earth turns only when the home pane is the one in front (and not in Lite mode): the Pod tells the home
  // page through its bridge ("pod:view"), whenever that changes.
  function notifyHome() {
    const mode = (() => { try { return Services.prefs.getStringPref("aetherdeck.room.mode", "balanced"); } catch (e) { return "balanced"; } })();
    const inPod = document.body.classList.contains("ad-room");
    for (const p of panes) {
      const b = p.tab.linkedBrowser;
      if (!b || p.asleep || !isHome(b.currentURI?.spec)) continue;
      const front = !inPod || focused === p || theaterOf === p;
      const key = front + "/" + mode;
      if (p.homeSent === key && p.homeWG === b.browsingContext?.currentWindowGlobal) continue;
      try {
        b.browsingContext.currentWindowGlobal.getActor("AetherDeckBridge").emit("pod:view", { front, mode });
        p.homeSent = key; p.homeWG = b.browsingContext.currentWindowGlobal;
      } catch (e) { /* not loaded yet: tried again next second */ }
    }
  }
  gBrowser.tabContainer.addEventListener("TabSelect", () => window.setTimeout(keepActive, 50));
  gBrowser.tabContainer.addEventListener("TabClose", (e) => {
    const i = panes.findIndex((p) => p.tab === e.target);
    if (i < 0) return;
    if (theaterOf === panes[i]) endTheater(true);
    if (cinemaOf === panes[i]) endCinema();
    if (focused === panes[i]) { focused = null; document.body.classList.remove("ad-focusing"); }
    const el = document.getElementById(panes[i].tab.linkedPanel);
    if (el) { el.classList.remove("ad-room-pane"); el.style.transform = ""; }
    stripsOf(panes[i]).forEach((e) => e.remove());
    panes.splice(i, 1);
    place();
  });

  // ---- More tabs: every open tab that isn't one of the eight panes, in tab order. Click "Swap in" (or drag a row onto a
  // pane) to put it in the pod in place of the pane you're facing (or the one you drop it on); that pane's tab joins the box.
  let moreEl = null;
  const extraTabs = () => gBrowser.tabs.filter((t) => !t.pinned && !panes.some((p) => p.tab === t) && !blank(tabUrl(t)));
  function toggleMore(force) {
    if (!moreEl) { moreEl = document.createElementNS(X, "div"); moreEl.id = "ad-more"; document.documentElement.appendChild(moreEl); }
    moreEl.classList.toggle("open", force ?? !moreEl.classList.contains("open"));
    drawMore();
  }
  function drawMore() {
    const extra = extraTabs();
    moreBtn.textContent = extra.length ? `More tabs (${extra.length})` : "More tabs";
    moreBtn.style.opacity = extra.length ? "1" : ".55";
    if (!moreEl || !moreEl.classList.contains("open")) return;
    moreEl.textContent = "";
    const h = document.createElementNS(X, "div"); h.className = "h"; h.textContent = extra.length ? `More tabs (${extra.length})` : "No more tabs";
    const sm = document.createElementNS(X, "small"); sm.textContent = extra.length ? "Swap one in for the pane you're facing, or drag it onto a pane." : "Your pod shows every open tab.";
    h.append(sm); moreEl.append(h);
    for (const t of extra) {
      const row = document.createElementNS(X, "div"); row.className = "t";
      const ic = document.createElementNS(X, "img"); ic.src = t.getAttribute("image") || "chrome://global/skin/icons/defaultFavicon.svg";
      const nm = document.createElementNS(X, "span"); nm.textContent = t.label || tabUrl(t);
      const go = document.createElementNS(X, "button"); go.textContent = "Swap in";
      go.addEventListener("click", (e) => { e.stopPropagation(); swapIn(t, targetPane() || panes[0]); });
      row.append(ic, nm, go);
      row.addEventListener("pointerdown", (e) => { if (e.target !== go) dragToPane(e, t); });
      moreEl.append(row);
    }
  }
  function dragToPane(e, tab) {
    e.preventDefault();
    const ghost = document.createElementNS(X, "div"); ghost.id = "ad-more-ghost"; ghost.textContent = tab.label || "Tab";
    document.documentElement.appendChild(ghost);
    const move = (ev) => { ghost.style.left = ev.clientX + 12 + "px"; ghost.style.top = ev.clientY + 8 + "px"; };
    const up = (ev) => {
      window.removeEventListener("pointermove", move, true); window.removeEventListener("pointerup", up, true); ghost.remove();
      if (moreEl.contains(ev.target)) return;
      const hit = pick(ev.clientX, ev.clientY);
      if (hit) swapIn(tab, hit.p);
    };
    move(e);
    window.addEventListener("pointermove", move, true); window.addEventListener("pointerup", up, true);
  }
  function swapIn(tab, out) {
    if (!tab || panes.some((p) => p.tab === tab)) return;
    const i = out ? panes.indexOf(out) : -1;
    if (i < 0 && panes.length >= MAX_PANES) return;
    if (focused) unfocus();
    const np = { tab, url: tabUrl(tab), lastUrl: tabUrl(tab), yaw: 0, outSince: null, asleep: false, born: Date.now() };
    if (i >= 0) {
      const el = document.getElementById(out.tab.linkedPanel);
      if (el) { el.classList.remove("ad-room-pane", "ad-side", "ad-focus"); el.style.transform = ""; }
      stripsOf(out).forEach((c) => c.remove());
      panes.splice(i, 1, np);
    } else panes.push(np);
    enter();
    lookAt(panes.indexOf(np));
    drawMore();
    say(`${tab.label || "The tab"} is in your pod${out ? `; ${out.tab.label || "the other one"} is in More tabs` : ""}.`);
  }
  gBrowser.tabContainer.addEventListener("TabClose", () => window.setTimeout(drawMore, 50));
  // A tab that finishes loading in the background (its address and title arrive late) counts from then on: keep the button's
  // number current, not only the open box (it stayed at "More tabs" for tabs opened in the background).
  let moreAt = 0;
  gBrowser.tabContainer.addEventListener("TabAttrModified", () => {
    if (moreEl?.classList.contains("open")) { drawMore(); return; }
    window.clearTimeout(moreAt); moreAt = window.setTimeout(drawMore, 150); // cheap, and coalesced
  });

  function addPane(url) {
    if (panes.length >= MAX_PANES) {
      adding = true;
      try { gBrowser.addTab(url, { triggeringPrincipal: system, inBackground: true, skipAnimation: true }); } finally { adding = false; }
      say("Your pod holds " + MAX_PANES + " panes: the new tab is in More tabs, swap it in from there.");
      window.setTimeout(drawMore, 100);
      return null;
    }
    adding = true; // the TabOpen handler below must not adopt a tab we are making ourselves
    let tab;
    try { tab = gBrowser.addTab(url, { triggeringPrincipal: system, inBackground: true, skipAnimation: true }); } finally { adding = false; }
    const p = { tab, url, yaw: 0, outSince: null, asleep: false, born: Date.now() };
    panes.push(p);
    return p;
  }

  // Start: wait for Firefox's session restore (it may bring back tabs from last time). If tabs came back, they become the
  // panes; otherwise the window's own blank tab is the first pane and the default sites are added.
  // AetherDeck's own home page may use the microphone (voice for agents and search) without Firefox's prompt: that prompt hangs
  // off the toolbar, which the Pod hides, so the request waited forever. Only this computer's AetherDeck page; macOS still asks.
  try {
    for (const origin of ["http://127.0.0.1:8787", "http://localhost:8787"]) {
      const pr = Services.scriptSecurityManager.createContentPrincipalFromOrigin(origin);
      if (Services.perms.testExactPermissionFromPrincipal(pr, "microphone") !== Services.perms.ALLOW_ACTION) Services.perms.addFromPrincipal(pr, "microphone", Services.perms.ALLOW_ACTION);
    }
  } catch (e) { log("microphone permission failed: " + e); }
  // The local AetherDeck server behind the home pane: started from inside the app when nothing answers on 8787.
  const serverReady = (async () => {
    try {
      const { AetherDeckServer } = ChromeUtils.importESModule("chrome://browser/content/aetherdeck/AetherDeckServer.sys.mjs");
      const alive = async () => {
        try { const ctl = new window.AbortController(); window.setTimeout(() => ctl.abort(), 1500); return (await window.fetch("http://127.0.0.1:8787/api/health", { signal: ctl.signal, cache: "no-store" })).ok; }
        catch (e) { return false; }
      };
      const r = await AetherDeckServer.ensure(alive);
      if (r !== "running") log("server: " + r);
      return r;
    } catch (e) { log("server failed: " + e); return "failed"; }
  })();
  const isHome = (u) => /^http:\/\/(127\.0\.0\.1|localhost):8787\//.test(u || "");

  async function start() {
    try {
      log("start");
      if (window.SessionStore?.promiseAllWindowsRestored) await Promise.race([window.SessionStore.promiseAllWindowsRestored, new Promise((r) => window.setTimeout(r, 5000))]);
      else await new Promise((r) => window.setTimeout(r, 2500));
    } catch (e) { log("waiting for session restore failed: " + e); }
    const tabs = [...gBrowser.tabs];
    const back = tabs.filter((t) => !blank(tabUrl(t)));
    if (back.length) {
      for (const t of back.slice(0, MAX_PANES)) { const u = tabUrl(t); panes.push({ tab: t, url: u, lastUrl: u, yaw: 0, outSince: null, asleep: false, born: Date.now() }); }
      log("restored " + panes.length + " tabs as panes");
      // A restored home pane loaded before the server was up: load it again once it is.
      serverReady.then((r) => { if (r === "started") for (const p of panes) if (isHome(p.url)) try { p.tab.linkedBrowser.reload(); } catch (e) {} });
    } else {
      const first = gBrowser.selectedTab;
      panes.push({ tab: first, url: URLS[0], yaw: 0, outSince: null, asleep: false, born: Date.now() });
      window.setTimeout(async () => { if (isHome(URLS[0])) await serverReady; try { gBrowser.getBrowserForTab(first).fixupAndLoadURIString(URLS[0], { triggeringPrincipal: system }); } catch (e) { log("first load failed: " + e); } }, 800);
      URLS.slice(1).forEach(addPane);
    }
    layout = ring(panes.length);
    // Give each tab a moment to create its browser, then show them all.
    window.setTimeout(() => {
      try {
        enter();
        for (const p of panes) {
          if (!p.tab.hasAttribute("pending")) continue; // a restored tab that was never loaded: load it now
          try { window.SessionStore.restoreTabContent(p.tab); } catch (e) { try { p.tab.linkedBrowser.fixupAndLoadURIString(p.url, { triggeringPrincipal: system }); } catch (e2) { log("load of restored tab failed: " + e2); } }
        }
        log("entered with " + panes.length + " tabs");
      } catch (e) { log("enter failed: " + e + "\n" + e.stack); }
    }, 1500);
  }
  start();

  function lookAt(i) { cam.target = turn(panes[i].yaw + (panes[i].off || 0)); cam.tpitch = 0; activePane = panes[i]; kick(); tick(); }
  function recenter() {
    const p = (activePane && panes.includes(activePane)) ? activePane : panes[0];
    if (!p) return;
    cam.back = 0; cam.fov = 1.3;
    cam.target = turn(p.yaw + (p.off || 0)); cam.tpitch = 0; kick(); apply();
  }
  function overview(on) { cam.back = on ? layout.radius * 0.85 : 0; cam.fov = on ? 1.6 : 1.3; apply(); }
  const toggle = () => (document.body.classList.contains("ad-room") ? leave() : enter());
  leaveBtn.addEventListener("click", toggle);
  // A visible way back into the Pod once you have left it: a "Pod" button at the end of the toolbar, in AetherDeck's colours.
  try {
    const POD_ICON = "data:image/svg+xml," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><defs><linearGradient id="h" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f6c89c"/><stop offset=".55" stop-color="#c9b6ff"/><stop offset="1" stop-color="#8b74f6"/></linearGradient><radialGradient id="w" cx=".38" cy=".35" r=".7"><stop offset="0" stop-color="#fff6ea"/><stop offset=".5" stop-color="#f6c89c"/><stop offset="1" stop-color="#8b74f6"/></radialGradient><radialGradient id="g" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#f6c89c" stop-opacity=".9"/><stop offset="1" stop-color="#f6c89c" stop-opacity="0"/></radialGradient></defs><ellipse cx="12" cy="21.6" rx="6.5" ry="1.6" fill="url(#g)"/><path d="M7.4 17.6 5.6 21M16.6 17.6l1.8 3.4" stroke="url(#h)" stroke-width="1.5" stroke-linecap="round"/><path d="M3.4 14.6C3.4 8.4 7.2 3.6 12 3.6s8.6 4.8 8.6 11c0 2-1.3 3.3-3.3 3.3H6.7c-2 0-3.3-1.3-3.3-3.3Z" fill="#1d1638" stroke="url(#h)" stroke-width="1.5"/><path d="M3.8 13.8h16.4" stroke="url(#h)" stroke-width="1" opacity=".75"/><circle cx="12" cy="9.6" r="3.4" fill="url(#w)" stroke="#f6f1ff" stroke-opacity=".5" stroke-width=".6"/><circle cx="10.9" cy="8.5" r=".95" fill="#fff" opacity=".9"/><circle cx="7.6" cy="15.9" r=".7" fill="#f6c89c"/><circle cx="12" cy="15.9" r=".7" fill="#c9b6ff"/><circle cx="16.4" cy="15.9" r=".7" fill="#f6c89c"/><circle cx="21.2" cy="3.6" r=".8" fill="#f6c89c"/><circle cx="2.8" cy="5.4" r=".55" fill="#c9b6ff"/></svg>`);
    // Registered with Firefox's toolbar manager (CustomizableUI), so it stays put on new profiles and can be moved like any
    // toolbar button. One widget for all windows; each window's Pod is reached through window.adPodToggle.
    window.adPodToggle = toggle;
    const { CustomizableUI } = ChromeUtils.importESModule("moz-src:///browser/components/customizableui/CustomizableUI.sys.mjs");
    if (CustomizableUI.getWidget("ad-room-open")?.provider !== CustomizableUI.PROVIDER_API) {
      CustomizableUI.createWidget({
        id: "ad-room-open",
        type: "button",
        label: "Pod",
        tooltiptext: "Enter the Pod (Alt+Shift+P)",
        defaultArea: CustomizableUI.AREA_NAVBAR,
        removable: true,
        onCommand: (e) => e.target.ownerGlobal.adPodToggle?.(),
      });
    }
    const openBtn = document.getElementById("ad-room-open");
    if (openBtn) openBtn.setAttribute("image", POD_ICON);
    const st = document.createElement("style");
    st.textContent = `#ad-room-open { appearance: none; display: flex; flex-direction: row; align-items: center; margin: 0 4px; padding: 2px 12px 2px 6px; border-radius: 999px;
        background: linear-gradient(135deg, #2b2150, #4a3796); border: 1px solid rgba(214, 202, 255, 0.55);
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.25), 0 0 12px rgba(150, 120, 255, 0.45); color: #f6f1ff; font-weight: 600; }
      #ad-room-open:hover { background: linear-gradient(135deg, #3a2c6a, #5c47b4); box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.3), 0 0 16px rgba(246, 200, 156, 0.45); }
      #ad-room-open .toolbarbutton-icon { width: 20px; height: 20px; padding: 0; margin-inline-end: 5px; list-style-image: url("${POD_ICON}"); }
      #ad-room-open .toolbarbutton-text { display: block !important; margin: 0; padding: 0; min-height: 0; line-height: 20px; align-self: center; color: #f6f1ff; letter-spacing: 0.02em; }
      body.ad-room #ad-room-open { display: none; }`;
    document.documentElement.appendChild(st);
  } catch (e) { log("room button failed: " + e); }
  window.addEventListener("keydown", (e) => {
    // Leave / re-enter with Alt+Shift+P (P for Pod; Alt+Shift+R, from when it was the Room, still works). Plain Esc no longer leaves: pages and sign-in popups send Esc themselves (to close a
    // dialog), and those keys reach this window and threw the Room away.
    if (e.altKey && e.shiftKey && (e.code === "KeyP" || e.code === "KeyR")) { toggle(); e.preventDefault(); return; }
    if (!document.body.classList.contains("ad-room")) return;
    // Esc ends Theater even while the page has the keyboard (a page in its own full screen handles Esc itself).
    if (e.key === "Escape" && cinemaOf && !document.fullscreenElement) { endCinema(); e.preventDefault(); return; }
    if (e.key === "Escape" && theaterOf && !document.fullscreenElement) { endTheater(); e.preventDefault(); return; }
    if (document.activeElement?.localName === "browser" || e.target?.localName === "input") return; // typing in a page or the address box
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      cam.target = null; cam.yaw = turn(cam.yaw + (e.key === "ArrowRight" ? 0.12 : -0.12)); apply();
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      cam.target = null; cam.pitch = clamp(cam.pitch + (e.key === "ArrowUp" ? -0.08 : 0.08), -0.5, 0.5); apply();
    } else if (e.key === "+" || e.key === "=") zoomPane(targetPane(), 1.12);
    else if (e.key === "-" || e.key === "_") zoomPane(targetPane(), 1 / 1.12);
    else if (e.key === "f" || e.key === "F") theater();
    else if (e.key === "Home" || e.key === "c" || e.key === "C") recenter();
    else if (e.key === "0") overview(cam.back === 0);
    else return;
    e.preventDefault();
  });
  window.addEventListener("resize", apply);
  // Sleep: only the MAX_LIVE panes nearest the camera stay live; the rest are discarded (Firefox's own tab discard) after a
  // grace period and wake when the camera turns back (a discarded tab reloads its page, so scroll position is lost).
  const panelOf = (p) => document.getElementById(p.tab.linkedPanel);
  function sleep(p) {
    if (focused === p) unfocus();
    if (p.asleep || p.tab === gBrowser.selectedTab || Date.now() - p.born < 10000) return; // a new pane gets time to load first
    const was = p.tab.linkedBrowser?.currentURI?.spec;
    if (was && was !== "about:blank") p.lastUrl = was;
    try { gBrowser.discardBrowser(p.tab, true); } catch (e) { log("discard failed: " + e); return; }
    p.asleep = true;
    panelOf(p)?.classList.add("ad-asleep");
  }
  function wake(p) {
    if (!p.asleep) return;
    p.asleep = false; p.outSince = null;
    panelOf(p)?.classList.remove("ad-asleep");
    try {
      gBrowser.showSplitViewPanels([p.tab]);
      const b = p.tab.linkedBrowser;
      if (b) {
        b.docShellIsActive = true; b.renderLayers = true;
        // Showing a discarded tab's panel does not reload it: load the address it had (or was made for) ourselves.
        const again = p.lastUrl || p.url;
        if (again && (b.currentURI.spec === "about:blank" || p.tab.hasAttribute("pending"))) b.fixupAndLoadURIString(again, { triggeringPrincipal: system });
      }
    } catch (e) { log("wake failed: " + e); }
  }
  function drawRail() {
    if (!rail.classList.contains("open")) return;
    rail.replaceChildren();
    panes.forEach((p, i) => {
      const row = document.createElementNS(X, "div");
      row.className = "item" + (p.asleep ? " asleep" : "") + (Math.abs(turn(p.yaw - cam.yaw)) < 0.05 ? " here" : "");
      const text = document.createElementNS(X, "div");
      text.className = "t";
      let host = "";
      try { host = new URL(p.tab.linkedBrowser.currentURI.spec).host; } catch (e) { /* blank */ }
      text.textContent = (i + 1) + ". " + (p.tab.label || host || "New pane");
      const sub = document.createElementNS(X, "div");
      sub.className = "h";
      sub.textContent = p.asleep ? "asleep" : host;
      const col = document.createElementNS(X, "div");
      col.style.cssText = "flex:1;min-width:0";
      col.append(text, sub);
      const x = document.createElementNS(X, "button");
      x.textContent = "✕";
      x.title = "Close this tab";
      x.addEventListener("click", (e) => { e.stopPropagation(); gBrowser.removeTab(p.tab); });
      row.append(col, x);
      row.addEventListener("click", () => lookAt(i));
      rail.append(row);
    });
  }
  function tick() {
    if (focused) { const b = focused.tab.linkedBrowser; try { if (b && focused.focusZoom && Math.abs(b.fullZoom - focused.focusZoom) > 0.001) b.fullZoom = focused.focusZoom; } catch (e) {} }
    if (!document.body.classList.contains("ad-room")) return;
    applyPageZoom(); // Firefox resets a page's zoom when it navigates
    const look = cam.target ?? cam.yaw, now = Date.now();
    const near = new Set([...panes].sort((a, b) => Math.abs(turn(a.yaw - look)) - Math.abs(turn(b.yaw - look))).slice(0, MAX_LIVE));
    for (const p of panes) {
      if (near.has(p)) { p.outSince = null; wake(p); }
      else { p.outSince ??= now; if (now - p.outSince >= SLEEP_AFTER_MS) sleep(p); }
    }
    // Watchdog: some panes made while the Room was already open ended up on about:blank without ever loading (cause not found);
    // a live pane that is still blank 8 seconds after it was made gets its address loaded again.
    for (const p of panes) {
      const b = p.tab.linkedBrowser;
      if (p.asleep || !b || !p.url || now - p.born < 8000 || b.currentURI.spec !== "about:blank" || (b.webProgress && b.webProgress.isLoadingDocument)) continue;
      if ((p.retries = (p.retries || 0) + 1) <= 3) b.fixupAndLoadURIString(p.lastUrl || p.url, { triggeringPrincipal: system });
    }
    // The grace period never lets more than MAX_LIVE panes stay live: past the cap the farthest ones sleep at once.
    const live = panes.filter((p) => !p.asleep && p.tab !== gBrowser.selectedTab);
    const room = MAX_LIVE - (panes.some((p) => !p.asleep && p.tab === gBrowser.selectedTab) ? 1 : 0);
    live.sort((a, b) => Math.abs(turn(b.yaw - look)) - Math.abs(turn(a.yaw - look)));
    while (live.length > room) sleep(live.shift());
    setTiers(); // tiers follow the view (and a pane that just woke stays cold behind the Theater)
    notifyHome();
    drawRail();
    meter.textContent = panes.filter((p) => !p.asleep).length + " live of " + panes.length + " panes";
    meter.title = `Up to ${MAX_LIVE} panes stay live on this Mac (${Math.round(RAM_GB)} GB); the others sleep with their last picture and wake when you turn to them. Up to ${MAX_PANES} panes; more tabs wait in More tabs.`;
    drawMore();
  }
  window.setInterval(tick, 1000);

  // Address entry: an address opens as a new pane, anything else is searched.
  addr.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key !== "Enter") return;
    const text = addr.value.trim();
    if (!text) return;
    addr.value = "";
    const url = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : /^[^\s/]+\.[^\s/]+/.test(text) ? "https://" + text : "https://duckduckgo.com/?q=" + encodeURIComponent(text);
    if (!/^https?:/i.test(url)) { say("Only http(s) addresses."); return; }
    addPane(url);
    window.setTimeout(() => { enter(); lookAt(panes.length - 1); }, 400);
  });


  // ---- The page bridge service (window.adBridge): what AetherDeck's own pages may ask the browser to do ----
  const DATA_DIR = () => window.PathUtils.join(window.PathUtils.profileDir, "aetherdeck-data");
  const dataFile = (name) => window.PathUtils.join(DATA_DIR(), name + ".json");
  async function readData(name, fallback) {
    try { return JSON.parse(await window.IOUtils.readUTF8(dataFile(name))); } catch (e) { return fallback; }
  }
  async function writeData(name, value) {
    await window.IOUtils.makeDirectory(DATA_DIR(), { createAncestors: true, ignoreExisting: true });
    await window.IOUtils.writeUTF8(dataFile(name), JSON.stringify(value), { tmpPath: dataFile(name) + ".tmp" });
  }
  const SAVED = new Set(["research", "agents", "agent-memory", "apps", "settings"]);
  // Firefox's search engines (its address bar's default), a module in this version rather than Services.search.
  const searchService = () => ChromeUtils.importESModule("moz-src:///toolkit/components/search/SearchService.sys.mjs").SearchService;
  window.adBridge = {
    async invoke(channel, args) {
      switch (channel) {
        case "app:info": return { version: "0.1", platform: "aetherdeck-room", keys: {}, contact: "", config: {}, isDefault: false, packaged: true };
        case "app:ready": return [];
        case "app:openExternal": case "room:open": {
          const url = String(args[0] || "");
          if (!/^https?:\/\//i.test(url)) throw new Error("Only http(s) addresses");
          const p = addPane(url);
          if (!p) return { pane: null, inMoreTabs: true };
          window.setTimeout(() => { enter(); lookAt(panes.length - 1); }, 400);
          return { pane: panes.length };
        }
        case "room:enter": enter(); return { panes: panes.length };
        case "widgets:list": return agentWidgets.map(({ id, title, agent, updated }) => ({ id, title, agent, updated }));
        case "widgets:save": {
          const w = args[0] || {};
          const id = String(w.id || "").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 32) || "w" + Date.now().toString(36);
          const html = String(w.html || "");
          if (!html.trim()) throw new Error("A widget needs some HTML");
          if (html.length > 200_000) throw new Error("A widget can be at most 200 KB");
          const entry = { id, title: String(w.title || "Widget").slice(0, 60), agent: String(w.agent || "").slice(0, 60), html, w: Math.max(140, Math.min(520, Number(w.width) || 220)), h: Math.max(90, Math.min(400, Number(w.height) || 150)), updated: Date.now() };
          const i = agentWidgets.findIndex((x) => x.id === id);
          if (i < 0 && agentWidgets.length >= 12) throw new Error("The pod has 12 agent widgets already; delete one first");
          if (i >= 0) agentWidgets[i] = entry; else agentWidgets.push(entry);
          await writeData("widgets", agentWidgets);
          if (!widgetsOn) setShelf(true); // an agent just placed one: show it
          drawAgentWidgets();
          return { id, placed: true };
        }
        case "widgets:remove": { agentWidgets = agentWidgets.filter((x) => x.id !== String(args[0])); await writeData("widgets", agentWidgets); drawAgentWidgets(); return true; }
        // First-run setup in AetherDeck for Mac: the browser's own settings, changed by the person's choice in the setup.
        case "browser:status": {
          const AM = ChromeUtils.importESModule("resource://gre/modules/AddonManager.sys.mjs").AddonManager;
          const ubo = await AM.getAddonByID("uBlock0@raymondhill.net");
          let isDefault = false;
          try { isDefault = window.ShellService.isDefaultBrowser(false, false); } catch (e) {}
          const engine = (await searchService().getDefault())?.name || "";
          return { isDefault, adblock: ubo ? !ubo.userDisabled : null, engine };
        }
        case "app:setDefault": {
          try { await window.ShellService.setDefaultBrowser(false); } catch (e) { log("set default failed: " + e); }
          try { return window.ShellService.isDefaultBrowser(false, false); } catch (e) { return false; }
        }
        case "search:setDefault": {
          const want = { google: "Google", bing: "Bing", duckduckgo: "DuckDuckGo" }[String(args[0])];
          if (!want) throw new Error("Unknown search engine");
          const engine = (await searchService().getEngines()).find((e) => e.name === want);
          if (engine) await searchService().setDefault(engine, searchService().CHANGE_REASON?.USER ?? Ci.nsISearchService?.CHANGE_REASON_USER ?? 1);
          return !!engine;
        }
        case "adblock:set": {
          const AM = ChromeUtils.importESModule("resource://gre/modules/AddonManager.sys.mjs").AddonManager;
          const ubo = await AM.getAddonByID("uBlock0@raymondhill.net");
          if (!ubo) return null;
          if (args[0]) await ubo.enable(); else await ubo.disable();
          return !ubo.userDisabled;
        }
        case "import:open": {
          const key = { chrome: "chrome", safari: "safari", firefox: "firefox", edge: "chromium-edge", brave: "brave" }[String(args[0])];
          window.MigrationUtils.showMigrationWizard(window, { entrypoint: window.MigrationUtils.MIGRATION_ENTRYPOINTS.FIRSTRUN, ...(key ? { migratorKey: key } : {}) });
          return true;
        }
        case "room:panes": return panes.map((p, i) => ({ i, url: tabUrl(p.tab), title: p.tab.label || "" }));
        case "research:load": return await readData("research", null);
        case "research:save": await writeData("research", args[0]); return undefined;
        case "agents:list": return await readData("agents", []);
        case "agents:save": await writeData("agents", args[0]); return undefined;
        case "store:load": { const n = String(args[0]); if (!SAVED.has(n)) throw new Error("Unknown store " + n); return await readData(n, args[1] ?? null); }
        case "store:save": { const n = String(args[0]); if (!SAVED.has(n)) throw new Error("Unknown store " + n); await writeData(n, args[1]); return undefined; }
        default: throw new Error("Not available in AetherDeck: " + channel);
      }
    },
  };

  window.setInterval(() => { try { updateWidgets(); } catch (e) {} }, 5000);
  loadAgentWidgets().catch((e) => log("agent widgets: " + e));
  window.adRoomTabs = { sleep, wake, tick, cam, panes, lookAt, overview, apply, enter, leave, addPane, place, sendMouse, theater, endTheater, perf,
    focusedPane: () => focused, theaterPane: () => theaterOf, cinema, endCinema, cinemaPane: () => cinemaOf, layout: () => layout, PW, PH };
})();
