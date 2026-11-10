// AetherDeck Sidekick: the background worker. It opens the side panel from the toolbar button and adds the two
// right-click commands. It holds no page text and no keys; the side panel reads the page when asked.
const DEFAULT_SERVER = "http://127.0.0.1:8787";

async function server() {
  const { server } = await chrome.storage.local.get("server");
  return typeof server === "string" && /^https?:\/\//.test(server) ? server.replace(/\/+$/, "") : DEFAULT_SERVER;
}

// The Room flavour (chromium/dist-room) also replaces the new-tab page; there the toolbar button opens the Room and the
// side panel is opened from the right-click menu instead. The normal flavour keeps the button for the side panel.
const ROOM_FLAVOUR = !!chrome.runtime.getManifest().chrome_url_overrides?.newtab;
const ROOM_URL = chrome.runtime.getURL("room.html");

/** Focus the Room tab if one is open, otherwise open one. `text` is an address (or words) to open in it. */
async function openRoom(text) {
  const [existing] = await chrome.tabs.query({ url: ROOM_URL + "*" });
  if (existing) {
    await chrome.tabs.update(existing.id, { active: true });
    await chrome.windows.update(existing.windowId, { focused: true });
    if (text) chrome.runtime.sendMessage({ room: "open", to: existing.id, text }).catch(() => {});
    return existing.id;
  }
  const tab = await chrome.tabs.create({ url: ROOM_URL + (text ? "?open=" + encodeURIComponent(text) : "") });
  return tab.id;
}
async function roomTabs() { return chrome.tabs.query({ url: ROOM_URL + "*" }); }
async function toRoom(room) { const [t] = (await roomTabs()).sort((a, b) => Number(b.active) - Number(a.active)); if (t) chrome.runtime.sendMessage({ room, to: t.id }).catch(() => {}); }

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: !ROOM_FLAVOUR }).catch(() => {});
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: "explore", title: "Explore “%s” in AetherDeck", contexts: ["selection"] });
    chrome.contextMenus.create({ id: "ask", title: "Ask Cosmonaut about this page", contexts: ["page", "selection"] });
    chrome.contextMenus.create({ id: "home", title: "Open the AetherDeck research map", contexts: ["action"] });
    chrome.contextMenus.create({ id: "panes", title: "Open AetherDeck Panes", contexts: ["action"] });
    chrome.contextMenus.create({ id: "room", title: "Open the AetherDeck Room", contexts: ["action"] });
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  // sidePanel.open() must run inside the click itself, before any await, or the browser refuses it.
  if (info.menuItemId === "ask" && tab?.id !== undefined) {
    chrome.sidePanel.open({ tabId: tab.id }).catch(() => {});
    return;
  }
  if (info.menuItemId === "explore" && info.selectionText) {
    const q = info.selectionText.trim().slice(0, 400);
    server().then((s) => chrome.tabs.create({ url: `${s}/?q=${encodeURIComponent(q)}` }));
    return;
  }
  if (info.menuItemId === "room") { openRoom(); return; }
  if (info.menuItemId === "panes") { chrome.tabs.create({ url: chrome.runtime.getURL("panes.html") }); return; }
  if (info.menuItemId === "home") chrome.tabs.create({ url: chrome.runtime.getURL("home.html") });
});

// Toolbar button (Room flavour only: in the normal flavour the button opens the side panel and never fires this).
chrome.action.onClicked.addListener(() => { if (ROOM_FLAVOUR) openRoom(); });

// Keyboard shortcuts (set at chrome://extensions/shortcuts). They work wherever the focus is, even inside a pane.
chrome.commands.onCommand.addListener((command) => {
  if (command === "open-room") openRoom();
  else if (command === "room-next") toRoom("next");
  else if (command === "room-prev") toRoom("prev");
  else if (command === "room-overview") toRoom("overview");
});

// Omnibox: type the keyword, a space, then a site (opens as a pane) or words (opens the research map).
chrome.omnibox.onInputChanged.addListener((text, suggest) => {
  const t = text.trim();
  if (t) suggest([{ content: t, description: "Open “" + t.replace(/[<>&]/g, "") + "” in the AetherDeck Room" }]);
});
chrome.omnibox.onInputEntered.addListener((text) => { openRoom(text.trim()); });

// A link or window.open inside a pane makes the browser open a new tab. Catch it, hand the address to the Room as a new
// pane, and close the tab only once the Room has said it took it. Needs the webNavigation permission (required in the
// Room flavour, optional in the normal one: the Room page asks for it).
const pending = new Map(); // new tab id → the Room tab it came from
const usable = (u) => /^https?:\/\//i.test(u || "");
async function deliver(tabId, url) {
  const from = pending.get(tabId);
  if (from === undefined) return;
  pending.delete(tabId);
  try {
    const reply = await chrome.runtime.sendMessage({ room: "open-pane", to: from, url });
    if (reply && reply.ok) chrome.tabs.remove(tabId).catch(() => {});
  } catch { /* the Room is gone: leave the tab as the browser opened it */ }
}
function watchNavigation() {
  if (!chrome.webNavigation || watchNavigation.done) return;
  watchNavigation.done = true;
  chrome.webNavigation.onCreatedNavigationTarget.addListener(async (d) => {
    try {
      const src = await chrome.tabs.get(d.sourceTabId);
      if (!(src.url || "").startsWith(ROOM_URL)) return;
    } catch { return; }
    pending.set(d.tabId, d.sourceTabId);
    if (usable(d.url)) deliver(d.tabId, d.url); // window.open() often starts at about:blank; the real address arrives below
  });
  chrome.webNavigation.onBeforeNavigate.addListener((d) => { if (d.frameId === 0 && pending.has(d.tabId) && usable(d.url)) deliver(d.tabId, d.url); });
  chrome.tabs.onRemoved.addListener((id) => pending.delete(id));
}
watchNavigation();
chrome.permissions.onAdded.addListener(watchNavigation);
