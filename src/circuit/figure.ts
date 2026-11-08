// The guide laid out and drawn: where every device, tag and wire is, and the
// primitives that draw them, in mm on the guide with y up. The screen draws
// these, and the export writes them, enlarged to their size on paper.

import type { V } from "../geom";
import { type Prim, buildPrims, sansTex } from "../prims";
import { texEngine } from "../tex";
import { unitScale } from "../model";
import { splitDrawing, activePart, mergeDrawing } from "../parts";
import { figureBounds } from "../export";
import {
  type Circuit, type Device, type PartDef, type PortDef, type Wire, type WireEnd, type Side, type GuideText,
  partOf, deviceById, bundleKey, keyedEnds, wireColor, pinKind, casingOf, darken, lighten, wireDoubt,
} from "./model";
import { type Placing, shapePrims, placePrims, place, turnDir, textPrim, roundRect, C } from "./art";
import { type Box, type Lane, autoRoute, pathThrough, tidyPath, laneChains, flatten, leftOf } from "./route";

/** Pin tags: how tall, how far apart, and the size of their text, in mm. */
export const TAG = { w: 1.2, pitch: 1.35, font: 0.86, gap: 0.5, min: 3.4, pad: 0.9 } as const;
/** How much thicker than its wire a wire's darker edge is, in mm. */
const CASING = 0.28;
/** The corner radius of a bundle beyond the half of its width, in mm. */
const TURN = 1.3;
/** Caption text, in mm. */
export const CAPTION = { size: 2.7, line: 1.22 } as const;

const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1]];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1]];
const mul = (a: V, k: number): V => [a[0] * k, a[1] * k];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1];

const SIDE_OUT: Record<Side, V> = { top: [0, 1], bottom: [0, -1], left: [-1, 0], right: [1, 0] };

// ---- the drawing of a part ---------------------------------------------------------------

const drawn = new WeakMap<PartDef, Prim[]>();

/** The drawing of a part about its middle, y up. Kept, so a part is drawn once however often it is placed. */
export function partPrims(part: PartDef): Prim[] {
  const had = drawn.get(part);
  if (had) return had;
  let prims: Prim[] = [];
  if (part.shapes) prims = shapePrims(part.shapes, part.w, part.h);
  else if (part.sketch) {
    const fig = sketchPrims(part.sketch);
    const b = part.box ?? fig.box;
    const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
    prims = placePrims(fig.prims, { turn: 0, by: [-cx, -cy] });
  }
  drawn.set(part, prims);
  return prims;
}

/** Forgets the drawing kept for a part, after it was changed in place. */
export function redrawPart(part: PartDef): void {
  drawn.delete(part);
}

/** A drawing made in the sketcher, as its figure is exported: in mm of what it is dimensioned in, y up. */
export function sketchPrims(sk: import("../model").Sketch): { prims: Prim[]; box: Box } {
  const d = splitDrawing(sk);
  const fig = mergeDrawing(d, activePart(d).sk, true);
  const prims = buildPrims(fig, unitScale(fig), { editor: false });
  const b = figureBounds(prims);
  const box = Number.isFinite(b.x0) ? { x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1 } : { x0: -5, y0: -5, x1: 5, y1: 5 };
  return { prims, box };
}

// ---- where things are -------------------------------------------------------------------

export interface PinPlace {
  name: string;
  /** Where the pin itself is. */
  at: V;
  /** Where its wire starts: the far end of its tag, or the pin itself for a pad. */
  anchor: V;
  tag?: TagPlace;
  /** How far inside the device's box the pin is, back from the edge its wires leave by. */
  inside: number;
}

export interface TagPlace {
  dev: Device;
  port: string;
  pin: string;
  /** The ends of the tag along its middle: at the part, and away from it. */
  s: V;
  e: V;
  box: Box;
  vertical: boolean;
  /** Whether a wire is attached. */
  wired: boolean;
}

export interface PortPlace {
  dev: Device;
  part: PartDef;
  port: PortDef;
  /** The way its wires leave. */
  out: V;
  pins: PinPlace[];
  tagLen: number;
}

export interface DevicePlace {
  dev: Device;
  part: PartDef;
  at: Placing;
  /** Its box on the guide. */
  box: Box;
  ports: PortPlace[];
}

export interface BundlePlace {
  key: string;
  a: PortPlace;
  b: PortPlace;
  wires: Wire[];
  /** The middle of the bundle, with corners that do not turn taken out. */
  path: V[];
  /** The same as laid, corner by corner, and the places across their run of its middle stretches. */
  raw: V[];
  places: number[];
  /** The pins at the two ends of each wire, in the order of `wires`. */
  ends: [PinPlace, PinPlace][];
  /** Whether it was laid by hand, not found. */
  manual: boolean;
  /** One chain of cubic pieces for each wire, in the order of `wires`. */
  chains: V[][];
  /** The same, as points close together: for hitting and outlining. */
  lines: V[][];
  width: number;
  /** Drawn over the parts: wires soldered onto pads run over the board to them. */
  over: boolean;
}

export interface Layout {
  devices: DevicePlace[];
  bundles: BundlePlace[];
  tags: TagPlace[];
  /** What could not be drawn, said for the person to fix. */
  problems: string[];
}

/** How a device holds its part. */
export const placing = (d: Device): Placing => ({ turn: d.turn, flip: d.flip, by: [d.x, d.y] });

/** A point of the part's own drawing (its mm, y down) where it is on the guide. */
export function partPoint(part: PartDef, at: Placing, x: number, y: number): V {
  return place([x - part.w / 2, part.h / 2 - y], at);
}

/** The box a device takes on the guide. */
export function deviceBox(part: PartDef, at: Placing): Box {
  const a = place([-part.w / 2, -part.h / 2], at), b = place([part.w / 2, part.h / 2], at);
  return { x0: Math.min(a[0], b[0]), y0: Math.min(a[1], b[1]), x1: Math.max(a[0], b[0]), y1: Math.max(a[1], b[1]) };
}

const tagWidths = new Map<string, number>();
/** How long a tag with this name is, in mm. */
export function tagLength(names: string[]): number {
  let w: number = TAG.min;
  for (const n of names) {
    let em = tagWidths.get(n);
    if (em === undefined) {
      em = texEngine().measure(sansTex(n, true)).w;
      tagWidths.set(n, em);
    }
    w = Math.max(w, em * TAG.font + TAG.pad);
  }
  return Math.round(w * 20) / 20;
}

/** The ends that are wired, by device, port and pin. */
const endKey = (e: WireEnd) => `${e.dev}\u0000${e.port}\u0000${e.pin}`;

function placePorts(dp: DevicePlace, wired: Set<string>): void {
  const { dev, part, at } = dp;
  for (const port of part.ports) {
    const out = turnDir(SIDE_OUT[port.side], at);
    const pins = port.pins.map((p) => ({ name: p.name, at: partPoint(part, at, p.x, p.y) }));
    const tagLen = port.kind === "plug" ? tagLength(port.pins.map((p) => p.name)) : 0;
    const pp: PortPlace = { dev, part, port, out, pins: [], tagLen };
    if (port.kind === "plug") {
      // The tags start just off the edge of the device, side by side, in the order of the pins along it.
      const acr = leftOf(out);
      const order = pins.map((p, i) => ({ p, i, t: dot(p.at, acr) })).sort((x, y) => x.t - y.t || x.i - y.i);
      const mid = order.reduce((s, o) => s + o.t, 0) / order.length;
      const b = dp.box;
      const edge = out[0] > 0.5 ? b.x1 : out[0] < -0.5 ? -b.x0 : out[1] > 0.5 ? b.y1 : -b.y0;
      const depth = edge + TAG.gap;
      const vertical = Math.abs(out[1]) > 0.5;
      const placed: PinPlace[] = new Array(pins.length);
      order.forEach((o, k) => {
        const t = mid + (k - (order.length - 1) / 2) * TAG.pitch;
        const s: V = add(mul(acr, t), mul(out, depth));
        const e = add(s, mul(out, tagLen));
        const half = TAG.w / 2;
        const box: Box = vertical
          ? { x0: s[0] - half, x1: s[0] + half, y0: Math.min(s[1], e[1]), y1: Math.max(s[1], e[1]) }
          : { y0: s[1] - half, y1: s[1] + half, x0: Math.min(s[0], e[0]), x1: Math.max(s[0], e[0]) };
        const tag: TagPlace = { dev, port: port.name, pin: o.p.name, s, e, box, vertical, wired: wired.has(endKey({ dev: dev.id, port: port.name, pin: o.p.name })) };
        placed[o.i] = { name: o.p.name, at: o.p.at, anchor: e, tag, inside: 0 };
      });
      pp.pins = placed;
    } else {
      const b = dp.box;
      pp.pins = pins.map((p) => ({
        ...p, anchor: p.at,
        inside: out[0] > 0.5 ? b.x1 - p.at[0] : out[0] < -0.5 ? p.at[0] - b.x0 : out[1] > 0.5 ? b.y1 - p.at[1] : p.at[1] - b.y0,
      }));
    }
    dp.ports.push(pp);
  }
}

/** What a device takes on the guide with its tags: its box, grown to cover them. */
export function deviceFootprint(part: PartDef, at: Placing): Box {
  const dev: Device = { id: "", part: part.id, name: "", x: at.by[0], y: at.by[1], turn: (((at.turn % 4) + 4) % 4) as 0 | 1 | 2 | 3, ...(at.flip ? { flip: true } : {}) };
  const dp: DevicePlace = { dev, part, at, box: deviceBox(part, at), ports: [] };
  placePorts(dp, new Set());
  const b = { ...dp.box };
  for (const p of dp.ports) for (const q of p.pins) {
    if (!q.tag) continue;
    b.x0 = Math.min(b.x0, q.tag.box.x0); b.y0 = Math.min(b.y0, q.tag.box.y0);
    b.x1 = Math.max(b.x1, q.tag.box.x1); b.y1 = Math.max(b.y1, q.tag.box.y1);
  }
  return b;
}

/** Where every device, tag and wire of the guide is. */
export function layout(c: Circuit): Layout {
  const problems: string[] = [];
  const wired = new Set<string>();
  for (const w of c.wires) { wired.add(endKey(w.a)); wired.add(endKey(w.b)); }
  const devices: DevicePlace[] = [];
  const byId = new Map<string, DevicePlace>();
  for (const dev of c.devices) {
    const part = partOf(c, dev);
    if (!part) continue;
    const at = placing(dev);
    const dp: DevicePlace = { dev, part, at, box: deviceBox(part, at), ports: [] };
    placePorts(dp, wired);
    devices.push(dp);
    byId.set(dev.id, dp);
  }
  const tags = devices.flatMap((d) => d.ports.flatMap((p) => p.pins.map((q) => q.tag).filter((t): t is TagPlace => !!t)));

  // The wires, gathered into bundles: every wire between the same two ports.
  const groups = new Map<string, Wire[]>();
  for (const w of c.wires) {
    const k = bundleKey(w);
    const g = groups.get(k);
    if (g) g.push(w);
    else groups.set(k, [w]);
  }
  const boxes = devices.map((d) => d.box);
  const bundles: BundlePlace[] = [];
  for (const [key, ws] of groups) {
    const [ea] = keyedEnds(ws[0]);
    const eb = keyedEnds(ws[0])[1];
    const da = byId.get(ea.dev), db = byId.get(eb.dev);
    const pa = da?.ports.find((p) => p.port.name === ea.port), pb = db?.ports.find((p) => p.port.name === eb.port);
    if (!da || !db || !pa || !pb) {
      problems.push(`${ws.length === 1 ? "A wire goes" : `${ws.length} wires go`} to a port that is not there: ${describeEnd(c, !pa ? ea : eb)}.`);
      continue;
    }
    if (pa === pb) {
      problems.push(`A wire runs from ${describeEnd(c, ea)} back to the same port: it is not drawn.`);
      continue;
    }
    const lanes: Lane[] = [];
    const kept: Wire[] = [];
    const ends: [PinPlace, PinPlace][] = [];
    for (const w of ws) {
      const [x, y] = keyedEnds(w);
      const fa = pa.pins.find((p) => p.name === x.pin), fb = pb.pins.find((p) => p.name === y.pin);
      if (!fa || !fb) {
        problems.push(`A wire goes to a pin that is not there: ${describeEnd(c, !fa ? x : y)}.`);
        continue;
      }
      const doubt = wireDoubt(x.pin, y.pin);
      if (doubt) problems.push(`Check ${describeEnd(c, x)} to ${describeEnd(c, y)}: ${doubt}.`);
      lanes.push({ from: fa.anchor, to: fb.anchor });
      kept.push(w);
      ends.push([fa, fb]);
    }
    if (!kept.length) continue;
    const width = Math.max(pa.port.wire ?? c.look.wire, pb.port.wire ?? c.look.wire);
    const s = centroid(lanes.map((l) => l.from)), e = centroid(lanes.map((l) => l.to));
    const ua = pa.out, ub = pb.out;
    const acrA = leftOf(ua);
    const offs = lanes.map((l) => dot(sub(l.from, s), acrA));
    const half = Math.max(0, ...offs.map(Math.abs)) + width / 2 + CASING / 2;
    const r = c.look.corners === "round" ? half + TURN : 0;
    // A pad's wire leaves along the board before it may turn; a tag already stands clear of it.
    const leadA = r + 1 + (pa.port.kind === "pads" ? padDepth(da, pa) : 0);
    const leadB = r + 1 + 2.5 + (pb.port.kind === "pads" ? padDepth(db, pb) : 0);
    const stored = c.routes[key];
    let places = stored ?? [];
    let raw = stored ? pathThrough(s, ua, e, ub, stored) : null;
    const manual = !!raw;
    if (!raw) {
      places = autoRoute(s, ua, e, ub, { leadA, leadB, half, boxes, ownA: devices.indexOf(da), ownB: devices.indexOf(db) });
      raw = pathThrough(s, ua, e, ub, places);
      if (!raw) { places = []; raw = [s, e]; }
    }
    let path = tidyPath(raw);
    if (path.length < 2) path = [s, add(s, mul(ua, 0.001))];
    const chains = laneChains(path, lanes, r);
    bundles.push({
      key, a: pa, b: pb, wires: kept, path, raw, places, ends, manual, chains, lines: chains.map((ch) => flatten(ch)), width,
      over: pa.port.kind === "pads" || pb.port.kind === "pads",
    });
  }
  return { devices, bundles, tags, problems };
}

const centroid = (pts: V[]): V => mul(pts.reduce((s, p) => add(s, p), [0, 0] as V), 1 / Math.max(1, pts.length));

/** How far inside the device's box a port's pads are: the wire runs that far before it is clear of the board. */
function padDepth(d: DevicePlace, p: PortPlace): number {
  const b = d.box, o = p.out;
  let deepest = 0;
  for (const q of p.pins) {
    const edge = o[0] > 0.5 ? b.x1 - q.at[0] : o[0] < -0.5 ? q.at[0] - b.x0 : o[1] > 0.5 ? b.y1 - q.at[1] : q.at[1] - b.y0;
    deepest = Math.max(deepest, edge);
  }
  return deepest;
}

/** A wire end as a person reads it: device, port, pin. */
export function describeEnd(c: Circuit, e: WireEnd): string {
  const d = deviceById(c, e.dev);
  return `${d?.name ?? "?"} ${e.port} ${e.pin}`.replace(/\s+/g, " ").trim();
}

// ---- drawing it ------------------------------------------------------------------------------

/** The guide, in layers: wires under the parts, the parts, wires over them, the tags and the text. */
export interface GuideLayers {
  under: Prim[];
  /** Each device's drawing, placed. */
  parts: { dev: Device; prims: Prim[] }[];
  over: Prim[];
  tags: Prim[];
  text: Prim[];
}

/** The colours a tag is drawn in. */
export function tagColors(name: string, wired: boolean): { fill: string | null; text: string; edge: string | null } {
  const k = pinKind(name);
  if (wired) return { fill: k.bg, text: k.fg, edge: null };
  // A pin with nothing on it: outlined in its colour, a yellow one a shade darker so it reads on white.
  const line = k.bg === "#f2b400" ? "#c99500" : k.bg;
  return { fill: "#ffffff", text: darken(line, 0.12), edge: line };
}

/** A pin's tag. */
export function tagPrims(t: TagPlace, name: string): Prim[] {
  const col = tagColors(name, t.wired);
  const out: Prim[] = [];
  const { x0, y0, x1, y1 } = t.box;
  if (col.fill) out.push({ k: "region", layer: "sym", outlines: [roundRect(x0, y0, x1, y1, 0.25)], color: col.edge ? col.edge : col.fill });
  // An outlined tag is a coloured box with a white one inside it.
  if (col.edge) out.push({ k: "region", layer: "sym", outlines: [roundRect(x0 + 0.16, y0 + 0.16, x1 - 0.16, y1 - 0.16, 0.12)], color: col.fill ?? "#ffffff" });
  out.push(textPrim([(x0 + x1) / 2, (y0 + y1) / 2], name, TAG.font, col.text, true, "middle", t.vertical ? Math.PI / 2 : 0));
  return out;
}

/** The guide drawn. Without `parts`, the parts are left for the caller to draw: the screen keeps each drawn once. */
export function guideLayers(c: Circuit, L: Layout, parts = true): GuideLayers {
  const under: Prim[] = [], over: Prim[] = [], tags: Prim[] = [], text: Prim[] = [];
  for (const b of L.bundles) {
    const into = b.over ? over : under;
    const cols = b.wires.map(wireColor);
    if (c.look.casing) b.chains.forEach((ch, i) => into.push({ k: "bezier", layer: "sym", pts: ch, stroke: "member", width: b.width + CASING, ink: casingOf(cols[i]) }));
    b.chains.forEach((ch, i) => into.push({ k: "bezier", layer: "sym", pts: ch, stroke: "member", width: b.width, ink: cols[i] === "#1c1c1c" ? "#2d2f31" : cols[i] }));
    // Where a wire is soldered onto a pad on the board, a drop of solder.
    for (const [end, port] of [[0, b.a], [1, b.b]] as [0 | 1, PortPlace][]) {
      if (port.port.kind !== "pads") continue;
      for (const [i, ch] of b.chains.entries()) {
        if (b.ends[i][end].inside < 0.3) continue;
        const at = end === 0 ? ch[0] : ch[ch.length - 1];
        over.push({ k: "region", layer: "sym", outlines: [{ kind: "circle", c: at, r: b.width * 0.78 }], color: "#c9ced3" });
        over.push({ k: "circle", layer: "sym", c: at, r: b.width * 0.78, stroke: "member", width: 0.12, ink: "#8b939a" });
      }
    }
  }
  for (const t of L.tags) {
    if (!t.wired && c.look.unused === "hide") continue;
    tags.push(...tagPrims(t, t.pin));
  }
  // Wire notes, halfway along their wire.
  for (const b of L.bundles) b.wires.forEach((w, i) => {
    if (!w.label) return;
    const line = b.lines[i];
    const at = line[Math.floor(line.length / 2)];
    text.push(textPrim(add(at, [0, b.width / 2 + 0.9]), w.label, 1.1, C.ink, true, "middle"));
  });
  for (const d of L.devices) text.push(...captionPrims(d));
  for (const t of c.texts) text.push(...guideTextPrims(t));
  return { under, parts: parts ? L.devices.map((d) => ({ dev: d.dev, prims: placePrims(partPrims(d.part), d.at) })) : [], over, tags, text };
}

/** The caption of a device: its own, or its part's. */
export const captionOf = (d: Device, part: PartDef): string => d.caption ?? part.caption ?? "";

/**
 * Where a device's caption is, from its middle: where it was put, or else on
 * the first side of under, over, right and left that has no port, clear of
 * the device. Where every side has one, it goes past the top right corner.
 */
export function captionOffset(d: DevicePlace): V {
  if (d.dev.cap) return d.dev.cap;
  const text = captionOf(d.dev, d.part).trim();
  const lines = text.split("\n");
  const h = lines.length * CAPTION.size * CAPTION.line;
  const w = Math.max(0, ...lines.map((l) => texEngine().measure(sansTex(l.trim() || " ", true)).w * CAPTION.size));
  const b = d.box, cx = d.dev.x, cy = d.dev.y;
  const used = new Set(d.ports.map((p) => (p.out[1] < -0.5 ? "bottom" : p.out[1] > 0.5 ? "top" : p.out[0] > 0.5 ? "right" : "left")));
  const gap = 1.6;
  if (!used.has("bottom")) return [0, b.y0 - cy - gap - h / 2];
  if (!used.has("top")) return [0, b.y1 - cy + gap + h / 2];
  if (!used.has("right")) return [b.x1 - cx + gap + w / 2, 0];
  if (!used.has("left")) return [b.x0 - cx - gap - w / 2, 0];
  return [b.x1 - cx + w / 2 + 1, b.y1 - cy + h / 2 + 1];
}

export function captionPrims(d: DevicePlace): Prim[] {
  const text = captionOf(d.dev, d.part).trim();
  if (!text) return [];
  const off = captionOffset(d);
  return linesPrims([d.dev.x + off[0], d.dev.y + off[1]], text, CAPTION.size, true, C.ink, "middle");
}

/** Text in lines, the middle of the block at `at`, or its left or right edge there. */
function linesPrims(at: V, text: string, size: number, bold: boolean, color: string, align: "start" | "middle" | "end"): Prim[] {
  const lines = text.split("\n");
  const step = size * CAPTION.line;
  const out: Prim[] = [];
  lines.forEach((line, i) => {
    if (line.trim()) out.push(textPrim([at[0], at[1] + ((lines.length - 1) / 2 - i) * step], line.trim(), size, color, bold, align));
  });
  return out;
}

export function guideTextPrims(t: GuideText): Prim[] {
  return linesPrims([t.x, t.y], t.text, t.size, !!t.bold, t.color ?? C.ink, t.align ?? "start");
}

/** Every primitive of the guide, in the order they are drawn. */
export function guidePrims(c: Circuit, L: Layout = layout(c)): Prim[] {
  const g = guideLayers(c, L);
  return [...g.under, ...g.parts.flatMap((p) => p.prims), ...g.over, ...g.tags, ...g.text];
}

/** A colour a little lighter, for what is selected or under the pointer. */
export const glow = (hex: string) => lighten(hex, 0.35);
