// Cosmonaut's face: a friendly little astronaut with a glossy visor, big eyes and a blinking antenna star.
import { useId } from "react";

export function Cosmo({ size = 40, className }: { size?: number; className?: string }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg className={`cosmo ${className ?? ""}`} viewBox="0 0 64 64" width={size} height={size} aria-hidden="true">
      <defs>
        <radialGradient id={`${id}b`} cx="32%" cy="25%" r="85%"><stop offset="0" stopColor="#ffb86b" /><stop offset=".45" stopColor="#ff6fa8" /><stop offset="1" stopColor="#6c4bff" /></radialGradient>
        <radialGradient id={`${id}h`} cx="35%" cy="25%" r="80%"><stop offset="0" stopColor="#fff" /><stop offset="1" stopColor="#cfd8ff" /></radialGradient>
        <linearGradient id={`${id}v`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#3b2a8f" /><stop offset="1" stopColor="#120b3a" /></linearGradient>
      </defs>
      <circle cx="32" cy="32" r="32" fill={`url(#${id}b)`} />
      <g className="cosmo__stars" fill="#fff"><circle cx="9" cy="14" r="1.3" /><circle cx="55" cy="46" r="1.2" /><circle cx="50" cy="12" r="1" /><circle cx="11" cy="48" r="1" /></g>
      <path d="M32 11V6" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" />
      <path className="cosmo__star" d="m32 1.6 1.6 3.2 3.4.5-2.5 2.4.6 3.4L32 9.4l-3.1 1.7.6-3.4-2.5-2.4 3.4-.5Z" fill="#ffe27a" />
      <circle cx="32" cy="35" r="20" fill={`url(#${id}h)`} />
      <ellipse cx="32" cy="35" rx="15.5" ry="13.5" fill={`url(#${id}v)`} />
      <g className="cosmo__eyes"><ellipse cx="26.2" cy="35" rx="2.7" ry="3.6" fill="#7cf3ff" /><ellipse cx="37.8" cy="35" rx="2.7" ry="3.6" fill="#7cf3ff" /><circle cx="27" cy="33.6" r="1" fill="#fff" /><circle cx="38.6" cy="33.6" r="1" fill="#fff" /></g>
      <path d="M28.5 41.2q3.5 2.6 7 0" fill="none" stroke="#7cf3ff" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M21 29q3-6 10-6.6" fill="none" stroke="#fff" strokeOpacity=".5" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="14.5" cy="38" r="2.6" fill="#ff8fb8" fillOpacity=".7" /><circle cx="49.5" cy="38" r="2.6" fill="#ff8fb8" fillOpacity=".7" />
    </svg>
  );
}

/** The Agent Station's mascot: a cheerful little robot with a headset and a waving antenna. */
export function AgentBot({ size = 40, className }: { size?: number; className?: string }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg className={`cosmo ${className ?? ""}`} viewBox="0 0 64 64" width={size} height={size} aria-hidden="true">
      <defs>
        <linearGradient id={`${id}b`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#7cf5c4" /><stop offset=".55" stopColor="#1fb6d4" /><stop offset="1" stopColor="#4a56e8" /></linearGradient>
        <linearGradient id={`${id}f`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#fff" /><stop offset="1" stopColor="#d6e4ff" /></linearGradient>
      </defs>
      <circle cx="32" cy="32" r="32" fill={`url(#${id}b)`} />
      <path d="M32 15V9" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" />
      <circle className="cosmo__star" cx="32" cy="7" r="3.6" fill="#ff7ab8" />
      <rect x="12" y="29" width="5" height="11" rx="2.5" fill="#ffe27a" /><rect x="47" y="29" width="5" height="11" rx="2.5" fill="#ffe27a" />
      <rect x="15" y="15" width="34" height="32" rx="12" fill={`url(#${id}f)`} />
      <rect x="20" y="22" width="24" height="17" rx="8" fill="#14204f" />
      <g className="cosmo__eyes"><circle cx="27" cy="30" r="3" fill="#7cf3ff" /><circle cx="37" cy="30" r="3" fill="#7cf3ff" /><circle cx="28" cy="29" r=".9" fill="#fff" /><circle cx="38" cy="29" r=".9" fill="#fff" /></g>
      <path d="M28 35.2q4 2.8 8 0" fill="none" stroke="#7cf3ff" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M15 32q-1-12 17-14" fill="none" stroke="#14204f" strokeWidth="1.6" strokeOpacity=".0" />
      <rect x="22" y="49" width="20" height="8" rx="4" fill="#fff" fillOpacity=".85" /><circle cx="28" cy="53" r="1.4" fill="#ff7ab8" /><circle cx="36" cy="53" r="1.4" fill="#ffe27a" />
    </svg>
  );
}

/** The Research Station's mascot: a wise little owl peering through a magnifying glass. */
export function ResearchOwl({ size = 40, className }: { size?: number; className?: string }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg className={`cosmo ${className ?? ""}`} viewBox="0 0 64 64" width={size} height={size} aria-hidden="true">
      <defs>
        <linearGradient id={`${id}b`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#ffd36b" /><stop offset=".5" stopColor="#ff8a4c" /><stop offset="1" stopColor="#e0408f" /></linearGradient>
        <linearGradient id={`${id}o`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#8a5a3c" /><stop offset="1" stopColor="#5a3523" /></linearGradient>
      </defs>
      <circle cx="32" cy="32" r="32" fill={`url(#${id}b)`} />
      <path d="M17 18 24 25M47 18 40 25" stroke="#5a3523" strokeWidth="4.5" strokeLinecap="round" />
      <ellipse cx="32" cy="37" rx="19" ry="19.5" fill={`url(#${id}o)`} />
      <ellipse cx="32" cy="43" rx="10.5" ry="11.5" fill="#f6dfc0" />
      <g fill="#fff"><circle cx="24" cy="32" r="8.2" /><circle cx="40" cy="32" r="8.2" /></g>
      <g className="cosmo__eyes"><circle cx="25" cy="33" r="4" fill="#2a1a3d" /><circle cx="39" cy="33" r="4" fill="#2a1a3d" /><circle cx="26.3" cy="31.6" r="1.3" fill="#fff" /><circle cx="40.3" cy="31.6" r="1.3" fill="#fff" /></g>
      <path d="m32 35 3 4.2h-6Z" fill="#ffb02e" />
      <circle cx="46" cy="42" r="9" fill="#9fe8ff" fillOpacity=".35" stroke="#fff" strokeWidth="3" />
      <path d="m52.5 48.5 6 6" stroke="#fff" strokeWidth="4" strokeLinecap="round" />
      <path d="M41.5 38.5q2-2 5-1.8" stroke="#fff" strokeOpacity=".8" strokeWidth="1.6" strokeLinecap="round" fill="none" />
      <path className="cosmo__star" d="m13 44 1.2 2.6 2.6 1.2-2.6 1.2L13 51.6l-1.2-2.6-2.6-1.2 2.6-1.2Z" fill="#fff" />
    </svg>
  );
}
