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
    body.ad-room #ad-room-rail.open { display: block; }
    #ad-room-rail .item { display: flex; align-items: center; gap: 6px; padding: 5px 6px; border-radius: 6px; cursor: pointer; }
    #ad-room-rail .item:hover, #ad-room-rail .item.here { background: #1d1d26; }
    #ad-room-rail .item .t { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    #ad-room-rail .item .h { color: #9a9aa6; font-size: 11px; }
    #ad-room-rail .item.asleep .t { opacity: .5; }
    #ad-room-rail .item button { margin: 0; padding: 0 5px; border: 0; background: transparent; color: #9a9aa6; cursor: pointer; }
    #ad-widgets { display: none; position: fixed; inset: 0; z-index: 1003; pointer-events: none; }
    body.ad-room ~ #ad-widgets, body.ad-room #ad-widgets { display: block; }
    .ad-widget { position: absolute; box-sizing: border-box; min-width: 130px; min-height: 64px; max-width: 520px; max-height: 300px; padding: 10px 14px; border-radius: 16px;
      border: 1px solid rgba(214,202,255,.32); background: linear-gradient(145deg, rgba(43,33,80,.62), rgba(20,22,34,.62)); backdrop-filter: blur(14px);
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
  `;
  document.documentElement.append(style);

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
  let widgetsOn = true;
  try { widgetsOn = window.Services.prefs.getBoolPref("aetherdeck.room.widgets", true); } catch (e) {}
  const widgetsBtn = mk("Widgets", "Show or hide the clock, tab and agent widgets", () => {
    widgetsOn = !widgetsOn;
    if (widgetsOn) { for (const k of Object.keys(widgetLayout)) if (widgetLayout[k]) widgetLayout[k].hidden = false; saveLayout(); }
    try { window.Services.prefs.setBoolPref("aetherdeck.room.widgets", widgetsOn); } catch (e) {}
    widgetsBtn.style.opacity = widgetsOn ? "1" : ".55";
    apply();
  });
  widgetsBtn.style.opacity = widgetsOn ? "1" : ".55";
  const moreBtn = mk("More tabs", "Tabs beyond the eight in your pod: swap one in", () => toggleMore());
  moreBtn.style.minWidth = "84px";
  hud.append(title, addr, railBtn, zoomOutBtn, sizeRange, sizeLabel, zoomInBtn, fitBtn, homeBtn, roomsBtn, widgetsBtn, moreBtn, fsBtn, meter, leaveBtn);
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
  const BG_N = 36, BG_R = 2400, BG_W = (2 * Math.PI * BG_R) / BG_N, BG_H = 7400;
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
    for (const p of panes) {
      if (p.curve) continue;
      p.curve = [];
      p.ctx = [];
      for (let i = 0; i < CURVE_N; i++) {
        const c = document.createElementNS(X, "canvas");
        c.className = "ad-curve-strip";
        c.width = 8; c.height = 8;
        c.style.display = "none";
        worldEl.append(c);
        p.curve.push(c);
        p.ctx.push(c.getContext("2d"));
      }
    }
  }

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
      child: { esModuleURI: "chrome://browser/content/aetherdeck/AetherDeckInputChild.sys.mjs" },
      allFrames: false,
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
    return { u: clamp(u * kx, 0, (p.vw || PW) - 0.5), v: clamp(v * ky, 0, (p.vh || PH) - 0.5) };
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
  function onMoveUp() { window.removeEventListener("mousemove", onMoveMove, true); window.removeEventListener("mouseup", onMoveUp, true); mv.on = false; }
  let theaterOf = null, theaterPrev = 1;
  function fitScale(p) {
    const H = window.innerHeight || 800, Wd = window.innerWidth || 1200;
    const hfov = 2 * Math.atan(Math.tan(cam.fov / 2) * (Wd / H));
    const sW = (0.86 * hfov * layout.radius) / PW;
    const sH = (2 * layout.radius * Math.tan(0.43 * cam.fov)) / PH;
    return clamp(Math.min(sW, sH), 0.5, 3.2);
  }
  function theater(p) {
    p = p || targetPane() || panes[0];
    if (!p) return;
    if (theaterOf === p) { p.scale = theaterPrev; theaterOf = null; place(); lookAt(panes.indexOf(p)); return; }
    theaterOf = p; theaterPrev = p.scale || 1; p.scale = fitScale(p);
    place();
    cam.target = turn(p.yaw + (p.off || 0)); cam.tpitch = -(p.voff || 0) / layout.radius; kick(); apply();
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
      apply();
      if (Math.abs(turn(cam.target - cam.yaw)) > 0.0008 || Math.abs(cam.tpitch - cam.pitch) > 0.0008) raf = window.requestAnimationFrame(frame);
    }
  }
  function kick() { if (!raf) { lastFrame = window.performance.now(); raf = window.requestAnimationFrame(frame); } }

  // The camera is ONE transform on the world container; each strip only changes when the layout, size or position changes.
  // ---- Widgets: small panes of glass in front of the Pod (a clock, the tabs, the agents). They sit flat in a row along the
  // top, above where the panes are, and stay where you put them: drag to move, pull the corner to resize, × to hide one,
  // double-click to put one back in its place. Their spots and sizes are kept in the pref aetherdeck.room.widgetLayout.
  const widgets = {};
  const WIDGET_IDS = [["clock", "Time"], ["tabs", "Tabs"], ["crew", "Agents"]];
  let agentCount = null, agentsAt = 0, widgetLayer = null;
  const defaultSpot = (i) => ({ x: 16 + i * 186, y: 16, w: 174, h: 82, hidden: false });
  let widgetLayout = {};
  try { widgetLayout = JSON.parse(Services.prefs.getStringPref("aetherdeck.room.widgetLayout", "{}")) || {}; } catch (e) { widgetLayout = {}; }
  const saveLayout = () => { try { Services.prefs.setStringPref("aetherdeck.room.widgetLayout", JSON.stringify(widgetLayout)); } catch (e) {} };
  function spotOf(id) { const i = WIDGET_IDS.findIndex(([w]) => w === id); return { ...(id.startsWith("aw-") ? { x: 16, y: 110, w: 220, h: 150, hidden: false } : defaultSpot(i)), ...(widgetLayout[id] || {}) }; }
  function placeWidget(el, id) {
    const sp = spotOf(id), W = window.innerWidth, H = window.innerHeight;
    const w = Math.min(sp.w, W - 16), h = Math.min(sp.h, H - 16);
    el.style.width = w + "px"; el.style.height = h + "px";
    el.style.left = Math.max(0, Math.min(W - w, sp.x)) + "px"; el.style.top = Math.max(0, Math.min(H - h - 60, sp.y)) + "px"; // never under the bar
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
        widgetLayout[id] = { ...spotOf(id), x: el.offsetLeft, y: el.offsetTop }; saveLayout(); placeWidget(el, id);
      };
      el.addEventListener("pointermove", move); el.addEventListener("pointerup", up);
    });
    // Resize: the CSS corner handle; remember the size once it settles.
    let rt = 0;
    new window.ResizeObserver(() => { window.clearTimeout(rt); rt = window.setTimeout(() => { if (el.style.display === "none") return; const w = el.offsetWidth, h = el.offsetHeight, sp = spotOf(id); if (Math.abs(w - sp.w) > 2 || Math.abs(h - sp.h) > 2) { widgetLayout[id] = { ...sp, w, h }; saveLayout(); } }, 400); }).observe(el);
    el.addEventListener("wheel", (e) => e.stopPropagation(), { passive: true });
    widgetLayer.append(el);
    placeWidget(el, id);
    return (widgets[id] = el);
  }
  const setWidget = (el, v, sub) => { const a = el.querySelector(".v"), b = el.querySelector(".s"); if (a.textContent !== v) a.textContent = v; if (b.textContent !== sub) b.textContent = sub; };
  window.addEventListener("resize", () => { for (const [id] of WIDGET_IDS) if (widgets[id]) placeWidget(widgets[id], id); });

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
      if (!widgetLayout[id]) widgetLayout[id] = { x: 16 + i * 236, y: 110, w: w.w || 220, h: w.h || 150, hidden: false };
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
        const up = () => { el.classList.remove("dragging"); bar.removeEventListener("pointermove", move); bar.removeEventListener("pointerup", up); widgetLayout[id] = { ...spotOf(id), x: el.offsetLeft, y: el.offsetTop }; saveLayout(); placeWidget(el, id); };
        bar.addEventListener("pointermove", move); bar.addEventListener("pointerup", up);
      });
      let rt = 0;
      new window.ResizeObserver(() => { window.clearTimeout(rt); rt = window.setTimeout(() => { const sp = spotOf(id); if (el.style.display !== "none" && (Math.abs(el.offsetWidth - sp.w) > 2 || Math.abs(el.offsetHeight - sp.h) > 2)) { widgetLayout[id] = { ...sp, w: el.offsetWidth, h: el.offsetHeight }; saveLayout(); } }, 400); }).observe(el);
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
      if (p.geomVer === layoutVer) continue;
      p.geomVer = layoutVer;
      const g = paneGeom(p);
      // How bent a pane is does not depend on its size: the whole pane bends through the same angle (0 to about 52 degrees),
      // with its middle on the ring. Zooming a pane makes it bigger, not more curved.
      const bend = (curveAmount / 100) * 0.9;
      const Rb = bend < 0.02 ? 1e9 : (PW * g.sc) / bend;
      const base = p.yaw + (p.off || 0);
      (p.curve || []).forEach((strip, i) => {
        strip.style.display = bent ? "block" : "none";
        if (!bent) return;
        strip.style.width = g.sw + 2.6 + "px";
        strip.style.height = g.h + "px";
        strip.style.margin = `${-g.h / 2}px 0 0 ${-g.sw / 2}px`;
        const x = (i - (CURVE_N - 1) / 2) * g.sw;
        const th = Math.asin(clamp(x / Rb, -0.99, 0.99));
        const d = Rb - Math.sqrt(Math.max(0, Rb * Rb - x * x));
        strip.style.transform = `rotateY(${-base}rad) translateY(${p.voff || 0}px) translateZ(${-layout.radius}px) translateX(${x}px) translateZ(${d}px) rotateY(${-th}rad)`;
        const deg = (a) => (a * 180) / Math.PI;
        (p.S || (p.S = []))[i] = new window.DOMMatrix().rotateAxisAngleSelf(0, 1, 0, deg(-base)).translateSelf(0, p.voff || 0, 0).translateSelf(0, 0, -layout.radius).translateSelf(x, 0, 0).translateSelf(0, 0, d).rotateAxisAngleSelf(0, 1, 0, deg(-th));
      });
    }
    if (widgetVer !== layoutVer) { widgetVer = layoutVer; updateWidgets(); } // shows or hides them with the Pod
  }

  // Pictures of the pages, as fast as the browser can make them (panes you can see), rarely for the ones behind you.
  let snapRunning = false, snapMode, burstUntil = 0;
  function burst(ms) { burstUntil = Math.max(burstUntil, Date.now() + ms); }
  // Pixels per CSS pixel to capture a pane at: the screen's density for the pane you're using (2 on Retina, more when it is
  // zoomed bigger, at most 3), and a little less for the others, which redraw more often than you look at them.
  function sharpness(p) {
    const dpr = window.devicePixelRatio || 1, zoom = Math.max(1, p.scale || 1);
    // The pane you're facing shows its live page when the view rests, so pictures only need to be fine enough while turning.
    if (raf || look.on) return 1;
    return p === activePane ? Math.min(2, dpr * zoom) : 1;
  }
  async function snapPane(p, scale) {
    const b = p.tab.linkedBrowser;
    if (!b || typeof b.drawSnapshot !== "function") return;
    const r = b.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
    p.vw = b.clientWidth || PW; p.vh = b.clientHeight || PH; // layout size (getBoundingClientRect would be the transformed box)
    let bmp = null;
    // The whole visible page (fullViewport), scaled: with an explicit rectangle the scale changes what part is captured.
    try { bmp = await b.drawSnapshot(0, 0, 0, 0, scale, "white", true); } catch (e) { /* not painted yet */ }
    if (!bmp) return;
    const sw = bmp.width / CURVE_N;
    for (let i = 0; i < CURVE_N; i++) {
      const c = p.curve[i];
      const cw = Math.max(1, Math.ceil(sw));
      if (c.width !== cw || c.height !== bmp.height) { c.width = cw; c.height = bmp.height; }
      p.ctx[i].drawImage(bmp, i * sw, 0, sw, bmp.height, 0, 0, cw, bmp.height);
    }
    if (bmp.close) bmp.close();
    if (!p.hasSnap) { p.hasSnap = true; apply(); }
    stats.snaps++;
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
        if (now < burstUntil && activePane && activePane.curve && !activePane.asleep) {
          try { await snapPane(activePane, sharpness(activePane)); } catch (e) {}
          await new Promise((r) => window.setTimeout(r, 0));
          continue;
        }
        for (const p of panes) {
          if (p.asleep || !p.curve || p === focused) continue; // the focused pane is live on screen, no picture needed
          if ((raf || look.on) && p !== activePane) continue; // while the view moves, only the pane you're on is redrawn
          const d = Math.abs(turn(p.yaw + (p.off || 0) - cam.yaw));
          const inView = d < 1.5;
          const every = !inView ? 1500 : p === activePane ? 0 : 100;
          if (p.lastSnap && now - p.lastSnap < every) continue;
          p.lastSnap = now;
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
  }
  function focusPane(p) {
    if (focused === p) return;
    unfocus();
    const b = p.tab.linkedBrowser, el = document.getElementById(p.tab.linkedPanel);
    if (!b || !el || p.asleep) return;
    const H = window.innerHeight || 800, P = (H / 2) / Math.tan(cam.fov / 2);
    const k = (P / layout.radius) * (p.scale || 1); // how big the pane looks on screen, per CSS pixel of the page
    const W = Math.round(PW * k), Hh = Math.round(PH * k);
    p.zoomBefore = b.fullZoom || 1;
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
    if (focused && (Math.abs(turn(focused.yaw + (focused.off || 0) - cam.yaw)) > 0.004 || !canFocus())) unfocus();
    settle();
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
    let R = R0;
    const wOf = (p, r) => ((p.scale || 1) * PW) / r;
    let total = panes.reduce((t, p) => t + wOf(p, R) + gap, 0);
    if (total > TAU) { R = R0 * (total / TAU); total = panes.reduce((t, p) => t + wOf(p, R) + gap, 0); }
    layout = { yaws: [], radius: R, step: 0 };
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
    window.setTimeout(snapLoop, 300);
  }

  function leave() {
    unfocus();
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
  // Firefox deactivates the tab you switch away from; in the Room every pane stays live (up to the cap), so re-assert it.
  const keepActive = () => { if (!document.body.classList.contains("ad-room")) return; for (const p of panes) { if (p.asleep) continue; const b = p.tab.linkedBrowser; if (b) { b.docShellIsActive = true; b.renderLayers = true; } } };
  gBrowser.tabContainer.addEventListener("TabSelect", () => window.setTimeout(keepActive, 50));
  gBrowser.tabContainer.addEventListener("TabClose", (e) => {
    const i = panes.findIndex((p) => p.tab === e.target);
    if (i < 0) return;
    if (focused === panes[i]) { focused = null; document.body.classList.remove("ad-focusing"); }
    const el = document.getElementById(panes[i].tab.linkedPanel);
    if (el) { el.classList.remove("ad-room-pane"); el.style.transform = ""; }
    (panes[i].curve || []).forEach((e) => e.remove());
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
      (out.curve || []).forEach((c) => c.remove());
      panes.splice(i, 1, np);
    } else panes.push(np);
    enter();
    lookAt(panes.indexOf(np));
    drawMore();
    say(`${tab.label || "The tab"} is in your pod${out ? `; ${out.tab.label || "the other one"} is in More tabs` : ""}.`);
  }
  gBrowser.tabContainer.addEventListener("TabClose", () => window.setTimeout(drawMore, 50));
  gBrowser.tabContainer.addEventListener("TabAttrModified", () => { if (moreEl?.classList.contains("open")) drawMore(); });

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
    if (document.activeElement?.localName === "browser" || e.target?.localName === "input") return; // typing in a page or the address box
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      cam.target = null; cam.yaw = turn(cam.yaw + (e.key === "ArrowRight" ? 0.12 : -0.12)); apply();
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      cam.target = null; cam.pitch = clamp(cam.pitch + (e.key === "ArrowUp" ? -0.08 : 0.08), -0.5, 0.5); apply();
    } else if (e.key === "+" || e.key === "=") zoomPane(targetPane(), 1.12);
    else if (e.key === "-" || e.key === "_") zoomPane(targetPane(), 1 / 1.12);
    else if (e.key === "f" || e.key === "F") theater();
    else if (e.key === "Home" || e.key === "c" || e.key === "C") recenter();
    else if (e.key === "Escape" && theaterOf) theater(theaterOf);
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
          if (!widgetsOn) { widgetsOn = true; widgetsBtn.style.opacity = "1"; }
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
  window.adRoomTabs = { sleep, wake, tick, cam, panes, lookAt, overview, apply, enter, leave, addPane, place, sendMouse, layout: () => layout, PW, PH };
})();
