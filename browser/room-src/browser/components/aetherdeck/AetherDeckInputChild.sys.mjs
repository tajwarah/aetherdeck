/* AetherDeck: content half. Replays pointer input into the page, in the page's own coordinates. */
export class AetherDeckInputChild extends JSWindowActorChild {
  receiveMessage(msg) {
    const win = this.contentWindow;
    if (!win) return;
    const wu = win.windowUtils;
    const d = msg.data;
    try {
      if (msg.name === "mouse" && d.cursorOnly) {
        const cur = this.cursorAt(win, d.x, d.y);
        if (cur !== this._cur) { this._cur = cur; this.sendAsyncMessage("cursor", cur); }
      } else if (msg.name === "mouse") {
        win.synthesizeMouseEvent(d.type, d.x, d.y, { button: d.button || 0, clickCount: d.clicks || 0, modifiers: d.mods || 0 }, { isDOMEventSynthesized: true, isWidgetEventSynthesized: false, isAsyncEnabled: false });
        if (d.type === "mousemove") {
          const cur = this.cursorAt(win, d.x, d.y);
          if (cur !== this._cur) { this._cur = cur; this.sendAsyncMessage("cursor", cur); }
        }
      } else if (msg.name === "wheel") {
        this.wheel(win, d);
      }
    } catch (e) { this.sendAsyncMessage("log", "error: " + e); }
  }

  // The pointer's shape over this point of the page, as a plain keyword the Pod can always show: never "none" (video players
  // hide the pointer) or a custom image. "auto" becomes a hand over links and buttons, a text bar over text, else an arrow.
  cursorAt(win, x, y) {
    const SHOWN = /^(default|pointer|text|vertical-text|move|grab|grabbing|crosshair|not-allowed|no-drop|help|wait|progress|cell|copy|alias|context-menu|zoom-in|zoom-out|col-resize|row-resize|[nsew]{1,2}-resize|nesw-resize|nwse-resize|all-scroll)$/;
    const el = win.document.elementFromPoint(x, y);
    if (!el) return "default";
    const css = win.getComputedStyle(el).cursor.split(",").pop().trim();
    if (SHOWN.test(css)) return css;
    if (el.closest("a[href], button, [role=button], [role=link], [role=tab], [role=menuitem], summary, label, select, input[type=button], input[type=submit], input[type=checkbox], input[type=radio]")) return "pointer";
    if (el.closest("input, textarea, [contenteditable=''], [contenteditable=true]")) return "text";
    // Over words (not the empty space beside them): the text bar.
    const pos = win.document.caretPositionFromPoint?.(x, y);
    const node = pos?.offsetNode;
    if (node && node.nodeType === 3 && node.textContent.trim()) {
      const r = win.document.createRange();
      r.selectNodeContents(node);
      for (const b of r.getClientRects()) if (x >= b.left && x <= b.right && y >= b.top && y <= b.bottom) return "text";
    }
    return "default";
  }

  // Scrolling: the page gets a wheel event (maps, carousels and editors listen for it); if it doesn't take it, the nearest
  // scrollable thing under the pointer scrolls, or else the page. Synthesized widget wheel events did not scroll here.
  wheel(win, d) {
    const k = d.mode === 1 ? 16 : d.mode === 2 ? win.innerHeight : 1;
    const dx = d.dx * k, dy = d.dy * k;
    const doc = win.document;
    const at = doc.elementFromPoint(d.x, d.y) || doc.documentElement;
    const ev = new win.WheelEvent("wheel", { bubbles: true, cancelable: true, composed: true, clientX: d.x, clientY: d.y, deltaX: dx, deltaY: dy, deltaMode: 0, ctrlKey: !!d.ctrl, shiftKey: !!d.shift });
    if (!at.dispatchEvent(ev)) return;
    for (let el = at; el && el !== doc.documentElement && el !== doc.body; el = el.parentElement) {
      const cs = win.getComputedStyle(el);
      const canY = dy && /(auto|scroll|overlay)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 1 && ((dy > 0 && el.scrollTop + el.clientHeight < el.scrollHeight - 1) || (dy < 0 && el.scrollTop > 0));
      const canX = dx && /(auto|scroll|overlay)/.test(cs.overflowX) && el.scrollWidth > el.clientWidth + 1 && ((dx > 0 && el.scrollLeft + el.clientWidth < el.scrollWidth - 1) || (dx < 0 && el.scrollLeft > 0));
      if (canY || canX) { el.scrollBy({ left: dx, top: dy, behavior: "instant" }); return; }
    }
    win.scrollBy({ left: dx, top: dy, behavior: "instant" });
  }
}
