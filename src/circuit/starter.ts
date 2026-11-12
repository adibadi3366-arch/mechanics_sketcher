// The starter library: parts drawn ready to place, at the detail a manual
// shows them, with the circuit symbols and logic gates of symbols.ts, and two
// examples: a guide that wires a quadcopter, and a small circuit diagram.
// Each part is a list of shapes, as a component file has them, so a part
// taken from here is saved in the drawing like any other.

import type { Shape, PartDef, PortDef, Side, Circuit, Device, Wire, GuideText, ConnectorStyle } from "./model";
import { newCircuit, bundleKey } from "./model";
import { C, CONNECTOR, connectorPins } from "./art";
import { SYMBOLS } from "./symbols";

type S = Shape[];
const r = (x: number, y: number, w: number, h: number, o: Partial<Extract<Shape, { type: "rect" }>> = {}): Shape => ({ type: "rect", x, y, w, h, ...o });
const circ = (x: number, y: number, rad: number, o: Partial<Extract<Shape, { type: "circle" }>> = {}): Shape => ({ type: "circle", x, y, r: rad, ...o });
/** Silkscreen text set on a baseline, as it would be in SVG: the shape wants its middle. */
const silk = (x: number, base: number, text: string, size = 1.3, o: { color?: string; align?: "start" | "middle" | "end"; rotate?: number; bold?: boolean } = {}): Shape => {
  const up = 0.36 * size;
  // Turned a quarter turn counter-clockwise, the letters stand to the left of their baseline.
  const [x0, y0] = o.rotate === 90 ? [x - up, base] : o.rotate === -90 ? [x + up, base] : [x, base - up];
  return { type: "text", x: x0, y: y0, text, size, color: o.color ?? C.silk, bold: o.bold ?? true, align: o.align ?? "middle", ...(o.rotate ? { rotate: o.rotate } : {}) };
};
const passives = (list: [number, number, number, "c" | "r"][]): S => list.map(([x, y, rot, kind]) => ({ type: "passive", x, y, kind, vertical: rot === 90 }));
const vias = (list: [number, number][]): S => list.map(([x, y]) => circ(x, y, 0.2, { fill: C.goldDark }));
const pcb = (w: number, h: number, rad: number, fill: string = C.board, edge: string = C.boardEdge, line: string = C.boardLine): S => [
  r(0, 0, w, h, { r: rad, fill, stroke: edge, width: 0.3 }),
  r(0.4, 0.4, w - 0.8, h - 0.8, { r: Math.max(0.2, rad - 0.35), stroke: line, width: 0.22 }),
];

/** A port on a connector drawn at (x, y) on `side`, with its pins named in order. */
function plug(name: string, side: Side, x: number, y: number, pins: string[], style: ConnectorStyle = "jst-sh", pitch?: number): PortDef {
  const p = pitch ?? CONNECTOR[style].pitch;
  return { name, side, kind: "plug", pins: connectorPins(x, y, side, pins.length, p).map(([px, py], i) => ({ name: pins[i], x: px, y: py })) };
}
const conn = (side: Side, x: number, y: number, pins: number, o: { style?: ConnectorStyle; mark?: boolean } = {}): Shape => ({ type: "connector", x, y, side, pins, ...o });

// ---- the flight controller ------------------------------------------------------------------

const FC_CONNS: { side: Side; at: number; n: number; label: string; pins?: string[]; marks?: string }[] = [
  { side: "top", at: 12.0, n: 8, label: "ESC2", pins: ["Curr", "Rx7", "M8", "M7", "M6", "M5", "VBAT", "GND"], marks: "CR8765VG" },
  { side: "top", at: 23.4, n: 8, label: "ESC1", pins: ["Curr", "Rx7", "M4", "M3", "M2", "M1", "VBAT", "GND"], marks: "CR4321VG" },
  { side: "right", at: 9.3, n: 4, label: "VIDEO-OUT", pins: ["Tx2", "VIDEO", "GND", "12V"] },
  { side: "right", at: 16.6, n: 4, label: "" },
  { side: "left", at: 10.2, n: 4, label: "" },
  { side: "left", at: 17.9, n: 4, label: "UART4", pins: ["GND", "5V", "Tx4", "Rx4"] },
  { side: "left", at: 25.0, n: 4, label: "LED/BUZZER", pins: ["GND", "5V", "LED", "Buzz-"] },
  { side: "bottom", at: 10.8, n: 6, label: "GPS", pins: ["GND", "5V", "Tx3", "Rx3", "SCL", "SDA"] },
  { side: "bottom", at: 19.2, n: 4, label: "UART1", pins: ["GND", "5V", "Tx1", "Rx1"] },
  { side: "bottom", at: 26.4, n: 4, label: "SBUS/CRSF", pins: ["GND", "5V", "Tx6", "Rx6"] },
];

function flightController(): PartDef {
  const W = 36, H = 36;
  const s: S = [...pcb(W, H, 1.8)];
  for (const [x, y] of [[2.75, 2.75], [33.25, 2.75], [2.75, 33.25], [33.25, 33.25]]) s.push({ type: "hole", x, y, r: 2.0, ring: 2.8 });
  const ports: PortDef[] = [];
  for (const c of FC_CONNS) {
    const x = c.side === "left" ? 0 : c.side === "right" ? W : c.at, y = c.side === "top" ? 0 : c.side === "bottom" ? H : c.at;
    s.push(conn(c.side, x, y, c.n, { mark: !c.marks }));
    if (c.pins) ports.push(plug(c.label, c.side, x, y, c.pins));
    // The name of the port on the silkscreen, inside the board from its connector.
    if (!c.label) continue;
    const depth = 0.25 + 4.0, off = 0.95;
    if (c.side === "top") s.push(silk(c.at, depth + off + 1.0 + (c.marks ? 0.9 : 0), c.label));
    else if (c.side === "bottom") s.push(silk(c.at, H - depth - off, c.label));
    else if (c.side === "left") s.push(silk(depth + off + 1.0, c.at, c.label, 1.3, { rotate: 90 }));
    else s.push(silk(W - depth - off, c.at, c.label, 1.3, { rotate: 90 }));
    if (c.marks) [...c.marks].forEach((m, k) => s.push(silk(c.at - (c.n - 1) / 2 + k, depth + 0.9, m, 0.7)));
  }
  // The SD card slot.
  s.push(r(7.2, 13.6, 6.4, 9.0, { r: 0.3, fill: C.silver, stroke: C.silverDark, width: 0.15 }), r(7.8, 14.3, 5.2, 7.0, { r: 0.2, fill: C.silverMid }));
  s.push({ type: "line", points: [[8.1, 15.2], [12.7, 15.2]], stroke: C.silverDark, width: 0.12 }, { type: "line", points: [[8.1, 20.5], [12.7, 20.5]], stroke: C.silverDark, width: 0.12 }, r(9.7, 21.3, 1.4, 0.8, { fill: C.silverDark }));
  // OSD, the IMUs, the barometer.
  s.push({ type: "chip", x: 23.8, y: 12.2, w: 4.8, h: 4.8, legs: 7, dot: true, label: "AT7456E", size: 0.75 });
  s.push({ type: "chip", x: 15.0, y: 17.2, w: 3.0, h: 4.2, dot: true, label: "BMI088", size: 0.55 });
  s.push({ type: "chip", x: 19.4, y: 17.6, w: 2.6, h: 2.8, dot: true });
  s.push(r(9.4, 24.4, 2.4, 2.4, { r: 0.2, fill: C.silver, stroke: C.silverDark, width: 0.12 }), circ(10.0, 25.0, 0.28, { fill: C.silverDark }));
  // The RGB LED and the BOOT button.
  s.push({ type: "led", x: 25.35, y: 8.05 }, silk(26.6, 8.55, "RGB", 1.0, { align: "start" }));
  s.push({ type: "button", x: 33.2, y: 23.2, size: 3.2 }, silk(30.6, 23.2, "BOOT", 1.0, { rotate: 90 }));
  // Which way is forward.
  s.push({ type: "polygon", points: [[20.5, 6.9], [22.0, 9.2], [21.05, 9.2], [21.05, 10.9], [19.95, 10.9], [19.95, 9.2], [19.0, 9.2]], fill: C.silk });
  s.push(silk(20.0, 28.6, "MicoAir H743 v2", 1.55));
  // The many small parts.
  s.push(...vias([[13.2, 13.4], [19.9, 15.2], [22.8, 19.6], [29.1, 18.6], [8.2, 25.6], [11.4, 22.8], [16.8, 23.2], [26.9, 21.2], [23.1, 9.0], [10.8, 9.6], [30.4, 25.1], [18.2, 9.3], [26.1, 24.5], [14.9, 22.6], [20.6, 26.0], [7.3, 12.9], [29.6, 11.6], [15.6, 10.4]]));
  s.push(...passives([
    [21.6, 13.0, 90, "c"], [21.6, 14.6, 90, "c"], [21.6, 16.2, 90, "r"], [30.0, 13.2, 90, "c"], [30.0, 14.8, 90, "r"], [30.0, 16.4, 90, "c"],
    [24.6, 11.0, 0, "c"], [26.4, 11.0, 0, "r"], [24.6, 18.4, 0, "c"], [26.6, 18.4, 0, "c"],
    [15.2, 16.0, 0, "c"], [16.8, 16.0, 0, "c"], [18.4, 16.0, 0, "r"], [14.3, 18.4, 90, "c"], [14.3, 20.0, 90, "c"],
    [19.6, 21.8, 0, "c"], [21.2, 21.8, 0, "r"], [7.6, 24.0, 90, "c"], [12.6, 24.0, 0, "r"], [12.8, 25.6, 90, "c"],
    [27.6, 26.6, 0, "c"], [29.2, 26.6, 0, "c"], [27.8, 23.6, 90, "r"], [9.6, 11.6, 0, "c"], [11.2, 11.6, 0, "c"],
    [12.4, 8.6, 90, "r"], [27.4, 9.4, 0, "c"], [29.0, 9.4, 0, "r"], [17.0, 12.0, 0, "c"], [18.6, 12.0, 0, "c"],
  ]));
  s.push({ type: "chip", x: 26.6, y: 20.0, w: 2.8, h: 2.8, dot: true });
  s.push({ type: "chip", x: 23.0, y: 23.3, w: 1.6, h: 2.6, fill: "#2f3439" }, { type: "chip", x: 25.2, y: 23.3, w: 1.6, h: 2.6, fill: "#2f3439" });
  s.push(r(19.0, 23.1, 3.2, 1.6, { r: 0.6, fill: C.silver, stroke: C.silverDark, width: 0.12 }));
  s.push({ type: "chip", x: 15.4, y: 9.6, w: 2.2, h: 2.2, dot: true });
  return { id: "", name: "MicoAir H743 v2", ref: "H743", caption: "", w: W, h: H, shapes: s, ports, starter: "micoair-h743" };
}

// ---- the other devices of a quadcopter ----------------------------------------------------

const tiny = (x: number, base: number, t: string, size = 0.6, color = "#d6dadd"): Shape => silk(x, base, t, size, { color });

function esc4in1(): PartDef {
  const W = 40, H = 40;
  const s: S = [...pcb(W, H, 2)];
  for (const [x, y] of [[4.75, 4.75], [35.25, 4.75], [4.75, 35.25], [35.25, 35.25]]) s.push({ type: "hole", x, y, r: 1.6, ring: 2.4 });
  // The battery pads, with the current shunts under them.
  for (const [x, sign] of [[13.0, "+"], [21.0, "−"]] as [number, string][]) {
    s.push(r(x, 0.8, 6.0, 4.2, { r: 0.6, fill: C.gold, stroke: C.goldDark, width: 0.15 }));
    s.push(silk(x + 3, 3.75, sign, 2.2, { color: "#6b4f14" }));
    s.push(r(x + 1.2, 6.0, 3.6, 1.4, { fill: "#1d1d1d" }), r(x + 1.2, 6.0, 0.55, 1.4, { fill: C.end }), r(x + 4.25, 6.0, 0.55, 1.4, { fill: C.end }), tiny(x + 3, 6.95, "R001", 0.55));
  }
  const ports: PortDef[] = [];
  // Three pads for each motor, two motors on each side.
  for (const [x, yc, num] of [[0.6, 12, 4], [0.6, 28, 3], [37.0, 12, 1], [37.0, 28, 2]] as [number, number, number][]) {
    const pins = [-1, 0, 1].map((k, i) => {
      s.push(r(x, yc + k * 2.5 - 0.8, 2.4, 1.6, { r: 0.3, fill: C.gold, stroke: C.goldDark, width: 0.12 }));
      return { name: "ABC"[i], x: x + 1.2, y: yc + k * 2.5 };
    });
    ports.push({ name: `M${num}`, side: x < 20 ? "left" : "right", kind: "pads", pins, wire: 0.6 });
    s.push(silk(x < 20 ? x + 4.2 : x - 1.8, yc + 0.7, String(num), 1.8));
  }
  // The output stages and their drivers.
  for (const [x, y] of [[7.5, 8.2], [7.5, 15.0], [7.5, 23.0], [7.5, 29.8], [27.3, 8.2], [27.3, 15.0], [27.3, 23.0], [27.3, 29.8]]) {
    s.push({ type: "chip", x, y, w: 5.2, h: 5.6, fill: "#2e3338" }, r(x + 0.6, y + 0.6, 4.0, 2.6, { r: 0.2, fill: "#454b52" }));
    for (let k = 0; k < 4; k++) s.push(r(x + 0.55 + k * 1.15, y + 5.6, 0.5, 0.45, { fill: C.leg }));
  }
  for (const [x, y] of [[15.2, 13.0], [21.0, 13.0], [15.2, 21.0], [21.0, 21.0]]) s.push({ type: "chip", x, y, w: 3.8, h: 3.8, dot: true, legs: 5 });
  s.push(...passives([[14.2, 11.6, 0, "c"], [15.8, 11.6, 0, "c"], [20.0, 11.6, 0, "r"], [22.2, 11.6, 0, "c"], [20.0, 15.0, 90, "c"], [20.0, 23.0, 90, "c"], [14.6, 26.0, 0, "c"], [21.6, 26.0, 0, "r"], [25.6, 20.0, 90, "c"], [14.0, 19.0, 90, "c"], [26.0, 14.6, 90, "r"], [13.6, 29.3, 0, "c"], [26.4, 29.3, 0, "c"], [18.0, 30.6, 0, "c"], [22.0, 30.6, 0, "r"]]));
  s.push(...vias([[12.4, 20.0], [27.6, 20.0], [20.0, 19.0], [17.0, 27.6], [23.0, 27.6], [10.0, 6.4], [30.0, 6.4], [20.0, 9.6], [14.2, 33.2], [25.8, 33.2]]));
  s.push(conn("bottom", 20, H, 8, { mark: false }));
  [..."CT4321VG"].forEach((m, k) => s.push(silk(16.5 + k, H - 0.25 - 4.0 - 0.55, m, 0.7)));
  ports.unshift(plug("FC", "bottom", 20, H, ["Curr", "Tx", "M4", "M3", "M2", "M1", "VBAT", "GND"]));
  ports.splice(1, 0, { name: "BAT", side: "top", kind: "pads", pins: [{ name: "+", x: 16, y: 2.9 }, { name: "-", x: 24, y: 2.9 }], wire: 1.25 });
  return { id: "", name: "4-in-1 ESC", ref: "ESC", caption: "4-in-1 ESC", w: W, h: H, shapes: s, ports, starter: "esc-4in1" };
}

function motor(): PartDef {
  const R = 7.5, c = R;
  const s: S = [circ(c, c, R, { fill: "#41474e", stroke: "#2a2e33", width: 0.3 }), circ(c, c, R - 1.0, { fill: "#c27a3b" })];
  for (let k = 0; k < 6; k++) {
    const a = (k * Math.PI) / 3;
    s.push({ type: "line", points: [[c, c], [c + Math.cos(a) * (R - 0.9), c + Math.sin(a) * (R - 0.9)]], stroke: "#41474e", width: 2.1 });
  }
  for (let k = 0; k < 12; k++) {
    const a = (k * Math.PI) / 6 + Math.PI / 12;
    s.push({ type: "line", points: [[c + Math.cos(a) * 3.6, c + Math.sin(a) * 3.6], [c + Math.cos(a) * (R - 1.3), c + Math.sin(a) * (R - 1.3)]], stroke: "#a86a33", width: 0.25 });
  }
  s.push(circ(c, c, R - 0.45, { stroke: "#4c5258", width: 0.3 }), circ(c, c, 2.6, { fill: "#a7aeb5", stroke: "#7d858c", width: 0.2 }));
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2 + Math.PI / 4;
    s.push(circ(c + Math.cos(a) * 1.65, c + Math.sin(a) * 1.65, 0.32, { fill: "#5b6268" }));
  }
  s.push(circ(c, c, 0.75, { fill: "#e1e4e7" }));
  const pins = [-1, 0, 1].map((j, i) => ({ name: "ABC"[i], x: c + Math.sqrt(R * R - (j * 2.5) ** 2) - 0.4, y: c + j * 2.5 }));
  return { id: "", name: "Brushless motor", ref: "Motor", caption: "", w: 2 * R, h: 2 * R, shapes: s, ports: [{ name: "Phases", side: "right", kind: "pads", pins, wire: 0.6 }], starter: "motor" };
}

function gps(): PartDef {
  const W = 26, H = 26;
  const s: S = [...pcb(W, H, 2.6, "#214e95", "#153a74", "#2f5a9e")];
  s.push(r(3.0, 3.0, 17.0, 17.0, { r: 1.0, fill: "#e6dab8", stroke: "#c4b58c", width: 0.2 }), r(5.6, 5.6, 11.8, 11.8, { r: 0.4, fill: "#d9dde1", stroke: "#b3babf", width: 0.15 }));
  s.push(circ(12.6, 10.2, 0.75, { fill: "#a4abb2" }), r(5.9, 5.9, 11.2, 0.35, { fill: "#e9ebed" }));
  s.push(silk(11.5, 23.6, "M10", 1.7, { color: "#dfe8f5" }));
  s.push(circ(22.2, 2.2, 0.55, { fill: "#55d17a" }), { type: "chip", x: 20.6, y: 4.4, w: 2.4, h: 2.4, dot: true });
  s.push(...passives([[21.6, 19.6, 90, "c"], [23.2, 19.6, 90, "c"], [21.8, 22.4, 0, "r"], [4.6, 22.6, 0, "c"], [6.6, 22.6, 0, "c"], [16.6, 22.6, 0, "c"], [18.6, 22.6, 0, "r"]]), ...vias([[8.6, 22.6], [14.6, 22.6], [22.4, 8.0], [24.2, 19.6]]));
  s.push(conn("right", W, 13, 6));
  return { id: "", name: "M10 GPS + compass", ref: "GPS", caption: "M10 GPS + compass", w: W, h: H, shapes: s, ports: [plug("GPS", "right", W, 13, ["GND", "5V", "Rx", "Tx", "SCL", "SDA"])], starter: "gps-m10" };
}

function receiver(): PartDef {
  const W = 14, H = 30.2;
  const s: S = [...pcb(W, 20, 1.2)];
  s.push({ type: "chip", x: 3.0, y: 6.0, w: 5.6, h: 5.6, dot: true, label: "ESP32", size: 0.9, legs: 6 }, { type: "chip", x: 3.4, y: 13.4, w: 3.6, h: 3.0, dot: true });
  s.push({ type: "led", x: 10.3, y: 13.9, color: "#3fbf6a" }, { type: "button", x: 10.4, y: 16.6, size: 2.0 }, r(11.2, 6.4, 1.6, 1.6, { r: 0.8, fill: C.gold }));
  s.push(...passives([[1.8, 7.2, 90, "c"], [1.8, 9.0, 90, "c"], [10.6, 9.6, 0, "c"], [10.6, 11.0, 0, "r"], [8.4, 14.6, 90, "c"], [2.2, 15.2, 90, "r"], [11.6, 18.6, 0, "c"], [2.4, 18.6, 0, "c"]]), ...vias([[1.8, 12.4], [12.4, 4.8], [6.2, 18.4]]));
  s.push(conn("top", 7, 0, 4));
  // The antenna, on its lead.
  s.push({ type: "line", points: [[7, 20], [7, 29]], stroke: "#2b2e31", width: 0.85 }, { type: "line", points: [[0.75, 29.4], [13.25, 29.4]], stroke: "#1d1f22", width: 1.5 });
  return { id: "", name: "ELRS receiver", ref: "ELRS RX", caption: "ELRS\nreceiver", w: W, h: H, shapes: s, ports: [plug("RX", "top", 7, 0, ["GND", "5V", "Rx", "Tx"])], starter: "elrs-rx" };
}

function vtx(): PartDef {
  const W = 26, B = 22;
  const s: S = [...pcb(B, B, 1.4)];
  for (const [x, y] of [[2.0, 2.0], [20.0, 2.0], [2.0, 20.0], [20.0, 20.0]]) s.push({ type: "hole", x, y, r: 0.9, ring: 1.45 });
  s.push(r(6.2, 4.6, 11.2, 12.8, { r: 0.6, fill: C.silver, stroke: C.silverDark, width: 0.18 }), r(6.6, 5.0, 10.4, 0.5, { fill: "#e8ebed" }));
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) s.push(circ(8.0 + i * 2.5, 6.8 + j * 2.8, 0.22, { fill: C.silverMid }));
  // The antenna socket, over the edge.
  s.push(r(B - 0.5, 8.2, 4.4, 5.6, { r: 0.4, fill: C.gold, stroke: C.goldDark, width: 0.2 }), circ(B + 1.7, 11.0, 1.3, { fill: "#e8cf86", stroke: C.goldDark, width: 0.2 }), circ(B + 1.7, 11.0, 0.45, { fill: C.goldDark }));
  s.push({ type: "button", x: 14.8, y: 19.0, size: 1.6 }, { type: "led", x: 17.6, y: 19.0, color: "#3a8ee8" }, r(7.6, 1.6, 3.0, 1.4, { r: 0.55, fill: C.silver, stroke: C.silverDark, width: 0.1 }));
  s.push(...passives([[5.0, 6.4, 90, "c"], [5.0, 15.6, 90, "c"], [5.0, 17.4, 90, "r"], [8.6, 18.8, 0, "c"], [10.6, 18.8, 0, "c"], [18.8, 7.0, 90, "c"], [18.8, 15.0, 90, "c"], [13.0, 2.3, 0, "r"]]), ...vias([[5.2, 11.0], [18.8, 11.0], [12.0, 19.6], [15.6, 2.3]]));
  s.push(conn("left", 0, 11, 4));
  return { id: "", name: "5.8 GHz video transmitter", ref: "VTX", caption: "5.8 GHz video\ntransmitter", w: W, h: B, shapes: s, ports: [plug("VTX", "left", 0, 11, ["Rx", "VIDEO", "GND", "BAT"])], starter: "vtx" };
}

function buzzer(): PartDef {
  const W = 18, H = 12;
  const s: S = [...pcb(W, H, 1.2)];
  s.push(circ(6.4, 6.0, 4.4, { fill: "#1a1c1f", stroke: "#000000", width: 0.2 }), circ(6.4, 6.0, 3.2, { fill: "#2b2e32" }), circ(6.4, 6.0, 0.9, { fill: "#101113" }), circ(6.4, 6.0, 4.1, { stroke: "#2e3134", width: 0.3 }));
  s.push(r(11.6, 1.6, 1.8, 1.8, { r: 0.2, fill: "#ffffff", stroke: "#b8bec4", width: 0.1 }), circ(12.5, 2.5, 0.5, { fill: "#f5f5f5", stroke: "#d0d4d8", width: 0.1 }));
  s.push(...passives([[12.0, 6.4, 0, "c"], [12.0, 8.0, 0, "r"], [14.2, 10.4, 0, "c"], [12.0, 10.4, 0, "c"]]), ...vias([[11.4, 4.6], [16.6, 10.6]]));
  s.push(conn("right", W, 6, 4));
  return { id: "", name: "Buzzer + LED", ref: "Buzzer", caption: "Buzzer + LED", w: W, h: H, shapes: s, ports: [plug("BUZ", "right", W, 6, ["GND", "5V", "LED", "Buzz-"])], starter: "buzzer" };
}

function battery(): PartDef {
  const W = 20, T = 3;
  const s: S = [r(0, T, 20, 28, { r: 2.4, fill: "#ffffff", stroke: C.ink, width: 0.45 }), r(4.5, 0, 3, 3, { r: 0.3, fill: "#1c1c1c" }), r(12.5, 0, 3, 3, { r: 0.3, fill: "#e0302b" })];
  s.push(silk(6, T + 2.6, "−", 2.0, { color: C.ink }), silk(14, T + 2.6, "+", 2.0, { color: "#e0302b" }));
  s.push(silk(10, T + 12.0, "3–6S", 3.4, { color: C.ink }), silk(10, T + 16.4, "Li-Po", 3.0, { color: C.ink }), silk(10, T + 20.6, "battery", 2.4, { color: C.ink }));
  return {
    id: "", name: "Li-Po battery", ref: "Battery", caption: "", w: W, h: T + 28, shapes: s,
    ports: [{ name: "BAT", side: "top", kind: "pads", pins: [{ name: "-", x: 6, y: 0 }, { name: "+", x: 14, y: 0 }], wire: 1.25 }], starter: "lipo",
  };
}

function camera(): PartDef {
  const W = 19, H = 19;
  const s: S = [r(0, 0, W, H, { r: 2.2, fill: "#2b2e33", stroke: "#15171a", width: 0.3 }), r(0.45, 0.45, W - 0.9, H - 0.9, { r: 1.9, stroke: "#383c42", width: 0.22 })];
  for (const [x, y] of [[2.4, 2.4], [16.6, 2.4], [2.4, 16.6], [16.6, 16.6]]) s.push(circ(x, y, 0.9, { fill: "#4a4f56", stroke: "#202226", width: 0.15 }), circ(x, y, 0.35, { fill: "#202226" }));
  s.push(circ(9.5, 8.6, 6.0, { fill: "#1a1c1f", stroke: "#0d0e10", width: 0.25 }), circ(9.5, 8.6, 4.6, { fill: "#33373d" }), circ(9.5, 8.6, 3.2, { fill: "#101215" }), circ(9.5, 8.6, 1.9, { fill: "#1d2c4a" }));
  s.push(circ(8.4, 7.4, 0.7, { fill: "#6d7c99" }), circ(10.6, 10.0, 0.3, { fill: "#4a5570" }));
  s.push(conn("bottom", 9.5, H, 3), silk(9.5, H - 5.6, "CAM", 1.1));
  return { id: "", name: "FPV camera", ref: "Camera", caption: "FPV camera", w: W, h: H, shapes: s, ports: [plug("CAM", "bottom", 9.5, H, ["5V", "GND", "VIDEO"])], starter: "camera" };
}

function servo(): PartDef {
  const W = 30, H = 14;
  const s: S = [r(0, 4.5, 30, 5, { r: 0.6, fill: "#2c2f34", stroke: "#15171a", width: 0.2 }), r(4, 0.5, 22, 13, { r: 1.2, fill: "#34383e", stroke: "#15171a", width: 0.25 })];
  for (const x of [1.6, 28.4]) s.push(circ(x, 7, 0.75, { fill: "#ffffff", stroke: "#15171a", width: 0.15 }));
  s.push(circ(19.5, 7, 4.2, { fill: "#f2f3f4", stroke: "#9aa0a6", width: 0.2 }), circ(19.5, 7, 1.3, { fill: "#d0d4d8", stroke: "#9aa0a6", width: 0.15 }), circ(19.5, 7, 0.45, { fill: "#6b7177" }));
  s.push(silk(10.5, 7.5, "SERVO", 1.3, { color: "#c9ced2" }));
  s.push(conn("left", 4, 7, 3, { style: "header" }));
  return { id: "", name: "Servo", ref: "Servo", caption: "Servo", w: W, h: H, shapes: s, ports: [plug("SERVO", "left", 4, 7, ["SIG", "5V", "GND"], "header")], starter: "servo" };
}

function sensor(): PartDef {
  const W = 20, H = 15;
  const s: S = [...pcb(W, H, 1.4, "#3d2a73", "#24184a", "#4a3780")];
  for (const [x, y] of [[2.2, 2.2], [17.8, 2.2]]) s.push({ type: "hole", x, y, r: 1.1, ring: 1.6 });
  s.push({ type: "chip", x: 8.0, y: 3.2, w: 4.0, h: 4.0, dot: true, label: "BME280", size: 0.6 });
  s.push(...passives([[5.0, 4.6, 90, "c"], [14.8, 4.6, 90, "r"], [14.8, 6.6, 90, "r"], [5.0, 6.6, 90, "c"]]));
  s.push(conn("bottom", 10, H, 4, { style: "header" }));
  ["VCC", "GND", "SCL", "SDA"].forEach((t, i) => s.push(silk(10 + (i - 1.5) * 2.54, H - 3.3, t, 0.75)));
  return { id: "", name: "I²C sensor board", ref: "Sensor", caption: "I²C sensor", w: W, h: H, shapes: s, ports: [plug("I2C", "bottom", 10, H, ["VCC", "GND", "SCL", "SDA"], "header")], starter: "i2c-sensor" };
}

/** A part of the starter library: where the library lists it, and what a search finds it by. */
export interface StarterEntry {
  key: string;
  cat: "boards" | "symbols" | "logic";
  group: string;
  /** For a logic gate: the shape it is drawn in, the IEC box or the American outline. */
  style?: "iec" | "ansi";
  words: string;
  make: () => PartDef;
}

/** The sections of the library. */
export const CATEGORIES: { id: StarterEntry["cat"]; name: string; note: string }[] = [
  { id: "boards", name: "Boards and modules", note: "Pictures of parts, for wiring guides" },
  { id: "symbols", name: "Circuit symbols", note: "For circuit diagrams, as European textbooks draw them (IEC)" },
  { id: "logic", name: "Logic gates", note: "Gates and flip-flops, as IEC boxes or American outlines" },
];

const board = (key: string, group: string, words: string, make: () => PartDef): StarterEntry => ({ key, cat: "boards", group, words, make });

/** The starter parts, in the order the library lists them. */
export const STARTER: StarterEntry[] = [
  board("micoair-h743", "Flight electronics", "flight controller fc drone autopilot ardupilot betaflight", flightController),
  board("esc-4in1", "Flight electronics", "esc speed controller drone", esc4in1),
  board("motor", "Flight electronics", "brushless drone bldc", motor),
  board("gps-m10", "Flight electronics", "gnss compass navigation", gps),
  board("elrs-rx", "Flight electronics", "receiver radio expresslrs crsf", receiver),
  board("vtx", "Flight electronics", "video transmitter fpv", vtx),
  board("camera", "Flight electronics", "fpv video", camera),
  board("buzzer", "Flight electronics", "beeper led", buzzer),
  board("lipo", "Flight electronics", "battery power pack", battery),
  board("servo", "Modules", "actuator pwm", servo),
  board("i2c-sensor", "Modules", "bme280 breakout barometer", sensor),
  ...SYMBOLS,
];

let cache: Map<string, PartDef> | null = null;
/** A starter part, drawn once and kept. */
export function starterPart(key: string): PartDef | undefined {
  cache ??= new Map(STARTER.map((s) => [s.key, { ...s.make(), starter: s.key }]));
  return cache.get(key);
}

/** The part a starter part is placed from as things stand: the guide's copy while devices use it, else the library's. */
export function peekStarter(c: Circuit, key: string): PartDef | undefined {
  const had = c.parts.find((p) => p.starter === key);
  return had && c.devices.some((d) => d.part === had.id) ? had : starterPart(key);
}

/**
 * The starter part in the guide: the copy its devices are placed from, or a
 * new copy taken now. A copy nothing is placed from any more is taken afresh,
 * so it is as the library has it today.
 */
export function useStarter(c: Circuit, key: string, id: () => string): PartDef | null {
  const had = c.parts.find((p) => p.starter === key);
  if (had && c.devices.some((d) => d.part === had.id)) return had;
  const src = starterPart(key);
  if (!src) return had ?? null;
  const part: PartDef = { ...structuredClone(src), id: had?.id ?? id() };
  if (had) c.parts[c.parts.indexOf(had)] = part;
  else c.parts.push(part);
  return part;
}

// ---- the example: a quadcopter, wired ------------------------------------------------------

/** The connections of the example, as a connection list has them. */
export const EXAMPLE_CSV = `from_device,from_port,from_pin,to_device,to_port,to_pin,colour,label
H743,ESC1,Curr,ESC,FC,Curr,,
H743,ESC1,Rx7,ESC,FC,Tx,,
H743,ESC1,M4,ESC,FC,M4,,
H743,ESC1,M3,ESC,FC,M3,,
H743,ESC1,M2,ESC,FC,M2,,
H743,ESC1,M1,ESC,FC,M1,,
H743,ESC1,VBAT,ESC,FC,VBAT,,
H743,ESC1,GND,ESC,FC,GND,,
H743,VIDEO-OUT,Tx2,VTX,VTX,Rx,,
H743,VIDEO-OUT,VIDEO,VTX,VTX,VIDEO,,
H743,VIDEO-OUT,GND,VTX,VTX,GND,,
H743,VIDEO-OUT,12V,VTX,VTX,BAT,,
H743,GPS,GND,GPS,GPS,GND,,
H743,GPS,5V,GPS,GPS,5V,,
H743,GPS,Tx3,GPS,GPS,Rx,,
H743,GPS,Rx3,GPS,GPS,Tx,,
H743,GPS,SCL,GPS,GPS,SCL,,
H743,GPS,SDA,GPS,GPS,SDA,,
H743,SBUS/CRSF,GND,ELRS RX,RX,GND,,
H743,SBUS/CRSF,5V,ELRS RX,RX,5V,,
H743,SBUS/CRSF,Tx6,ELRS RX,RX,Rx,,
H743,SBUS/CRSF,Rx6,ELRS RX,RX,Tx,,
H743,LED/BUZZER,GND,Buzzer,BUZ,GND,,
H743,LED/BUZZER,5V,Buzzer,BUZ,5V,,
H743,LED/BUZZER,LED,Buzzer,BUZ,LED,,
H743,LED/BUZZER,Buzz-,Buzzer,BUZ,Buzz-,,
Battery,BAT,+,ESC,BAT,+,red,
Battery,BAT,-,ESC,BAT,-,black,
ESC,M1,A,Motor 1,Phases,A,black,
ESC,M1,B,Motor 1,Phases,B,black,
ESC,M1,C,Motor 1,Phases,C,black,
ESC,M2,A,Motor 2,Phases,A,black,
ESC,M2,B,Motor 2,Phases,B,black,
ESC,M2,C,Motor 2,Phases,C,black,
ESC,M3,A,Motor 3,Phases,A,black,
ESC,M3,B,Motor 3,Phases,B,black,
ESC,M3,C,Motor 3,Phases,C,black,
ESC,M4,A,Motor 4,Phases,A,black,
ESC,M4,B,Motor 4,Phases,B,black,
ESC,M4,C,Motor 4,Phases,C,black,
`;

/**
 * The example guide: a quadcopter on a MicoAir H743 v2, laid out as a manual
 * would. Positions are in mm on the guide; the connections come from the
 * list above.
 */
export function exampleCircuit(wires: (c: Circuit) => void): Circuit {
  const c = newCircuit();
  let n = 1;
  const id = () => `p${n++}`;
  const devs: [string, string, number, number, Partial<Device>][] = [
    ["micoair-h743", "H743", 92, -100, {}],
    ["esc-4in1", "ESC", 97.4, -45.6, { cap: [32, 23.2] }],
    ["motor", "Motor 1", 132.9, -37.6, { flip: true }],
    ["motor", "Motor 2", 132.9, -53.6, { flip: true }],
    ["motor", "Motor 3", 61.9, -53.6, {}],
    ["motor", "Motor 4", 61.9, -37.6, {}],
    ["lipo", "Battery", 29.4, -58.1, {}],
    ["vtx", "VTX", 153.0, -76, {}],
    ["gps-m10", "GPS", 48.6, -140, {}],
    ["elrs-rx", "ELRS RX", 119, -158.5, { cap: [16, 6.5] }],
    ["buzzer", "Buzzer", 45.6, -107, {}],
  ];
  for (const [key, name, x, y, extra] of devs) {
    const part = useStarter(c, key, id)!;
    c.devices.push({ id: `d${n++}`, part: part.id, name, x, y, turn: 0, ...extra });
  }
  c.nextId = n;
  const texts: Omit<GuideText, "id">[] = [
    { x: 8, y: -79, text: "MicoAir H743 v2", size: 6.2, bold: true, align: "start", color: C.ink },
    { x: 8, y: -86.4, text: "Wiring guide", size: 4.4, bold: true, align: "start", color: "#59626a" },
  ];
  for (const t of texts) c.texts.push({ id: `t${c.nextId++}`, ...t });
  wires(c);
  // The bundles laid as a manual lays them: round the boards rather than across them.
  const key = (a: string, ap: string, b: string, bp: string) => {
    const da = c.devices.find((d) => d.name === a)!, db = c.devices.find((d) => d.name === b)!;
    return bundleKey({ a: { dev: da.id, port: ap, pin: "" }, b: { dev: db.id, port: bp, pin: "" } } as Wire);
  };
  c.routes[key("Battery", "BAT", "ESC", "BAT")] = [-17.6];
  c.routes[key("H743", "VIDEO-OUT", "VTX", "VTX")] = [124];
  c.routes[key("H743", "SBUS/CRSF", "ELRS RX", "RX")] = [-131];
  return c;
}

// ---- the example: a circuit diagram ------------------------------------------------------------

/**
 * A small circuit diagram: a transistor switching an LED, with its base
 * divider. Symbols are placed on the millimetre grid so that most wires run
 * straight from pin to pin; the junction on the base wire gets its dot from
 * the three wires that meet there.
 */
export function exampleDiagram(): Circuit {
  const c = newCircuit();
  let n = 1;
  const id = () => `p${n++}`;
  const put = (key: string, name: string, x: number, y: number, extra: Partial<Device> = {}): Device => {
    const part = useStarter(c, `sym/${key}`, id)!;
    const d: Device = { id: `d${n++}`, part: part.id, name, x, y, turn: 0, ...extra };
    c.devices.push(d);
    return d;
  };
  const devs = {
    T1: put("npn", "T1", 0, 0),
    X1: put("terminal", "X1", -22, 0, { caption: "$u_\\mathrm{in}$" }),
    R1: put("resistor", "R1", -14, 0, { value: "10k" }),
    N1: put("junction", "N1", -7, 0),
    R3: put("resistor", "R3", -7, -7, { turn: 1, value: "100k" }),
    GND2: put("ground", "GND2", -7, -15),
    GND1: put("ground", "GND1", 2, -15),
    LED1: put("led", "LED1", 2, 11, { turn: 3 }),
    R2: put("resistor", "R2", 2, 23, { turn: 1, value: "220" }),
    V1: put("supply", "V1", 2, 32),
  };
  c.nextId = n;
  const wire = (a: keyof typeof devs, pa: string, b: keyof typeof devs, pb: string) =>
    c.wires.push({ id: `w${c.nextId++}`, a: { dev: devs[a].id, port: pa, pin: pa }, b: { dev: devs[b].id, port: pb, pin: pb } });
  wire("X1", "1", "R1", "1");
  wire("R1", "2", "N1", "N");
  wire("N1", "N", "T1", "B");
  wire("N1", "N", "R3", "2");
  wire("R3", "1", "GND2", "1");
  wire("T1", "E", "GND1", "1");
  wire("T1", "C", "LED1", "K");
  wire("LED1", "A", "R2", "1");
  wire("R2", "2", "V1", "1");
  return c;
}
