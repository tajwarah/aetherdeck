// Shown when Warpnaut is opened from a sync or shared-group link: nothing joins until the person says so.
import type { Invite } from "../lib/sync.ts";

export function JoinSheet({ invite, hasPersonal, onJoin, onClose }: { invite: Invite; hasPersonal: boolean; onJoin: () => void; onClose: () => void }) {
  const sync = invite.kind === "sync";
  return (
    <div className="scrim" data-ui onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <section className="sheet sheet--privacy" role="dialog" aria-modal="true" aria-labelledby="join-title" onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } }}>
        <header className="sheet__head">
          <div>
            <p className="sheet__kicker">{sync ? "From one of your devices" : "Someone shared a group with you"}</p>
            <h2 className="sheet__title" id="join-title">{sync ? "Sync this device?" : "Open the shared group?"}</h2>
          </div>
        </header>
        <p>{sync
          ? "Windows and groups from your other device will open here, and windows open here will join them. Closing a window on one device closes it on the others."
          : "Its pages will open here as a group. Anyone with the link can add, change or close pages in it; your other windows stay private."}</p>
        {sync && hasPersonal && <p className="fine">This device already syncs with another set of devices. Joining moves it to this one; the windows open here come along.</p>}
        <p className="fine">Everything is decrypted in this browser with the key inside the link. The Warpnaut server cannot read it.</p>
        <footer className="sheet__actions">
          <button className="btn btn--primary" onClick={onJoin} autoFocus>{sync ? "Sync this device" : "Open the group"}</button>
          <button className="btn btn--quiet" onClick={onClose}>Not now</button>
        </footer>
      </section>
    </div>
  );
}
