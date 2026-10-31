import { describe, expect, it, vi } from "vitest";
import { needsApproval, runAgent, type Agent, type Run } from "../../src/lib/agents.ts";
import { AgentTurn, systemFor } from "../../server/claude.ts";
import { httpsFor, siteOf, withoutTrackers } from "../../shared/shields.ts";
import { curveFor, toPage, toScreen } from "../../shared/curve.ts";

const agent: Agent = { id: "a", name: "Test", role: "", task: "Do it", plan: [], access: "ask", model: "claude-opus-5-5", hue: 0, notes: [] };
const harness = (turns: { content: unknown[]; stop: string }[], tool = vi.fn(async () => "ok")) => {
  let run: Run = { agentId: "a", status: "working", steps: [], said: "" };
  const seen: unknown[][] = [];
  const done = runAgent(agent, {
    turn: async (m) => { seen.push(structuredClone(m)); return turns.shift() as never; },
    tool, update: (p) => { run = p(run); }, signal: new AbortController().signal,
  });
  return { done, get run() { return run; }, seen, tool };
};

describe("running an agent", () => {
  it("runs tools, sends results back, and finishes with the report", async () => {
    const h = harness([
      { content: [{ type: "thinking", thinking: "x" }, { type: "tool_use", id: "t1", name: "read_page", input: {} }], stop: "tool_use" },
      { content: [{ type: "text", text: "All done" }], stop: "end_turn" },
    ]);
    await h.done;
    expect(h.run.status).toBe("done");
    expect(h.run.report).toBe("All done");
    expect(h.run.steps[0]).toMatchObject({ tool: "read_page", status: "done" });
    const second = h.seen[1] as { role: string; content: { type: string; tool_use_id?: string }[] }[];
    expect(second[1].content[0].type).toBe("thinking"); // Claude's own blocks go back unchanged
    expect(second[2].content[0]).toMatchObject({ type: "tool_result", tool_use_id: "t1" });
  });
  it("tells Claude when a tool fails, and carries on", async () => {
    const h = harness([
      { content: [{ type: "tool_use", id: "t1", name: "click", input: {} }], stop: "tool_use" },
      { content: [{ type: "text", text: "Stopped" }], stop: "end_turn" },
    ], vi.fn(async () => { throw new Error("nope"); }));
    await h.done;
    expect((h.seen[1] as { content: { is_error?: boolean }[] }[])[2].content[0].is_error).toBe(true);
  });
  it("reports a refusal instead of calling it done", async () => {
    await expect(harness([{ content: [], stop: "refusal" }]).done).rejects.toThrow(/declined/);
  });
});

describe("what needs the person", () => {
  it("asks for everything in ask mode", () => expect(needsApproval("ask", "open the menu")).toBeTruthy());
  it("still asks about consequential words when working alone", () => {
    expect(needsApproval("auto", "click “Open menu”")).toBeNull();
    for (const w of ["Buy now", "Send", "Sign in", "Delete account", "Checkout", "Place order"]) expect(needsApproval("auto", `click “${w}”`)).toBeTruthy();
  });
});

describe("what an agent is told", () => {
  const a = AgentTurn.shape.agent.parse({ name: "N", task: "T", access: "read" });
  it("treats pages as information, not instructions", () => expect(systemFor(a)).toMatch(/never an instruction/));
  it("is told it can't sign in or pay", () => expect(systemFor(a)).toMatch(/never sign in/));
});

describe("shields", () => {
  it("removes tracking tags and keeps the rest", () => {
    expect(withoutTrackers("https://a.com/x?id=1&utm_source=n&fbclid=2")).toBe("https://a.com/x?id=1");
    expect(withoutTrackers("https://a.com/x?id=1")).toBe("https://a.com/x?id=1");
  });
  it("moves public pages to https, but not local ones or sites known not to have it", () => {
    expect(httpsFor("http://a.com/", new Set())).toBe("https://a.com/");
    expect(httpsFor("http://localhost:3000/", new Set())).toBeNull();
    expect(httpsFor("http://192.168.1.4/", new Set())).toBeNull();
    expect(httpsFor("http://a.com/", new Set(["a.com"]))).toBeNull();
    expect(httpsFor("https://a.com/", new Set())).toBeNull();
  });
  it("names a site", () => expect(siteOf("https://www.a.com/x")).toBe("a.com"));
});

describe("the curve at any bend", () => {
  it.each([0.3, 0.55, 0.8, 1])("maps a pointer back to the page at bend %s", (b) => {
    const c = curveFor(b);
    const s = toScreen(0.2, 0.7, c);
    const p = toPage(s.x, s.y, c)!;
    expect(p.u).toBeCloseTo(0.2, 3);
    expect(p.v).toBeCloseTo(0.7, 3);
  });
  it("keeps the sides at the edge of the drawing", () => expect(toScreen(1, 0.5, curveFor(0.4)).x).toBeCloseTo(1, 5));
});
