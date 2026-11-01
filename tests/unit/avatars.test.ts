import { describe, expect, it } from "vitest";
import { doingText, moodOf, seat, type Run } from "../../src/lib/agents.ts";
import { ramMood } from "../../src/lib/ram.ts";

const step = (tool: string, status: "running" | "done" = "running") => ({ id: "1", tool, input: { url: "https://www.a.test/x" }, status });
const run = (p: Partial<Run>): Run => ({ agentId: "a", status: "working", steps: [], said: "", ...p });

describe("avatar moods", () => {
  it("greets until its first run, then idles", () => {
    expect(moodOf({})).toBe("hello");
    expect(moodOf({ last: { at: 1, report: "" } })).toBe("idle");
  });
  it("salutes a new task, then acts out each tool", () => {
    expect(moodOf({}, run({}))).toBe("salute");
    expect(moodOf({}, run({ steps: [step("search_web")] }))).toBe("search");
    expect(moodOf({}, run({ steps: [step("fetch_page")] }))).toBe("read");
    expect(moodOf({}, run({ steps: [step("crawl_pages")] }))).toBe("harvest");
    expect(moodOf({}, run({ steps: [step("read_inbox")] }))).toBe("mail");
    expect(moodOf({}, run({ steps: [step("watch_video")] }))).toBe("watch");
    expect(moodOf({}, run({ steps: [step("build_app")] }))).toBe("build");
    expect(moodOf({}, run({ steps: [step("click")] }))).toBe("act");
  });
  it("thinks between steps", () => { expect(moodOf({}, run({ steps: [step("click", "done")] }))).toBe("think"); });
  it("waiting for the person wins over everything", () => {
    expect(moodOf({}, run({ steps: [step("click")], ask: { question: "?", answer: () => undefined } }))).toBe("wait");
  });
  it("shows how a run ended", () => {
    expect(moodOf({}, run({ status: "done" }))).toBe("done");
    expect(moodOf({}, run({ status: "failed" }))).toBe("failed");
    expect(moodOf({}, run({ status: "stopped" }))).toBe("stopped");
  });
  it("says what it's doing", () => { expect(doingText(step("fetch_page"))).toBe("Reading a.test/x…"); });
  it("puts up to five on the front row and the rest behind", () => {
    expect(seat(4, 7)).toMatchObject({ back: false, y: 0.72 });
    expect(seat(5, 7)).toMatchObject({ back: true, x: 1 / 3 });
    expect(seat(0, 1).x).toBe(0.5);
  });
});

describe("Ram", () => {
  it("grows with memory against half the computer", () => {
    expect(ramMood(800, 16384).state).toBe("light");
    expect(ramMood(3000, 16384).state).toBe("fed");
    expect(ramMood(6000, 16384).state).toBe("full");
    expect(ramMood(8000, 16384).state).toBe("bursting");
    expect(ramMood(800, 16384).puff).toBeLessThan(ramMood(6000, 16384).puff);
  });
});
