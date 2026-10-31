// Drawing curved pages, in the interface window's preload: each frame of an offscreen page arrives as a GPU
// texture (no copy through the CPU), is wrapped on a cylinder with WebGL and drawn into the window's
// <canvas data-curve="id">. The interface itself never touches the frames.
import { ipcRenderer, sharedTexture } from "electron";
import { drawBitmap, drawFrame, makeSurface, type Surface } from "../shared/curveSurface.ts";
import { sceneBitmap, sceneFrame, startSurround } from "./surround-gl.ts";

const surfaces = new Map<string, Surface>();

function surfaceFor(id: string): Surface | null {
  const known = surfaces.get(id);
  if (known?.canvas.isConnected) return known;
  const canvas = document.querySelector<HTMLCanvasElement>(`canvas[data-curve="${CSS.escape(id)}"]`);
  const s = canvas && makeSurface(canvas);
  if (s) surfaces.set(id, s);
  return s || null;
}

export function startCurveDrawing() {
  startSurround();
  ipcRenderer.on("curve:bitmap", (_e, id: string, width: number, height: number, pixels: Uint8Array) => {
    if (sceneBitmap(id, width, height, pixels)) return;
    const s = surfaceFor(id);
    if (s) drawBitmap(s, width, height, pixels);
  });
  ipcRenderer.on("curve:frame", (_e, id: string, seq: number, transfer: unknown) => {
    try {
      const imported = sharedTexture.subtle.finishTransferSharedTexture(transfer as Parameters<typeof sharedTexture.subtle.finishTransferSharedTexture>[0]);
      const frame = imported.getVideoFrame();
      const done = () => {
        frame.close();
        let token: unknown = null;
        try { token = imported.getFrameCreationSyncToken(); imported.release(); } catch { /* already gone */ }
        ipcRenderer.send("curve:done", seq, token);
      };
      if (sceneFrame(id, frame, done)) return; // the room holds it for its next drawing
      const s = surfaceFor(id);
      if (s) drawFrame(s, frame);
      done();
    } catch { ipcRenderer.send("curve:done", seq, null); } // a frame lost is redrawn by the next one
  });
}
