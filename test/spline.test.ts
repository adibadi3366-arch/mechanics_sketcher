// A spline: a smooth curve through the points clicked, written out as a run of
// cubic Bézier pieces.

import { describe, it, expect } from "vitest";
import { splineCubics, bezierAt, bezierTangent, type V } from "../src/geom";
import { emptySketch, addPoint, addLine, addSpline, addSymbol, remove, type Sketch } from "../src/model";
import { buildPrims } from "../src/prims";
import { regionAt } from "../src/regions";
import { toSvg, toTikz } from "../src/export";

const PTS: V[] = [[0, 0], [3, 2], [6, -1], [9, 1]];

describe("a spline's pieces", () => {
  it("run through every point, one piece from each to the next", () => {
    const q = splineCubics(PTS);
    expect(q).toHaveLength(3);
    q.forEach((c, i) => {
      expect(bezierAt(c, 0)).toEqual(PTS[i]);
      expect(bezierAt(c, 1)).toEqual(PTS[i + 1]);
    });
  });

  it("turn smoothly where they meet: no corner at a point", () => {
    const q = splineCubics(PTS);
    for (let i = 0; i + 1 < q.length; i++) {
      const a = bezierTangent(q[i], 1), b = bezierTangent(q[i + 1], 0);
      expect(a[0]).toBeCloseTo(b[0], 9);
      expect(a[1]).toBeCloseTo(b[1], 9);
    }
  });

  it("close back to the first point, smoothly there too", () => {
    const q = splineCubics(PTS, true);
    expect(q).toHaveLength(4);
    expect(bezierAt(q[3], 1)).toEqual(PTS[0]);
    const a = bezierTangent(q[3], 1), b = bezierTangent(q[0], 0);
    expect(a[0]).toBeCloseTo(b[0], 9);
    expect(a[1]).toBeCloseTo(b[1], 9);
  });
});

function sketch(closed = false): { sk: Sketch; ids: string[]; id: string } {
  const sk = emptySketch();
  const ids = PTS.map(([x, y]) => addPoint(sk, x, y).id);
  return { sk, ids, id: addSpline(sk, ids, closed).id };
}

describe("a spline in a drawing", () => {
  it("is written as one curve of chained pieces to SVG and TikZ", () => {
    const { sk } = sketch();
    const path = /<path d="(M[^"]+)"/.exec(toSvg(sk)!)![1];
    expect(path.match(/C/g)).toHaveLength(3);
    expect(toTikz(sk)!.match(/\.\. controls/g)).toHaveLength(3);
  });

  it("closed, bounds a region that can be filled", () => {
    const sk = emptySketch();
    const ring: V[] = [[0, 0], [10, 0], [10, 10], [0, 10]];
    const ids = ring.map(([x, y]) => addPoint(sk, x, y).id);
    addSpline(sk, ids, true);
    const region = regionAt(sk, [5, 5]);
    expect(region?.kind).toBe("face");
    if (region?.kind !== "face") return;
    expect(region.face.points).toHaveLength(4);
    // The spline bulges past its points, so the region is bigger than the square through them.
    expect(region.face.area).toBeGreaterThan(100);
    addSymbol(sk, { type: "fill", color: "#d5dbe1", points: region.face.points, arcs: region.face.arcs, curves: region.face.curves, holes: [] });
    const fill = buildPrims(sk, 1, { editor: false }).find((p) => p.k === "region");
    expect(fill).toBeDefined();
    expect(JSON.stringify(fill)).toContain('"C"');
  });

  it("with a line, bounds a region between them", () => {
    const sk = emptySketch();
    const a = addPoint(sk, 0, 0), m = addPoint(sk, 5, 4), b = addPoint(sk, 10, 0);
    addSpline(sk, [a.id, m.id, b.id]);
    addLine(sk, a.id, b.id);
    expect(regionAt(sk, [5, 1])?.kind).toBe("face");
  });

  it("runs through the points it has left when one of them is deleted", () => {
    const { sk, ids, id } = sketch();
    remove(sk, [ids[1]]);
    const s = sk.entities.find((e) => e.id === id);
    expect(s?.type === "spline" && s.pts).toEqual([ids[0], ids[2], ids[3]]);
    remove(sk, [ids[2], ids[3]]);
    expect(sk.entities.some((e) => e.id === id)).toBe(false);
  });
});
