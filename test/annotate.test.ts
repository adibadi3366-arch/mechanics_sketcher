// The colour of lines, measures, etalons and the mark of a right angle.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { make_gcs_wrapper } from "@salusoft89/planegcs";
import { SketchSolver } from "../src/solver";
import { emptySketch, addPoint, addLine, addCircle, addConstraint, addSymbol, remove, point, serialize, deserialize, type Sketch } from "../src/model";
import { buildPrims, measuredValue, MEASURE_INK, etalonEnds, rightAngleFrame, PAPER, type Prim } from "../src/prims";
import { toSvg, toTikz, figurePrims } from "../src/export";

let solver: SketchSolver;
beforeAll(async () => { solver = new SketchSolver(await make_gcs_wrapper()); });
afterAll(() => solver.dispose());

const RED = "#d32f2f";
/** A right-angled corner: a horizontal line from (0, 0) to (4, 0) and an upright one from (0, 0) to (0, 3). */
function corner(): { sk: Sketch; h: string; v: string; o: string; x: string; y: string } {
  const sk = emptySketch();
  const o = addPoint(sk, 0, 0), x = addPoint(sk, 4, 0), y = addPoint(sk, 0, 3);
  const h = addLine(sk, o.id, x.id), v = addLine(sk, o.id, y.id);
  return { sk, h: h.id, v: v.id, o: o.id, x: x.id, y: y.id };
}
const of = (prims: Prim[], ref: string) => prims.filter((p) => p.ref === ref);

describe("coloured curves", () => {
  it("draws a line, an arrow's head and its name in its colour, in the editor and in both exports", () => {
    const { sk, h, v } = corner();
    const line = sk.entities.find((e) => e.id === h)!;
    if (line.type === "line") line.color = RED;
    const arrow = sk.entities.find((e) => e.id === v)!;
    if (arrow.type === "line") { arrow.arrow = "end"; arrow.label = "F"; arrow.color = "#1565c0"; }
    const prims = buildPrims(sk, 10, { editor: true });
    expect(of(prims, h).every((p) => p.ink === RED)).toBe(true);
    expect(of(prims, v).map((p) => p.ink)).toEqual(["#1565c0", "#1565c0"]);
    expect(toSvg(sk)).toContain(`stroke="${RED}"`);
    expect(toSvg(sk)).toContain(`fill="#1565c0"`);
    expect(toTikz(sk)).toMatch(/draw=\{rgb,255:red,211;green,47;blue,47\}/);
    expect(toTikz(sk)).toMatch(/text=\{rgb,255:red,21;green,101;blue,192\}/);
  });

  it("leaves a construction line in the editor's colours", () => {
    const { sk, h } = corner();
    const line = sk.entities.find((e) => e.id === h)!;
    if (line.type === "line") { line.color = RED; line.construction = true; }
    expect(of(buildPrims(sk, 10, { editor: true }), h)[0].ink).toBeUndefined();
  });

  it("is kept in a saved file", () => {
    const sk = emptySketch();
    const c = addCircle(sk, addPoint(sk, 0, 0).id, 2);
    c.color = RED;
    expect(deserialize(serialize(sk)).entities.find((e) => e.id === c.id)).toMatchObject({ color: RED });
  });
});

describe("measures", () => {
  it("shows what the geometry measures now, in brackets, in the editor only", () => {
    const { sk, o, x } = corner();
    const m = addConstraint(sk, { type: "distance", a: o, b: x, mode: "aligned", value: 4, offset: -1, measure: true });
    const shown = of(buildPrims(sk, 10, { editor: true }), m.id);
    expect(shown.every((p) => p.ink === MEASURE_INK)).toBe(true);
    expect(shown.find((p) => p.k === "text")).toMatchObject({ tex: "(4)" });
    // Moved, the geometry is measured again; the value it was made with does not matter.
    point(sk, x).x = 6.5;
    expect(measuredValue(sk, m)).toBeCloseTo(6.5, 12);
    expect(of(buildPrims(sk, 10, { editor: true }), m.id).find((p) => p.k === "text")).toMatchObject({ tex: "(6.5)" });
    expect(of(figurePrims(sk), m.id)).toEqual([]);
    expect(toTikz(sk)).not.toContain("6.5");
  });

  it("measures angles and radii too", () => {
    const { sk, h, v } = corner();
    const a = addConstraint(sk, { type: "angle", l1: h, rev1: false, l2: v, rev2: false, value: 0, radius: 1, measure: true });
    expect(measuredValue(sk, a)).toBeCloseTo(Math.PI / 2, 12);
    expect(of(buildPrims(sk, 10, { editor: true }), a.id).find((p) => p.k === "text")).toMatchObject({ tex: "(90^\\circ)" });
    const c = addCircle(sk, addPoint(sk, 10, 10).id, 2.5);
    const r = addConstraint(sk, { type: "radius", target: c.id, value: 1, angle: 0, measure: true });
    expect(measuredValue(sk, r)).toBe(2.5);
  });

  it("holds nothing: the solver leaves the geometry as free as it was", () => {
    const { sk, o, x } = corner();
    addConstraint(sk, { type: "fixed", p: o });
    const before = solver.solve(sk).dof;
    addConstraint(sk, { type: "distance", a: o, b: x, mode: "aligned", value: 99, offset: 1, measure: true });
    const after = solver.solve(sk);
    expect(after.ok).toBe(true);
    expect(after.dof).toBe(before);
    expect(point(sk, x).x).toBeCloseTo(4, 9);
  });
});

describe("etalons", () => {
  it("is a bar with a tick at each end and between its parts, and its length as its name", () => {
    const sk = emptySketch();
    const e = addSymbol(sk, { type: "etalon", x: 1, y: 2, angle: 0, length: 5, label: "" });
    let prims = of(buildPrims(sk, 10, { editor: false }), e.id);
    expect(prims.filter((p) => p.k === "line")).toHaveLength(3);
    expect(prims.find((p) => p.k === "text")).toMatchObject({ tex: "5", anchor: "s" });
    const [a, b] = etalonEnds(e, 10);
    expect(a).toEqual([10, 20]);
    expect(b[0]).toBeCloseTo(60, 9);
    e.parts = 5;
    e.label = "1\\,\\mathrm{m}";
    prims = of(buildPrims(sk, 10, { editor: false }), e.id);
    expect(prims.filter((p) => p.k === "line")).toHaveLength(7);
    expect(prims.find((p) => p.k === "text")).toMatchObject({ tex: "1\\,\\mathrm{m}" });
    expect(toTikz(sk)).toContain("\\mathrm{m}");
  });

  it("reads the right way up whichever way it runs", () => {
    const sk = emptySketch();
    const e = addSymbol(sk, { type: "etalon", x: 0, y: 0, angle: Math.PI, length: 3, label: "" });
    const t = of(buildPrims(sk, 10, { editor: false }), e.id).find((p) => p.k === "text")!;
    expect(t.k === "text" && (t.rot ?? 0)).toBe(0);
  });
});

describe("right-angle marks", () => {
  it("draws a small square in the corner it was put in", () => {
    const { sk, h, v } = corner();
    const m = addSymbol(sk, { type: "rightangle", l1: h, l2: v, s1: 1, s2: 1, dot: true });
    const f = rightAngleFrame(sk, m, 10)!;
    expect(f.c[0]).toBeCloseTo(0, 9);
    expect(f.c[1]).toBeCloseTo(0, 9);
    const prims = of(buildPrims(sk, 10, { editor: false }), m.id);
    const square = prims.find((p) => p.k === "path");
    const k = PAPER.rightAngle;
    expect(square && square.k === "path" && square.pts.map((q) => q.map((n) => Number(n.toFixed(9))))).toEqual([[k, 0], [k, k], [0, k]]);
    expect(prims.some((p) => p.k === "circle")).toBe(true);
    // In the corner on the other side of the upright line.
    m.s1 = -1;
    const other = of(buildPrims(sk, 10, { editor: false }), m.id).find((p) => p.k === "path");
    expect(other && other.k === "path" && other.pts[0][0]).toBeCloseTo(-k, 9);
  });

  it("goes with either of its lines", () => {
    const { sk, h, v } = corner();
    addSymbol(sk, { type: "rightangle", l1: h, l2: v, s1: 1, s2: 1 });
    remove(sk, [v]);
    expect(sk.symbols).toEqual([]);
  });
});
