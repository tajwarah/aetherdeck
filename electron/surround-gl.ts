// Surround mode's drawing, in the interface window's preload, where page frames arrive. One canvas, one WebGL
// context: the room's backdrop, then every page on the wall around you. The interface says what to draw through
// the canvas's data attributes and a "warpnaut-scene" event; frames keep arriving here as they always do.
import { inView, type Panel, type View } from "../shared/surround.ts";

const QUAD_VS = `#version 300 es
out vec2 ndc;
void main() { ndc = vec2(gl_VertexID & 1, gl_VertexID >> 1) * 4.0 - 1.0; gl_Position = vec4(ndc, 0.0, 1.0); }`;
// A dark room with a horizon of gold, marks every 30 degrees, and stars above. Baked once into a panorama, so turning
// costs a texture lookup per pixel instead of this whole sum.
const BAKE_FS = `#version 300 es
precision highp float;
in vec2 ndc; out vec4 color;
float star(vec2 p) { vec2 c = floor(p); float h = fract(sin(dot(c, vec2(127.1, 311.7))) * 43758.5453); vec2 q = fract(p) - 0.5; return step(0.985, h) * smoothstep(0.09, 0.0, length(q)) * h; }
void main() {
  float a = ndc.x * 3.14159265, y = ndc.y;
  vec3 c = mix(vec3(0.035, 0.03, 0.03), vec3(0.012, 0.013, 0.02), smoothstep(-0.7, 0.9, y));
  c += vec3(0.13, 0.09, 0.05) * exp(-abs(y + 0.62) * 7.0);
  c += vec3(0.65, 0.5, 0.3) * smoothstep(0.004, 0.0, abs(y + 0.62));
  float m = abs(fract(a / 0.5236 + 0.5) - 0.5) * 0.5236;
  c += vec3(0.4, 0.31, 0.2) * smoothstep(0.0025, 0.0, m) * smoothstep(0.06, 0.0, abs(y + 0.66));
  if (y > -0.5) c += vec3(0.75, 0.72, 0.65) * star(vec2(a * 34.0, y * 34.0));
  color = vec4(c, 1.0);
}`;
const ROOM_FS = `#version 300 es
precision mediump float;
in vec2 ndc; out vec4 color; uniform sampler2D sky; uniform float yaw, f, aspect;
void main() {
  float side = ndc.x * aspect / f;
  color = texture(sky, vec2((atan(side) + yaw) / 6.2831853 + 0.5, ndc.y / f / sqrt(side * side + 1.0) * 0.5 + 0.5));
}`;
const PANEL_VS = `#version 300 es
in vec2 uv; out vec2 st; uniform float yaw, f, aspect, centre, wide, high;
void main() {
  st = uv;
  float a = centre + (uv.x - 0.5) * wide - yaw;
  float y = (0.5 - uv.y) * high;
  gl_Position = vec4(sin(a) * f / aspect, y * f, cos(a) * 0.5, cos(a));
}`;
// Rounded corners, a soft light on the bend, and an edge of gold on the page you're using.
const PANEL_FS = `#version 300 es
precision highp float;
in vec2 st; out vec4 color; uniform sampler2D page; uniform float wide, high, swapped, focus;
void main() {
  vec2 size = vec2(wide, high);
  vec2 d = abs(st - 0.5) * size - size * 0.5 + 0.022;
  float edge = length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - 0.022;
  float alpha = smoothstep(0.0015, -0.0015, edge);
  vec4 t = texture(page, st);
  vec3 c = swapped > 0.5 ? t.bgr : t.rgb;
  float e = abs(st.x - 0.5) * 2.0;
  c *= 1.0 - 0.1 * e * e;
  c = mix(c, vec3(0.86, 0.68, 0.42), focus * smoothstep(-0.006, 0.0, edge) * 0.9);
  color = vec4(c * alpha, alpha);
}`;

interface Tex { tex: WebGLTexture; swapped: boolean; ready: boolean }
/** The newest frame of a page, waiting for the next drawing; `done` hands it back. */
interface Waiting { frame: VideoFrame; done: () => void }
const UNIFORMS = ["yaw", "f", "aspect", "centre", "wide", "high", "swapped", "focus"] as const;
type Uniforms = Record<(typeof UNIFORMS)[number], WebGLUniformLocation | null>;
interface Scene { canvas: HTMLCanvasElement; gl: WebGL2RenderingContext; room: WebGLProgram; panel: WebGLProgram; roomU: Uniforms; panelU: Uniforms; sky: WebGLTexture; mesh: WebGLVertexArrayObject; empty: WebGLVertexArrayObject; count: number; textures: Map<string, Tex>; waiting: Map<string, Waiting>; due: boolean; panelsText: string; panels: Panel[] }
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

  const sky = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, sky);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, 4096, 1024);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const bake = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, bake);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, sky, 0);
  gl.viewport(0, 0, 4096, 1024);
  gl.useProgram(program(QUAD_VS, BAKE_FS));
  gl.bindVertexArray(empty);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.deleteFramebuffer(bake);

  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  return { canvas, gl, room, panel, roomU: uniforms(room), panelU: uniforms(panel), sky, mesh, empty, count: pts.length / 2, textures: new Map(), waiting: new Map(), due: false, panelsText: "", panels: [] };
}

/** Frames go up once a drawing, newest only: a page that paints faster than the screen waits instead of queueing. */
function upload(s: Scene) {
  const { gl } = s;
  for (const [id, w] of s.waiting) {
    try {
      const t = textureFor(s, id);
      gl.bindTexture(gl.TEXTURE_2D, t.tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, w.frame);
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
  gl.viewport(0, 0, w, h);
  const common = (p: WebGLProgram, u: Uniforms) => { gl.useProgram(p); gl.uniform1f(u.yaw, view.yaw); gl.uniform1f(u.f, f); gl.uniform1f(u.aspect, view.aspect); };
  gl.disable(gl.BLEND);
  common(s.room, s.roomU);
  gl.bindTexture(gl.TEXTURE_2D, s.sky);
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
    t = { tex: gl.createTexture()!, swapped: false, ready: false };
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
  const { gl } = scene;
  const t = textureFor(scene, id);
  gl.bindTexture(gl.TEXTURE_2D, t.tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  t.swapped = true;
  t.ready = true;
  soon(scene);
  return true;
}

export function startSurround() {
  document.addEventListener("warpnaut-scene", () => {
    const canvas = document.querySelector<HTMLCanvasElement>("canvas[data-surround]");
    if (!canvas) { if (scene) letGo(scene); scene = null; return; }
    if (scene?.canvas !== canvas) scene = build(canvas);
    if (scene) soon(scene);
  });
}
