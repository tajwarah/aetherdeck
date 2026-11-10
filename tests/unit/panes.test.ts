import { describe, expect, it } from "vitest";
import { addPane, buildRule, gridCols, hostOf, isPaneRuleId, MAX_PANES, neverStrip, normalizeUrl, nextPaneId, permissionPattern, removePane, ruleIdFor, tileBounds, tileFirst } from "../../chromium/src/panesLogic.ts";

describe("addresses typed into a pane", () => {
  it("adds https to a bare site and keeps only http(s)", () => {
    expect(normalizeUrl("pinterest.com")).toBe("https://pinterest.com/");
    expect(normalizeUrl(" https://github.com/a/b ")).toBe("https://github.com/a/b");
    expect(normalizeUrl("localhost:3000")).toBe("https://localhost:3000/");
    for (const bad of ["", "hello", "javascript:alert(1)", "file:///etc/passwd", "chrome://settings", "https://user:pw@example.com", "ftp://x.com"]) expect(normalizeUrl(bad)).toBeNull();
  });
  it("reads the host", () => {
    expect(hostOf("https://WWW.YouTube.com/watch")).toBe("www.youtube.com");
    expect(hostOf("nonsense")).toBe("");
  });
});

describe("the refuse lists", () => {
  it("sends Google mail and account pages straight to a window", () => {
    for (const h of ["mail.google.com", "accounts.google.com", "myaccount.google.com", "gmail.com", "accounts.youtube.com"]) expect(tileFirst(h)).toBe(true);
    for (const h of ["www.youtube.com", "github.com", "pinterest.com", "evilgoogle.com", "google.com.evil.example"]) expect(tileFirst(h)).toBe(false);
  });
  it("adds the sites the user marks, subdomains included", () => {
    expect(tileFirst("app.example.com", ["Example.com"])).toBe(true);
    expect(tileFirst("notexample.com", ["example.com"])).toBe(false);
  });
  it("never allows a rule for anything under google.com, nor the YouTube sign-in host", () => {
    for (const h of ["google.com", "mail.google.com", "accounts.google.com", "docs.google.com", "gmail.com", "accounts.youtube.com", "ACCOUNTS.GOOGLE.COM"]) expect(neverStrip(h)).toBe(true);
    for (const h of ["www.youtube.com", "youtube.com", "github.com", "pinterest.com", "notgoogle.com"]) expect(neverStrip(h)).toBe(false);
  });
});

describe("the one rule a pane can have", () => {
  it("is for frames only, one tab, one host, and removes only the two framing headers", () => {
    const rule = buildRule(3, "GitHub.com", 77)!;
    expect(rule.id).toBe(ruleIdFor(3));
    expect(isPaneRuleId(rule.id)).toBe(true);
    expect(rule.condition).toEqual({ requestDomains: ["github.com"], resourceTypes: ["sub_frame"], tabIds: [77] });
    expect(rule.action.type).toBe("modifyHeaders");
    expect(rule.action.responseHeaders.map((h) => h.header).sort()).toEqual(["content-security-policy", "x-frame-options"]);
    expect(rule.action.responseHeaders.every((h) => h.operation === "remove")).toBe(true);
  });
  it("refuses to build one for Google or sign-in hosts", () => {
    for (const h of ["mail.google.com", "accounts.google.com", "google.com", "gmail.com", "accounts.youtube.com"]) expect(buildRule(1, h, 5)).toBeNull();
  });
  it("lets plain YouTube through but leaves its sign-in host out", () => {
    expect(buildRule(1, "www.youtube.com", 5)!.condition.excludedRequestDomains).toBeUndefined();
    const broad = buildRule(1, "youtube.com", 5)!;
    expect(broad.condition.requestDomains).toEqual(["youtube.com"]);
    expect(broad.condition.excludedRequestDomains).toEqual(["accounts.youtube.com"]);
  });
  it("needs a real tab and a sane pane id", () => {
    expect(buildRule(1, "github.com", -1)).toBeNull();
    expect(buildRule(1, "github.com", 1.5)).toBeNull();
    expect(buildRule(5000, "github.com", 1)).toBeNull();
    expect(buildRule(1, "", 1)).toBeNull();
  });
  it("keeps pane rule ids apart from the cookie test's", () => {
    expect(isPaneRuleId(4242)).toBe(false);
    expect(isPaneRuleId(ruleIdFor(1))).toBe(true);
    expect(isPaneRuleId(6000)).toBe(false);
  });
  it("asks the browser for that host only", () => {
    expect(permissionPattern("GitHub.com")).toBe("*://github.com/*");
  });
});

describe("the grid and the pane list", () => {
  it("lays out one to three in a row and four two by two", () => {
    expect([1, 2, 3, 4].map(gridCols)).toEqual([1, 2, 3, 2]);
  });
  it("adds up to four panes, reusing the lowest free id, and removes by id", () => {
    let panes = addPane([], "https://a.com/");
    panes = addPane(addPane(panes), "");
    expect(panes.map((p) => p.id)).toEqual([1, 2, 3]);
    expect(removePane(panes, 2).map((p) => p.id)).toEqual([1, 3]);
    expect(nextPaneId(removePane(panes, 2))).toBe(2);
    for (let i = 0; i < 6; i++) panes = addPane(panes);
    expect(panes).toHaveLength(MAX_PANES);
  });
});

describe("where a window is placed", () => {
  const win = { screenX: 100, screenY: 50, outerWidth: 1216, outerHeight: 900, innerWidth: 1200, innerHeight: 800 };
  it("adds the page's place on the screen and the toolbar above it", () => {
    expect(tileBounds({ left: 600, top: 40, width: 590, height: 700 }, win)).toEqual({ left: 708, top: 50 + 92 + 40, width: 590, height: 700 });
  });
  it("never makes a window too small to use", () => {
    const b = tileBounds({ left: 0, top: 0, width: 10, height: 10 }, win);
    expect(b.width).toBeGreaterThanOrEqual(240);
    expect(b.height).toBeGreaterThanOrEqual(180);
  });
  it("copes with a fullscreen page with no toolbar", () => {
    const b = tileBounds({ left: 0, top: 0, width: 500, height: 500 }, { screenX: 0, screenY: 0, outerWidth: 1000, outerHeight: 800, innerWidth: 1000, innerHeight: 800 });
    expect(b).toEqual({ left: 0, top: 0, width: 500, height: 500 });
  });
});
