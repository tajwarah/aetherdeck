// Critically damped springs, stepped on requestAnimationFrame. Interaction stays local and smooth
// regardless of network latency; with reduced motion the value snaps to its target.
import { useEffect, useRef, useState } from "react";

export function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

export function useReducedMotion() {
  const [reduced, setReduced] = useState(prefersReducedMotion);
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!mq) return;
    const on = () => setReduced(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}

/** One step of a critically damped spring toward `target`. `omega` ≈ responsiveness (rad/s). */
export function springStep(x: number, v: number, target: number, omega: number, dt: number): [number, number] {
  const f = 1 + 2 * dt * omega;
  const oo = omega * omega;
  const hoo = dt * oo;
  const hhoo = dt * hoo;
  const detInv = 1 / (f + hhoo);
  const nx = (f * x + dt * v + hhoo * target) * detInv;
  const nv = (v + hoo * (target - x)) * detInv;
  return [nx, nv];
}

export interface Vec { x: number; y: number; s: number }

/**
 * A spring-driven camera/cursor value updated outside React's render cycle.
 * `onFrame` receives the current value every frame while moving.
 */
export class SpringVec {
  value: Vec;
  target: Vec;
  private vel: Vec = { x: 0, y: 0, s: 0 };
  private raf = 0;
  private last = 0;
  omega: number;
  reduced = false;
  private readonly onFrame: (v: Vec) => void;

  constructor(initial: Vec, omega: number, onFrame: (v: Vec) => void) {
    this.value = { ...initial };
    this.target = { ...initial };
    this.omega = omega;
    this.onFrame = onFrame;
  }

  set(target: Partial<Vec>, immediate = false) {
    this.target = { ...this.target, ...target };
    if (immediate || this.reduced) {
      this.value = { ...this.target };
      this.vel = { x: 0, y: 0, s: 0 };
      this.onFrame(this.value);
      return;
    }
    if (!this.raf) {
      this.last = performance.now();
      this.raf = requestAnimationFrame(this.tick);
    }
  }

  private tick = (now: number) => {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    let moving = false;
    for (const k of ["x", "y", "s"] as const) {
      const [nx, nv] = springStep(this.value[k], this.vel[k], this.target[k], this.omega, dt);
      this.value[k] = nx;
      this.vel[k] = nv;
      const eps = k === "s" ? 1e-4 : 0.05;
      if (Math.abs(nx - this.target[k]) > eps || Math.abs(nv) > eps) moving = true;
    }
    if (!moving) this.value = { ...this.target };
    this.onFrame(this.value);
    this.raf = moving ? requestAnimationFrame(this.tick) : 0;
  };

  stop() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }
}

export function useLatest<T>(value: T) {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}
