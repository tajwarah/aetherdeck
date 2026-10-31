// In-memory TTL cache. Expiry depends on how fast the underlying information changes,
// so breaking news is never served as current from a long-lived entry.
export type Freshness = "stable" | "places" | "volatile";

export const TTL_MS: Record<Freshness, number> = {
  stable: 6 * 60 * 60 * 1000, // encyclopedia articles, papers
  places: 30 * 60 * 1000, // business listings (no live availability is ever cached)
  volatile: 3 * 60 * 1000, // news
};

interface Entry<T> { value: T; expires: number; storedAt: number }

export class TtlCache<T> {
  private map = new Map<string, Entry<T>>();
  private readonly max: number;
  private readonly now: () => number;

  constructor(max = 500, now: () => number = Date.now) {
    this.max = max;
    this.now = now;
  }

  get(key: string): { value: T; storedAt: number } | undefined {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (hit.expires <= this.now()) {
      this.map.delete(key);
      return undefined;
    }
    // refresh LRU position
    this.map.delete(key);
    this.map.set(key, hit);
    return { value: hit.value, storedAt: hit.storedAt };
  }

  set(key: string, value: T, freshness: Freshness) {
    if (this.map.size >= this.max) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
    const now = this.now();
    this.map.set(key, { value, expires: now + TTL_MS[freshness], storedAt: now });
  }

  get size() { return this.map.size; }
}
