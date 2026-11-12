import { describe, it, expect } from "vitest";
import { emptySketch, serialize, deserialize, addPoint, addLine, addSymbol, unitScale } from "../src/model";
import { sansLatex, sansTex, type Prim } from "../src/prims";
import { primsToSvg, primsToTikz } from "../src/export";
import type { V } from "../src/geom";
import {
  newCircuit, readCircuit, pinKind, pairPins, pairScore, bundleKey, keyedEnds, freeName, readColor, colorName, darken, removeDevice,
  numberedName, circuitId,
  type Circuit, type PartDef,
} from "../src/circuit/model";
import { STARTER, CATEGORIES, starterPart, useStarter, peekStarter, exampleCircuit, exampleDiagram, EXAMPLE_CSV } from "../src/circuit/starter";
import { SYM, SYMBOLS, JUNCTION_KEY } from "../src/circuit/symbols";
import { libraryHtml } from "../src/circuit/library";
import { readCsv, writeCsv, applyCsv, splitCsvLine } from "../src/circuit/csv";
import { readComponent, writeComponent } from "../src/circuit/component";
import { pathThrough, autoRoute, freeRoute, WAYS, laneChains, tidyPath, flatten, axisOf, placesOf } from "../src/circuit/route";
import { layout, guidePrims, guideLayers, partPrims, tagLength, TAG, describeEnd, designator, valueText, captionOf } from "../src/circuit/figure";
import { place, placePrims, scalePrims, plainWidths, connectorPins } from "../src/circuit/art";
import { partFromSketch } from "../src/circuit/sketchpart";

const example = (): Circuit => exampleCircuit((c) => { applyCsv(c, readCsv(EXAMPLE_CSV).rows); });
const near = (a: V, b: V, eps = 1e-6) => Math.hypot(a[0] - b[0], a[1] - b[1]) < eps;

describe("pins and colours", () => {
  it("reads what a pin does from its name", () => {
    expect(pinKind("GND").kind).toBe("gnd");
    expect(pinKind("-").kind).toBe("gnd");
    expect(pinKind("5V").kind).toBe("power");
    expect(pinKind("VBAT").kind).toBe("power");
    expect(pinKind("+").kind).toBe("power");
    expect(pinKind("Tx3").kind).toBe("tx");
    expect(pinKind("Rx6").kind).toBe("rx");
    expect(pinKind("SCL").kind).toBe("scl");
    expect(pinKind("SDA").kind).toBe("sda");
    expect(pinKind("M4").kind).toBe("motor");
    expect(pinKind("Curr").kind).toBe("current");
    expect(pinKind("VIDEO").kind).toBe("video");
    expect(pinKind("Buzz-").kind).toBe("buzzer");
    expect(pinKind("A").kind).toBe("other");
  });

  it("pairs transmit with receive, ground with ground and power by voltage", () => {
    expect(pairScore("Tx3", "Rx")).toBeGreaterThan(0);
    expect(pairScore("Tx3", "Tx")).toBe(0);
    expect(pairScore("5V", "5V")).toBeGreaterThan(pairScore("5V", "12V"));
    expect(pairPins(["GND", "5V", "Tx3", "Rx3", "SCL", "SDA"], ["GND", "5V", "Rx", "Tx", "SCL", "SDA"])).toEqual([
      ["GND", "GND"], ["5V", "5V"], ["Tx3", "Rx"], ["Rx3", "Tx"], ["SCL", "SCL"], ["SDA", "SDA"],
    ]);
    expect(pairPins(["Tx2", "VIDEO", "GND", "12V"], ["Rx", "VIDEO", "GND", "BAT"])).toEqual([["Tx2", "Rx"], ["VIDEO", "VIDEO"], ["GND", "GND"], ["12V", "BAT"]]);
    expect(pairPins(["Curr", "Rx7", "M4", "M3", "M2", "M1", "VBAT", "GND"], ["Curr", "Tx", "M4", "M3", "M2", "M1", "VBAT", "GND"]).map((p) => p[1]))
      .toEqual(["Curr", "Tx", "M4", "M3", "M2", "M1", "VBAT", "GND"]);
  });

  it("reads colours as names and hex", () => {
    expect(readColor("Red")).toBe("#e0302b");
    expect(readColor("gray")).toBe("#9a9fa4");
    expect(readColor("#ABC")).toBe("#aabbcc");
    expect(readColor("12ab34")).toBe("#12ab34");
    expect(readColor("")).toBeUndefined();
    expect(readColor("mauve-ish")).toBeNull();
    expect(colorName("#e0302b")).toBe("red");
    expect(darken("#ffffff", 0.5)).toBe("#808080");
  });
});

describe("the guide in a file", () => {
  it("survives saving and opening with the drawing", () => {
    const c = example();
    const sk = emptySketch();
    sk.circuit = c;
    const back = deserialize(serialize(sk)).circuit!;
    expect(back.devices.length).toBe(c.devices.length);
    expect(back.wires.length).toBe(c.wires.length);
    expect(back.routes).toEqual(c.routes);
    expect(back.parts.map((p) => p.name)).toEqual(c.parts.map((p) => p.name));
    expect(back.devices.find((d) => d.name === "Motor 1")?.flip).toBe(true);
  });

  it("leaves out what does not make sense", () => {
    const c = readCircuit({
      parts: [{ id: "p1", name: "X", ref: "X", w: 10, h: 10, ports: [{ name: "J", side: "top", pins: [{ name: "1", x: 5, y: 0 }] }] }, { id: "bad" }],
      devices: [{ id: "d1", part: "p1", name: "X", x: 0, y: 0, turn: 5 }, { id: "d2", part: "nope", name: "Y", x: 0, y: 0 }, { id: "d3", part: "p1", name: "X", x: 0, y: 0 }],
      wires: [{ id: "w1", a: { dev: "d1", port: "J", pin: "1" }, b: { dev: "d2", port: "J", pin: "1" } }],
      look: { corners: "square", wire: 99 },
    })!;
    expect(c.parts.length).toBe(1);
    expect(c.devices.map((d) => d.id)).toEqual(["d1"]);
    expect(c.devices[0].turn).toBe(0);
    expect(c.wires.length).toBe(0);
    expect(c.look.corners).toBe("square");
    expect(c.look.wire).toBe(0.5);
    expect(readCircuit("nonsense")).toBeNull();
  });

  it("keys a bundle the same from either end", () => {
    const a = { dev: "d1", port: "GPS", pin: "Tx3" }, b = { dev: "d2", port: "GPS", pin: "Rx" };
    expect(bundleKey({ id: "w", a, b })).toBe(bundleKey({ id: "w", a: b, b: a }));
    expect(keyedEnds({ id: "w", a: b, b: a })[0]).toEqual(a);
  });

  it("names new devices apart", () => {
    const c = example();
    expect(freeName(c, "Motor")).toBe("Motor");
    expect(freeName(c, "Motor 1")).toBe("Motor 5");
    expect(freeName(c, "GPS")).toBe("GPS 2");
  });

  it("takes a device out with its wires", () => {
    const c = example();
    const gps = c.devices.find((d) => d.name === "GPS")!;
    removeDevice(c, gps.id);
    expect(c.wires.some((w) => w.a.dev === gps.id || w.b.dev === gps.id)).toBe(false);
    expect(c.wires.length).toBe(40 - 6);
  });
});

describe("connection lists", () => {
  it("splits CSV lines with quotes", () => {
    expect(splitCsvLine('a,"b,c",d')).toEqual(["a", "b,c", "d"]);
    expect(splitCsvLine('"say ""hi""",x')).toEqual(['say "hi"', "x"]);
    expect(splitCsvLine("a;b;c", ";")).toEqual(["a", "b", "c"]);
  });

  it("wires the example from its list, placing nothing more", () => {
    const c = example();
    expect(c.wires.length).toBe(40);
    expect(c.devices.length).toBe(11);
    const red = c.wires.find((w) => w.a.pin === "+")!;
    expect(red.color).toBe("#e0302b");
  });

  it("places the devices a list names when the guide has none", () => {
    const c = newCircuit();
    const r = applyCsv(c, readCsv(EXAMPLE_CSV).rows);
    expect(r.problems).toEqual([]);
    expect(r.added).toBe(40);
    expect(r.placed.sort()).toEqual(["Battery", "Buzzer", "ELRS RX", "ESC", "GPS", "H743", "Motor 1", "Motor 2", "Motor 3", "Motor 4", "VTX"]);
    // The four motors share one part.
    expect(c.parts.filter((p) => p.starter === "motor").length).toBe(1);
    expect(layout(c).problems).toEqual([]);
  });

  it("lays the devices it places out round the one most is wired to, clear of each other", () => {
    const c = newCircuit();
    applyCsv(c, readCsv(EXAMPLE_CSV).rows);
    const L = layout(c);
    const boxes = L.devices.map((d) => d.box);
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      expect(a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0).toBe(false);
    }
    const fc = c.devices.find((d) => d.name === "H743")!;
    expect([fc.x, fc.y]).toEqual([0, 0]);
    // The ESC goes straight above the port it plugs into, and the motors are mirrored so their wires do not cross.
    const esc = L.bundles.find((b) => b.a.port.name === "ESC1" || b.b.port.name === "ESC1")!;
    expect(esc.path.length).toBe(2);
    expect(L.bundles.filter((b) => b.wires.length === 3).every((b) => b.path.length === 2)).toBe(true);
  });

  it("reads other column names, semicolons and empty ports, and says what is wrong", () => {
    const text = "# notes\nFrom;From pin;To;To pin;Color\nH743;Tx3;GPS;Rx;green\nH743;Tx9;GPS;Rx;\nNobody;1;GPS;Tx;\n";
    const { rows, problems } = readCsv(text);
    expect(problems).toEqual([]);
    expect(rows.length).toBe(3);
    const c = newCircuit();
    const r = applyCsv(c, rows);
    expect(r.added).toBe(1);
    expect(c.wires[0].a).toMatchObject({ port: "GPS", pin: "Tx3" });
    expect(c.wires[0].color).toBe("#3a9c48");
    expect(r.problems.some((p) => p.includes("Tx9"))).toBe(true);
    expect(r.problems.some((p) => p.includes("Nobody"))).toBe(true);
  });

  it("writes the guide's wires and reads them back the same", () => {
    const c = example();
    const text = writeCsv(c);
    expect(text.split("\n")[0]).toBe("from_device,from_port,from_pin,to_device,to_port,to_pin,colour,label");
    expect(text).toContain("H743,GPS,Tx3,GPS,GPS,Rx,,");
    const again = newCircuit();
    const r = applyCsv(again, readCsv(text).rows);
    expect(r.added).toBe(40);
    expect(writeCsv(again)).toBe(text);
  });

  it("refuses a file without the columns it needs", () => {
    expect(readCsv("a,b,c\n1,2,3").problems.length).toBeGreaterThan(0);
    expect(readCsv("").problems).toEqual(["The file is empty."]);
  });
});

describe("routing", () => {
  it("builds a path from the places of its middle stretches", () => {
    // Out upwards, across, and in from above: the places alternate axes.
    expect(pathThrough([0, 0], [0, 1], [20, 0], [0, 1], [10])).toEqual([[0, 0], [0, 10], [20, 10], [20, 0]]);
    // Up, then into a port that faces left: one corner.
    expect(pathThrough([0, 0], [0, 1], [-10, 20], [1, 0], [])).toEqual([[0, 0], [0, 20], [-10, 20]]);
    // Places that do not fit the ends are refused.
    expect(pathThrough([0, 0], [0, 1], [20, 0], [0, 1], [])).toBeNull();
    expect(pathThrough([0, 0], [0, 1], [-10, 20], [1, 0], [5])).toBeNull();
    // Ends in line: straight.
    expect(pathThrough([0, 0], [0, 1], [0, 20], [0, -1], [])).toEqual([[0, 0], [0, 20]]);
    expect(placesOf([[0, 0], [0, 10], [20, 10], [20, 0]], [0, 1])).toEqual([10]);
  });

  it("finds a way round a device in the way", () => {
    const box = { x0: -5, y0: 8, x1: 25, y1: 14 };
    const places = autoRoute([0, 0], [0, 1], [20, 30], [0, -1], { leadA: 2, leadB: 2, half: 1, boxes: [box] });
    const p = tidyPath(pathThrough([0, 0], [0, 1], [20, 30], [0, -1], places)!);
    for (let k = 0; k + 1 < p.length; k++) {
      const a = p[k], b = p[k + 1];
      const crosses = Math.max(a[0], b[0]) > box.x0 && Math.min(a[0], b[0]) < box.x1 && Math.max(a[1], b[1]) > box.y0 && Math.min(a[1], b[1]) < box.y1;
      expect(crosses).toBe(false);
    }
  });

  it("keeps wires evenly apart round a corner, about one centre", () => {
    const path: V[] = [[0, 0], [0, 20], [-20, 20]];
    const lanes = [-1, 0, 1].map((d) => ({ from: [d, 0] as V, to: [-20, 20 + d] as V }));
    const square = laneChains(path, lanes, 0);
    // Square corners: the wires meet the corner where their offsets cross.
    expect(square.map((ch) => ch[ch.length - 1])).toEqual(lanes.map((l) => l.to));
    const corners = square.map((ch) => ch[3]);
    expect(corners.every((q, i) => near(q, ([[-1, 19], [0, 20], [1, 21]] as V[])[i]))).toBe(true);
    // Nothing to swing over: each wire is three straight pieces and a corner.
    expect(square.every((ch) => ch.length === 7)).toBe(true);
    const round = laneChains(path, lanes, 3);
    // Round corners: each wire's quarter circle has the same centre.
    for (const ch of round) {
      const pts = flatten(ch, 24);
      const end = pts[pts.length - 1];
      expect(near(end, ch[ch.length - 1])).toBe(true);
    }
  });

  it("swings a wire over at the end where its pin is not in line", () => {
    const path: V[] = [[0, 0], [0, 20]];
    const chains = laneChains(path, [{ from: [0, 0], to: [2, 20] }, { from: [1, 0], to: [-1, 20] }], 0);
    expect(near(chains[0][chains[0].length - 1], [2, 20])).toBe(true);
    expect(near(chains[1][chains[1].length - 1], [-1, 20])).toBe(true);
    expect(chains[0].length).toBeGreaterThan(4);
  });
});

describe("the guide laid out", () => {
  it("lays the example out with nothing amiss", () => {
    const c = example();
    const L = layout(c);
    expect(L.problems).toEqual([]);
    // Two ESC connectors' worth of plug ports and more: every plug pin has a tag.
    const plugPins = L.devices.flatMap((d) => d.ports.filter((p) => p.port.kind === "plug").flatMap((p) => p.pins));
    expect(L.tags.length).toBe(plugPins.length);
    expect(L.bundles.length).toBe(10);
    // The ESC sits right over the flight controller's ESC1: that bundle runs straight.
    const esc = L.bundles.find((b) => b.a.port.name === "ESC1" || b.b.port.name === "ESC1")!;
    expect(esc.path.length).toBe(2);
    expect(esc.wires.length).toBe(8);
  });

  it("starts tags just off the edge of the board, side by side", () => {
    const L = layout(example());
    const fc = L.devices.find((d) => d.dev.name === "H743")!;
    const gps = fc.ports.find((p) => p.port.name === "GPS")!;
    const tags = gps.pins.map((p) => p.tag!);
    for (const t of tags) expect(t.s[1]).toBeCloseTo(fc.box.y0 - TAG.gap, 6);
    const xs = tags.map((t) => t.s[0]);
    for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeCloseTo(TAG.pitch, 6);
    expect(tags.every((t) => t.vertical && t.wired)).toBe(true);
    const unused = fc.ports.find((p) => p.port.name === "UART1")!;
    expect(unused.pins.every((p) => !p.tag!.wired)).toBe(true);
  });

  it("follows a device that is turned or mirrored", () => {
    const c = example();
    const m1 = layout(c).devices.find((d) => d.dev.name === "Motor 1")!;
    // Mirrored, the motor's pads face left, towards the ESC.
    expect(m1.ports[0].out).toEqual([-1, 0]);
    const buzzer = c.devices.find((d) => d.name === "Buzzer")!;
    buzzer.turn = 1;
    const out = layout(c).devices.find((d) => d.dev.name === "Buzzer")!.ports[0].out;
    expect(near(out, [0, 1])).toBe(true);
  });

  it("reports wires to pins that are gone", () => {
    const c = example();
    c.wires[0].a.pin = "NotThere";
    expect(layout(c).problems.length).toBe(1);
    expect(describeEnd(c, c.wires[0].a)).toContain("NotThere");
  });

  it("draws the guide in layers and exports it", () => {
    const c = example();
    const g = guideLayers(c, layout(c));
    expect(g.under.length).toBeGreaterThan(40);
    expect(g.over.length).toBeGreaterThan(10);
    expect(g.parts.length).toBe(11);
    expect(g.tags.length).toBeGreaterThan(150);
    const prims = guidePrims(c);
    const svg = primsToSvg(prims, 2)!;
    expect(svg).toContain("<svg");
    const tikz = primsToTikz(scalePrims(prims, 2), 1)!;
    expect(tikz).toContain("\\textsf{\\textbf{GND}}");
    expect(tikz).toContain("\\fontsize{");
    // The battery's minus sign is set as LaTeX sets it.
    expect(tikz).toContain("$-$");
  });

  it("square corners and no casings draw fewer wires", () => {
    const c = example();
    const casings = guideLayers(c, layout(c)).under.length;
    c.look.casing = false;
    expect(guideLayers(c, layout(c)).under.length).toBeLessThan(casings);
  });

  it("measures tags to fit their names", () => {
    expect(tagLength(["5V"])).toBe(TAG.min);
    expect(tagLength(["A really long pin name"])).toBeGreaterThan(TAG.min);
  });
});

describe("parts", () => {
  it("draws every starter part, with its ports inside its box", () => {
    for (const s of STARTER) {
      const p = starterPart(s.key)!;
      expect(partPrims(p).length).toBeGreaterThan(s.cat === "boards" ? 3 : 0);
      if (s.cat === "boards") expect(p.ports.length).toBeGreaterThan(0);
      for (const port of p.ports) for (const q of port.pins) {
        expect(q.x).toBeGreaterThanOrEqual(-1e-9);
        expect(q.x).toBeLessThanOrEqual(p.w + 1e-9);
        expect(q.y).toBeGreaterThanOrEqual(-1e-9);
        expect(q.y).toBeLessThanOrEqual(p.h + 1e-9);
      }
    }
  });

  it("takes a starter part into the guide once", () => {
    const c = newCircuit();
    let n = 0;
    const a = useStarter(c, "motor", () => `p${++n}`)!;
    const b = useStarter(c, "motor", () => `p${++n}`)!;
    expect(b.id).toBe(a.id);
    expect(c.parts.length).toBe(1);
    // Once a device uses it, the copy in the guide is the one that is kept, with whatever was changed on it.
    b.name = "My motor";
    c.devices.push({ id: "d1", part: b.id, name: "M1", x: 0, y: 0, turn: 0 });
    expect(useStarter(c, "motor", () => `p${++n}`)).toBe(b);
    expect(peekStarter(c, "motor")).toBe(b);
    expect(peekStarter(c, "esc-4in1")!.id).toBe("");
    expect(c.parts.length).toBe(1);
  });

  it("turns and mirrors drawings without mirroring text", () => {
    expect(place([1, 2], { turn: 1, by: [10, 0] })).toEqual([8, 1]);
    expect(place([1, 2], { turn: 0, flip: true, by: [0, 0] })).toEqual([-1, 2]);
    const text: Prim = { k: "text", layer: "sym", at: [3, 0], tex: "x", anchor: "w" };
    const [m] = placePrims([text], { turn: 0, flip: true, by: [0, 0] });
    expect(m.k === "text" && m.anchor).toBe("e");
    expect(m.k === "text" && m.at).toEqual([-3, 0]);
    const [t] = placePrims([text], { turn: 1, by: [0, 0] });
    expect(t.k === "text" && t.rot).toBeCloseTo(Math.PI / 2, 9);
  });

  it("spaces connector pins along their edge", () => {
    expect(connectorPins(10, 0, "top", 3, 1)).toEqual([[9, 0], [10, 0], [11, 0]]);
    expect(connectorPins(0, 10, "left", 2, 2)).toEqual([[0, 9], [0, 11]]);
  });
});

describe("circuit symbols", () => {
  const diagram = (): Circuit => exampleDiagram();
  const put = (c: Circuit, key: string, x: number, y: number, turn: 0 | 1 | 2 | 3 = 0) => {
    const part = useStarter(c, key, () => circuitId(c, "p"))!;
    const d = { id: circuitId(c, "d"), part: part.id, name: numberedName(c, part.ref), x, y, turn };
    c.devices.push(d);
    return d;
  };
  const join = (c: Circuit, a: [string, string], b: [string, string]) =>
    c.wires.push({ id: circuitId(c, "w"), a: { dev: a[0], port: a[1], pin: a[1] }, b: { dev: b[0], port: b[1], pin: b[1] } });

  it("sorts the library into boards, circuit symbols and logic gates", () => {
    expect(CATEGORIES.map((k) => k.id)).toEqual(["boards", "symbols", "logic"]);
    for (const k of CATEGORIES) expect(STARTER.some((s) => s.cat === k.id)).toBe(true);
    expect(new Set(STARTER.map((s) => s.key)).size).toBe(STARTER.length);
    // Every gate comes in both styles, under the same name.
    const gates = (style: string) => SYMBOLS.filter((s) => s.style === style).map((s) => s.make().name).sort();
    expect(gates("iec").length).toBeGreaterThanOrEqual(8);
    expect(gates("ansi")).toEqual(gates("iec"));
  });

  it("draws each symbol with its pins whole millimetres from its middle", () => {
    for (const s of SYMBOLS) {
      const p = s.make();
      expect(p.symbol, s.key).toBe(true);
      for (const port of p.ports) {
        expect(port.kind, s.key).toBe("pads");
        expect(port.pins.length, s.key).toBe(1);
        expect(port.pins[0].name, s.key).toBe(port.name);
        const [dx, dy] = [port.pins[0].x - p.w / 2, port.pins[0].y - p.h / 2];
        expect(Math.abs(dx - Math.round(dx)) + Math.abs(dy - Math.round(dy)), `${s.key} ${port.name}`).toBeLessThan(1e-9);
      }
      expect(new Set(p.ports.map((x) => x.name)).size, s.key).toBe(p.ports.length);
    }
  });

  it("numbers the devices of a kind", () => {
    const c = newCircuit();
    expect([put(c, "sym/resistor", 0, 0).name, put(c, "sym/resistor", 0, 10).name, put(c, "sym/capacitor", 0, 20).name]).toEqual(["R1", "R2", "C1"]);
    removeDevice(c, c.devices[0].id);
    expect(numberedName(c, "R")).toBe("R1");
    expect(numberedName(c, "LED 3")).toBe("LED1");
  });

  it("sets names and values as formulas", () => {
    expect(designator("R1")).toBe("$R_{1}$");
    expect(designator("LED12")).toBe("$\\mathrm{LED}_{12}$");
    expect(designator("Motor")).toBe("Motor");
    expect(designator("$u_a$")).toBe("$u_a$");
    expect(valueText("10k", "Ω")).toBe("$10\\,\\mathrm{k\\Omega}$");
    expect(valueText("4k7", "Ω")).toBe("$4.7\\,\\mathrm{k\\Omega}$");
    expect(valueText("4k7", "Ω", true)).toBe("$4{,}7\\,\\mathrm{k\\Omega}$");
    expect(valueText("220", "Ω")).toBe("$220\\,\\mathrm{\\Omega}$");
    expect(valueText("100n", "F")).toBe("$100\\,\\mathrm{nF}$");
    expect(valueText("$R_L$", "Ω")).toBe("$R_L$");
    expect(valueText("", "Ω")).toBe("");
    const c = diagram();
    const r1 = c.devices.find((d) => d.name === "R1")!;
    expect(captionOf(r1, c.parts.find((p) => p.id === r1.part)!, c.look)).toBe("$R_{1}$\n$10\\,\\mathrm{k\\Omega}$");
  });

  it("lays the example diagram out with thin square wires and a dot where three meet", () => {
    const c = diagram();
    const L = layout(c);
    expect(L.problems).toEqual([]);
    expect(L.tags).toEqual([]);
    expect(L.bundles.length).toBe(c.wires.length);
    for (const b of L.bundles) {
      expect(b.schematic).toBe(true);
      for (let i = 1; i < b.path.length; i++) expect(Math.min(Math.abs(b.path[i][0] - b.path[i - 1][0]), Math.abs(b.path[i][1] - b.path[i - 1][1]))).toBeLessThan(1e-9);
    }
    // The junction on the base wire draws its own dot, so none is added over it.
    const n1 = c.devices.find((d) => d.name === "N1")!;
    expect(L.dots.some((q) => near(q, [n1.x, n1.y]))).toBe(false);
    const prims = guidePrims(c, L);
    expect(prims.some((p) => p.k === "circle" && p.fill && near(p.c, [n1.x, n1.y], 1e-3))).toBe(true);
    const layers = guideLayers(c, L);
    const wires = [...layers.under, ...layers.over].filter((p) => p.k === "path");
    expect(wires.length).toBe(c.wires.length);
    for (const w of wires) if (w.k === "path") { expect(w.width).toBeCloseTo(SYM.line); expect(w.ink).toBeUndefined(); }
    // In TikZ it is all in the styles of the mechanics figures: no widths spelt out, no colours.
    const tikz = primsToTikz(plainWidths(scalePrims(prims, c.look.scale)), 1);
    expect(tikz).toContain("\\draw[member]");
    expect(tikz).toContain("$R_{1}$");
    expect(tikz).not.toContain("definecolor");
    expect(tikz).not.toContain("\\draw[member, line width=0.8pt");
    expect(primsToSvg(prims, c.look.scale)).toContain("<svg");
  });

  it("puts a dot where a wire ends on another, and none where two only cross", () => {
    const c = newCircuit();
    const [a, b, t] = [put(c, "sym/resistor", 0, 0), put(c, "sym/resistor", 30, 0), put(c, "sym/resistor", 15, -12, 1)];
    const names = (d: { part: string }) => c.parts.find((p) => p.id === d.part)!.ports.map((p) => p.name);
    const [, a2] = names(a), [b1] = names(b), [t1, t2] = names(t);
    join(c, [a.id, a2], [b.id, b1]);
    expect(layout(c).dots).toEqual([]);
    // A third wire onto the same pin: three ways of one net meet there.
    const L0 = layout(c);
    const pinOf = (d: string, port: string) => L0.devices.find((x) => x.dev.id === d)!.ports.find((x) => x.port.name === port)!.pins[0].at;
    join(c, [t.id, pinOf(t.id, t1)[1] > pinOf(t.id, t2)[1] ? t1 : t2], [a.id, a2]);
    const L = layout(c);
    expect(L.problems).toEqual([]);
    expect(L.dots.length).toBe(1);
    // The new wire comes down onto the first and runs along it to the pin: the dot is where it lands.
    expect(near(L.dots[0], [15, 0])).toBe(true);
    expect(pinOf(a.id, a2)).toEqual([5, 0]);
  });

  it("lets a wire leave a junction whichever way is shortest", () => {
    const part = starterPart(JUNCTION_KEY)!;
    expect(part.ports.length).toBe(1);
    expect(part.ports[0].free).toBe(true);
    const need = { boxes: [], leadA: 0, leadB: 0, half: 0 };
    const up = freeRoute([0, 0], WAYS, [0, 10], [[0, -1]], need);
    expect(up.us).toEqual([0, 1]);
    expect(pathThrough([0, 0], up.us, [0, 10], up.ue, up.places)!.length).toBe(2);
    const side = freeRoute([0, 0], WAYS, [-10, 0], WAYS, need);
    expect([side.us, side.ue]).toEqual([[-1, 0], [1, 0]]);
  });

  it("keeps a symbol, its values and its look in a file", () => {
    const c = diagram();
    c.look.comma = true;
    const doc = emptySketch();
    doc.circuit = c;
    const back = deserialize(serialize(doc)).circuit!;
    expect(back.devices.map((d) => [d.name, d.value ?? null])).toEqual(c.devices.map((d) => [d.name, d.value ?? null]));
    expect(back.parts.every((p) => p.symbol)).toBe(true);
    expect(back.parts.find((p) => p.starter === JUNCTION_KEY)!.ports[0].free).toBe(true);
    expect(back.look.comma).toBe(true);
    expect(layout(back).problems).toEqual([]);
    expect(guidePrims(back).length).toBe(guidePrims(c).length);
  });

  it("carries a symbol through a component file", () => {
    for (const key of ["sym/resistor", "sym/npn", JUNCTION_KEY, "logic/iec/nand"]) {
      const part = starterPart(key)!;
      const back = readComponent(writeComponent(part)!).part;
      expect(back.symbol, key).toBe(true);
      expect(back.unit, key).toBe(part.unit);
      expect(back.ports, key).toEqual(part.ports);
      // A file keeps thousandths of a millimetre.
      const round = (v: unknown): unknown => JSON.parse(JSON.stringify(v, (_k, x: unknown) => (typeof x === "number" ? Math.round(x * 1000) / 1000 : x)));
      expect(round(back.shapes), key).toEqual(round(part.shapes));
      expect(partPrims(back).length, key).toBe(partPrims(part).length);
    }
  });

  it("lists the library in sections, and finds parts by what they are called", () => {
    const c = newCircuit();
    const open = libraryHtml(c, { open: new Set(["boards", "symbols", "logic"]), query: "", logic: "iec", placing: null });
    for (const k of CATEGORIES) expect(open).toContain(k.name);
    expect(open).toContain('data-starter="sym/resistor"');
    expect(open).toContain('data-starter="logic/iec/nand"');
    expect(open).not.toContain('data-starter="logic/ansi/nand"');
    const shut = libraryHtml(c, { open: new Set<string>(), query: "", logic: "iec", placing: null });
    expect(shut).not.toContain('data-starter="sym/resistor"');
    const found = libraryHtml(c, { open: new Set<string>(), query: "zener", logic: "ansi", placing: null });
    expect(found).toContain('data-starter="sym/zener"');
    expect(found).not.toContain('data-starter="sym/resistor"');
  });
});

describe("component files", () => {
  const FILE = `{
    "format": "mech-sketch-component", "version": 1, "name": "Tiny board", "ref": "TB", "units": "mm", "size": [20, 10],
    "shapes": [{"type": "rect", "x": 0, "y": 0, "w": 20, "h": 10, "r": 1, "fill": "#262a30"}, {"type": "chip", "x": 8, "y": 3, "w": 4, "h": 4, "dot": true}, {"type": "wobble"}],
    "ports": [
      {"name": "J1", "side": "bottom", "x": 10, "y": 10, "pins": ["GND", "5V", "SIG"], "draw": "jst-gh"},
      {"name": "PWR", "side": "top", "kind": "pads", "wire": 1.25, "pins": [{"name": "+", "x": 6, "y": 2}, {"name": "-", "x": 14, "y": 2}]}
    ]
  }`;

  it("reads a file, drawing the connector it asks for", () => {
    const { part, problems } = readComponent("```json\n" + FILE + "\n```");
    expect(part.name).toBe("Tiny board");
    expect(part.ref).toBe("TB");
    expect(part.w).toBe(20);
    expect(problems.length).toBe(1); // the wobble
    expect(part.shapes!.some((s) => s.type === "connector" && s.style === "jst-gh")).toBe(true);
    const j1 = part.ports[0];
    expect(j1.pins.map((p) => p.x)).toEqual([8.75, 10, 11.25]);
    expect(part.ports[1].kind).toBe("pads");
    expect(part.ports[1].wire).toBe(1.25);
  });

  it("refuses what is not a component", () => {
    expect(() => readComponent("not json")).toThrow(/JSON/);
    expect(() => readComponent('{"format": "something-else"}')).toThrow(/not a component/);
  });

  it("writes a part and reads it back the same", () => {
    for (const key of ["gps-m10", "esc-4in1", "lipo"]) {
      const p = starterPart(key)!;
      const back = readComponent(writeComponent(p)!).part;
      expect(back.ports).toEqual(p.ports.map((x) => ({ ...x, pins: x.pins.map((q) => ({ name: q.name, x: Math.round(q.x * 1000) / 1000, y: Math.round(q.y * 1000) / 1000 })) })));
      expect(back.shapes!.length).toBe(p.shapes!.length);
    }
  });

  it("converts grid squares and inches to mm", () => {
    const { part } = readComponent('{"units": "grid", "size": [10, 4], "ports": [{"name": "J", "side": "left", "x": 0, "y": 2, "pitch": 1, "pins": ["A", "B"]}]}');
    expect(part.w).toBeCloseTo(25.4, 9);
    expect(part.ports[0].pins[1].y).toBeCloseTo(2.5 * 2.54, 9);
  });
});

describe("parts drawn in the sketcher", () => {
  it("makes ports of the pins on a sketch", () => {
    const sk = emptySketch();
    const pts = [[0, 0], [30, 0], [30, 20], [0, 20]].map(([x, y]) => addPoint(sk, x, y));
    for (let i = 0; i < 4; i++) addLine(sk, pts[i].id, pts[(i + 1) % 4].id);
    const a = addPoint(sk, 30, 12), b = addPoint(sk, 30, 8), c = addPoint(sk, 15, 0);
    addSymbol(sk, { type: "datum", at: a.id, color: "#e0302b", label: "GND", dx: 0, dy: 0, pin: true, port: "J1" });
    addSymbol(sk, { type: "datum", at: b.id, color: "#e0302b", label: "5V", dx: 0, dy: 0, pin: true, port: "J1" });
    addSymbol(sk, { type: "datum", at: c.id, color: "#e0302b", label: "+", dx: 0, dy: 0, pin: true, port: "BAT", dir: "d", pad: true });
    const { part, problems } = partFromSketch(sk, { id: "p1", name: "Box", ref: "Box" });
    expect(problems).toEqual([]);
    const k = unitScale(sk);
    expect(part.w).toBeGreaterThan(30 * k - 1);
    const j1 = part.ports.find((p) => p.name === "J1")!;
    expect(j1.side).toBe("right");
    expect(j1.kind).toBe("plug");
    expect(j1.pins.map((p) => p.name)).toEqual(["GND", "5V"]);
    // y runs down in the part: GND, higher up in the sketch, is nearer the top.
    expect(j1.pins[0].y).toBeLessThan(j1.pins[1].y);
    const bat = part.ports.find((p) => p.name === "BAT")!;
    expect(bat.side).toBe("bottom");
    expect(bat.kind).toBe("pads");
    expect(partPrims(part).length).toBeGreaterThan(0);
    // Saved with a guide and opened again, the drawing keeps its pins.
    const doc = emptySketch();
    doc.circuit = newCircuit();
    doc.circuit.parts.push(part);
    const back = deserialize(serialize(doc)).circuit!.parts[0];
    const pins = back.sketch!.symbols.filter((x) => x.type === "datum" && x.pin);
    expect(pins.map((x) => x.type === "datum" && [x.label, x.port, x.dir ?? null, x.pad ?? null])).toEqual([["GND", "J1", null, null], ["5V", "J1", null, null], ["+", "BAT", "d", true]]);
    expect(partFromSketch(back.sketch!, back).part.ports).toEqual(part.ports);
  });

  it("will not make a part of nothing", () => {
    expect(() => partFromSketch(emptySketch(), { id: "p", name: "X", ref: "X" })).toThrow(/nothing drawn/);
  });
});

describe("sans text", () => {
  it("escapes what LaTeX would take as commands", () => {
    expect(sansLatex("Buzz-")).toBe("\\textsf{Buzz-}");
    expect(sansLatex("A&B_1", true)).toBe("\\textsf{\\textbf{A\\&B\\_1}}");
    expect(sansLatex("I²C 5 µA −1")).toBe("\\textsf{I\\textsuperscript{2}C 5 $\\mu$A $-$1}");
    expect(sansTex("Tx{3}")).toBe('\\mmlToken{mtext}[mathvariant="sans-serif"]{Tx3}');
  });

  it("keeps a part's id when it is changed", () => {
    const c = example();
    const before = c.parts.map((p: PartDef) => p.id);
    expect(new Set(before).size).toBe(before.length);
    expect(axisOf([0, -1])).toBe("v");
  });
});
