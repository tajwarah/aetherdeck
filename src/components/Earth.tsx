// The home's backdrop: deep space crossed by two soft beams of light, and Earth at night rising from the bottom of
// the screen, Europe and Africa under a peach-to-lavender horizon, turning slowly west to east. The globe is drawn
// on the GPU from NASA's Black Marble (public/brand/CREDITS.md): only the band of latitudes this view can show,
// public/brand/earth-band.webp. Until it is ready, and wherever WebGL 2 isn't there, a picture of the same view
// stands in. It holds still behind windows, while an exploration is open, with reduced motion, and when hidden.
import { useEffect, useRef, useState } from "react";

const TOP = 72;      // the band's latitudes, in degrees
const BOTTOM = -12;
const TILT = -31;    // looking north over Africa toward Europe
const START = 22;    // the longitude in the middle when the home opens: the same view as the picture
const TURN = 240;    // seconds for one turn
const FPS = 30;

/** Where the globe sits, in CSS pixels: the same place as the picture (.earth__globe in styles.css). */
function geometry(vw: number, vh: number) {
  const R = Math.max(vw, 1500) * 1.45;
  const horizon = vh * 0.62;
  const top = Math.max(0, Math.floor(horizon - R * 0.09)); // the canvas starts where the glow above the horizon fades
  return { R, cx: vw / 2, cy: horizon + R - top, top, height: vh - top };
}

const VS = `#version 300 es
in vec2 p; void main() { gl_Position = vec4(p, 0., 1.); }`;
const FS = `#version 300 es
precision highp float;
uniform sampler2D t; uniform vec2 res; uniform vec2 c; uniform float R, lon0, lat0, top, span;
out vec4 o;
void main() {
  vec2 f = vec2(gl_FragCoord.x, res.y - gl_FragCoord.y);
  float x = (f.x - c.x) / R, y = (c.y - f.y) / R;
  float d = sqrt(x * x + y * y);
  vec3 lav = vec3(0.62, 0.52, 1.0), peach = vec3(1.0, 0.74, 0.5), blue = vec3(0.35, 0.55, 1.0);
  vec3 rimc = mix(peach, lav, smoothstep(0.25, 0.75, clamp(x * 0.9 + 0.5, 0., 1.)));
  if (d > 1.0) {
    float h = d - 1.0;
    float g = exp(-h * 70.0) * 0.9 + exp(-h * 16.0) * 0.3;
    o = vec4(rimc * g + vec3(1.) * exp(-h * 260.) * 0.6, clamp(g * 1.1, 0., 1.));
    return;
  }
  float z = sqrt(1.0 - d * d);
  float cl = cos(lat0), sl = sin(lat0);
  float lat = asin(clamp(y * cl + z * sl, -1., 1.));
  float lon = lon0 + atan(x, z * cl - y * sl);
  vec3 tex = texture(t, vec2((lon + 3.14159265) / 6.2831853, (top - lat) / span)).rgb;
  float lum = dot(tex, vec3(0.3, 0.59, 0.11));
  float warm = clamp((tex.r - tex.b) * 3.0, 0., 1.);
  vec3 lights = vec3(1.0, 0.7, 0.36) * min(pow(lum, 1.4) * 2.2, 1.15) * warm + vec3(1.0, 0.92, 0.75) * pow(lum, 4.0) * 0.6 * warm;
  vec3 col = tex * vec3(0.16, 0.2, 0.32) + vec3(0.012, 0.02, 0.05) + lights;
  col = mix(col, rimc * 0.85 + blue * 0.15, clamp(pow(1.0 - z, 5.0) * 1.1, 0., 1.));
  col += rimc * pow(1.0 - z, 18.0) * 1.3;
  col *= 0.55 + 0.45 * smoothstep(0.0, 0.5, z);
  o = vec4(col, 1.0);
}`;

export function Earth({ dim, still, reduced }: { dim: boolean; still: boolean; reduced: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [live, setLive] = useState(false);
  const turning = useRef(false);
  turning.current = !dim && !still && !reduced;
  const wake = useRef(() => {});

  useEffect(() => {
    const el = canvas.current!;
    const gl = el.getContext("webgl2", { premultipliedAlpha: false, antialias: false, powerPreference: "low-power" });
    if (!gl) return;
    const shader = (type: number, src: string) => { const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s); return s; };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, shader(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const at = gl.getAttribLocation(prog, "p");
    gl.enableVertexAttribArray(at);
    gl.vertexAttribPointer(at, 2, gl.FLOAT, false, 0, 0);
    const u = (n: string) => gl.getUniformLocation(prog, n);
    const RAD = Math.PI / 180;
    gl.uniform1f(u("lat0"), TILT * RAD);
    gl.uniform1f(u("top"), TOP * RAD);
    gl.uniform1f(u("span"), (TOP - BOTTOM) * RAD);

    let ready = false;
    let lon = START;
    let raf = 0;
    let last = 0;
    let gone = false;

    const size = () => {
      const g = geometry(window.innerWidth, window.innerHeight);
      const dpr = Math.min(devicePixelRatio || 1, 1.5);
      el.style.top = `${g.top}px`;
      el.style.height = `${g.height}px`;
      el.width = Math.round(window.innerWidth * dpr);
      el.height = Math.round(g.height * dpr);
      gl.viewport(0, 0, el.width, el.height);
      gl.uniform2f(u("res"), el.width, el.height);
      gl.uniform2f(u("c"), g.cx * dpr, g.cy * dpr);
      gl.uniform1f(u("R"), g.R * dpr);
    };
    const draw = () => {
      gl.uniform1f(u("lon0"), (((lon % 360) + 360) % 360) * RAD);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };
    const frame = (t: number) => {
      raf = 0;
      if (gone || !ready) return;
      const moving = turning.current && !document.hidden;
      if (last && moving) lon -= ((t - last) / 1000 / TURN) * 360; // the surface moves east: to the right
      last = t;
      draw();
      if (moving) {
        const next = () => { if (!raf && !gone) raf = requestAnimationFrame(frame); };
        setTimeout(next, Math.max(0, 1000 / FPS - (performance.now() - t)));
      } else last = 0;
    };
    wake.current = () => { if (!raf && ready) raf = requestAnimationFrame(frame); };

    const img = new Image();
    img.onload = () => {
      if (gone) return;
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, img);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      ready = true;
      size();
      draw();
      setLive(true);
      wake.current();
    };
    img.src = "/brand/earth-band.webp";

    const onResize = () => { if (!ready) return; size(); draw(); };
    const onVisible = () => wake.current();
    window.addEventListener("resize", onResize);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      gone = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVisible);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    };
  }, []);

  useEffect(() => { wake.current(); }, [dim, still, reduced]);

  return (
    <div className={`earth ${dim ? "earth--dim" : ""}`} aria-hidden="true">
      <div className="earth__beam earth__beam--peach" />
      <div className="earth__beam earth__beam--lavender" />
      {!live && <img className="earth__globe" src="/brand/earth-night.webp" alt="" decoding="async" draggable={false} />}
      <canvas ref={canvas} className={`earth__live ${live ? "is-on" : ""}`} />
    </div>
  );
}
