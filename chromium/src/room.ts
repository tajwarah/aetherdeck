// AetherDeck Room: real sites on a ring around you, in CSS 3D. Each pane is an iframe laid out with the same maths as the
// Electron 360° room (roomLogic.ts, which reuses shared/surround.ts); the camera is the transform of the parent. The browser
// hit-tests transformed iframes itself, so clicks, scrolling and typing reach the page with no screen capture. What is
// different from the Electron room is written down in chromium/README.md ("Room").
import { hostMatches, hostOf, neverStrip, normalizeUrl, permissionPattern, tileFirst, buildRule, type PaneState } from "./panesLogic.ts";
import { addRoomPane, clampFov, FOV, isRoomRuleId, MAX_AWAKE, MAX_ROOM_PANES, nearestIds, overviewBack, PANE_H, PANE_W, paneTransform, perspectiveFor, ringFor, roomRuleId, shielded, sleepDue, stepFrom, turn, worldTransform, yawForDrag } from "./roomLogic.ts";
import "./room.css";

// The project has no @types/chrome; every call used is in this file.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const chrome: any;

const LOAD_TIMEOUT_MS = 15_000;
/** No top-level navigation, so a page cannot replace the Room (target=_top, location.top). Same-origin keeps its own cookies. */
const SANDBOX = "allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads allow-pointer-lock allow-presentation";

type Status = "empty" | "loading" | "ok" | "slow" | "blocked" | "tile" | "window" | "mirror" | "asleep";
interface RV {
  el: HTMLElement; title: HTMLElement; slot: HTMLElement; overlay: HTMLElement; shield: HTMLElement;
  frame?: HTMLIFrameElement; video?: HTMLVideoElement; stream?: MediaStream;
  status: Status; message: string; timer?: number; outSince: number | null; yaw: number; shielded: boolean;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const stage = $("stage"), world = $("world");
let panes: PaneState[] = [];
let tileHosts: string[] = [];
let tiles: Record<number, number> = {}; // pane id → id of a real browser window opened for it (tile or mirror source)
let tabId = -1;
let direct = false, overview = false;
const views = new Map<number, RV>();
const cam = { yaw: 0, fov: FOV.start, back: 0, tYaw: null as number | null, tFov: null as number | null, tBack: null as number | null, spin: 0, raf: 0 };
let ring = ringFor([]);

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...kids);
  return node;
}
const button = (label: string, onClick: () => void, primary = false) => { const b = el("button", { textContent: label, type: "button" }); if (primary) b.className = "primary"; b.addEventListener("click", onClick); return b; };
function say(text: string, bad = false) { const n = $("note"); n.textContent = text; n.className = bad ? "bad" : ""; }
const saveState = () => chrome.storage.local.set({ roomPanes: panes, tileHosts });
const saveTiles = () => chrome.storage.session.set({ roomTiles: tiles });
const paneOf = (id: number) => panes.find((p) => p.id === id);

// ---- the camera --------------------------------------------------------------------------------------------------------

const perspective = () => perspectiveFor(stage.clientHeight || 700, cam.fov);

function apply() {
  const P = perspective();
  stage.style.perspective = `${P}px`;
  world.style.transform = worldTransform(cam.yaw, P, cam.back);
  for (const v of views.values()) {
    const s = shielded(cam.yaw, v.yaw, overview, direct);
    if (s !== v.shielded) { v.shielded = s; v.shield.hidden = !s; }
  }
  const w = $("wedge");
  w.style.left = `${(turn(cam.yaw) / (Math.PI * 2) + 0.5) * 100}%`;
  document.querySelectorAll<HTMLElement>("#strip .dot").forEach((d) => d.classList.toggle("here", Math.abs(turn(Number(d.dataset.yaw) - cam.yaw)) < 0.2));
}

function run() {
  if (cam.raf) return;
  let last = performance.now();
  const step = (now: number) => {
    cam.raf = 0;
    const dt = Math.min(0.05, (now - last) / 1000); // by the clock, as in Surround.tsx
    last = now;
    const k = 1 - Math.exp(-dt * 11);
    let busy = false;
    if (cam.tYaw !== null) { const d = turn(cam.tYaw - cam.yaw); cam.yaw = turn(cam.yaw + d * k); if (Math.abs(d) < 0.0015) { cam.yaw = cam.tYaw; cam.tYaw = null; } else busy = true; }
    else if (Math.abs(cam.spin) > 0.0004) { cam.yaw = turn(cam.yaw + cam.spin * dt * 60); cam.spin *= Math.exp(-dt * 4.4); busy = true; }
    else if (cam.spin !== 0) { cam.spin = 0; if (!overview) snap(); busy = cam.tYaw !== null; }
    if (cam.tFov !== null) { const d = cam.tFov - cam.fov; cam.fov += d * k; if (Math.abs(d) < 0.002) { cam.fov = cam.tFov; cam.tFov = null; } else busy = true; }
    if (cam.tBack !== null) { const d = cam.tBack - cam.back; cam.back += d * k; if (Math.abs(d) < 1) { cam.back = cam.tBack; cam.tBack = null; } else busy = true; }
    apply();
    if (busy) cam.raf = requestAnimationFrame(step);
  };
  cam.raf = requestAnimationFrame(step);
}

/** Settle on the nearest pane, like the Electron room settles on the page ahead. */
function snap() {
  const near = ring.panels.find((p) => p.id === nearestIds(ring.panels, cam.yaw, 1)[0]);
  if (near && Math.abs(turn(near.yaw - cam.yaw)) > 0.002) cam.tYaw = near.yaw;
}

function flyTo(id: number) {
  const panel = ring.panels.find((p) => p.id === String(id));
  if (!panel) return;
  cam.spin = 0; cam.tYaw = panel.yaw;
  setOverview(false);
  run(); tick();
}

function setOverview(on: boolean) {
  overview = on;
  cam.tBack = on ? overviewBack(ring.radius) : 0;
  cam.tFov = on ? FOV.max : FOV.start;
  $("over").classList.toggle("on", on);
  run();
}

function step(dir: 1 | -1) {
  const p = stepFrom(ring.panels, cam.tYaw ?? cam.yaw, dir);
  if (p) flyTo(Number(p.id));
}

// ---- keeping the ring ---------------------------------------------------------------------------------------------------

function relayout() {
  ring = ringFor(panes.map((p) => String(p.id)));
  for (const p of panes) {
    const v = views.get(p.id) ?? makePane(p);
    const panel = ring.panels.find((x) => x.id === String(p.id))!;
    v.yaw = panel.yaw;
    v.el.style.transform = paneTransform(panel.yaw, ring.radius);
    world.append(v.el);
  }
  const strip = $("strip");
  strip.querySelectorAll(".dot").forEach((d) => d.remove());
  ring.panels.forEach((panel, i) => {
    const d = el("button", { className: "dot", title: `Pane ${i + 1}: ${hostOf(paneOf(Number(panel.id))?.url ?? "") || "empty"}` });
    d.dataset.yaw = String(panel.yaw);
    d.style.left = `${(turn(panel.yaw) / (Math.PI * 2) + 0.5) * 100}%`;
    d.addEventListener("click", () => flyTo(Number(panel.id)));
    strip.append(d);
  });
  ($("add") as HTMLButtonElement).disabled = panes.length >= MAX_ROOM_PANES;
  apply();
}

function makePane(p: PaneState): RV {
  const title = el("span", { className: "t" });
  const head = el("div", { className: "head" }, title,
    button("↻", () => void start(p)), button("Window", () => void openTile(p)), button("✕", () => void removePaneAt(p)));
  head.children[1].setAttribute("title", "Reload"); head.children[2].setAttribute("title", "Show in a real browser window"); head.children[3].setAttribute("title", "Close pane");
  const overlay = el("div", { className: "overlay" });
  const shield = el("div", { className: "shield" });
  shield.dataset.id = String(p.id);
  const slot = el("div", { className: "slot" }, overlay, shield);
  const node = el("section", { className: "pane" }, head, slot);
  node.style.cssText = `width:${PANE_W}px;height:${PANE_H}px;margin:${-PANE_H / 2}px 0 0 ${-PANE_W / 2}px`;
  const v: RV = { el: node, title, slot, overlay, shield, status: "empty", message: "", outSince: null, yaw: 0, shielded: false };
  views.set(p.id, v);
  return v;
}

function teardownFrame(v: RV) {
  window.clearTimeout(v.timer);
  if (v.frame) { v.frame.src = "about:blank"; v.frame.remove(); v.frame = undefined; }
}
function stopMirror(v: RV) {
  v.stream?.getTracks().forEach((t) => t.stop()); v.stream = undefined;
  if (v.video) { v.video.srcObject = null; v.video.remove(); v.video = undefined; }
}

function setStatus(p: PaneState, status: Status, message = "") {
  const v = views.get(p.id);
  if (!v) return;
  v.status = status; v.message = message;
  paint(p);
}

// ---- rules and real windows ---------------------------------------------------------------------------------------------

async function ensureRule(p: PaneState): Promise<boolean> {
  const host = hostOf(p.url);
  const base = buildRule(p.id, host, tabId); // null for Google and sign-in hosts: never any rule
  if (!base) return false;
  if (!(await chrome.permissions.contains({ origins: [permissionPattern(host)] }))) return false;
  const rule = { ...base, id: roomRuleId(p.id) };
  await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [rule.id], addRules: [rule] });
  return true;
}
const dropRule = (id: number) => chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [roomRuleId(id)] }).catch(() => {});

async function closeWindow(p: PaneState) {
  const wid = tiles[p.id];
  delete tiles[p.id];
  await saveTiles();
  if (wid !== undefined) await chrome.windows.remove(wid).catch(() => {});
}

async function openTile(p: PaneState) {
  const v = views.get(p.id);
  if (!v || !p.url) return;
  try {
    const w = await chrome.windows.create({ url: p.url, type: "popup", width: 1100, height: 760, focused: true });
    if (tiles[p.id] !== undefined) await chrome.windows.remove(tiles[p.id]).catch(() => {});
    tiles[p.id] = w.id;
    await saveTiles();
    teardownFrame(v); stopMirror(v);
    setStatus(p, "window");
  } catch (e) { say("Could not open a window: " + (e instanceof Error ? e.message : String(e)), true); }
}

/** Live mirror: open the site in a real window, then let the user pick that window or tab to be shown on the ring (view-only). */
async function startMirror(p: PaneState) {
  const v = views.get(p.id);
  if (!v || !p.url) return;
  try {
    const w = await chrome.windows.create({ url: p.url, type: "popup", width: 1100, height: 760, focused: true });
    if (tiles[p.id] !== undefined) await chrome.windows.remove(tiles[p.id]).catch(() => {});
    tiles[p.id] = w.id;
    await saveTiles();
    say("Choose the window (or its tab) that just opened in the sharing prompt.");
    const stream: MediaStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    teardownFrame(v); stopMirror(v);
    const video = el("video", { muted: true, autoplay: true, playsInline: true, title: "Live mirror, view-only. Click to bring the real window forward." });
    video.srcObject = stream;
    video.addEventListener("click", () => { const id = tiles[p.id]; if (id !== undefined) void chrome.windows.update(id, { focused: true, state: "normal" }).catch(() => {}); });
    v.slot.prepend(video);
    v.video = video; v.stream = stream;
    stream.getVideoTracks()[0].addEventListener("ended", () => { if (v.stream === stream) { stopMirror(v); setStatus(p, tiles[p.id] !== undefined ? "window" : "tile"); } });
    setStatus(p, "mirror");
    say("");
  } catch (e) {
    // The window stays open as an ordinary tile; sharing was cancelled or refused.
    setStatus(p, tiles[p.id] !== undefined ? "window" : "tile");
    say("Mirror not started: " + (e instanceof Error ? e.message : String(e)), true);
  }
}

// ---- one pane's page ------------------------------------------------------------------------------------------------------

async function start(p: PaneState) {
  const v = views.get(p.id);
  if (!v) return;
  teardownFrame(v); stopMirror(v);
  await closeWindow(p);
  v.title.textContent = hostOf(p.url) || "empty pane";
  if (!p.url) { await dropRule(p.id); setStatus(p, "empty"); return; }
  if (tileFirst(hostOf(p.url), tileHosts)) { await dropRule(p.id); setStatus(p, "tile"); return; }
  if (p.strip && !(await ensureRule(p))) { p.strip = false; await saveState(); say("Framing is no longer allowed for this site.", true); }
  if (!p.strip) await dropRule(p.id);
  const f = el("iframe", { title: hostOf(p.url) });
  f.setAttribute("sandbox", SANDBOX);
  f.setAttribute("allow", "clipboard-write; fullscreen; autoplay; encrypted-media; picture-in-picture");
  f.addEventListener("load", () => { if (v.frame !== f) return; window.clearTimeout(v.timer); if (v.status === "loading" || v.status === "slow") setStatus(p, "ok"); });
  v.frame = f;
  v.slot.prepend(f);
  v.timer = window.setTimeout(() => { if (v.frame === f && v.status === "loading") setStatus(p, "slow", "Still loading after 15 seconds. It may be slow, or the site may be refusing to be shown here."); }, LOAD_TIMEOUT_MS);
  setStatus(p, "loading");
  f.src = p.url;
}

async function navigate(p: PaneState, raw: string) {
  const url = normalizeUrl(raw);
  if (!url) { say("That is not a web address (use https://…).", true); return; }
  p.url = url; p.strip = false;
  await saveState(); relayout();
  await start(p);
}

async function allowFraming(p: PaneState) {
  const host = hostOf(p.url);
  if (neverStrip(host)) { say("Not for Google sign-in and mail pages. Mirror or open it as a window instead.", true); return; }
  const granted = await chrome.permissions.request({ origins: [permissionPattern(host)] }); // first await after the click
  if (!granted) { say("Permission declined; nothing was changed.", true); return; }
  p.strip = true;
  await saveState();
  await start(p);
}

async function alwaysWindow(p: PaneState) {
  const host = hostOf(p.url);
  if (!tileHosts.includes(host)) tileHosts.push(host);
  await saveState();
  await openTile(p);
}

async function removePaneAt(p: PaneState) {
  const v = views.get(p.id);
  if (v) { teardownFrame(v); stopMirror(v); v.el.remove(); views.delete(p.id); }
  await dropRule(p.id);
  await closeWindow(p);
  panes = panes.filter((x) => x.id !== p.id);
  await saveState(); relayout();
}

function paint(p: PaneState) {
  const v = views.get(p.id);
  if (!v) return;
  const host = hostOf(p.url);
  v.overlay.replaceChildren();
  const card = (...kids: Node[]) => v.overlay.append(el("div", { className: "card" }, ...kids));
  const row = (...bs: HTMLElement[]) => el("div", { className: "row" }, ...bs);
  if (v.status === "empty") {
    card(el("p", { textContent: "Type an address in the bar at the top; it opens in the pane you are facing." }), row(...["pinterest.com", "github.com", "youtube.com", "mail.google.com"].map((s) => button(s, () => void navigate(p, s)))));
  } else if (v.status === "asleep") {
    card(el("strong", { textContent: host }), el("p", { textContent: "Asleep to save memory while it is out of sight. Turn to it and it reloads." }));
  } else if (v.status === "tile") {
    const google = tileFirst(host) && !tileHosts.includes(host);
    card(
      el("strong", { textContent: host }),
      el("p", { textContent: google ? "Google keeps its mail and account pages out of frames on purpose, and AetherDeck does not try to get around that. Mirror it here live (view-only; you type in the real window), or just use it as a window." : "This site is set to open as a real window." }),
      row(button("Mirror here (live, view-only)", () => void startMirror(p), true), button("Open as window", () => void openTile(p))),
    );
  } else if (v.status === "window") {
    card(el("strong", { textContent: host }), el("p", { textContent: "Open in its own browser window. Closing this pane closes the window." }),
      row(button("Mirror here", () => void startMirror(p), true), button("Focus window", () => { const w = tiles[p.id]; if (w !== undefined) void chrome.windows.update(w, { focused: true }).catch(() => {}); }), button("Close window", () => void closeWindow(p).then(() => setStatus(p, "tile")))));
  } else if (v.status === "mirror") {
    const hint = el("div", { className: "hint" }, el("span", { textContent: "Live mirror, view-only. Click the picture to bring the real window forward." }), button("Stop mirror", () => { stopMirror(v); setStatus(p, tiles[p.id] !== undefined ? "window" : "tile"); }));
    v.overlay.append(hint);
  } else if (v.status === "slow" || v.status === "blocked") {
    const hint = el("div", { className: "hint" }, el("span", { textContent: v.message + (p.strip && v.status === "blocked" ? " Still refused with framing allowed." : "") }));
    if (!neverStrip(host) && !p.strip) hint.append(button("Allow framing for this site", () => void allowFraming(p)));
    hint.append(button("Open as window", () => void openTile(p), true), button("Always as window", () => void alwaysWindow(p)));
    v.overlay.append(hint);
  }
}

// ---- awake and asleep ---------------------------------------------------------------------------------------------------

/** Once a second: the nearest MAX_AWAKE panes to where the camera is going keep a live page; the rest are dropped after a grace period. */
function tick() {
  const now = Date.now();
  const want = new Set(nearestIds(ring.panels, cam.tYaw ?? cam.yaw, MAX_AWAKE));
  for (const p of panes) {
    const v = views.get(p.id);
    if (!v) continue;
    if (want.has(String(p.id))) {
      v.outSince = null;
      if (v.status === "asleep") void start(p);
    } else {
      v.outSince ??= now;
      if (v.frame && sleepDue(v.outSince, now)) { teardownFrame(v); setStatus(p, "asleep"); }
    }
  }
  const awake = [...views.values()].filter((v) => v.frame).length;
  const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
  $("meter").textContent = `${awake} live of ${panes.length} panes · max ${MAX_AWAKE} live` + (mem ? ` · this page's JS heap ${(mem.usedJSHeapSize / 1048576).toFixed(0)} MB (not the sites'; see Task Manager)` : "");
}

// ---- opening things -----------------------------------------------------------------------------------------------------

function openUrl(url: string): boolean {
  if (panes.length >= MAX_ROOM_PANES) { say(`The Room holds ${MAX_ROOM_PANES} panes; close one first.`, true); return false; }
  panes = addRoomPane(panes, url);
  const p = panes[panes.length - 1];
  void saveState(); relayout();
  void start(p);
  flyTo(p.id);
  return true;
}

/** From the address box, the omnibox keyword or ?open=: an address becomes a pane; anything else goes to the research map. */
async function openText(text: string) {
  const url = normalizeUrl(text);
  if (url) { openUrl(url); return; }
  if (!text.trim()) return;
  const s = (await chrome.storage.local.get("server")).server;
  const server = typeof s === "string" && /^https?:\/\//.test(s) ? s.replace(/\/+$/, "") : "http://127.0.0.1:8787";
  await chrome.tabs.create({ url: `${server}/?q=${encodeURIComponent(text.trim().slice(0, 400))}` });
}

chrome.runtime.onMessage.addListener((m: { room?: string; to?: number; url?: string; text?: string }, _sender: unknown, send: (r: unknown) => void) => {
  if (!m || typeof m !== "object" || typeof m.room !== "string") return;
  if (m.to !== undefined && m.to !== tabId) return;
  switch (m.room) {
    case "open-pane": { const url = normalizeUrl(String(m.url ?? "")); send({ ok: url ? openUrl(url) : false }); break; }
    case "open": void openText(String(m.text ?? "")); send({ ok: true }); break;
    case "next": step(1); break;
    case "prev": step(-1); break;
    case "overview": setOverview(!overview); break;
  }
});

// ---- finding out that a frame was refused ---------------------------------------------------------------------------------

function onFrameError(d: { tabId: number; frameId: number; parentFrameId: number; url: string; error: string }) {
  if (d.tabId !== tabId || d.frameId === 0 || d.parentFrameId !== 0 || d.error === "net::ERR_ABORTED") return;
  const host = hostOf(d.url);
  const p = panes.find((x) => x.url && views.get(x.id)?.frame && (hostMatches(host, hostOf(x.url)) || hostMatches(hostOf(x.url), host)));
  if (!p) return;
  setStatus(p, "blocked", /BLOCKED_BY_RESPONSE|BLOCKED_BY_CLIENT/.test(d.error) ? "This site refuses to be shown inside another page." : `The page could not load (${d.error.replace(/^net::/, "")}).`);
}

async function initDetect() {
  const slot = $("detect");
  if (await chrome.permissions.contains({ permissions: ["webNavigation"] })) {
    chrome.webNavigation.onErrorOccurred.addListener(onFrameError);
    slot.textContent = "Blocked-site detection and links-as-panes: on";
    slot.className = "ok";
    return;
  }
  slot.replaceChildren(button("Turn on links-as-panes and blocked-site detection", async () => { if (await chrome.permissions.request({ permissions: ["webNavigation"] })) location.reload(); }));
}

// ---- controls -----------------------------------------------------------------------------------------------------------------

$("go").addEventListener("submit", (e) => { e.preventDefault(); const i = $("addr") as HTMLInputElement; void openText(i.value); i.value = ""; });
$("prev").addEventListener("click", () => step(-1));
$("next").addEventListener("click", () => step(1));
$("over").addEventListener("click", () => setOverview(!overview));
$("direct").addEventListener("click", () => { direct = !direct; $("direct").textContent = `Direct: ${direct ? "on" : "off"}`; $("direct").classList.toggle("on", direct); apply(); });
$("add").addEventListener("click", () => { if (panes.length >= MAX_ROOM_PANES) return; panes = addRoomPane(panes); void saveState(); relayout(); const p = panes[panes.length - 1]; void start(p); flyTo(p.id); });

// Keys reach this page only while the focus is on it, not inside a pane; the extension's keyboard shortcuts work either way.
document.addEventListener("keydown", (e) => {
  if ((e.target as HTMLElement).tagName === "INPUT" || e.metaKey || e.ctrlKey) return;
  if (e.key === "ArrowRight") step(1);
  else if (e.key === "ArrowLeft") step(-1);
  else if (e.key === "0" || e.key.toLowerCase() === "o") setOverview(!overview);
  else if (/^[1-9]$/.test(e.key)) { const p = panes[Number(e.key) - 1]; if (p) flyTo(p.id); }
  else if (e.key === "+" || e.key === "=") { cam.tFov = clampFov((cam.tFov ?? cam.fov) - 0.1); run(); }
  else if (e.key === "-") { cam.tFov = clampFov((cam.tFov ?? cam.fov) + 0.1); run(); }
  else if (e.key.toLowerCase() === "d") $("direct").click();
  else return;
  e.preventDefault();
});

// Wheel over the empty background or a shielded pane zooms; over the pane in use it scrolls the page, as it should.
stage.addEventListener("wheel", (e) => { e.preventDefault(); cam.tFov = clampFov((cam.tFov ?? cam.fov) + e.deltaY * 0.0012); run(); }, { passive: false });

// Drag the background (or a shielded pane) to look around; a click on a shielded pane turns to it.
let drag: { x: number; moved: boolean; target: EventTarget | null; lastX: number; lastT: number } | null = null;
stage.addEventListener("pointerdown", (e) => {
  const t = e.target as HTMLElement;
  if (t !== stage && t !== world && !t.classList.contains("shield")) return; // buttons, cards and the mirror keep their own clicks
  drag = { x: e.clientX, moved: false, target: e.target, lastX: e.clientX, lastT: e.timeStamp };
});
stage.addEventListener("pointermove", (e) => {
  if (!drag) return;
  if (!drag.moved && Math.abs(e.clientX - drag.x) < 5) return;
  if (!drag.moved) { stage.setPointerCapture(e.pointerId); cam.tYaw = null; cam.spin = 0; }
  drag.moved = true;
  const dx = e.clientX - drag.lastX;
  const dy = yawForDrag(dx, perspective());
  cam.yaw = turn(cam.yaw + dy);
  const dt = Math.max(1, e.timeStamp - drag.lastT);
  cam.spin = Math.max(-0.08, Math.min(0.08, (dy / dt) * 16));
  drag.lastX = e.clientX; drag.lastT = e.timeStamp;
  apply();
});
stage.addEventListener("pointerup", (e) => {
  const d = drag; drag = null;
  if (!d) return;
  if (stage.hasPointerCapture(e.pointerId)) stage.releasePointerCapture(e.pointerId);
  if (!d.moved) {
    const id = (d.target as HTMLElement | null)?.dataset?.id;
    if (id) flyTo(Number(id));
    return;
  }
  if (overview) { cam.spin = 0; return; }
  run(); // coast, then settle on the nearest pane
  if (Math.abs(cam.spin) <= 0.0004) { cam.spin = 1e-9; run(); }
});
addEventListener("resize", () => apply());
addEventListener("pagehide", () => { for (const p of panes) void dropRule(p.id); for (const v of views.values()) stopMirror(v); }); // windows stay; rules and mirrors never outlive the page

chrome.windows.onRemoved.addListener((wid: number) => {
  const id = Object.keys(tiles).map(Number).find((k) => tiles[k] === wid);
  if (id === undefined) return;
  delete tiles[id]; void saveTiles();
  const p = paneOf(id), v = views.get(id);
  if (p && v && (v.status === "window" || v.status === "mirror")) { stopMirror(v); setStatus(p, "tile"); }
});

(async function init() {
  tabId = (await chrome.tabs.getCurrent())?.id ?? -1;
  const old: { id: number }[] = await chrome.declarativeNetRequest.getSessionRules();
  const stale = old.map((r) => r.id).filter(isRoomRuleId);
  if (stale.length) await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: stale }); // left by an earlier Room page
  const s = await chrome.storage.local.get(["roomPanes", "tileHosts"]);
  tileHosts = Array.isArray(s.tileHosts) ? s.tileHosts.filter((h: unknown): h is string => typeof h === "string") : [];
  panes = Array.isArray(s.roomPanes) ? s.roomPanes.filter((p: PaneState) => Number.isInteger(p?.id) && typeof p.url === "string").slice(0, MAX_ROOM_PANES).map((p: PaneState) => ({ id: p.id, url: p.url, strip: !!p.strip })) : [];
  const kept: Record<number, number> = ((await chrome.storage.session.get("roomTiles")).roomTiles as Record<number, number> | undefined) ?? {};
  for (const [pid, wid] of Object.entries(kept)) { try { await chrome.windows.get(wid); if (panes.some((p) => p.id === Number(pid))) tiles[Number(pid)] = wid; } catch { /* gone */ } }
  await saveTiles();
  const open = new URLSearchParams(location.search).get("open");
  if (open) history.replaceState(null, "", location.pathname);
  if (!panes.length && !open) panes = addRoomPane(addRoomPane(addRoomPane([]))); // three empty panes with one-click suggestions
  relayout();
  const first = new Set(nearestIds(ring.panels, 0, MAX_AWAKE));
  for (const p of panes) {
    if (tiles[p.id] !== undefined) setStatus(p, "window");
    else if (first.has(String(p.id)) || !p.url) void start(p);
    else { views.get(p.id)!.title.textContent = hostOf(p.url) || "empty pane"; setStatus(p, "asleep"); }
  }
  if (open) await openText(open);
  apply();
  void initDetect();
  setInterval(tick, 1000);
  tick();
})();
