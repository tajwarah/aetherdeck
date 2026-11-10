const DEFAULT_SERVER = "http://127.0.0.1:8787";
const $ = (id) => document.getElementById(id);

async function load() {
  const s = await chrome.storage.local.get(["server", "token"]);
  $("server").value = s.server || DEFAULT_SERVER;
  $("token").value = s.token || "";
}

async function save() {
  const status = $("status");
  const raw = $("server").value.trim().replace(/\/+$/, "") || DEFAULT_SERVER;
  let origin;
  try { const u = new URL(raw); if (!/^https?:$/.test(u.protocol)) throw 0; origin = u.origin; } catch { status.className = "bad"; status.textContent = "That is not a web address."; return; }
  // A server somewhere other than the two built-in addresses needs the browser's permission, asked for here.
  if (!/^http:\/\/(127\.0\.0\.1|localhost):8787$/.test(origin)) {
    const ok = await chrome.permissions.request({ origins: [origin + "/*"] });
    if (!ok) { status.className = "bad"; status.textContent = "Permission to reach that address was declined."; return; }
  }
  await chrome.storage.local.set({ server: origin, token: $("token").value.trim() });
  status.className = ""; status.textContent = "Testing…";
  try {
    const r = await fetch(origin + "/api/health", { headers: { "X-AetherDeck-Token": $("token").value.trim() } });
    if (r.status === 403) throw new Error("The server refused the token.");
    if (!r.ok) throw new Error("The server answered " + r.status + ".");
    const h = await r.json();
    status.className = "ok"; status.textContent = h.model ? "Connected. Model: " + h.model.label : "Connected, but no AI model is set up on the server yet.";
  } catch (e) {
    status.className = "bad"; status.textContent = e.message && e.message !== "Failed to fetch" ? e.message : "Could not reach the server. Is it running?";
  }
}

$("save").addEventListener("click", save);
load();
