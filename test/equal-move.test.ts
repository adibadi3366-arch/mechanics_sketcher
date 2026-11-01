// Dimensions held equal; geometry moved between sketches; notes turned;
// arrowheads on curves.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { make_gcs_wrapper } from "@salusoft89/planegcs";
import { SketchSolver } from "../src/solver";
import {
  emptySketch, addPoint, addLine, addCircle, addConstraint, addSymbol, addSpline, remove, point, entity,
  measuredValue, sameValueGroups, type Sketch, type Dimension,
} from "../src/model";
import { splitDrawing, mergeDrawing, activePart, moveToPart } from "../src/parts";
import { buildPrims, arrowHeads, strokedChain, type BezierPrim } from "../src/prims";
import { toSvg, toTikz } from "../src/export";
import { chainCubics, chainLength } from "../src/geom";

let solver: SketchSolver;
beforeAll(async () => { solver = new SketchSolver(await make_gcs_wrapper()); });
afterAll(() => solver.dispose());

/** Two loose lines, each from a fixed start along x. */
function twoLines(): { sk: Sketch; a: [string, string]; b: [string, string] } {
  const sk = emptySketch();
  const a0 = addPoint(sk, 0, 0), a1 = addPoint(sk, 3, 0), b0 = addPoint(sk, 0, 2), b1 = addPoint(sk, 5, 2);
  addLine(sk, a0.id, a1.id);
  addLine(sk, b0.id, b1.id);
  for (const p of [a0, b0]) addConstraint(sk, { type: "fixed", p: p.id });
  addConstraint(sk, { type: "horizontal", a: a0.id, b: a1.id });
  addConstraint(sk, { type: "horizontal", a: b0.id, b: b1.id });
  return { sk, a: [a0.id, a1.id], b: [b0.id, b1.id] };
}
const length = (sk: Sketch, [p, q]: [string, string]) => Math.hypot(point(sk, q).x - point(sk, p).x, point(sk, q).y - point(sk, p).y);

describe("dimensions held equal", () => {
  it("drive both lengths with the first one's value", () => {
    const { sk, a, b } = twoLines();
    const da = addConstraint(sk, { type: "distance", a: a[0], b: a[1], mode: "aligned", value: 4, offset: 1 });
    const db = addConstraint(sk, { type: "distance", a: b[0], b: b[1], mode: "aligned", value: 4, offset: 1 });
    addConstraint(sk, { type: "sameValue", a: da.id, b: db.id });
    const r = solver.solve(sk);
    expect(r.ok).toBe(true);
    expect(r.dof).toBe(0);
    expect(length(sk, a)).toBeCloseTo(4, 6);
    expect(length(sk, b)).toBeCloseTo(4, 6);
  });

  it("hold a measure's geometry to a dimension", () => {
    const { sk, a, b } = twoLines();
    addConstraint(sk, { type: "distance", a: a[0], b: a[1], mode: "aligned", value: 6, offset: 1 });
    const m = addConstraint(sk, { type: "distance", a: b[0], b: b[1], mode: "horizontal", value: 5, offset: 1, measure: true });
    const before = solver.solve(sk);
    expect(before.dof).toBe(1);
    expect(length(sk, b)).toBeCloseTo(5, 6);
    addConstraint(sk, { type: "sameValue", a: sk.constraints.find((c) => c.type === "distance" && !c.measure)!.id, b: m.id });
    const r = solver.solve(sk);
    expect(r.ok).toBe(true);
    expect(r.dof).toBe(0);
    expect(length(sk, b)).toBeCloseTo(6, 6);
  });

  it("make two measures one unknown: equal, and free together", () => {
    const { sk, a, b } = twoLines();
    const ma = addConstraint(sk, { type: "distance", a: a[0], b: a[1], mode: "aligned", value: 3, offset: 1, measure: true });
    const mb = addConstraint(sk, { type: "distance", a: b[0], b: b[1], mode: "aligned", value: 5, offset: 1, measure: true });
    addConstraint(sk, { type: "sameValue", a: ma.id, b: mb.id });
    const r = solver.solve(sk);
    expect(r.ok).toBe(true);
    expect(r.dof).toBe(1);
    expect(length(sk, a)).toBeCloseTo(length(sk, b), 6);
  });

  it("equal a radius and a length, through a chain of three", () => {
    const { sk, a } = twoLines();
    const c = addCircle(sk, addPoint(sk, 10, 0).id, 1);
    addConstraint(sk, { type: "fixed", p: c.c });
    const d1 = addConstraint(sk, { type: "distance", a: a[0], b: a[1], mode: "aligned", value: 2.5, offset: 1 });
    const r1 = addConstraint(sk, { type: "radius", target: c.id, value: 1, angle: 0, measure: true });
    const other = addCircle(sk, c.c, 3);
    const r2 = addConstraint(sk, { type: "radius", target: other.id, value: 3, angle: 1, measure: true });
    addConstraint(sk, { type: "sameValue", a: d1.id, b: r1.id });
    addConstraint(sk, { type: "sameValue", a: r1.id, b: r2.id });
    expect(sameValueGroups(sk)).toHaveLength(1);
    expect(solver.solve(sk).ok).toBe(true);
    expect(c.r).toBeCloseTo(2.5, 6);
    expect((entity(sk, other.id) as { r: number }).r).toBeCloseTo(2.5, 6);
  });

  it("go when one of the two dimensions is deleted", () => {
    const { sk, a, b } = twoLines();
    const da = addConstraint(sk, { type: "distance", a: a[0], b: a[1], mode: "aligned", value: 4, offset: 1 });
    const db = addConstraint(sk, { type: "distance", a: b[0], b: b[1], mode: "aligned", value: 4, offset: 1 });
    const same = addConstraint(sk, { type: "sameValue", a: da.id, b: db.id });
    remove(sk, [db.id]);
    expect(sk.constraints.some((c) => c.id === same.id)).toBe(false);
    expect(sk.constraints.some((c) => c.id === da.id)).toBe(true);
  });

  it("keep the value of a horizontal distance whichever way round its points are", () => {
    const { sk, a, b } = twoLines();
    // b runs right to left from its fixed end: the distance is still positive.
    const da = addConstraint(sk, { type: "distance", a: a[0], b: a[1], mode: "aligned", value: 4, offset: 1 });
    const db = addConstraint(sk, { type: "distance", a: b[1], b: b[0], mode: "horizontal", value: 9, offset: 1, measure: true });
    addConstraint(sk, { type: "sameValue", a: da.id, b: db.id });
    expect(solver.solve(sk).ok).toBe(true);
    expect(measuredValue(sk, db as Dimension)).toBeCloseTo(4, 6);
  });
});

/** Two sketches: a square in the first, the second empty. */
function squareDrawing() {
  const sk = emptySketch();
  const p = [addPoint(sk, 0, 0), addPoint(sk, 4, 0), addPoint(sk, 4, 4), addPoint(sk, 0, 4)];
  const sides = p.map((q, i) => addLine(sk, q.id, p[(i + 1) % 4].id));
  addConstraint(sk, { type: "horizontal", a: p[0].id, b: p[1].id });
  addConstraint(sk, { type: "vertical", a: p[1].id, b: p[2].id });
  const top = addConstraint(sk, { type: "horizontal", a: p[2].id, b: p[3].id });
  const parallel = addConstraint(sk, { type: "parallel", l1: sides[0].id, l2: sides[2].id });
  const tip = addPoint(sk, 6, 6);
  const spur = addLine(sk, p[2].id, tip.id);
  const spurLen = addConstraint(sk, { type: "distance", a: p[2].id, b: tip.id, mode: "aligned", value: Math.hypot(2, 2), offset: 1 });
  sk.sketches = [{ id: "d1", name: "First" }, { id: "d2", name: "Second" }];
  sk.active = "d1";
  return { sk, p, sides, tip, spur, spurLen, top, parallel };
}

describe("moving geometry to another sketch", () => {
  it("takes the curves with what is only about them, and leaves a projected copy of a shared point", () => {
    const { sk, p, tip, spur, spurLen } = squareDrawing();
    const d = splitDrawing(sk);
    const first = activePart(d).sk;
    const report = moveToPart(d, first, [spur.id], "d2")!;
    expect(report).toEqual({ moved: 2, curves: 1, symbols: 0, copied: 1, dropped: 0 });
    const second = d.parts[1].sk;
    // The spur and its far end went; its near end stays with the square, and a copy of it follows it there.
    expect(entity(first, spur.id)).toBeUndefined();
    expect(entity(first, p[2].id)).toBeDefined();
    expect(entity(second, spur.id)).toBeDefined();
    expect(entity(second, tip.id)).toBeDefined();
    const line = entity(second, spur.id) as { p1: string };
    const copy = entity(second, line.p1) as { ref?: string };
    expect(line.p1).not.toBe(p[2].id);
    expect(copy.ref).toBe(p[2].id);
    // Its length went with it, onto the copy.
    const len = second.constraints.find((c) => c.id === spurLen.id) as { a: string } | undefined;
    expect(len?.a).toBe(line.p1);
    expect(solver.solve(second).ok).toBe(true);
  });

  it("drops the constraints that tie what goes to what stays", () => {
    const { sk, sides, top, parallel } = squareDrawing();
    const d = splitDrawing(sk);
    const first = activePart(d).sk;
    const report = moveToPart(d, first, [sides[2].id], "d2")!;
    // The top's horizontal is held between its ends, which stay with the sides: it stays too. The parallel to the bottom cannot go.
    expect(first.constraints.some((c) => c.id === top.id)).toBe(true);
    expect(first.constraints.some((c) => c.id === parallel.id)).toBe(false);
    expect(d.parts[1].sk.constraints.some((c) => c.id === parallel.id)).toBe(false);
    expect(report.dropped).toBe(1);
    // Both its ends are shared with the sides that stay.
    expect(report.copied).toBe(2);
  });

  it("copies plainly to an earlier sketch, which cannot project from a later one", () => {
    const { sk, spur } = squareDrawing();
    sk.active = "d2";
    const d = splitDrawing(sk);
    // Everything is in the first sketch; work on the second and move the spur back... from the first, to make it later:
    d.active = "d1";
    const first = d.parts[0].sk;
    d.parts.reverse();
    const report = moveToPart(d, first, [spur.id], "d2")!;
    const second = d.parts[0].sk;
    const line = entity(second, spur.id) as { p1: string };
    expect(report.copied).toBe(1);
    expect((entity(second, line.p1) as { ref?: string }).ref).toBeUndefined();
  });

  it("keeps the drawing whole: merged and split again, nothing is lost", () => {
    const { sk, spur } = squareDrawing();
    const d = splitDrawing(sk);
    const first = activePart(d).sk;
    const ids = (s: Sketch) => s.entities.length + s.constraints.length;
    const before = ids(mergeDrawing(d, first));
    moveToPart(d, first, [spur.id], "d2");
    const again = splitDrawing(mergeDrawing(d, first));
    expect(ids(mergeDrawing(again, again.parts[0].sk))).toBe(before + 1); // the copy of the shared point
    expect(again.parts[1].sk.entities.some((e) => e.id === spur.id)).toBe(true);
  });
});

describe("a turned note", () => {
  it("is turned in the editor, in SVG and in TikZ", () => {
    const sk = emptySketch();
    addLine(sk, addPoint(sk, 0, 0).id, addPoint(sk, 10, 0).id);
    addSymbol(sk, { type: "note", x: 2, y: 2, text: "Hello", angle: Math.PI / 2 });
    const text = buildPrims(sk, 10, { editor: false }).find((p) => p.k === "text");
    expect(text?.k === "text" && text.rot).toBeCloseTo(Math.PI / 2, 9);
    expect(toSvg(sk)).toMatch(/rotate\(-90/);
    expect(toTikz(sk)).toMatch(/rotate=90/);
  });
});

describe("arrowheads on a spline", () => {
  function arrowed(ends: "end" | "start" | "both") {
    const sk = emptySketch();
    const ids = [[0, 0], [10, 6], [20, 0], [30, 4]].map(([x, y]) => addPoint(sk, x, y).id);
    const s = addSpline(sk, ids);
    s.arrow = ends;
    return sk;
  }

  it("draws a head at each end asked for, pointing on along the curve", () => {
    const prim = buildPrims(arrowed("both"), 1, { editor: false }).find((p): p is BezierPrim => p.k === "bezier")!;
    const heads = arrowHeads(prim);
    expect(heads).toHaveLength(2);
    expect(heads[1][0]).toEqual([30, 4]);
    // The end's head points right, on from where the curve comes in.
    const back = heads[1][2];
    expect(back[0]).toBeLessThan(30);
  });

  it("stops the stroke inside the head, as on a straight arrow", () => {
    const prim = buildPrims(arrowed("end"), 1, { editor: false }).find((p): p is BezierPrim => p.k === "bezier")!;
    const whole = chainLength(chainCubics(prim.pts)), cut = chainLength(chainCubics(strokedChain(prim)));
    expect(cut).toBeLessThan(whole);
    expect(whole - cut).toBeGreaterThan(0.5);
    expect(strokedChain(prim)[0]).toEqual(prim.pts[0]);
  });

  it("exports the head to SVG and as a TikZ tip", () => {
    const sk = arrowed("start");
    expect(toSvg(sk)).toMatch(/<polygon points=/);
    expect(toTikz(sk)).toMatch(/\\draw\[[^\]]*bigtip-\]/);
  });

  it("is no edge of a fill", () => {
    const sk = arrowed("end");
    expect(buildPrims(sk, 1, { editor: false }).filter((p) => p.k === "bezier")).toHaveLength(1);
  });
});
