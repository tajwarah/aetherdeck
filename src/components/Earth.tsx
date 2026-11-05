// The home's backdrop: deep space crossed by two soft beams of light, and Earth at night rising from the bottom of
// the screen, Europe and Africa under a peach-to-lavender horizon. The Earth is one picture, rendered ahead of time
// from NASA's Black Marble (public/brand/CREDITS.md), so the home costs nothing to draw while you browse.
export function Earth({ dim }: { dim: boolean }) {
  return (
    <div className={`earth ${dim ? "earth--dim" : ""}`} aria-hidden="true">
      <div className="earth__beam earth__beam--peach" />
      <div className="earth__beam earth__beam--lavender" />
      <img className="earth__globe" src="/brand/earth-night.webp" alt="" decoding="async" draggable={false} />
    </div>
  );
}
