// Small 2D vector helpers.

export type V = [number, number];

export const TWO_PI = Math.PI * 2;

export const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1]];
export const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1]];
export const mul = (a: V, k: number): V => [a[0] * k, a[1] * k];
export const dot = (a: V, b: V): number => a[0] * b[0] + a[1] * b[1];
export const cross = (a: V, b: V): number => a[0] * b[1] - a[1] * b[0];
export const len = (a: V): number => Math.hypot(a[0], a[1]);
export const dist = (a: V, b: V): number => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const perp = (a: V): V => [-a[1], a[0]];
export const mid = (a: V, b: V): V => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
export const polar = (c: V, r: number, ang: number): V => [c[0] + r * Math.cos(ang), c[1] + r * Math.sin(ang)];
export const angleOf = (a: V): number => Math.atan2(a[1], a[0]);

export function norm(a: V): V {
  const l = len(a);
  return l < 1e-12 ? [1, 0] : [a[0] / l, a[1] / l];
}

/** Wraps an angle into [0, 2π). */
export function wrap(a: number): number {
  const r = a % TWO_PI;
  return r < 0 ? r + TWO_PI : r;
}

/** True when `ang` lies on the counter-clockwise sweep from a0 to a1. */
export function inSweep(ang: number, a0: number, a1: number): boolean {
  return wrap(ang - a0) <= wrap(a1 - a0) + 1e-9;
}

/** Closest point on segment ab to p, and its parameter along the segment. */
export function projectOnSegment(p: V, a: V, b: V): { point: V; t: number } {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  const t = l2 < 1e-18 ? 0 : Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2));
  return { point: add(a, mul(ab, t)), t };
}

export function distToSegment(p: V, a: V, b: V): number {
  return dist(p, projectOnSegment(p, a, b).point);
}

/** Intersection of the infinite lines through a with direction d, and b with direction e. */
export function intersectLines(a: V, d: V, b: V, e: V): V | null {
  const den = cross(d, e);
  if (Math.abs(den) < 1e-12) return null;
  const t = cross(sub(b, a), e) / den;
  return add(a, mul(d, t));
}

export interface Box { x0: number; y0: number; x1: number; y1: number }

export function emptyBox(): Box {
  return { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
}
export function grow(b: Box, p: V, r = 0): void {
  b.x0 = Math.min(b.x0, p[0] - r);
  b.y0 = Math.min(b.y0, p[1] - r);
  b.x1 = Math.max(b.x1, p[0] + r);
  b.y1 = Math.max(b.y1, p[1] + r);
}
export const boxIsEmpty = (b: Box): boolean => b.x1 < b.x0;

// ---- cubic Bézier curves ------------------------------------------------------

/** A cubic Bézier curve: start, first control, second control, end. */
export type Cubic = [V, V, V, V];

/** The point at t, from 0 at the start to 1 at the end. */
export function bezierAt([a, b, c, d]: Cubic, t: number): V {
  const u = 1 - t;
  const k0 = u * u * u, k1 = 3 * u * u * t, k2 = 3 * u * t * t, k3 = t * t * t;
  return [k0 * a[0] + k1 * b[0] + k2 * c[0] + k3 * d[0], k0 * a[1] + k1 * b[1] + k2 * c[1] + k3 * d[1]];
}

/** The direction it runs in at t (not of unit length). */
export function bezierTangent([a, b, c, d]: Cubic, t: number): V {
  const u = 1 - t;
  const k0 = 3 * u * u, k1 = 6 * u * t, k2 = 3 * t * t;
  const v: V = [k0 * (b[0] - a[0]) + k1 * (c[0] - b[0]) + k2 * (d[0] - c[0]), k0 * (b[1] - a[1]) + k1 * (c[1] - b[1]) + k2 * (d[1] - c[1])];
  // Where a control point sits on its end, the direction there is towards the other one.
  return len(v) > 1e-12 ? v : sub(t < 0.5 ? (dist(b, a) > 1e-12 ? b : c) : d, t < 0.5 ? a : (dist(c, d) > 1e-12 ? c : b));
}

/** Points along it, both ends included: enough that the straight pieces between them look curved. */
export function bezierPoints(q: Cubic, n = 0): V[] {
  // About one piece for every few degrees the control polygon turns, and a few at least.
  const steps = n || Math.max(8, Math.min(64, Math.ceil((dist(q[0], q[1]) + dist(q[1], q[2]) + dist(q[2], q[3])) / (dist(q[0], q[3]) + 1e-12) * 8)));
  const out: V[] = [];
  for (let i = 0; i <= steps; i++) out.push(bezierAt(q, i / steps));
  return out;
}

/** The parameter of the point on it nearest to p, and how far that is. */
export function bezierNearest(q: Cubic, p: V): { t: number; d: number } {
  const n = 48;
  let best = { t: 0, d: Infinity };
  for (let i = 0; i <= n; i++) {
    const t = i / n, d = dist(bezierAt(q, t), p);
    if (d < best.d) best = { t, d };
  }
  // Closer in, by halving the step round the best sample.
  let step = 1 / n;
  for (let k = 0; k < 20; k++) {
    step /= 2;
    for (const t of [best.t - step, best.t + step]) {
      if (t < 0 || t > 1) continue;
      const d = dist(bezierAt(q, t), p);
      if (d < best.d) best = { t, d };
    }
  }
  return best;
}

/**
 * A smooth curve through points, as cubic Bézier pieces from each point to
 * the next (Catmull-Rom): at each point it runs parallel to the line from the
 * point before to the point after. An open curve leaves its ends heading
 * straight for the next point; a closed one runs on from the last point back
 * to the first.
 */
export function splineCubics(pts: V[], closed = false): Cubic[] {
  const n = pts.length;
  if (n < 2) return [];
  const at = (i: number): V => {
    if (closed) return pts[((i % n) + n) % n];
    if (i < 0) return sub(mul(pts[0], 2), pts[1]);
    if (i >= n) return sub(mul(pts[n - 1], 2), pts[n - 2]);
    return pts[i];
  };
  const out: Cubic[] = [];
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    out.push([p1, add(p1, mul(sub(p2, p0), 1 / 6)), sub(p2, mul(sub(p3, p1), 1 / 6)), p2]);
  }
  return out;
}

/** The point on a run of Bézier pieces nearest to p: which piece, where on it, and how far. */
export function chainNearest(chain: Cubic[], p: V): { i: number; t: number; d: number } {
  let best = { i: 0, t: 0, d: Infinity };
  chain.forEach((q, i) => {
    const r = bezierNearest(q, p);
    if (r.d < best.d) best = { i, ...r };
  });
  return best;
}

/** A run of Bézier pieces as one list of points, start, then two controls and an end for each piece. */
export function chainPoints(chain: Cubic[]): V[] {
  return chain.length ? [chain[0][0], ...chain.flatMap((q) => [q[1], q[2], q[3]])] : [];
}

/** The pieces back out of such a list. */
export function chainCubics(pts: V[]): Cubic[] {
  const out: Cubic[] = [];
  for (let i = 0; i + 3 < pts.length; i += 3) out.push([pts[i], pts[i + 1], pts[i + 2], pts[i + 3]]);
  return out;
}
