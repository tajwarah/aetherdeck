// Devices and sharing: turn on sync across this person's devices, and share groups with other people.
// Every link carries its own key after the "#"; the sheet says plainly that the link is the key.
import { useMemo, useState } from "react";
import QRCode from "qrcode";
import type { Health } from "../lib/api.ts";
import { inviteUrl, type Creds, type InviteKind, type Status } from "../lib/sync.ts";
import type { SyncApi } from "../lib/useSync.ts";
import { groupName, type Win } from "../lib/windows.ts";

interface Props {
  sync: SyncApi;
  wins: Win[];
  health: Health | null;
  /** Open with this group's sharing expanded (from its ornament). */
  focusGroup?: string;
  onClose: () => void;
}

const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])$/;

/** The address other devices should use: PUBLIC_URL when set; this computer's Wi-Fi address instead of localhost. */
export function shareBase(health: Health | null): { base: string; lan?: string; localOnly: boolean } {
  if (health?.publicUrl) return { base: health.publicUrl, localOnly: false };
  if (LOCAL.test(location.hostname)) {
    const lan = health?.lan?.[0];
    if (lan) return { base: `${location.protocol}//${lan}${location.port ? `:${location.port}` : ""}`, lan, localOnly: false };
    return { base: location.origin, localOnly: true };
  }
  return { base: location.origin, localOnly: false };
}

export function statusText(s: Status | null, who: "devices" | "people") {
  if (!s) return "";
  if (s.state === "connecting") return "Connecting…";
  if (s.state === "offline") return "Offline. Changes will sync when the connection returns.";
  if (s.state === "gone") return "Turned off";
  const others = Math.max(0, s.peers - 1);
  return others ? `Live · ${others} other ${others === 1 ? (who === "devices" ? "device" : "person or device") : who === "devices" ? "devices" : "people or devices"} here now` : "Live · open the link elsewhere to connect";
}

export function SyncSheet({ sync, wins, health, focusGroup, onClose }: Props) {
  const where = shareBase(health);
  const groups = useMemo(() => {
    const ids = [...new Set(wins.map((w) => w.group).filter(Boolean))] as string[];
    for (const s of sync.shares) if (s.group && !ids.includes(s.group)) ids.push(s.group);
    return ids.map((g) => ({ g, members: wins.filter((w) => w.group === g), share: sync.shares.find((s) => s.group === g) }));
  }, [wins, sync.shares]);
  const pending = sync.shares.filter((s) => !s.group); // joined, still loading

  return (
    <div className="scrim" data-ui onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <section className="sheet sheet--privacy sheet--sync" role="dialog" aria-modal="true" aria-labelledby="sync-title" onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } }}>
        <header className="sheet__head">
          <div>
            <p className="sheet__kicker">Encrypted in this browser</p>
            <h2 className="sheet__title" id="sync-title">Devices and sharing</h2>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close" autoFocus>
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
          </button>
        </header>

        <section className="pref">
          <h3 className="sheet__h">Your devices</h3>
          {!sync.personal ? (
            <>
              <p>Open the same windows and groups on your phone, tablet or another computer. A group you open here appears there, and closes there when you close it here.</p>
              <button className="btn btn--primary" onClick={sync.enable}>Sync across devices</button>
            </>
          ) : (
            <>
              <p className={`sync-status sync-status--${sync.personalStatus?.state}`} role="status"><span className="sync-dot" aria-hidden="true" />{statusText(sync.personalStatus, "devices")}</p>
              <Invite kind="sync" creds={sync.personal} base={where.base} label="Link for your other devices" note="Scan the code with your phone, or open the link on another device. The link is the key: keep it to yourself." />
              <div className="sheet__row">
                <button className="btn btn--small" onClick={() => sync.disable(false)}>Stop syncing this device</button>
                <button className="btn btn--small btn--danger" onClick={() => { if (confirm("Turn sync off on every device? Each device keeps the windows it has open now.")) sync.disable(true); }}>Turn off everywhere</button>
              </div>
            </>
          )}
          <Reach where={where} />
        </section>

        <section className="pref">
          <h3 className="sheet__h">Share a group with people</h3>
          {!groups.length && !pending.length && <p className="fine">No groups yet. Press ＋ on a window to open a page beside it, or drop one window next to another.</p>}
          <ul className="share-list">
            {groups.map(({ g, members, share }) => (
              <li key={g} className={`share ${focusGroup === g ? "is-focus" : ""}`}>
                <div className="share__head">
                  <span className="group-orn__dot" aria-hidden="true" />
                  <span className="share__name">{members.length ? groupName(members) : "Shared group"}</span>
                  <span className="share__n">{members.length} {members.length === 1 ? "page" : "pages"}</span>
                  {!share && <button className="btn btn--small" onClick={() => sync.shareGroup(g)} aria-label={`Share ${members.length ? groupName(members) : "group"}`}>Share</button>}
                </div>
                {share && (
                  <>
                    <p className={`sync-status sync-status--${share.status.state}`}><span className="sync-dot" aria-hidden="true" />{statusText(share.status, "people")}</p>
                    <Invite kind="group" creds={{ id: share.id, key: share.key }} base={where.base} label={`Link to ${members.length ? groupName(members) : "this group"}`} compact={focusGroup !== g}
                      note="Anyone with this link can see this group and add, change or close its pages. Your other windows stay private." />
                    <div className="sheet__row">
                      {share.owner
                        ? <button className="btn btn--small btn--danger" onClick={() => sync.stopSharing(share.id)}>Stop sharing</button>
                        : <button className="btn btn--small btn--danger" onClick={() => sync.leave(share.id)}>Leave group</button>}
                    </div>
                  </>
                )}
              </li>
            ))}
            {pending.map((s) => <li key={s.id} className="share"><p className="sync-status"><span className="sync-dot" aria-hidden="true" />Opening a shared group…</p></li>)}
          </ul>
        </section>

        <p className="fine">Pages, titles and addresses are encrypted here with AES-256 before they leave this browser. The AetherDeck server keeps only scrambled data and a version number, and removes spaces nobody has opened for 90 days. Where windows sit, their size and what is minimized stay on each device.</p>
      </section>
    </div>
  );
}

function Invite({ kind, creds, base, label, note, compact }: { kind: InviteKind; creds: Creds; base: string; label: string; note: string; compact?: boolean }) {
  const url = inviteUrl(base, kind, creds);
  const [copied, setCopied] = useState(false);
  const [showCode, setShowCode] = useState(!compact);
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1600); }
    catch { /* clipboard blocked: the field is selectable */ }
  };
  return (
    <div className="invite-box">
      {showCode && <QR text={url} label={`QR code: ${label}`} />}
      <div className="invite-box__side">
        <label className="invite-box__label">{label}
          <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
        </label>
        <div className="sheet__row">
          <button className="btn btn--small" onClick={copy}>{copied ? "Copied" : "Copy link"}</button>
          {compact && <button className="btn btn--small btn--quiet" onClick={() => setShowCode((v) => !v)}>{showCode ? "Hide code" : "Show code"}</button>}
        </div>
        <p className="fine">{note}</p>
      </div>
    </div>
  );
}

function QR({ text, label }: { text: string; label: string }) {
  const { size, cells } = useMemo(() => {
    const q = QRCode.create(text, { errorCorrectionLevel: "M" });
    const n = q.modules.size;
    const out: string[] = [];
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (q.modules.get(x, y)) out.push(`M${x + 2} ${y + 2}h1v1h-1z`);
    return { size: n + 4, cells: out.join("") };
  }, [text]);
  return (
    <svg className="qr" viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label} shapeRendering="crispEdges">
      <rect width={size} height={size} fill="#fff" rx="1.5" />
      <path d={cells} fill="#111" />
    </svg>
  );
}

function Reach({ where }: { where: ReturnType<typeof shareBase> }) {
  if (where.localOnly) return <p className="fine sync-warn">These links point to localhost, which only this computer can open. Start AetherDeck with <code>npm run dev:lan</code> to reach a phone on the same Wi-Fi, or put it online and set <code>PUBLIC_URL</code> to reach devices anywhere.</p>;
  if (where.lan) return <p className="fine">Links use this computer's Wi-Fi address ({where.lan}), so they open on devices on the same network while AetherDeck runs with <code>npm run dev:lan</code> or <code>npm start</code>. To reach devices anywhere, put AetherDeck online and set <code>PUBLIC_URL</code>.</p>;
  return null;
}
