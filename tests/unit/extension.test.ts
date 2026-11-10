import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { allowedExtensionIds, callerOf, corsFor, extensionToken, judge, ROOM_ID, SIDEKICK_ID, tokenMatches } from "../../server/extension.ts";

const ids = allowedExtensionIds("");
const TOKEN = "t".repeat(40);
const origin = `chrome-extension://${SIDEKICK_ID}`;
const req = (method: string, headers: Record<string, string> = {}) => ({ method, headers: headers as never });

describe("which extension may call", () => {
  it("knows the Sidekick, adds only well-formed ids from the environment", () => {
    expect(ids.has(SIDEKICK_ID)).toBe(true);
    const more = allowedExtensionIds(`${"a".repeat(32)}, nonsense, ${"Q".repeat(32)}`);
    expect(more.has("a".repeat(32))).toBe(true);
    expect(more.size).toBe(3);
    expect(more.has(ROOM_ID)).toBe(true);
  });
  it("treats web pages and plain requests as the usual callers", () => {
    expect(callerOf(undefined, ids).kind).toBe("other");
    expect(callerOf("https://evil.example", ids).kind).toBe("other");
    expect(callerOf("http://localhost:5173", ids).kind).toBe("other");
  });
  it("refuses every extension that is not on the list, and Firefox ones", () => {
    expect(callerOf(`chrome-extension://${"b".repeat(32)}`, ids).kind).toBe("refused");
    expect(callerOf(`moz-extension://${SIDEKICK_ID}`, ids).kind).toBe("refused");
    expect(callerOf(origin, ids).kind).toBe("extension");
    expect(callerOf(`${origin}.evil`, ids).kind).toBe("refused");
  });
});

describe("judging a request", () => {
  it("leaves web and desktop requests to the old rules, with no CORS headers", () => {
    const v = judge(req("GET", { origin: "https://evil.example" }), "/api/health", ids, TOKEN);
    expect(v).toEqual({ go: true, extension: false, headers: {} });
  });
  it("answers a preflight for the named origin only, never *", () => {
    const v = judge(req("OPTIONS", { origin }), "/api/assist", ids, TOKEN);
    expect(v.go).toBe(false);
    expect(v.headers["Access-Control-Allow-Origin"]).toBe(origin);
    expect(JSON.stringify(v.headers)).not.toContain("*");
    expect(v.headers).not.toHaveProperty("Access-Control-Allow-Credentials");
  });
  it("needs the token, then lets only the short list of endpoints through", () => {
    expect(judge(req("POST", { origin }), "/api/assist", ids, TOKEN)).toMatchObject({ go: false, status: 403 });
    expect(judge(req("POST", { origin, "x-aetherdeck-token": "wrong" }), "/api/assist", ids, TOKEN)).toMatchObject({ go: false, status: 403 });
    expect(judge(req("POST", { origin, "x-aetherdeck-token": TOKEN }), "/api/assist", ids, TOKEN)).toMatchObject({ go: true, extension: true });
    expect(judge(req("GET", { origin, "x-aetherdeck-token": TOKEN }), "/api/health", ids, TOKEN)).toMatchObject({ go: true });
    for (const p of ["/api/agent", "/api/crew/turn", "/api/sync/x", "/api/frameable", "/"]) {
      expect(judge(req("POST", { origin, "x-aetherdeck-token": TOKEN }), p, ids, TOKEN)).toMatchObject({ go: false, status: 404 });
    }
  });
  it("forbids another extension even with the right token", () => {
    const other = `chrome-extension://${"c".repeat(32)}`;
    expect(judge(req("POST", { origin: other, "x-aetherdeck-token": TOKEN }), "/api/health", ids, TOKEN)).toMatchObject({ go: false, status: 403, headers: {} });
  });
});

describe("the token", () => {
  it("compares exactly", () => {
    expect(tokenMatches(TOKEN, TOKEN)).toBe(true);
    expect(tokenMatches(TOKEN.slice(1), TOKEN)).toBe(false);
    expect(tokenMatches(undefined, TOKEN)).toBe(false);
    expect(tokenMatches(["x"], TOKEN)).toBe(false);
    expect(tokenMatches("", "")).toBe(false);
  });
  it("is made once, kept in a file only the owner can read, and reused", () => {
    const dir = mkdtempSync(join(tmpdir(), "ext-"));
    const a = extensionToken(dir, "");
    expect(a.token.length).toBeGreaterThanOrEqual(32);
    expect(readFileSync(a.file!, "utf8").trim()).toBe(a.token);
    if (process.platform !== "win32") expect(statSync(a.file!).mode & 0o077).toBe(0);
    expect(extensionToken(dir, "").token).toBe(a.token);
  });
  it("can come from the environment instead, but not a weak one", () => {
    const dir = mkdtempSync(join(tmpdir(), "ext-"));
    expect(extensionToken(dir, "x".repeat(20)).token).toBe("x".repeat(20));
    expect(extensionToken(dir, "short").file).toBeDefined();
  });
  it("sets credentials off in CORS", () => {
    expect(corsFor(origin)["Access-Control-Allow-Headers"]).toContain("X-AetherDeck-Token");
  });
});
