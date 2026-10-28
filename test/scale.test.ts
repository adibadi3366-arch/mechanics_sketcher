// Relative dimensions: the first length dimension says what the drawing is
// worth, and every later one is measured against it.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { make_gcs_wrapper } from "@salusoft89/planegcs";
import { SketchSolver } from "../src/solver";
import {
  emptySketch, addPoint, addLine, addCircle, addConstraint, addSymbol, serialize, deserialize, unitScale,
  type Sketch, type Etalon,
} from "../src/model";
import { settleLengthScale, measuredDimValue, etalonTex, buildPrims, SHORT_SPAN, type LinePrim } from "../src/prims";

let solver: SketchSolver;
beforeAll(async () => { solver = new SketchSolver(await make_gcs_wrapper()); });
afterAll(() => solver.dispose());

/** An L of two lines from a fixed corner, 9 units across and 5 up, as drawn: nothing sized yet. */
function ell() {
  const sk = emptySketch();
  const o = addPoint(sk, 0, 0), a = addPoint(sk, 9, 0), b = addPoint(sk, 0, 5);
  addLine(sk, o.id, a.id);
  addLine(sk, o.id, b.id);
  addConstraint(sk, { type: "fixed", p: o.id });
  addConstraint(sk, { type: "horizontal", a: o.id, b: a.id });
  addConstraint(sk, { type: "vertical", a: o.id, b: b.id });
  return { sk, o, a, b };
}

describe("the scale", () => {
  it("is set by the first length dimension at what its line is drawn, so nothing moves", () => {
    const { sk, a, o } = ell();
    addConstraint(sk, { type: "distance", a: o.id, b: a.id, mode: "aligned", value: 9, offset: -1 });
    settleLengthScale(sk);
    expect(sk.lengthScale).toBe(1);
    // Typed as 200, it says what the line is worth.
    (sk.constraints.at(-1) as { value: number }).value = 200;
    sk.lengthScale = 200 / 9;
    expect(solver.solve(sk).ok).toBe(true);
    expect(a.x).toBeCloseTo(9, 9);
  });

  it("sizes every later dimension against the first", () => {
    const { sk, a, b, o } = ell();
    addConstraint(sk, { type: "distance", a: o.id, b: a.id, mode: "aligned", value: 200, offset: -1 });
    sk.lengthScale = 200 / 9;
    addConstraint(sk, { type: "distance", a: o.id, b: b.id, mode: "vertical", value: 150, offset: -1 });
    expect(solver.solve(sk).ok).toBe(true);
    expect(a.x).toBeCloseTo(9, 6);
    // 150 against 200: three quarters of the first line.
    expect(b.y).toBeCloseTo(9 * 0.75, 6);
  });

  it("holds radii to it too, and leaves angles alone", () => {
    const sk = emptySketch();
    const c = addPoint(sk, 0, 0);
    const circle = addCircle(sk, c.id, 2);
    sk.lengthScale = 10;
    addConstraint(sk, { type: "radius", target: circle.id, value: 35, angle: 0 });
    expect(solver.solve(sk).ok).toBe(true);
    expect(circle.r).toBeCloseTo(3.5, 6);
  });

  it("goes when the last length dimension does, and the next one sets a new one", () => {
    const { sk, a, o } = ell();
    sk.lengthScale = 22;
    settleLengthScale(sk);
    expect(sk.lengthScale).toBeUndefined();
    expect(unitScale(sk)).toBe(1);
    addConstraint(sk, { type: "distance", a: o.id, b: a.id, mode: "aligned", value: 45, offset: -1 });
    settleLengthScale(sk);
    expect(sk.lengthScale).toBeCloseTo(5, 9);
  });

  it("is not set by a measure, which drives nothing", () => {
    const { sk, a, o } = ell();
    addConstraint(sk, { type: "distance", a: o.id, b: a.id, mode: "aligned", value: 9, offset: -1, measure: true });
    settleLengthScale(sk);
    expect(sk.lengthScale).toBeUndefined();
  });

  it("is what measures and etalons are shown in", () => {
    const { sk, a, o } = ell();
    const m = addConstraint(sk, { type: "distance", a: o.id, b: a.id, mode: "aligned", value: 9, offset: -1, measure: true });
    sk.lengthScale = 20;
    expect(measuredDimValue(sk, m as never)).toBeCloseTo(180, 9);
    const e = addSymbol(sk, { type: "etalon", x: 0, y: -3, angle: 0, length: 2.5, label: "" }) as Etalon;
    expect(etalonTex(sk, e)).toBe("50");
    e.label = "1\\,\\mathrm{m}";
    expect(etalonTex(sk, e)).toBe("1\\,\\mathrm{m}");
  });
});

describe("files", () => {
  const withDims = (): Sketch => {
    const { sk, a, o } = ell();
    addConstraint(sk, { type: "distance", a: o.id, b: a.id, mode: "aligned", value: 9, offset: -1 });
    return sk;
  };

  it("keep their scale", () => {
    const sk = withDims();
    sk.lengthScale = 22.5;
    expect(deserialize(serialize(sk)).lengthScale).toBe(22.5);
  });

  it("from before the scale dimension in the drawing's own units", () => {
    const old = JSON.parse(serialize(withDims()));
    delete old.lengthScale;
    expect(deserialize(JSON.stringify(old)).lengthScale).toBe(1);
  });

  it("with no length dimension have no scale", () => {
    expect(deserialize(serialize(ell().sk)).lengthScale).toBeUndefined();
  });
});

describe("a short dimension", () => {
  it("has its arrowheads outside the extension lines when they do not fit between them", () => {
    const sk = emptySketch();
    const a = addPoint(sk, 0, 0), b = addPoint(sk, 1, 0);
    addLine(sk, a.id, b.id);
    addConstraint(sk, { type: "distance", a: a.id, b: b.id, mode: "aligned", value: 1, offset: -1 });
    const heads = (mm: number) => buildPrims(sk, mm, { editor: false })
      .filter((p): p is LinePrim => p.k === "line" && p.stroke === "dim" && !!(p.arrowA || p.arrowB));
    // Long enough: one line with a head at each end.
    const long = heads(SHORT_SPAN * 2);
    expect(long).toHaveLength(1);
    expect(long[0].arrowA && long[0].arrowB).toBe(true);
    // Too short: a head comes in from each side, pointing at the extension line.
    const short = heads(SHORT_SPAN * 0.6);
    expect(short).toHaveLength(2);
    const [left, right] = short.sort((p, q) => p.a[0] - q.a[0]);
    expect(left.b[0]).toBeCloseTo(0, 9);
    expect(left.a[0]).toBeLessThan(0);
    expect(right.b[0]).toBeCloseTo(SHORT_SPAN * 0.6, 9);
    expect(right.a[0]).toBeGreaterThan(right.b[0]);
  });
});
