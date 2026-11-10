/* AetherDeck: content half. Replays pointer input into the page, in the page's own coordinates. */
export class AetherDeckInputChild extends JSWindowActorChild {
  receiveMessage(msg) {
    const win = this.contentWindow;
    if (!win) return;
    const wu = win.windowUtils;
    const d = msg.data;
    try {
      if (msg.name === "mouse") {
        const r = win.synthesizeMouseEvent(d.type, d.x, d.y, { button: d.button || 0, clickCount: d.clicks || 0, modifiers: d.mods || 0 }, { isDOMEventSynthesized: true, isWidgetEventSynthesized: false, isAsyncEnabled: false });
        if (d.type === "mousemove") {
          const el = win.document.elementFromPoint(d.x, d.y);
          const cur = el ? win.getComputedStyle(el).cursor : "default";
          if (cur !== this._cur) { this._cur = cur; this.sendAsyncMessage("cursor", cur); }
        } else {
          const el = win.document.elementFromPoint(d.x, d.y);
          this.sendAsyncMessage("log", d.type + " at " + Math.round(d.x) + "," + Math.round(d.y) + " -> " + (el ? el.localName + (el.id ? "#" + el.id : "") : "none") + " ret=" + r + " vp=" + win.innerWidth + "x" + win.innerHeight);
        }
      } else if (msg.name === "wheel") {
        wu.sendWheelEvent(d.x, d.y, d.dx, d.dy, 0, 0, d.mods || 0, 0, 0, 0);
      }
    } catch (e) { this.sendAsyncMessage("log", "error: " + e); }
  }
}
