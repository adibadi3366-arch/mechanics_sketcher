// A drawing made of several sketches. Each sketch is solved on its own, so
// a large drawing never becomes one large system, and only the sketch being
// worked on shows its dimensions and constraints. A sketch can take geometry
// from the sketches before it, as projected reference geometry that follows
// its source; never from those after it, so editing one sketch can only move
// the ones after it, and never round in a loop.
//
// The file and the undo history keep the drawing as one sketch, with each
// entity, constraint and symbol saying which sketch it is in. Opened in a
// build that knows nothing of sketches, it is simply the whole drawing.

import { type Sketch, type SketchInfo, type Entity, type Id, ORIGIN, newId, entity } from "./model";

export interface Part {
  info: SketchInfo;
  sk: Sketch;
}

export interface Drawing {
  parts: Part[];
  active: Id;
}

/** What says which sketch something is in. */
type Tagged = { sketch?: Id };

/** Settings of the drawing as a whole, which every sketch shares. */
const SHARED = ["version", "nextId", "figureWidthMm", "dimScale", "showOrigin", "loadScale", "supportScale", "plots", "lengthScale"] as const;

/** Gives `to` the settings `from` has for the whole drawing. */
export function shareSettings(from: Sketch, to: Sketch): void {
  const a = from as unknown as Record<string, unknown>, b = to as unknown as Record<string, unknown>;
  for (const k of SHARED) {
    if (a[k] === undefined) delete b[k];
    else b[k] = a[k];
  }
}

/** A sketch of its own, with nothing in it but the origin, and the drawing's settings. */
function blank(settings: Sketch, origin: Entity): Sketch {
  const sk = { entities: [origin], constraints: [], symbols: [] } as unknown as Sketch;
  shareSettings(settings, sk);
  return sk;
}

/** The sketches of a drawing, each with what is in it. */
export function splitDrawing(all: Sketch): Drawing {
  const infos: SketchInfo[] = all.sketches?.length ? all.sketches.map((i) => ({ ...i })) : [{ id: newId(all, "sketch"), name: "Sketch 1" }];
  const known = new Set(infos.map((i) => i.id));
  const home = (x: object): Id => {
    const t = (x as Tagged).sketch;
    return t !== undefined && known.has(t) ? t : infos[0].id;
  };
  const origin = all.entities.find((e) => e.id === ORIGIN) ?? { id: ORIGIN, type: "point", x: 0, y: 0, standalone: true } as Entity;
  const parts = infos.map((info): Part => {
    const sk = blank(all, origin);
    if (info.color) sk.lineColor = info.color;
    if (info.weight !== undefined) sk.lineWeight = info.weight;
    return { info, sk };
  });
  const byId = new Map(parts.map((p) => [p.info.id, p.sk]));
  // What is in a sketch is told by its tag; inside the sketch it is plain again.
  const untag = <T extends object>(x: T): T => {
    const { sketch: _, ...rest } = x as T & Tagged;
    return rest as T;
  };
  for (const e of all.entities) if (e.id !== ORIGIN) byId.get(home(e))!.entities.push(untag(e));
  for (const c of all.constraints) byId.get(home(c))!.constraints.push(untag(c));
  for (const s of all.symbols) byId.get(home(s))!.symbols.push(untag(s));
  const active = all.active !== undefined && known.has(all.active) ? all.active : infos[0].id;
  return { parts, active };
}

/** The sketch being worked on. */
export function activePart(d: Drawing): Part {
  return d.parts.find((p) => p.info.id === d.active) ?? d.parts[0];
}

/**
 * The drawing as one sketch, each thing in it tagged with the sketch it is
 * in. `active` is the sketch being worked on as it is now: its settings are
 * the drawing's. With `figureOnly`, only the sketches that are in the
 * exported figure, and no tags: the figure as it is exported.
 */
export function mergeDrawing(d: Drawing, active: Sketch, figureOnly = false): Sketch {
  const all = blank(active, active.entities.find((e) => e.id === ORIGIN)!);
  all.nextId = Math.max(...d.parts.map((p) => (p.info.id === d.active ? active : p.sk).nextId));
  for (const part of d.parts) {
    if (figureOnly && part.info.out) continue;
    const sk = part.info.id === d.active ? active : part.sk;
    const tag = <T extends object>(x: T): T => (figureOnly ? x : { ...x, sketch: part.info.id });
    // In the figure, which is one sketch, every plain edge carries its sketch's colour and thickness itself.
    const styled = (e: Entity): Entity => {
      if (!figureOnly || e.type === "point" || e.construction || e.centre || (e.type !== "circle" && (e.arrow || e.element))) return e;
      const out = { ...e };
      if (!out.color && sk.lineColor) out.color = sk.lineColor;
      if (out.weight === undefined && sk.lineWeight !== undefined) out.weight = sk.lineWeight;
      return out;
    };
    for (const e of sk.entities) if (e.id !== ORIGIN) all.entities.push(tag(styled(e)));
    for (const c of sk.constraints) all.constraints.push(tag(c));
    for (const s of sk.symbols) all.symbols.push(tag(s));
  }
  if (!figureOnly) {
    all.sketches = d.parts.map((p) => {
      const sk = p.info.id === d.active ? active : p.sk;
      const info = { ...p.info };
      delete info.color;
      delete info.weight;
      if (sk.lineColor) info.color = sk.lineColor;
      if (sk.lineWeight !== undefined) info.weight = sk.lineWeight;
      return info;
    });
    all.active = d.active;
  }
  return all;
}

/** Where every entity of the drawing is, to look up what projected geometry follows. */
export function entityIndex(d: Drawing, active: Sketch): Map<Id, Entity> {
  const out = new Map<Id, Entity>();
  for (const p of d.parts) for (const e of (p.info.id === d.active ? active : p.sk).entities) out.set(e.id, e);
  return out;
}

/**
 * Brings projected geometry up to where its sources are now. Returns whether
 * anything moved. A projection whose source is gone stays where it was.
 */
export function followSources(sk: Sketch, index: Map<Id, Entity>): boolean {
  let moved = false;
  for (const e of sk.entities) {
    if (!e.ref) continue;
    const src = index.get(e.ref);
    if (!src || src === e) continue;
    if (e.type === "point" && src.type === "point") {
      if (Math.abs(e.x - src.x) > 1e-12 || Math.abs(e.y - src.y) > 1e-12) moved = true;
      e.x = src.x;
      e.y = src.y;
    } else if (e.type === "circle" && src.type === "circle" && Math.abs(e.r - src.r) > 1e-12) {
      e.r = src.r;
      moved = true;
    }
  }
  return moved;
}

/** True when projected geometry has lost its source: the sketch it came from, or the entity in it, was deleted. */
export function isOrphan(index: Map<Id, Entity>, e: Entity): boolean {
  return !!e.ref && !index.has(e.ref);
}

/** The sketch an entity is in, by the entity's id. */
export function partOf(d: Drawing, active: Sketch, id: Id): Part | undefined {
  return d.parts.find((p) => !!entity(p.info.id === d.active ? active : p.sk, id));
}
