// Draws the editor canvas as SVG markup: the primitive list plus the editing
// aids (point handles, constraint markers, previews) that never get exported.

import {
  type Sketch, type Id, type Constraint, type Curve, ORIGIN, entity, point, isDimension, arcRadius, controlPoints, fixedPoints, isFreeCurve,
} from "./model";

const pointXY = (sk: Sketch, id: Id): V => { const p = point(sk, id); return [p.x, p.y]; };

/**
 * A short address for a picture held as a data URL: the screen is redrawn
 * often, and a picture written out in full each time would be slow to take
 * apart again. One is made for each picture and kept.
 */
const imageUrls = new Map<string, string>();
export function imageUrl(src: string): string {
  let url = imageUrls.get(src);
  if (url) return url;
  const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(src);
  if (!m || typeof URL.createObjectURL !== "function") return src;
  const bytes = m[2] ? Uint8Array.from(atob(m[3]), (c) => c.charCodeAt(0)) : new TextEncoder().encode(decodeURIComponent(m[3]));
  url = URL.createObjectURL(new Blob([bytes], { type: m[1] }));
  imageUrls.set(src, url);
  return url;
}
import { type V, type Box, add, sub, mul, norm, perp, mid, polar, wrap, projectOnSegment, TWO_PI } from "./geom";
import { type Prim, type StrokeStyle, type Outline, PAPER, dashOf, strokeWidth, arrowHeads, strokedEnds, strokedSweep, textBox } from "./prims";
import type { Overlaps } from "./regions";
import { texEngine } from "./tex";
import { ICONS } from "./icons";

export interface View {
  /** Model point at the centre of the canvas. */
  cx: number;
  cy: number;
  /** Screen pixels per model unit. */
  scale: number;
  w: number;
  h: number;
}

export const toScreen = (v: View, p: V): V =>
  [(p[0] - v.cx) * v.scale + v.w / 2, v.h / 2 - (p[1] - v.cy) * v.scale];
export const toModel = (v: View, s: V): V =>
  [(s[0] - v.w / 2) / v.scale + v.cx, (v.h / 2 - s[1]) / v.scale + v.cy];

/** A constraint marker on the canvas. x, y is its centre in screen pixels. */
export interface Glyph { id: Id; icon: string; x: number; y: number }

/** Shapes a drawing tool shows before the click that commits them. Model units. */
export interface Preview {
  lines: [V, V][];
  circles: { c: V; r: number }[];
  arcs: { c: V; r: number; a0: number; a1: number }[];
  points: V[];
  /** Drawn as something about to be removed, not added. */
  danger?: boolean;
  /** The path the pointer has taken while trimming, drawn as a thin trail. */
  trail?: V[];
  /** Bézier curves about to be drawn: start, controls, end. */
  beziers?: [V, V, V, V][];
}

export interface SnapMark {
  pos: V;
  kind: "point" | "curve" | "mid" | "h" | "v";
  /** For h and v: the point the alignment is measured from. */
  from?: V;
}

export interface Scene {
  sk: Sketch;
  view: View;
  /** Paper mm per model unit. */
  mm: number;
  prims: Prim[];
  glyphs: Glyph[];
  selection: Set<Id>;
  /** Entities a selected constraint refers to. */
  related: Set<Id>;
  hover: Id | null;
  conflicting: Set<Id>;
  redundant: Set<Id>;
  /** Points and curves that can still move; everything else is fully constrained. */
  freeIds: Set<Id>;
  /** Stretches where curves lie on top of each other, drawn in red. */
  overlaps: Overlaps;
  preview: Preview | null;
  snap: SnapMark | null;
  /** Selection rectangle in screen pixels. */
  box: { a: V; b: V } | null;
  /** Handles to drag on the selected symbol, in screen pixels. */
  grips: V[];
  /** Print preview: only what is exported is drawn, with no grid, handles or markers. */
  plain: boolean;
  /** In the print preview, the page the figure is exported on and the margin inside it, in annotation mm, and what to write under it. */
  page?: { page: Box; inner: Box; caption: string } | null;
  /** The other sketches of the drawing, already drawn: thin lines under this one. */
  under?: string;
}

export const GLYPH_SIZE = 18;
const n2 = (v: number) => v.toFixed(2);

// ---- constraint markers -----------------------------------------------------

const GLYPH_ICON: Record<string, string> = {
  coincident: "coincident", pointOn: "pointOn", midpoint: "midpoint", horizontal: "horizontal",
  vertical: "vertical", parallel: "parallel", perpendicular: "perpendicular", equal: "equal",
  tangent: "tangent", fixed: "fixed", mirror: "mirror", shift: "shift", turn: "turn",
};

/** Keeps a marker on the upper side of whatever it annotates. */
function upward(n: V): V {
  return n[1] > 1e-9 || (Math.abs(n[1]) <= 1e-9 && n[0] < 0) ? mul(n, -1) : n;
}

/** Lays out a marker for every constraint that `show` lets through. */
export function layoutGlyphs(sk: Sketch, view: View, show: (c: Constraint) => boolean = () => true): Glyph[] {
  const out: Glyph[] = [];
  const used = new Map<string, number>();
  const S = (id: Id): V => { const p = point(sk, id); return toScreen(view, [p.x, p.y]); };

  const place = (c: Constraint, base: V, away: V, along: V) => {
    const key = `${Math.round(base[0] / 6)}:${Math.round(base[1] / 6)}`;
    const k = used.get(key) ?? 0;
    used.set(key, k + 1);
    const pos = add(add(base, mul(away, 15)), mul(along, k * (GLYPH_SIZE + 2)));
    out.push({ id: c.id, icon: GLYPH_ICON[c.type], x: pos[0], y: pos[1] });
  };
  const atPoint = (c: Constraint, id: Id) => {
    // Below and to the right of the point, unless a support is drawn there:
    // then on the side facing away from the support's ground.
    const support = sk.symbols.find((s) => s.type === "support" && s.at === id);
    if (support?.type !== "support") return place(c, S(id), [0.75, 0.75], [1, 0]);
    const k = Math.cos(support.angle), n = Math.sin(support.angle);
    const up: V = [-0.75 * k - 0.75 * n, -0.75 * n + 0.75 * k]; // (-0.75, 0.75) turned with the support
    place(c, S(id), [up[0], -up[1]], [-1, 0]);
  };
  const atSpan = (c: Constraint, a: V, b: V) => {
    const u = norm(sub(b, a));
    place(c, mid(a, b), upward(perp(u)), u);
  };
  const atCurve = (c: Constraint, id: Id) => {
    const e = entity(sk, id) as Curve | undefined;
    if (!e) return;
    if (e.type === "line") return atSpan(c, S(e.p1), S(e.p2));
    if (e.type === "bezier") return atSpan(c, S(e.p1), S(e.p2));
    if (e.type === "spline") return atSpan(c, S(e.pts[0]), S(e.pts[e.pts.length - 1]));
    const ctr = point(sk, e.c);
    let ang = Math.PI / 4;
    let r = 0;
    if (e.type === "circle") r = e.r;
    else {
      r = arcRadius(sk, e);
      const s = point(sk, e.p1), t = point(sk, e.p2);
      const a0 = Math.atan2(s.y - ctr.y, s.x - ctr.x);
      let a1 = Math.atan2(t.y - ctr.y, t.x - ctr.x);
      if (a1 <= a0) a1 += TWO_PI;
      ang = (a0 + a1) / 2;
    }
    const rim = toScreen(view, polar([ctr.x, ctr.y], r, ang));
    place(c, rim, [Math.cos(ang), -Math.sin(ang)], [1, 0]);
  };

  for (const c of sk.constraints) {
    if (isDimension(c) || !show(c)) continue;
    switch (c.type) {
      case "fixed": atPoint(c, c.p); break;
      case "coincident": atPoint(c, c.a); break;
      case "pointOn": atPoint(c, c.p); break;
      case "midpoint": atPoint(c, c.p); break;
      case "horizontal":
      case "vertical":
        atSpan(c, S(c.a), S(c.b));
        break;
      case "parallel":
      case "perpendicular":
        atCurve(c, c.l1);
        atCurve(c, c.l2);
        break;
      case "equal":
        atCurve(c, c.a);
        atCurve(c, c.b);
        break;
      // One marker for a whole mirror image or pattern: on the mirror line, between the
      // original and its first copy, or at the point the copies go around.
      case "mirror": atCurve(c, c.l); break;
      case "shift": {
        // Between a point of the original and its nearest copy.
        const first = [...c.pairs.map(([from, to, steps]) => ({ from, to, steps })), ...c.half]
          .sort((a, b) => (a.steps ?? 1) - (b.steps ?? 1))[0];
        if (first) atSpan(c, S(first.from), S(first.to));
        break;
      }
      case "turn": atPoint(c, c.c); break;
      case "tangent": {
        const l = entity(sk, c.l), round = entity(sk, c.c);
        if (!l || !round || round.type === "point" || round.type === "line" || isFreeCurve(round) || l.type === "point" || isFreeCurve(l)) break;
        if (l.type !== "line") {
          // Two circles or arcs: where they touch, on the rim of the second towards the first.
          const from = point(sk, round.c), to = point(sk, l.c);
          const r = round.type === "circle" ? round.r : arcRadius(sk, round);
          const gap = Math.hypot(to.x - from.x, to.y - from.y) || 1;
          const dir: V = [(to.x - from.x) / gap, (to.y - from.y) / gap];
          const touch = toScreen(view, [from.x + dir[0] * r, from.y + dir[1] * r]);
          place(c, touch, [dir[0], -dir[1]], [1, 0]);
          break;
        }
        const centre = S(round.c);
        const touch = projectOnSegment(centre, S(l.p1), S(l.p2)).point;
        place(c, touch, norm(sub(touch, centre)), [1, 0]);
        break;
      }
    }
  }
  return out;
}

// ---- drawing ----------------------------------------------------------------

function gridStep(scale: number): number {
  const target = 22 / scale; // model units for roughly 22 px
  const pow = Math.pow(10, Math.floor(Math.log10(target)));
  for (const m of [1, 2, 5, 10]) if (m * pow >= target) return m * pow;
  return 10 * pow;
}

function background(view: View, showOrigin: boolean, plain: boolean): string {
  if (plain) return `<rect class="sheet desk" width="${view.w}" height="${view.h}"/>`;
  const step = gridStep(view.scale) * view.scale;
  const o = toScreen(view, [0, 0]);
  const ox = ((o[0] % step) + step) % step - step / 2;
  const oy = ((o[1] % step) + step) % step - step / 2;
  const L = 34;
  let out =
    `<defs><pattern id="grid" width="${n2(step)}" height="${n2(step)}" patternUnits="userSpaceOnUse" x="${n2(ox)}" y="${n2(oy)}">` +
    `<circle class="grid-dot" cx="${n2(step / 2)}" cy="${n2(step / 2)}" r="0.9"/></pattern></defs>` +
    `<rect width="${view.w}" height="${view.h}" fill="url(#grid)"/>`;
  if (showOrigin) {
    out +=
      `<g class="origin"><path d="M${n2(o[0])} ${n2(o[1] - L)}V${n2(o[1])}H${n2(o[0] + L)}"/>` +
      `<path class="tip" d="M${n2(o[0] + L)} ${n2(o[1])}l-6-3v6zM${n2(o[0])} ${n2(o[1] - L)}l-3 6h6z"/>` +
      `<text x="${n2(o[0] + L + 5)}" y="${n2(o[1] + 4)}">x</text><text x="${n2(o[0] - 3)}" y="${n2(o[1] - L - 6)}">y</text></g>`;
  }
  return out;
}

/** Marks the dimension a tool is about to place; never part of the sketch. */
export const PREVIEW_REF = "__preview";

/** What it takes to draw primitives: where they go on screen, and what is lit up. */
export type PrimScene = Pick<Scene, "view" | "mm" | "prims" | "selection" | "related" | "hover" | "conflicting" | "redundant" | "freeIds">;

function primClass(s: PrimScene, p: Prim): string {
  // Typeset text is a nested <svg>; it gets its own base class so the stroke
  // rules for drawn shapes do not leak into it.
  const cls = p.k === "text" ? ["tex", p.layer] : p.k === "region" ? ["region"] : p.k === "image" ? ["picture"] : ["prim", p.layer, p.stroke];
  if ((p.k === "circle" || p.k === "poly") && p.fill) cls.push(p.fill === "ink" ? "solid" : "filled");
  if (p.color) cls.push("tinted");
  if (p.ink) cls.push("inked");
  if (p.ghost) cls.push("ghost");
  const id = p.ref;
  if (p.layer === "geom") cls.push(id && s.freeIds.has(id) ? "free" : "defined");
  if (id === PREVIEW_REF) cls.push("pv");
  else if (id) {
    if (s.conflicting.has(id)) cls.push("bad");
    else if (s.redundant.has(id)) cls.push("extra");
    if (s.related.has(id)) cls.push("rel");
    if (s.hover === id) cls.push("hov");
    if (s.selection.has(id)) cls.push("sel");
  }
  return cls.join(" ");
}

function strokePx(p: { stroke: StrokeStyle; width?: number }, pxPerMm: number): number {
  // Never so thin that it is hard to see or to hit; a member at its standard thickness a little bolder.
  return Math.max(p.stroke === "member" && p.width === undefined ? 1.5 : 0.9, strokeWidth(p) * pxPerMm);
}

function arcPath(view: View, c: V, r: number, a0: number, a1: number): string {
  const s = toScreen(view, polar(c, r, a0)), e = toScreen(view, polar(c, r, a1));
  const rp = r * view.scale;
  const large = a1 - a0 > Math.PI ? 1 : 0;
  // Counter-clockwise in the model is sweep-flag 0 once y is flipped for the screen.
  return `M${n2(s[0])} ${n2(s[1])}A${n2(rp)} ${n2(rp)} 0 ${large} 0 ${n2(e[0])} ${n2(e[1])}`;
}

/** SVG path data for the outlines of a region; M maps paper mm to the target, pxPerMm scales radii. */
export function outlinePath(outlines: Outline[], M: (p: V) => V, pxPerMm: number): string {
  let d = "";
  for (const o of outlines) {
    if (o.kind === "circle") {
      const c = M(o.c), r = o.r * pxPerMm;
      d += `M${n2(c[0] - r)} ${n2(c[1])}a${n2(r)} ${n2(r)} 0 1 0 ${n2(2 * r)} 0a${n2(r)} ${n2(r)} 0 1 0 ${n2(-2 * r)} 0Z`;
      continue;
    }
    const start = M(o.start);
    d += `M${n2(start[0])} ${n2(start[1])}`;
    for (const seg of o.segs) {
      const to = M(seg.to);
      if (seg.k === "L") d += `L${n2(to[0])} ${n2(to[1])}`;
      else if (seg.k === "C") {
        const c1 = M(seg.c1), c2 = M(seg.c2);
        d += `C${n2(c1[0])} ${n2(c1[1])} ${n2(c2[0])} ${n2(c2[1])} ${n2(to[0])} ${n2(to[1])}`;
      } else {
        const sweep = seg.ccw ? wrap(seg.a1 - seg.a0) : wrap(seg.a0 - seg.a1);
        const r = n2(seg.r * pxPerMm);
        // Counter-clockwise on paper is sweep-flag 0 on the y-down screen.
        d += `A${r} ${r} 0 ${sweep > Math.PI ? 1 : 0} ${seg.ccw ? 0 : 1} ${n2(to[0])} ${n2(to[1])}`;
      }
    }
    d += "Z";
  }
  return d;
}

/** The primitives as SVG markup for the screen. */
export function drawPrims(s: PrimScene): string {
  const { view, mm } = s;
  const pxPerMm = view.scale / mm;
  const M = (p: V): V => toScreen(view, [p[0] / mm, p[1] / mm]);
  const engine = texEngine();
  let out = "";
  for (const p of s.prims) {
    const cls = primClass(s, p);
    if (p.k === "image") {
      const tl = M([p.at[0], p.at[1] + p.h]);
      out += `<image class="${cls}" href="${imageUrl(p.src)}" x="${n2(tl[0])}" y="${n2(tl[1])}" width="${n2(p.w * pxPerMm)}" height="${n2(p.h * pxPerMm)}" opacity="${p.opacity}" preserveAspectRatio="none"/>`;
      if (s.selection.has(p.ref ?? "") || s.hover === p.ref) out += `<rect class="picture-frame${s.selection.has(p.ref ?? "") ? " sel" : ""}" x="${n2(tl[0])}" y="${n2(tl[1])}" width="${n2(p.w * pxPerMm)}" height="${n2(p.h * pxPerMm)}"/>`;
      continue;
    }
    if (p.k === "region") {
      out += `<path class="${cls}" d="${outlinePath(p.outlines, M, pxPerMm)}" fill="${p.color}" fill-rule="evenodd"/>`;
      continue;
    }
    if (p.k === "text") {
      const b = textBox(p);
      const topLeft = M([b.x0, b.y1]);
      let glyphs = engine.svg(p.tex, topLeft[0], topLeft[1], PAPER.em * pxPerMm, cls);
      // Its colour goes in as a variable on a group around it, so the highlight rules still win.
      if (p.ink && glyphs) glyphs = `<g style="--ink:${p.ink}">${glyphs}</g>`;
      if (p.rot && glyphs) {
        // Counter-clockwise on paper is a negative angle on the y-down screen.
        const at = M(p.at);
        out += `<g transform="rotate(${n2((-p.rot * 180) / Math.PI)} ${n2(at[0])} ${n2(at[1])})">${glyphs}</g>`;
      } else out += glyphs;
      continue;
    }
    const dash = dashOf(p);
    // The colour goes in as a variable, so the highlight rules for selection and hover still win.
    const sw = `stroke-width="${n2(strokePx(p, pxPerMm))}"` +
      (dash ? ` stroke-dasharray="${dash.map((d) => n2(d * pxPerMm)).join(" ")}"` : "") +
      (p.color || p.ink ? ` style="${p.color ? `--tint:${p.color};` : ""}${p.ink ? `--ink:${p.ink}` : ""}"` : "");
    if (p.k === "line") {
      const [a, b] = strokedEnds(p).map(M);
      out += `<line class="${cls}" x1="${n2(a[0])}" y1="${n2(a[1])}" x2="${n2(b[0])}" y2="${n2(b[1])}" ${sw}/>`;
    } else if (p.k === "circle") {
      const c = M(p.c);
      out += `<circle class="${cls}" cx="${n2(c[0])}" cy="${n2(c[1])}" r="${n2(p.r * pxPerMm)}" ${sw}/>`;
    } else if (p.k === "poly") {
      out += `<polygon class="${cls}" points="${p.pts.map((q) => M(q).map(n2).join(",")).join(" ")}" ${sw}/>`;
    } else if (p.k === "path") {
      out += `<polyline class="${cls}" points="${p.pts.map((q) => M(q).map(n2).join(",")).join(" ")}" ${sw}/>`;
    } else if (p.k === "bezier") {
      const q = p.pts.map(M);
      let d = `M${n2(q[0][0])} ${n2(q[0][1])}`;
      for (let i = 1; i + 2 < q.length; i += 3) d += `C${n2(q[i][0])} ${n2(q[i][1])} ${n2(q[i + 1][0])} ${n2(q[i + 1][1])} ${n2(q[i + 2][0])} ${n2(q[i + 2][1])}`;
      out += `<path class="${cls}" d="${d}" ${sw}/>`;
    } else {
      const [a0, a1] = strokedSweep(p);
      out += `<path class="${cls}" d="${arcPath(view, [p.c[0] / mm, p.c[1] / mm], p.r / mm, a0, a1)}" ${sw}/>`;
    }
    if (p.k === "line" || p.k === "arc") {
      for (const head of arrowHeads(p)) {
        out += `<polygon class="${cls} head" points="${head.map((q) => M(q).map(n2).join(",")).join(" ")}"${p.ink ? ` style="--ink:${p.ink}"` : ""}/>`;
      }
    }
  }
  return out;
}

function drawHandles(s: Scene): string {
  let out = "";
  // A datum point shows its coloured dot, or the mark of a centre of mass: its handle is a ring around that, not a disc over it.
  const datums = new Map<Id, number>();
  for (const x of s.sk.symbols) if (x.type === "datum") datums.set(x.at, ((x.mass ? PAPER.massRadius : PAPER.datumRadius) * s.view.scale) / s.mm);
  // A Bézier curve's control points show, with the lines to them, while it is selected or one of them is in hand.
  const controls = controlPoints(s.sk);
  const shown = (id: Id) => {
    const bz = controls.get(id)!;
    return s.selection.has(bz.id) || s.selection.has(id) || s.hover === id || s.selection.has(bz.c1) || s.selection.has(bz.c2);
  };
  for (const [id, bz] of controls) {
    if (id !== bz.c1 || !shown(id)) continue;
    for (const [end, ctl] of [[bz.p1, bz.c1], [bz.p2, bz.c2]] as [Id, Id][]) {
      const a = toScreen(s.view, pointXY(s.sk, end)), b = toScreen(s.view, pointXY(s.sk, ctl));
      out += `<line class="bz-handle" x1="${n2(a[0])}" y1="${n2(a[1])}" x2="${n2(b[0])}" y2="${n2(b[1])}"/>`;
    }
  }
  const fixed = fixedPoints(s.sk);
  for (const e of s.sk.entities) {
    if (e.type !== "point") continue;
    if (controls.has(e.id) && !shown(e.id)) continue;
    // Imported points are many and fixed: each shows only while it is pointed at or picked.
    if (e.locked && s.hover !== e.id && !s.selection.has(e.id) && !s.related.has(e.id)) continue;
    const p = toScreen(s.view, [e.x, e.y]);
    const cls = ["pt"];
    if (controls.has(e.id)) cls.push("ctl");
    const lit = s.selection.has(e.id) || s.hover === e.id;
    if (s.related.has(e.id)) cls.push("rel");
    if (s.hover === e.id) cls.push("hov");
    if (s.selection.has(e.id)) cls.push("sel");
    if (e.id === ORIGIN) {
      // The origin: a ring with a cross through it, as on a drawing's datum.
      const r = lit ? 6.5 : 5.5;
      out += `<g class="${cls.join(" ")} origin-pt"><circle cx="${n2(p[0])}" cy="${n2(p[1])}" r="${r}"/>` +
        `<path d="M${n2(p[0] - r - 3)} ${n2(p[1])}h${2 * r + 6}M${n2(p[0])} ${n2(p[1] - r - 3)}v${2 * r + 6}"/></g>`;
      continue;
    }
    if (fixed.has(e.id)) cls.push("fixed");
    if (e.ref) cls.push("ref");
    if (!s.freeIds.has(e.id)) cls.push("defined");
    const dotPx = datums.get(e.id);
    if (dotPx !== undefined) {
      cls.push("ring");
      out += `<circle class="${cls.join(" ")}" cx="${n2(p[0])}" cy="${n2(p[1])}" r="${n2(Math.max(4.6, dotPx + 2.2) + (lit ? 1.2 : 0))}"/>`;
      continue;
    }
    out += `<circle class="${cls.join(" ")}" cx="${n2(p[0])}" cy="${n2(p[1])}" r="${lit ? 4.6 : 3.4}"/>`;
  }
  return out;
}

function drawGrips(s: Scene): string {
  return s.grips.map((g) => `<rect class="grip" x="${n2(g[0] - 4)}" y="${n2(g[1] - 4)}" width="8" height="8" rx="1.5"/>`).join("");
}

/** Red over the stretches where two curves share the same space. */
function drawOverlaps(s: Scene): string {
  let out = "";
  for (const [a, b] of s.overlaps.segments) {
    const p = toScreen(s.view, a), q = toScreen(s.view, b);
    out += `<line class="overlap" x1="${n2(p[0])}" y1="${n2(p[1])}" x2="${n2(q[0])}" y2="${n2(q[1])}"/>`;
  }
  for (const r of s.overlaps.rounds) {
    if (r.a1 - r.a0 >= TWO_PI - 1e-9) {
      const c = toScreen(s.view, r.c);
      out += `<circle class="overlap" cx="${n2(c[0])}" cy="${n2(c[1])}" r="${n2(r.r * s.view.scale)}"/>`;
    } else {
      out += `<path class="overlap" d="${arcPath(s.view, r.c, r.r, r.a0, r.a1)}"/>`;
    }
  }
  return out;
}

function drawGlyphs(s: Scene): string {
  let out = "";
  const h = GLYPH_SIZE / 2;
  for (const g of s.glyphs) {
    const cls = ["glyph"];
    if (s.conflicting.has(g.id)) cls.push("bad");
    else if (s.redundant.has(g.id)) cls.push("extra");
    if (s.hover === g.id) cls.push("hov");
    if (s.selection.has(g.id)) cls.push("sel");
    out += `<g class="${cls.join(" ")}" transform="translate(${n2(g.x - h)} ${n2(g.y - h)})">` +
      `<rect width="${GLYPH_SIZE}" height="${GLYPH_SIZE}" rx="4"/>` +
      `<g transform="translate(2 2) scale(0.7)" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[g.icon]}</g></g>`;
  }
  return out;
}

function drawPreview(s: Scene): string {
  const pv = s.preview;
  if (!pv) return "";
  const cls = pv.danger ? "preview danger" : "preview";
  let out = "";
  for (const [a, b] of pv.lines) {
    const p = toScreen(s.view, a), q = toScreen(s.view, b);
    out += `<line class="${cls}" x1="${n2(p[0])}" y1="${n2(p[1])}" x2="${n2(q[0])}" y2="${n2(q[1])}"/>`;
  }
  for (const c of pv.circles) {
    const p = toScreen(s.view, c.c);
    out += `<circle class="${cls}" cx="${n2(p[0])}" cy="${n2(p[1])}" r="${n2(c.r * s.view.scale)}"/>`;
  }
  for (const a of pv.arcs) out += `<path class="${cls}" d="${arcPath(s.view, a.c, a.r, a.a0, a.a1)}"/>`;
  for (const q of pv.beziers ?? []) {
    const [a, b, c, d] = q.map((x) => toScreen(s.view, x));
    out += `<path class="${cls}" d="M${n2(a[0])} ${n2(a[1])}C${n2(b[0])} ${n2(b[1])} ${n2(c[0])} ${n2(c[1])} ${n2(d[0])} ${n2(d[1])}"/>`;
  }
  if (pv.trail && pv.trail.length > 1) {
    out += `<polyline class="trail" points="${pv.trail.map((q) => toScreen(s.view, q).map(n2).join(",")).join(" ")}"/>`;
  }
  for (const q of pv.points) {
    const p = toScreen(s.view, q);
    out += `<circle class="pt preview-pt" cx="${n2(p[0])}" cy="${n2(p[1])}" r="3.4"/>`;
  }
  return out;
}

function drawSnap(s: Scene): string {
  const m = s.snap;
  if (!m) return "";
  const p = toScreen(s.view, m.pos);
  const [x, y] = [n2(p[0]), n2(p[1])];
  if (m.kind === "point") return `<circle class="snap" cx="${x}" cy="${y}" r="8"/>`;
  if (m.kind === "curve") return `<path class="snap" d="M${n2(p[0] - 5)} ${n2(p[1] - 5)}l10 10m0-10l-10 10"/>`;
  if (m.kind === "mid") return `<path class="snap" d="M${x} ${n2(p[1] - 7)}l6.5 11h-13z"/>`;
  let out = "";
  if (m.from) {
    const f = toScreen(s.view, m.from);
    out += `<line class="snap guide" x1="${n2(f[0])}" y1="${n2(f[1])}" x2="${x}" y2="${y}"/>`;
  }
  const icon = m.kind === "h" ? "horizontal" : "vertical";
  out += `<g class="glyph hint" transform="translate(${n2(p[0] + 12)} ${n2(p[1] - 26)})"><rect width="${GLYPH_SIZE}" height="${GLYPH_SIZE}" rx="4"/>` +
    `<g transform="translate(2 2) scale(0.7)" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">${ICONS[icon]}</g></g>`;
  return out;
}

/** The page of the print preview: white, with the margin dashed inside it and its size written under it. */
function drawPage(s: Scene): string {
  const p = s.page;
  if (!p) return "";
  const rect = (b: Box, cls: string) => {
    const a = toScreen(s.view, [b.x0 / s.mm, b.y1 / s.mm]), c = toScreen(s.view, [b.x1 / s.mm, b.y0 / s.mm]);
    return { x: a[0], y: a[1], w: c[0] - a[0], h: c[1] - a[1], svg: `<rect class="${cls}" x="${n2(a[0])}" y="${n2(a[1])}" width="${n2(c[0] - a[0])}" height="${n2(c[1] - a[1])}"/>` };
  };
  const page = rect(p.page, "page"), inner = rect(p.inner, "page-margin");
  return page.svg + inner.svg +
    `<text class="page-size" x="${n2(page.x + page.w / 2)}" y="${n2(Math.min(s.view.h - 8, page.y + page.h + 20))}" text-anchor="middle">${p.caption}</text>`;
}

export function renderScene(s: Scene): string {
  let box = "";
  if (s.box) {
    const x = Math.min(s.box.a[0], s.box.b[0]), y = Math.min(s.box.a[1], s.box.b[1]);
    box = `<rect class="marquee" x="${n2(x)}" y="${n2(y)}" width="${n2(Math.abs(s.box.a[0] - s.box.b[0]))}" height="${n2(Math.abs(s.box.a[1] - s.box.b[1]))}"/>`;
  }
  if (s.plain) return background(s.view, false, true) + drawPage(s) + drawPrims(s) + drawGrips(s) + drawPreview(s) + drawSnap(s) + box;
  return background(s.view, s.sk.showOrigin, false) + (s.under ?? "") + drawPrims(s) + drawOverlaps(s) + drawHandles(s) + drawGlyphs(s) + drawGrips(s) + drawPreview(s) + drawSnap(s) + box;
}
