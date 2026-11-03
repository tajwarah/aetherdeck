// The 360° room's background: one of the built-in ones, or the person's own 360° photo of their room. The photo
// stays on this computer, in this app's own storage; it is never uploaded or synced.

export type SkyId = "night" | "studio" | "dusk" | "photo";
export const SKIES: { id: Exclude<SkyId, "photo">; label: string }[] = [
  { id: "night", label: "Night sky" },
  { id: "studio", label: "Studio" },
  { id: "dusk", label: "Dusk" },
];

const KEY = "warpnaut.roomSky";
const MAX_WIDTH = 8192; // the widest texture every Mac's GPU takes

export function chosenSky(): SkyId {
  try { const v = localStorage.getItem(KEY); return v === "studio" || v === "dusk" || v === "photo" ? v : "night"; } catch { return "night"; }
}
export function chooseSky(id: SkyId) { try { localStorage.setItem(KEY, id); } catch { /* this visit only */ } }

/**
 * Whether an image can wrap around the room: a 360° photo is twice as wide as it is tall, and a panorama wider
 * still. Anything narrower would stretch past recognition.
 */
export const wraps = (w: number, h: number) => h > 0 && w / h >= 1.6;

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open("warpnaut-room", 1);
    open.onupgradeneeded = () => open.result.createObjectStore("sky");
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
}
async function store<T>(mode: IDBTransactionMode, act: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const d = await db();
  return new Promise<T>((resolve, reject) => {
    const req = act(d.transaction("sky", mode).objectStore("sky"));
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error);
  }).finally(() => d.close());
}

export const savedPhoto = () => store<Blob | undefined>("readonly", (s) => s.get("photo")).catch(() => undefined);
export const forgetPhoto = () => store("readwrite", (s) => s.delete("photo")).catch(() => undefined);

/** Keeps a photo as the room's background, no wider than the GPU can take. Null when it can't wrap around. */
export async function keepPhoto(file: Blob): Promise<Blob | null> {
  const full = await createImageBitmap(file);
  const { width, height } = full;
  full.close();
  if (!wraps(width, height)) return null;
  const scale = Math.min(1, MAX_WIDTH / width);
  const img = await createImageBitmap(file, { resizeWidth: Math.round(width * scale), resizeHeight: Math.round(height * scale), resizeQuality: "high" });
  const canvas = new OffscreenCanvas(img.width, img.height);
  canvas.getContext("2d")!.drawImage(img, 0, 0);
  img.close();
  const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.9 });
  await store("readwrite", (s) => s.put(blob, "photo"));
  return blob;
}
