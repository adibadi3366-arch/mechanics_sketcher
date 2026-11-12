// A part drawn in the sketcher: its drawing is the figure of the sketch, and
// its pins are the datum points marked as pins, grouped into ports by the
// connector they name.

import type { Sketch, Datum } from "../model";
import { unitScale } from "../model";
import type { PartDef, PortDef, Side } from "./model";
import { sketchPrims, sketchScale } from "./figure";

const DIR_SIDE: Record<NonNullable<Datum["dir"]>, Side> = { l: "left", r: "right", u: "top", d: "bottom" };

/**
 * The part a sketch draws: its box is what the figure covers, its ports the
 * pins on it. Throws, saying why, when there is nothing to make a part of.
 */
export function partFromSketch(sk: Sketch, base: Pick<PartDef, "id" | "name" | "ref"> & Partial<PartDef>): { part: PartDef; problems: string[] } {
  const { prims, box } = sketchPrims(sk);
  if (!prims.length) throw new Error("There is nothing drawn yet: draw the part, then press Done.");
  const k = unitScale(sk);
  // A symbol is drawn at its size on paper and is half that on the guide; a part is drawn at its real size.
  const f = sketchScale(base);
  const problems: string[] = [];
  const w = (box.x1 - box.x0) * f, h = (box.y1 - box.y0) * f;
  const point = (id: string) => sk.entities.find((e) => e.id === id && e.type === "point") as { x: number; y: number } | undefined;
  const pins = sk.symbols.filter((s): s is Datum => s.type === "datum" && !!s.pin);
  const groups = new Map<string, { side: Side | null; pads: boolean; pins: { name: string; x: number; y: number }[] }>();
  for (const d of pins) {
    const p = point(d.at);
    if (!p) continue;
    const name = d.label.trim() || "?";
    // Every pin of a symbol is a port of its own, with its wire right on it.
    const port = base.symbol ? name : d.port?.trim() || name;
    const g = groups.get(port) ?? { side: null, pads: true, pins: [] };
    // In the part's mm, y down from its top left corner.
    g.pins.push({ name, x: (p.x * k - box.x0) * f, y: (box.y1 - p.y * k) * f });
    if (d.dir) g.side ??= DIR_SIDE[d.dir];
    if (!d.pad && !base.symbol) g.pads = false;
    groups.set(port, g);
  }
  const ports: PortDef[] = [];
  for (const [name, g] of groups) {
    // Without a direction, a port faces the edge of the part it is nearest.
    const cx = g.pins.reduce((s, p) => s + p.x, 0) / g.pins.length, cy = g.pins.reduce((s, p) => s + p.y, 0) / g.pins.length;
    const side = g.side ?? ([["left", cx], ["right", w - cx], ["top", cy], ["bottom", h - cy]] as [Side, number][]).sort((a, b) => a[1] - b[1])[0][0];
    const seen = new Set<string>();
    for (const p of g.pins) {
      if (seen.has(p.name)) problems.push(base.symbol ? `Two pins are called ${p.name}: give each its own name.` : `Connector ${name} has two pins called ${p.name}.`);
      seen.add(p.name);
    }
    ports.push({ name, side, kind: g.pads ? "pads" : "plug", pins: g.pins });
  }
  if (!ports.length) problems.push("The part has no pins yet: put some on it with the Wire pin tool on the Annotate tab, so wires can be attached.");
  const part: PartDef = {
    ...base, w, h, ports, sketch: sk, box,
    // A symbol is labelled with its name where it has no caption of its own.
    ...(base.symbol ? {} : { caption: base.caption ?? base.name }),
  };
  delete part.shapes;
  if (base.symbol && base.caption === undefined) delete part.caption;
  return { part, problems };
}
