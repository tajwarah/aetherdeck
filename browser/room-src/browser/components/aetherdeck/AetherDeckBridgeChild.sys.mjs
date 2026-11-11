/* AetherDeck: gives AetherDeck's own pages (served from this computer only) a small `window.aetherdeckRoom`:
   invoke(channel, ...args) asks the browser to do something (open a pane, read a page, keep local data) and on(channel, fn)
   listens for what the browser tells the page. Other sites never get it (the actor only matches the local server). */
export class AetherDeckBridgeChild extends JSWindowActorChild {
  handleEvent(e) {
    if (e.type === "DOMWindowCreated") this.expose();
  }
  expose() {
    const win = this.contentWindow;
    // Only AetherDeck's own server on this computer (port 8787); the parent checks the origin again for every request.
    if (!win || win.location.port !== "8787") return;
    const self = this;
    this.listeners = new Map();
    const api = Cu.createObjectIn(win, { defineAs: "aetherdeckRoom" });
    Cu.exportFunction(function invoke(channel, ...args) {
      return new win.Promise(Cu.exportFunction((resolve, reject) => {
        let payload;
        try { payload = JSON.parse(JSON.stringify([String(channel), args])); } catch (err) { reject(new win.Error("Arguments must be plain data")); return; }
        self.sendQuery("invoke", { channel: payload[0], args: payload[1] }).then(
          (v) => { try { resolve(v === undefined ? undefined : Cu.cloneInto(v, win)); } catch (err) { reject(new win.Error(String(err))); } },
          (err) => reject(new win.Error(String(err?.message || err)))
        );
      }, win));
    }, api, { defineAs: "invoke" });
    Cu.exportFunction(function on(channel, fn) {
      const c = String(channel);
      if (!self.listeners.has(c)) self.listeners.set(c, new Set());
      self.listeners.get(c).add(fn);
      return Cu.exportFunction(function off() { self.listeners.get(c)?.delete(fn); }, win);
    }, api, { defineAs: "on" });
    api.platform = "aetherdeck-room";
    Cu.makeObjectPropsNormal?.(api);
  }
  receiveMessage(msg) {
    if (msg.name !== "event") return;
    const win = this.contentWindow;
    const fns = this.listeners?.get(msg.data.channel);
    if (!win || !fns) return;
    for (const fn of [...fns]) { try { fn(Cu.cloneInto(msg.data.payload, win)); } catch (e) {} }
  }
}
