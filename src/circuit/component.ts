// Component files: a part as JSON, to share it, keep a library of them, or
// have one written from a photo of a board (see docs/pcb-photo-to-component.md).
//
//   {
//     "format": "mech-sketch-component", "version": 1,
//     "name": "M10 GPS + compass", "ref": "GPS", "caption": "M10 GPS + compass",
//     "units": "mm", "size": [26, 26],
//     "shapes": [ { "type": "rect", "x": 0, "y": 0, "w": 26, "h": 26, "r": 2.6, "fill": "#214e95" }, ... ],
//     "ports": [ { "name": "GPS", "side": "right", "x": 26, "y": 13, "pins": ["GND", "5V", "Rx", "Tx", "SCL", "SDA"] } ]
//   }
//
// Lengths are in mm, x to the right and y down from the top left corner of the
// part. A port lists its pins in order, left to right on the top and bottom
// edges and top to bottom on the sides; with "x", "y" and "pitch" (1 mm when
// left out) they are spaced along that edge. Pins can be placed one by one
// instead, as {"name", "x", "y"}. "kind": "pads" makes the wires run onto the
// pins themselves, soldered, rather than from tags beside a connector.

import type { PartDef, PortDef, PinDef, Shape, Side, ConnectorStyle } from "./model";
import { CONNECTOR_STYLES } from "./model";
import { CONNECTOR, connectorPins } from "./art";

export const COMPONENT_FORMAT = "mech-sketch-component";

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const SIDES: Side[] = ["top", "bottom", "left", "right"];
const HEX = /^#[0-9a-fA-F]{6}$|^#[0-9a-fA-F]{3}$/;
const color = (v: unknown): string | undefined => (isStr(v) && HEX.test(v.trim()) ? v.trim() : isStr(v) && /^[a-z]+$/i.test(v) && v.toLowerCase() !== "none" ? CSS_NAMES[v.toLowerCase()] : undefined);
/** The few colour names a file is likely to use. */
const CSS_NAMES: Record<string, string> = {
  black: "#000000", white: "#ffffff", red: "#e0302b", green: "#2e8b57", blue: "#2e6ec3", yellow: "#f2b400", orange: "#ee7b21",
  grey: "#9a9fa4", gray: "#9a9fa4", silver: "#d2d7db", gold: "#d8b660", darkgreen: "#1f5f3a", navy: "#173d7a", purple: "#7f47bf",
};
const pt = (v: unknown): [number, number] | null => (Array.isArray(v) && isNum(v[0]) && isNum(v[1]) ? [v[0], v[1]] : null);

/** One shape of a file, checked: null for one that is not understood. Unit conversion is applied. */
function readShape(raw: unknown, k: number): Shape | null {
  if (!isObj(raw) || !isStr(raw.type)) return null;
  const n = (v: unknown, d?: number) => (isNum(v) ? v * k : d);
  const w = n(raw.width ?? raw["stroke-width"] ?? raw.strokeWidth);
  const paint = { ...(color(raw.fill) ? { fill: color(raw.fill) } : {}), ...(color(raw.stroke) ? { stroke: color(raw.stroke) } : {}), ...(w !== undefined ? { width: w } : {}) };
  switch (raw.type) {
    case "rect": {
      const x = n(raw.x), y = n(raw.y), ww = n(raw.w ?? raw.width_mm ?? raw.wd), h = n(raw.h ?? raw.height);
      if (x === undefined || y === undefined || ww === undefined || h === undefined) return null;
      return { type: "rect", x, y, w: ww, h, ...(n(raw.r) ? { r: n(raw.r) } : {}), ...paint };
    }
    case "circle": {
      const x = n(raw.x ?? raw.cx), y = n(raw.y ?? raw.cy), r = n(raw.r);
      return x === undefined || y === undefined || r === undefined ? null : { type: "circle", x, y, r, ...paint };
    }
    case "line": case "polyline": case "polygon": {
      let pts = Array.isArray(raw.points) ? raw.points.map(pt).filter((p): p is [number, number] => !!p) : [];
      if (!pts.length && isNum(raw.x1) && isNum(raw.y1) && isNum(raw.x2) && isNum(raw.y2)) pts = [[raw.x1, raw.y1], [raw.x2, raw.y2]];
      pts = pts.map(([x, y]) => [x * k, y * k]);
      if (pts.length < 2) return null;
      return raw.type === "polygon" ? { type: "polygon", points: pts, ...paint } : { type: "line", points: pts, ...paint };
    }
    case "arc": {
      const x = n(raw.x ?? raw.cx), y = n(raw.y ?? raw.cy), r = n(raw.r);
      if (x === undefined || y === undefined || r === undefined || !isNum(raw.start) || !isNum(raw.end)) return null;
      return { type: "arc", x, y, r, start: raw.start, end: raw.end, ...paint };
    }
    case "text": {
      const x = n(raw.x), y = n(raw.y);
      if (x === undefined || y === undefined || !isStr(raw.text)) return null;
      const align = raw.align === "start" || raw.align === "end" || raw.align === "middle" ? raw.align : raw.align === "left" ? "start" : raw.align === "right" ? "end" : undefined;
      return {
        type: "text", x, y, text: raw.text, ...(n(raw.size) ? { size: n(raw.size) } : {}), ...(color(raw.color ?? raw.fill) ? { color: color(raw.color ?? raw.fill) } : {}),
        ...(raw.bold === false ? { bold: false } : {}), ...(align ? { align } : {}), ...(isNum(raw.rotate) ? { rotate: raw.rotate } : {}),
      };
    }
    case "connector": {
      const x = n(raw.x), y = n(raw.y);
      if (x === undefined || y === undefined || !SIDES.includes(raw.side as Side) || !isNum(raw.pins)) return null;
      const style = CONNECTOR_STYLES.includes(raw.style as ConnectorStyle) ? (raw.style as ConnectorStyle) : undefined;
      return { type: "connector", x, y, side: raw.side as Side, pins: Math.max(1, Math.round(raw.pins)), ...(style ? { style } : {}), ...(n(raw.pitch) ? { pitch: n(raw.pitch) } : {}), ...(raw.mark === false ? { mark: false } : {}) };
    }
    case "chip": {
      const x = n(raw.x), y = n(raw.y), ww = n(raw.w), h = n(raw.h);
      if (x === undefined || y === undefined || ww === undefined || h === undefined) return null;
      return {
        type: "chip", x, y, w: ww, h, ...(isStr(raw.label) ? { label: raw.label } : {}), ...(isNum(raw.legs) ? { legs: raw.legs } : {}),
        ...(raw.dot === true ? { dot: true } : {}), ...(color(raw.fill) ? { fill: color(raw.fill) } : {}), ...(n(raw.size) ? { size: n(raw.size) } : {}),
      };
    }
    case "hole": {
      const x = n(raw.x), y = n(raw.y);
      return x === undefined || y === undefined ? null : { type: "hole", x, y, ...(n(raw.r) ? { r: n(raw.r) } : {}), ...(n(raw.ring) ? { ring: n(raw.ring) } : {}) };
    }
    case "passive": {
      const x = n(raw.x), y = n(raw.y);
      return x === undefined || y === undefined ? null : { type: "passive", x, y, kind: raw.kind === "r" ? "r" : "c", ...(raw.vertical === true ? { vertical: true } : {}) };
    }
    case "pad": {
      const x = n(raw.x), y = n(raw.y), ww = n(raw.w), h = n(raw.h);
      return x === undefined || y === undefined || ww === undefined || h === undefined ? null : { type: "pad", x, y, w: ww, h, ...(isStr(raw.label) ? { label: raw.label } : {}) };
    }
    case "led": {
      const x = n(raw.x), y = n(raw.y);
      return x === undefined || y === undefined ? null : { type: "led", x, y, ...(color(raw.color) ? { color: color(raw.color) } : {}) };
    }
    case "button": {
      const x = n(raw.x), y = n(raw.y);
      return x === undefined || y === undefined ? null : { type: "button", x, y, ...(n(raw.size) ? { size: n(raw.size) } : {}) };
    }
  }
  return null;
}

function readPort(raw: unknown, k: number, shapes: Shape[], problems: string[]): PortDef | null {
  if (!isObj(raw) || !isStr(raw.name)) { problems.push("A port has no name."); return null; }
  const side = SIDES.includes(raw.side as Side) ? (raw.side as Side) : null;
  if (!side) { problems.push(`Port ${raw.name} has no side: top, bottom, left or right.`); return null; }
  const list = Array.isArray(raw.pins) ? raw.pins : [];
  let pins: PinDef[] = [];
  if (list.every(isStr)) {
    const x = isNum(raw.x) ? raw.x * k : null, y = isNum(raw.y) ? raw.y * k : null;
    if (x === null || y === null) { problems.push(`Port ${raw.name} lists its pins by name but has no x and y.`); return null; }
    const style = CONNECTOR_STYLES.includes(raw.style as ConnectorStyle) ? (raw.style as ConnectorStyle) : CONNECTOR_STYLES.includes(raw.draw as ConnectorStyle) ? (raw.draw as ConnectorStyle) : "jst-sh";
    const pitch = isNum(raw.pitch) ? raw.pitch * k : CONNECTOR[style].pitch;
    pins = connectorPins(x, y, side, list.length, pitch).map(([px, py], i) => ({ name: (list[i] as string).trim() || `${i + 1}`, x: px, y: py }));
    // "draw": a connector is drawn there, so the file need not draw one itself.
    if (raw.draw === true || CONNECTOR_STYLES.includes(raw.draw as ConnectorStyle)) {
      shapes.push({ type: "connector", x, y, side, pins: list.length, style: CONNECTOR_STYLES.includes(raw.draw as ConnectorStyle) ? (raw.draw as ConnectorStyle) : style, ...(isNum(raw.pitch) ? { pitch } : {}) });
    }
  } else {
    pins = list.flatMap((p, i): PinDef[] => (isObj(p) && isNum(p.x) && isNum(p.y) ? [{ name: isStr(p.name) && p.name.trim() ? p.name.trim() : `${i + 1}`, x: p.x * k, y: p.y * k }] : []));
  }
  if (!pins.length) { problems.push(`Port ${raw.name} has no pins.`); return null; }
  const names = new Set<string>();
  for (const p of pins) {
    if (names.has(p.name)) problems.push(`Port ${raw.name} has two pins called ${p.name}: wires can reach only the first.`);
    names.add(p.name);
  }
  return { name: raw.name.trim() || "Port", side, kind: raw.kind === "pads" ? "pads" : "plug", pins, ...(isNum(raw.wire) && raw.wire > 0 ? { wire: raw.wire * k } : {}) };
}

/** A component file read into a part. Throws, with what is wrong, when it cannot be read. */
export function readComponent(text: string): { part: PartDef; problems: string[] } {
  let raw: unknown;
  try {
    // A file pasted from a chat may come wrapped in a code block.
    raw = JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, ""));
  } catch {
    throw new Error("That file is not valid JSON.");
  }
  if (!isObj(raw)) throw new Error("That file is not a component.");
  if (raw.format !== undefined && raw.format !== COMPONENT_FORMAT) throw new Error(`That file is not a component: its format is ${String(raw.format)}.`);
  const problems: string[] = [];
  const units = raw.units === "grid" ? "grid" : raw.units === "in" ? "in" : raw.units === "mil" ? "mil" : "mm";
  // A grid square is a tenth of an inch, as on stripboard.
  const k = units === "in" ? 25.4 : units === "mil" ? 0.0254 : units === "grid" ? 2.54 : 1;
  const shapes: Shape[] = [];
  for (const s of Array.isArray(raw.shapes) ? raw.shapes : []) {
    const got = readShape(s, k);
    if (got) shapes.push(got);
    else problems.push(`A shape was not understood: ${JSON.stringify(s).slice(0, 80)}`);
  }
  const ports = (Array.isArray(raw.ports) ? raw.ports : []).map((p) => readPort(p, k, shapes, problems)).filter((p): p is PortDef => !!p);
  // Pins given on their own, as in version 0 files, become ports of one pin each.
  if (Array.isArray(raw.pins)) {
    for (const p of raw.pins) {
      if (!isObj(p) || !isNum(p.x) || !isNum(p.y) || !isStr(p.name)) continue;
      const dir = p.dir === "l" || p.dir === "left" ? "left" : p.dir === "u" || p.dir === "up" ? "top" : p.dir === "d" || p.dir === "down" ? "bottom" : "right";
      ports.push({ name: isStr(p.port) && p.port ? p.port : p.name, side: dir, kind: "plug", pins: [{ name: p.name, x: p.x * k, y: p.y * k }] });
    }
    // Pins that share a port name are one port.
    const merged = new Map<string, PortDef>();
    for (const p of ports) {
      const had = merged.get(p.name);
      if (had) had.pins.push(...p.pins);
      else merged.set(p.name, p);
    }
    ports.splice(0, ports.length, ...merged.values());
  }
  // The size: as given, or what the shapes and pins cover.
  let w = 0, h = 0;
  const size = pt(raw.size);
  if (size && size[0] > 0 && size[1] > 0) { w = size[0] * k; h = size[1] * k; }
  else {
    for (const s of shapes) {
      const [x1, y1] = shapeFar(s);
      w = Math.max(w, x1); h = Math.max(h, y1);
    }
    for (const p of ports) for (const q of p.pins) { w = Math.max(w, q.x); h = Math.max(h, q.y); }
  }
  if (!(w > 0 && h > 0)) throw new Error("The component has no size and nothing drawn.");
  if (!shapes.length) problems.push("The component draws nothing: it is shown as an outline.");
  if (!shapes.length) shapes.push({ type: "rect", x: 0, y: 0, w, h, r: Math.min(w, h) * 0.06, fill: "#ffffff", stroke: "#16191c", width: 0.3 });
  if (!ports.length) problems.push("The component has no ports: nothing can be wired to it.");
  const name = isStr(raw.name) && raw.name.trim() ? raw.name.trim() : "Component";
  const part: PartDef = {
    id: "", name, ref: isStr(raw.ref) && raw.ref.trim() ? raw.ref.trim() : name, w, h, shapes, ports,
    ...(isStr(raw.caption) ? { caption: raw.caption } : { caption: name }),
  };
  return { part, problems };
}

/** How far right and down a shape reaches. */
function shapeFar(s: Shape): [number, number] {
  switch (s.type) {
    case "rect": case "chip": return [s.x + s.w, s.y + s.h];
    case "pad": return [s.x + s.w / 2, s.y + s.h / 2];
    case "circle": case "arc": return [s.x + s.r, s.y + s.r];
    case "hole": return [s.x + (s.ring ?? (s.r ?? 1.6) + 0.8), s.y + (s.ring ?? (s.r ?? 1.6) + 0.8)];
    case "line": case "polygon": return [Math.max(...s.points.map((p) => p[0])), Math.max(...s.points.map((p) => p[1]))];
    case "connector": return [s.x, s.y];
    default: return [s.x, s.y];
  }
}

/** A part as a component file. A part drawn in the sketcher has no shapes to write: null. */
export function writeComponent(part: PartDef): string | null {
  if (!part.shapes) return null;
  const round = (v: unknown): unknown => (typeof v === "number" ? Math.round(v * 1000) / 1000 : Array.isArray(v) ? v.map(round) : isObj(v) ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, round(x)])) : v);
  const one = (v: unknown) => JSON.stringify(round(v)).replace(/,"/g, ', "').replace(/":/g, '": ');
  const head = { format: COMPONENT_FORMAT, version: 1, name: part.name, ref: part.ref, ...(part.caption !== undefined ? { caption: part.caption } : {}), units: "mm", size: [part.w, part.h] };
  const ports = part.ports.map((p) => ({ name: p.name, side: p.side, ...(p.kind === "pads" ? { kind: "pads" } : {}), ...(p.wire ? { wire: p.wire } : {}), pins: p.pins }));
  return "{\n" + Object.entries(head).map(([k, v]) => `  ${JSON.stringify(k)}: ${one(v)},`).join("\n") +
    `\n  "shapes": [\n    ${part.shapes.map(one).join(",\n    ")}\n  ],\n  "ports": [\n    ${ports.map(one).join(",\n    ")}\n  ]\n}\n`;
}
