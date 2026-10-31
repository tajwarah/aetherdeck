// Drawing anything on the curved screen with WebGL: a page's frames, or a phone's. One texture, one cylinder,
// read from the canvas's data-bend. Used by the interface's preload and by the interface itself.
import { curveFor } from "./curve.ts";

const VS = `#version 300 es
uniform float ARC, R, D;
in vec2 uv; out vec2 st;
void main() {
  st = uv;
  float a = (uv.x - 0.5) * ARC;
  float z = R * (cos(a) - cos(ARC * 0.5));
  float s = D / (D + z);
  gl_Position = vec4(2.0 * R * sin(a) * s, (1.0 - 2.0 * uv.y) * s, 0.0, 1.0);
}`;
// The bend, lit: the sides turn toward you and catch a little less light; a faint sheen runs down the middle.
const FS = `#version 300 es
precision highp float;
in vec2 st; out vec4 color; uniform sampler2D page; uniform float swapped;
void main() {
  float e = abs(st.x - 0.5) * 2.0;
  float light = 1.0 - 0.13 * e * e + 0.025 * (1.0 - e);
  vec4 t = texture(page, st);
  color = vec4((swapped > 0.5 ? t.bgr : t.rgb) * light, 1.0);
}`;

export interface Surface { canvas: HTMLCanvasElement; gl: WebGL2RenderingContext; tex: WebGLTexture; count: number; arc: WebGLUniformLocation | null; r: WebGLUniformLocation | null; d: WebGLUniformLocation | null; swapped: WebGLUniformLocation | null; drawn: boolean }

export function makeSurface(canvas: HTMLCanvasElement): Surface | null {
  const gl = canvas.getContext("webgl2", { alpha: true, premultipliedAlpha: true, antialias: true });
  if (!gl) return null;
  const compile = (type: number, src: string) => { const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s); return s; };
  const prog = gl.createProgram()!;
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog);
  gl.useProgram(prog);
  // 128 columns: the curve stays smooth at any window width
  const N = 128;
  const pts: number[] = [];
  for (let i = 0; i < N; i++) { const a = i / N, b = (i + 1) / N; pts.push(a, 0, b, 0, a, 1, b, 0, b, 1, a, 1); }
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pts), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, "uv");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const s: Surface = { canvas, gl, tex, count: pts.length / 2, arc: gl.getUniformLocation(prog, "ARC"), r: gl.getUniformLocation(prog, "R"), d: gl.getUniformLocation(prog, "D"), swapped: gl.getUniformLocation(prog, "swapped"), drawn: false };
  // The window grew or shrank: the last frame is redrawn at the new bend, even on a screen that is standing still.
  new MutationObserver(() => { if (s.drawn) drawSurface(s); }).observe(canvas, { attributes: true, attributeFilter: ["data-bend"] });
  return s;
}

export function drawSurface(s: Surface) {
  const { canvas, gl } = s;
  const w = Math.round(canvas.clientWidth * devicePixelRatio);
  const h = Math.round(canvas.clientHeight * devicePixelRatio);
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  const c = curveFor(Number(canvas.dataset.bend) || 1);
  gl.uniform1f(s.arc, c.arc);
  gl.uniform1f(s.r, c.r);
  gl.uniform1f(s.d, c.d);
  gl.viewport(0, 0, w, h);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.drawArrays(gl.TRIANGLES, 0, s.count);
  s.drawn = true;
}

/** One new picture, drawn on the curve. */
export function drawFrame(s: Surface, frame: TexImageSource) {
  s.gl.bindTexture(s.gl.TEXTURE_2D, s.tex);
  s.gl.texImage2D(s.gl.TEXTURE_2D, 0, s.gl.RGBA, s.gl.RGBA, s.gl.UNSIGNED_BYTE, frame);
  s.gl.uniform1f(s.swapped, 0);
  drawSurface(s);
}

/** One new picture copied through the CPU, where shared textures can't be used. Its pixels are BGRA. */
export function drawBitmap(s: Surface, width: number, height: number, pixels: Uint8Array) {
  s.gl.bindTexture(s.gl.TEXTURE_2D, s.tex);
  s.gl.texImage2D(s.gl.TEXTURE_2D, 0, s.gl.RGBA8, width, height, 0, s.gl.RGBA, s.gl.UNSIGNED_BYTE, pixels);
  s.gl.uniform1f(s.swapped, 1);
  drawSurface(s);
}
