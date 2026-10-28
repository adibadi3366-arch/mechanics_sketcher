// Bringing in an SVG drawing from elsewhere, to annotate it.

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { importSvg, parsePath, parseXml } from "../src/svgimport";
import { hatchStrokes, buildPrims } from "../src/prims";
import { emptySketch, addPoint, addLine, addArc, addCircle, addBezier, addSymbol, type Sketch } from "../src/model";
import { regionAt } from "../src/regions";
import { toSvg, toTikz } from "../src/export";

const bracket = readFileSync(new URL("./fixtures/bracket.svg", import.meta.url), "utf8");

describe("reading SVG", () => {
  it("reads elements, attributes and style sheets, passing over comments", () => {
    const doc = parseXml(`<?xml version="1.0"?><!-- c --><svg a="1"><g><path d='M0 0'/></g><style>.x{stroke:red}</style></svg>`);
    const svg = doc.children[0];
    expect(svg.name).toBe("svg");
    expect(svg.attrs.a).toBe("1");
    expect(svg.children[0].children[0].attrs.d).toBe("M0 0");
    expect(svg.children[1].text).toBe(".x{stroke:red}");
  });

  it("reads path data, relative, shorthand and run together", () => {
    const p = parsePath("m10 10h5v5l-5 0z M0 0q10 10 20 0t20 0 a5 5 0 0110 0");
    expect(p.filter((x) => x.k === "L")).toHaveLength(4);
    expect(p.filter((x) => x.k === "C")).toHaveLength(2);
    const a = p.find((x) => x.k === "A")!;
    expect(a.k === "A" && a.sweep && !a.large).toBe(true);
  });
});

describe("a drawing brought in", () => {
  const d = importSvg(bracket);

  it("keeps what is stroked, in mm on its paper, and leaves out text and filled shapes", () => {
    // Outline: 4 straight sides and the rounded corner; the rib; the slot's 4 sides; the centre lines; the dimension line.
    expect(d.lines.length).toBe(4 + 1 + 4 + 2 + 1);
    expect(d.arcs).toHaveLength(1);
    expect(d.circles).toHaveLength(1);
    expect(d.beziers).toHaveLength(1);
    expect(d.skipped.get("text")).toBe(1);
    expect(d.skipped.get("filled shapes (arrowheads, letters)")).toBe(2);
    // 1200 units across 120 mm: a unit is a tenth of a mm, and the plate is 80 mm wide.
    const xs = d.points.map((p) => p[0]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(80, 6);
    expect(d.circles[0].r).toBeCloseTo(9, 9);
    // y points up: the dimension line, above the plate, is the highest thing on the paper.
    const top = Math.max(...d.points.map((p) => p[1]));
    expect(top).toBeCloseTo(-6, 6);
  });

  it("keeps the look: thick, dashed and centre lines", () => {
    const hidden = d.lines.filter((l) => l.style.dashed);
    expect(hidden).toHaveLength(4);
    expect(d.lines.filter((l) => l.style.centre)).toHaveLength(2);
    // 5 units is 0.5 mm, about 1.42 pt.
    expect(d.lines[0].style.weight).toBeCloseTo(0.5 / 0.3515, 2);
  });

  it("joins ends that meet, and turns the arc counter-clockwise on paper", () => {
    // The outline's corners are shared: its 4 straight sides end in 5 corners, two of them the rounded corner's ends.
    const outline = d.lines.slice(0, 4);
    const used = new Set(outline.flatMap((l) => [l.a, l.b]));
    expect(used.size).toBe(5);
    expect(used.has(d.arcs[0].p1) && used.has(d.arcs[0].p2)).toBe(true);
    const arc = d.arcs[0], c = d.points[arc.c], p1 = d.points[arc.p1], p2 = d.points[arc.p2];
    const turn = (p1[0] - c[0]) * (p2[1] - c[1]) - (p1[1] - c[1]) * (p2[0] - c[0]);
    expect(turn).toBeGreaterThan(0);
  });

  it("puts points where curves cross, so the regions they make can be filled", () => {
    // The centre lines cross the hole four times; where they cross each other is the hole's centre, a point already.
    expect(d.crossings.size).toBe(4);
    const sk = toSketch(d);
    // Inside the plate, left of the rib and clear of the hole: a region bounded by the outline and the rib.
    const left = regionAt(sk, [10 + 10, -10 - 40]);
    expect(left?.kind).toBe("face");
    // Right of the rib, the same.
    expect(regionAt(sk, [10 + 70, -10 - 45])?.kind).toBe("face");
  });
});

/** An imported drawing as a sketch, as the app makes it. */
function toSketch(d: ReturnType<typeof importSvg>): Sketch {
  const sk = emptySketch();
  const ids = d.points.map(([x, y], i) => { const p = addPoint(sk, x, y, d.crossings.has(i)); p.locked = true; return p.id; });
  for (const l of d.lines) addLine(sk, ids[l.a], ids[l.b]).centre = l.style.centre;
  for (const a of d.arcs) addArc(sk, ids[a.c], ids[a.p1], ids[a.p2]);
  for (const c of d.circles) addCircle(sk, ids[c.c], c.r);
  for (const b of d.beziers) addBezier(sk, ids[b.p1], ids[b.c1], ids[b.c2], ids[b.p2]);
  return sk;
}

describe("hatching a region", () => {
  it("fills a square with strokes the right way and the right distance apart, inside it only", () => {
    const square = [{ kind: "path" as const, start: [0, 0] as [number, number], segs: [{ k: "L" as const, to: [10, 0] as [number, number] }, { k: "L" as const, to: [10, 10] as [number, number] }, { k: "L" as const, to: [0, 10] as [number, number] }, { k: "L" as const, to: [0, 0] as [number, number] }] }];
    const strokes = hatchStrokes(square, Math.PI / 4, 2);
    expect(strokes.length).toBeGreaterThan(5);
    for (const [a, b] of strokes) {
      for (const q of [a, b]) {
        expect(q[0]).toBeGreaterThan(-1e-9);
        expect(q[0]).toBeLessThan(10 + 1e-9);
        expect(q[1]).toBeGreaterThan(-1e-9);
        expect(q[1]).toBeLessThan(10 + 1e-9);
      }
      expect(Math.abs((b[1] - a[1]) - (b[0] - a[0]))).toBeLessThan(1e-9); // at 45 degrees
    }
    // Neighbouring strokes are 2 apart, measured square to them.
    const offsets = strokes.map(([a]) => (a[1] - a[0]) / Math.SQRT2).sort((p, q) => p - q);
    for (let i = 1; i < offsets.length; i++) expect(offsets[i] - offsets[i - 1]).toBeCloseTo(2, 9);
  });

  it("goes into the figure as strokes, over the colour or on their own", () => {
    const sk = emptySketch();
    const p = [addPoint(sk, 0, 0), addPoint(sk, 4, 0), addPoint(sk, 4, 4), addPoint(sk, 0, 4)];
    for (let i = 0; i < 4; i++) addLine(sk, p[i].id, p[(i + 1) % 4].id);
    addSymbol(sk, { type: "fill", color: "#d5dbe1", points: p.map((x) => x.id), arcs: [null, null, null, null], curves: [], holes: [], look: "hatch" });
    const prims = buildPrims(sk, 10, { editor: false });
    expect(prims.some((x) => x.k === "region")).toBe(false);
    expect(prims.filter((x) => x.k === "line" && x.stroke === "hatch").length).toBeGreaterThan(10);
    expect(toTikz(sk)).toContain("hatch/.style");
  });
});

describe("a Bézier curve", () => {
  it("is written as a curve to SVG and TikZ", () => {
    const sk = emptySketch();
    addBezier(sk, addPoint(sk, 0, 0).id, addPoint(sk, 1, 2).id, addPoint(sk, 3, 2).id, addPoint(sk, 4, 0).id);
    expect(toSvg(sk)).toMatch(/<path d="M[\d.]+ [\d.]+C/);
    expect(toTikz(sk)).toMatch(/\.\. controls \([\d.,-]+\) and \([\d.,-]+\) \.\./);
  });
});
