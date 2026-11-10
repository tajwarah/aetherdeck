const DEFAULT_SERVER = "http://127.0.0.1:8787";
let server = DEFAULT_SERVER;

async function check() {
  const s = await chrome.storage.local.get(["server", "token"]);
  server = typeof s.server === "string" && /^https?:\/\//.test(s.server) ? s.server.replace(/\/+$/, "") : DEFAULT_SERVER;
  const state = document.getElementById("state");
  try {
    const r = await fetch(server + "/api/health", { headers: s.token ? { "X-AetherDeck-Token": s.token } : {} });
    if (r.status === 403) { state.className = "bad"; state.textContent = "The server refused the extension token. Open Server settings."; return; }
    const h = await r.json();
    state.className = "ok";
    state.textContent = h.model ? "Connected to " + server + " · model: " + h.model.label : "Connected to " + server + " · no AI model set up on the server (the map still works from open sources).";
  } catch {
    state.className = "bad"; state.textContent = "The AetherDeck server is not running at " + server + ". Start it with npm run build && npm start.";
  }
}

document.getElementById("form").addEventListener("submit", (e) => {
  e.preventDefault();
  const q = document.getElementById("q").value.trim().slice(0, 400);
  chrome.tabs.create({ url: server + "/" + (q ? "?q=" + encodeURIComponent(q) : "") });
});
check();
