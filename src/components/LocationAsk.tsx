// Asked only when a local request needs it. Device location is used once, rounded, and never stored unless asked.
import { useState } from "react";
import { geocodePlace } from "../lib/api.ts";

export type ChosenLocation = { lat: number; lon: number; label: string; source: "user_supplied" | "device" };

export function LocationAsk({ onChoose, onCancel }: { onChoose: (loc: ChosenLocation) => void; onCancel: () => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function useDevice() {
    if (!navigator.geolocation) { setError("This browser can't share location. Type a place instead."); return; }
    setBusy(true);
    setError("");
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setBusy(false);
        const round = (n: number) => Math.round(n * 1000) / 1000; // ≈100 m: enough for nearby search
        onChoose({ lat: round(p.coords.latitude), lon: round(p.coords.longitude), label: "your location", source: "device" });
      },
      (e) => { setBusy(false); setError(e.code === e.PERMISSION_DENIED ? "Location permission was declined. Type a place instead." : "Couldn't get your location. Type a place instead."); },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 },
    );
  }

  async function lookUp(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    setError("");
    try {
      const place = await geocodePlace(text.trim());
      onChoose({ ...place, source: "user_supplied" });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="locask" data-ui role="dialog" aria-labelledby="locask-title" onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onCancel(); } }}>
      <p className="locask__title" id="locask-title">Where should I look?</p>
      <p className="fine">Nothing is searched, and nothing about you is stored, until you choose.</p>
      <button className="btn btn--primary" onClick={useDevice} disabled={busy}>Use my location</button>
      <form onSubmit={lookUp} className="locask__form">
        <label className="sr-only" htmlFor="loc-text">Neighbourhood or city</label>
        <input id="loc-text" value={text} onChange={(e) => setText(e.target.value)} placeholder="or type a neighbourhood, e.g. Dhanmondi, Dhaka" maxLength={200} />
        <button className="btn" disabled={busy || !text.trim()}>Look there</button>
      </form>
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  );
}
