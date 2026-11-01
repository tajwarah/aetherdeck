import { describe, expect, it } from "vitest";
import { APP_ID, APP_POLICY, isHumanCheck, paceFor, robotsAllow, robotsRules, safeFileName, toCsv } from "../../shared/harvest.ts";
import { keepRows, inParts } from "../../src/lib/agentTools.ts";

describe("robots.txt", () => {
  const txt = "User-agent: Googlebot\nDisallow: /nobody\n\nUser-agent: *\nDisallow: /private\nAllow: /private/open\nDisallow: /*.pdf$\nCrawl-delay: 3\n";
  const { rules, delay } = robotsRules(txt);
  it("uses the rules meant for everyone", () => { expect(robotsAllow(rules, "/nobody")).toBe(true); expect(robotsAllow(rules, "/private/x")).toBe(false); });
  it("lets the longest rule win", () => expect(robotsAllow(rules, "/private/open/page")).toBe(true));
  it("understands wildcards and line ends", () => { expect(robotsAllow(rules, "/a/b.pdf")).toBe(false); expect(robotsAllow(rules, "/a/b.pdfx")).toBe(true); });
  it("reads the crawl delay, within reason", () => { expect(delay).toBe(3); expect(paceFor(delay)).toBe(3000); expect(paceFor(0)).toBe(1000); expect(paceFor(600)).toBe(10_000); });
  it("allows everything when there is no file", () => expect(robotsAllow(robotsRules("").rules, "/anything")).toBe(true));
  it("shares rules between agents listed together", () => expect(robotsAllow(robotsRules("User-agent: a\nUser-agent: *\nDisallow: /x").rules, "/x")).toBe(false));
});

describe("what agents hand over", () => {
  it("spots a human check and leaves articles about them alone", () => {
    expect(isHumanCheck("Just a moment", "Verify you are human")).toBe(true);
    expect(isHumanCheck("Attention Required! | Cloudflare", "")).toBe(true);
    expect(isHumanCheck("How CAPTCHA works", "word ".repeat(1000))).toBe(false);
    expect(isHumanCheck("News", `${"long article ".repeat(400)} about captcha`)).toBe(false);
  });
  it("writes CSV that a spreadsheet can't run", () => {
    expect(toCsv([{ a: "=HYPERLINK(1)", b: 'say "hi", ok' }])).toBe(`a,b\n'=HYPERLINK(1),"say ""hi"", ok"`);
    expect(toCsv([{ a: "1" }, { b: "2" }])).toBe("a,b\n1,\n,2");
  });
  it("keeps file names to a file name", () => { expect(safeFileName("../../etc/passwd")).toBe("-..-etc-passwd"); expect(safeFileName("")).toBe("agent-file"); });
  it("keeps big results out of the conversation", () => {
    const data = new Map();
    const out = keepRows(data, "https://x.test", Array.from({ length: 1000 }, (_, i) => ({ n: String(i) })));
    expect(data.get("d1").rows).toHaveLength(1000);
    expect(out.length).toBeLessThan(500);
    expect(out).toContain('"rows":1000');
  });
  it("says where long text continues", () => {
    const first = inParts("u", "x".repeat(30_000));
    expect(first).toContain("offset 12000");
    expect(inParts("u", "x".repeat(30_000), 24_000)).not.toContain("offset");
  });
});

describe("apps agents build", () => {
  it("run with no network and no way off the page", () => {
    expect(APP_POLICY).toContain("connect-src 'none'");
    expect(APP_POLICY).toContain("form-action 'none'");
    expect(APP_POLICY).not.toContain("allow-top-navigation");
    expect(APP_POLICY).not.toContain("allow-popups");
    expect(APP_POLICY).not.toMatch(/https?:/);
  });
  it("only take plain ids", () => { expect(APP_ID.test("a1b2c3")).toBe(true); expect(APP_ID.test("../x")).toBe(false); expect(APP_ID.test("ABC")).toBe(false); });
});
