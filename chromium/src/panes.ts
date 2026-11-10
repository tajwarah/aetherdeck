// AetherDeck Panes: two to four real sites side by side on one extension page, each in its own frame with an address bar.
// Sites that refuse to be framed can get (a) a narrow, per-site, per-tab rule that removes their framing headers, after the
// user asks for it, or (b) a real browser window placed over the pane's slot ("tile"). The rules themselves live in
// panesLogic.ts; this file is the page that uses them. Nothing here talks to the AetherDeck server.
import { addPane, buildRule, gridCols, hostMatches, hostOf, isPaneRuleId, MAX_PANES, neverStrip, normalizeUrl, permissionPattern, removePane, ruleIdFor, tileBounds, tileFirst, type PaneState } from "./panesLogic.ts";
import "./panes.css";

// The project has no @types/chrome; the few calls used here are all in this file.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const chrome: any;

const LOAD_TIMEOUT_MS = 15_000;
const SUGGESTIONS = ["pinterest.com", "github.com", "youtube.com", "mail.google.com"];

type Status = "empty" | "loading" | "ok" | "slow" | "blocked" | "tile" | "window";
interface View {
  section: HTMLElement;
  input: HTMLInputElement;
  slot: HTMLElement;
  overlay: HTMLElement;
  frame?: HTMLIFrameElement;
  status: Status;
  message: string;
  timer?: number;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const grid = $("grid");
let panes: PaneState[] = [];
let tileHosts: string[] = [];
let tiles: Record<number, number> = {}; // pane id → id of the browser window standing in for it
let tabId = -1;
const views = new Map<number, View>();

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...kids);
  return node;
}
const button = (label: string, onClick: () => void, primary = false) => {
  const b = el("button", { textContent: label, type: "button" });
  if (primary) b.className = "primary";
  b.addEventListener("click", onClick);
  return b;
};
function say(text: string, bad = false) { const n = $("note"); n.textContent = text; n.className = bad ? "bad" : ""; }

const saveState = () => chrome.storage.local.set({ panes, tileHosts });
const saveTiles = () => chrome.storage.session.set({ tiles });
const paneOf = (id: number) => panes.find((p) => p.id === id);

// ---- the header-removal rule (one per pane, only after "Allow framing") -------------------------------------------------

async function ensureRule(p: PaneState): Promise<boolean> {
  const host = hostOf(p.url);
  const rule = buildRule(p.id, host, tabId);
  if (!rule) return false;
  if (!(await chrome.permissions.contains({ origins: [permissionPattern(host)] }))) return false;
  await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [rule.id], addRules: [rule] });
  return true;
}
const dropRule = (id: number) => chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [ruleIdFor(id)] }).catch(() => {});
async function sweepRules() {
  const old: { id: number }[] = await chrome.declarativeNetRequest.getSessionRules();
  const ids = old.map((r) => r.id).filter(isPaneRuleId);
  if (ids.length) await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: ids });
}

// ---- real windows standing in for panes -------------------------------------------------------------------------------

function slotBounds(v: View) {
  const r = v.slot.getBoundingClientRect();
  return tileBounds({ left: r.left, top: r.top, width: r.width, height: r.height }, window);
}

async function openTile(p: PaneState) {
  const v = views.get(p.id);
  if (!v || !p.url) return;
  try {
    const b = slotBounds(v);
    const w = await chrome.windows.create({ url: p.url, type: "popup", left: b.left, top: b.top, width: b.width, height: b.height, focused: true });
    if (tiles[p.id]) await chrome.windows.remove(tiles[p.id]).catch(() => {});
    tiles[p.id] = w.id;
    await saveTiles();
    teardownFrame(v);
    setStatus(p, "window", "");
  } catch (e) { say("Could not open a window: " + (e instanceof Error ? e.message : String(e)), true); }
}

async function closeTile(p: PaneState) {
  const wid = tiles[p.id];
  delete tiles[p.id];
  await saveTiles();
  if (wid !== undefined) await chrome.windows.remove(wid).catch(() => {});
}

async function tidy() {
  let moved = 0;
  for (const p of panes) {
    const wid = tiles[p.id], v = views.get(p.id);
    if (wid === undefined || !v) continue;
    const b = slotBounds(v);
    try { await chrome.windows.update(wid, { left: b.left, top: b.top, width: b.width, height: b.height, state: "normal" }); moved++; }
    catch { delete tiles[p.id]; setStatus(p, "tile", ""); }
  }
  await saveTiles();
  say(moved ? `Placed ${moved} window${moved === 1 ? "" : "s"} over their panes.` : "No pane windows are open.");
}

// ---- one pane ---------------------------------------------------------------------------------------------------------

function teardownFrame(v: View) {
  window.clearTimeout(v.timer);
  if (v.frame) { v.frame.src = "about:blank"; v.frame.remove(); v.frame = undefined; }
}

function setStatus(p: PaneState, status: Status, message: string) {
  const v = views.get(p.id);
  if (!v) return;
  v.status = status; v.message = message;
  paint(p);
}

async function start(p: PaneState) {
  const v = views.get(p.id);
  if (!v) return;
  teardownFrame(v);
  await closeTile(p);
  v.input.value = p.url;
  if (!p.url) { await dropRule(p.id); setStatus(p, "empty", ""); return; }
  if (tileFirst(hostOf(p.url), tileHosts)) { await dropRule(p.id); setStatus(p, "tile", ""); return; }
  if (p.strip && !(await ensureRule(p))) { p.strip = false; await saveState(); say("Framing is no longer allowed for this site; press Allow framing to turn it on again.", true); }
  if (!p.strip) await dropRule(p.id);
  const f = el("iframe", { title: hostOf(p.url) });
  f.setAttribute("allow", "clipboard-write; fullscreen");
  f.addEventListener("load", () => { if (v.frame !== f) return; window.clearTimeout(v.timer); if (v.status === "loading" || v.status === "slow") setStatus(p, "ok", ""); });
  v.frame = f;
  v.slot.prepend(f);
  v.timer = window.setTimeout(() => { if (v.frame === f && v.status === "loading") setStatus(p, "slow", "Still loading after 15 seconds. It may be slow, or the site may be refusing to be shown here."); }, LOAD_TIMEOUT_MS);
  setStatus(p, "loading", "");
  f.src = p.url;
}

async function navigate(p: PaneState, raw: string) {
  const url = normalizeUrl(raw);
  if (!url) { say("That is not a web address (use https://…).", true); return; }
  p.url = url; p.strip = false;
  await saveState();
  await start(p);
}

async function allowFraming(p: PaneState) {
  const host = hostOf(p.url);
  if (neverStrip(host)) { say("Not for Google sign-in and mail pages. Open this one as a window instead.", true); return; }
  // Must be the first await after the click, or the browser will not show the permission prompt.
  const granted = await chrome.permissions.request({ origins: [permissionPattern(host)] });
  if (!granted) { say("Permission declined; nothing was changed.", true); return; }
  p.strip = true;
  await saveState();
  await start(p);
}

async function alwaysWindow(p: PaneState) {
  const host = hostOf(p.url);
  if (!tileHosts.includes(host)) tileHosts.push(host);
  await saveState();
  paintFooter();
  await openTile(p);
}

async function removePaneAt(p: PaneState) {
  const v = views.get(p.id);
  if (v) { teardownFrame(v); v.section.remove(); views.delete(p.id); }
  await dropRule(p.id);
  await closeTile(p);
  panes = removePane(panes, p.id);
  await saveState();
  layout();
}

function paint(p: PaneState) {
  const v = views.get(p.id);
  if (!v) return;
  const host = hostOf(p.url);
  v.overlay.replaceChildren();
  const card = (...kids: Node[]) => v.overlay.append(el("div", { className: "card" }, ...kids));
  const row = (...bs: HTMLElement[]) => el("div", { className: "row" }, ...bs);
  const canStrip = !neverStrip(host);
  if (v.status === "empty") {
    card(el("p", { textContent: "Type an address above, or try one:" }), row(...SUGGESTIONS.map((s) => button(s, () => void navigate(p, s)))));
  } else if (v.status === "tile") {
    const google = tileFirst(host) && !tileHosts.includes(host);
    card(
      el("strong", { textContent: host }),
      el("p", { textContent: google ? "Google keeps its mail and account pages out of frames on purpose, and AetherDeck does not try to get around that. Open it as a real window instead: it is placed over this pane and signs in like any browser tab." : "This site is set to open as a real window instead of a frame." }),
      row(button("Open as window", () => void openTile(p), true), ...(google ? [] : [button("Try in this pane", () => { tileHosts = tileHosts.filter((h) => !hostMatches(host, h)); void saveState().then(() => { paintFooter(); return start(p); }); })])),
    );
  } else if (v.status === "window") {
    card(
      el("strong", { textContent: host }),
      el("p", { textContent: "Open in its own window, placed over this pane. Closing this pane closes the window; Tidy windows puts it back here." }),
      row(button("Focus window", () => { const w = tiles[p.id]; if (w !== undefined) void chrome.windows.update(w, { focused: true }).catch(() => {}); }, true), button("Close window", () => void closeTile(p).then(() => setStatus(p, "tile", "")))),
    );
  } else if (v.status === "slow" || v.status === "blocked") {
    const msg = el("span", { textContent: v.message });
    const hint = el("div", { className: "hint" }, msg);
    if (canStrip && !p.strip) hint.append(button("Allow framing for this site", () => void allowFraming(p)));
    if (p.strip && v.status === "blocked") msg.textContent += " It is still refused with framing allowed.";
    hint.append(button("Open as window", () => void openTile(p), true), button("Always as window", () => void alwaysWindow(p)));
    v.overlay.append(hint);
  }
}

function makePane(p: PaneState): View {
  const input = el("input", { type: "text", placeholder: "Address, e.g. github.com", spellcheck: false });
  input.setAttribute("aria-label", "Address");
  const form = el("form", {}, input);
  const slot = el("div", { className: "slot" });
  const overlay = el("div", { className: "overlay" });
  slot.append(overlay);
  const bar = el("div", { className: "bar" }, form,
    button("↻", () => void start(p)),
    button("Window", () => void openTile(p)),
    button("Close pane", () => void removePaneAt(p)));
  bar.children[1].setAttribute("title", "Reload");
  bar.children[2].setAttribute("title", "Show this site in a real browser window over this pane");
  const section = el("section", { className: "pane" }, bar, slot);
  form.addEventListener("submit", (e) => { e.preventDefault(); void navigate(p, input.value); });
  return { section, input, slot, overlay, status: "empty", message: "" };
}

function layout() {
  grid.style.gridTemplateColumns = `repeat(${gridCols(panes.length)}, minmax(0, 1fr))`;
  for (const p of panes) {
    if (!views.has(p.id)) {
      const v = makePane(p);
      views.set(p.id, v);
      if (tiles[p.id] !== undefined) { v.input.value = p.url; setStatus(p, "window", ""); } // its window survived a reload of this page: keep it
      else void start(p);
    }
    grid.append(views.get(p.id)!.section); // appending an existing node moves it, so order follows the list without reloading frames
  }
  ($("add") as HTMLButtonElement).disabled = panes.length >= MAX_PANES;
}

function paintFooter() {
  const foot = $("foot");
  foot.replaceChildren();
  if (!tileHosts.length) return;
  foot.append("Always opened as windows:");
  for (const h of tileHosts) {
    const chip = el("span", { className: "chip" }, h, button("×", () => { tileHosts = tileHosts.filter((x) => x !== h); void saveState().then(paintFooter); }));
    chip.lastElementChild?.setAttribute("title", "Stop doing this for " + h);
    foot.append(chip);
  }
}

// ---- finding out that a frame was refused -------------------------------------------------------------------------------

function onFrameError(d: { tabId: number; frameId: number; parentFrameId: number; url: string; error: string }) {
  // Only frames that sit directly on this page (the panes), and not a navigation that was simply replaced by another.
  if (d.tabId !== tabId || d.frameId === 0 || d.parentFrameId !== 0 || d.error === "net::ERR_ABORTED") return;
  const host = hostOf(d.url);
  const p = panes.find((x) => x.url && views.get(x.id)?.frame && (hostMatches(host, hostOf(x.url)) || hostMatches(hostOf(x.url), host)));
  if (!p) return;
  const refused = /BLOCKED_BY_RESPONSE|BLOCKED_BY_CLIENT/.test(d.error);
  setStatus(p, "blocked", refused ? "This site refuses to be shown inside another page." : `The page could not load (${d.error.replace(/^net::/, "")}).`);
}

async function initDetect() {
  const slot = $("detect");
  const on = await chrome.permissions.contains({ permissions: ["webNavigation"] });
  if (on) {
    chrome.webNavigation.onErrorOccurred.addListener(onFrameError);
    slot.textContent = "Blocked-site detection: on";
    slot.className = "ok";
    return;
  }
  slot.replaceChildren(button("Turn on blocked-site detection", async () => {
    if (await chrome.permissions.request({ permissions: ["webNavigation"] })) { slot.textContent = "Reloading…"; location.reload(); }
  }));
}

// ---- start up -----------------------------------------------------------------------------------------------------------

$("add").addEventListener("click", () => { panes = addPane(panes); void saveState(); layout(); });
$("tidy").addEventListener("click", () => void tidy());
addEventListener("pagehide", () => { for (const p of panes) void dropRule(p.id); }); // the windows stay; the rules never outlive the page

chrome.windows.onRemoved.addListener((wid: number) => {
  const id = Object.keys(tiles).map(Number).find((k) => tiles[k] === wid);
  if (id === undefined) return;
  delete tiles[id];
  void saveTiles();
  const p = paneOf(id);
  if (p && views.get(id)?.status === "window") setStatus(p, "tile", "");
});

(async function init() {
  const tab = await chrome.tabs.getCurrent();
  tabId = tab?.id ?? -1;
  await sweepRules(); // rules left by an earlier copy of this page belong to a tab that no longer exists
  const s = await chrome.storage.local.get(["panes", "tileHosts"]);
  tileHosts = Array.isArray(s.tileHosts) ? s.tileHosts.filter((h: unknown): h is string => typeof h === "string") : [];
  panes = Array.isArray(s.panes) ? s.panes.filter((p: PaneState) => Number.isInteger(p?.id) && typeof p.url === "string").slice(0, MAX_PANES).map((p: PaneState) => ({ id: p.id, url: p.url, strip: !!p.strip })) : [];
  if (!panes.length) panes = addPane(addPane([]));
  const kept: Record<number, number> = ((await chrome.storage.session.get("tiles")).tiles as Record<number, number> | undefined) ?? {};
  for (const [pid, wid] of Object.entries(kept)) { try { await chrome.windows.get(wid); if (panes.some((p) => p.id === Number(pid))) tiles[Number(pid)] = wid; } catch { /* that window is gone */ } }
  await saveTiles();
  paintFooter();
  layout();
  void initDetect();
})();
