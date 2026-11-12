// Circuit symbols: the symbols a circuit diagram is drawn with in European
// textbooks (IEC 60617: the resistor a box, sources as circles), and logic
// gates in both their shapes, the IEC boxes and the American outlines.
//
// A symbol is a part like any other, made of plain shapes in the figure's ink,
// but marked as a symbol: wires run thin and square right onto its pins, each
// pin a port of its own. They are drawn on a module of 2 mm on the guide, which
// is 4 mm on paper at the usual size of twice the guide: a resistor is 12 mm
// by 4 mm there, its line 0.8 pt and its letters 10 pt, as in a figure of the
// sketcher. Every pin is a whole number of millimetres from the middle of its
// symbol, so symbols placed on the millimetre grid line up pin to pin.

import { PAPER } from "../prims";
import type { Shape, PartDef, PortDef, Side } from "./model";

/** Sizes of a circuit diagram, in mm on the guide. */
export const SYM = {
  /** Lines of symbols and wires: 0.8 pt on paper at twice the size. */
  line: PAPER.member / 2,
  /** Letters: 10 pt on paper at twice the size. */
  font: PAPER.em / 2,
  /** The dot where wires join: its radius. */
  dot: 0.28,
  /** The grid symbols are placed on. */
  grid: 1,
} as const;

type Pt = [number, number];

/** Draws one symbol about its middle, x to the right and y down, in a box of w × h. */
class Sym {
  readonly shapes: Shape[] = [];
  readonly ports: PortDef[] = [];
  constructor(readonly w: number, readonly h: number) {}
  private p = (x: number, y: number): Pt => [x + this.w / 2, y + this.h / 2];

  /** A run of straight pieces through the points, given as x, y, x, y ... */
  l(...xy: number[]): this {
    const points: Pt[] = [];
    for (let i = 0; i + 1 < xy.length; i += 2) points.push(this.p(xy[i], xy[i + 1]));
    this.shapes.push({ type: "line", points, stroke: "ink", width: SYM.line });
    return this;
  }
  /** The same, thicker: the short plate of a cell, the bar of a ground. */
  thick(k: number, ...xy: number[]): this {
    this.l(...xy);
    (this.shapes[this.shapes.length - 1] as Extract<Shape, { type: "line" }>).width = SYM.line * k;
    return this;
  }
  box(x: number, y: number, w: number, h: number): this {
    const [px, py] = this.p(x, y);
    this.shapes.push({ type: "rect", x: px, y: py, w, h, stroke: "ink", width: SYM.line });
    return this;
  }
  circle(x: number, y: number, r: number, filled = false): this {
    const [px, py] = this.p(x, y);
    this.shapes.push({ type: "circle", x: px, y: py, r, stroke: "ink", width: SYM.line, ...(filled ? { fill: "ink" } : {}) });
    return this;
  }
  /** Part of a circle from `start` to `end` degrees, counter-clockwise as seen, 0 pointing right. */
  arc(x: number, y: number, r: number, start: number, end: number): this {
    const [px, py] = this.p(x, y);
    this.shapes.push({ type: "arc", x: px, y: py, r, start, end, stroke: "ink", width: SYM.line });
    return this;
  }
  /** A closed outline through the points; filled with ink when `filled`. */
  poly(filled: boolean, ...xy: number[]): this {
    const points: Pt[] = [];
    for (let i = 0; i + 1 < xy.length; i += 2) points.push(this.p(xy[i], xy[i + 1]));
    this.shapes.push({ type: "polygon", points, stroke: "ink", width: filled ? SYM.line * 0.5 : SYM.line, ...(filled ? { fill: "ink" } : {}) });
    return this;
  }
  /** An arrowhead with its tip at (x, y), pointing along (ux, uy). */
  head(x: number, y: number, ux: number, uy: number, len = 0.95, half = 0.32): this {
    const n = Math.hypot(ux, uy) || 1;
    const dx = ux / n, dy = uy / n;
    const bx = x - dx * len, by = y - dy * len;
    return this.poly(true, x, y, bx - dy * half, by + dx * half, bx + dy * half, by - dx * half);
  }
  /** A line from (x0, y0) to an arrowhead at (x1, y1). */
  arrow(x0: number, y0: number, x1: number, y1: number, len = 0.95, half = 0.32): this {
    const n = Math.hypot(x1 - x0, y1 - y0) || 1;
    const dx = (x1 - x0) / n, dy = (y1 - y0) / n;
    // The line stops inside the head, so its blunt end does not show at the tip.
    this.l(x0, y0, x1 - dx * len * 0.7, y1 - dy * len * 0.7);
    return this.head(x1, y1, dx, dy, len, half);
  }
  /** Math centred on (x, y), which stays upright when the symbol is turned. */
  text(x: number, y: number, tex: string, size: number = SYM.font): this {
    const [px, py] = this.p(x, y);
    this.shapes.push({ type: "text", x: px, y: py, text: tex, size, color: "ink", math: true, upright: true });
    return this;
  }
  /** A pin: a port of its own, whose wire leaves by `side`. */
  pin(name: string, x: number, y: number, side: Side): this {
    const [px, py] = this.p(x, y);
    this.ports.push({ name, side, kind: "pads", pins: [{ name, x: px, y: py }] });
    return this;
  }
}

interface Extra { unit?: string; caption?: string; words?: string }
export interface SymbolEntry { key: string; cat: "symbols" | "logic"; group: string; style?: "iec" | "ansi"; words: string; make: () => PartDef }

function part(g: Sym, name: string, ref: string, o: Extra = {}): PartDef {
  return {
    id: "", name, ref, w: g.w, h: g.h, shapes: g.shapes, ports: g.ports, symbol: true,
    ...(o.unit ? { unit: o.unit } : {}),
    ...(o.caption !== undefined ? { caption: o.caption } : {}),
  };
}

/** A symbol with a pin at each end of a 10 mm run: leads, and whatever `draw` puts between them. */
function two(h: number, pins: [string, string], draw: (g: Sym) => void): Sym {
  const g = new Sym(10, h);
  draw(g);
  return g.pin(pins[0], -5, 0, "left").pin(pins[1], 5, 0, "right");
}

const resistorBody = (g: Sym) => g.l(-5, 0, -3, 0).box(-3, -1, 6, 2).l(3, 0, 5, 0);
const diodeBody = (g: Sym) => g.l(-5, 0, -1.2, 0).poly(false, -1.2, -1.4, -1.2, 1.4, 1.2, 0).l(1.2, 0, 5, 0);
const plus = (g: Sym, x: number, y: number, k = 0.4) => g.l(x - k, y, x + k, y).l(x, y - k, x, y + k);
const meter = (letter: string) => two(4, ["1", "2"], (g) => g.l(-5, 0, -2, 0).circle(0, 0, 2).l(2, 0, 5, 0).text(0, 0, `\\mathrm{${letter}}`));

// ---- circuit symbols ------------------------------------------------------------------------

function transistor(pnp: boolean): Sym {
  const g = new Sym(8, 8);
  g.l(-4, 0, -0.8, 0).thick(1.6, -0.8, -1.6, -0.8, 1.6);
  g.l(-0.8, -0.7, 2, -2.5, 2, -4).l(-0.8, 0.7, 2, 2.5, 2, 4);
  g.circle(0.45, 0, 2.75);
  // The arrow on the emitter: out of an NPN, into a PNP.
  const ux = 2.8, uy = 1.8;
  if (pnp) g.head(-0.8 + ux * 0.2, 0.7 + uy * 0.2, -ux, -uy, 0.95, 0.34);
  else g.head(-0.8 + ux * 0.86, 0.7 + uy * 0.86, ux, uy, 0.95, 0.34);
  return g.pin("B", -4, 0, "left").pin("C", 2, -4, "top").pin("E", 2, 4, "bottom");
}

function mosfet(p: boolean): Sym {
  const g = new Sym(8, 8);
  g.l(-4, 0, -1.3, 0).l(-1.3, -1.5, -1.3, 1.5);
  // The channel of an enhancement type is drawn broken.
  g.l(-0.6, -2, -0.6, -1).l(-0.6, -0.5, -0.6, 0.5).l(-0.6, 1, -0.6, 2);
  g.l(-0.6, -1.5, 2, -1.5, 2, -4).l(-0.6, 1.5, 2, 1.5, 2, 4).l(-0.6, 0, 2, 0, 2, 1.5);
  if (p) g.head(1.1, 0, 1, 0, 0.95, 0.34);
  else g.head(-0.5, 0, -1, 0, 0.95, 0.34);
  return g.pin("G", -4, 0, "left").pin("D", 2, -4, "top").pin("S", 2, 4, "bottom");
}

function opamp(): Sym {
  const g = new Sym(10, 8);
  g.poly(false, -3, -4, -3, 4, 3, 0);
  g.l(-5, -2, -3, -2).l(-5, 2, -3, 2).l(3, 0, 5, 0);
  g.l(-2.5, -2, -1.7, -2);
  plus(g, -2.1, 2);
  return g.pin("-", -5, -2, "left").pin("+", -5, 2, "left").pin("OUT", 5, 0, "right");
}

function transformer(): Sym {
  const g = new Sym(8, 8);
  g.l(-4, -3, -1.5, -3).l(-4, 3, -1.5, 3).l(4, -3, 1.5, -3).l(4, 3, 1.5, 3);
  for (const y of [-2.25, -0.75, 0.75, 2.25]) g.arc(-1.5, y, 0.75, -90, 90).arc(1.5, y, 0.75, 90, 270);
  g.l(-0.25, -3, -0.25, 3).l(0.25, -3, 0.25, 3);
  return g.pin("P1", -4, -3, "left").pin("P2", -4, 3, "left").pin("S1", 4, -3, "right").pin("S2", 4, 3, "right");
}

const sym = (key: string, group: string, name: string, ref: string, words: string, make: () => Sym, o: Extra = {}): SymbolEntry =>
  ({ key: `sym/${key}`, cat: "symbols", group, words, make: () => part(make(), name, ref, o) });

const CIRCUIT: SymbolEntry[] = [
  sym("resistor", "Passive", "Resistor", "R", "resistance ohm", () => two(2, ["1", "2"], resistorBody), { unit: "Ω" }),
  sym("capacitor", "Passive", "Capacitor", "C", "condenser farad", () => two(3, ["1", "2"], (g) => g.l(-5, 0, -0.4, 0).l(-0.4, -1.5, -0.4, 1.5).l(0.4, -1.5, 0.4, 1.5).l(0.4, 0, 5, 0)), { unit: "F" }),
  sym("capacitor-polarised", "Passive", "Capacitor, polarised", "C", "electrolytic condenser farad", () => two(3, ["+", "-"], (g) => {
    g.l(-5, 0, -0.4, 0).l(-0.4, -1.5, -0.4, 1.5).l(0.4, -1.5, 0.4, 1.5).l(0.4, 0, 5, 0);
    plus(g, -1.5, -0.95, 0.38);
  }), { unit: "F" }),
  sym("inductor", "Passive", "Inductor", "L", "coil choke henry", () => two(2, ["1", "2"], (g) => {
    g.l(-5, 0, -3, 0).l(3, 0, 5, 0);
    for (const x of [-2.25, -0.75, 0.75, 2.25]) g.arc(x, 0, 0.75, 0, 180);
  }), { unit: "H" }),
  sym("resistor-variable", "Passive", "Variable resistor", "R", "rheostat adjustable", () => two(4, ["1", "2"], (g) => { resistorBody(g); g.arrow(-2.6, 1.9, 2.6, -1.9); }), { unit: "Ω" }),
  sym("potentiometer", "Passive", "Potentiometer", "R", "pot trimmer wiper divider", () => {
    const g = new Sym(10, 6);
    g.l(-5, 1, -3, 1).box(-3, 0, 6, 2).l(3, 1, 5, 1).arrow(0, -3, 0, 0);
    return g.pin("1", -5, 1, "left").pin("2", 5, 1, "right").pin("W", 0, -3, "top");
  }, { unit: "Ω" }),
  sym("thermistor", "Passive", "Thermistor", "R", "ntc ptc temperature sensor", () => two(4, ["1", "2"], (g) => {
    resistorBody(g);
    g.l(-2.9, 1.9, -1.9, 1.9, 2.3, -1.9).text(3.9, 1.5, "\\vartheta", SYM.font * 0.85);
  })),
  sym("ldr", "Passive", "Photoresistor", "R", "ldr light sensor", () => two(6, ["1", "2"], (g) => {
    resistorBody(g);
    g.arrow(-2.9, -2.9, -1.7, -1.25, 0.8, 0.28).arrow(-1.5, -2.9, -0.3, -1.25, 0.8, 0.28);
  })),
  sym("transformer", "Passive", "Transformer", "Tr", "coil coupled", transformer, { caption: "" }),

  sym("voltage-source", "Sources", "Voltage source", "U", "ideal supply generator", () => two(4, ["+", "-"], (g) => g.circle(0, 0, 2).l(-5, 0, 5, 0)), { unit: "V" }),
  sym("current-source", "Sources", "Current source", "I", "ideal generator", () => two(4, ["1", "2"], (g) => g.circle(0, 0, 2).l(-5, 0, -2, 0).l(2, 0, 5, 0).l(0, -2, 0, 2)), { unit: "A" }),
  sym("cell", "Sources", "Cell, battery", "U", "battery accumulator dc", () => two(4, ["+", "-"], (g) => {
    g.l(-5, 0, -0.4, 0).l(-0.4, -2, -0.4, 2).thick(3, 0.4, -1, 0.4, 1).l(0.4, 0, 5, 0);
    plus(g, -1.5, -1.3, 0.38);
  }), { unit: "V" }),
  sym("ac-source", "Sources", "AC source", "U", "alternating sine generator mains", () => two(4, ["1", "2"], (g) =>
    g.l(-5, 0, -2, 0).circle(0, 0, 2).l(2, 0, 5, 0).arc(-0.65, 0, 0.65, 0, 180).arc(0.65, 0, 0.65, 180, 360)), { unit: "V" }),

  sym("diode", "Semiconductors", "Diode", "D", "rectifier", () => two(3, ["A", "K"], (g) => diodeBody(g).l(1.2, -1.4, 1.2, 1.4))),
  sym("led", "Semiconductors", "LED", "LED", "light emitting diode lamp", () => two(6, ["A", "K"], (g) => {
    diodeBody(g).l(1.2, -1.4, 1.2, 1.4);
    g.arrow(-0.5, -1.7, 0.6, -2.9, 0.8, 0.28).arrow(0.7, -1.5, 1.8, -2.7, 0.8, 0.28);
  })),
  sym("zener", "Semiconductors", "Zener diode", "D", "breakdown voltage reference", () => two(3, ["A", "K"], (g) => diodeBody(g).l(1.2, -1.4, 1.2, 1.4, 0.55, 1.4))),
  sym("schottky", "Semiconductors", "Schottky diode", "D", "fast rectifier", () => two(3, ["A", "K"], (g) => diodeBody(g).l(1.75, -0.85, 1.75, -1.4, 1.2, -1.4, 1.2, 1.4, 0.65, 1.4, 0.65, 0.85))),
  sym("photodiode", "Semiconductors", "Photodiode", "D", "light sensor", () => two(6, ["A", "K"], (g) => {
    diodeBody(g).l(1.2, -1.4, 1.2, 1.4);
    g.arrow(0.5, -3, -0.6, -1.8, 0.8, 0.28).arrow(1.7, -2.8, 0.6, -1.6, 0.8, 0.28);
  })),
  sym("npn", "Semiconductors", "Transistor, NPN", "T", "bjt bipolar", () => transistor(false)),
  sym("pnp", "Semiconductors", "Transistor, PNP", "T", "bjt bipolar", () => transistor(true)),
  sym("nmos", "Semiconductors", "MOSFET, n-channel", "T", "fet nmos enhancement", () => mosfet(false)),
  sym("pmos", "Semiconductors", "MOSFET, p-channel", "T", "fet pmos enhancement", () => mosfet(true)),
  sym("opamp", "Semiconductors", "Operational amplifier", "IC", "op-amp opamp comparator", opamp),

  sym("switch", "Switches and protection", "Switch", "S", "spst make contact", () => two(4, ["1", "2"], (g) => g.l(-5, 0, -2, 0).l(-2, 0, 1.7, -1.9).l(2, 0, 5, 0))),
  sym("pushbutton", "Switches and protection", "Push-button", "S", "button momentary key", () => two(6, ["1", "2"], (g) =>
    g.l(-5, 0, -2.2, 0).circle(-1.9, 0, 0.3).circle(1.9, 0, 0.3).l(2.2, 0, 5, 0).l(-2.2, -0.8, 2.2, -0.8).l(0, -0.8, 0, -2.3).l(-0.9, -2.3, 0.9, -2.3))),
  sym("changeover", "Switches and protection", "Changeover switch", "S", "spdt two way selector", () => {
    const g = new Sym(10, 4);
    g.l(-5, 0, -2, 0).l(-2, 0, 1.9, -0.95).l(2, -1, 5, -1).l(2, 1, 5, 1);
    return g.pin("C", -5, 0, "left").pin("1", 5, -1, "right").pin("2", 5, 1, "right");
  }),
  sym("fuse", "Switches and protection", "Fuse", "F", "protection", () => two(2, ["1", "2"], (g) => g.box(-3, -1, 6, 2).l(-5, 0, 5, 0)), { unit: "A" }),

  sym("lamp", "Outputs and meters", "Lamp", "H", "bulb light indicator", () => two(4, ["1", "2"], (g) =>
    g.l(-5, 0, -1.6, 0).circle(0, 0, 1.6).l(1.6, 0, 5, 0).l(-1.13, -1.13, 1.13, 1.13).l(-1.13, 1.13, 1.13, -1.13))),
  sym("motor", "Outputs and meters", "Motor", "M", "dc machine", () => meter("M")),
  sym("generator", "Outputs and meters", "Generator", "G", "dynamo machine", () => meter("G")),
  sym("voltmeter", "Outputs and meters", "Voltmeter", "PV", "meter measure volt", () => meter("V"), { caption: "" }),
  sym("ammeter", "Outputs and meters", "Ammeter", "PA", "meter measure current amp", () => meter("A"), { caption: "" }),

  sym("junction", "Connections", "Junction", "N", "node dot connection join", () => {
    const g = new Sym(1, 1).circle(0, 0, SYM.dot, true).pin("N", 0, 0, "right");
    g.ports[0].free = true;
    return g;
  }, { caption: "" }),
  sym("terminal", "Connections", "Terminal", "X", "connection point input output", () =>
    new Sym(2, 2).circle(-0.55, 0, 0.45).l(-0.1, 0, 1, 0).pin("1", 1, 0, "right"), { caption: "" }),
  sym("earth", "Connections", "Earth", "PE", "ground gnd protective", () =>
    new Sym(4, 4).l(0, -2, 0, 0).l(-1.5, 0, 1.5, 0).l(-1, 0.6, 1, 0.6).l(-0.5, 1.2, 0.5, 1.2).pin("1", 0, -2, "top"), { caption: "" }),
  sym("ground", "Connections", "Ground, 0 V", "GND", "gnd reference common mass chassis", () =>
    new Sym(4, 2).l(0, -1, 0, 0.4).thick(3, -1.5, 0.4, 1.5, 0.4).pin("1", 0, -1, "top"), { caption: "" }),
  sym("supply", "Connections", "Supply rail", "V", "vcc vdd power positive rail", () =>
    new Sym(4, 4).l(0, 2, 0, -0.55).circle(0, -1, 0.45).pin("1", 0, 2, "bottom"), { caption: "+5 V" }),

  sym("voltage-arrow", "Arrows", "Voltage arrow", "U", "reference direction annotation", () => new Sym(8, 2).arrow(-4, 0, 4, 0, 1.2, 0.36)),
  sym("current-arrow", "Arrows", "Current arrow", "I", "reference direction annotation", () => new Sym(2, 2).head(0.75, 0, 1, 0, 1.5, 0.48)),
];

// ---- logic gates ------------------------------------------------------------------------------

/** The inputs of a gate, top to bottom, on the millimetre grid. */
const inputYs = (n: number): number[] => (n === 1 ? [0] : n === 2 ? [-1, 1] : [-1, 0, 1]);
const INPUT_NAMES = ["A", "B", "C"];

/** A gate as IEC draws it: a box with what it does written in it, and a ring where it negates. */
function iecGate(label: string, inputs: number, negated: boolean): Sym {
  const g = new Sym(8, 5);
  g.box(-2, -2.5, 4, 5).text(0, -1.25, label, SYM.font * 0.9);
  inputYs(inputs).forEach((y, i) => g.l(-4, y, -2, y).pin(INPUT_NAMES[i], -4, y, "left"));
  if (negated) g.circle(2.4, 0, 0.4).l(2.8, 0, 4, 0);
  else g.l(2, 0, 4, 0);
  return g.pin("Y", 4, 0, "right");
}

/** Where the curved back of an OR gate is, at height y: its inputs reach that far. */
const OR_BACK = { cx: -5.611, r: 3.911, half: 30.76 } as const;
const orBackX = (y: number, shift = 0) => OR_BACK.cx - shift + Math.sqrt(OR_BACK.r ** 2 - y * y);

/** A gate as the American standard draws it: the D of an AND, the shield of an OR, the triangle of a buffer. */
function ansiGate(kind: "and" | "or" | "xor" | "buffer", inputs: number, negated: boolean): Sym {
  const g = new Sym(8, 4);
  // Where the body ends: a negated buffer is shorter, so its ring fits before the lead.
  let tip = 2.25;
  if (kind === "and") {
    g.l(0.25, -2, -2.25, -2, -2.25, 2, 0.25, 2).arc(0.25, 0, 2, -90, 90);
    inputYs(inputs).forEach((y, i) => g.l(-4, y, -2.25, y).pin(INPUT_NAMES[i], -4, y, "left"));
  } else if (kind === "buffer") {
    if (negated) tip = 1.45;
    g.poly(false, -2.25, -2, -2.25, 2, tip, 0).l(-4, 0, -2.25, 0).pin("A", -4, 0, "left");
  } else {
    g.l(-2.25, -2, -1.214, -2).arc(-1.214, 2, 4, 30, 90).l(-2.25, 2, -1.214, 2).arc(-1.214, -2, 4, 270, 330);
    g.arc(OR_BACK.cx, 0, OR_BACK.r, -OR_BACK.half, OR_BACK.half);
    if (kind === "xor") g.arc(OR_BACK.cx - 0.65, 0, OR_BACK.r, -OR_BACK.half, OR_BACK.half);
    inputYs(inputs).forEach((y, i) => g.l(-4, y, orBackX(y), y).pin(INPUT_NAMES[i], -4, y, "left"));
  }
  if (negated) g.circle(tip + 0.4, 0, 0.4).l(tip + 0.8, 0, 4, 0);
  else g.l(tip, 0, 4, 0);
  return g.pin("Y", 4, 0, "right");
}

/** A flip-flop: a box with its inputs on the left, named inside it, and Q and its inverse on the right. */
function flipFlop(inputs: [string, number][], clock: number | null): Sym {
  const g = new Sym(10, 8);
  g.box(-3, -4, 6, 8);
  const small = SYM.font * 0.8;
  for (const [name, y] of inputs) g.l(-5, y, -3, y).text(-2.15, y, `\\mathrm{${name}}`, small).pin(name, -5, y, "left");
  if (clock !== null) g.l(-5, clock, -3, clock).l(-3, clock - 0.6, -2.1, clock, -3, clock + 0.6).pin("CLK", -5, clock, "left");
  g.l(3, -2, 5, -2).text(2.15, -2, "\\mathrm{Q}", small).pin("Q", 5, -2, "right");
  g.l(3, 2, 5, 2).text(2.15, 2, "\\overline{\\mathrm{Q}}", small).pin("QN", 5, 2, "right");
  return g;
}

const gate = (style: "iec" | "ansi", key: string, name: string, words: string, make: () => Sym): SymbolEntry =>
  ({ key: `logic/${style}/${key}`, cat: "logic", group: "Gates", style, words, make: () => part(make(), name, "G", { caption: "" }) });

const GATES: [string, string, string, string, "and" | "or" | "xor" | "buffer", number, boolean][] = [
  // key, name, words, the IEC sign, the American outline, inputs, negated
  ["and", "AND", "conjunction", "\\&", "and", 2, false],
  ["or", "OR", "disjunction", "{\\geq}1", "or", 2, false],
  ["not", "NOT", "inverter negation", "1", "buffer", 1, true],
  ["nand", "NAND", "not and", "\\&", "and", 2, true],
  ["nor", "NOR", "not or", "{\\geq}1", "or", 2, true],
  ["xor", "XOR", "exclusive or antivalence", "{=}1", "xor", 2, false],
  ["xnor", "XNOR", "equivalence exclusive nor", "{=}1", "xor", 2, true],
  ["buffer", "Buffer", "driver", "1", "buffer", 1, false],
  ["and3", "AND, 3 inputs", "conjunction three", "\\&", "and", 3, false],
  ["or3", "OR, 3 inputs", "disjunction three", "{\\geq}1", "or", 3, false],
  ["nand3", "NAND, 3 inputs", "not and three", "\\&", "and", 3, true],
  ["nor3", "NOR, 3 inputs", "not or three", "{\\geq}1", "or", 3, true],
];

const flop = (key: string, name: string, words: string, make: () => Sym): SymbolEntry =>
  ({ key: `logic/${key}`, cat: "logic", group: "Flip-flops", words, make: () => part(make(), name, "FF", { caption: "" }) });

const LOGIC: SymbolEntry[] = [
  ...GATES.map(([key, name, words, sign, , inputs, negated]) => gate("iec", key, name, words, () => iecGate(sign, inputs, negated))),
  ...GATES.map(([key, name, words, , shape, inputs, negated]) => gate("ansi", key, name, words, () => ansiGate(shape, inputs, negated))),
  flop("dff", "D flip-flop", "latch register memory", () => flipFlop([["D", -2]], 2)),
  flop("jkff", "JK flip-flop", "memory", () => flipFlop([["J", -2], ["K", 2]], 0)),
  flop("srlatch", "SR latch", "set reset memory", () => flipFlop([["S", -2], ["R", 2]], null)),
];

/** Every symbol, in the order the library lists them. */
export const SYMBOLS: SymbolEntry[] = [...CIRCUIT, ...LOGIC];

/** The starter part a junction of a circuit diagram is placed from. */
export const JUNCTION_KEY = "sym/junction";
