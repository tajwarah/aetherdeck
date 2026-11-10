// AetherDeck Room spike for Firefox: autoconfig file (the first line must be a comment).
// Loads firefox/room.uc.js into every browser window with chrome privileges. Spike only: see firefox/README.md.
try {
  const dir = Services.env.get("AD_ROOM_DIR");
  if (dir) {
    Services.obs.addObserver({
      observe(win) {
        win.addEventListener("load", () => {
          if (win.location.href !== "chrome://browser/content/browser.xhtml") return;
          // Sign-in and other popups (window.open with features) get their own small browser window: leave those plain,
          // or the popup becomes a second Room and closing it looks like the Room vanished.
          try { if (win.opener || win.toolbar.visible === false || /toolbar/.test(win.document.documentElement.getAttribute("chromehidden") || "")) return; } catch (e) {}
          try {
            // loadSubScript refuses file: URLs outside the app and eval is blocked by the window's CSP: use a system sandbox.
            const sb = Cu.Sandbox(win, { sandboxPrototype: win, wantXrays: false });
            sb.window = win; sb.document = win.document; sb.Services = Services;
            Cu.evalInSandbox(Cu.readUTF8URI(Services.io.newURI("file://" + dir + "/" + (Services.env.get("AD_ROOM_SCRIPT") || "room.uc.js"))), sb, "latest", "room.uc.js", 1);
          }
          catch (e) { dump("[room] load failed: " + e + "\n" + (e.stack || "") + "\n"); }
        }, { once: true });
      },
    }, "domwindowopened");
  }
} catch (e) { /* never break startup */ }
