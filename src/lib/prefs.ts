// Everything personal lives in this browser only. History is off by default (session-only);
// nothing here is sent to the server except a location the person explicitly shares for a search.
import { useCallback, useEffect, useState } from "react";
import type { SearchResult } from "../../shared/types.ts";

export interface Prefs {
  historyEnabled: boolean;
  history: { query: string; at: string }[];
  kept: Pick<SearchResult, "id" | "title" | "canonicalUrl" | "domain" | "publisher" | "contentType">[];
  preferences: { dietary: string; budget: string; name: string };
  rememberLocation: boolean;
  savedLocation: { lat: number; lon: number; label: string; source: "user_supplied" | "device" } | null;
}

const KEY = "aetherdeck.prefs.v1";
export const DEFAULT_PREFS: Prefs = {
  historyEnabled: false,
  history: [],
  kept: [],
  preferences: { dietary: "", budget: "", name: "" },
  rememberLocation: false,
  savedLocation: null,
};

function load(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULT_PREFS, ...JSON.parse(raw) } : DEFAULT_PREFS;
  } catch {
    return DEFAULT_PREFS;
  }
}

export function usePrefs() {
  const [prefs, setPrefs] = useState<Prefs>(load);
  useEffect(() => {
    try {
      const persisted: Prefs = {
        ...prefs,
        history: prefs.historyEnabled ? prefs.history.slice(0, 50) : [],
        savedLocation: prefs.rememberLocation ? prefs.savedLocation : null,
      };
      localStorage.setItem(KEY, JSON.stringify(persisted));
    } catch {
      /* storage unavailable: stay session-only */
    }
  }, [prefs]);
  const update = useCallback((fn: (p: Prefs) => Prefs) => setPrefs((p) => fn(p)), []);
  const clearAll = useCallback(() => {
    try { localStorage.removeItem(KEY); } catch { /* ignore */ }
    setPrefs(DEFAULT_PREFS);
  }, []);
  return { prefs, update, clearAll };
}
