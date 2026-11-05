// What AetherDeck knows about you, on this device, and the controls to change or erase it.
import type { Prefs } from "../lib/prefs.ts";

interface Props {
  prefs: Prefs;
  model: { label: string; free: boolean } | null;
  sessionLocation: Prefs["savedLocation"];
  onUpdate: (fn: (p: Prefs) => Prefs) => void;
  onForgetLocation: () => void;
  onClearAll: () => void;
  onClose: () => void;
  onRun: (q: string) => void;
}

export function PrivacySheet({ prefs, model, sessionLocation, onUpdate, onForgetLocation, onClearAll, onClose, onRun }: Props) {
  return (
    <div className="scrim" data-ui onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <section className="sheet sheet--privacy" role="dialog" aria-modal="true" aria-labelledby="privacy-title" onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } }}>
        <header className="sheet__head">
          <div>
            <p className="sheet__kicker">Stored only in this browser</p>
            <h2 className="sheet__title" id="privacy-title">Your data</h2>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close" autoFocus>
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
          </button>
        </header>

        <section className="pref">
          <h3 className="sheet__h">Location</h3>
          <p>{sessionLocation ? `Using “${sessionLocation.label}” (${sessionLocation.source === "device" ? "from your device, rounded to about 100 m" : "typed by you"}).` : "Not shared. Local searches will ask first."}</p>
          <label className="check">
            <input type="checkbox" checked={prefs.rememberLocation} onChange={(e) => onUpdate((p) => ({ ...p, rememberLocation: e.target.checked, savedLocation: e.target.checked ? sessionLocation : null }))} />
            Remember it on this device
          </label>
          {sessionLocation && <button className="btn btn--small" onClick={onForgetLocation}>Forget location</button>}
        </section>

        <section className="pref">
          <h3 className="sheet__h">History</h3>
          <label className="check">
            <input type="checkbox" checked={prefs.historyEnabled} onChange={(e) => onUpdate((p) => ({ ...p, historyEnabled: e.target.checked, history: e.target.checked ? p.history : [] }))} />
            Remember what I explore (off by default)
          </label>
          <p className="fine">When on, open windows and groups are also kept here and come back on your next visit. Sync across devices is separate, under the devices button; “Erase everything” also stops syncing on this device.</p>
          {prefs.historyEnabled && (prefs.history.length ? (
            <ul className="list">
              {prefs.history.map((h) => (
                <li key={h.at}>
                  <button className="link" onClick={() => onRun(h.query)}>{h.query}</button>
                  <button className="icon-btn icon-btn--small" aria-label={`Delete “${h.query}” from history`} onClick={() => onUpdate((p) => ({ ...p, history: p.history.filter((x) => x.at !== h.at) }))}>×</button>
                </li>
              ))}
            </ul>
          ) : <p className="fine">Nothing yet.</p>)}
        </section>

        <section className="pref">
          <h3 className="sheet__h">Kept</h3>
          {prefs.kept.length ? (
            <ul className="list">
              {prefs.kept.map((k) => (
                <li key={k.id}>
                  <a href={k.canonicalUrl} target="_blank" rel="noopener noreferrer">{k.title}</a>
                  <button className="icon-btn icon-btn--small" aria-label={`Remove ${k.title}`} onClick={() => onUpdate((p) => ({ ...p, kept: p.kept.filter((x) => x.id !== k.id) }))}>×</button>
                </li>
              ))}
            </ul>
          ) : <p className="fine">Nothing kept. Use “Keep” on any source.</p>}
        </section>

        <section className="pref">
          <h3 className="sheet__h">Preferences</h3>
          <p className="fine">Optional. Used only to pre-fill requests you prepare — never to guess anything about you.</p>
          <label>Name for requests<input value={prefs.preferences.name} maxLength={80} onChange={(e) => onUpdate((p) => ({ ...p, preferences: { ...p.preferences, name: e.target.value } }))} /></label>
          <label>Dietary notes<input value={prefs.preferences.dietary} maxLength={120} placeholder="e.g. no peanuts" onChange={(e) => onUpdate((p) => ({ ...p, preferences: { ...p.preferences, dietary: e.target.value } }))} /></label>
        </section>

        <footer className="sheet__actions">
          <button className="btn btn--danger" onClick={() => { if (confirm("Erase all AetherDeck data stored in this browser?")) onClearAll(); }}>Erase everything</button>
        </footer>
        {model && (
          <p className="fine">
            Questions and retrieved source text are sent to {model.label} to plan searches and organize evidence.
            {model.free ? " Free tiers may log or train on what they receive — avoid personal details in questions." : ""}
          </p>
        )}
        <p className="fine">The server keeps no history. Searches are cached in memory for minutes to hours (news: 3 minutes) and never tied to you.</p>
      </section>
    </div>
  );
}
