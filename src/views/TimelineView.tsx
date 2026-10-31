// News: reports placed along time, alternating above and below the axis; background reading to the left.
import { Spot, SourceChip, Threads, type ViewProps } from "./primitives.tsx";

export function TimelineView({ model, layout, selectedId, onSelect }: ViewProps) {
  const { pos, ticks = [] } = layout;
  const sourceById = new Map(model.sources.map((s) => [s.id, s]));
  const dated = model.nodes.filter((n) => n.visualizationHints.time && pos[n.id]);
  const xs = dated.map((n) => pos[n.id].x);
  const minX = Math.min(...xs, 0) - 120;
  const maxX = Math.max(...xs, 0) + 120;
  const stems = dated.map((n) => ({ key: n.id, a: { x: pos[n.id].x, y: 0 }, b: pos[n.id], kind: "stem", active: selectedId === n.id }));
  return (
    <>
      <Threads lines={[{ key: "axis", a: { x: minX, y: 0 }, b: { x: maxX, y: 0 }, kind: "axis" }, ...stems]} />
      <Spot at={pos.root} className="z-top">
        <div className="question">
          <span className="question__eyebrow">{model.intent.constraints.time === "today" ? "Recent reporting · newest on the right" : "Reporting over time"}</span>
          <h1 className="question__title">{model.intent.query}</h1>
        </div>
      </Spot>
      {ticks.map((t) => (
        <Spot key={t.label + t.x} at={{ x: t.x, y: 0 }}>
          <span className="tick">{t.label}</span>
        </Spot>
      ))}
      {model.nodes.filter((n) => n.id !== "root").map((n, i) => {
        const s = sourceById.get(n.sourceIds[0]);
        if (!s) return null;
        return (
          <Spot key={n.id} at={pos[n.id]} delay={i * 50} card>
            <SourceChip node={n} source={s} selected={selectedId === n.id} onSelect={() => onSelect(n)} />
          </Spot>
        );
      })}
    </>
  );
}
