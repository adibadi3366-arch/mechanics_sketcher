// How parts are drawn: the shapes of a part's drawing turned into the
// primitives every figure is drawn from, so the screen, SVG and TikZ all show
// the same. A part is drawn about its middle with y up; a device turns and
// moves that drawing to where it is on the guide.

import type { V } from "../geom";
import { type Prim, type TextPrim, type Outline, type OutlineSeg, PAPER, sansTex, sansLatex, strokeWidth } from "../prims";
import type { Shape, Side, ConnectorStyle } from "./model";

/** The colours boards are drawn in. */
export const C = {
  board: "#262a30", boardEdge: "#121417", boardLine: "#33383e", silk: "#eef0f1",
  gold: "#d8b660", goldDark: "#a8883c", cream: "#f3eee3", creamDark: "#b9af99", creamShade: "#e2dbcc",
  slot: "#34363a", silver: "#d2d7db", silverMid: "#b3babf", silverDark: "#8b939a",
  ic: "#363b41", icEdge: "#1b1e21", icText: "#9aa3ab", leg: "#bfc6cc",
  cap: "#c9a173", res: "#2b2b2b", end: "#dde1e4", paper: "#ffffff", ink: "#16191c",
  header: "#2b2d30", headerPin: "#c8ced3",
} as const;

/** A tenth of a micrometre: anything shorter is nothing. */
const EPS = 1e-7;

/**
 * The colour a shape names as a primitive takes it: "ink" is the black every
 * figure is drawn in, which a primitive has when it names no colour at all.
 */
const inkOf = (color: string | undefined): { ink?: string } => (!color || color === "ink" ? {} : { ink: color });
/** The style a shape is stroked in: the figure's ink runs in its standard line, so a circuit diagram's TikZ reads plainly. */
const strokeOf = (color: string | undefined) => (color === "ink" ? "member" as const : "symbol" as const);
/** What marks a text primitive that stays upright when its part is turned. */
export const UPRIGHT = "upright";

/** Builds the primitives of a part, about the middle of its w × h box, y up. */
export class Pen {
  readonly out: Prim[] = [];
  constructor(private w: number, private h: number) {}

  /** A point of the part (mm, y down from its top left) about its middle, y up. */
  at(x: number, y: number): V {
    return [x - this.w / 2, this.h / 2 - y];
  }

  fillPath(outline: Outline, color: string): void {
    this.out.push({ k: "region", layer: "sym", outlines: [outline], color });
  }

  /** A box with corners rounded by r: filled, outlined, or both. */
  rect(x: number, y: number, w: number, h: number, o: { r?: number; fill?: string; stroke?: string; width?: number } = {}): void {
    if (w <= EPS || h <= EPS) return;
    const r = Math.max(0, Math.min(o.r ?? 0, w / 2, h / 2));
    const [x0, y1] = this.at(x, y), [x1, y0] = this.at(x + w, y + h);
    if (o.fill) this.fillPath(roundRect(x0, y0, x1, y1, r), o.fill === "ink" ? "#000000" : o.fill);
    if (o.stroke && (o.width ?? 0.15) > 0) {
      // The outline runs along the middle of the edge, as SVG draws it. Square corners need no curves.
      if (r <= EPS) this.out.push({ k: "path", layer: "sym", pts: [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]], stroke: strokeOf(o.stroke), width: o.width ?? 0.15, ...inkOf(o.stroke) });
      else this.out.push({ k: "bezier", layer: "sym", pts: roundRectChain(x0, y0, x1, y1, r), stroke: strokeOf(o.stroke), width: o.width ?? 0.15, ...inkOf(o.stroke) });
    }
  }

  circle(x: number, y: number, r: number, o: { fill?: string; stroke?: string; width?: number } = {}): void {
    if (r <= EPS) return;
    const c = this.at(x, y);
    if (o.fill === "ink") {
      // A dot in the figure's ink, with an outline of the same.
      this.out.push({ k: "circle", layer: "sym", c, r, stroke: strokeOf(o.stroke), width: o.width ?? 0.15, fill: "ink", ...inkOf(o.stroke) });
      return;
    }
    if (o.fill) this.fillPath({ kind: "circle", c, r }, o.fill);
    if (o.stroke && (o.width ?? 0.15) > 0) this.out.push({ k: "circle", layer: "sym", c, r, stroke: strokeOf(o.stroke), width: o.width ?? 0.15, ...inkOf(o.stroke) });
  }

  line(points: [number, number][], o: { stroke?: string; width?: number; dash?: number[] } = {}): void {
    if (points.length < 2) return;
    this.out.push({
      k: "path", layer: "sym", pts: points.map(([x, y]) => this.at(x, y)), stroke: strokeOf(o.stroke), width: o.width ?? 0.15, ...inkOf(o.stroke ?? C.ink),
      ...(o.dash?.length ? { dash: o.dash } : {}),
    });
  }

  polygon(points: [number, number][], o: { fill?: string; stroke?: string; width?: number } = {}): void {
    if (points.length < 3) return;
    const pts = points.map(([x, y]) => this.at(x, y));
    if (o.fill === "ink") {
      // Filled with the figure's ink: an arrowhead, a solid triangle.
      this.out.push({ k: "poly", layer: "sym", pts, stroke: strokeOf(o.stroke), width: o.width ?? 0.15, fill: "ink", ...inkOf(o.stroke) });
      return;
    }
    if (o.fill) this.fillPath({ kind: "path", start: pts[0], segs: [...pts.slice(1), pts[0]].map((to) => ({ k: "L", to }) as OutlineSeg) }, o.fill);
    if (o.stroke) this.out.push({ k: "path", layer: "sym", pts: [...pts, pts[0]], stroke: strokeOf(o.stroke), width: o.width ?? 0.15, ...inkOf(o.stroke) });
  }

  /** From `start` to `end` degrees, counter-clockwise as seen. */
  arc(x: number, y: number, r: number, start: number, end: number, o: { stroke?: string; width?: number } = {}): void {
    let a0 = (start * Math.PI) / 180, a1 = (end * Math.PI) / 180;
    while (a1 <= a0) a1 += 2 * Math.PI;
    this.out.push({ k: "arc", layer: "sym", c: this.at(x, y), r, a0, a1, stroke: strokeOf(o.stroke), width: o.width ?? 0.15, ...inkOf(o.stroke ?? C.ink) });
  }

  /** Text centred on (x, y), or starting or ending there; turned `rot` degrees counter-clockwise. */
  text(x: number, y: number, text: string, o: { size?: number; color?: string; bold?: boolean; align?: "start" | "middle" | "end"; rot?: number; math?: boolean; upright?: boolean } = {}): void {
    const t = text.trim();
    if (!t) return;
    const rot = ((o.rot ?? 0) * Math.PI) / 180;
    const align = o.align ?? "middle";
    const prim: TextPrim = o.math
      // Math, set as a figure's labels are: the letter in a meter, the sign of a gate.
      ? { k: "text", layer: "sym", at: this.at(x, y), tex: t, size: o.size ?? 1.3, anchor: align === "start" ? "w" : align === "end" ? "e" : "c", ...inkOf(o.color), ...(Math.abs(rot) > 1e-9 ? { rot } : {}) }
      : textPrim(this.at(x, y), t, o.size ?? 1.3, o.color ?? C.silk, o.bold ?? true, align, rot);
    if (!o.math && o.color === "ink") delete prim.ink;
    if (o.upright) prim.part = UPRIGHT;
    this.out.push(prim);
  }
}

/** A line of sans-serif text as a primitive: on screen as MathJax sets it, in TikZ as \textsf. */
export function textPrim(at: V, text: string, size: number, color: string, bold: boolean, align: "start" | "middle" | "end", rot = 0): TextPrim {
  return {
    k: "text", layer: "sym", at, tex: sansTex(text, bold), latex: sansLatex(text, bold), size, ink: color,
    anchor: align === "start" ? "w" : align === "end" ? "e" : "c",
    ...(Math.abs(rot) > 1e-9 ? { rot } : {}),
  };
}

/** The outline of a box with rounded corners, counter-clockwise from the bottom edge, y up. */
export function roundRect(x0: number, y0: number, x1: number, y1: number, r: number): Outline {
  if (r <= EPS) {
    return { kind: "path", start: [x0, y0], segs: [{ k: "L", to: [x1, y0] }, { k: "L", to: [x1, y1] }, { k: "L", to: [x0, y1] }, { k: "L", to: [x0, y0] }] };
  }
  const q = Math.PI / 2;
  const segs: OutlineSeg[] = [
    { k: "L", to: [x1 - r, y0] },
    { k: "A", to: [x1, y0 + r], c: [x1 - r, y0 + r], r, a0: -q, a1: 0, ccw: true },
    { k: "L", to: [x1, y1 - r] },
    { k: "A", to: [x1 - r, y1], c: [x1 - r, y1 - r], r, a0: 0, a1: q, ccw: true },
    { k: "L", to: [x0 + r, y1] },
    { k: "A", to: [x0, y1 - r], c: [x0 + r, y1 - r], r, a0: q, a1: 2 * q, ccw: true },
    { k: "L", to: [x0, y0 + r] },
    { k: "A", to: [x0 + r, y0], c: [x0 + r, y0 + r], r, a0: 2 * q, a1: 3 * q, ccw: true },
  ];
  return { kind: "path", start: [x0 + r, y0], segs };
}

/** How far a cubic's controls are from its ends to draw a quarter circle: 4/3·tan(π/8). */
export const KAPPA = 0.5522847498;

/** The same outline as one chain of cubic pieces, for drawing it as a line. */
function roundRectChain(x0: number, y0: number, x1: number, y1: number, r: number): V[] {
  const pts: V[] = [];
  const straight = (a: V, b: V) => {
    if (!pts.length) pts.push(a);
    pts.push([a[0] + (b[0] - a[0]) / 3, a[1] + (b[1] - a[1]) / 3], [a[0] + (2 * (b[0] - a[0])) / 3, a[1] + (2 * (b[1] - a[1])) / 3], b);
  };
  /** A quarter circle from a to b, leaving a along u and arriving at b along v. */
  const quarter = (a: V, u: V, b: V, v: V) => {
    const k = KAPPA * r;
    pts.push([a[0] + u[0] * k, a[1] + u[1] * k], [b[0] - v[0] * k, b[1] - v[1] * k], b);
  };
  if (r <= EPS) {
    straight([x0, y0], [x1, y0]); straight([x1, y0], [x1, y1]); straight([x1, y1], [x0, y1]); straight([x0, y1], [x0, y0]);
    return pts;
  }
  straight([x0 + r, y0], [x1 - r, y0]);
  quarter([x1 - r, y0], [1, 0], [x1, y0 + r], [0, 1]);
  straight([x1, y0 + r], [x1, y1 - r]);
  quarter([x1, y1 - r], [0, 1], [x1 - r, y1], [-1, 0]);
  straight([x1 - r, y1], [x0 + r, y1]);
  quarter([x0 + r, y1], [-1, 0], [x0, y1 - r], [0, -1]);
  straight([x0, y1 - r], [x0, y0 + r]);
  quarter([x0, y0 + r], [0, -1], [x0 + r, y0], [1, 0]);
  return pts;
}

// ---- ready-made pieces of a board --------------------------------------------------------

/** Pitch, depth and how much wider than its pins a connector of each kind is, in mm. */
export const CONNECTOR: Record<ConnectorStyle, { pitch: number; depth: number; extra: number }> = {
  "jst-sh": { pitch: 1.0, depth: 4.0, extra: 3.0 },
  "jst-gh": { pitch: 1.25, depth: 4.25, extra: 3.0 },
  header: { pitch: 2.54, depth: 2.54, extra: 0 },
};

/** The box of a connector, in the part's mm, y down: its opening is on `side`, inset a little from the edge (x, y). */
export function connectorBox(x: number, y: number, side: Side, pins: number, style: ConnectorStyle = "jst-sh", pitch?: number): { x: number; y: number; w: number; h: number } {
  const k = CONNECTOR[style];
  const p = pitch ?? k.pitch;
  const W = style === "header" ? pins * p : (pins - 1) * p + k.extra, D = k.depth, ins = 0.25;
  if (side === "top") return { x: x - W / 2, y: y + ins, w: W, h: D };
  if (side === "bottom") return { x: x - W / 2, y: y - ins - D, w: W, h: D };
  if (side === "left") return { x: x + ins, y: y - W / 2, w: D, h: W };
  return { x: x - ins - D, y: y - W / 2, w: D, h: W };
}

/** Where the pins of a connector are, in order: left to right on the top and bottom, top to bottom on the sides. */
export function connectorPins(x: number, y: number, side: Side, pins: number, pitch: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < pins; i++) {
    const t = (i - (pins - 1) / 2) * pitch;
    out.push(side === "top" || side === "bottom" ? [x + t, y] : [x, y + t]);
  }
  return out;
}

function connector(pen: Pen, s: Extract<Shape, { type: "connector" }>): void {
  const style = s.style ?? "jst-sh";
  const n = Math.max(1, Math.round(s.pins));
  const pitch = s.pitch ?? CONNECTOR[style].pitch;
  const b = connectorBox(s.x, s.y, s.side, n, style, pitch);
  const along = s.side === "top" || s.side === "bottom";
  if (style === "header") {
    pen.rect(b.x, b.y, b.w, b.h, { r: 0.2, fill: C.header, stroke: "#151618", width: 0.12 });
    for (const [px, py] of connectorPins(s.x, s.y, s.side, n, pitch)) {
      const cx = along ? px : b.x + b.w / 2, cy = along ? b.y + b.h / 2 : py;
      pen.rect(cx - 0.32, cy - 0.32, 0.64, 0.64, { fill: C.headerPin });
    }
    return;
  }
  pen.rect(b.x, b.y, b.w, b.h, { r: 0.35, fill: C.cream, stroke: C.creamDark, width: 0.15 });
  // The back of the housing a shade darker.
  if (along) pen.rect(b.x + 0.2, s.side === "top" ? b.y + b.h - 1.0 : b.y + 0.2, b.w - 0.4, 0.8, { r: 0.2, fill: C.creamShade });
  else pen.rect(s.side === "left" ? b.x + b.w - 1.0 : b.x + 0.2, b.y + 0.2, 0.8, b.h - 0.4, { r: 0.2, fill: C.creamShade });
  // The opening along the outer edge, with its contacts.
  const so = 0.35, sd = 1.55;
  const sx = along ? b.x + 0.55 : s.side === "left" ? b.x + so : b.x + b.w - so - sd;
  const sy = along ? (s.side === "top" ? b.y + so : b.y + b.h - so - sd) : b.y + 0.55;
  const sw = along ? b.w - 1.1 : sd, sh = along ? sd : b.h - 1.1;
  pen.rect(sx, sy, sw, sh, { r: 0.2, fill: C.slot });
  connectorPins(s.x, s.y, s.side, n, pitch).forEach(([px, py]) => {
    if (along) pen.rect(px - 0.2, sy + 0.25, 0.4, sd - 0.5, { r: 0.08, fill: C.gold });
    else pen.rect(sx + 0.25, py - 0.2, sd - 0.5, 0.4, { r: 0.08, fill: C.gold });
  });
  if (s.mark !== false) {
    // Pin 1, marked on the silkscreen behind the housing.
    const [px, py] = connectorPins(s.x, s.y, s.side, n, pitch)[0];
    const p1: [number, number] = s.side === "top" ? [px, b.y + b.h + 0.55] : s.side === "bottom" ? [px, b.y - 0.55] : s.side === "left" ? [b.x + b.w + 0.55, py] : [b.x - 0.55, py];
    pen.circle(p1[0], p1[1], 0.22, { fill: C.silk });
  }
}

function chip(pen: Pen, s: Extract<Shape, { type: "chip" }>): void {
  const { x, y, w, h } = s;
  if (s.legs) {
    const n = Math.round(s.legs), lw = 0.18, ll = 0.45;
    for (let k = 0; k < n; k++) {
      const tx = x + ((k + 0.5) * w) / n, ty = y + ((k + 0.5) * h) / n;
      pen.rect(tx - lw / 2, y - ll, lw, ll, { fill: C.leg });
      pen.rect(tx - lw / 2, y + h, lw, ll, { fill: C.leg });
      pen.rect(x - ll, ty - lw / 2, ll, lw, { fill: C.leg });
      pen.rect(x + w, ty - lw / 2, ll, lw, { fill: C.leg });
    }
  }
  pen.rect(x, y, w, h, { r: 0.25, fill: s.fill ?? C.ic, stroke: C.icEdge, width: 0.12 });
  if (s.dot) pen.circle(x + Math.min(0.6, w / 4), y + Math.min(0.6, h / 4), Math.min(0.22, w / 8), { fill: "#575d64" });
  if (s.label) pen.text(x + w / 2, y + h / 2, s.label, { size: s.size ?? Math.min(0.8, w / Math.max(3, s.label.length * 0.75)), color: C.icText, bold: true });
}

function hole(pen: Pen, s: Extract<Shape, { type: "hole" }>): void {
  const hr = s.r ?? 1.6, rr = s.ring ?? hr + 0.8;
  pen.circle(s.x, s.y, rr, { fill: C.gold });
  pen.circle(s.x, s.y, hr, { fill: C.paper });
  pen.circle(s.x, s.y, hr + 0.12, { stroke: C.goldDark, width: 0.22 });
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4 + Math.PI / 8;
    pen.circle(s.x + Math.cos(a) * (rr - 0.38), s.y + Math.sin(a) * (rr - 0.38), 0.17, { fill: C.goldDark });
  }
}

function passive(pen: Pen, s: Extract<Shape, { type: "passive" }>): void {
  const L = 1.0, W = 0.5, body = s.kind === "r" ? C.res : C.cap;
  if (s.vertical) {
    pen.rect(s.x - W / 2, s.y - L / 2, W, L, { fill: body });
    pen.rect(s.x - W / 2, s.y - L / 2, W, 0.25, { fill: C.end });
    pen.rect(s.x - W / 2, s.y + L / 2 - 0.25, W, 0.25, { fill: C.end });
  } else {
    pen.rect(s.x - L / 2, s.y - W / 2, L, W, { fill: body });
    pen.rect(s.x - L / 2, s.y - W / 2, 0.25, W, { fill: C.end });
    pen.rect(s.x + L / 2 - 0.25, s.y - W / 2, 0.25, W, { fill: C.end });
  }
}

/** Draws the shapes of a part, w × h, about its middle with y up. */
export function shapePrims(shapes: Shape[], w: number, h: number): Prim[] {
  const pen = new Pen(w, h);
  for (const s of shapes) {
    switch (s.type) {
      case "rect": pen.rect(s.x, s.y, s.w, s.h, s); break;
      case "circle": pen.circle(s.x, s.y, s.r, s); break;
      case "line": pen.line(s.points, s); break;
      case "polygon": pen.polygon(s.points, s); break;
      case "arc": pen.arc(s.x, s.y, s.r, s.start, s.end, s); break;
      case "text": pen.text(s.x, s.y, s.text, { size: s.size, color: s.color, bold: s.bold, align: s.align, rot: s.rotate, math: s.math, upright: s.upright }); break;
      case "connector": connector(pen, s); break;
      case "chip": chip(pen, s); break;
      case "hole": hole(pen, s); break;
      case "passive": passive(pen, s); break;
      case "pad":
        pen.rect(s.x - s.w / 2, s.y - s.h / 2, s.w, s.h, { r: Math.min(0.3, s.w / 4, s.h / 4), fill: C.gold, stroke: C.goldDark, width: 0.12 });
        if (s.label) pen.text(s.x, s.y, s.label, { size: Math.min(s.h, s.w) * 0.55, color: "#6b4f14" });
        break;
      case "led":
        pen.rect(s.x - 0.65, s.y - 0.65, 1.3, 1.3, { r: 0.15, fill: "#ffffff", stroke: "#b8bec4", width: 0.1 });
        pen.circle(s.x, s.y, 0.38, { fill: s.color ?? "#d94b9a" });
        break;
      case "button": {
        const z = s.size ?? 3.2;
        pen.rect(s.x - z / 2, s.y - z / 2, z, z, { r: 0.25, fill: C.silver, stroke: C.silverDark, width: 0.12 });
        pen.circle(s.x, s.y, z * 0.3, { fill: "#2c3034" });
        break;
      }
    }
  }
  return pen.out;
}

// ---- moving a drawing ---------------------------------------------------------------------

/** How a device holds its part: mirrored left to right first, where `flip`, then turned `turn` quarter turns counter-clockwise, then moved by `by`. */
export interface Placing { turn: number; flip?: boolean; by: V }

/** A point of a part's drawing (about its middle, y up) where the device puts it. */
export function place(p: V, at: Placing): V {
  const t = ((at.turn % 4) + 4) % 4;
  const x = at.flip ? -p[0] : p[0], y = p[1];
  const r: V = t === 0 ? [x, y] : t === 1 ? [-y, x] : t === 2 ? [-x, -y] : [y, -x];
  return [r[0] + at.by[0], r[1] + at.by[1]];
}

/** A direction of a part's drawing, as the device turns it. */
export function turnDir(d: V, at: Placing): V {
  return place(d, { turn: at.turn, flip: at.flip, by: [0, 0] });
}

const MIRROR_ANCHOR: Record<string, TextPrim["anchor"]> = { w: "e", e: "w", nw: "ne", ne: "nw", sw: "se", se: "sw" };

/**
 * The primitives as the device puts them. Text stays readable when the part
 * is mirrored: it moves to the mirrored place but is not itself mirrored.
 */
export function placePrims(prims: Prim[], at: Placing): Prim[] {
  const t = ((at.turn % 4) + 4) % 4;
  if (!t && !at.flip && !at.by[0] && !at.by[1]) return prims;
  const f = (p: V) => place(p, at);
  const da = (t * Math.PI) / 2;
  const fl = !!at.flip;
  /** An angle of the drawing as the device turns it. */
  const ang = (a: number) => (fl ? Math.PI - a : a) + da;
  const outline = (o: Outline): Outline => o.kind === "circle"
    ? { kind: "circle", c: f(o.c), r: o.r }
    : {
      kind: "path", start: f(o.start), segs: o.segs.map((s): OutlineSeg =>
        s.k === "L" ? { k: "L", to: f(s.to) }
          : s.k === "C" ? { k: "C", to: f(s.to), c1: f(s.c1), c2: f(s.c2) }
            : { ...s, to: f(s.to), c: f(s.c), a0: ang(s.a0), a1: ang(s.a1), ccw: fl ? !s.ccw : s.ccw }),
    };
  return prims.map((p): Prim => {
    switch (p.k) {
      case "line": return { ...p, a: f(p.a), b: f(p.b) };
      case "circle": return { ...p, c: f(p.c) };
      case "poly": return { ...p, pts: p.pts.map(f) };
      case "path": return { ...p, pts: p.pts.map(f) };
      case "bezier": return { ...p, pts: p.pts.map(f) };
      case "arc": return fl ? { ...p, c: f(p.c), a0: ang(p.a1), a1: ang(p.a0) + (ang(p.a0) < ang(p.a1) ? 2 * Math.PI : 0) } : { ...p, c: f(p.c), a0: p.a0 + da, a1: p.a1 + da };
      case "text": {
        // A letter in a symbol reads the same however the symbol is turned.
        const rot = (p.rot ?? 0) + (p.part === UPRIGHT ? 0 : da);
        const anchor = fl ? MIRROR_ANCHOR[p.anchor] ?? p.anchor : p.anchor;
        return { ...p, at: f(p.at), anchor, rot: Math.abs(Math.sin(rot)) > 1e-9 || Math.cos(rot) < 0 ? rot : undefined };
      }
      case "region": return { ...p, outlines: p.outlines.map(outline) };
      case "image": return { ...p, at: f(p.at) };
    }
  });
}

/** Every primitive enlarged k times about the origin: lengths, line widths and text alike. */
export function scalePrims(prims: Prim[], k: number): Prim[] {
  if (k === 1) return prims;
  const f = (p: V): V => [p[0] * k, p[1] * k];
  // A stroke without a thickness of its own has that of its style, and that is enlarged with the rest.
  const w = (p: Parameters<typeof strokeWidth>[0]) => strokeWidth(p) * k;
  const outline = (o: Outline): Outline => o.kind === "circle"
    ? { kind: "circle", c: f(o.c), r: o.r * k }
    : {
      kind: "path", start: f(o.start), segs: o.segs.map((s): OutlineSeg =>
        s.k === "L" ? { k: "L", to: f(s.to) } : s.k === "C" ? { k: "C", to: f(s.to), c1: f(s.c1), c2: f(s.c2) } : { ...s, to: f(s.to), c: f(s.c), r: s.r * k }),
    };
  return prims.map((p): Prim => {
    switch (p.k) {
      case "line": return { ...p, a: f(p.a), b: f(p.b), width: w(p), dash: p.dash?.map((d) => d * k) };
      case "circle": return { ...p, c: f(p.c), r: p.r * k, width: w(p), dash: p.dash?.map((d) => d * k) };
      case "poly": return { ...p, pts: p.pts.map(f), width: w(p) };
      case "path": return { ...p, pts: p.pts.map(f), width: w(p), dash: p.dash?.map((d) => d * k) };
      case "bezier": return { ...p, pts: p.pts.map(f), width: w(p), dash: p.dash?.map((d) => d * k) };
      case "arc": return { ...p, c: f(p.c), r: p.r * k, width: w(p), dash: p.dash?.map((d) => d * k) };
      case "text": return { ...p, at: f(p.at), size: (p.size ?? PAPER.em) * k };
      case "region": return { ...p, outlines: p.outlines.map(outline) };
      case "image": return { ...p, at: f(p.at), w: p.w * k, h: p.h * k };
    }
  });
}

/**
 * The primitives with a thickness left off wherever it is the one their
 * style has anyway, so a file written from them names it once, in the style.
 * A circuit diagram's TikZ then reads \draw[member] from end to end.
 */
export function plainWidths(prims: Prim[]): Prim[] {
  return prims.map((p): Prim => {
    if (p.k === "text" || p.k === "region" || p.k === "image" || p.width === undefined) return p;
    if (Math.abs(p.width - strokeWidth({ stroke: p.stroke })) > 0.004) return p;
    const { width: _own, ...rest } = p;
    return rest as Prim;
  });
}
