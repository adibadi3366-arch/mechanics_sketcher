// Laying out devices that a connection list brought in: each goes beside
// the device it has the most wires to, on the side of the port they are
// wired to, turned so its own port faces back. Where it can, a bundle then
// runs straight, with its wires in order; where a part would land on another,
// it slides along until it is clear.

import type { V } from "../geom";
import type { Circuit, Device, PartDef, WireEnd, Side } from "./model";
import { partOf, deviceById, keyedEnds, bundleKey } from "./model";
import { place, turnDir, type Placing } from "./art";
import { deviceBox, deviceFootprint, placing, tagLength } from "./figure";
import { leftOf, type Box } from "./route";

const SIDE_OUT: Record<Side, V> = { top: [0, 1], bottom: [0, -1], left: [-1, 0], right: [1, 0] };
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1];
const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1]];
const mul = (a: V, k: number): V => [a[0] * k, a[1] * k];
/** Room between the tags at the two ends of a bundle that runs straight, in mm. */
const RUN = 9;
/** Room kept round every device and its tags, in mm. */
const CLEAR = 0.9;

interface Link { a: WireEnd; b: WireEnd; pins: [string, string][] }

/** A pin of a part where a device with that placing puts it. */
function pinAt(part: PartDef, at: Placing, x: number, y: number): V {
  return place([x - part.w / 2, part.h / 2 - y], at);
}

const centroid = (pts: V[]): V => mul(pts.reduce((s, p) => add(s, p), [0, 0] as V), 1 / Math.max(1, pts.length));
const overlaps = (a: Box, b: Box, m: number) => a.x0 < b.x1 + m && a.x1 > b.x0 - m && a.y0 < b.y1 + m && a.y1 > b.y0 - m;
const hasText = (p: PartDef) => !p.shapes || p.shapes.some((s) => s.type === "text");

/** How far a box reaches from its middle along a direction of the axes. */
const reach = (b: Box, u: V) => (u[0] > 0.5 ? b.x1 : u[0] < -0.5 ? -b.x0 : u[1] > 0.5 ? b.y1 : -b.y0);

/** Places the devices with these ids; the others stay where they are. */
export function autoPlace(c: Circuit, ids: string[]): void {
  const todo = new Set(ids.filter((id) => deviceById(c, id)));
  if (!todo.size) return;
  const placed = new Set(c.devices.filter((d) => !todo.has(d.id)).map((d) => d.id));
  // The wires between two ports, each pair of ports once.
  const links = new Map<string, Link>();
  for (const w of c.wires) {
    const k = bundleKey(w);
    const [a, b] = keyedEnds(w);
    const l = links.get(k) ?? { a, b, pins: [] };
    l.pins.push([a.pin, b.pin]);
    links.set(k, l);
  }
  const count = (id: string) => [...links.values()].reduce((n, l) => n + (l.a.dev === id || l.b.dev === id ? l.pins.length : 0), 0);
  if (!placed.size) {
    // The device most is wired to goes in the middle, upright.
    const first = [...todo].sort((x, y) => count(y) - count(x))[0];
    const d = deviceById(c, first)!;
    Object.assign(d, { x: 0, y: 0, turn: 0 });
    delete d.flip;
    todo.delete(first);
    placed.add(first);
  }
  while (todo.size) {
    // Next, the device with the most wires to one already placed.
    let best: { id: string; link: Link; n: number } | null = null;
    for (const l of links.values()) {
      const ends: [string, string][] = [[l.a.dev, l.b.dev], [l.b.dev, l.a.dev]];
      for (const [mine, theirs] of ends) {
        if (todo.has(mine) && placed.has(theirs) && (!best || l.pins.length > best.n)) best = { id: mine, link: l, n: l.pins.length };
      }
    }
    if (!best) {
      // Wired to nothing placed: under everything, in a row.
      const id = [...todo][0];
      parkBelow(c, deviceById(c, id)!, placed);
      todo.delete(id);
      placed.add(id);
      continue;
    }
    placeBeside(c, deviceById(c, best.id)!, best.link, placed);
    todo.delete(best.id);
    placed.add(best.id);
  }
}

function parkBelow(c: Circuit, d: Device, placed: Set<string>): void {
  const part = partOf(c, d);
  if (!part) return;
  let x0 = Infinity, y0 = Infinity;
  for (const id of placed) {
    const o = deviceById(c, id)!, p = partOf(c, o);
    if (!p) continue;
    const b = deviceBox(p, placing(o));
    x0 = Math.min(x0, b.x0); y0 = Math.min(y0, b.y0);
  }
  if (!Number.isFinite(x0)) { x0 = 0; y0 = 0; }
  Object.assign(d, { x: x0 + part.w / 2, y: y0 - 15 - part.h / 2, turn: 0 });
  delete d.flip;
  slide(c, d, part, [1, 0], placed);
}

/** Moves a device along `acr` until it is clear of the devices placed, trying both ways, nearest first. How far it moved. */
function slide(c: Circuit, d: Device, part: PartDef, acr: V, placed: Set<string>): number {
  const boxes = [...placed].map((id) => { const o = deviceById(c, id)!; const p = partOf(c, o)!; return deviceFootprint(p, placing(o)); });
  const x = d.x, y = d.y;
  for (let k = 0; k < 400; k++) {
    const t = (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 2;
    d.x = x + acr[0] * t;
    d.y = y + acr[1] * t;
    const b = deviceFootprint(part, placing(d));
    if (!boxes.some((o) => overlaps(b, o, CLEAR))) return Math.abs(t);
  }
  d.x = x; d.y = y;
  return 0;
}

/** Places a device beside the one it is wired to by `link`, in the way that costs least. */
function placeBeside(c: Circuit, d: Device, link: Link, placed: Set<string>): void {
  const mineIsA = link.a.dev === d.id;
  const meEnd = mineIsA ? link.a : link.b, otherEnd = mineIsA ? link.b : link.a;
  const other = deviceById(c, otherEnd.dev)!;
  const op = partOf(c, other), mp = partOf(c, d);
  const oport = op?.ports.find((p) => p.name === otherEnd.port), mport = mp?.ports.find((p) => p.name === meEnd.port);
  if (!op || !mp || !oport || !mport) return parkBelow(c, d, placed);
  const oat = placing(other);
  const uP = turnDir(SIDE_OUT[oport.side], oat);
  const acr = leftOf(uP);
  const oPins = new Map(oport.pins.map((q) => [q.name, pinAt(op, oat, q.x, q.y)]));
  const cP = centroid([...oPins.values()]);
  const oBox = deviceBox(op, oat);
  const edge = add(cP, mul(uP, reach(oBox, uP) - dot(cP, uP)));
  const tagP = oport.kind === "plug" ? tagLength(oport.pins.map((q) => q.name)) : 0;
  const tagD = mport.kind === "plug" ? tagLength(mport.pins.map((q) => q.name)) : 0;
  const pairs = link.pins.map(([x, y]) => (mineIsA ? [y, x] : [x, y]) as [string, string]);
  const text = hasText(mp);

  let best: { turn: 0 | 1 | 2 | 3; flip: boolean; x: number; y: number; cost: number } | null = null;
  for (const flip of [false, true]) {
    for (const turn of [0, 1, 2, 3] as const) {
      const at: Placing = { turn, flip, by: [0, 0] };
      const uD = turnDir(SIDE_OUT[mport.side], at);
      const facing = dot(uD, uP) < -0.5, same = dot(uD, uP) > 0.5;
      const rel = centroid(mport.pins.map((q) => pinAt(mp, at, q.x, q.y)));
      const box0 = deviceBox(mp, at);
      const back = reach(box0, mul(uP, -1));
      let centre: V;
      if (facing) {
        // Straight across from the port, its own port lined up with it.
        centre = add(add(edge, mul(uP, tagP + tagD + RUN + back)), mul(acr, -dot(rel, acr)));
      } else if (same) {
        // Beside the device, its port level with the other's: the bundle runs out and over.
        const side = dot(add(cP, mul([other.x, other.y], -1)), acr) >= 0 ? 1 : -1;
        const half = reach(oBox, mul(acr, side)) - side * dot([other.x, other.y], acr);
        const off = side * (half + reach(box0, mul(acr, -side)) + 10);
        centre = add(add([other.x, other.y], mul(acr, off)), mul(uP, dot(edge, uP) - dot([other.x, other.y], uP) - dot(rel, uP)));
      } else {
        // In front, to one side: the bundle runs out, turns, and goes in from the side.
        centre = add(add(edge, mul(uP, tagP + RUN + back + 4)), mul(acr, -dot(uD, acr) * (tagD + RUN) - dot(rel, acr)));
      }
      const trial: Device = { ...d, x: centre[0], y: centre[1], turn, flip };
      const moved = slide(c, trial, mp, facing ? acr : uP, placed);
      let cost = (facing ? 0 : same ? 6 : 4) + (flip ? 1 : 0) + (turn === 2 ? (text ? 9 : 1) : turn % 2 ? (text ? 4 : 1) : 0) + moved * 0.15;
      if (facing) {
        // Wires that would cross on their way across.
        const tat = placing(trial);
        const ts = pairs.map(([po, pm]) => {
          const a = oPins.get(po), q = mport.pins.find((x) => x.name === pm);
          return a && q ? [dot(a, acr), dot(pinAt(mp, tat, q.x, q.y), acr)] : null;
        }).filter((t): t is number[] => !!t);
        let inv = 0;
        for (let i = 0; i < ts.length; i++) for (let j = i + 1; j < ts.length; j++) if ((ts[i][0] - ts[j][0]) * (ts[i][1] - ts[j][1]) < 0) inv++;
        cost += inv * 3;
      }
      if (!best || cost < best.cost - 1e-9) best = { turn, flip, x: trial.x, y: trial.y, cost };
    }
  }
  if (!best) return;
  // Not on the grid: lined up exactly with the port, so the bundle runs dead straight.
  d.x = Math.round(best.x * 1000) / 1000;
  d.y = Math.round(best.y * 1000) / 1000;
  d.turn = best.turn;
  if (best.flip) d.flip = true;
  else delete d.flip;
  delete d.cap;
}

