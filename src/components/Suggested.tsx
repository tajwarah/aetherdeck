// "Personal context" (panel 08): suggestions drawn only from what this browser remembers, with the reason
// under each. Nothing is inferred on a server; with history off (the default) nothing is shown.
import type { Prefs } from "../lib/prefs.ts";

const KINDS: { re: RegExp; label: string; follow: (topic: string) => string }[] = [
  { re: /repair|technician|plumber|electrician|service/i, label: "service", follow: (t) => `Find ${t} near me today.` },
  { re: /restaurant|biryani|cafe|food|eat/i, label: "place", follow: (t) => `Find restaurants near me that serve ${t} and compare them.` },
  { re: /news|happening|today|this week/i, label: "news", follow: (t) => `What's happening in ${t} today?` },
];

export function suggestionsFrom(prefs: Prefs): { title: string; reason: string; query: string }[] {
  if (!prefs.historyEnabled || !prefs.history.length) return [];
  const seen = new Set<string>();
  const out: { title: string; reason: string; query: string }[] = [];
  for (const h of prefs.history) {
    const topic = h.query
      .replace(/^(find|explain|what'?s happening in|what is( the evidence on)?)\s+(an?\s+)?/i, "")
      .replace(/\s+(and (show|compare)\b.*|near me.*|today)$/i, "")
      .replace(/[.?]$/, "")
      .trim();
    const key = topic.toLowerCase();
    if (!topic || seen.has(key)) continue;
    seen.add(key);
    const kind = KINDS.find((k) => k.re.test(h.query));
    out.push({
      title: topic.length > 42 ? `${topic.slice(0, 40)}…` : topic,
      reason: kind ? `you looked for a ${kind.label} like this` : "you explored this before",
      query: h.query,
    });
    if (out.length === 3) break;
  }
  return out;
}

export function Suggested({ prefs, onRun }: { prefs: Prefs; onRun: (q: string) => void }) {
  const items = suggestionsFrom(prefs);
  if (!items.length) return null;
  return (
    <aside className="suggested" data-ui aria-label="Suggested for you">
      <p className="suggested__head">Suggested for you <span className="suggested__why">from this device only</span></p>
      <ul className="suggested__list">
        {items.map((s) => (
          <li key={s.query}>
            <button className="suggested__item" onClick={() => onRun(s.query)}>
              <span className="suggested__title">{s.title}</span>
              <span className="suggested__reason">{s.reason}</span>
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}
