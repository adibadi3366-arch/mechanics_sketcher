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

import { type Sketch, type SketchInfo, type Entity, type Id, type Point, type Curve, ORIGIN, newId, entity, curvePoints, constraintRefs, symbolRefs, remove } from "./model";

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

/** What moving geometry to another sketch did. */
export interface MoveReport {
  /** Curves and points that went. */
  moved: number;
  /** Of those, the curves. */
  curves: number;
  /** Symbols that went: notes, supports, fills and the rest. */
  symbols: number;
  /** Points left where they were, because what stays uses them too, with a copy of each going along. */
  copied: number;
  /** Constraints and symbols that tied what went to what stayed, and were dropped. */
  dropped: number;
}

/**
 * Moves the picked curves and points of the sketch being worked on (`active`)
 * to another sketch of the drawing, with the constraints, dimensions and
 * symbols that are only about them. A point that what stays uses too stays,
 * and a copy of it goes; when the other sketch comes later, the copy is
 * projected from it, so the two stay joined. Projected geometry does not move.
 * Constraints and symbols between what goes and what stays can only be in
 * one sketch, so they are dropped. Null when nothing can go.
 */
export function moveToPart(d: Drawing, active: Sketch, ids: Iterable<Id>, to: Id): MoveReport | null {
  const target = d.parts.find((p) => p.info.id === to);
  const fromIndex = d.parts.findIndex((p) => p.info.id === d.active);
  const toIndex = d.parts.findIndex((p) => p.info.id === to);
  if (!target || toIndex < 0 || to === d.active) return null;
  const picked = new Set(ids);
  picked.delete(ORIGIN);

  const going = active.entities.filter((e) => e.type !== "point" && picked.has(e.id) && !e.ref);
  const goingIds = new Set(going.map((e) => e.id));
  const usedByRest = new Set<Id>();
  for (const e of active.entities) if (e.type !== "point" && !goingIds.has(e.id)) curvePoints(e).forEach((p) => usedByRest.add(p));
  const ends = new Set<Id>(going.flatMap((e) => curvePoints(e as Curve)));
  // Points picked on their own go too, when nothing that stays is built on them.
  for (const id of picked) {
    const e = entity(active, id);
    if (e?.type === "point" && !e.ref && !usedByRest.has(id)) ends.add(id);
  }
  ends.delete(ORIGIN);

  // Each point either goes, or stays and sends a copy.
  const rename = new Map<Id, Id>();
  const copies: Entity[] = [];
  const movedPoints: Id[] = [];
  const index = entityIndex(d, active);
  const indexOf = (id: Id) => d.parts.indexOf(partOf(d, active, id) ?? d.parts[fromIndex]);
  for (const id of ends) {
    const p = entity(active, id);
    if (p?.type !== "point") continue;
    if (!p.ref && !usedByRest.has(id)) {
      movedPoints.push(id);
      continue;
    }
    const source = p.ref && index.has(p.ref) ? p.ref : id;
    // Projected from the very sketch it goes to: there it is that sketch's own point.
    if (p.ref && target.sk.entities.some((e) => e.id === p.ref)) {
      rename.set(id, p.ref);
      continue;
    }
    const copy: Point = { id: newId(active, "point"), type: "point", x: p.x, y: p.y };
    // Joined to what it was copied from where the rule of sketches allows: projected from an earlier sketch.
    if (indexOf(source) < toIndex) copy.ref = source;
    copies.push(copy);
    rename.set(id, copy.id);
  }

  const there = new Set<Id>([ORIGIN, ...goingIds, ...movedPoints, ...rename.keys()]);
  const own = new Set<Id>([...goingIds, ...movedPoints]);
  /** Whether a constraint or symbol naming these goes along: all of them are there, and it is about what goes, or was picked itself. */
  const goes = (refs: Id[], pickedItself: boolean) => refs.every((r) => there.has(r)) && (pickedItself || refs.some((r) => own.has(r)));
  const swap = <T>(x: T): T => JSON.parse(JSON.stringify(x), (key, v) =>
    typeof v === "string" && rename.has(v) && !TEXT_KEYS.has(key) ? rename.get(v) : v);

  const constraintsGoing = active.constraints.filter((c) => c.type !== "sameValue" && goes(constraintRefs(c), picked.has(c.id)));
  const dimsGoing = new Set(constraintsGoing.map((c) => c.id));
  const sameGoing = active.constraints.filter((c) => c.type === "sameValue" && dimsGoing.has(c.a) && dimsGoing.has(c.b));
  const symbolsGoing = active.symbols.filter((s) => goes(symbolRefs(s), picked.has(s.id)));
  if (!going.length && !movedPoints.length && !symbolsGoing.length && !constraintsGoing.length) return null;

  const before = active.constraints.length + active.symbols.length;
  target.sk.entities.push(...copies, ...active.entities.filter((e) => movedPoints.includes(e.id)), ...going.map(swap));
  target.sk.constraints.push(...[...constraintsGoing, ...sameGoing].map(swap));
  const landed = new Set([...goingIds, ...target.sk.entities.map((e) => e.id)]);
  for (const s of symbolsGoing.map(swap)) {
    if (s.type === "fill") s.holes = s.holes.filter((h) => landed.has(h));
    target.sk.symbols.push(s);
  }
  remove(active, [...goingIds, ...movedPoints, ...constraintsGoing.map((c) => c.id), ...sameGoing.map((c) => c.id), ...symbolsGoing.map((s) => s.id)]);
  // A fill left behind loses holes that went; that is all remove() changes on its own.
  const after = active.constraints.length + active.symbols.length;
  target.sk.nextId = Math.max(target.sk.nextId, active.nextId);
  return {
    moved: going.length + movedPoints.length,
    curves: going.length,
    symbols: symbolsGoing.length,
    copied: copies.length,
    dropped: before - after - constraintsGoing.length - sameGoing.length - symbolsGoing.length,
  };
}

/** Keys that hold text, never ids, in what is moved between sketches. */
const TEXT_KEYS = new Set(["label", "text", "name", "src", "color", "tex"]);
