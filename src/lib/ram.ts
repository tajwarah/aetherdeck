// How Ram looks for a given memory use. The scale is the agent engine's own limit: half the computer's memory.
export interface RamStats { total: number; pageMemory: number; system?: number; tabs?: number; gpu?: number; core?: number }

export function ramMood(usedMB: number, systemMB: number) {
  const share = Math.min(1.2, usedMB / (systemMB * 0.5));
  const puff = Number((0.8 + Math.min(1, share) * 0.5).toFixed(2));
  if (share < 0.25) return { state: "light", puff, line: "Ram is grazing lightly" };
  if (share < 0.55) return { state: "fed", puff, line: "Ram is well fed" };
  if (share < 0.85) return { state: "full", puff, line: "Ram is getting woolly" };
  return { state: "bursting", puff, line: "Ram is stuffed. Closing some windows would help" };
}
