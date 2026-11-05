// Curved pages: a maximized window's page renders offscreen, and each frame goes to the interface as a GPU
// texture to be wrapped on a curved screen (electron/curve-gl.ts). The person's clicks, scrolling and typing
// come back mapped through the curve and are delivered to the page as real input. One offscreen page per
// curved window, in the same browsing session as every other window, so sign-ins carry over.
import { BrowserWindow, ipcMain, Menu, sharedTexture, type WebContents } from "electron";

interface Curved { osr: BrowserWindow; inFlight: number; input: Promise<unknown> }

const CURSORS: Record<string, string> = { pointer: "default", hand: "pointer", ibeam: "text", wait: "wait", progress: "progress", crosshair: "crosshair", move: "move", "not-allowed": "not-allowed", grab: "grab", grabbing: "grabbing", "e-resize": "ew-resize", "w-resize": "ew-resize", "n-resize": "ns-resize", "s-resize": "ns-resize", "ew-resize": "ew-resize", "ns-resize": "ns-resize", "col-resize": "col-resize", "row-resize": "row-resize", help: "help", "zoom-in": "zoom-in", "zoom-out": "zoom-out" };

/**
 * Pages in the room are drawn at most of the screen's sharpness, not all of it: a page hangs on the wall at about three
 * quarters of its own size (shared/surround.ts), so at 0.8 its text still meets the screen's pixels one to one, and
 * each frame has a third fewer pixels to draw, copy and upload.
 */
const ROOM_SHARPNESS = 0.8;
/** Linux's shared textures depend on the driver, so frames there are copied through the CPU: slower, but sure. */
const sharedFrames = () => process.platform !== "linux" && !process.env.AETHERDECK_CURVE_COPY;

export function curvedPages(deps: { host: () => BrowserWindow | null; setUpPage: (wc: WebContents) => void; partitions: Set<string> }) {
  const all = new Map<string, Curved>();
  let room: { w: number; h: number } | null = null; // while the 360° view is open, every page is this size
  const skipRelease = new Set<string>(); // a press that opened a <select>'s menu: its release goes nowhere
  // What is under the pointer, looked up while it moves, so a press on anything but a <select> goes straight through
  // instead of waiting on the page to say what it is.
  const hover = new Map<string, { x: number; y: number; select: boolean; at: number }>();
  const looking = new Set<string>();
  const lookUnder = (id: string, wc: WebContents, x: number, y: number) => {
    const h = hover.get(id);
    if (looking.has(id) || (h && h.x === x && h.y === y) || (h && Date.now() - h.at < 80)) return;
    looking.add(id);
    const code = `!!document.elementFromPoint(${x}, ${y})?.closest("select")`;
    void Promise.race([wc.executeJavaScriptInIsolatedWorld(1999, [{ code }]).catch(() => null), new Promise((r) => setTimeout(() => r(null), 250))])
      .then((select) => { if (typeof select === "boolean") hover.set(id, { x, y, select, at: Date.now() }); })
      .finally(() => looking.delete(id));
  };
  // Frames on their way to the interface, by number: each is released only when its own drawing is done.
  const drawing = new Map<number, (token: unknown) => void>();
  let frames = 0;
  ipcMain.on("curve:done", (_e, seq: number, token: unknown) => { drawing.get(seq)?.(token); });
  const send = (channel: string, ...args: unknown[]) => deps.host()?.webContents.send(channel, ...args);
  const state = (id: string, extra: Record<string, unknown> = {}) => {
    const wc = all.get(id)?.osr.webContents;
    if (!wc || wc.isDestroyed()) return;
    send("curve:state", { id, url: wc.getURL(), title: wc.getTitle(), back: wc.navigationHistory.canGoBack(), fwd: wc.navigationHistory.canGoForward(), loading: wc.isLoading(), ...extra });
  };

  ipcMain.handle("curve:open", (_e, id: string, url: string, w: number, h: number, scale: number, partition: string) => {
    if (!/^(https?|agent-app):\/\//i.test(url) || !deps.partitions.has(partition)) return false;
    all.get(id)?.osr.destroy(); // the interface reloaded: its window starts over
    all.delete(id);
    const size = room ?? { w, h };
    const osr = new BrowserWindow({
      // Never full screen: on macOS a hidden window that goes full screen gets a Space of its own, and the person is
      // taken to it: an empty screen. A page's own full-screen button (a video's) fills its panel instead.
      show: false, frame: false, skipTaskbar: true, fullscreenable: false, width: Math.max(200, Math.round(size.w)), height: Math.max(150, Math.round(size.h)),
      webPreferences: { partition, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, offscreen: { useSharedTexture: sharedFrames(), deviceScaleFactor: sharedFrames() ? Math.min(3, Math.max(1, scale * ROOM_SHARPNESS)) : 1 } },
    });
    const wc = osr.webContents;
    wc.setFrameRate(sharedFrames() ? 60 : 30);
    deps.setUpPage(wc);
    const c: Curved = { osr, inFlight: 0, input: Promise.resolve() };
    all.set(id, c);
    wc.on("paint", async (e, _dirty, image) => {
      const tex = e.texture;
      if (!tex) {
        // A repaint can come with an empty image beside the real frame; drawn, it would blank the page.
        if (image.isEmpty()) return;
        const size = image.getSize();
        deps.host()?.webContents.send("curve:bitmap", id, size.width, size.height, image.toBitmap());
        return;
      }
      const host = deps.host();
      // Two frames in flight at most: a page that paints faster than the screen drops the in-between ones.
      if (!host || tex.textureInfo.widgetType !== "frame" || c.inFlight >= 2) { tex.release(); return; }
      c.inFlight++;
      try {
        const imported = sharedTexture.subtle.importSharedTexture(tex.textureInfo);
        const seq = ++frames;
        const token = await new Promise<unknown>((resolve) => {
          const timer = setTimeout(() => { drawing.delete(seq); resolve(null); }, 1000);
          drawing.set(seq, (t) => { clearTimeout(timer); drawing.delete(seq); resolve(t); });
          host.webContents.send("curve:frame", id, seq, imported.startTransferSharedTexture());
        });
        if (token && typeof token === "object" && "syncToken" in token) imported.setReleaseSyncToken(token as never);
        imported.release(() => tex.release());
      } catch {
        tex.release();
      } finally {
        c.inFlight--;
      }
    });
    wc.on("cursor-changed", (_e, type) => send("curve:cursor", { id, cursor: CURSORS[type] ?? "default" }));
    for (const ev of ["did-start-loading", "did-stop-loading", "did-navigate", "did-navigate-in-page", "page-title-updated"] as const) wc.on(ev as "did-stop-loading", () => state(id));
    wc.on("page-favicon-updated", (_e, icons) => state(id, { icon: icons[0] }));
    wc.on("did-fail-load", (_e, code, text, failed, main) => { if (main && code !== -3) state(id, { error: { code, text, url: failed } }); });
    wc.on("render-process-gone", (_e, d) => { if (d.reason !== "clean-exit") state(id, { gone: true }); });
    wc.on("found-in-page", (_e, r) => send("curve:found", { id, active: r.activeMatchOrdinal, total: r.matches }));
    // The page's own full-screen button (a video's, say) fills the curved screen; this window stays out of sight.
    wc.on("enter-html-full-screen", () => { if (osr.isFullScreen()) osr.setFullScreen(false); if (osr.isVisible()) osr.hide(); send("curve:fullscreen", { id, on: true }); });
    osr.on("enter-full-screen", () => osr.setFullScreen(false));
    wc.on("leave-html-full-screen", () => send("curve:fullscreen", { id, on: false }));
    osr.on("show", () => osr.hide());
    void wc.loadURL(url).catch(() => undefined);
    return wc.id;
  });

  const fit = (c: Curved | undefined, w: number, h: number) => c?.osr.setContentSize(Math.max(200, Math.round(w)), Math.max(150, Math.round(h)));
  ipcMain.handle("curve:resize", (_e, id: string, w: number, h: number) => { if (!room) fit(all.get(id), w, h); });
  ipcMain.handle("curve:room", (_e, size: { w: number; h: number } | null) => {
    room = size;
    if (room) for (const c of all.values()) fit(c, room.w, room.h);
  });

  // A tab behind you keeps running (and playing) but draws nothing, so the tabs you can see get the computer.
  ipcMain.handle("curve:rate", (_e, id: string, fps: number) => {
    const wc = all.get(id)?.osr.webContents;
    if (!wc || wc.isDestroyed()) return;
    if (!fps) return wc.stopPainting();
    if (!wc.isPainting()) wc.startPainting();
    wc.setFrameRate(sharedFrames() ? fps : Math.min(30, fps));
    wc.invalidate();
  });

  // Input arrives already mapped through the curve, in page coordinates.
  // Input stays in order: a press that stops to look for a <select> must not be overtaken by its own release.
  ipcMain.handle("curve:input", (_e, id: string, event: Electron.MouseInputEvent | Electron.MouseWheelInputEvent | Electron.KeyboardInputEvent) => {
    const c = all.get(id);
    if (!c) return;
    c.input = c.input.then(async () => {
      const wc = c.osr.webContents;
      if (wc.isDestroyed()) return;
      if (event.type === "mouseMove") { const m = event as Electron.MouseInputEvent; lookUnder(id, wc, m.x, m.y); }
      if (event.type === "mouseDown") {
        wc.focus();
        const m = event as Electron.MouseInputEvent;
        const h = hover.get(id);
        const plain = h && !h.select && Math.abs(h.x - m.x) <= 4 && Math.abs(h.y - m.y) <= 4; // known not to be a <select>
        if (m.button !== "right" && !plain && await chooseFromSelect(wc, m.x, m.y)) { skipRelease.add(id); return; }
      }
      if (event.type === "mouseUp" && skipRelease.delete(id)) return;
      wc.sendInputEvent(event);
    }).catch(() => undefined);
  });

  // A <select>'s list is a separate popup that an offscreen page can't place on the curve, so it opens as a menu.
  async function chooseFromSelect(wc: WebContents, x: number, y: number) {
    const look = `(() => { const s = document.elementFromPoint(${x}, ${y})?.closest("select"); if (!s || s.disabled || s.multiple || s.size > 1) return null;
      return [...s.options].map((o, i) => ({ i, label: o.label || o.text, on: i === s.selectedIndex, off: o.disabled })); })()`;
    // A page too busy to answer quickly just gets its click.
    const options = await Promise.race([wc.executeJavaScriptInIsolatedWorld(1999, [{ code: look }]).catch(() => null), new Promise((r) => setTimeout(() => r(null), 120))]) as { i: number; label: string; on: boolean; off: boolean }[] | null;
    if (!options) return false;
    const pick = (i: number) => void wc.executeJavaScriptInIsolatedWorld(1999, [{ code: `(() => { const s = document.elementFromPoint(${x}, ${y})?.closest("select"); if (s) { s.selectedIndex = ${i}; s.dispatchEvent(new Event("input", { bubbles: true })); s.dispatchEvent(new Event("change", { bubbles: true })); } })()` }]);
    Menu.buildFromTemplate(options.map((o) => ({ label: o.label, type: "checkbox" as const, checked: o.on, enabled: !o.off, click: () => pick(o.i) }))).popup({ window: deps.host() ?? undefined });
    return true;
  }

  ipcMain.handle("curve:nav", (_e, id: string, action: string, arg?: string) => {
    const wc = all.get(id)?.osr.webContents;
    if (!wc || wc.isDestroyed()) return;
    const h = wc.navigationHistory;
    switch (action) {
      case "back": if (h.canGoBack()) h.goBack(); break;
      case "forward": if (h.canGoForward()) h.goForward(); break;
      case "reload": wc.reload(); break;
      case "stop": wc.stop(); break;
      case "load": if (arg && /^https?:\/\//i.test(arg)) void wc.loadURL(arg).catch(() => undefined); break;
      case "zoom": wc.setZoomLevel(arg === "0" ? 0 : wc.getZoomLevel() + Number(arg)); break;
      case "copy": wc.copy(); break;
      case "cut": wc.cut(); break;
      case "paste": wc.paste(); break;
      case "selectAll": wc.selectAll(); break;
      case "undo": wc.undo(); break;
      case "redo": wc.redo(); break;
      case "devtools": wc.openDevTools({ mode: "detach" }); break;
      case "print": wc.print(); break;
    }
  });

  ipcMain.handle("curve:find", (_e, id: string, text: string, next: boolean, back: boolean) => {
    const wc = all.get(id)?.osr.webContents;
    if (wc && !wc.isDestroyed() && text) wc.findInPage(text, { findNext: !next ? false : true, forward: !back });
  });
  ipcMain.handle("curve:stopFind", (_e, id: string) => {
    const wc = all.get(id)?.osr.webContents;
    if (wc && !wc.isDestroyed()) wc.stopFindInPage("clearSelection");
  });
  // A minimized window keeps its page and sound, and paints nothing.
  ipcMain.handle("curve:paint", (_e, id: string, on: boolean) => {
    const wc = all.get(id)?.osr.webContents;
    if (!wc || wc.isDestroyed()) return;
    if (on) { wc.startPainting(); wc.invalidate(); } else wc.stopPainting();
  });
  ipcMain.handle("curve:exitFullscreen", (_e, id: string) => {
    const wc = all.get(id)?.osr.webContents;
    if (wc && !wc.isDestroyed()) void wc.executeJavaScript("document.fullscreenElement && document.exitFullscreen()", true).catch(() => undefined);
  });
  ipcMain.handle("curve:reload", (_e, id: string) => {
    const wc = all.get(id)?.osr.webContents;
    if (wc && !wc.isDestroyed()) wc.reload();
  });

  ipcMain.handle("curve:exec", async (_e, id: string, script: string) => {
    const wc = all.get(id)?.osr.webContents;
    return wc && !wc.isDestroyed() ? wc.executeJavaScript(String(script), false) : null;
  });
  ipcMain.handle("curve:capture", async (_e, id: string) => {
    const wc = all.get(id)?.osr.webContents;
    return wc && !wc.isDestroyed() ? (await wc.capturePage()).resize({ width: 240 }).toDataURL() : "";
  });
  ipcMain.handle("curve:close", (_e, id: string) => {
    const c = all.get(id);
    if (!c) return null;
    all.delete(id);
    hover.delete(id);
    const url = c.osr.webContents.getURL();
    c.osr.destroy();
    return url;
  });

  return { closeAll: () => { for (const c of all.values()) c.osr.destroy(); all.clear(); } };
}
