// The library of the Wiring page, as the side panel shows it: the guide's own
// parts, then the starter parts in sections that open and close, each a grid
// of tiles with a picture and a name. A search field looks through all of it.

import { drawPrims } from "../render";
import { icon } from "../icons";
import type { Circuit, PartDef } from "./model";
import { STARTER, CATEGORIES, starterPart, type StarterEntry } from "./starter";
import { partPrims } from "./figure";
import { placePrims } from "./art";

/** What of the library is on show. */
export interface LibraryState {
  /** The sections that are open, by id; the guide's own parts are "own". */
  open: Set<string>;
  /** What is typed in the search field. */
  query: string;
  /** The shape logic gates are shown in. */
  logic: "iec" | "ansi";
  /** The part in hand, lit up in its tile. */
  placing: { starter?: string; part?: string } | null;
}

const KEY = "mech-sketch.wiring.library";
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const NONE = new Set<string>();

/** The library as it was left, or as it is first shown: the boards open, the symbols a click away. */
export function loadLibraryState(): LibraryState {
  const st: LibraryState = { open: new Set(["own", "boards"]), query: "", logic: "iec", placing: null };
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null") as { open?: unknown; logic?: unknown } | null;
    if (raw && Array.isArray(raw.open)) st.open = new Set(raw.open.filter((x): x is string => typeof x === "string"));
    if (raw?.logic === "ansi") st.logic = "ansi";
  } catch { /* storage unavailable, or not what was saved: as first shown */ }
  return st;
}

export function saveLibraryState(st: LibraryState): void {
  try { localStorage.setItem(KEY, JSON.stringify({ open: [...st.open], logic: st.logic })); } catch { /* storage unavailable */ }
}

const thumbs = new WeakMap<PartDef, Map<string, string>>();

/**
 * A picture of a part to fit w × h pixels, turned and mirrored as asked.
 * `cap` is the most pixels a millimetre may take, so small symbols do not
 * come out larger than big ones. Drawn once for each part and size, and kept.
 */
export function thumb(part: PartDef, w: number, h: number, o: { cap?: number; turn?: number; flip?: boolean } = {}): string {
  const turn = (((o.turn ?? 0) % 4) + 4) % 4, flip = !!o.flip;
  const key = `${w}x${h}|${o.cap ?? 0}|${turn}|${flip ? 1 : 0}`;
  let kept = thumbs.get(part);
  if (!kept) thumbs.set(part, (kept = new Map()));
  const had = kept.get(key);
  if (had !== undefined) return had;
  const [pw, ph] = turn % 2 ? [part.h, part.w] : [part.w, part.h];
  const k = Math.min((w - 8) / pw, (h - 8) / ph, o.cap ?? Infinity);
  let svg = "";
  try {
    const prims = turn || flip ? placePrims(partPrims(part), { turn, flip, by: [0, 0] }) : partPrims(part);
    svg = drawPrims({ view: { cx: 0, cy: 0, scale: k, w, h }, mm: 1, prims, selection: NONE, related: NONE, hover: null, conflicting: NONE, redundant: NONE, freeIds: NONE });
  } catch { /* a drawing that cannot be drawn shows empty */ }
  const out = `<svg class="cw-thumb" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true">${svg}</svg>`;
  kept.set(key, out);
  return out;
}

/** How a part is pictured in the grid: boards two to a row, symbols three, at one size against each other. */
const tilePic = (part: PartDef): string => (part.symbol ? thumb(part, 72, 48, { cap: 6.4 }) : thumb(part, 112, 72));

function tile(part: PartDef, attrs: string, on: boolean, used: number, tools = ""): string {
  const what = part.symbol ? "symbol" : "part";
  const pins = part.ports.reduce((n, p) => n + p.pins.length, 0);
  const title = `${part.name}: ${pins} pin${pins === 1 ? "" : "s"}. Click, then click on the guide where it goes.`;
  const button = `<button type="button" class="cw-tile${part.symbol ? " sym" : ""}" ${attrs} aria-pressed="${on}" title="${esc(title)}" aria-label="Place the ${what} ${esc(part.name)}">` +
    `<span class="cw-pic">${tilePic(part)}</span><span class="cw-tname">${esc(part.name)}</span>` +
    (used ? `<span class="cw-used" title="${used} on the guide">${used}</span>` : "") + `</button>`;
  return tools ? `<div class="cw-own${part.symbol ? " sym" : ""}">${button}<span class="cw-tile-tools">${tools}</span></div>` : button;
}

/** Whether everything typed is found in what a part is called and known by. */
function matches(q: string[], text: string): boolean {
  const t = text.toLowerCase();
  return q.every((w) => t.includes(w));
}

/** The library: the search field, and under it what was found, or the sections. */
export function libraryHtml(c: Circuit, st: LibraryState): string {
  const starterKeys = new Set(STARTER.map((s) => s.key));
  // The guide's own parts: drawn in the sketcher or brought in from a file. A copy of a starter part is listed with the starter parts.
  const own = c.parts.filter((p) => !p.starter || !starterKeys.has(p.starter));
  const count = (partId: string) => c.devices.reduce((n, d) => n + (d.part === partId ? 1 : 0), 0);
  const countStarter = (key: string) => { const p = c.parts.find((x) => x.starter === key); return p ? count(p.id) : 0; };
  const ownTile = (p: PartDef) => {
    const used = count(p.id);
    const tools = (p.sketch ? `<button type="button" class="cw-mini" data-cact="edit-part" data-id="${esc(p.id)}" title="Change its drawing in the sketcher" aria-label="Change the drawing of ${esc(p.name)}">${icon("bezier", 16)}</button>` : "") +
      (p.shapes ? `<button type="button" class="cw-mini" data-cact="save-part" data-id="${esc(p.id)}" title="Save it as a component file" aria-label="Save ${esc(p.name)} as a component file">${icon("partout", 16)}</button>` : "") +
      (!used ? `<button type="button" class="cw-mini" data-cact="del-part" data-id="${esc(p.id)}" title="Take it out of the library" aria-label="Take ${esc(p.name)} out of the library">${icon("trash", 16)}</button>` : "");
    return tile(p, `data-cact="place" data-id="${esc(p.id)}"`, st.placing?.part === p.id, used, tools);
  };
  const starterTile = (s: StarterEntry) => {
    const p = starterPart(s.key)!;
    const taken = c.parts.find((x) => x.starter === s.key);
    const on = st.placing?.starter === s.key || (!!taken && st.placing?.part === taken.id);
    return tile(p, `data-cact="place" data-starter="${esc(s.key)}"`, on, countStarter(s.key));
  };
  const grid = (tiles: string[], symbols: boolean) => `<div class="cw-grid${symbols ? " sym" : ""}">${tiles.join("")}</div>`;
  const shown = (s: StarterEntry) => !s.style || s.style === st.logic;

  let html = `<div class="cw-search">${icon("search", 16)}<input data-cf="lib-search" type="search" placeholder="Search parts and symbols" value="${esc(st.query)}" aria-label="Search the library" spellcheck="false" autocomplete="off"></div>`;

  const q = st.query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (q.length) {
    const mine = own.filter((p) => matches(q, `${p.name} ${p.ref}`));
    const found = STARTER.filter((s) => shown(s) && matches(q, `${starterPart(s.key)!.name} ${starterPart(s.key)!.ref} ${s.words} ${s.group}`));
    if (!mine.length && !found.length) return html + `<p class="muted cw-none">Nothing in the library is called that. A part of your own can be drawn or imported.</p>`;
    const boards = [...mine.filter((p) => !p.symbol).map(ownTile), ...found.filter((s) => s.cat === "boards").map(starterTile)];
    const symbols = [...mine.filter((p) => p.symbol).map(ownTile), ...found.filter((s) => s.cat !== "boards").map(starterTile)];
    if (boards.length) html += grid(boards, false);
    if (symbols.length) html += grid(symbols, true);
    return html;
  }

  const section = (id: string, name: string, note: string, n: number, body: () => string): string => {
    const open = st.open.has(id);
    return `<section class="cw-cat${open ? " open" : ""}">` +
      `<button type="button" class="cw-cat-head" data-cact="lib-cat" data-id="${id}" aria-expanded="${open}" title="${esc(note)}">` +
      `<span class="cw-chev" aria-hidden="true"></span><span class="cw-cat-name">${esc(name)}</span><span class="cw-count">${n}</span></button>` +
      (open ? `<div class="cw-cat-body">${body()}</div>` : "") + `</section>`;
  };

  if (own.length) {
    html += section("own", "Your parts", "Parts drawn here or imported, kept with this guide", own.length, () => {
      const boards = own.filter((p) => !p.symbol).map(ownTile), symbols = own.filter((p) => p.symbol).map(ownTile);
      return (boards.length ? grid(boards, false) : "") + (symbols.length ? grid(symbols, true) : "");
    });
  }
  for (const cat of CATEGORIES) {
    const entries = STARTER.filter((s) => s.cat === cat.id && shown(s));
    html += section(cat.id, cat.name, cat.note, entries.length, () => {
      let body = `<p class="cw-cat-note">${esc(cat.note)}</p>`;
      if (cat.id === "logic") {
        body += `<div class="segmented cw-style" role="group" aria-label="How gates are drawn">` +
          `<button type="button" data-cact="lib-logic" data-v="iec" aria-pressed="${st.logic === "iec"}" title="Boxes with the function written in them, as IEC 60617 and European textbooks draw gates">IEC (boxes)</button>` +
          `<button type="button" data-cact="lib-logic" data-v="ansi" aria-pressed="${st.logic === "ansi"}" title="The outlines of the American standard: the D of an AND, the shield of an OR">American</button></div>`;
      }
      const groups: string[] = [];
      for (const s of entries) if (!groups.includes(s.group)) groups.push(s.group);
      for (const g of groups) {
        if (groups.length > 1) body += `<p class="cw-sub">${esc(g)}</p>`;
        body += grid(entries.filter((s) => s.group === g).map(starterTile), cat.id !== "boards");
      }
      return body;
    });
  }
  return html;
}
