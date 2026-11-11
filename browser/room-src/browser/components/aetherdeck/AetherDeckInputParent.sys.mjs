/* AetherDeck: parent half of the actor that passes mouse and wheel input to a page (the Room shows pages bent round
   the user and sends the pointer to the real page underneath). Also writes the child's notes to the Room log, and passes
   "this page changed" and "this page plays media" to the Pod as events on the page's <browser>. */
export class AetherDeckInputParent extends JSWindowActorParent {
  receiveMessage(msg) {
    if (msg.name === "cursor") { try { this.onCursor?.(msg.data); } catch (e) {} return; }
    if (msg.name === "eme") {
      const browser = this.browsingContext.top?.embedderElement;
      try { browser?.dispatchEvent(new browser.ownerDocument.defaultView.CustomEvent("AetherDeckPaneEME", { bubbles: true, detail: { keySystem: String(msg.data) } })); } catch (e) {}
      return;
    }
    if (msg.name === "changed" || msg.name === "media") {
      const browser = this.browsingContext.top?.embedderElement;
      if (!browser) return;
      const detail = msg.name === "media" ? { media: !!msg.data, frame: this.browsingContext.id } : {};
      try { browser.dispatchEvent(new browser.ownerDocument.defaultView.CustomEvent(msg.name === "media" ? "AetherDeckPaneMedia" : "AetherDeckPaneChanged", { bubbles: true, detail })); } catch (e) {}
      return;
    }
    if (msg.name === "log") {
      try { IOUtils.writeUTF8(PathUtils.join(PathUtils.profileDir, "aetherdeck-room.log"), new Date().toISOString() + " [actor] " + msg.data + "\n", { mode: "appendOrCreate" }); } catch (e) {}
    }
  }
}
