// The wiring guide's data: the parts drawn for it, the devices placed from
// them and the wires between their pins. It is kept with the drawing, in
// Sketch.circuit, so saving, opening and undo take it along.
//
// Lengths are in mm. A part's own drawing and its pins are in the part's mm,
// with y running down from its top left corner, as in a component file; the
// guide itself has y running up, as every figure here does.

import type { Sketch } from "../model";

export type Side = "top" | "bottom" | "left" | "right";
export type XY = [number, number];

/**
 * One shape of a part's drawing. Plain shapes, and ready-made pieces of a
 * board (a connector, a chip, a mounting hole) that are drawn the same way on
 * every part. Colours are CSS hex; `width` is a line's thickness in mm.
 */
export type Shape =
  | { type: "rect"; x: number; y: number; w: number; h: number; r?: number; fill?: string; stroke?: string; width?: number }
  | { type: "circle"; x: number; y: number; r: number; fill?: string; stroke?: string; width?: number }
  | { type: "line"; points: XY[]; stroke?: string; width?: number }
  | { type: "polygon"; points: XY[]; fill?: string; stroke?: string; width?: number }
  /** Part of a circle, from `start` to `end` in degrees, counter-clockwise as seen, 0 pointing right. */
  | { type: "arc"; x: number; y: number; r: number; start: number; end: number; stroke?: string; width?: number }
  /** Text centred on (x, y), or starting or ending there. `rotate` is in degrees, counter-clockwise as seen. */
  | { type: "text"; x: number; y: number; text: string; size?: number; color?: string; bold?: boolean; align?: "start" | "middle" | "end"; rotate?: number }
  /** A wire-to-board connector whose opening is on `side`, centred on (x, y) at the edge of the board. */
  | { type: "connector"; x: number; y: number; side: Side; pins: number; pitch?: number; style?: ConnectorStyle; mark?: boolean }
  | { type: "chip"; x: number; y: number; w: number; h: number; label?: string; legs?: number; dot?: boolean; fill?: string; size?: number }
  | { type: "hole"; x: number; y: number; r?: number; ring?: number }
  | { type: "passive"; x: number; y: number; kind?: "c" | "r"; vertical?: boolean }
  | { type: "pad"; x: number; y: number; w: number; h: number; label?: string }
  | { type: "led"; x: number; y: number; color?: string }
  | { type: "button"; x: number; y: number; size?: number };

export type ConnectorStyle = "jst-sh" | "jst-gh" | "header";
export const CONNECTOR_STYLES: ConnectorStyle[] = ["jst-sh", "jst-gh", "header"];

/** A connection point. In a part, (x, y) is in the part's mm, y down. */
export interface PinDef { name: string; x: number; y: number }

/**
 * A connector, or a group of solder pads. Its wires are drawn as one bundle.
 * A plug's wires leave from tags at the edge of the part, one per pin, with
 * the pin's name on it; wires are soldered straight onto pads.
 */
export interface PortDef {
  name: string;
  side: Side;
  kind: "plug" | "pads";
  pins: PinDef[];
  /** How thick its wires are, in mm. Unset: the guide's wire. */
  wire?: number;
}

/** Something that can be placed on the guide: a board, a module, a motor, a battery. */
export interface PartDef {
  id: string;
  /** What it is called in the library. */
  name: string;
  /** What a device placed from it is called, as the connection list names it: H743, ESC, GPS. */
  ref: string;
  /** Written under it on the guide; a new line where there is \n. */
  caption?: string;
  /** Size of its box, in mm. */
  w: number;
  h: number;
  /** Its drawing, from a component file or the starter library. */
  shapes?: Shape[];
  /** Its drawing, when it was drawn in the sketcher: the whole drawing as saved. */
  sketch?: Sketch;
  /** For a part drawn in the sketcher: where its box is, in the sketch's mm, y up. */
  box?: { x0: number; y0: number; x1: number; y1: number };
  ports: PortDef[];
  /** The starter part it was taken from. */
  starter?: string;
}

/** A part placed on the guide. */
export interface Device {
  id: string;
  part: string;
  /** How the wires and the connection list name it. No two devices share one. */
  name: string;
  /** Where its middle is, in mm on the guide. */
  x: number;
  y: number;
  /** Quarter turns, counter-clockwise. */
  turn: 0 | 1 | 2 | 3;
  /** Mirrored left to right before it is turned: a motor on the other side of the frame. Its text stays readable. */
  flip?: boolean;
  /** Written under it, in place of the part's caption; empty for none. */
  caption?: string;
  /** Where the caption is, from the middle of the device, in mm on the guide. Unset: under it. */
  cap?: XY;
}

export interface WireEnd { dev: string; port: string; pin: string }

/** One wire, from a pin to a pin. */
export interface Wire {
  id: string;
  a: WireEnd;
  b: WireEnd;
  /** CSS hex colour. Unset: from what the pin at `a` does. */
  color?: string;
  /** A note on it, kept in the connection list. */
  label?: string;
}

/** Free text on the guide: a title, a note. (x, y) is where it is anchored, in mm on the guide. */
export interface GuideText {
  id: string;
  x: number;
  y: number;
  text: string;
  /** Height of the letters, as the em in mm. */
  size: number;
  bold?: boolean;
  color?: string;
  align?: "start" | "middle" | "end";
}

/** How the guide is drawn. */
export interface Look {
  /** How bundles turn corners. */
  corners: "round" | "square";
  /** A darker edge round every wire, so wires stand apart from each other and from white paper. */
  casing: boolean;
  /** How thick wires are, in mm. */
  wire: number;
  /** Tags of pins with nothing wired to them: outlined, or left off. */
  unused: "outline" | "hide";
  /** How much larger than its mm the guide is on paper. */
  scale: number;
}

export interface Circuit {
  parts: PartDef[];
  devices: Device[];
  wires: Wire[];
  texts: GuideText[];
  /**
   * The course of bundles that were moved by hand, by bundle key: the place
   * of each of its middle stretches, across their run. The first and last
   * stretches start at the devices and follow them.
   */
  routes: Record<string, number[]>;
  look: Look;
  nextId: number;
}

export const DEFAULT_LOOK: Look = { corners: "round", casing: true, wire: 0.5, unused: "outline", scale: 2 };

export function newCircuit(): Circuit {
  return { parts: [], devices: [], wires: [], texts: [], routes: {}, look: { ...DEFAULT_LOOK }, nextId: 1 };
}

/** A new id in the guide: a letter for the kind of thing, then a number. */
export function circuitId(c: Circuit, prefix: "p" | "d" | "w" | "t"): string {
  let id: string;
  do id = `${prefix}${c.nextId++}`;
  while (c.parts.some((x) => x.id === id) || c.devices.some((x) => x.id === id) || c.wires.some((x) => x.id === id) || c.texts.some((x) => x.id === id));
  return id;
}

// ---- reading a saved guide ----------------------------------------------------------

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const SIDES: Side[] = ["top", "bottom", "left", "right"];

function readPort(raw: unknown): PortDef | null {
  if (!isObj(raw) || !isStr(raw.name) || !SIDES.includes(raw.side as Side) || !Array.isArray(raw.pins)) return null;
  const pins = raw.pins.filter((p): p is PinDef => isObj(p) && isStr(p.name) && isNum(p.x) && isNum(p.y)).map((p) => ({ name: p.name, x: p.x, y: p.y }));
  if (!pins.length) return null;
  return { name: raw.name, side: raw.side as Side, kind: raw.kind === "pads" ? "pads" : "plug", pins, ...(isNum(raw.wire) && raw.wire > 0 ? { wire: raw.wire } : {}) };
}

function readPart(raw: unknown, readSketch?: (raw: unknown) => Sketch): PartDef | null {
  if (!isObj(raw) || !isStr(raw.id) || !isStr(raw.name) || !isNum(raw.w) || !isNum(raw.h) || raw.w <= 0 || raw.h <= 0) return null;
  const ports = Array.isArray(raw.ports) ? raw.ports.map(readPort).filter((p): p is PortDef => !!p) : [];
  const box = isObj(raw.box) && isNum(raw.box.x0) && isNum(raw.box.y0) && isNum(raw.box.x1) && isNum(raw.box.y1) ? { x0: raw.box.x0, y0: raw.box.y0, x1: raw.box.x1, y1: raw.box.y1 } : undefined;
  return {
    id: raw.id, name: raw.name, ref: isStr(raw.ref) && raw.ref.trim() ? raw.ref : raw.name, w: raw.w, h: raw.h, ports,
    ...(isStr(raw.caption) ? { caption: raw.caption } : {}),
    ...(Array.isArray(raw.shapes) ? { shapes: raw.shapes.filter((s): s is Shape => isObj(s) && isStr(s.type)) } : {}),
    ...(isObj(raw.sketch) && Array.isArray(raw.sketch.entities) ? { sketch: readSketch ? readSketch(raw.sketch) : (raw.sketch as unknown as Sketch) } : {}),
    ...(box ? { box } : {}),
    ...(isStr(raw.starter) ? { starter: raw.starter } : {}),
  };
}

function readEnd(raw: unknown): WireEnd | null {
  return isObj(raw) && isStr(raw.dev) && isStr(raw.port) && isStr(raw.pin) ? { dev: raw.dev, port: raw.port, pin: raw.pin } : null;
}

/**
 * A guide as saved in a file, checked: what does not make sense is left out.
 * Null when it is not a guide at all. `readSketch` checks the drawings of
 * parts drawn in the sketcher the way a drawing is checked when it is opened.
 */
export function readCircuit(raw: unknown, readSketch?: (raw: unknown) => Sketch): Circuit | null {
  if (!isObj(raw)) return null;
  const c = newCircuit();
  c.parts = Array.isArray(raw.parts) ? raw.parts.map((p) => { try { return readPart(p, readSketch); } catch { return null; } }).filter((p): p is PartDef => !!p) : [];
  const parts = new Set(c.parts.map((p) => p.id));
  const names = new Set<string>();
  c.devices = (Array.isArray(raw.devices) ? raw.devices : []).flatMap((d): Device[] => {
    if (!isObj(d) || !isStr(d.id) || !isStr(d.part) || !parts.has(d.part) || !isStr(d.name) || !isNum(d.x) || !isNum(d.y)) return [];
    if (names.has(d.name)) return [];
    names.add(d.name);
    const turn = ([0, 1, 2, 3] as const).find((t) => t === d.turn) ?? 0;
    return [{
      id: d.id, part: d.part, name: d.name, x: d.x, y: d.y, turn,
      ...(d.flip === true ? { flip: true } : {}),
      ...(isStr(d.caption) ? { caption: d.caption } : {}),
      ...(Array.isArray(d.cap) && isNum(d.cap[0]) && isNum(d.cap[1]) ? { cap: [d.cap[0], d.cap[1]] as XY } : {}),
    }];
  });
  const devs = new Set(c.devices.map((d) => d.id));
  c.wires = (Array.isArray(raw.wires) ? raw.wires : []).flatMap((w): Wire[] => {
    if (!isObj(w) || !isStr(w.id)) return [];
    const a = readEnd(w.a), b = readEnd(w.b);
    if (!a || !b || !devs.has(a.dev) || !devs.has(b.dev)) return [];
    return [{ id: w.id, a, b, ...(isStr(w.color) ? { color: w.color } : {}), ...(isStr(w.label) && w.label ? { label: w.label } : {}) }];
  });
  c.texts = (Array.isArray(raw.texts) ? raw.texts : []).flatMap((t): GuideText[] =>
    isObj(t) && isStr(t.id) && isNum(t.x) && isNum(t.y) && isStr(t.text) && isNum(t.size) && t.size > 0
      ? [{
        id: t.id, x: t.x, y: t.y, text: t.text, size: t.size,
        ...(t.bold === true ? { bold: true } : {}),
        ...(isStr(t.color) ? { color: t.color } : {}),
        ...(t.align === "start" || t.align === "middle" || t.align === "end" ? { align: t.align } : {}),
      }]
      : []);
  if (isObj(raw.routes)) {
    for (const [k, v] of Object.entries(raw.routes)) if (Array.isArray(v) && v.every(isNum)) c.routes[k] = v;
  }
  if (isObj(raw.look)) {
    const l = raw.look;
    c.look = {
      corners: l.corners === "square" ? "square" : "round",
      casing: l.casing !== false,
      wire: isNum(l.wire) && l.wire > 0.05 && l.wire < 5 ? l.wire : DEFAULT_LOOK.wire,
      unused: l.unused === "hide" ? "hide" : "outline",
      scale: isNum(l.scale) && l.scale > 0.05 && l.scale < 50 ? l.scale : DEFAULT_LOOK.scale,
    };
  }
  c.nextId = isNum(raw.nextId) && raw.nextId >= 1 ? Math.floor(raw.nextId) : 1;
  return c;
}

// ---- looking things up ----------------------------------------------------------------

export const partOf = (c: Circuit, d: Device): PartDef | undefined => c.parts.find((p) => p.id === d.part);
export const deviceById = (c: Circuit, id: string): Device | undefined => c.devices.find((d) => d.id === id);
export const deviceByName = (c: Circuit, name: string): Device | undefined => {
  const key = name.trim().toLowerCase();
  return c.devices.find((d) => d.name.toLowerCase() === key);
};
export const portOf = (part: PartDef | undefined, name: string): PortDef | undefined => part?.ports.find((p) => p.name === name);

/** Whether the end names a pin that is there. */
export function endExists(c: Circuit, e: WireEnd): boolean {
  const d = deviceById(c, e.dev);
  return !!d && !!portOf(partOf(c, d), e.port)?.pins.some((p) => p.name === e.pin);
}

export const sameEnd = (a: WireEnd, b: WireEnd): boolean => a.dev === b.dev && a.port === b.port && a.pin === b.pin;
const portKey = (e: WireEnd) => `${e.dev}:${e.port}`;

/**
 * The bundle a wire is in: every wire between the same two ports. Its key
 * names the two ports in a fixed order, so it is the same whichever end a
 * wire was drawn from.
 */
export function bundleKey(w: Wire): string {
  const a = portKey(w.a), b = portKey(w.b);
  return a <= b ? `${a}|${b}` : `${b}|${a}`;
}

/** The wire's ends in the order of its bundle's key: from the first port of the key to the second. */
export function keyedEnds(w: Wire): [WireEnd, WireEnd] {
  return portKey(w.a) <= portKey(w.b) ? [w.a, w.b] : [w.b, w.a];
}

/** A name for a new device that no other device has: the part's own, with a number after it where it is taken. */
export function freeName(c: Circuit, base: string): string {
  const stem = base.trim() || "Part";
  if (!deviceByName(c, stem)) return stem;
  const bare = stem.replace(/\s*\d+$/, "");
  for (let k = 2; ; k++) if (!deviceByName(c, `${bare} ${k}`)) return `${bare} ${k}`;
}

/** The wires at a pin. */
export const wiresAt = (c: Circuit, e: WireEnd): Wire[] => c.wires.filter((w) => sameEnd(w.a, e) || sameEnd(w.b, e));

/** Takes a device out, with its wires and the routes of their bundles. */
export function removeDevice(c: Circuit, id: string): void {
  c.devices = c.devices.filter((d) => d.id !== id);
  const gone = c.wires.filter((w) => w.a.dev === id || w.b.dev === id);
  c.wires = c.wires.filter((w) => !gone.includes(w));
  for (const w of gone) delete c.routes[bundleKey(w)];
}

/** Takes wires out; a bundle with none left loses its route. */
export function removeWires(c: Circuit, ids: Set<string>): void {
  const gone = c.wires.filter((w) => ids.has(w.id));
  c.wires = c.wires.filter((w) => !ids.has(w.id));
  const left = new Set(c.wires.map(bundleKey));
  for (const w of gone) if (!left.has(bundleKey(w))) delete c.routes[bundleKey(w)];
}

/** Renames a pin or a port of a part on every wire that names it. */
export function renameEnds(c: Circuit, part: string, port: string, pin: string | null, to: string): void {
  for (const w of c.wires) {
    for (const e of [w.a, w.b]) {
      const d = deviceById(c, e.dev);
      if (d?.part !== part || e.port !== port) continue;
      if (pin === null) e.port = to;
      else if (e.pin === pin) e.pin = to;
    }
  }
}

// ---- colours ----------------------------------------------------------------------------

/** What a pin does, read from its name, and the colour manuals give it. */
export interface PinKind { kind: string; bg: string; fg: string; label: string }

export const PIN_KINDS: { test: RegExp; kind: string; bg: string; fg: string; label: string }[] = [
  { test: /^(GND|G|-|−|VSS|0V|BAT-|V-)$|^GND/i, kind: "gnd", bg: "#1c1c1c", fg: "#ffffff", label: "Ground" },
  { test: /^(\+|5V|9V|12V|3V3|3\.3V|VBAT|BAT\+?|VCC|VIN|VDD|V\+|4V5|10V|VX|PWR)/i, kind: "power", bg: "#e0302b", fg: "#ffffff", label: "Power" },
  { test: /^(T[Xx]|TXD)/, kind: "tx", bg: "#3a9c48", fg: "#ffffff", label: "Transmit" },
  { test: /^(R[Xx]|RXD)/, kind: "rx", bg: "#f2b400", fg: "#2a2000", label: "Receive" },
  { test: /^SCL/i, kind: "scl", bg: "#9a9fa4", fg: "#ffffff", label: "I²C clock" },
  { test: /^SDA/i, kind: "sda", bg: "#2e6ec3", fg: "#ffffff", label: "I²C data" },
  { test: /^(M\d|S\d|PWM)/i, kind: "motor", bg: "#4a92e2", fg: "#ffffff", label: "Motor / servo signal" },
  { test: /^(CUR|CURR|AMP|I)$/i, kind: "current", bg: "#7f47bf", fg: "#ffffff", label: "Current sense" },
  { test: /^(VID|CAM|VIDEO)/i, kind: "video", bg: "#f2b400", fg: "#2a2000", label: "Video" },
  { test: /^(SBUS|CRSF|PPM|IBUS|SIG|SIGNAL)/i, kind: "rc", bg: "#ee7b21", fg: "#ffffff", label: "RC / signal" },
  { test: /^LED/i, kind: "led", bg: "#3a9c48", fg: "#ffffff", label: "LED data" },
  { test: /^BUZ/i, kind: "buzzer", bg: "#ee7b21", fg: "#ffffff", label: "Buzzer" },
  { test: /^(MOSI|MISO|SCK|CS|NSS)/i, kind: "spi", bg: "#2e9c9a", fg: "#ffffff", label: "SPI" },
  { test: /^(D\+|D-|DP|DM|USB)/i, kind: "usb", bg: "#5c6bc0", fg: "#ffffff", label: "USB" },
];
const OTHER: PinKind = { kind: "other", bg: "#6b7177", fg: "#ffffff", label: "Other" };

export function pinKind(name: string): PinKind {
  const n = name.trim();
  for (const k of PIN_KINDS) if (k.test.test(n)) {
    // Current is a whole word, or begins one: Curr, CUR.
    if (k.kind === "current" && !/^(cur|curr|amp|i)$/i.test(n) && !/^curr?/i.test(n)) continue;
    return k;
  }
  if (/^curr?/i.test(n)) return PIN_KINDS.find((k) => k.kind === "current")!;
  return OTHER;
}

/** Colours a wire can be given by name, as the connection list writes them. */
export const NAMED_COLORS: Record<string, string> = {
  black: "#1c1c1c", red: "#e0302b", green: "#3a9c48", yellow: "#f2b400", blue: "#2e6ec3", lightblue: "#4a92e2",
  purple: "#7f47bf", orange: "#ee7b21", grey: "#9a9fa4", white: "#ffffff", brown: "#8a5a2b", teal: "#2e9c9a", pink: "#e25b9c",
};
const COLOR_NAMES = Object.fromEntries(Object.entries(NAMED_COLORS).map(([k, v]) => [v, k]));

/** A colour as written in a connection list: a name, a hex colour, or nothing. Null when it is not one. */
export function readColor(text: string): string | null | undefined {
  const t = text.trim().toLowerCase();
  if (!t) return undefined;
  if (t === "gray") return NAMED_COLORS.grey;
  if (NAMED_COLORS[t]) return NAMED_COLORS[t];
  if (/^#?[0-9a-f]{6}$/.test(t)) return t.startsWith("#") ? t : `#${t}`;
  if (/^#?[0-9a-f]{3}$/.test(t)) { const h = t.replace("#", ""); return `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`; }
  return null;
}
/** A colour's name, where it has one, else its hex. */
export const colorName = (hex: string): string => COLOR_NAMES[hex.toLowerCase()] ?? hex;

/** The colour of a wire: its own, or the colour of what its first pin does. */
export const wireColor = (w: Wire): string => w.color ?? pinKind(w.a.pin).bg;

/** `hex` made darker by the share `k`. */
export function darken(hex: string, k: number): string {
  const v = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!v) return hex;
  const n = parseInt(v[1], 16);
  return "#" + [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => Math.round(c * (1 - k)).toString(16).padStart(2, "0")).join("");
}
/** `hex` mixed with white by the share `k`. */
export function lighten(hex: string, k: number): string {
  const v = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!v) return hex;
  const n = parseInt(v[1], 16);
  return "#" + [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => Math.round(c + (255 - c) * k).toString(16).padStart(2, "0")).join("");
}
/** The edge drawn round a wire of the colour. */
export const casingOf = (hex: string): string => (/^#?f{6}$/i.test(hex) || /^#?fff$/i.test(hex) ? "#9aa0a6" : darken(hex === "#1c1c1c" ? "#3a3d40" : hex, 0.36));

// ---- pairing pins ------------------------------------------------------------------------

/** The voltage a power pin names, where it names one: 5 for 5V, 3.3 for 3V3. */
function volts(name: string): number | null {
  const m = /^(\d+)(?:[.,v](\d+))?v?$/i.exec(name.replace(/^v/i, ""));
  if (!m) return null;
  return Number(`${m[1]}${m[2] ? `.${m[2]}` : ""}`);
}

/**
 * How well a pin goes with one at the other end: what transmits goes to what
 * receives, ground to ground, power to power (of the same voltage, best),
 * and the rest by name. 0 for not at all.
 */
export function pairScore(a: string, b: string): number {
  const ka = pinKind(a).kind, kb = pinKind(b).kind;
  const strip = (s: string) => s.trim().toLowerCase().replace(/[\s_-]+/g, "");
  const bare = (s: string) => strip(s).replace(/\d+$/, "");
  if (ka === "tx" || ka === "rx") {
    // Transmit goes to receive: Tx3 on the board to Rx on the module.
    if ((ka === "tx" && kb === "rx") || (ka === "rx" && kb === "tx")) return 8;
    return 0;
  }
  if (strip(a) === strip(b)) return 10;
  if (ka !== kb) return 0;
  if (ka === "power") {
    const va = volts(a), vb = volts(b);
    if (va !== null && vb !== null) return va === vb ? 9 : 2;
    return 5;
  }
  if (ka === "other") return bare(a) && bare(a) === bare(b) ? 4 : 0;
  return bare(a) === bare(b) ? 7 : 5;
}

/**
 * What looks wrong about wiring two pins together, read from their names:
 * ground to power, two transmit or two receive pins, power of two voltages.
 * Null when nothing does.
 */
export function wireDoubt(a: string, b: string): string | null {
  const ka = pinKind(a).kind, kb = pinKind(b).kind;
  if ((ka === "gnd" && kb === "power") || (ka === "power" && kb === "gnd")) return "ground is wired to power";
  if (ka === "tx" && kb === "tx") return "two transmit pins are wired together: Tx goes to Rx";
  if (ka === "rx" && kb === "rx") return "two receive pins are wired together: Rx goes to Tx";
  if (ka === "power" && kb === "power") {
    const va = volts(a), vb = volts(b);
    if (va !== null && vb !== null && va !== vb) return `${a} is wired to ${b}`;
  }
  return null;
}

/**
 * Pairs the pins of two ports, for wiring one to the other: the best pairs
 * first, each pin used once. Pins with nothing that goes with them are left out.
 */
export function pairPins(from: string[], to: string[]): [string, string][] {
  const cand: { i: number; j: number; s: number }[] = [];
  from.forEach((a, i) => to.forEach((b, j) => {
    const s = pairScore(a, b);
    if (s > 0) cand.push({ i, j, s: s - Math.abs(i - j) * 0.01 });
  }));
  cand.sort((x, y) => y.s - x.s);
  const usedA = new Set<number>(), usedB = new Set<number>();
  const out: [number, number][] = [];
  for (const c of cand) {
    if (usedA.has(c.i) || usedB.has(c.j)) continue;
    usedA.add(c.i);
    usedB.add(c.j);
    out.push([c.i, c.j]);
  }
  return out.sort((x, y) => x[0] - y[0]).map(([i, j]) => [from[i], to[j]]);
}
