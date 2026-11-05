import { test, expect, devices, type Page } from "@playwright/test";

// Besides the home's bar, a click on empty space (or "/") opens the ask field where you are.
const ask = async (page: Page, q: string, from: "key" | "cursor" = "key") => {
  if (from === "cursor") await page.mouse.click(10, 320); // empty space at the edge, beside the home's bar
  else await page.keyboard.press("/");
  const input = page.getByRole("searchbox").or(page.getByLabel("Ask AetherDeck"));
  await expect(input).toBeFocused();
  await input.fill(q);
  await input.press("Enter");
};

/** The dock's chevron holds everything that isn't a site: all places, all windows, devices, settings. */
const more = async (page: Page, item: string) => {
  await page.getByRole("button", { name: /^More/ }).click();
  await page.getByRole("menuitem", { name: new RegExp(`^${item}`) }).click();
};

test("opens on a quiet home with places on the web, and asks from the cursor", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Explore beyond the ordinary." })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Your dock" }).getByRole("button", { name: "YouTube" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Ask Cosmonaut" })).toBeVisible();
  await expect(page.getByText("Sample data")).toBeVisible(); // demo mode is labeled, never passed off as live
  await ask(page, "Explain quantum computing and show me the original sources.", "cursor");
  await expect(page.getByRole("heading", { name: "Explain quantum computing and show me the original sources." })).toBeVisible();
});

test("the home's bar explores a question, and Cosmonaut opens from it", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Ask, open an address, or play something").fill("Explain quantum computing and show me the original sources.");
  await page.getByRole("button", { name: "Go", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Explain quantum computing and show me the original sources." })).toBeVisible();
  await expect(page.locator(".hero")).toHaveCount(0);
});

test("research: evidence map traces findings back to original sources", async ({ page }) => {
  await page.goto("/");
  await ask(page, "Explain quantum computing and show me the original sources.");
  // the mind map: sub-questions are its branches, the sources hang on them
  await expect(page.getByRole("button", { name: /^What is quantum computing\?, \d+ items?/ })).toBeVisible();
  await expect(page.getByText(/sources · \d+ findings/)).toBeVisible();

  // Open a source and check its provenance
  await page.getByRole("button", { name: /^Polynomial-Time Algorithms/ }).click();
  const sheet = page.getByRole("complementary", { name: "Source details" });
  await expect(sheet.getByRole("heading", { name: /Polynomial-Time Algorithms/ })).toBeVisible();
  await expect(sheet.getByText("Sample data — not retrieved", { exact: false })).toBeVisible();
  await expect(sheet.getByText("Peter W. Shor")).toBeVisible();
  // sample sources are never presented with an "Open original" call to action
  await expect(sheet.getByRole("link", { name: "Open original" })).toHaveCount(0);
  await expect(sheet.getByRole("link", { name: /arxiv.org\/abs\/quant-ph\/9508027/ })).toHaveAttribute("href", "https://arxiv.org/abs/quant-ph/9508027");

  // Escape closes the sheet, then returns to orientation
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.locator(".hero")).toBeVisible();
});

test("local: asks for a location first and never fabricates businesses", async ({ page }) => {
  await page.route("**/api/geocode?*", (r) => r.fulfill({ json: { lat: 23.79, lon: 90.41, label: "Gulshan, Dhaka" } }));
  await page.goto("/");
  await ask(page, "Find an AC repair technician near me today.");
  const dialog = page.getByRole("dialog", { name: "Where should I look?" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Neighbourhood or city").fill("Gulshan, Dhaka");
  await dialog.getByRole("button", { name: "Look there" }).click();
  await expect(page.getByRole("table", { name: "Comparison of nearby listings" })).toBeVisible();
  await expect(page.getByText(/Placeholder technician A/).first()).toBeVisible();
  await expect(page.getByText("sample only").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Prepare request" })).toHaveCount(0);
});

test("action: prepares a request, requires confirmation, and hands off without claiming it was sent", async ({ page }) => {
  // A fixture listing (not sample) so the action path is reachable without live data.
  const place = {
    id: "osm-fixture", title: "Fixture Cooling Service", canonicalUrl: "https://www.openstreetmap.org/node/1", domain: "openstreetmap.org",
    publisher: "OpenStreetMap contributors", contentType: "place", snippet: "Listed as hvac.", retrievedAt: new Date().toISOString(),
    sourceProvider: "osm", freshnessStatus: "live", place: { lat: 23.791, lon: 90.411, distanceKm: 0.2, phone: "+880 1700 000000", category: "hvac", osmUrl: "https://www.openstreetmap.org/node/1" },
    limitations: ["Fixture"],
  };
  await page.route("**/api/explore", async (route) => {
    const body = route.request().postDataJSON();
    const intent = {
      query: body.query, normalizedQuery: body.query.toLowerCase(), intentType: "local_service", mode: "act",
      constraints: { time: "today", topic: "ac repair", qualities: [], placeHint: null },
      locationContext: { needed: true, source: "user_supplied", label: "Gulshan", lat: 23.79, lon: 90.41 },
      requestedContentTypes: ["place"], requestedDepth: "standard", searchQueries: [body.query], providers: ["osm"], sourceQuality: "", expectedOutput: "comparison", plannedBy: "rules",
    };
    const model = {
      id: "m1", intent, visualization: "comparison", dataMode: "live", synthesisMode: "extractive",
      nodes: [
        { id: "root", title: "ac repair", nodeType: "intent", parentId: null, relatedNodeIds: [], sourceIds: [], visualizationHints: { weight: 1 } },
        { id: `src:${place.id}`, title: place.title, nodeType: "place", parentId: "root", relatedNodeIds: [], sourceIds: [place.id], visualizationHints: { weight: 1, lat: 23.791, lon: 90.411 } },
      ],
      sources: [place], evidence: [], actions: [], notices: [],
      task: { id: "t", status: "done", objective: "", steps: [], toolCalls: [], requiresConfirmation: false }, complete: true,
    };
    await route.fulfill({ contentType: "application/x-ndjson", body: JSON.stringify({ type: "model", model }) + "\n" });
  });
  await page.goto("/");
  await page.evaluate(() => { (window as unknown as { __opened: string[] }).__opened = []; window.open = ((u: string) => { (window as unknown as { __opened: string[] }).__opened.push(u); return null; }) as typeof window.open; });
  await ask(page, "AC repair technician in Gulshan");
  await page.getByRole("button", { name: "Prepare request" }).click();
  const sheet = page.getByRole("dialog", { name: "Fixture Cooling Service" });
  await sheet.getByLabel("What needs fixing?").fill("Split AC not cooling");
  await sheet.getByRole("button", { name: "Prepare draft" }).click();
  await expect(sheet.getByLabel(/^Message/)).toHaveValue(/Split AC not cooling\./);
  const call = sheet.getByRole("button", { name: /Call \+880/ });
  await expect(call).toBeDisabled(); // nothing happens without explicit review
  await sheet.getByLabel(/I've reviewed this/).check();
  await call.click();
  await expect(sheet.getByText("Handed off — not sent.")).toBeVisible();
  await expect(sheet.getByText(/Not sent by AetherDeck/)).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __opened: string[] }).__opened)).toEqual(["tel:+8801700000000"]);
});

test("privacy: history is off by default and everything can be erased", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Accounts" }).click();
  await page.getByRole("button", { name: "Your data and privacy" }).click();
  const dialog = page.getByRole("dialog", { name: "Your data" });
  await expect(dialog.getByLabel(/Remember what I explore/)).not.toBeChecked();
  await expect(dialog.getByText("Not shared. Local searches will ask first.")).toBeVisible();
  await dialog.getByLabel(/Remember what I explore/).check();
  await page.keyboard.press("Escape");
  await ask(page, "Explain quantum computing");
  await page.getByRole("button", { name: "Accounts" }).click();
  await page.getByRole("button", { name: "Your data and privacy" }).click();
  await expect(page.getByRole("dialog", { name: "Your data" }).getByRole("button", { name: "Explain quantum computing", exact: true })).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Erase everything" }).click();
  await expect(page.getByRole("dialog", { name: "Your data" }).getByLabel(/Remember what I explore/)).not.toBeChecked();
});

test("keyboard and reduced motion: fully usable without animation or a mouse", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.keyboard.press("/");
  await expect(page.getByLabel("Ask AetherDeck")).toBeFocused();
  await page.keyboard.type("Explain quantum computing");
  await page.keyboard.press("Enter");
  const node = page.getByRole("button", { name: /^How does it work\?, \d+ items?/ });
  await expect(node).toBeVisible();
  await node.focus();
  await page.keyboard.press("Enter");
  await expect(node).toHaveClass(/is-selected/);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(page.locator(".hero")).toBeVisible();
});

test("floating windows: a site that refuses framing says so and hands off honestly", async ({ page }) => {
  await page.route("**/api/frameable?**", (route) => route.fulfill({ json: { frameable: false, reason: "X-Frame-Options: deny", url: "https://example.com/" } }));
  await page.goto("/");
  await ask(page, "example.com");
  const win = page.getByRole("dialog", { name: "example.com" });
  await expect(win.getByText("example.com asks not to be shown inside other apps.")).toBeVisible();
  await expect(win.getByRole("link", { name: "Open in a new tab" })).toHaveAttribute("href", "https://example.com");
  await win.getByRole("button", { name: "Maximize" }).click();
  await expect(win.getByRole("button", { name: "Restore size" })).toBeVisible();
  await page.keyboard.press("Escape"); // Escape minimizes the front window to the control bar, never closes it
  await expect(win).toHaveCount(0);
  await page.getByRole("button", { name: "Restore example.com" }).click();
  await expect(page.getByRole("dialog", { name: "example.com" })).toBeVisible();
  await page.getByRole("button", { name: "Close window" }).click();
  await expect(page.getByRole("dialog", { name: "example.com" })).toHaveCount(0);
});

test("groups: a page added beside a window joins its group, and the group minimizes and restores together", async ({ page, isMobile }) => {
  test.skip(isMobile, "phones show one window at a time");
  await page.route("**/api/frameable?**", (route) => route.fulfill({ json: { frameable: false, reason: "X-Frame-Options: deny", url: route.request().url() } }));
  await page.goto("/");
  await ask(page, "example.com");
  await page.getByRole("dialog", { name: "example.com" }).getByRole("button", { name: "Add a page beside, as a group" }).click();
  const input = page.getByLabel("Ask AetherDeck");
  await expect(input).toBeFocused();
  await input.fill("example.org");
  await input.press("Enter");
  const group = page.getByRole("group", { name: "Group: example.com + example.org" });
  await expect(group).toBeVisible();
  await expect(page.getByRole("dialog", { name: "example.org" })).toBeVisible();

  await group.getByRole("button", { name: "Minimize group" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Restore example.com + example.org, 2 pages" }).click();
  await expect(page.getByRole("dialog", { name: "example.com" })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "example.org" })).toBeVisible();

  await page.getByRole("group", { name: "Group: example.com + example.org" }).getByRole("button", { name: "Ungroup" }).click();
  await expect(page.getByRole("group", { name: /^Group:/ })).toHaveCount(0);
});

test("overview: every window gets its own tile, and picking one brings it to the front", async ({ page, isMobile }) => {
  test.skip(isMobile, "phones show one window at a time");
  await page.route("**/api/frameable?**", (route) => route.fulfill({ json: { frameable: false, reason: "X-Frame-Options: deny", url: route.request().url() } }));
  await page.goto("/");
  for (const site of ["example.com", "example.org", "example.net"]) await ask(page, site);
  await more(page, "See all windows");
  await expect(page.locator(".windows")).toHaveClass(/is-overview/);
  const box = async (name: string) => (await page.getByRole("dialog", { name }).boundingBox())!;
  await expect.poll(async () => (await box("example.org")).x - (await box("example.com")).x).toBeGreaterThan(150); // no longer piled
  await page.getByRole("dialog", { name: "example.com" }).click();
  await expect(page.getByRole("dialog", { name: "example.com" })).toHaveClass(/is-front/);
  await expect(page.locator(".windows")).not.toHaveClass(/is-overview/);
});

// Sync and sharing run against the real API server (encrypted spaces in .e2e-data); frames are stubbed.
const BASE = "http://localhost:5191";
const stubFrames = (ctx: import("@playwright/test").BrowserContext) =>
  ctx.route("**/api/frameable?**", (route) => route.fulfill({ json: { frameable: false, reason: "X-Frame-Options: deny", url: route.request().url() } }));
/** The links point at this computer's Wi-Fi address; in the test both "devices" reach the same server on localhost. */
const local = (link: string) => `${BASE}/${new URL(link).hash}`;

async function openGroup(page: Page) {
  await ask(page, "example.com");
  await page.getByRole("dialog", { name: "example.com" }).getByRole("button", { name: "Add a page beside, as a group" }).click();
  await page.getByLabel("Ask AetherDeck").fill("example.org");
  await page.getByLabel("Ask AetherDeck").press("Enter");
  await expect(page.getByRole("group", { name: /^Group: example.com \+ example.org/ })).toBeVisible();
}

test("sync: a group opened on the laptop appears on the phone, and a close on the phone reaches the laptop", async ({ browser, isMobile }) => {
  test.skip(isMobile, "one run covers both devices");
  const laptopCtx = await browser.newContext({ baseURL: BASE, viewport: { width: 1280, height: 800 } });
  const phoneCtx = await browser.newContext({ ...devices["Pixel 7"], baseURL: BASE });
  await Promise.all([stubFrames(laptopCtx), stubFrames(phoneCtx)]);
  const laptop = await laptopCtx.newPage();
  await laptop.goto("/");
  await openGroup(laptop);

  await more(laptop, "Devices and sharing");
  const sheet = laptop.getByRole("dialog", { name: "Devices and sharing" });
  await sheet.getByRole("button", { name: "Sync across devices" }).click();
  await expect(sheet.getByText(/^Live/)).toBeVisible();
  await expect(sheet.getByRole("img", { name: /QR code/ })).toBeVisible();
  const link = await sheet.getByRole("textbox", { name: "Link for your other devices" }).inputValue();
  expect(link).toMatch(/#sync=[\w-]{22}\.[\w-]{43}$/);

  const phone = await phoneCtx.newPage();
  await phone.goto(local(link));
  await expect(phone).toHaveURL(`${BASE}/`); // the key leaves the address bar at once
  await phone.getByRole("dialog", { name: "Sync this device?" }).getByRole("button", { name: "Sync this device" }).click();
  await expect(phone.getByRole("dialog", { name: "example.com" })).toBeVisible();
  await expect(phone.getByRole("dialog", { name: "example.org" })).toBeVisible();
  await expect(sheet.getByText("Live · 1 other device here now")).toBeVisible();

  await phone.getByRole("dialog", { name: "example.org" }).getByRole("button", { name: "Close window" }).click();
  await expect(laptop.getByRole("dialog", { name: "example.org" })).toHaveCount(0);
  await expect(laptop.getByRole("dialog", { name: "example.com" })).toHaveCount(1);
  await Promise.all([laptopCtx.close(), phoneCtx.close()]);
});

test("sharing: a shared group reaches another person, their additions come back, and other windows stay private", async ({ browser, isMobile }) => {
  test.skip(isMobile, "one run covers both people");
  const meCtx = await browser.newContext({ baseURL: BASE, viewport: { width: 1280, height: 800 } });
  const friendCtx = await browser.newContext({ baseURL: BASE, viewport: { width: 1280, height: 800 } });
  await Promise.all([stubFrames(meCtx), stubFrames(friendCtx)]);
  const me = await meCtx.newPage();
  await me.goto("/");
  await ask(me, "example.edu"); // a private window, not in the group
  await openGroup(me);

  await me.getByRole("group", { name: /^Group: example.com \+ example.org/ }).getByRole("button", { name: "Share group" }).click();
  const sheet = me.getByRole("dialog", { name: "Devices and sharing" });
  const box = sheet.getByRole("textbox", { name: "Link to example.com + example.org" });
  await expect(box).toBeVisible();
  const link = await box.inputValue();
  expect(link).toContain("#group=");
  await sheet.getByRole("button", { name: "Close", exact: true }).click();

  const friend = await friendCtx.newPage();
  await friend.goto(local(link));
  await friend.getByRole("dialog", { name: "Open the shared group?" }).getByRole("button", { name: "Open the group" }).click();
  const theirGroup = friend.getByRole("group", { name: "Group: example.com + example.org, shared" });
  await expect(theirGroup).toBeVisible();
  await expect(friend.getByRole("dialog", { name: "example.edu" })).toHaveCount(0);
  await expect(me.getByRole("group", { name: /shared$/ }).getByRole("button", { name: /Shared · 1 here/ })).toBeVisible();

  await theirGroup.getByRole("button", { name: "Add a page to this group" }).click();
  await friend.getByLabel("Ask AetherDeck").fill("example.net");
  await friend.getByLabel("Ask AetherDeck").press("Enter");
  await expect(me.getByRole("dialog", { name: "example.net" })).toBeVisible();
  await expect(me.getByRole("group", { name: /^Group: example.com \+ 2 more, shared$/ })).toBeVisible();

  await more(me, "Devices and sharing");
  await me.getByRole("dialog", { name: "Devices and sharing" }).getByRole("button", { name: "Stop sharing" }).click();
  await expect(friend.getByText("A shared group was stopped by the person who shared it. Your copy stays here.")).toBeVisible();
  await expect(friend.getByRole("dialog", { name: "example.net" })).toBeVisible();
  await Promise.all([meCtx.close(), friendCtx.close()]);
});

test("research board: a search becomes a card that can be connected and grouped", async ({ page, isMobile }) => {
  test.skip(isMobile, "the board is a desktop tool");
  await page.goto("/");
  await ask(page, "Explain quantum computing and show me the original sources.");
  await expect(page.getByRole("heading", { name: "Explain quantum computing and show me the original sources." })).toBeVisible();
  await page.getByRole("button", { name: "Research", exact: true }).click();
  await expect(page.locator(".rcard")).toHaveCount(1, { timeout: 10_000 });
  await page.getByRole("button", { name: "Close the research board" }).click();
  await ask(page, "Explain quantum computing");
  await expect(page.getByRole("heading", { name: "Explain quantum computing", exact: true })).toBeVisible();
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: "Research", exact: true }).click();
  await expect(page.locator(".rcard")).toHaveCount(2, { timeout: 20_000 });
  const cards = page.locator(".rcard h3");
  await page.locator(".rcard").first().getByRole("button", { name: /^Connect/ }).click();
  await cards.nth(1).click();
  await expect(page.locator(".board__links line")).toHaveCount(1);
  await cards.first().click();
  await cards.nth(1).click({ modifiers: ["Shift"] });
  await page.getByLabel("Group name").fill("Computing");
  await page.getByRole("button", { name: "Group", exact: true }).click();
  await expect(page.locator(".board__group")).toHaveText("Computing");
});

test("every card on the map can open as its own tab", async ({ page, isMobile }) => {
  test.skip(isMobile, "phones show one window at a time");
  await page.goto("/");
  await ask(page, "Explain quantum computing");
  const all = page.getByRole("button", { name: /^Open all \d+ sites as tabs$/ });
  await expect(all).toBeVisible({ timeout: 15_000 });
  const count = Number((await all.textContent())!.match(/\d+/)![0]);
  await all.click();
  await expect(page.locator(".win")).toHaveCount(count, { timeout: 10_000 });
});

