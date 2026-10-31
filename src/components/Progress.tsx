// A quiet line that shows what the agent is doing, with the full tool log one click away.
import { useState } from "react";
import type { EnvironmentModel } from "../../shared/types.ts";

export function Progress({ model, streaming, error }: { model: EnvironmentModel | null; streaming: boolean; error: string }) {
  const [open, setOpen] = useState(false);
  if (error) return <div className="progress progress--error" role="alert" data-ui>{error}</div>;
  if (!model) return streaming ? <div className="progress" role="status" data-ui><span className="pulse" /> Interpreting</div> : null;
  const t = model.task;
  const current = t.steps.find((s) => s.status === "running");
  const ok = t.toolCalls.filter((c) => c.status === "ok" || c.status === "cached");
  const summary = model.complete
    ? [`${model.sources.length} ${model.sources.length === 1 ? "source" : "sources"}`, model.evidence.length ? `${model.evidence.filter((e) => e.evidenceType !== "gap").length} findings` : "", model.synthesisMode === "ai" ? "AI-organized, citations checked" : model.evidence.length ? "verbatim excerpts" : ""].filter(Boolean).join(" · ")
    : `${current?.label ?? "Working"}${current?.detail ? ` — ${current.detail}` : ""}`;
  return (
    <div className="progress" role="status" aria-live="polite" data-ui>
      {!model.complete && <span className="pulse" />}
      <span>{summary}</span>
      <button className="link" onClick={() => setOpen((o) => !o)} aria-expanded={open}>{open ? "hide steps" : "how"}</button>
      {open && (
        <div className="progress__log">
          <ol>
            {t.steps.map((s) => <li key={s.id} className={`st st--${s.status}`}>{s.label}{s.detail ? ` — ${s.detail}` : ""}</li>)}
          </ol>
          <table>
            <thead><tr><th>Source</th><th>Status</th><th>Results</th><th>Time</th></tr></thead>
            <tbody>
              {t.toolCalls.map((c, i) => (
                <tr key={i}><td>{c.provider}</td><td>{c.status}{c.note ? ` (${c.note})` : ""}</td><td>{c.count}</td><td>{c.ms ? `${(c.ms / 1000).toFixed(1)} s` : "—"}</td></tr>
              ))}
            </tbody>
          </table>
          <p className="fine">Planned by {model.intent.plannedBy === "llm" ? "AI" : "built-in rules"} as “{model.intent.intentType.replace("_", " ")}”. {ok.length} source calls answered.</p>
        </div>
      )}
    </div>
  );
}
