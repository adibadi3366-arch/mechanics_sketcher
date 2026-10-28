// Reads the lines, arcs, circles and curves of an SVG drawing, such as one
// exported from a CAD program, so it can be annotated: dimensioned, filled,
// hatched. Only what is stroked comes in; text, pictures and filled shapes
// (arrowheads, letters drawn as outlines) are left out and counted.
//
// Coordinates come out in millimetres on the drawing's own paper, y up.
// Ends that meet are joined into one point, and points are added where
// curves cross, so the regions the drawing encloses can be filled.

import { type V, type Cubic, add, sub, mul, dist, angleOf, wrap, TWO_PI } from "./geom";
import { type Shape, crossings } from "./trim";

export interface ImportStyle {
  dashed?: boolean;
  centre?: boolean;
  /** Line thickness in points. */
  weight?: number;
  color?: string;
}

export interface ImportedDrawing {
  /** Every point, in mm, y up; curves refer to them by index. */
  points: V[];
  /** Which points are there only because two curves cross. */
  crossings: Set<number>;
  lines: { a: number; b: number; style: ImportStyle }[];
  /** Counter-clockwise from p1 to p2 around c. */
  arcs: { c: number; p1: number; p2: number; style: ImportStyle }[];
  circles: { c: number; r: number; style: ImportStyle }[];
  beziers: { p1: number; c1: number; c2: number; p2: number; style: ImportStyle }[];
  /** What was left out, and how much of it. */
  skipped: Map<string, number>;
}

/** The most pieces a drawing may have: beyond it, the editor would crawl. */
export const IMPORT_LIMIT = 20000;

// ---- reading the XML --------------------------------------------------------------

interface Node { name: string; attrs: Record<string, string>; children: Node[]; text: string }

/** A small reader for well-formed XML: elements, their attributes and the text in them. Comments, processing instructions and doctypes are passed over. */
export function parseXml(text: string): Node {
  const root: Node = { name: "#root", attrs: {}, children: [], text: "" };
  const stack: Node[] = [root];
  const tag = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[^>[]*(\[[\s\S]*?\])?\s*>|<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[^\s=>/]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
  const attr = /([^\s=>/]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let last = 0;
  for (let m = tag.exec(text); m; m = tag.exec(text)) {
    stack[stack.length - 1].text += text.slice(last, m.index);
    last = tag.lastIndex;
    if (m[1] !== undefined) { stack[stack.length - 1].text += m[1]; continue; }
    if (!m[4]) continue; // a comment, a declaration
    if (m[3] === "/") {
      // Closing: up to the element it closes.
      for (let i = stack.length - 1; i > 0; i--) if (stack[i].name === m[4]) { stack.length = i; break; }
      continue;
    }
    const node: Node = { name: m[4].replace(/^svg:/, ""), attrs: {}, children: [], text: "" };
    for (let a = attr.exec(m[5]); a; a = attr.exec(m[5])) node.attrs[a[1]] = unescape(a[2] ?? a[3] ?? "");
    attr.lastIndex = 0;
    stack[stack.length - 1].children.push(node);
    if (m[6] !== "/") stack.push(node);
  }
  return root;
}

function unescape(s: string): string {
  return s.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-f]+);/gi, (_, e: string) =>
    e === "lt" ? "<" : e === "gt" ? ">" : e === "amp" ? "&" : e === "quot" ? '"' : e === "apos" ? "'"
      : String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)));
}

// ---- transforms -------------------------------------------------------------------

/** An affine map [a b c d e f]: x' = a x + c y + e, y' = b x + d y + f, as SVG writes it. */
type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

function times(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

const apply = (m: Matrix, [x, y]: V): V => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

function parseTransform(t: string | undefined): Matrix {
  let m = IDENTITY;
  if (!t) return m;
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
  for (let k = re.exec(t); k; k = re.exec(t)) {
    const v = k[2].split(/[\s,]+/).filter(Boolean).map(Number);
    let n: Matrix = IDENTITY;
    if (k[1] === "matrix" && v.length === 6) n = v as Matrix;
    else if (k[1] === "translate") n = [1, 0, 0, 1, v[0] ?? 0, v[1] ?? 0];
    else if (k[1] === "scale") n = [v[0] ?? 1, 0, 0, v[1] ?? v[0] ?? 1, 0, 0];
    else if (k[1] === "rotate") {
      const a = ((v[0] ?? 0) * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
      n = [c, s, -s, c, 0, 0];
      if (v.length === 3) n = times(times([1, 0, 0, 1, v[1], v[2]], n), [1, 0, 0, 1, -v[1], -v[2]]);
    } else if (k[1] === "skewX") n = [1, 0, Math.tan(((v[0] ?? 0) * Math.PI) / 180), 1, 0, 0];
    else if (k[1] === "skewY") n = [1, Math.tan(((v[0] ?? 0) * Math.PI) / 180), 0, 1, 0, 0];
    m = times(m, n);
  }
  return m;
}

/** How a map scales lengths, when it keeps shapes (turns, mirrors and scales alike in both directions); null when it does not. */
function similarity(m: Matrix): number | null {
  const sx = Math.hypot(m[0], m[1]), sy = Math.hypot(m[2], m[3]);
  const skew = m[0] * m[2] + m[1] * m[3];
  return Math.abs(sx - sy) <= 1e-9 * Math.max(sx, sy) && Math.abs(skew) <= 1e-9 * sx * sy ? sx : null;
}

// ---- styles -----------------------------------------------------------------------

type Props = Record<string, string>;

function parseDecls(text: string): Props {
  const out: Props = {};
  for (const part of text.split(";")) {
    const i = part.indexOf(":");
    if (i > 0) out[part.slice(0, i).trim().toLowerCase()] = part.slice(i + 1).trim();
  }
  return out;
}

/** The rules of the drawing's style sheets, for class and element selectors: enough for what drawing programs write. */
function styleRules(root: Node): { sel: string; props: Props }[] {
  const out: { sel: string; props: Props }[] = [];
  const visit = (n: Node) => {
    if (n.name === "style") {
      const css = n.text.replace(/\/\*[\s\S]*?\*\//g, "");
      for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
        const props = parseDecls(m[2]);
        for (const sel of m[1].split(",")) out.push({ sel: sel.trim(), props });
      }
    }
    n.children.forEach(visit);
  };
  visit(root);
  return out;
}

const PRESENTATION = ["stroke", "stroke-width", "stroke-dasharray", "fill", "display", "visibility", "stroke-opacity", "opacity"];
/** What a child takes from its parent unless it says otherwise. Display does not pass down, but a hidden parent hides it all anyway. */
const INHERITED = ["stroke", "stroke-width", "stroke-dasharray", "fill", "visibility"];

/** Lengths as SVG writes them, in mm; `user` is how many mm a plain number is. */
function lengthMm(v: string | undefined, user: number): number | null {
  if (!v) return null;
  const m = /^\s*(-?[\d.]+(?:e[-+]?\d+)?)\s*(mm|cm|in|pt|pc|px)?\s*$/i.exec(v);
  if (!m) return null;
  const k = { mm: 1, cm: 10, in: 25.4, pt: 25.4 / 72, pc: 25.4 / 6, px: 25.4 / 96 }[(m[2] ?? "").toLowerCase() as "mm"] ?? user;
  return Number(m[1]) * k;
}

const NAMED: Record<string, string> = { black: "#000000", red: "#ff0000", blue: "#0000ff", green: "#008000", white: "#ffffff", gray: "#808080", grey: "#808080" };

function colour(v: string): string | undefined {
  v = v.trim().toLowerCase();
  if (NAMED[v]) v = NAMED[v];
  let m = /^#([0-9a-f]{6})$/.exec(v);
  if (m) return `#${m[1]}`;
  m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(v);
  if (m) return `#${m[1]}${m[1]}${m[2]}${m[2]}${m[3]}${m[3]}`;
  const r = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/.exec(v);
  if (r) return `#${r.slice(1, 4).map((x) => Math.min(255, Number(x)).toString(16).padStart(2, "0")).join("")}`;
  return undefined;
}

// ---- path data --------------------------------------------------------------------

/** A piece of a path, in the drawing's own units, before any transform. */
type Piece =
  | { k: "L"; a: V; b: V }
  | { k: "C"; q: Cubic }
  | { k: "A"; a: V; b: V; rx: number; ry: number; phi: number; large: boolean; sweep: boolean };

export function parsePath(d: string): Piece[] {
  const out: Piece[] = [];
  const tokens = d.match(/[MmLlHhVvCcSsQqTtAaZz]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) ?? [];
  let i = 0, cmd = "", cur: V = [0, 0], start: V = [0, 0], lastC: V | null = null, lastQ: V | null = null;
  const num = () => Number(tokens[i++]);
  const flag = () => {
    // Flags may be written run together with the next number ("a10 10 0 01 5 5").
    const t = tokens[i];
    if (t.length > 1 && (t[0] === "0" || t[0] === "1") && !t.includes(".")) { tokens[i] = t.slice(1); return t[0] === "1"; }
    i++;
    return t === "1";
  };
  while (i < tokens.length) {
    if (/^[A-Za-z]$/.test(tokens[i])) cmd = tokens[i++];
    else if (!cmd) { i++; continue; }
    const rel = cmd === cmd.toLowerCase();
    const at = (x: number, y: number): V => (rel ? [cur[0] + x, cur[1] + y] : [x, y]);
    switch (cmd.toUpperCase()) {
      case "M": {
        cur = start = at(num(), num());
        cmd = rel ? "l" : "L"; // more pairs after a move are lines
        lastC = lastQ = null;
        continue;
      }
      case "L": { const b = at(num(), num()); out.push({ k: "L", a: cur, b }); cur = b; break; }
      case "H": { const x = num(); const b: V = [rel ? cur[0] + x : x, cur[1]]; out.push({ k: "L", a: cur, b }); cur = b; break; }
      case "V": { const y = num(); const b: V = [cur[0], rel ? cur[1] + y : y]; out.push({ k: "L", a: cur, b }); cur = b; break; }
      case "C": {
        const c1 = at(num(), num()), c2 = at(num(), num()), b = at(num(), num());
        out.push({ k: "C", q: [cur, c1, c2, b] });
        lastC = c2; cur = b; lastQ = null;
        continue;
      }
      case "S": {
        const c1: V = lastC ? sub(mul(cur, 2), lastC) : cur;
        const c2 = at(num(), num()), b = at(num(), num());
        out.push({ k: "C", q: [cur, c1, c2, b] });
        lastC = c2; cur = b; lastQ = null;
        continue;
      }
      case "Q": case "T": {
        const ctl: V = cmd.toUpperCase() === "Q" ? at(num(), num()) : lastQ ? sub(mul(cur, 2), lastQ) : cur;
        const b = at(num(), num());
        // A quadratic curve is a cubic one with its controls two thirds of the way to the one control.
        out.push({ k: "C", q: [cur, add(cur, mul(sub(ctl, cur), 2 / 3)), add(b, mul(sub(ctl, b), 2 / 3)), b] });
        lastQ = ctl; cur = b; lastC = null;
        continue;
      }
      case "A": {
        const rx = Math.abs(num()), ry = Math.abs(num()), phi = num(), large = flag(), sweep = flag();
        const b = at(num(), num());
        out.push({ k: "A", a: cur, b, rx, ry, phi, large, sweep });
        cur = b;
        break;
      }
      case "Z": {
        if (dist(cur, start) > 0) out.push({ k: "L", a: cur, b: start });
        cur = start;
        cmd = "";
        break;
      }
      default: i++;
    }
    lastC = lastQ = null;
  }
  return out;
}

/** The centre and angles of an SVG arc, from its ends; the radii grow if they are too small to reach. */
function arcCentre(p: Extract<Piece, { k: "A" }>): { c: V; rx: number; ry: number; t0: number; dt: number } | null {
  const phi = (p.phi * Math.PI) / 180, cs = Math.cos(phi), sn = Math.sin(phi);
  const dx = (p.a[0] - p.b[0]) / 2, dy = (p.a[1] - p.b[1]) / 2;
  const x1 = cs * dx + sn * dy, y1 = -sn * dx + cs * dy;
  let { rx, ry } = p;
  if (rx < 1e-12 || ry < 1e-12) return null;
  const grow = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (grow > 1) { rx *= Math.sqrt(grow); ry *= Math.sqrt(grow); }
  const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  let k = Math.sqrt(Math.max(0, num / (rx * rx * y1 * y1 + ry * ry * x1 * x1)));
  if (p.large === p.sweep) k = -k;
  const cx1 = (k * rx * y1) / ry, cy1 = (-k * ry * x1) / rx;
  const c: V = [cs * cx1 - sn * cy1 + (p.a[0] + p.b[0]) / 2, sn * cx1 + cs * cy1 + (p.a[1] + p.b[1]) / 2];
  const ang = (ux: number, uy: number) => Math.atan2(uy, ux);
  const t0 = ang((x1 - cx1) / rx, (y1 - cy1) / ry);
  let dt = ang((-x1 - cx1) / rx, (-y1 - cy1) / ry) - t0;
  if (p.sweep && dt < 0) dt += TWO_PI;
  if (!p.sweep && dt > 0) dt -= TWO_PI;
  return { c, rx, ry, t0, dt };
}

/** An elliptical arc as cubic curves of at most a quarter turn each. */
function arcCubics(c: V, rx: number, ry: number, phi: number, t0: number, dt: number): Cubic[] {
  const n = Math.max(1, Math.ceil(Math.abs(dt) / (Math.PI / 2) - 1e-9));
  const step = dt / n, k = (4 / 3) * Math.tan(step / 4);
  const cs = Math.cos(phi), sn = Math.sin(phi);
  const pt = (t: number): V => [c[0] + rx * Math.cos(t) * cs - ry * Math.sin(t) * sn, c[1] + rx * Math.cos(t) * sn + ry * Math.sin(t) * cs];
  const dp = (t: number): V => [-rx * Math.sin(t) * cs - ry * Math.cos(t) * sn, -rx * Math.sin(t) * sn + ry * Math.cos(t) * cs];
  const out: Cubic[] = [];
  for (let i = 0; i < n; i++) {
    const a = t0 + i * step, b = a + step;
    const p0 = pt(a), p3 = pt(b);
    out.push([p0, add(p0, mul(dp(a), k)), sub(p3, mul(dp(b), k)), p3]);
  }
  return out;
}

// ---- the drawing ------------------------------------------------------------------

/** A curve read from the file, in mm, y up, before its ends are joined. */
type Raw =
  | { k: "line"; a: V; b: V; style: ImportStyle }
  | { k: "arc"; c: V; r: number; from: V; to: V; style: ImportStyle } // counter-clockwise from `from` to `to`
  | { k: "circle"; c: V; r: number; style: ImportStyle }
  | { k: "bezier"; q: Cubic; style: ImportStyle };

/** Reads an SVG drawing. Throws when it is not one, or has too much in it. */
export function importSvg(text: string): ImportedDrawing {
  const doc = parseXml(text);
  const svg = findFirst(doc, "svg");
  if (!svg) throw new Error("That file is not an SVG drawing.");
  const skipped = new Map<string, number>();
  const skip = (what: string, n = 1) => skipped.set(what, (skipped.get(what) ?? 0) + n);

  // From the drawing's own units to millimetres on its paper, with y turned to point up.
  const vb = (svg.attrs.viewBox ?? svg.attrs.viewbox ?? "").split(/[\s,]+/).filter(Boolean).map(Number);
  const box = vb.length === 4 && vb[2] > 0 && vb[3] > 0 ? vb : null;
  const wMm = lengthMm(svg.attrs.width, 25.4 / 96), hMm = lengthMm(svg.attrs.height, 25.4 / 96);
  let unit = 25.4 / 96;
  if (box && wMm) unit = wMm / box[2];
  else if (box && hMm) unit = hMm / box[3];
  const root: Matrix = times([unit, 0, 0, -unit, 0, 0], [1, 0, 0, 1, box ? -box[0] : 0, box ? -box[1] : 0]);

  const rules = styleRules(doc);
  const raws: Raw[] = [];
  const SKIP_TREE = new Set(["defs", "symbol", "clipPath", "mask", "marker", "pattern", "metadata", "title", "desc", "style", "script", "linearGradient", "radialGradient", "filter", "foreignObject"]);

  const walk = (n: Node, inherited: Props, m: Matrix) => {
    if (SKIP_TREE.has(n.name)) return;
    if (n.name === "text") return skip("text");
    if (n.name === "image") return skip("pictures");
    if (n.name === "use") return skip("repeated symbols");
    const props: Props = {};
    for (const k of INHERITED) if (inherited[k] !== undefined) props[k] = inherited[k];
    for (const k of PRESENTATION) if (n.attrs[k] !== undefined) props[k] = n.attrs[k];
    const classes = (n.attrs.class ?? "").split(/\s+/).filter(Boolean);
    for (const r of rules) if (r.sel === n.name || classes.some((c) => r.sel === `.${c}` || r.sel === `${n.name}.${c}`)) Object.assign(props, r.props);
    if (n.attrs.style) Object.assign(props, parseDecls(n.attrs.style));
    if (props.display === "none" || props.visibility === "hidden" || Number(props.opacity) === 0) return;
    const here = times(m, parseTransform(n.attrs.transform));
    if (["path", "line", "polyline", "polygon", "rect", "circle", "ellipse"].includes(n.name)) shape(n, props, here);
    for (const c of n.children) walk(c, props, here);
  };

  const shape = (n: Node, props: Props, m: Matrix) => {
    const stroke = props.stroke?.trim().toLowerCase();
    if (!stroke || stroke === "none" || stroke === "transparent" || Number(props["stroke-opacity"]) === 0) {
      if (props.fill === undefined || props.fill.trim().toLowerCase() !== "none") skip("filled shapes (arrowheads, letters)");
      return;
    }
    const scale = similarity(m);
    const style: ImportStyle = {};
    const c = colour(stroke);
    if (c && c !== "#000000") style.color = c;
    // Line widths are in the drawing's units, so they go through its scale to paper.
    const mScale = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
    const w = Number.parseFloat(props["stroke-width"] ?? "1");
    if (Number.isFinite(w) && w > 0) style.weight = Number(((w * mScale) / 0.3515).toFixed(2));
    const dash = (props["stroke-dasharray"] ?? "none").split(/[\s,]+/).filter((x) => x && x !== "none").map(Number).filter((x) => x > 0);
    // Long, short, long, short: a centre line. Any other pattern: dashed.
    if (dash.length >= 4 && Math.max(...dash) > 3 * Math.min(...dash)) style.centre = true;
    else if (dash.length >= 2) style.dashed = true;
    const A = (p: V) => apply(m, p);

    const pieces: Piece[] = [];
    const num = (k: string) => Number(n.attrs[k] ?? 0);
    if (n.name === "path") pieces.push(...parsePath(n.attrs.d ?? ""));
    else if (n.name === "line") pieces.push({ k: "L", a: [num("x1"), num("y1")], b: [num("x2"), num("y2")] });
    else if (n.name === "polyline" || n.name === "polygon") {
      const v = (n.attrs.points ?? "").split(/[\s,]+/).filter(Boolean).map(Number);
      const pts: V[] = [];
      for (let i = 0; i + 1 < v.length; i += 2) pts.push([v[i], v[i + 1]]);
      for (let i = 0; i + 1 < pts.length; i++) pieces.push({ k: "L", a: pts[i], b: pts[i + 1] });
      if (n.name === "polygon" && pts.length > 2) pieces.push({ k: "L", a: pts[pts.length - 1], b: pts[0] });
    } else if (n.name === "rect") {
      const x = num("x"), y = num("y"), w2 = num("width"), h = num("height");
      let rx = Number(n.attrs.rx ?? n.attrs.ry ?? 0), ry = Number(n.attrs.ry ?? n.attrs.rx ?? 0);
      rx = Math.min(rx, w2 / 2); ry = Math.min(ry, h / 2);
      if (!(rx > 0 && ry > 0)) {
        const c4: V[] = [[x, y], [x + w2, y], [x + w2, y + h], [x, y + h]];
        for (let i = 0; i < 4; i++) pieces.push({ k: "L", a: c4[i], b: c4[(i + 1) % 4] });
      } else {
        pieces.push(...parsePath(`M${x + rx} ${y}H${x + w2 - rx}A${rx} ${ry} 0 0 1 ${x + w2} ${y + ry}V${y + h - ry}A${rx} ${ry} 0 0 1 ${x + w2 - rx} ${y + h}H${x + rx}A${rx} ${ry} 0 0 1 ${x} ${y + h - ry}V${y + ry}A${rx} ${ry} 0 0 1 ${x + rx} ${y}Z`));
      }
    } else {
      const cx = num("cx"), cy = num("cy");
      const rx = n.name === "circle" ? num("r") : num("rx"), ry = n.name === "circle" ? num("r") : num("ry");
      if (!(rx > 0 && ry > 0)) return;
      if (scale !== null && Math.abs(rx - ry) <= 1e-9 * rx) {
        raws.push({ k: "circle", c: A([cx, cy]), r: rx * scale, style });
        return;
      }
      for (const q of arcCubics([cx, cy], rx, ry, 0, 0, TWO_PI)) raws.push({ k: "bezier", q: q.map(A) as Cubic, style });
      return;
    }

    for (const p of pieces) {
      if (p.k === "L") {
        if (dist(p.a, p.b) > 0) raws.push({ k: "line", a: A(p.a), b: A(p.b), style });
      } else if (p.k === "C") raws.push({ k: "bezier", q: p.q.map(A) as Cubic, style });
      else {
        const arc = arcCentre(p);
        if (!arc) { if (dist(p.a, p.b) > 0) raws.push({ k: "line", a: A(p.a), b: A(p.b), style }); continue; }
        if (scale !== null && Math.abs(arc.rx - arc.ry) <= 1e-9 * arc.rx) {
          // A circular arc stays one. Turned the right way round for the paper's y, which points up.
          const ccw = (arc.dt > 0) === (m[0] * m[3] - m[1] * m[2] > 0);
          const from = A(p.a), to = A(p.b);
          raws.push({ k: "arc", c: A(arc.c), r: arc.rx * scale, from: ccw ? from : to, to: ccw ? to : from, style });
        } else {
          for (const q of arcCubics(arc.c, arc.rx, arc.ry, (p.phi * Math.PI) / 180, arc.t0, arc.dt)) raws.push({ k: "bezier", q: q.map(A) as Cubic, style });
        }
      }
    }
  };

  walk(svg, {}, root);
  if (raws.length > IMPORT_LIMIT) throw new Error(`That drawing has ${raws.length} lines and curves in it; Mech Sketch takes up to ${IMPORT_LIMIT}.`);
  return assemble(raws, skipped);
}

function findFirst(n: Node, name: string): Node | null {
  if (n.name === name) return n;
  for (const c of n.children) {
    const f = findFirst(c, name);
    if (f) return f;
  }
  return null;
}

/** Joins the curves' ends into shared points, drops curves drawn twice, and adds a point wherever two curves cross. */
function assemble(raws: Raw[], skipped: Map<string, number>): ImportedDrawing {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const see = (q: V) => { x0 = Math.min(x0, q[0]); y0 = Math.min(y0, q[1]); x1 = Math.max(x1, q[0]); y1 = Math.max(y1, q[1]); };
  for (const r of raws) {
    if (r.k === "line") { see(r.a); see(r.b); }
    else if (r.k === "bezier") r.q.forEach(see);
    else { see([r.c[0] - r.r, r.c[1] - r.r]); see([r.c[0] + r.r, r.c[1] + r.r]); }
  }
  const size = Math.max(x1 - x0, y1 - y0, 1e-6);
  const tol = size * 2e-6;

  const points: V[] = [];
  const grid = new Map<string, number[]>();
  const cell = (q: V) => [Math.floor(q[0] / tol), Math.floor(q[1] / tol)];
  /** The point at q: one already there within the tolerance, or a new one. */
  const at = (q: V): number => {
    const [cx, cy] = cell(q);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      for (const i of grid.get(`${cx + dx},${cy + dy}`) ?? []) if (dist(points[i], q) <= tol) return i;
    }
    points.push(q);
    const key = `${cx},${cy}`;
    grid.set(key, [...(grid.get(key) ?? []), points.length - 1]);
    return points.length - 1;
  };
  /** A point of its own, joined to nothing: a control point. */
  const own = (q: V): number => { points.push(q); return points.length - 1; };

  const out: ImportedDrawing = { points, crossings: new Set(), lines: [], arcs: [], circles: [], beziers: [], skipped };
  const seen = new Set<string>();
  const once = (key: string) => { if (seen.has(key)) return false; seen.add(key); return true; };
  for (const r of raws) {
    if (r.k === "line") {
      const a = at(r.a), b = at(r.b);
      if (a !== b && once(`l${Math.min(a, b)},${Math.max(a, b)}`)) out.lines.push({ a, b, style: r.style });
    } else if (r.k === "arc") {
      const c = at(r.c), p1 = at(r.from), p2 = at(r.to);
      if (p1 !== p2 && once(`a${c},${p1},${p2}`)) out.arcs.push({ c, p1, p2, style: r.style });
      else if (p1 === p2) out.circles.push({ c, r: r.r, style: r.style });
    } else if (r.k === "circle") {
      const c = at(r.c);
      if (once(`c${c},${r.r.toPrecision(8)}`)) out.circles.push({ c, r: r.r, style: r.style });
    } else {
      const p1 = at(r.q[0]), p2 = at(r.q[3]);
      if (once(`b${p1},${p2},${r.q[1].map((v) => v.toPrecision(8))},${r.q[2].map((v) => v.toPrecision(8))}`)) {
        out.beziers.push({ p1, c1: own(r.q[1]), c2: own(r.q[2]), p2, style: r.style });
      }
    }
  }

  // Crossings, found piece against piece among those whose boxes meet.
  const shapes: { s: Shape; box: [number, number, number, number] }[] = [];
  for (const l of out.lines) {
    const a = points[l.a], b = points[l.b];
    shapes.push({ s: { kind: "line", a, b }, box: [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])] });
  }
  for (const c of out.circles) {
    const ctr = points[c.c];
    shapes.push({ s: { kind: "round", c: ctr, r: c.r, a0: 0, sweep: TWO_PI, full: true }, box: [ctr[0] - c.r, ctr[1] - c.r, ctr[0] + c.r, ctr[1] + c.r] });
  }
  for (const a of out.arcs) {
    const ctr = points[a.c], r = dist(ctr, points[a.p1]);
    const a0 = angleOf(sub(points[a.p1], ctr));
    shapes.push({ s: { kind: "round", c: ctr, r, a0, sweep: wrap(angleOf(sub(points[a.p2], ctr)) - a0) || TWO_PI, full: false }, box: [ctr[0] - r, ctr[1] - r, ctr[0] + r, ctr[1] + r] });
  }
  if (shapes.length <= 6000) {
    const bin = Math.max(size / 64, tol);
    const bins = new Map<string, number[]>();
    shapes.forEach((sh, i) => {
      for (let gx = Math.floor(sh.box[0] / bin); gx <= Math.floor(sh.box[2] / bin); gx++) {
        for (let gy = Math.floor(sh.box[1] / bin); gy <= Math.floor(sh.box[3] / bin); gy++) {
          const key = `${gx},${gy}`;
          const list = bins.get(key);
          if (list) list.push(i);
          else bins.set(key, [i]);
        }
      }
    });
    const tried = new Set<number>();
    const ends = new Set(out.lines.flatMap((l) => [l.a, l.b]).concat(out.arcs.flatMap((a) => [a.p1, a.p2])));
    for (const list of bins.values()) {
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const p = list[i], q = list[j];
          const key = p * shapes.length + q;
          if (tried.has(key)) continue;
          tried.add(key);
          const A = shapes[p], B = shapes[q];
          if (A.box[0] > B.box[2] + tol || B.box[0] > A.box[2] + tol || A.box[1] > B.box[3] + tol || B.box[1] > A.box[3] + tol) continue;
          for (const x of crossings(A.s, B.s, tol)) {
            const before = points.length;
            const k = at(x);
            // Only a crossing where no end already is makes a point of its own.
            if (k >= before && !ends.has(k)) out.crossings.add(k);
          }
        }
      }
    }
  }
  return out;
}

/** The points an imported drawing uses, for the sizes of things: its extent, in mm. */
export function importedExtent(d: ImportedDrawing): number {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of d.points) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return Math.max(x1 - x0, y1 - y0, 0);
}
