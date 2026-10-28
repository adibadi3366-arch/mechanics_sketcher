// A figure exported to a file carries its drawing, and opening the file brings it back.

import { describe, it, expect } from "vitest";
import { emptySketch, addPoint, addLine, addConstraint, serialize, deserialize } from "../src/model";
import { toSvg, toTikz } from "../src/export";
import { packDrawing, unpackDrawing, svgWithDrawing, texWithDrawing, readOpened, EMPTY_SVG } from "../src/embed";

function drawing() {
  const sk = emptySketch();
  const a = addPoint(sk, 0, 0), b = addPoint(sk, 4, 0);
  addLine(sk, a.id, b.id);
  addConstraint(sk, { type: "distance", a: a.id, b: b.id, mode: "aligned", value: 4, offset: -1, label: "2\\,\\mathrm{m} – ő" });
  return sk;
}

describe("a drawing inside its figure", () => {
  it("packs small and unpacks to the same text, accents and all", async () => {
    const json = JSON.stringify(drawing());
    const packed = await packDrawing(json);
    expect(packed).toMatch(/^[A-Za-z0-9+/=]+$/);
    expect(await unpackDrawing(packed)).toBe(json);
  });

  it("comes back out of an SVG export", async () => {
    const sk = drawing();
    const svg = svgWithDrawing(toSvg(sk)!, await packDrawing(JSON.stringify(sk)));
    expect(svg).toContain("<metadata><mech-sketch-drawing");
    // Still an SVG: the drawing sits inside the root element.
    expect(svg.indexOf("<metadata>")).toBeGreaterThan(svg.indexOf("<svg"));
    const got = await readOpened(svg);
    expect(got.kind).toBe("drawing");
    expect(deserialize((got as { json: string }).json)).toEqual(deserialize(serialize(sk)));
  });

  it("comes back out of a TikZ export, whose picture LaTeX still reads as before", async () => {
    const sk = drawing();
    const plain = toTikz(sk)!;
    const tex = texWithDrawing(plain, await packDrawing(JSON.stringify(sk)));
    expect(tex.startsWith(plain.trimEnd())).toBe(true);
    // Every added line is a comment, none longer than an editor shows comfortably.
    for (const line of tex.slice(plain.trimEnd().length).trim().split("\n")) {
      expect(line.startsWith("%")).toBe(true);
      expect(line.length).toBeLessThanOrEqual(120);
    }
    const got = await readOpened(tex);
    expect(got.kind).toBe("drawing");
    expect(deserialize((got as { json: string }).json).constraints).toHaveLength(1);
  });

  it("is saved even when the figure is empty", async () => {
    const svg = svgWithDrawing(EMPTY_SVG, await packDrawing(JSON.stringify(emptySketch())));
    expect((await readOpened(svg)).kind).toBe("drawing");
  });

  it("tells files without one apart", async () => {
    expect((await readOpened(`<svg xmlns="http://www.w3.org/2000/svg"><line x1="0" y1="0" x2="1" y2="1"/></svg>`)).kind).toBe("svg");
    expect((await readOpened("\\begin{tikzpicture}\\draw (0,0) -- (1,1);\\end{tikzpicture}")).kind).toBe("none");
    expect((await readOpened(serialize(drawing()))).kind).toBe("drawing");
  });
});
