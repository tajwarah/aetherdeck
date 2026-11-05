// The 360° room's background: a 360° photo of a real place that ships with the app, a drawn one, or the person's
// own 360° photo of their room. Their photo stays on this computer, in this app's own storage; it is never uploaded
// or synced. The shipped photos are from Poly Haven (polyhaven.com), public domain (CC0); see public/rooms/CREDITS.md.

export type SkyId = "seaside" | "home1" | "home2" | "home3" | "night" | "studio" | "dusk" | "photo";
export interface Sky { id: Exclude<SkyId, "photo">; label: string; about: string; image?: string; thumb?: string }
const place = (file: string) => ({ image: `/rooms/${file}`, thumb: `/rooms/thumbs/${file}` });
export const SKIES: Sky[] = [
  { id: "seaside", label: "Seaside balcony", about: "Remote work by the sea", ...place("seaside-balcony.jpg") },
  { id: "home1", label: "Home Setup 1", about: "A home office with desks by the windows", ...place("home-office.jpg") },
  { id: "home2", label: "Home Setup 2", about: "A glass house over a valley", ...place("glasshouse.jpg") },
  { id: "home3", label: "Home Setup 3", about: "A sunlit loft apartment", ...place("loft.jpg") },
  { id: "night", label: "Night sky", about: "Dark, with a horizon of gold" },
  { id: "studio", label: "Studio", about: "Soft and light" },
  { id: "dusk", label: "Dusk", about: "Blue fading to amber" },
];
const DEFAULT: SkyId = "seaside";

/** What the room's drawing is told to show: a drawn background's name, or "image:" and a photo's address. */
export function skyKey(id: SkyId, photo: string | null): string {
  if (id === "photo") return photo ? `image:${photo}` : `image:${SKIES[0].image}`;
  const sky = SKIES.find((s) => s.id === id) ?? SKIES[0];
  return sky.image ? `image:${sky.image}` : sky.id;
}

const KEY = "aetherdeck.roomSky";
const MAX_WIDTH = 8192; // the widest texture every Mac's GPU takes

export function chosenSky(): SkyId {
  try { const v = localStorage.getItem(KEY); return v === "photo" || SKIES.some((s) => s.id === v) ? (v as SkyId) : DEFAULT; } catch { return DEFAULT; }
}
export function chooseSky(id: SkyId) { try { localStorage.setItem(KEY, id); } catch { /* this visit only */ } }

/**
 * Whether an image can wrap around the room: a 360° photo is twice as wide as it is tall, and a panorama wider
 * still. Anything narrower would stretch past recognition.
 */
export const wraps = (w: number, h: number) => h > 0 && w / h >= 1.6;

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open("warpnaut-room", 1) /* named before AetherDeck; kept so a saved photo stays */;
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
