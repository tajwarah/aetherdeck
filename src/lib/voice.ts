// Recording one spoken request: the microphone until the person stops (or falls quiet after speaking), then the
// recording as a small 16 kHz mono WAV, which every speech service accepts. Nothing is kept after it is sent.

export interface Recording {
  /** 0–1: how loud the voice is now, for the orb. */
  level(): number;
  /** Stop and hand back the WAV as base64 (empty when nothing was said). */
  stop(): Promise<string>;
  cancel(): void;
}

/** Start listening. `onQuiet` fires once the person has spoken and then been quiet for a moment. */
export async function record(onQuiet?: () => void): Promise<Recording> {
  // The desktop app asks the system for the microphone first (macOS shows its own prompt, once).
  const bridge = (window as unknown as { horus?: { invoke: (c: string) => Promise<boolean> } }).horus;
  if (bridge && !(await bridge.invoke("app:microphone"))) throw new Error("Microphone not allowed");
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  const ctx = new AudioContext();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  ctx.createMediaStreamSource(stream).connect(analyser);
  const buf = new Uint8Array(analyser.fftSize);
  const recorder = new MediaRecorder(stream);
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  recorder.start(250);
  let spoke = false;
  let quietSince = 0;
  let lvl = 0;
  const started = performance.now();
  const tick = setInterval(() => {
    analyser.getByteTimeDomainData(buf);
    let sum = 0;
    for (const v of buf) sum += ((v - 128) / 128) ** 2;
    lvl = Math.min(1, Math.sqrt(sum / buf.length) * 6);
    const now = performance.now();
    if (lvl > 0.12) { spoke = true; quietSince = 0; } else if (spoke && !quietSince) quietSince = now;
    if ((spoke && quietSince && now - quietSince > 1400) || now - started > 60_000) { clearInterval(tick); onQuiet?.(); }
  }, 60);
  const end = () => { clearInterval(tick); stream.getTracks().forEach((t) => t.stop()); void ctx.close(); };
  return {
    level: () => lvl,
    cancel: () => { if (recorder.state !== "inactive") recorder.stop(); end(); },
    stop: () => new Promise<string>((resolve, reject) => {
      recorder.onstop = async () => {
        end();
        if (!spoke) return resolve("");
        try { resolve(await toWavBase64(new Blob(chunks, { type: recorder.mimeType }))); } catch (err) { reject(err); }
      };
      if (recorder.state !== "inactive") recorder.stop(); else recorder.onstop(new Event("stop"));
    }),
  };
}

async function toWavBase64(blob: Blob): Promise<string> {
  const decoded = await new AudioContext().decodeAudioData(await blob.arrayBuffer());
  const rate = 16_000;
  const off = new OfflineAudioContext(1, Math.max(1, Math.ceil(decoded.duration * rate)), rate);
  const src = off.createBufferSource();
  src.buffer = decoded;
  src.connect(off.destination);
  src.start();
  const pcm = (await off.startRendering()).getChannelData(0);
  const bytes = new DataView(new ArrayBuffer(44 + pcm.length * 2));
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) bytes.setUint8(o + i, s.charCodeAt(i)); };
  str(0, "RIFF"); bytes.setUint32(4, 36 + pcm.length * 2, true); str(8, "WAVE"); str(12, "fmt ");
  bytes.setUint32(16, 16, true); bytes.setUint16(20, 1, true); bytes.setUint16(22, 1, true); bytes.setUint32(24, rate, true);
  bytes.setUint32(28, rate * 2, true); bytes.setUint16(32, 2, true); bytes.setUint16(34, 16, true); str(36, "data"); bytes.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) bytes.setInt16(44 + i * 2, Math.max(-1, Math.min(1, pcm[i])) * 0x7fff, true);
  const u8 = new Uint8Array(bytes.buffer);
  let s = "";
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
}
