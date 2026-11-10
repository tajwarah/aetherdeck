/* AetherDeck: parent half of the page bridge. Hands each request to the window's Room service (window.adBridge). */
export class AetherDeckBridgeParent extends JSWindowActorParent {
  async receiveMessage(msg) {
    if (msg.name !== "invoke") return undefined;
    const origin = this.manager?.documentPrincipal?.originNoSuffix || "";
    if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin)) throw new Error("Not allowed from " + origin);
    const win = this.browsingContext?.topChromeWindow;
    if (!win?.adBridge) throw new Error("The browser is not ready");
    return await win.adBridge.invoke(msg.data.channel, msg.data.args, this);
  }
  /** Send an event to the page. */
  emit(channel, payload) { try { this.sendAsyncMessage("event", { channel, payload }); } catch (e) {} }
}
