// Surround mode's drawing, in the interface window's preload, where page frames arrive. One canvas, one WebGL
// context: the room's backdrop, then every page on the wall around you. The interface says what to draw through
// the canvas's data attributes and a "aetherdeck-scene" event; frames keep arriving here as they always do.
import { inView, type Panel, type View } from "../shared/surround.ts";

const QUAD_VS = `#version 300 es
out vec2 ndc;
void main() { ndc = vec2(gl_VertexID & 1, gl_VertexID >> 1) * 4.0 - 1.0; gl_Position = vec4(ndc, 0.0, 1.0); }`;
// The built-in backgrounds, baked once into a panorama, so turning costs a texture lookup per pixel instead of this
// whole sum. 0: a dark room with a horizon of gold, marks every 30 degrees, and stars above. 1: a soft, light studio
// with a floor and a ceiling glow. 2: dusk, a sky fading from blue to amber over dark ground.
const BAKE_FS = `#version 300 es
precision highp float;
in vec2 ndc; out vec4 color; uniform int style;
float star(vec2 p) { vec2 c = floor(p); float h = fract(sin(dot(c, vec2(127.1, 311.7))) * 43758.5453); vec2 q = fract(p) - 0.5; return step(0.985, h) * smoothstep(0.09, 0.0, length(q)) * h; }
void main() {
  float a = ndc.x * 3.14159265, y = ndc.y;
  vec3 c;
  if (style == 1) {
    c = mix(vec3(0.42, 0.4, 0.37), vec3(0.6, 0.58, 0.55), smoothstep(-0.45, 0.6, y));
    c += vec3(0.16, 0.15, 0.13) * exp(-pow(max(0.0, 0.95 - y), 2.0) * 9.0);
    c = mix(c, vec3(0.27, 0.25, 0.23) - 0.08 * (-0.45 - y), step(y, -0.45));
    c += vec3(0.05) * smoothstep(0.012, 0.0, abs(y + 0.45));
  } else if (style == 2) {
    c = mix(vec3(0.95, 0.55, 0.3), vec3(0.12, 0.16, 0.36), smoothstep(-0.4, 0.75, y));
    c = mix(c, vec3(0.03, 0.03, 0.05), smoothstep(0.75, 1.0, y) * 0.6);
    c += vec3(0.5, 0.3, 0.12) * exp(-abs(y + 0.4) * 9.0);
    c = mix(c, vec3(0.05, 0.04, 0.05) + 0.03 * sin(a * 7.0 + sin(a * 3.0)), step(y, -0.4 + 0.02 * sin(a * 5.0) + 0.015 * sin(a * 13.0)));
    if (y > 0.4) c += vec3(0.6, 0.6, 0.65) * star(vec2(a * 34.0, y * 34.0)) * smoothstep(0.4, 0.9, y);
  } else {
    c = mix(vec3(0.035, 0.03, 0.03), vec3(0.012, 0.013, 0.02), smoothstep(-0.7, 0.9, y));
    c += vec3(0.13, 0.09, 0.05) * exp(-abs(y + 0.62) * 7.0);
    c += vec3(0.65, 0.5, 0.3) * smoothstep(0.004, 0.0, abs(y + 0.62));
    float m = abs(fract(a / 0.5236 + 0.5) - 0.5) * 0.5236;
    c += vec3(0.4, 0.31, 0.2) * smoothstep(0.0025, 0.0, m) * smoothstep(0.06, 0.0, abs(y + 0.66));
    if (y > -0.5) c += vec3(0.75, 0.72, 0.65) * star(vec2(a * 34.0, y * 34.0));
  }
  color = vec4(c, 1.0);
}`;
// The baked backgrounds hang on the wall's own cylinder (span 0). A photo is a sphere: its rows are angles up and
// down, π of them for a full 360° photo, fewer for a panorama, which fades to its edge colour above and below.
const ROOM_FS = `#version 300 es
precision highp float;
in vec2 ndc; out vec4 color; uniform sampler2D sky; uniform float yaw, f, aspect, span;
void main() {
  float side = ndc.x * aspect / f;
  float h = ndc.y / f / sqrt(side * side + 1.0);
  float u = (atan(side) + yaw) / 6.2831853 + 0.5;
  if (span <= 0.0) { color = texture(sky, vec2(u, h * 0.5 + 0.5)); return; }
  float v = atan(h) / span + 0.5;
  vec4 c = texture(sky, vec2(u, clamp(v, 0.0, 1.0)));
  // a photo is dimmed a little, as a spatial view dims its surroundings, so the pages stay easy to read
  color = vec4(c.rgb * 0.86 * exp(-max(0.0, abs(v - 0.5) - 0.5) * 6.0), 1.0);
}`;
// Each page is drawn a little larger than itself (PAD, on every side), so the space around it can hold its glass
// rim and the soft shadow it casts on the room, the way a window floats in a spatial view.
const PAD = 0.07;
const PANEL_VS = `#version 300 es
in vec2 uv; out vec2 st; uniform float yaw, f, aspect, centre, wide, high;
const float PAD = ${PAD};
void main() {
  vec2 grow = vec2(PAD / wide, PAD / high);
  st = uv * (1.0 + 2.0 * grow) - grow;
  float a = centre + (st.x - 0.5) * wide - yaw;
  float y = (0.5 - st.y) * high;
  gl_Position = vec4(sin(a) * f / aspect, y * f, cos(a) * 0.5, cos(a));
}`;
// Rounded corners and a soft light on the bend; around the page a rim of clear glass, lit along its top, and a
// shadow below it. The page you're using is a touch brighter and its rim a touch clearer; the others rest.
const PANEL_FS = `#version 300 es
precision highp float;
in vec2 st; out vec4 color; uniform sampler2D page; uniform float wide, high, swapped, focus;
float box(vec2 p, vec2 half_, float r) { vec2 d = abs(p) - half_ + r; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - r; }
void main() {
  vec2 size = vec2(wide, high);
  vec2 p = (st - 0.5) * size;
  const float RIM = 0.011;
  float inner = box(p, size * 0.5, 0.024);
  float glass = box(p, size * 0.5 + RIM, 0.024 + RIM);
  float shade = box(p + vec2(0.0, 0.018), size * 0.5 + RIM, 0.05);
  vec4 c = vec4(0.0, 0.0, 0.0, 0.34 * exp(-max(shade, 0.0) / 0.026) * smoothstep(-0.02, 0.01, shade));
  float rimA = smoothstep(0.0012, -0.0012, glass);
  float lit = smoothstep(0.0, -size.y, p.y) * 0.5 + 0.5;
  vec4 rim = vec4(vec3(1.0) * (0.16 + 0.1 * focus) * lit, 0.16 + 0.1 * focus);
  rim.rgb += vec3(0.32) * smoothstep(-0.0025, 0.0, glass) * rimA * lit;
  c = rim * rimA + c * (1.0 - rimA);
  float pageA = smoothstep(0.0012, -0.0012, inner);
  if (pageA > 0.0) {
    vec4 t = texture(page, clamp(st, 0.0, 1.0));
    vec3 pc = swapped > 0.5 ? t.bgr : t.rgb;
    float e = abs(st.x - 0.5) * 2.0;
    pc *= (1.0 - 0.08 * e * e) * mix(0.9, 1.0, focus);
    c = vec4(pc, 1.0) * pageA + c * (1.0 - pageA);
  }
  color = c;
}`;

interface Tex { tex: WebGLTexture; swapped: boolean; ready: boolean; w: number; h: number }
/** The newest frame of a page, waiting for the next drawing; `done` hands it back. */
interface Waiting { frame: VideoFrame; done: () => void }
const UNIFORMS = ["yaw", "f", "aspect", "centre", "wide", "high", "swapped", "focus", "span"] as const;
type Uniforms = Record<(typeof UNIFORMS)[number], WebGLUniformLocation | null>;
interface Scene {
  canvas: HTMLCanvasElement; gl: WebGL2RenderingContext; room: WebGLProgram; panel: WebGLProgram; roomU: Uniforms; panelU: Uniforms; mesh: WebGLVertexArrayObject; empty: WebGLVertexArrayObject; count: number;
  textures: Map<string, Tex>; waiting: Map<string, Waiting>; due: boolean; panelsText: string; panels: Panel[];
  /** The background: a baked one, or the person's photo. `skyKey` is what the interface asked for. */
  baked: WebGLTexture; bake: WebGLProgram; photo: WebGLTexture | null; span: number; skyKey: string;
}
const STYLES: Record<string, number> = { night: 0, studio: 1, dusk: 2 };
let scene: Scene | null = null;

function build(canvas: HTMLCanvasElement): Scene | null {
  const gl = canvas.getContext("webgl2", { alpha: false, antialias: false, depth: false, stencil: false, powerPreference: "high-performance" });
  if (!gl) return null;
  const program = (vs: string, fs: string) => {
    const p = gl.createProgram()!;
    for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]] as const) { const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s); gl.attachShader(p, s); }
    gl.linkProgram(p);
    return p;
  };
  const room = program(QUAD_VS, ROOM_FS);
  const panel = program(PANEL_VS, PANEL_FS);
  const uniforms = (p: WebGLProgram) => Object.fromEntries(UNIFORMS.map((n) => [n, gl.getUniformLocation(p, n)])) as Uniforms;
  const N = 64;
  const pts: number[] = [];
  for (let i = 0; i < N; i++) { const a = i / N, b = (i + 1) / N; pts.push(a, 0, b, 0, a, 1, b, 0, b, 1, a, 1); }
  const empty = gl.createVertexArray()!;
  const mesh = gl.createVertexArray()!;
  gl.bindVertexArray(mesh);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pts), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(panel, "uv");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  const baked = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, baked);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, 4096, 1024);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  const s: Scene = { canvas, gl, room, panel, roomU: uniforms(room), panelU: uniforms(panel), mesh, empty, count: pts.length / 2, textures: new Map(), waiting: new Map(), due: false, panelsText: "", panels: [], baked, bake: program(QUAD_VS, BAKE_FS), photo: null, span: 0, skyKey: "" };
  bakeSky(s, 0); // something to stand in while a photo loads
  return s;
}

/** Paints one of the built-in backgrounds into the panorama. */
function bakeSky(s: Scene, style: number) {
  const { gl } = s;
  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, s.baked, 0);
  gl.viewport(0, 0, 4096, 1024);
  gl.disable(gl.BLEND);
  gl.useProgram(s.bake);
  gl.uniform1i(gl.getUniformLocation(s.bake, "style"), style);
  gl.bindVertexArray(s.empty);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.deleteFramebuffer(fb);
}

/** The background the interface asks for ("night", "studio", "dusk", or "image:" and a 360° photo's address). */
function pickSky(s: Scene, key: string) {
  if (key === s.skyKey) return;
  s.skyKey = key;
  if (!key.startsWith("image:")) { bakeSky(s, STYLES[key] ?? 0); s.span = 0; return; }
  // The photo loads in the background; the room keeps the background it has until it's ready.
  const img = new Image();
  img.src = key.slice(6);
  void img.decode().then(() => {
    if (scene !== s || s.skyKey !== key) return;
    const { gl } = s;
    if (s.photo) gl.deleteTexture(s.photo);
    s.photo = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, s.photo);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true); // the image's top row at the top of the room
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    s.span = Math.min(Math.PI, (Math.PI * 2 * img.naturalHeight) / img.naturalWidth); // the photo goes all the way round
    soon(s);
  }).catch(() => { if (s.skyKey === key) { s.skyKey = ""; pickSky(s, "night"); soon(s); } });
}

/** Frames go up once a drawing, newest only: a page that paints faster than the screen waits instead of queueing. */
function upload(s: Scene) {
  const { gl } = s;
  for (const [id, w] of s.waiting) {
    try {
      const t = textureFor(s, id);
      gl.bindTexture(gl.TEXTURE_2D, t.tex);
      // the same size as last time: copy into the texture it has, rather than making a new one every frame
      const fw = w.frame.displayWidth, fh = w.frame.displayHeight;
      if (t.ready && !t.swapped && t.w === fw && t.h === fh) gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, w.frame);
      else { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, w.frame); t.w = fw; t.h = fh; }
      t.swapped = false;
      t.ready = true;
    } catch { /* a frame lost is redrawn by the next one */ }
    w.done();
  }
  s.waiting.clear();
}

function draw(s: Scene) {
  const { canvas, gl } = s;
  upload(s);
  const w = Math.round(canvas.clientWidth * devicePixelRatio);
  const h = Math.round(canvas.clientHeight * devicePixelRatio);
  if (!w || !h) return;
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  const view: View = { yaw: Number(canvas.dataset.yaw) || 0, fov: Number(canvas.dataset.fov) || 1, aspect: w / h };
  const text = canvas.dataset.panels ?? "[]";
  if (text !== s.panelsText) { s.panelsText = text; s.panels = JSON.parse(text) as Panel[]; }
  const f = 1 / Math.tan(view.fov / 2);
  pickSky(s, canvas.dataset.sky || "night");
  gl.viewport(0, 0, w, h);
  const common = (p: WebGLProgram, u: Uniforms) => { gl.useProgram(p); gl.uniform1f(u.yaw, view.yaw); gl.uniform1f(u.f, f); gl.uniform1f(u.aspect, view.aspect); };
  gl.disable(gl.BLEND);
  common(s.room, s.roomU);
  const photo = s.skyKey.startsWith("image:") && s.photo && s.span > 0;
  gl.uniform1f(s.roomU.span, photo ? s.span : 0);
  gl.bindTexture(gl.TEXTURE_2D, photo ? s.photo : s.baked);
  gl.bindVertexArray(s.empty);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.enable(gl.BLEND);
  common(s.panel, s.panelU);
  gl.bindVertexArray(s.mesh);
  const u = s.panelU;
  for (const p of s.panels) {
    const t = s.textures.get(p.id);
    if (!t?.ready || !inView(view, p)) continue;
    gl.bindTexture(gl.TEXTURE_2D, t.tex);
    gl.uniform1f(u.centre, p.yaw); gl.uniform1f(u.wide, p.width); gl.uniform1f(u.high, p.height);
    gl.uniform1f(u.swapped, t.swapped ? 1 : 0);
    gl.uniform1f(u.focus, canvas.dataset.focus === p.id ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, s.count);
  }
}

function letGo(s: Scene) { for (const w of s.waiting.values()) w.done(); s.waiting.clear(); }

function soon(s: Scene) {
  if (s.due) return;
  s.due = true;
  requestAnimationFrame(() => { s.due = false; if (scene === s) draw(s); else letGo(s); });
}

function textureFor(s: Scene, id: string) {
  let t = s.textures.get(id);
  if (!t) {
    const { gl } = s;
    t = { tex: gl.createTexture()!, swapped: false, ready: false, w: 0, h: 0 };
    gl.bindTexture(gl.TEXTURE_2D, t.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    s.textures.set(id, t);
  }
  return t;
}

/** A page's new frame, if the room is open. False sends it to the page's own canvas as usual. */
export function sceneFrame(id: string, frame: VideoFrame, done: () => void) {
  if (!scene) return false;
  scene.waiting.get(id)?.done();
  scene.waiting.set(id, { frame, done });
  soon(scene);
  return true;
}

/** The same, for a frame copied through the CPU (BGRA pixels). */
export function sceneBitmap(id: string, width: number, height: number, pixels: Uint8Array) {
  if (!scene) return false;
  if (!width || !height || pixels.length < width * height * 4) return true; // nothing to draw: keep the last frame
  const { gl } = scene;
  const t = textureFor(scene, id);
  gl.bindTexture(gl.TEXTURE_2D, t.tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  Object.assign(t, { w: width, h: height });
  t.swapped = true;
  t.ready = true;
  soon(scene);
  return true;
}

export function startSurround() {
  document.addEventListener("aetherdeck-scene", () => {
    const canvas = document.querySelector<HTMLCanvasElement>("canvas[data-surround]");
    if (!canvas) { if (scene) letGo(scene); scene = null; return; }
    if (scene?.canvas !== canvas) scene = build(canvas);
    if (scene) soon(scene);
  });
}
