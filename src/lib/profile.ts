// The person's local profile: a name and a picture, kept in this browser on this computer. There is no AetherDeck account.
export interface Profile { name: string; avatar: string }

const KEY = "aetherdeck.profile";
export const AVATARS = ["🧑‍🚀", "👩‍🚀", "👨‍🚀", "🪐", "🌙", "☄️", "🛸", "🌌", "⭐", "🌍"];

export function loadProfile(): Profile {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<Profile> | null;
    if (p && typeof p.name === "string" && typeof p.avatar === "string") return { name: p.name.slice(0, 40), avatar: AVATARS.includes(p.avatar) ? p.avatar : AVATARS[0] };
  } catch { /* nothing kept */ }
  return { name: "", avatar: AVATARS[0] };
}

/** Whether a profile was set up (in the first-run setup or from the avatar). */
export const hasProfile = () => { try { return localStorage.getItem(KEY) !== null; } catch { return false; } };

export function saveProfile(p: Profile) {
  try { localStorage.setItem(KEY, JSON.stringify({ name: p.name.trim().slice(0, 40), avatar: p.avatar })); } catch { /* storage off: not kept */ }
  window.dispatchEvent(new Event("aetherdeck:profile"));
}
