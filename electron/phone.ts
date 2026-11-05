// A live phone in a AetherDeck window. Android: scrcpy's small server is pushed to the phone over adb, sends its screen
// as H.264 and takes touch and keys back; nothing stays installed on the phone. iPhone: UxPlay receives AirPlay
// and hands the video over as RTP, view only, since iOS has no way for another app to control it.
// adb and scrcpy's server are fetched once, when the person asks; UxPlay is built on this computer the same way.
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createSocket, type Socket as Udp } from "node:dgram";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import { connect, createServer, type Socket } from "node:net";
import { join } from "node:path";
import { clipboard, ipcMain } from "electron";
import { resetVideoMessage, RtpH264, SCRCPY_SHA256, SCRCPY_VERSION, ScrcpyVideo, type Frame } from "../shared/phone.ts";

const SERVER_URL = `https://github.com/Genymobile/scrcpy/releases/download/v${SCRCPY_VERSION}/scrcpy-server-v${SCRCPY_VERSION}`;
const ADB_URL = `https://dl.google.com/android/repository/platform-tools-latest-${process.platform === "win32" ? "windows" : process.platform === "darwin" ? "darwin" : "linux"}.zip`;
const DEVICE_JAR = "/data/local/tmp/scrcpy-server.jar";
const UXPLAY_TAG = "v1.73.7";
const UXPLAY_PACKAGES = ["cmake", "pkg-config", "libplist", "openssl@3", "gstreamer"];
const AIRPLAY_PORT = 47000; // macOS's own AirPlay Receiver keeps 7000 for itself
const PATHS = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"];
const env = () => ({ ...process.env, PATH: [...PATHS, process.env.PATH].join(":") });

interface Session { stop: boolean; video?: Socket; control?: Socket; shell?: ChildProcess; serial: string; port?: number; paused: boolean; wait?: NodeJS.Timeout; uxplay?: ChildProcess; udp?: Udp; lastPacket?: number }

export function phones(deps: { dir: string; send: (channel: string, payload: unknown) => void }) {
  const dir = deps.dir;
  mkdirSync(dir, { recursive: true });
  const jar = join(dir, `scrcpy-server-v${SCRCPY_VERSION}`);
  const uxplay = join(dir, "UxPlay", "uxplay");
  const addresses = join(dir, "wifi.json");
  const all = new Map<string, Session>();

  const findTool = (name: string) => PATHS.map((p) => join(p, name)).find(existsSync);
  const adbPath = () => process.env.AETHERDECK_ADB || [join(dir, "platform-tools", "adb"), findTool("adb")].find((p) => p && existsSync(p));
  const run = (file: string, args: string[], timeout = 15_000) => new Promise<string>((resolve, reject) => execFile(file, args, { timeout, env: env(), maxBuffer: 8 * 1024 * 1024 }, (err, out, stderr) => (err ? reject(new Error(stderr.trim() || err.message)) : resolve(out))));
  const adb = (...args: string[]) => { const p = adbPath(); if (!p) throw new Error("adb isn't set up yet"); return run(p, args); };

  const wifi = (): Record<string, string> => { try { return JSON.parse(readFileSync(addresses, "utf8")); } catch { return {}; } };
  const state = (id: string, s: Record<string, unknown>) => deps.send("phone:state", { id, ...s });
  const frame = (id: string, f: Frame) => { if (!all.get(id)?.paused) deps.send("phone:frame", { id, ...f }); };

  async function download(url: string) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`The download failed (${res.status})`);
    return new Uint8Array(await res.arrayBuffer());
  }

  /** adb and scrcpy's server, once. The server is checked against the release's published checksum. */
  async function setUpAndroid() {
    if (!existsSync(jar)) {
      deps.send("phone:progress", "Getting scrcpy's server…");
      const bytes = await download(process.env.AETHERDECK_SCRCPY_URL ?? SERVER_URL);
      if (createHash("sha256").update(bytes).digest("hex") !== SCRCPY_SHA256) throw new Error("scrcpy's server didn't match its published checksum, so it wasn't used.");
      await writeFile(jar, bytes);
    }
    if (!adbPath()) {
      deps.send("phone:progress", "Getting Android's adb tool from Google…");
      const zip = join(dir, "platform-tools.zip");
      await writeFile(zip, await download(ADB_URL));
      await run("/usr/bin/unzip", ["-qo", zip, "-d", dir], 60_000);
      await rm(zip, { force: true });
    }
    deps.send("phone:progress", "");
  }

  async function devices() {
    if (!adbPath()) return [];
    const known = Object.values(wifi());
    await Promise.all(known.map((a) => adb("connect", a).catch(() => "")));
    const out = await adb("devices", "-l");
    return out.split("\n").slice(1).map((l) => l.trim()).filter(Boolean).map((l) => {
      const [serial, status] = l.split(/\s+/);
      return { serial, status, name: l.match(/model:(\S+)/)?.[1]?.replace(/_/g, " ") ?? serial };
    });
  }

  const freePort = () => new Promise<number>((resolve, reject) => {
    const s = createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => { const a = s.address() as { port: number }; s.close(() => resolve(a.port)); });
  });

  /** Connects through adb's tunnel. It accepts before the phone is ready, so a byte proves someone's there. */
  function reach(port: number, wantByte: boolean) {
    return new Promise<{ socket: Socket; first: Buffer }>((resolve, reject) => {
      const socket = connect(port, "127.0.0.1");
      socket.setNoDelay(true);
      const fail = (e: Error) => { socket.destroy(); reject(e); };
      socket.once("error", fail);
      socket.once("close", () => fail(new Error("closed")));
      if (!wantByte) return socket.once("connect", () => { socket.removeAllListeners("error"); socket.removeAllListeners("close"); resolve({ socket, first: Buffer.alloc(0) }); });
      socket.once("data", (first: Buffer) => { socket.removeAllListeners("error"); socket.removeAllListeners("close"); resolve({ socket, first }); });
    });
  }

  function endStream(s: Session) {
    s.video?.destroy();
    s.control?.destroy();
    s.shell?.kill();
    s.video = s.control = s.shell = undefined;
  }

  async function startAndroid(id: string, s: Session) {
    state(id, { state: "connecting" });
    try {
      await adb("-s", s.serial, "push", jar, DEVICE_JAR);
      const scid = (randomBytes(4).readUInt32BE() & 0x7fffffff).toString(16).padStart(8, "0");
      s.port = await freePort();
      await adb("-s", s.serial, "forward", `tcp:${s.port}`, `localabstract:scrcpy_${scid}`);
      s.shell = spawn(adbPath()!, ["-s", s.serial, "shell", `CLASSPATH=${DEVICE_JAR}`, "app_process", "/", "com.genymobile.scrcpy.Server", SCRCPY_VERSION, `scid=${scid}`, "log_level=info", "audio=false", "video_codec=h264", "max_size=1920", "max_fps=60", "video_bit_rate=8000000", "tunnel_forward=true", "stay_awake=true"], { env: env(), stdio: "ignore" });
      let got: { socket: Socket; first: Buffer } | null = null;
      for (let i = 0; i < 80 && !got && !s.stop; i++) {
        got = await reach(s.port, true).catch(() => null);
        if (!got) await new Promise((r) => setTimeout(r, 100));
      }
      if (!got) throw new Error("The phone didn't answer");
      s.video = got.socket;
      const parser = new ScrcpyVideo((e) => {
        if (e.kind === "device") state(id, { state: "live", name: e.name });
        if (e.kind === "size") state(id, { state: "live", width: e.width, height: e.height });
        if (e.kind === "frame") frame(id, e.frame);
      });
      const onData = (d: Buffer) => { try { parser.push(d); } catch (err) { state(id, { state: "error", error: (err as Error).message }); s.video?.destroy(); } };
      s.video.on("data", onData);
      s.video.on("error", () => undefined);
      s.video.once("close", () => { endStream(s); if (!s.stop) again(id, s); });
      s.control = (await reach(s.port, false)).socket;
      s.control.on("error", () => undefined);
      onData(got.first);
    } catch (err) {
      endStream(s);
      if (!s.stop) { state(id, { state: "retrying", error: (err as Error).message }); again(id, s); }
    }
  }

  /** Keeps it running: a dropped cable or Wi-Fi comes back by itself as soon as the phone does. */
  function again(id: string, s: Session) {
    state(id, { state: "retrying" });
    clearTimeout(s.wait);
    s.wait = setTimeout(async () => {
      const here = await devices().catch(() => []);
      if (s.stop) return;
      if (here.some((d) => d.serial === s.serial && d.status === "device")) void startAndroid(id, s); else again(id, s);
    }, 2500);
  }

  /** UxPlay, built on this computer from its source, with the packages it needs from Homebrew. */
  async function setUpAirplay() {
    const brew = findTool("brew");
    if (!brew) throw new Error("iPhone mirroring needs Homebrew (brew.sh) to install its video tools.");
    const step = (say: string, file: string, args: string[], cwd?: string) => new Promise<void>((resolve, reject) => {
      deps.send("phone:progress", say);
      const p = spawn(file, args, { cwd, env: env(), stdio: "ignore" });
      p.once("error", reject);
      p.once("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${say} stopped (code ${code})`))));
    });
    await step("Installing the video tools with Homebrew. This can take a while…", brew, ["install", ...UXPLAY_PACKAGES]);
    const src = join(dir, "UxPlay");
    await rm(src, { recursive: true, force: true });
    await step("Getting UxPlay…", "git", ["clone", "--depth", "1", "--branch", UXPLAY_TAG, "https://github.com/FDH2/UxPlay", src]);
    await step("Building UxPlay…", "cmake", ["."], src);
    await step("Building UxPlay…", "make", ["-j8"], src);
    deps.send("phone:progress", "");
  }

  async function startAirplay(id: string, s: Session) {
    const port = await freePort();
    const udp = createSocket("udp4");
    s.udp = udp;
    const video = new RtpH264((f) => frame(id, f));
    udp.on("message", (m) => {
      if (!s.lastPacket) state(id, { state: "live", name: "iPhone" });
      s.lastPacket = Date.now();
      video.push(m);
    });
    await new Promise<void>((r) => udp.bind(port, "127.0.0.1", r));
    deps.send("phone:airplayPort", { id, port });
    s.wait = setInterval(() => { if (s.lastPacket && Date.now() - s.lastPacket > 5000) { s.lastPacket = 0; state(id, { state: "waiting" }); } }, 1500);
    state(id, { state: "waiting" });
    const bin = process.env.AETHERDECK_UXPLAY || uxplay;
    if (!existsSync(bin)) return;
    s.uxplay = spawn(bin, ["-n", "AetherDeck", "-nh", "-p", String(AIRPLAY_PORT), "-vsync", "no", "-vrtp", `config-interval=1 ! udpsink host=127.0.0.1 port=${port}`], { env: env(), stdio: "ignore" });
    s.uxplay.once("exit", () => { if (!s.stop) state(id, { state: "error", error: "AirPlay stopped. Close this window and open it again." }); });
  }

  function stop(id: string) {
    const s = all.get(id);
    if (!s) return;
    s.stop = true;
    clearTimeout(s.wait);
    clearInterval(s.wait);
    endStream(s);
    s.uxplay?.kill();
    s.udp?.close();
    if (s.port && adbPath()) void adb("-s", s.serial, "forward", "--remove", `tcp:${s.port}`).catch(() => undefined);
    all.delete(id);
  }

  ipcMain.handle("phone:status", () => ({ android: !!adbPath() && existsSync(jar), airplay: existsSync(process.env.AETHERDECK_UXPLAY || uxplay), brew: !!findTool("brew") }));
  ipcMain.handle("phone:setUpAndroid", () => setUpAndroid());
  ipcMain.handle("phone:setUpAirplay", () => setUpAirplay());
  ipcMain.handle("phone:devices", () => devices());
  ipcMain.handle("phone:start", (_e, id: string, serial: string) => {
    if (!/^[\w.:-]+$/.test(serial) || all.has(id)) return;
    const s: Session = { stop: false, serial, paused: false };
    all.set(id, s);
    void startAndroid(id, s);
  });
  ipcMain.handle("phone:startAirplay", (_e, id: string) => {
    if (all.has(id)) return;
    const s: Session = { stop: false, serial: "", paused: false };
    all.set(id, s);
    return startAirplay(id, s);
  });
  ipcMain.handle("phone:stop", (_e, id: string) => stop(id));
  ipcMain.handle("phone:send", (_e, id: string, message: Uint8Array) => { all.get(id)?.control?.write(message); });
  ipcMain.handle("phone:pause", (_e, id: string, paused: boolean) => {
    const s = all.get(id);
    if (!s) return;
    s.paused = paused;
    if (!paused) s.control?.write(resetVideoMessage());
  });
  ipcMain.handle("phone:clipboard", async () => (await clipboard.readText()).slice(0, 200_000));
  // Over Wi-Fi: the phone stays reachable without the cable, until it restarts.
  ipcMain.handle("phone:wifi", async (_e, serial: string) => {
    const route = await adb("-s", serial, "shell", "ip", "route");
    const ip = route.match(/wlan\d+.*src (\d+\.\d+\.\d+\.\d+)/)?.[1];
    if (!ip) throw new Error("Connect the phone to the same Wi-Fi as this computer first.");
    await adb("-s", serial, "tcpip", "5555");
    await new Promise((r) => setTimeout(r, 1500));
    const address = `${ip}:5555`;
    const out = await adb("connect", address);
    if (!/connected/.test(out)) throw new Error(out.trim());
    writeFileSync(addresses, JSON.stringify({ ...wifi(), [serial]: address }));
    return address;
  });

  return { stopAll: () => { for (const id of [...all.keys()]) stop(id); } };
}
