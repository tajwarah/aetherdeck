import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { authUrl, calendarAdd, driveSave, eventBody, exchangeCode, pkce, SCOPES, TokenKeeper, type GoogleTokens } from "../../server/google.ts";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe("Google PKCE and sign-in address", () => {
  it("makes an S256 challenge that matches its verifier", () => {
    const { verifier, challenge } = pkce();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
    expect(challenge).toBe(createHash("sha256").update(verifier).digest("base64url"));
    expect(pkce().verifier).not.toBe(verifier);
  });

  it("builds a loopback, offline, PKCE address with no Gmail scope", () => {
    const u = new URL(authUrl({ clientId: "id.apps.googleusercontent.com", redirect: "http://127.0.0.1:5555/auth/google", state: "s", challenge: "c" }));
    expect(u.origin + u.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(u.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:5555/auth/google");
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(u.searchParams.get("access_type")).toBe("offline");
    expect(u.searchParams.get("prompt")).toBe("consent");
    const scopes = u.searchParams.get("scope")!.split(" ");
    expect(scopes).toEqual([...SCOPES]);
    expect(scopes.join(" ")).not.toMatch(/gmail|mail\.google/);
  });

  it("sends the verifier and the client secret (when there is one) with the code", async () => {
    let sent: URLSearchParams | undefined;
    const f = (async (_u: string, init: RequestInit) => { sent = init.body as URLSearchParams; return json({ access_token: "a", refresh_token: "r", expires_in: 3600 }); }) as unknown as typeof fetch;
    await exchangeCode({ clientId: "id", clientSecret: "sec", code: "c", verifier: "v", redirect: "http://127.0.0.1:1/x" }, f);
    expect(Object.fromEntries(sent!)).toMatchObject({ grant_type: "authorization_code", code_verifier: "v", client_secret: "sec" });
    await expect(exchangeCode({ clientId: "id", code: "c", verifier: "v", redirect: "r" }, (async () => json({ error: "invalid_grant" }, 400)) as unknown as typeof fetch)).rejects.toThrow(/expired/);
  });
});

describe("Google token renewal", () => {
  function keeper(tokens: GoogleTokens, fetchImpl: typeof fetch, now = () => 1_000_000) {
    const state = { tokens, out: 0 };
    const k = new TokenKeeper({ get: () => ({ clientId: "id", clientSecret: "sec", tokens: state.tokens }), set: (t) => { state.tokens = t; }, signedOut: () => { state.out++; state.tokens = {}; }, fetch: fetchImpl, now });
    return { k, state };
  }

  it("reuses a token that is still good and renews one that is about to end", async () => {
    let calls = 0;
    const f = (async () => { calls++; return json({ access_token: "new", expires_in: 3600 }); }) as unknown as typeof fetch;
    const fresh = keeper({ access: "old", refresh: "r", expires: 1_000_000 + 600_000 }, f);
    expect(await fresh.k.token()).toBe("old");
    expect(calls).toBe(0);
    const stale = keeper({ access: "old", refresh: "r", expires: 1_000_000 + 60_000 }, f);
    expect(await stale.k.token()).toBe("new");
    expect(stale.state.tokens).toMatchObject({ access: "new", refresh: "r", expires: 1_000_000 + 3_600_000 });
  });

  it("renews once for simultaneous callers and sends the refresh token", async () => {
    let calls = 0; let body: URLSearchParams | undefined;
    const f = (async (_u: string, init: RequestInit) => { calls++; body = init.body as URLSearchParams; await new Promise((r) => setTimeout(r, 5)); return json({ access_token: "n", expires_in: 3600 }); }) as unknown as typeof fetch;
    const { k } = keeper({ refresh: "r1" }, f);
    expect(await Promise.all([k.token(), k.token(), k.token()])).toEqual(["n", "n", "n"]);
    expect(calls).toBe(1);
    expect(Object.fromEntries(body!)).toMatchObject({ grant_type: "refresh_token", refresh_token: "r1", client_id: "id", client_secret: "sec" });
  });

  it("signs out when Google revokes the grant, and says to sign in again", async () => {
    const { k, state } = keeper({ refresh: "r" }, (async () => json({ error: "invalid_grant" }, 400)) as unknown as typeof fetch);
    await expect(k.token()).rejects.toThrow(/Sign in with Google again/);
    expect(state.out).toBe(1);
    await expect(k.token()).rejects.toThrow(/Sign in with Google in Settings/);
  });

  it("keeps the signed-in state on a temporary failure", async () => {
    const { k, state } = keeper({ refresh: "r" }, (async () => json({}, 503)) as unknown as typeof fetch);
    await expect(k.token()).rejects.toThrow(/HTTP 503/);
    expect(state.out).toBe(0);
  });
});

describe("Drive and Calendar helpers", () => {
  const api = (f: typeof fetch) => ({ token: async () => "tok", fetch: f });
  it("uploads a Drive file with the bearer token", async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const f = (async (url: string, init: RequestInit) => { seen = { url, init }; return json({ id: "f1", name: "n.txt", webViewLink: "https://drive.google.com/x" }); }) as unknown as typeof fetch;
    expect(await driveSave(api(f), { name: "n.txt", content: "hello" })).toMatchObject({ id: "f1" });
    expect(seen!.url).toContain("uploadType=multipart");
    expect((seen!.init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    expect(String(seen!.init.body)).toContain("hello");
  });
  it("builds timed and all-day events and rejects a bad date", async () => {
    expect((eventBody({ title: "Lunch", start: "2026-11-12T12:00:00Z" }).end as { dateTime: string }).dateTime).toBe("2026-11-12T13:00:00.000Z");
    expect(eventBody({ title: "Trip", start: "2026-11-12" })).toMatchObject({ start: { date: "2026-11-12" }, end: { date: "2026-11-12" } });
    expect(() => eventBody({ title: "x", start: "tomorrow" })).toThrow(/ISO/);
    const f = (async () => json({ id: "e1", htmlLink: "l" })) as unknown as typeof fetch;
    expect(await calendarAdd(api(f), { title: "Lunch", start: "2026-11-12T12:00:00Z" })).toMatchObject({ id: "e1" });
  });
  it("turns an API error into a short message", async () => {
    const f = (async () => json({ error: { message: "Insufficient Permission" } }, 403)) as unknown as typeof fetch;
    await expect(calendarAdd(api(f), { title: "x", start: "2026-11-12" })).rejects.toThrow(/403.*Insufficient/);
  });
});
