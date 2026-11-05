// The home: the mark alone, above the turning Earth. To ask, open an address or play something, click anywhere or
// press "/"; the dock has the rest.
import { useEffect, useState } from "react";
import { LogoDust } from "./Logo.tsx";

const widthFor = (vw: number) => Math.round(Math.min(300, Math.max(170, vw * 0.17)));

export function Hero() {
  const [width, setWidth] = useState(() => widthFor(window.innerWidth));
  useEffect(() => {
    const on = () => setWidth(widthFor(window.innerWidth));
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return (
    <section className="hero" data-ui aria-label="AetherDeck">
      <LogoDust width={width} />
    </section>
  );
}
