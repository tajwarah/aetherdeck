/* AetherDeck: parent half of the actor that passes mouse and wheel input to a page (the Room shows pages bent round
   the user and sends the pointer to the real page underneath). Also writes the child's notes to the Room log. */
export class AetherDeckInputParent extends JSWindowActorParent {
  receiveMessage(msg) {
    if (msg.name === "cursor") { try { this.onCursor?.(msg.data); } catch (e) {} return; }
    if (msg.name === "log") {
      try { IOUtils.writeUTF8(PathUtils.join(PathUtils.profileDir, "aetherdeck-room.log"), new Date().toISOString() + " [actor] " + msg.data + "\n", { mode: "appendOrCreate" }); } catch (e) {}
    }
  }
}
