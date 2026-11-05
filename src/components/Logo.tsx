// The AetherDeck mark: a ribbon of light folded into an A, peach to lavender, the same drawing as the app icon
// (build/icon.svg). And Cosmonaut, the AI companion: a small helmet with a dark visor and two smiling eyes.
import { useId } from "react";

const RIM = "M52 10C56 3 64 3 68 10L113 84C118 93 112 99 102 99H18C8 99 2 93 7 84Z";
const BAND = `${RIM}M60 22 21 85C36 80 50 90 66 86 78 83 88 85 98 84Z`;

export function Logo({ size = 26, glow = false }: { size?: number; glow?: boolean }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg className="logo" viewBox="0 0 120 104" width={size} height={(size * 104) / 120} aria-hidden="true">
      <defs>
        <linearGradient id={`${id}b`} x1="8" y1="96" x2="114" y2="30" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#ffcf9f" /><stop offset="0.38" stopColor="#fdf1e6" /><stop offset="0.66" stopColor="#ece6ff" /><stop offset="1" stopColor="#9483ff" />
        </linearGradient>
        <linearGradient id={`${id}s`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.55" /><stop offset="0.55" stopColor="#fff" stopOpacity="0" /><stop offset="1" stopColor="#fff" stopOpacity="0.35" />
        </linearGradient>
        {glow && <filter id={`${id}g`} x="-25%" y="-25%" width="150%" height="150%"><feGaussianBlur stdDeviation="3.5" /></filter>}
      </defs>
      {glow && <path d={BAND} fill={`url(#${id}b)`} fillRule="evenodd" opacity="0.7" filter={`url(#${id}g)`} />}
      <path d={BAND} fill={`url(#${id}b)`} fillRule="evenodd" opacity="0.94" />
      <path d={BAND} fill={`url(#${id}s)`} fillRule="evenodd" />
      <path d="M60 22 21 85C40 66 58 54 76 46Z" fill={`url(#${id}b)`} opacity="0.42" />
      <path d="M21 85C40 66 58 54 76 46" fill="none" stroke="#fff" strokeWidth="0.9" opacity="0.75" />
      <path d="M10 92C30 98 46 86 62 88S94 97 110 92" fill="none" stroke="#fff" strokeWidth="0.8" opacity="0.55" />
      <path d={RIM} fill="none" stroke="#fff" strokeWidth="0.7" opacity="0.6" />
    </svg>
  );
}

export function Cosmonaut({ size = 28 }: { size?: number }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg className="cosmonaut" viewBox="0 0 48 40" width={size} height={(size * 40) / 48} aria-hidden="true">
      <defs>
        <linearGradient id={`${id}h`} x1="6" y1="6" x2="42" y2="36" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#ffffff" /><stop offset="0.5" stopColor="#f1e2d4" /><stop offset="1" stopColor="#c9925f" />
        </linearGradient>
        <radialGradient id={`${id}v`} cx="0.4" cy="0.3" r="0.9">
          <stop offset="0" stopColor="#2a2733" /><stop offset="1" stopColor="#0d0c12" />
        </radialGradient>
      </defs>
      <rect x="3" y="14" width="6" height="13" rx="3" fill={`url(#${id}h)`} />
      <rect x="39" y="14" width="6" height="13" rx="3" fill={`url(#${id}h)`} />
      <ellipse cx="24" cy="20.5" rx="17.5" ry="16" fill={`url(#${id}h)`} />
      <rect x="9.5" y="9" width="29" height="23" rx="10.5" fill={`url(#${id}v)`} />
      <path d="M15.5 21.5q3-3.6 6 0M26.5 21.5q3-3.6 6 0" fill="none" stroke="#fff" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  );
}
