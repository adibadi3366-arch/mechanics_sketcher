// Writes the figure out as SVG and as TikZ. Both read the same primitive list
// the screen draws from, in paper millimetres, so what is exported is what was
// on screen without the editing aids.

import { type Sketch, geometryExtent } from "./model";
import {
  type Prim, type StrokeStyle, type Outline, type Anchor, type LinePrim, type ArcPrim,
  PAPER, PT_MM, STROKE_DASH, dashOf, strokeWidth, printMm, buildPrims, arrowHeads, strokedEnds, strokedSweep, textBox, textCorners, outlinePolygon,
} from "./prims";
import { type V, type Box, emptyBox, grow, boxIsEmpty, polar, wrap, TWO_PI, bezierPoints, chainCubics } from "./geom";
import { texEngine } from "./tex";
import { latexAccents } from "./accents";
import { outlinePath } from "./render";

/**
 * The figure as primitives: no construction geometry, no hidden dimensions.
 * They are in annotation mm; enlarged by sk.dimScale they are the figure at
 * its size on paper.
 */
export function figurePrims(sk: Sketch): Prim[] {
  return fitFigure(sk)?.prims ?? [];
}

/** The margin round the exported figure on each side, as a share of its width. */
export const FIGURE_MARGIN = 0.05;

/** The figure fitted to its page. Lengths are in annotation mm: enlarged by the dimension size they are on paper. */
export interface FittedFigure {
  /** Annotation mm per unit of the drawing. */
  mm: number;
  prims: Prim[];
  /** What the primitives cover. */
  box: Box;
  /** The page: the figure with the margin all round, as wide as the set width. */
  page: Box;
  margin: number;
  /** Size of the page on paper, in mm. */
  width: number;
  height: number;
}

/**
 * Lays the figure out to fill the set width: everything in it, dimensions,
 * text and symbols included, takes 90 % of the width, with 5 % of it as a
 * margin on every side; the height follows. Only the drawing is scaled: text,
 * arrowheads and line widths keep their size on paper, so the scale is found
 * in a few rounds rather than worked out at once. A figure much taller than
 * it is wide is held to a height of about three times its width, as before.
 * Null when there is nothing to export.
 */
export function fitFigure(sk: Sketch): FittedFigure | null {
  const k = sk.dimScale > 0 ? sk.dimScale : 1;
  const W = sk.figureWidthMm / k;
  const margin = W * FIGURE_MARGIN, inner = W - 2 * margin;
  const extent = geometryExtent(sk);
  const at = (mm: number) => {
    const prims = buildPrims(sk, mm, { editor: false });
    const box = figureBounds(prims);
    const size = boxIsEmpty(box) ? 0 : Math.max(box.x1 - box.x0, (box.y1 - box.y0) * 0.3);
    return { mm, prims, box, size };
  };
  let cur = at(extent > 1e-9 ? inner / extent : printMm(sk));
  if (boxIsEmpty(cur.box)) return null;
  if (extent > 1e-9) {
    // Each round takes the change in size from the last one as how fast the figure grows with the scale.
    let slope = extent, best = cur.size <= inner ? cur : null;
    for (let i = 0; i < 24 && Math.abs(cur.size - inner) > inner * 1e-5; i++) {
      let next = cur.mm + (inner - cur.size) / slope;
      // Text and symbols alone may be wider than the page: the drawing then only shrinks so far.
      if (!(next > cur.mm * 0.05)) next = cur.mm * 0.05;
      const tried = at(next);
      const grew = (tried.size - cur.size) / (tried.mm - cur.mm);
      if (Number.isFinite(grew) && grew > extent * 1e-3) slope = grew;
      cur = tried;
      if (cur.size <= inner * (1 + 1e-5) && (!best || cur.mm > best.mm)) best = cur;
    }
    if (cur.size > inner * (1 + 1e-5) && best) cur = best;
  }
  const { box } = cur;
  // Narrower than the page (a tall figure): it sits in the middle of it.
  const w = Math.max(box.x1 - box.x0 + 2 * margin, W);
  const cx = (box.x0 + box.x1) / 2;
  const page: Box = { x0: cx - w / 2, x1: cx + w / 2, y0: box.y0 - margin, y1: box.y1 + margin };
  return { mm: cur.mm, prims: cur.prims, box, page, margin, width: w * k, height: (page.y1 - page.y0) * k };
}

/** Everything the primitives cover, in paper mm. */
export function figureBounds(prims: Prim[]): Box {
  const b = emptyBox();
  for (const p of prims) {
    if (p.k === "image") continue; // a picture to trace over is never part of the figure
    if (p.k === "text") {
      for (const q of textCorners(p)) grow(b, q);
    } else if (p.k === "region") {
      for (const o of p.outlines) for (const q of outlinePolygon(o)) grow(b, q);
    } else {
      const half = strokeWidth(p) / 2;
      if (p.k === "line") {
        grow(b, p.a, half);
        grow(b, p.b, half);
      } else if (p.k === "circle") grow(b, p.c, p.r + half);
      else if (p.k === "poly" || p.k === "path") for (const q of p.pts) grow(b, q, half);
      else if (p.k === "bezier") for (const piece of chainCubics(p.pts)) for (const q of bezierPoints(piece, 32)) grow(b, q, half);
      else {
        const n = Math.max(2, Math.ceil((p.a1 - p.a0) / (Math.PI / 30)));
        for (let i = 0; i <= n; i++) grow(b, polar(p.c, p.r, p.a0 + ((p.a1 - p.a0) * i) / n), half);
      }
      if (p.k === "line" || p.k === "arc") for (const head of arrowHeads(p)) for (const q of head) grow(b, q);
    }
  }
  return b;
}

// ---- SVG ----------------------------------------------------------------------

/** Trims a number to at most `digits` decimals, without trailing zeros. */
export const num = (v: number, digits = 3): string => {
  if (Math.abs(v) < 0.5 / 10 ** digits) return "0"; // also keeps "-0" out
  const s = v.toFixed(digits);
  return s.includes(".") ? s.replace(/\.?0+$/, "") : s;
};

/**
 * The figure as a standalone SVG file, or null when there is nothing to draw.
 * Sizes are in millimetres; labels are outlines, so no font is needed to show it.
 */
export function toSvg(sk: Sketch): string | null {
  const fig = fitFigure(sk);
  return fig && primsToSvg(fig.prims, sk.dimScale, fig.page);
}

/**
 * The same for any list of primitives in annotation mm, enlarged `k` times on
 * paper. `page` is the area the file shows; unset, what the primitives cover
 * with 1 mm round it.
 */
export function primsToSvg(prims: Prim[], k = 1, page?: Box): string | null {
  const box = figureBounds(prims);
  if (boxIsEmpty(box)) return null;
  const margin = 1 / k; // 1 mm on paper
  const frame: Box = page ?? { x0: box.x0 - margin, y0: box.y0 - margin, x1: box.x1 + margin, y1: box.y1 + margin };
  const w = frame.x1 - frame.x0, h = frame.y1 - frame.y0;
  // SVG's y axis points down: flip, and put the top-left corner of the page at the origin.
  const M = ([x, y]: V): V => [x - frame.x0, frame.y1 - y];
  const pt = (q: V) => { const m = M(q); return `${num(m[0])},${num(m[1])}`; };
  const engine = texEngine();

  const body: string[] = [];
  for (const p of prims) {
    if (p.k === "image") continue; // a picture to trace over is never part of the figure
    if (p.k === "region") {
      body.push(`<path d="${outlinePath(p.outlines, M, 1)}" fill="${p.color}" fill-rule="evenodd" stroke="none"/>`);
      continue;
    }
    if (p.k === "text") {
      const t = textBox(p);
      const corner = M([t.x0, t.y1]);
      // currentColor would depend on where the file is placed; make it black outright.
      const ink = p.ink ?? "#000";
      const glyphs = engine.svg(p.tex, corner[0], corner[1], PAPER.em, "label").replace(/currentColor/g, ink).replace(' class="label"', ` fill="${ink}" stroke="none"`);
      if (p.rot && glyphs) {
        // Counter-clockwise on paper is a negative angle once y points down.
        const at = M(p.at);
        body.push(`<g transform="rotate(${num((-p.rot * 180) / Math.PI, 2)} ${num(at[0])} ${num(at[1])})">${glyphs}</g>`);
      } else body.push(glyphs);
      continue;
    }
    const dash = dashOf(p);
    const stroke = `stroke-width="${num(strokeWidth(p))}"` + (dash ? ` stroke-dasharray="${dash.map((d) => num(d)).join(" ")}"` : "") +
      (p.ink ? ` stroke="${p.ink}"` : "");
    const fill = (p.k === "circle" || p.k === "poly") && p.fill ? ` fill="${p.fill === "ink" ? p.color ?? "#000" : "#fff"}"` : "";
    if (p.k === "line") {
      const [a, b] = strokedEnds(p).map(M);
      body.push(`<line x1="${num(a[0])}" y1="${num(a[1])}" x2="${num(b[0])}" y2="${num(b[1])}" ${stroke}/>`);
    } else if (p.k === "circle") {
      const c = M(p.c);
      body.push(`<circle cx="${num(c[0])}" cy="${num(c[1])}" r="${num(p.r)}" ${stroke}${fill}/>`);
    } else if (p.k === "poly") {
      body.push(`<polygon points="${p.pts.map(pt).join(" ")}" ${stroke}${fill}/>`);
    } else if (p.k === "path") {
      body.push(`<polyline points="${p.pts.map(pt).join(" ")}" ${stroke}/>`);
    } else if (p.k === "bezier") {
      const q = p.pts.map(M);
      let d = `M${num(q[0][0])} ${num(q[0][1])}`;
      for (let i = 1; i + 2 < q.length; i += 3) d += `C${num(q[i][0])} ${num(q[i][1])} ${num(q[i + 1][0])} ${num(q[i + 1][1])} ${num(q[i + 2][0])} ${num(q[i + 2][1])}`;
      body.push(`<path d="${d}" ${stroke}/>`);
    } else {
      const [a0, a1] = strokedSweep(p);
      const s = M(polar(p.c, p.r, a0)), e = M(polar(p.c, p.r, a1));
      const r = num(p.r);
      // Counter-clockwise on paper is sweep-flag 0 once y is flipped.
      body.push(`<path d="M${num(s[0])} ${num(s[1])}A${r} ${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 0 ${num(e[0])} ${num(e[1])}" ${stroke}/>`);
    }
    if (p.k === "line" || p.k === "arc") {
      for (const head of arrowHeads(p)) body.push(`<polygon points="${head.map(pt).join(" ")}" fill="${p.ink ?? "#000"}" stroke="none"/>`);
    }
  }

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    // The drawing is in annotation mm; the size on paper enlarges all of it by the dimension size.
    `<svg xmlns="http://www.w3.org/2000/svg" width="${num(w * k, 2)}mm" height="${num(h * k, 2)}mm" viewBox="0 0 ${num(w)} ${num(h)}">\n` +
    `<g fill="none" stroke="#000" stroke-linecap="round" stroke-linejoin="round" font-family="'Latin Modern Math', 'STIX Two Math', 'Times New Roman', serif">\n` +
    body.join("\n") +
    `\n</g>\n</svg>\n`
  );
}

// ---- TikZ ---------------------------------------------------------------------

/** Line widths in points, as LaTeX users know them. */
const TIKZ_WIDTH: Record<StrokeStyle, number> = {
  member: 0.8, construction: 0.4, dim: 0.3, symbol: 0.4, hatch: 0.3, centre: 0.3, centreline: 0.4, arrow: 0.6, element: 0.6,
};
const TIKZ_ANCHOR: Record<Anchor, string> = {
  c: "center", n: "north", s: "south", e: "east", w: "west",
  ne: "north east", nw: "north west", se: "south east", sw: "south west",
};
const deg = (rad: number) => num((rad * 180) / Math.PI, 2);
const co = (q: V) => `(${num(q[0], 2)},${num(q[1], 2)})`;

export function tikzColor(hex: string): string {
  const v = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!v) return "black!15";
  return `{rgb,255:red,${parseInt(v[1], 16)};green,${parseInt(v[2], 16)};blue,${parseInt(v[3], 16)}}`;
}

function tikzOutline(o: Outline): string {
  if (o.kind === "circle") return `${co(o.c)} circle[radius=${num(o.r, 2)}]`;
  let s = co(o.start);
  o.segs.forEach((seg, i) => {
    if (seg.k === "L") {
      // The last straight side is the one "cycle" draws.
      if (i < o.segs.length - 1) s += ` -- ${co(seg.to)}`;
      return;
    }
    if (seg.k === "C") {
      s += ` .. controls ${co(seg.c1)} and ${co(seg.c2)} .. ${co(seg.to)}`;
      return;
    }
    // An arc carries on from the current point; its end is the next corner.
    const sweep = seg.ccw ? wrap(seg.a1 - seg.a0) || TWO_PI : -(wrap(seg.a0 - seg.a1) || TWO_PI);
    s += ` arc[start angle=${deg(seg.a0)}, end angle=${deg(seg.a0 + sweep)}, radius=${num(seg.r, 2)}]`;
  });
  return `${s} -- cycle`;
}

/** A Stealth tip `size` times the one on dimensions, as TikZ writes it. */
const stealth = (size: number): string =>
  `Stealth[length=${num(PAPER.arrowLen * size, 2)}mm, width=${num(PAPER.arrowWidth * size, 2)}mm, inset=${num(PAPER.arrowLen * size * 0.28, 2)}mm]`;

/** Which named tip a head is: the one on dimensions, the larger one on arrows, the small one on spread loads, or none of them. */
function tipName(p: LinePrim | ArcPrim): "tip" | "bigtip" | "smalltip" | null {
  const head = p.head ?? 1;
  const is = (size: number) => Math.abs(head - size) < 1e-9;
  return is(1) ? "tip" : is(PAPER.arrowScale) ? "bigtip" : is(PAPER.loadHead) ? "smalltip" : null;
}

/** Arrow tips as a TikZ option. A head of any other size than the two named ones is spelled out; `k` is the dimension size. */
function tips(p: LinePrim | ArcPrim, k: number): string {
  const t = tipName(p) ?? `{${stealth((p.head ?? 1) * k)}}`;
  if (p.arrowA && p.arrowB) return `, ${t}-${t}`;
  if (p.arrowA) return `, ${t}-`;
  if (p.arrowB) return `, -${t}`;
  return "";
}

/**
 * The figure as a tikzpicture, or null when there is nothing to draw. One
 * unit is one millimetre at a dimension size of 100%. Labels are passed to LaTeX as they were typed, so
 * they come out in the document's own font.
 */
export function toTikz(sk: Sketch): string | null {
  const fig = fitFigure(sk);
  return fig && primsToTikz(fig.prims, sk.dimScale, fig.page);
}

/**
 * The same for any list of primitives in annotation mm, enlarged `k` times on
 * paper. With `page`, the picture is exactly that size: LaTeX sets the text
 * itself, so its own measure of the picture could come out a little different.
 */
export function primsToTikz(prims: Prim[], k = 1, page?: Box): string | null {
  if (!prims.length) return null;
  const { styles, lines, needArrows, bentTip } = tikzParts(prims, k);
  if (page) lines.unshift(`  \\useasboundingbox ${co([page.x0, page.y0])} rectangle ${co([page.x1, page.y1])};`);
  // At another dimension size the whole picture is enlarged: the unit, the
  // widths and tips above, and the text, which TikZ scales node by node.
  const unit = `${num(k, 3)}mm`;
  if (k !== 1) styles.unshift(`every node/.style={scale=${num(k, 3)}}`);
  return (
    `% Made with Mech Sketch. Needs \\usepackage{tikz}${needArrows ? ` and \\usetikzlibrary{arrows.meta${bentTip ? ", bending" : ""}}` : ""}.\n` +
    `\\begin{tikzpicture}[x=${unit}, y=${unit}, line cap=round, line join=round,\n  ${styles.join(",\n  ")}]\n` +
    lines.join("\n") +
    // Held to its page, it ends in %, so the end of the line does not become a space that makes it wider.
    `\n\\end{tikzpicture}${page ? "%" : ""}\n`
  );
}

/**
 * Primitives as TikZ: the styles they use, and a line of the picture for
 * each. The units are left to whoever puts them in a picture: one is a
 * millimetre at a dimension size of 100%.
 */
export function tikzParts(prims: Prim[], k = 1): { styles: string[]; lines: string[]; needArrows: boolean; bentTip: boolean } {
  const used = new Set<StrokeStyle>();
  let needTip = false, needBigTip = false, needSmallTip = false, needArrows = false, needLabel = false;
  /** A tip sits on an arc: the bending library turns it to follow the curve. */
  let bentTip = false;
  const noteTip = (p: LinePrim | ArcPrim) => {
    needArrows = true;
    const name = tipName(p);
    if (name === "bigtip") needBigTip = true;
    else if (name === "smalltip") needSmallTip = true;
    else if (name === "tip") needTip = true;
  };
  /** A dash pattern as TikZ writes it. */
  const pattern = (dash: number[]): string => `, dash pattern=${dash.map((d, i) => `${i % 2 ? "off" : "on"} ${num(d * k, 2)}mm`).join(" ")}`;
  /** The style of a stroke, with its own thickness and its own dashes where it has them. */
  const style = (p: { stroke: StrokeStyle; width?: number; ink?: string; dash?: number[] }): string =>
    p.stroke + (p.width === undefined ? "" : `, line width=${num((p.width / PT_MM) * k, 2)}pt`) +
    // An arrow tip takes the colour of its line.
    (p.ink ? `, draw=${tikzColor(p.ink)}` : "") +
    (p.dash ? pattern(p.dash) : "");
  const lines: string[] = [];
  /** Plain line segments of one style and symbol in a row share a \draw. */
  let run: { style: string; ref: string | undefined; parts: string[] } | null = null;
  const flush = () => {
    if (run) lines.push(`  \\draw[${run.style}] ${run.parts.join(" ")};`);
    run = null;
  };

  for (const p of prims) {
    if (p.k === "image") continue; // a picture to trace over is never part of the figure
    if (p.k !== "text" && p.k !== "region") used.add(p.stroke);
    if (p.k === "line" && !p.arrowA && !p.arrowB) {
      if (!run || run.style !== style(p) || run.ref !== p.ref || run.parts.length >= 8) {
        flush();
        run = { style: style(p), ref: p.ref, parts: [] };
      }
      run.parts.push(`${co(p.a)} -- ${co(p.b)}`);
      continue;
    }
    flush();
    if (p.k === "region") {
      lines.push(`  \\fill[fill=${tikzColor(p.color)}, even odd rule] ${p.outlines.map(tikzOutline).join(" ")};`);
    } else if (p.k === "text") {
      const where = (p.anchor === "c" ? "inner sep=0pt" : `label, anchor=${TIKZ_ANCHOR[p.anchor]}`) +
        (p.rot ? `, rotate=${deg(p.rot)}` : "") +
        // A node breaks its text into lines only once it is told how to align them.
        (p.lines ? ", align=left" : "") +
        (p.ink ? `, text=${tikzColor(p.ink)}` : "");
      if (p.anchor !== "c") needLabel = true;
      // A note is text with math in it, a label is math; LaTeX takes accented letters in text only.
      const body = p.latex !== undefined ? latexAccents(p.latex, "text") : `$${latexAccents(p.tex, "math")}$`;
      lines.push(`  \\node[${where}] at ${co(p.at)} {${body}};`);
    } else if (p.k === "line") {
      noteTip(p);
      lines.push(`  \\draw[${style(p)}${tips(p, k)}] ${co(p.a)} -- ${co(p.b)};`);
    } else if (p.k === "arc") {
      if (p.arrowA || p.arrowB) {
        noteTip(p);
        bentTip = true;
      }
      lines.push(`  \\draw[${style(p)}${tips(p, k)}] ${co(polar(p.c, p.r, p.a0))} arc[start angle=${deg(p.a0)}, end angle=${deg(p.a1)}, radius=${num(p.r, 2)}];`);
    } else if (p.k === "bezier") {
      // A piece to a line of the file, so a long spline stays readable.
      const q = p.pts;
      const pieces: string[] = [];
      for (let i = 1; i + 2 < q.length; i += 3) pieces.push(`.. controls ${co(q[i])} and ${co(q[i + 1])} .. ${co(q[i + 2])}`);
      lines.push(`  \\draw[${style(p)}] ${co(q[0])} ${pieces.join("\n    ")};`);
    } else if (p.k === "path") {
      // A long curve is broken over lines of the file, so no line of it grows past what an editor shows.
      const rows: string[] = [];
      for (let i = 0; i < p.pts.length; i += 6) rows.push(p.pts.slice(i, i + 6).map(co).join(" -- "));
      lines.push(`  \\draw[${style(p)}] ${rows.join("\n    -- ")};`);
    } else {
      const fill = p.fill ? `, fill=${p.fill === "ink" ? (p.color ? tikzColor(p.color) : "black") : "white"}` : "";
      const shape = p.k === "circle" ? `${co(p.c)} circle[radius=${num(p.r, 2)}]` : `${p.pts.map(co).join(" -- ")} -- cycle`;
      lines.push(`  \\draw[${p.k === "circle" ? style(p) : style({ stroke: p.stroke, ink: p.ink })}${fill}] ${shape};`);
    }
  }
  flush();

  const styles: string[] = [];
  for (const s of Object.keys(TIKZ_WIDTH) as StrokeStyle[]) {
    if (!used.has(s)) continue;
    const dash = STROKE_DASH[s];
    styles.push(`${s}/.style={line width=${num(TIKZ_WIDTH[s] * k, 2)}pt${dash ? pattern(dash) : ""}}`);
  }
  if (needLabel) styles.push(`label/.style={inner sep=${num(PAPER.textSep, 2)}mm}`);
  const tip = (name: string, size: number) => styles.push(`${name}/.tip={${stealth(size)}}`);
  if (needTip) tip("tip", k);
  if (needBigTip) tip("bigtip", PAPER.arrowScale * k);
  if (needSmallTip) tip("smalltip", PAPER.loadHead * k);
  return { styles, lines, needArrows, bentTip };
}
