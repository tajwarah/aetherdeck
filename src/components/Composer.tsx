// The cursor, opened: an inline field that appears where the person clicked. Type or speak an intent.
import { useEffect, useRef, useState } from "react";

type Recognition = { start(): void; stop(): void; abort(): void; lang: string; interimResults: boolean; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null; onend: (() => void) | null; onerror: ((e: { error: string }) => void) | null };

function getRecognition(): Recognition | null {
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  return Ctor ? new Ctor() : null;
}

export const voiceSupported = () => typeof window !== "undefined" && !!((window as unknown as Record<string, unknown>).SpeechRecognition || (window as unknown as Record<string, unknown>).webkitSpeechRecognition);

interface Props {
  x: number;
  y: number;
  placeholder: string;
  initial?: string;
  startListening?: boolean;
  onSubmit: (q: string) => void;
  onClose: () => void;
}

export function Composer({ x, y, placeholder, initial = "", startListening = false, onSubmit, onClose }: Props) {
  const [value, setValue] = useState(initial);
  const [listening, setListening] = useState(false);
  const [voiceError, setVoiceError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const rec = useRef<Recognition | null>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => { if (startListening) toggleVoice(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  useEffect(() => () => rec.current?.abort(), []);

  function toggleVoice() {
    if (listening) { rec.current?.stop(); return; }
    const r = getRecognition();
    if (!r) { setVoiceError("Voice input isn't supported in this browser."); return; }
    r.lang = navigator.language || "en-US";
    r.interimResults = true;
    r.onresult = (e) => {
      const text = Array.from(e.results).map((res) => res[0].transcript).join("");
      setValue(text);
      const last = e.results[e.results.length - 1];
      if (last.isFinal && text.trim()) { r.stop(); onSubmit(text.trim()); }
    };
    r.onend = () => setListening(false);
    r.onerror = (e) => { setListening(false); setVoiceError(e.error === "not-allowed" ? "Microphone permission was declined." : "Voice input stopped."); };
    rec.current = r;
    setVoiceError("");
    setListening(true);
    r.start();
  }

  // Keep the bubble on-screen near the cursor.
  const left = Math.min(Math.max(16, x - 24), window.innerWidth - Math.min(560, window.innerWidth - 32) - 16);
  const top = Math.min(Math.max(16, y - 28), window.innerHeight - 120);

  return (
    <form
      className="composer"
      data-ui
      style={{ left, top }}
      role="search"
      onSubmit={(e) => { e.preventDefault(); if (value.trim()) onSubmit(value.trim()); }}
      onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } }}
    >
      <span className={`composer__seed ${listening ? "is-listening" : ""}`} aria-hidden="true" />
      <label className="sr-only" htmlFor="warpnaut-ask">Ask Warpnaut</label>
      <input
        id="warpnaut-ask"
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={listening ? "Listening…" : placeholder}
        autoComplete="off"
        spellCheck={false}
        maxLength={400}
        onBlur={(e) => { if (!value.trim() && !listening && !e.currentTarget.form?.contains(e.relatedTarget as Node)) onClose(); }}
      />
      {voiceSupported() && (
        <button type="button" className={`composer__mic ${listening ? "is-on" : ""}`} onClick={toggleVoice} aria-pressed={listening} aria-label={listening ? "Stop listening" : "Speak your question"} title="Voice uses your browser's speech service">
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0M12 17v4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
        </button>
      )}
      <button type="submit" className="composer__go" aria-label="Explore" disabled={!value.trim()}>
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M5 12h13m-5-5 5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      {voiceError && <p className="composer__error" role="status">{voiceError}</p>}
    </form>
  );
}
