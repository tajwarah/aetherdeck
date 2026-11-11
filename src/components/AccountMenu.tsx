// The person's accounts, from the avatar: sign in to Google once, in a page, and Gmail, YouTube and every Google
// site know them, the way Chrome works (one browsing session for every window). AetherDeck never sees the password:
// Google's own sign-in page does the signing in, and AetherDeck only checks whether a sign-in cookie exists.
import { useEffect, useState } from "react";
import { desktop, roomBridge } from "../lib/desktop.ts";
import { AVATARS, loadProfile, saveProfile } from "../lib/profile.ts";

export interface Accounts { google: boolean; youtube: boolean }

const SIGN_IN = "https://accounts.google.com/ServiceLogin?continue=https%3A%2F%2Fwww.youtube.com%2Fsignin%3Faction_handle_signin%3Dtrue%26next%3D%252F";

export function useAccounts() {
  const [accounts, setAccounts] = useState<Accounts | null>(null);
  useEffect(() => {
    if (!desktop) return;
    void desktop.invoke<Accounts>("account:google").then(setAccounts);
    return desktop.on("aetherdeck:account", (a) => setAccounts(a as Accounts));
  }, []);
  return [accounts, setAccounts] as const;
}

export function AccountMenu({ accounts, onAccounts, onOpen, onData, onClose }: {
  accounts: Accounts | null; onAccounts: (a: Accounts) => void; onOpen: (url: string, title: string) => void; onData: () => void; onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const signedIn = !!accounts?.google;
  const [profile, setProfile] = useState(loadProfile);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(profile);
  const saveEdit = () => { saveProfile(draft); setProfile({ ...draft, name: draft.name.trim() }); setEditing(false); };
  return (
    <>
      <div className="acct__scrim" onClick={onClose} />
      <div className="acct" role="dialog" aria-label="Accounts" data-ui>
        <div className="acct__me">
          <span className="acct__pic" aria-hidden="true">{(editing ? draft : profile).avatar}</span>
          {editing ? (
            <input className="acct__name-in" value={draft.name} maxLength={40} placeholder="Your name" autoFocus aria-label="Your name"
              onChange={(e) => setDraft({ ...draft, name: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") saveEdit(); if (e.key === "Escape") { e.stopPropagation(); setEditing(false); } }} />
          ) : (
            <span className="acct__who"><strong>{profile.name || "Your profile"}</strong><small>Kept on this computer only</small></span>
          )}
          {editing
            ? <button className="acct__btn acct__btn--primary acct__edit" onClick={saveEdit}>Save</button>
            : <button className="acct__btn acct__edit" onClick={() => { setDraft(profile); setEditing(true); }}>Edit</button>}
        </div>
        {editing && (
          <div className="acct__pics" role="radiogroup" aria-label="Your picture">
            {AVATARS.map((a) => <button key={a} role="radio" aria-checked={draft.avatar === a} className={`acct__pick ${draft.avatar === a ? "is-on" : ""}`} onClick={() => setDraft({ ...draft, avatar: a })}>{a}</button>)}
          </div>
        )}
        <p className="acct__h">Accounts</p>
        {desktop ? (
          <>
            <div className="acct__row">
              <span className="acct__logo" aria-hidden="true"><GoogleMark /></span>
              <span className="acct__what">
                <strong>Google</strong>
                <small>{signedIn ? `Signed in${accounts?.youtube ? " · YouTube too" : ""}` : "Gmail, YouTube, Drive, Maps: sign in once for all of them"}</small>
              </span>
            </div>
            {signedIn ? (
              <div className="acct__btns">
                <button className="acct__btn" onClick={() => { onOpen("https://www.youtube.com/", "YouTube"); onClose(); }}>Open YouTube</button>
                <button className="acct__btn" onClick={() => { onOpen("https://myaccount.google.com/", "Google Account"); onClose(); }}>Google Account</button>
                <button className="acct__btn acct__btn--quiet" disabled={busy} onClick={() => { setBusy(true); void desktop!.invoke<Accounts>("account:googleSignOut").then((a) => { onAccounts(a); setBusy(false); }); }}>Sign out</button>
              </div>
            ) : (
              <>
                <button className="acct__btn acct__btn--primary" onClick={() => { onOpen(SIGN_IN, "Sign in to Google"); onClose(); }}>Sign in with Google</button>
                <p className="acct__fine">Google's own page opens in a window; you sign in there, and AetherDeck never sees your password. You stay signed in across restarts, as in Chrome.</p>
              </>
            )}
          </>
        ) : (
          roomBridge ? (
            <>
              <button className="acct__btn acct__btn--primary" onClick={() => { onOpen(SIGN_IN, "Sign in to Google"); onClose(); }}>Sign in with Google</button>
              <p className="acct__fine">Google's own page opens in your pod; you type your email and password there, and AetherDeck never sees or keeps them. One sign-in covers YouTube, Gmail and Drive.</p>
            </>
          ) : <p className="acct__fine">Sign-in lives in your browser here. In the AetherDeck desktop app, one Google sign-in covers YouTube, Gmail and the rest.</p>
        )}
        <button className="acct__link" onClick={() => { onData(); onClose(); }}>Your data and privacy</button>
      </div>
    </>
  );
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22">
      <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.8Z" />
      <path fill="#34A853" d="M12 24c3.2 0 6-1.1 7.9-2.9l-3.9-3a7.2 7.2 0 0 1-10.7-3.8h-4v3.1A12 12 0 0 0 12 24Z" />
      <path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6h-4a12 12 0 0 0 0 10.8l4-3.1Z" />
      <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.3 6.6l4 3.1A7.2 7.2 0 0 1 12 4.8Z" />
    </svg>
  );
}
