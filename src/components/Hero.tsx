// The home: the mark, what AetherDeck is, one bar to ask, open an address or play something, and Cosmonaut.
import { useState } from "react";
import { Cosmonaut, Logo } from "./Logo.tsx";

interface Props {
  onAsk: (q: string) => void;
  onListen: () => void;
  onCosmonaut: () => void;
}

export function Hero({ onAsk, onListen, onCosmonaut }: Props) {
  const [q, setQ] = useState("");
  const go = () => { const t = q.trim(); if (t) { onAsk(t); setQ(""); } };
  return (
    <section className="hero" data-ui aria-label="AetherDeck">
      <span className="hero__mark"><Logo size={190} glow /></span>
      <p className="hero__tag">The exploratory browser</p>
      <h1 className="hero__title">Explore <em>beyond</em> the ordinary.</h1>
      <form className="hero__ask" onSubmit={(e) => { e.preventDefault(); go(); }}>
        <span className="hero__orb" aria-hidden="true" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask, open an address, or “play …”" aria-label="Ask, open an address, or play something" spellCheck={false} data-keys />
        <button type="button" className="hero__mic" onClick={onListen} aria-label="Speak instead" title="Speak">
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" /></svg>
        </button>
        <button type="submit" className="hero__go" aria-label="Go" title="Go" disabled={!q.trim()}>
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
        </button>
      </form>
      <button className="hero__cosmo" onClick={onCosmonaut}>
        <span className="hero__face"><Cosmonaut size={50} /></span>
        <span>Ask Cosmonaut</span>
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M11 3l1.9 5.6L18.5 10.5l-5.6 1.9L11 18l-1.9-5.6L3.5 10.5l5.6-1.9Z" fill="currentColor" /><path d="M19 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7Z" fill="currentColor" /></svg>
      </button>
    </section>
  );
}
