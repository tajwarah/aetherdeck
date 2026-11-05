// The only bridge between the interface and the desktop app: a fixed list of requests and events.
// Pages (webviews) never get this; they run with no preload at all.
import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from "electron";
import { startCurveDrawing } from "./curve-gl.ts";

const INVOKE = new Set([
  "research:load", "research:save", "curve:rate", "engine:read", "engine:run", "engine:crawl", "engine:stop", "engine:stats", "engine:save", "apps:list", "apps:save", "apps:remove",
  "app:info", "app:setKeys", "app:restart", "app:setDefault", "app:fullscreen", "app:minimize", "app:close", "chatgpt:status", "chatgpt:signIn", "chatgpt:signOut", "sites:write", "sites:list", "sites:reveal", "media:pick", "page:attach", "app:openExternal", "app:ready", "app:installUpdate",
  "permission:answer", "history:visit", "history:search", "history:remove", "history:clear", "data:clearSite",
  "bookmarks:list", "bookmarks:toggle", "downloads:open", "downloads:show", "downloads:cancel", "downloads:folder", "page:print", "page:devtools", "ai:models", "account:google", "account:googleSignOut", "app:microphone", "curve:open", "curve:resize", "curve:input", "curve:nav", "curve:exec", "curve:capture", "app:toggleFullscreen", "phone:status", "phone:setUpAndroid", "phone:setUpAirplay", "phone:devices", "phone:start", "phone:startAirplay", "phone:stop", "phone:send", "phone:pause", "phone:clipboard", "phone:wifi", "shields:status", "shields:toggleSite", "agents:list", "agents:save", "curve:room", "curve:find", "curve:stopFind", "curve:paint", "curve:exitFullscreen", "curve:reload", "curve:close", "ext:list", "ext:fromStore", "ext:fromFolder", "ext:fromBrowser", "ext:add", "ext:cancel", "ext:toggle", "ext:remove", "ext:setActive",
]);
const EVENTS = new Set(["aetherdeck:open", "aetherdeck:command", "aetherdeck:permission", "aetherdeck:download", "aetherdeck:update", "aetherdeck:fullscreen", "aetherdeck:account", "curve:state", "curve:cursor", "curve:found", "curve:fullscreen", "aetherdeck:shields", "phone:state", "phone:frame", "phone:progress", "phone:airplayPort"]);

contextBridge.exposeInMainWorld("aetherdeck", {
  platform: process.platform,
  /** Where a dropped or chosen file lives on disk, so "Open document" can open it in its own app. */
  pathFor: (file: File) => { try { return webUtils.getPathForFile(file); } catch { return ""; } },
  invoke: (channel: string, ...args: unknown[]) => (INVOKE.has(channel) ? ipcRenderer.invoke(channel, ...args) : Promise.reject(new Error(`Not allowed: ${channel}`))),
  on: (channel: string, fn: (payload: unknown) => void) => {
    if (!EVENTS.has(channel)) return () => undefined;
    const h = (_e: IpcRendererEvent, payload: unknown) => fn(payload);
    ipcRenderer.on(channel, h);
    return () => { ipcRenderer.removeListener(channel, h); };
  },
});

// Curved windows: their frames are drawn here, straight from the GPU, and never pass through the interface.
startCurveDrawing();
