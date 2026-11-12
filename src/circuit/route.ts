// How a bundle of wires runs. Its middle runs in straight stretches that
// turn square corners: out of the first port, round whatever is in the way,
// into the second. Every wire keeps its place across the bundle, so on a
// corner they turn about one centre and stay evenly spaced. Where a wire's
// place across the bundle is not where its pin is at the far end, it swings
// over to it in a short S just before the end.

import type { V } from "../geom";
import { KAPPA } from "./art";

export type Axis = "h" | "v";
export interface Box { x0: number; y0: number; x1: number; y1: number }

const EPS = 1e-6;
const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1]];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1]];
const mul = (a: V, k: number): V => [a[0] * k, a[1] * k];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1];
const cross = (a: V, b: V) => a[0] * b[1] - a[1] * b[0];
const len = (a: V) => Math.hypot(a[0], a[1]);
const unit = (a: V): V => { const l = len(a) || 1; return [a[0] / l, a[1] / l]; };
/** The left-hand normal: a quarter turn counter-clockwise. */
export const leftOf = (u: V): V => [-u[1], u[0]];

/** The axis a direction runs along. */
export const axisOf = (u: V): Axis => (Math.abs(u[0]) >= Math.abs(u[1]) ? "h" : "v");
/** Where a point is across a stretch running along `axis`: its y for one across the page, its x for one up it. */
const across = (p: V, axis: Axis) => (axis === "h" ? p[1] : p[0]);

/**
 * The middle of a bundle from `s` (leaving along `us`) to `e` (arriving
 * against `ue`), through stretches at the given places across their run.
 * Null when the places do not fit the ends: the number of stretches has to
 * let the last one run along the axis the far end needs.
 */
export function pathThrough(s: V, us: V, e: V, ue: V, places: number[]): V[] | null {
  const a = axisOf(us), b = axisOf(ue);
  const n = places.length + 2;
  const lastAxis: Axis = n % 2 === 1 ? a : a === "h" ? "v" : "h";
  if (!places.length && a === b) {
    // One straight stretch: only where the two ends are in line.
    return Math.abs(across(s, a) - across(e, a)) < 1e-3 ? [s, e] : null;
  }
  if (lastAxis !== b) return null;
  const lines = [across(s, a), ...places, across(e, b)];
  const pts: V[] = [s];
  let axis = a;
  for (let k = 0; k + 1 < lines.length; k++) {
    // Stretch k runs along `axis` at lines[k]; the next runs across it at lines[k + 1].
    pts.push(axis === "h" ? [lines[k + 1], lines[k]] : [lines[k], lines[k + 1]]);
    axis = axis === "h" ? "v" : "h";
  }
  pts.push(e);
  return pts;
}

/** The places across their run of the middle stretches of a path: what is kept when it is moved by hand. */
export function placesOf(path: V[], us: V): number[] {
  const out: number[] = [];
  let axis = axisOf(us);
  for (let k = 1; k + 2 < path.length + 0; k++) {
    axis = axis === "h" ? "v" : "h";
    out.push(across(path[k], axis));
  }
  return out;
}

/** Drops corners that do not turn and stretches of no length. */
export function tidyPath(pts: V[]): V[] {
  const out: V[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (last && len(sub(p, last)) < EPS) continue;
    out.push(p);
  }
  for (let k = out.length - 2; k >= 1; k--) {
    if (Math.abs(cross(sub(out[k], out[k - 1]), sub(out[k + 1], out[k]))) < EPS) out.splice(k, 1);
  }
  return out;
}

/** Whether a stretch from a to b passes through the box. */
export function crosses(a: V, b: V, box: Box): boolean {
  const x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]), y0 = Math.min(a[1], b[1]), y1 = Math.max(a[1], b[1]);
  return x1 > box.x0 && x0 < box.x1 && y1 > box.y0 && y0 < box.y1;
}

export interface RouteNeeds {
  /** How far a bundle has to run straight out of a port before it may turn. */
  leadA: number;
  leadB: number;
  /** Half the width of the bundle, so it is kept that far from boxes too. */
  half: number;
  /** Boxes to keep out of: the devices, each grown a little. The first and the last stretch may cross their own. */
  boxes: Box[];
  ownA?: number;
  ownB?: number;
}

/** How bad a path is: long, turning often, crossing devices or too short to turn in are all bad. */
function cost(p: V[], us: V, ue: V, need: RouteNeeds): number {
  let c = 0;
  for (let k = 0; k + 1 < p.length; k++) {
    const d = len(sub(p[k + 1], p[k]));
    c += d;
    const first = k === 0, last = k + 2 === p.length;
    for (let i = 0; i < need.boxes.length; i++) {
      if ((first && i === need.ownA) || (last && i === need.ownB)) continue;
      const b = need.boxes[i], h = need.half;
      if (crosses(p[k], p[k + 1], { x0: b.x0 - h, y0: b.y0 - h, x1: b.x1 + h, y1: b.y1 + h })) c += 400;
    }
    if (!first && !last && d < 2 * need.half + 2) c += 30;
  }
  c += (p.length - 2) * 5;
  // The way out and the way in have to be long enough to turn in, and point the right way.
  const outRun = dot(sub(p[1], p[0]), us), inRun = dot(sub(p[p.length - 2], p[p.length - 1]), ue);
  if (outRun < need.leadA - 1e-6) c += 300 + (need.leadA - outRun) * 40;
  if (inRun < need.leadB - 1e-6) c += 300 + (need.leadB - inRun) * 40;
  return c;
}

/**
 * The places of the middle stretches of the best path found from `s` to `e`:
 * a few shapes tried with a few places each, the cheapest kept. An empty list
 * is a single corner, or a straight run where the ends are in line.
 */
export function autoRoute(s: V, us: V, e: V, ue: V, need: RouteNeeds): number[] {
  return bestRoute(s, us, e, ue, need).places;
}

/** The same, with how bad the path found is. */
export function bestRoute(s: V, us: V, e: V, ue: V, need: RouteNeeds): { places: number[]; cost: number } {
  const a = axisOf(us), b = axisOf(ue);
  const tries: number[][] = [];
  const along = (p: V, axis: Axis) => (axis === "h" ? p[0] : p[1]);
  // Where the first and last turns can be: just past each lead, halfway, or past both.
  const outA = along(s, a) + (a === "h" ? us[0] : us[1]) * need.leadA;
  const inB = along(e, b) + (b === "h" ? ue[0] : ue[1]) * need.leadB;
  if (a === b) {
    tries.push([]);
    const mid = (along(s, a) + along(e, a)) / 2;
    const sign = a === "h" ? us[0] : us[1];
    const beyond = sign > 0 ? Math.max(outA, inB) : Math.min(outA, inB);
    for (const k of [mid, outA, inB, beyond]) tries.push([k]);
    // Round the side: out, across past the devices, back.
    const lo = Math.min(...need.boxes.map((x) => (a === "h" ? x.y0 : x.x0)), across(s, a), across(e, a)) - need.half - 3;
    const hi = Math.max(...need.boxes.map((x) => (a === "h" ? x.y1 : x.x1)), across(s, a), across(e, a)) + need.half + 3;
    const midAcross = (across(s, a) + across(e, a)) / 2;
    for (const side of [midAcross, lo, hi]) tries.push([outA, side, inB]);
  } else {
    tries.push([]);
    const midA = (along(s, a) + along(e, a)) / 2;
    const midB = (along(s, b) + along(e, b)) / 2;
    for (const k1 of [outA, midA, along(e, a)]) for (const k2 of [inB, midB, along(s, b)]) tries.push([k1, k2]);
  }
  let best: number[] = [], bestCost = Infinity;
  for (const t of tries) {
    const p = pathThrough(s, us, e, ue, t);
    if (!p) continue;
    const c = cost(tidyPath(p), us, ue, need);
    if (c < bestCost - 1e-9) { bestCost = c; best = t; }
  }
  return { places: best, cost: bestCost };
}

/** The four ways a wire can leave a point. */
export const WAYS: V[] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/**
 * The best path where an end may leave more than one way, as at a junction of
 * a circuit diagram: every pairing of the ways given is tried, those that
 * point at the other end first, and the cheapest is kept with the ways it
 * leaves by.
 */
export function freeRoute(s: V, usWays: V[], e: V, ueWays: V[], need: RouteNeeds): { us: V; ue: V; places: number[] } {
  const towards = (from: V, to: V) => (x: V, y: V) => dot(y, sub(to, from)) - dot(x, sub(to, from));
  const as = usWays.length > 1 ? [...usWays].sort(towards(s, e)) : usWays;
  const bs = ueWays.length > 1 ? [...ueWays].sort(towards(e, s)) : ueWays;
  let best = { us: as[0], ue: bs[0], places: [] as number[] }, bestCost = Infinity;
  for (const us of as) for (const ue of bs) {
    const r = bestRoute(s, us, e, ue, need);
    if (r.cost < bestCost - 1e-9) { bestCost = r.cost; best = { us, ue, places: r.places }; }
  }
  return best;
}

// ---- the wires of a bundle ---------------------------------------------------------------

export interface Lane {
  /** Where the wire starts and where it ends. */
  from: V;
  to: V;
}

/**
 * The wires of a bundle along its middle `path`, as chains of cubic pieces
 * (a start, then two controls and an end for each piece). Each keeps its
 * place across the bundle that it has at the start; `r` is the radius the
 * middle of the bundle turns at, 0 for square corners.
 */
export function laneChains(path: V[], lanes: Lane[], r: number): V[][] {
  const m = path.length - 1;
  const u: V[] = [], nl: V[] = [], seg: number[] = [];
  for (let k = 0; k < m; k++) {
    const d = sub(path[k + 1], path[k]);
    seg.push(len(d));
    u.push(unit(d));
    nl.push(leftOf(u[k]));
  }
  const offs = lanes.map((l) => dot(sub(l.from, path[0]), nl[0]));
  const half = Math.max(0, ...offs.map(Math.abs));
  // How far each wire swings over at the end, and the room that takes.
  const swings = lanes.map((l, i) => dot(sub(l.to, add(path[m], mul(nl[m - 1], offs[i]))), nl[m - 1]));
  const fans = swings.map((s) => (Math.abs(s) < 0.02 ? 0 : Math.min(7, Math.max(1.6, 1.2 + 1.1 * Math.abs(s)))));
  const fanRoom = Math.max(0, ...fans);
  // The radius each corner can have: no more than its two stretches have room for.
  const R: number[] = [];
  for (let k = 1; k < m; k++) {
    const before = k === 1 ? seg[0] : seg[k - 1] / 2;
    const after = k === m - 1 ? seg[k] - fanRoom : seg[k] / 2;
    R[k] = r > 0 ? Math.max(0, Math.min(r, before - half, after - half)) + 0 : 0;
  }
  return lanes.map((lane, i) => {
    const d = offs[i];
    const pts: V[] = [lane.from];
    const at = () => pts[pts.length - 1];
    const lineTo = (b: V) => {
      const a = at();
      if (len(sub(b, a)) < EPS) return;
      pts.push(add(a, mul(sub(b, a), 1 / 3)), add(a, mul(sub(b, a), 2 / 3)), b);
    };
    for (let k = 1; k < m; k++) {
      const q = add(path[k], mul(add(nl[k - 1], nl[k]), d));
      const left = cross(u[k - 1], u[k]) > 0;
      const rr = R[k] > 0 ? Math.max(0.25, left ? R[k] - d : R[k] + d) : 0;
      if (rr <= 0) { lineTo(q); continue; }
      const a = sub(q, mul(u[k - 1], rr)), b = add(q, mul(u[k], rr));
      lineTo(a);
      pts.push(add(a, mul(u[k - 1], KAPPA * rr)), sub(b, mul(u[k], KAPPA * rr)), b);
    }
    // The last stretch, then the swing over to the pin where it is not in line.
    const ul = u[m - 1];
    if (!fans[i]) {
      lineTo(lane.to);
    } else {
      const depth = dot(sub(lane.to, path[m]), ul);
      const start = add(add(path[m], mul(nl[m - 1], d)), mul(ul, depth - fans[i]));
      lineTo(start);
      const f = fans[i] * 0.5;
      pts.push(add(start, mul(ul, f)), sub(lane.to, mul(ul, f)), lane.to);
    }
    return pts;
  });
}

/** Points along a chain of cubic pieces, close enough together to hit and to outline. */
export function flatten(chain: V[], per = 6): V[] {
  const out: V[] = [chain[0]];
  for (let i = 1; i + 2 < chain.length; i += 3) {
    const p0 = chain[i - 1], c1 = chain[i], c2 = chain[i + 1], p1 = chain[i + 2];
    const straight = Math.abs(cross(sub(c1, p0), sub(p1, p0))) < 1e-9 && Math.abs(cross(sub(c2, p0), sub(p1, p0))) < 1e-9;
    const n = straight ? 1 : per;
    for (let s = 1; s <= n; s++) {
      const t = s / n, mt = 1 - t;
      out.push([
        mt * mt * mt * p0[0] + 3 * mt * mt * t * c1[0] + 3 * mt * t * t * c2[0] + t * t * t * p1[0],
        mt * mt * mt * p0[1] + 3 * mt * mt * t * c1[1] + 3 * mt * t * t * c2[1] + t * t * t * p1[1],
      ]);
    }
  }
  return out;
}

/** How far q is from a run of straight pieces. */
export function distToPolyline(q: V, pts: V[]): number {
  let best = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], b = pts[i + 1], ab = sub(b, a);
    const t = Math.max(0, Math.min(1, dot(sub(q, a), ab) / (dot(ab, ab) || 1)));
    best = Math.min(best, len(sub(q, add(a, mul(ab, t)))));
  }
  return best;
}
