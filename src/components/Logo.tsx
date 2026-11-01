// The Warpnaut mark: a helmet at warp speed, in the same strokes as the app icon (build/icon.svg).
export function Logo({ size = 26 }: { size?: number }) {
  return (
    <svg className="logo" viewBox="0 0 64 64" width={size} height={size} aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeLinecap="round">
        <circle cx="40" cy="30" r="20" strokeWidth="5" />
        <path d="M27 49c8 5 18 5 26 0" strokeWidth="5" />
        <path d="M4 20h13M2 32h10M6 44h13" strokeWidth="5" />
      </g>
      <rect x="28" y="21" width="24" height="18" rx="9" fill="currentColor" />
    </svg>
  );
}
