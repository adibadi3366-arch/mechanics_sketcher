// A drawing of several sketches: kept as one in files and in the undo history,
// worked on one sketch at a time.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { make_gcs_wrapper } from "@salusoft89/planegcs";
import { SketchSolver } from "../src/solver";
import { emptySketch, addPoint, addLine, addCircle, addConstraint, addSymbol, serialize, deserialize, point, type Sketch } from "../src/model";
import { splitDrawing, mergeDrawing, activePart, entityIndex, followSources, isOrphan } from "../src/parts";
import { fitFigure } from "../src/export";

let solver: SketchSolver;
beforeAll(async () => { solver = new SketchSolver(await make_gcs_wrapper()); });
afterAll(() => solver.dispose());

/** Two sketches: a fixed 10 x 4 frame in the first, and in the second a line from the frame's top right corner, projected. */
function two(): Sketch {
  const sk = emptySketch();
  const a = addPoint(sk, 0, 0), b = addPoint(sk, 10, 0), c = addPoint(sk, 10, 4);
  addLine(sk, a.id, b.id);
  const bc = addLine(sk, b.id, c.id);
  addConstraint(sk, { type: "fixed", p: a.id });
  addConstraint(sk, { type: "horizontal", a: a.id, b: b.id });
  addConstraint(sk, { type: "vertical", a: b.id, b: c.id });
  const width = addConstraint(sk, { type: "distance", a: a.id, b: b.id, mode: "aligned", value: 10, offset: -1 });
  addConstraint(sk, { type: "distance", a: b.id, b: c.id, mode: "aligned", value: 4, offset: 1 });
  addSymbol(sk, { type: "support", kind: "pin", at: a.id, angle: 0 });
  sk.sketches = [{ id: "d1", name: "Frame" }, { id: "d2", name: "Arm" }];
  // The second sketch: c projected, and a line from it.
  const cr = addPoint(sk, 10, 4); cr.ref = c.id;
  const tip = addPoint(sk, 14, 6);
  const arm = addLine(sk, cr.id, tip.id);
  const br = addPoint(sk, 10, 0);
  const bcr = addLine(sk, cr.id, br.id);
  for (const x of [cr, tip, arm, bcr, br]) (x as { sketch?: string }).sketch = "d2";
  bcr.construction = true; bcr.ref = bc.id;
  br.ref = b.id;
  const fixLen = addConstraint(sk, { type: "distance", a: cr.id, b: tip.id, mode: "aligned", value: Math.hypot(4, 2), offset: 1 });
  (fixLen as { sketch?: string }).sketch = "d2";
  sk.active = "d1";
  (width as { sketch?: string }).sketch = "d1";
  return sk;
}

describe("a drawing of several sketches", () => {
  it("is split by what each thing says it is in; untagged things are in the first", () => {
    const d = splitDrawing(two());
    expect(d.parts.map((p) => p.info.name)).toEqual(["Frame", "Arm"]);
    expect(d.active).toBe("d1");
    const [frame, arm] = d.parts.map((p) => p.sk);
    expect(frame.entities.filter((e) => e.type === "line")).toHaveLength(2);
    expect(frame.symbols).toHaveLength(1);
    expect(arm.entities.filter((e) => e.type === "line")).toHaveLength(2);
    expect(arm.constraints).toHaveLength(1);
    // The origin is in every sketch; nothing in a sketch carries its tag.
    for (const p of d.parts) {
      expect(p.sk.entities[0].id).toBe("origin");
      expect(p.sk.entities.some((e) => "sketch" in e)).toBe(false);
    }
  });

  it("is put back together as it was", () => {
    const sk = two();
    const d = splitDrawing(sk);
    const again = splitDrawing(deserialize(serialize(mergeDrawing(d, activePart(d).sk))));
    expect(again.parts.map((p) => p.sk.entities.map((e) => e.id))).toEqual(d.parts.map((p) => p.sk.entities.map((e) => e.id)));
    expect(again.parts.map((p) => p.sk.constraints.map((c) => c.id))).toEqual(d.parts.map((p) => p.sk.constraints.map((c) => c.id)));
    expect(again.active).toBe("d1");
  });

  it("is one sketch when the file has no sketches", () => {
    const sk = emptySketch();
    addLine(sk, addPoint(sk, 0, 0).id, addPoint(sk, 1, 0).id);
    const d = splitDrawing(sk);
    expect(d.parts).toHaveLength(1);
    expect(d.parts[0].info.name).toBe("Sketch 1");
    expect(d.parts[0].sk.entities).toHaveLength(4);
  });

  it("exports only the sketches that are in the figure, and never projected geometry", () => {
    const sk = two();
    const d = splitDrawing(sk);
    const lines = (all: Sketch) => fitFigure(all)!.prims.filter((p) => p.k === "line" && p.stroke === "member").length;
    expect(lines(mergeDrawing(d, activePart(d).sk, true))).toBe(3); // the frame's two, and the arm; not the projected edge
    d.parts[1].info.out = true;
    expect(lines(mergeDrawing(d, activePart(d).sk, true))).toBe(2);
  });

  it("moves projected geometry with its source, and the sketch solves round it", () => {
    const d = splitDrawing(two());
    const [frame, arm] = d.parts.map((p) => p.sk);
    // The frame is made wider; its corner moves.
    (frame.constraints.find((c) => c.type === "distance" && c.value === 10) as { value: number }).value = 12;
    expect(solver.solve(frame).ok).toBe(true);
    expect(followSources(arm, entityIndex(d, frame))).toBe(true);
    expect(solver.solve(arm).ok).toBe(true);
    const cr = arm.entities.find((e) => e.type === "point" && e.ref && point(frame, e.ref).y > 1)!;
    expect(cr.type === "point" && cr.x).toBeCloseTo(12, 9);
    // The arm keeps its length from the moved corner.
    const line = arm.entities.find((e) => e.type === "line" && !e.construction)!;
    const p = point(arm, (line as { p1: string }).p1), q = point(arm, (line as { p2: string }).p2);
    expect(Math.hypot(q.x - p.x, q.y - p.y)).toBeCloseTo(Math.hypot(4, 2), 6);
  });

  it("keeps projected geometry where it was when its source is deleted", () => {
    const d = splitDrawing(two());
    const [frame, arm] = d.parts.map((p) => p.sk);
    frame.entities = frame.entities.filter((e) => e.type !== "line");
    frame.entities = frame.entities.filter((e) => !(e.type === "point" && e.x === 10 && e.y === 4));
    const index = entityIndex(d, frame);
    const cr = arm.entities.find((e) => e.type === "point" && e.ref && !index.has(e.ref))!;
    expect(isOrphan(index, cr)).toBe(true);
    followSources(arm, index);
    expect(cr.type === "point" && [cr.x, cr.y]).toEqual([10, 4]);
    expect(solver.solve(arm).ok).toBe(true);
  });

  it("holds a projected circle at the size of its source", () => {
    const sk = emptySketch();
    const c = addPoint(sk, 0, 0);
    c.ref = "elsewhere";
    const circle = addCircle(sk, c.id, 2);
    circle.ref = "elsewhere-circle";
    const p = addPoint(sk, 5, 0);
    addConstraint(sk, { type: "pointOn", p: p.id, on: circle.id });
    expect(solver.solve(sk).ok).toBe(true);
    expect(circle.r).toBeCloseTo(2, 9);
    expect(Math.hypot(p.x, p.y)).toBeCloseTo(2, 6);
  });
});
