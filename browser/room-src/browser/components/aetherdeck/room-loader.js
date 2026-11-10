// AetherDeck: starts the Pod (the Room in the code) in every normal browser window (loaded from browser.xhtml).
// Popups (sign-in windows and the like) stay plain windows. Progress goes to <profile>/aetherdeck-room.log.
{
  const note = (m) => {
    try { IOUtils.writeUTF8(PathUtils.join(PathUtils.profileDir, "aetherdeck-room.log"), new Date().toISOString() + " [loader] " + m + "\n", { mode: "appendOrCreate" }); } catch (e) {}
  };
  window.addEventListener("load", () => {
    // Hide Mozilla's own products and links in every window (accounts/Sync, Firefox View, Help entries that open Mozilla sites).
    try {
      const st = document.createElement("style");
      st.id = "ad-brand-css";
      st.textContent = `#fxa-toolbar-menu-button, #appMenu-fxa-status2, #appMenu-fxa-separator, #PanelUI-fxa, #firefox-view-button,
        #menu_openHelp, #feedbackPage, #helpSwitchDeviceAccess, #appMenu-help-button2, #appMenu-feedback-button,
        #appMenu-new-private-window-button2 ~ #appMenu-sign-in-button, #appMenu-account-panel-button { display: none !important; }`;
      document.documentElement.appendChild(st);
    } catch (e) {}
    try {
      if (window.opener || window.toolbar.visible === false) { note("popup window: no Pod"); return; }
      if (!Services.prefs.getBoolPref("aetherdeck.room.enabled", true)) { note("disabled by pref"); return; }
    } catch (e) { note("check failed: " + e); }
    note("window loaded, waiting for startup");
    delayedStartupPromise.then(() => {
      try { Services.scriptloader.loadSubScript("chrome://browser/content/aetherdeck/room.js", window); note("room.js loaded"); }
      catch (e) { note("room.js failed: " + e + " " + (e.stack || "")); }
    });
  }, { once: true });
}
