// A live phone on the curved screen. Android answers to touch and keys; an iPhone is view only, because iOS gives
// other apps no way to control it. The video is decoded here with WebCodecs and drawn with the curve's own WebGL.
import { useCallback, useEffect, useRef, useState } from "react";
import { curveFor, toPage } from "../../shared/curve.ts";
import { drawFrame, makeSurface, type Surface } from "../../shared/curveSurface.ts";
import { clipboardMessage, displayMessage, h264Codec, KEY, keyMessage, resetVideoMessage, rotateMessage, scrollMessage, textMessage, touchMessage } from "../../shared/phone.ts";
import { desktop } from "../lib/desktop.ts";
import type { Win } from "../lib/windows.ts";

interface Device { serial: string; status: string; name: string }
type Mode = "choose" | "android" | "iphone";
const KEYS: Record<string, number> = { Enter: KEY.enter, Backspace: KEY.del, Delete: KEY.forwardDel, Tab: KEY.tab, Escape: KEY.escape, ArrowUp: KEY.up, ArrowDown: KEY.down, ArrowLeft: KEY.left, ArrowRight: KEY.right };

const Glyph = ({ d }: { d: string }) => <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>;

export function PhoneScreen({ win, bend, onShape }: { win: Win; bend: number; onShape: (aspect: number, name?: string) => void }) {
  const id = win.id;
  const [mode, setMode] = useState<Mode>("choose");
  const [tools, setTools] = useState<{ android: boolean; airplay: boolean; brew: boolean } | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [devices, setDevices] = useState<Device[]>([]);
  const [serial, setSerial] = useState<string | null>(null);
  const [link, setLink] = useState("");
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [fit, setFit] = useState<{ w: number; h: number } | null>(null);
  const [screenOff, setScreenOff] = useState(false);
  const [wifi, setWifi] = useState("");
  const canvas = useRef<HTMLCanvasElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const surface = useRef<Surface | null>(null);
  const sizeNow = useRef(size);
  sizeNow.current = size;
  const bendNow = useRef(bend);
  bendNow.current = bend;
  const shape = useRef(onShape);
  shape.current = onShape;
  const send = useCallback((m: Uint8Array) => void desktop?.invoke("phone:send", id, m), [id]);
  const control = mode === "android";

  useEffect(() => { void desktop?.invoke<typeof tools>("phone:status").then(setTools); }, [busy]);
  useEffect(() => desktop?.on("phone:progress", (p) => setBusy(String(p ?? ""))), []);

  // Android: watch for phones until one is picked.
  useEffect(() => {
    if (mode !== "android" || !tools?.android || serial) return;
    const look = () => void desktop?.invoke<Device[]>("phone:devices").then((d) => { setDevices(d); const ready = d.filter((x) => x.status === "device"); if (ready.length === 1) setSerial(ready[0].serial); }).catch(() => undefined);
    look();
    const t = setInterval(look, 2000);
    return () => clearInterval(t);
  }, [mode, tools, serial]);

  // The stream: frames from the main process, decoded and drawn on the curve.
  useEffect(() => {
    if (!desktop || (mode === "android" ? !serial : mode !== "iphone")) return;
    let decoder: VideoDecoder | null = null;
    let codec = "";
    let needKey = true;
    const fresh = () => { needKey = true; if (mode === "android") send(resetVideoMessage()); };
    const offFrame = desktop.on("phone:frame", (p) => {
      const f = p as { id: string; key: boolean; pts: number; data: Uint8Array };
      if (f.id !== id) return;
      if (f.key) {
        const c = h264Codec(f.data);
        if (c && (c !== codec || !decoder || decoder.state !== "configured")) {
          decoder?.close();
          codec = c;
          decoder = new VideoDecoder({
            output: (frame) => {
              // An iPhone's size only shows in its pictures.
              if (mode === "iphone" && frame.displayWidth !== sizeNow.current?.w) { const n = { w: frame.displayWidth, h: frame.displayHeight }; setSize(n); shape.current(n.w / n.h); }
              const el = canvas.current;
              if (el) {
                surface.current ??= makeSurface(el);
                if (surface.current) drawFrame(surface.current, frame);
              }
              frame.close();
            },
            error: () => { decoder = null; fresh(); },
          });
          decoder.configure({ codec: c, optimizeForLatency: true });
        }
        needKey = false;
      }
      if (needKey || !decoder || decoder.state !== "configured") return;
      // Behind: skip to the next full picture rather than show the past.
      if (decoder.decodeQueueSize > 6) return fresh();
      try { decoder.decode(new EncodedVideoChunk({ type: f.key ? "key" : "delta", timestamp: f.pts, data: f.data })); } catch { fresh(); }
    });
    const offState = desktop.on("phone:state", (p) => {
      const s = p as { id: string; state: string; name?: string; width?: number; height?: number; error?: string };
      if (s.id !== id) return;
      setLink(s.state);
      setError(s.state === "error" ? s.error ?? "" : "");
      if (s.width && s.height) { const n = { w: s.width, h: s.height }; setSize(n); shape.current(n.w / n.h); }
      if (s.name) shape.current(sizeNow.current ? sizeNow.current.w / sizeNow.current.h : 0.48, s.name);
    });
    if (mode === "android") void desktop.invoke("phone:start", id, serial);
    else void desktop.invoke("phone:startAirplay", id);
    return () => { offFrame(); offState(); decoder?.close(); void desktop!.invoke("phone:stop", id); };
  }, [mode, serial, id, send]);

  useEffect(() => { void desktop?.invoke("phone:pause", id, !!win.minimized); }, [id, win.minimized]);

  // The screen keeps the phone's shape inside whatever size the window is.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const place = () => {
      const a = (sizeNow.current?.w ?? 9) / (sizeNow.current?.h ?? 19.5);
      const r = el.getBoundingClientRect();
      const w = Math.min(el.clientWidth, el.clientHeight * a);
      setFit(r.width ? { w, h: w / a } : null);
    };
    place();
    const o = new ResizeObserver(place);
    o.observe(el);
    return () => o.disconnect();
  }, [size, link]);

  function at(e: { clientX: number; clientY: number }) {
    const el = canvas.current!;
    const s = sizeNow.current;
    if (!s) return null;
    const r = el.getBoundingClientRect();
    const p = toPage(((e.clientX - r.left) / r.width) * 2 - 1, 1 - ((e.clientY - r.top) / r.height) * 2, curveFor(bendNow.current));
    return p ? { x: p.u * s.w, y: p.v * s.h, ...s } : null;
  }
  const pending = useRef<Uint8Array | null>(null);
  const touch = (action: "down" | "up" | "move", e: React.PointerEvent) => {
    const p = at(e);
    if (!p) return;
    const m = touchMessage(action, p.x, p.y, p.w, p.h);
    if (action !== "move") return send(m);
    if (!pending.current) requestAnimationFrame(() => { if (pending.current) send(pending.current); pending.current = null; });
    pending.current = m;
  };
  useEffect(() => {
    const el = canvas.current;
    if (!el || !control) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = at(e);
      if (p) send(scrollMessage(p.x, p.y, p.w, p.h, -e.deltaX / 40, -e.deltaY / 40));
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [control, link]);
  const press = (keycode: number) => { send(keyMessage("down", keycode)); send(keyMessage("up", keycode)); };
  const key = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.metaKey && e.key.toLowerCase() === "v") { e.preventDefault(); void desktop?.invoke<string>("phone:clipboard").then((t) => { if (t) send(clipboardMessage(t)); }); return; }
    if (e.metaKey) return;
    e.preventDefault();
    if (KEYS[e.key]) return press(KEYS[e.key]);
    if (e.key.length === 1 && !e.ctrlKey) send(textMessage(e.key));
  };
  const toWifi = async () => {
    setError("");
    try { setWifi(await desktop!.invoke<string>("phone:wifi", serial)); } catch (err) { setError((err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "")); }
  };
  const setUp = async (channel: string) => {
    setError("");
    try { await desktop!.invoke(channel); } catch (err) { setError((err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "")); }
    setBusy("");
  };

  const live = link === "live";
  const notice = !desktop ? "Phones work in the Horus desktop app." : null;
  if (notice) return <p className="win__state">{notice}</p>;

  if (mode === "choose") return (
    <div className="phone__intro">
      <h3>Which phone?</h3>
      <button className="phone__pick" onClick={() => setMode("android")}><b>Android</b><small>See it and control it here, over USB or Wi-Fi</small></button>
      <button className="phone__pick" onClick={() => setMode("iphone")}><b>iPhone</b><small>See it here over AirPlay. Apple doesn't allow other apps to control an iPhone</small></button>
    </div>
  );

  const waiting = mode === "android" ? (
    !tools?.android ? (
      <>
        <h3>Set up Android</h3>
        <p className="fine">Horus needs two small free tools once: scrcpy's server (0.7 MB, from scrcpy's GitHub release, checksum verified) and adb (about 16 MB, from Google). Nothing stays installed on your phone.</p>
        <button className="btn btn--primary" disabled={!!busy} onClick={() => void setUp("phone:setUpAndroid")}>{busy || "Download and set up"}</button>
      </>
    ) : !serial ? (
      <>
        <h3>Connect your phone</h3>
        <ol className="phone__steps">
          <li>On the phone, open Settings, About phone, and tap Build number seven times.</li>
          <li>In Developer options, turn on USB debugging.</li>
          <li>Plug it into this computer with a USB cable, and tap Allow on the phone.</li>
        </ol>
        {devices.some((d) => d.status === "unauthorized") && <p className="fine">Your phone is asking for permission. Tap Allow on its screen.</p>}
        {devices.filter((d) => d.status === "device").map((d) => <button key={d.serial} className="btn" onClick={() => setSerial(d.serial)}>{d.name}</button>)}
      </>
    ) : <h3>{link === "retrying" ? "Waiting for your phone to come back…" : "Connecting…"}</h3>
  ) : (
    !tools?.airplay ? (
      <>
        <h3>Set up iPhone mirroring</h3>
        <p className="fine">This installs the free tools UxPlay needs through Homebrew (cmake, pkg-config, libplist, openssl and GStreamer, with GStreamer's many dependencies), which may also update some Homebrew packages you already have. It then builds UxPlay on this computer. Expect a sizable download and several minutes.</p>
        {tools && !tools.brew && <p className="agents__error" role="alert">Homebrew isn't installed. Get it from brew.sh first.</p>}
        <button className="btn btn--primary" disabled={!!busy || !tools?.brew} onClick={() => void setUp("phone:setUpAirplay")}>{busy || "Install and build"}</button>
      </>
    ) : (
      <>
        <h3>Mirror your iPhone</h3>
        <ol className="phone__steps">
          <li>Put the iPhone on the same Wi-Fi as this computer.</li>
          <li>Open Control Center and tap Screen Mirroring.</li>
          <li>Choose Horus.</li>
        </ol>
      </>
    )
  );

  return (
    <div className="phone">
      {control && live && (
        <div className="phone__keys" role="toolbar" aria-label="Phone buttons">
          <button className="orn" aria-label="Back" title="Back" onClick={() => press(KEY.back)}><Glyph d="M15 5l-7 7 7 7" /></button>
          <button className="orn" aria-label="Home" title="Home" onClick={() => press(KEY.home)}><Glyph d="M4 11l8-7 8 7v8a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1Z" /></button>
          <button className="orn" aria-label="Recent apps" title="Recent apps" onClick={() => press(KEY.recents)}><Glyph d="M6 5h12v14H6Z" /></button>
          <button className="orn" aria-label="Volume up" title="Volume up" onClick={() => press(KEY.volumeUp)}><Glyph d="M12 5v14M5 12h14" /></button>
          <button className="orn" aria-label="Volume down" title="Volume down" onClick={() => press(KEY.volumeDown)}><Glyph d="M5 12h14" /></button>
          <button className="orn" aria-label="Rotate" title="Rotate" onClick={() => send(rotateMessage())}><Glyph d="M19 12a7 7 0 1 1-2.05-4.95M19 5v4h-4" /></button>
          <button className={`orn ${screenOff ? "is-on" : ""}`} aria-pressed={screenOff} aria-label="Turn the phone's own screen off" title="Turn the phone's own screen off and keep mirroring" onClick={() => { send(displayMessage(screenOff)); setScreenOff(!screenOff); }}><Glyph d="M12 3v9M7 6a8 8 0 1 0 10 0" /></button>
          <button className="orn" aria-label="Keep connected over Wi-Fi" title={wifi ? `On Wi-Fi: ${wifi}` : "Keep connected over Wi-Fi, without the cable"} onClick={() => void toWifi()}><Glyph d="M3 9a14 14 0 0 1 18 0M6.5 13a9 9 0 0 1 11 0M10 17a4 4 0 0 1 4 0" /></button>
        </div>
      )}
      <div className="phone__stage" ref={box}>
        <canvas ref={canvas} className="phone__screen" data-bend={bend} data-keys tabIndex={control ? 0 : -1} aria-label={control ? "Your phone's screen. Click to tap, scroll, and type." : "Your iPhone's screen, view only"}
          style={{ width: fit?.w, height: fit?.h, visibility: live ? "visible" : "hidden", cursor: control ? "pointer" : "default" }}
          onPointerDown={control ? (e) => { e.currentTarget.focus(); e.currentTarget.setPointerCapture(e.pointerId); touch("down", e); } : undefined}
          onPointerMove={control ? (e) => { if (e.buttons) touch("move", e); } : undefined}
          onPointerUp={control ? (e) => touch("up", e) : undefined}
          onKeyDown={control ? key : undefined} />
        {!live && <div className="phone__intro">{waiting}{error && <p className="agents__error" role="alert">{error}</p>}</div>}
      </div>
      {live && error && <p className="agents__error phone__error" role="alert">{error}</p>}
    </div>
  );
}
