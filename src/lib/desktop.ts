// The desktop app's bridge (electron/preload.ts), when Warpnaut runs as the downloadable browser. In a plain web
// browser it is null and Warpnaut falls back to framing pages that allow it.

export interface Bridge {
  platform: string;
  invoke<T = unknown>(channel: string, ...args: unknown[]): Promise<T>;
  on(channel: string, fn: (payload: unknown) => void): () => void;
  pathFor(file: File): string;
}

export const desktop: Bridge | null = (globalThis as unknown as { warpnaut?: Bridge }).warpnaut ?? null;

export interface AppInfo { version: string; platform: string; keys: Record<string, boolean>; contact: string; config: Record<string, string>; isDefault: boolean; packaged: boolean }
export interface HistoryEntry { url: string; title: string; at: number }
export interface Download { id: string; name: string; path: string; url: string; received: number; total: number; state: "progressing" | "completed" | "cancelled" | "interrupted"; paused: boolean }
export interface PermissionAsk { id: number; origin: string; permission: string; media?: string[] }

/** The live page in a window: what the bar shows and what the menu commands act on. */
export interface PageHandle {
  back(): void;
  forward(): void;
  reload(): void;
  stop(): void;
  load(url: string): void;
  find(text: string, next?: boolean, back?: boolean): void;
  stopFind(): void;
  zoom(step: number | 0): void;
  print(): void;
  devtools(): void;
  url(): string;
  title(): string;
  /** The page's process, so links it opens can be placed beside it. */
  wcId(): number;
  /** The page's visible text, for "ask about this page". */
  text(): Promise<string>;
  /** A small picture of the page, for the dock while it is minimized. */
  capture(): Promise<string>;
  /** Run a read-only script in the page as it is now (null until it has loaded). */
  read<T>(script: string): Promise<T | null>;
}

/** Live pages by window id. */
export const pages = new Map<string, PageHandle>();

/** Pictures of minimized pages, by window id. */
export const thumbs = new Map<string, string>();

/** Take a picture of each live page before it is minimized, so the dock can show it. Never waits long. */
export async function captureBeforeMinimize(ids: string[]) {
  await Promise.race([
    Promise.all(ids.map(async (id) => {
      try { const shot = await pages.get(id)?.capture(); if (shot) thumbs.set(id, shot); } catch { /* no picture: the dock shows the site's letter */ }
    })),
    new Promise((r) => setTimeout(r, 900)),
  ]);
}
