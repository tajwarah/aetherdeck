import { describe, expect, it } from "vitest";
import { needsApproval, nextRun, orderFor, scheduleText } from "../../src/lib/agents.ts";
import { markdownToHtml, artifactHtml } from "../../shared/artifact.ts";
import { sitePath, siteName } from "../../electron/sites.ts";
import { toolsFor } from "../../server/claude.ts";

describe("deploying a task", () => {
  it("drafts the kind of agent the task needs", () => {
    expect(orderFor("Post my three videos to Instagram and YouTube").id).toBe("herald");
    expect(orderFor("Build a landing page for my bakery").id).toBe("artisan");
    expect(orderFor("Summarize my unread email").id).toBe("ibis");
    expect(orderFor("What changed in EU AI law this year?").id).toBe("falcon");
  });
});

describe("schedules", () => {
  const monday9 = new Date(2026, 10, 2, 9, 0).getTime(); // Monday 2 November 2026, 9:00
  it("runs daily at its time, the next one after the last", () => {
    expect(nextRun({ every: "day", at: "09:00" }, monday9)).toBe(new Date(2026, 10, 3, 9, 0).getTime());
    expect(nextRun({ every: "day", at: "18:30" }, monday9)).toBe(new Date(2026, 10, 2, 18, 30).getTime());
  });
  it("runs weekly on its day", () => {
    expect(nextRun({ every: "week", day: 3, at: "10:00" }, monday9)).toBe(new Date(2026, 10, 4, 10, 0).getTime());
  });
  it("runs hourly an hour after the last", () => {
    expect(nextRun({ every: "hour", last: monday9 }, monday9)).toBe(monday9 + 3_600_000);
  });
  it("reads plainly", () => expect(scheduleText({ every: "week", day: 1, at: "10:00" })).toBe("Every Monday at 10:00"));
});

describe("posting waits for the person", () => {
  it("asks before anything that publishes, shares or uploads", () => {
    for (const w of ["Click “Post” on facebook.com", "Click “Share” on instagram.com", "Click “Publish” on studio.youtube.com", "Click “Upload”"]) expect(needsApproval("auto", w)).toBe(w);
    expect(needsApproval("auto", "Click “Next”")).toBeNull();
  });
  it("gives the posting tools only to agents with the Post power", () => {
    expect(toolsFor({ skills: ["post"], access: "ask" }).map((t) => t.name)).toContain("attach_files");
    expect(toolsFor({ skills: [], access: "ask" }).map((t) => t.name)).not.toContain("attach_files");
  });
  it("lets every agent think, research, make artifacts and ask a crewmate", () => {
    const names = toolsFor({ skills: [], access: "read" }).map((t) => t.name);
    for (const n of ["think", "research", "make_artifact", "ask_agent"]) expect(names).toContain(n);
  });
});

describe("websites", () => {
  it("keeps every file inside its site, and only web files", () => {
    expect(sitePath("css/site.css")).toBe("css/site.css");
    expect(sitePath("/index.html")).toBe("index.html");
    expect(sitePath("../../etc/passwd.txt")).toBeNull();
    expect(sitePath("a/../../b.html")).toBeNull();
    expect(sitePath("run.sh")).toBeNull();
    expect(siteName("Moonbake Bakery!")).toBe("moonbake-bakery");
  });
});

describe("artifacts", () => {
  it("turns Markdown into a page and leaves no raw HTML through", () => {
    const html = markdownToHtml("# Title\n\nSome **bold** text with [a link](https://example.com).\n\n- one\n- two\n\n<script>alert(1)</script>");
    expect(html).toContain("<h1>Title</h1>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain('<a href="https://example.com"');
    expect(html).toContain("<ul><li>one</li><li>two</li></ul>");
    expect(html).not.toContain("<script>");
  });
  it("drops links that aren't web or mail", () => {
    expect(markdownToHtml("[x](javascript:alert(1))")).not.toContain("href");
  });
  it("keeps pages and charts as they were made", () => {
    expect(artifactHtml({ title: "t", kind: "chart", content: "<svg></svg>", agent: "A" })).toBe("<svg></svg>");
  });
});
