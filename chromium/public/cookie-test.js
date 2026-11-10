const $ = (id) => document.getElementById(id);
const PROBE = "https://httpbin.org";
const RULE_ID = 4242;
let originOf = "";

function siteOrigin() {
  try { const u = new URL($("site").value.trim()); if (!/^https?:$/.test(u.protocol)) throw 0; return u.origin; } catch { return ""; }
}
const chosen = (name) => document.querySelector(`input[name=${name}]:checked`)?.value ?? "not answered";

function report() {
  const m = chrome.runtime.getManifest();
  const text = [
    "AetherDeck Sidekick cookie test, extension " + m.version,
    "Browser: " + navigator.userAgent,
    "When: " + new Date().toISOString(),
    "",
    "Test 1 (httpbin probe, framed): " + chosen("t1"),
    "Test 2 (" + (originOf || siteOrigin() || "no site entered") + ", framed as is): " + chosen("t2"),
    "Test 3 (same site, framing headers removed): " + chosen("t3"),
  ].join("\n");
  $("report").textContent = text;
  return text;
}

$("set").addEventListener("click", () => chrome.tabs.create({ url: PROBE + "/cookies/set?aetherdeck_probe=lax" }));
$("clean").addEventListener("click", () => chrome.tabs.create({ url: PROBE + "/cookies/delete?aetherdeck_probe" }));
$("show").addEventListener("click", () => { $("probe").src = PROBE + "/cookies?" + Date.now(); });
$("frame2").addEventListener("click", () => { originOf = siteOrigin(); if (!originOf) { $("rule").textContent = "Type a web address first."; return; } $("f2").src = $("site").value.trim(); report(); });

$("strip").addEventListener("click", async () => {
  const origin = siteOrigin();
  const out = $("rule");
  if (!origin) { out.className = "bad"; out.textContent = "Type a web address first."; return; }
  originOf = origin;
  const ok = await chrome.permissions.request({ origins: [origin + "/*"] });
  if (!ok) { out.className = "bad"; out.textContent = "Permission declined."; return; }
  const tab = await chrome.tabs.getCurrent();
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [RULE_ID],
    addRules: [{
      id: RULE_ID, priority: 1,
      condition: { requestDomains: [new URL(origin).hostname], resourceTypes: ["sub_frame"], tabIds: [tab.id] },
      action: { type: "modifyHeaders", responseHeaders: [{ header: "x-frame-options", operation: "remove" }, { header: "content-security-policy", operation: "remove" }] },
    }],
  });
  out.className = "ok"; out.textContent = "Rule on for this tab.";
  $("f3").src = $("site").value.trim();
  report();
});

async function unstrip() {
  await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [RULE_ID] });
  $("rule").className = ""; $("rule").textContent = "Rule removed.";
}
$("unstrip").addEventListener("click", unstrip);
addEventListener("pagehide", () => { chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [RULE_ID] }); });

document.addEventListener("change", report);
$("site").addEventListener("input", () => { originOf = ""; });
$("copy").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(report()); $("done").className = "ok"; $("done").textContent = "Copied."; }
  catch { $("done").className = "bad"; $("done").textContent = "Select the text above and copy it by hand."; }
});
report();
