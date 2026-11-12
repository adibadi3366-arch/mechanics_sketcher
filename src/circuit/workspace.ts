// The Wiring workspace: a canvas of its own where parts are placed and wired
// into a wiring guide, as an assembly manual shows how a product is wired up.
// Parts come from the starter library, from component files, or are drawn in
// the sketcher. Pins carry coloured tags with their names; wires between two
// ports run as a bundle that turns its corners together. The panel beside it
// holds the library, the connection list and how the guide is drawn.

import type { Sketch } from "../model";
import type { V } from "../geom";
import type { Prim } from "../prims";
import { drawPrims } from "../render";
import { primsToSvg, primsToTikz, figureBounds } from "../export";
import { icon } from "../icons";
import {
  type Circuit, type Device, type PartDef, type Wire, type WireEnd, type GuideText, type Look,
  newCircuit, circuitId, partOf, deviceById, freeName, numberedName, removeDevice, removeWires, dropRoute, sameEnd, pairPins, bundleKey, keyedEnds,
  wireColor, pinKind, NAMED_COLORS, colorName, PIN_KINDS,
} from "./model";
import { peekStarter, useStarter, exampleCircuit, exampleDiagram, EXAMPLE_CSV } from "./starter";
import { readCsv, writeCsv, applyCsv } from "./csv";
import { readComponent, writeComponent } from "./component";
import { placePrims, scalePrims, plainWidths } from "./art";
import {
  type Layout, type BundlePlace, type TagPlace, TAG,
  layout, guideLayers, guidePrims, partPrims, captionPrims, guideTextPrims, captionOffset, describeEnd, redrawPart, designator,
} from "./figure";
import { type LibraryState, libraryHtml, loadLibraryState, saveLibraryState, thumb } from "./library";
import { SYM, JUNCTION_KEY } from "./symbols";
import PHOTO_HOWTO from "../../docs/pcb-photo-to-component.md?raw";
import { axisOf, distToPolyline, leftOf, type Box } from "./route";

/** What the workspace needs from the app around it. */
export interface CircuitHost {
  sketch(): Sketch;
  /** Records the drawing as an undo step, saves it and redraws everything. */
  commit(): void;
  render(): void;
  /** Redraws the canvas and the panels. */
  touch(): void;
  toast(message: string): void;
  /** Opens a part's drawing in the sketcher to be drawn or changed; null for a new part. */
  editPart(partId: string | null): void;
  /** Saves text as a file the person names. */
  save(text: string, ext: string, mime: string, what: string, name: string): void;
}

type Tool = "select" | "wire" | "bundle" | "text" | "place" | "cut";

type Sel =
  | { kind: "devices"; ids: string[] }
  | { kind: "wire"; id: string }
  | { kind: "bundle"; key: string }
  | { kind: "text"; id: string }
  | null;

type Hit =
  | { kind: "pin"; end: WireEnd }
  | { kind: "device"; id: string }
  | { kind: "wire"; id: string; key: string; seg: number }
  | { kind: "text"; id: string }
  | { kind: "caption"; id: string }
  | { kind: "none" };

type Drag =
  | { kind: "pan"; last: V; moved: boolean; start: V; clear: boolean }
  | { kind: "box"; a: V; b: V; add: boolean }
  | { kind: "move"; start: V; from: { id: string; x: number; y: number }[]; grabbed: string; moved: boolean; click: Sel }
  | { kind: "segment"; key: string; index: number; axis: "h" | "v"; start: V; base: number[]; moved: boolean; click: Sel; first: "h" | "v" | null }
  | { kind: "text"; id: string; start: V; from: V; moved: boolean }
  | { kind: "caption"; id: string; start: V; from: V; moved: boolean }
  /** A stroke dragged with the Cut tool: what it crosses is taken out when it is let go. */
  | { kind: "cut"; pts: V[]; hits: Set<string>; start: V };

/** Screen pixels per mm the guide is drawn at inside its group; zoom scales the group. */
const B = 20;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const n2 = (v: number) => v.toFixed(2);
const shown = (v: number) => String(Number(v.toPrecision(4)));
const snap = (v: number, step: number) => Math.round(v / step) * step;
const NONE = new Set<string>();
const WORLD = { cx: 0, cy: 0, scale: B, w: 0, h: 0 };
/** The paper round the guide on export, in mm of the guide. */
const MARGIN = 3;

/** How far apart two stretches are: 0 where they cross. */
function segDist(a: V, b: V, c: V, d: V): number {
  const cr = (o: V, p: V, q: V) => (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0]);
  const d1 = cr(a, b, c), d2 = cr(a, b, d), d3 = cr(c, d, a), d4 = cr(c, d, b);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return 0;
  return Math.min(distToPolyline(a, [c, d]), distToPolyline(b, [c, d]), distToPolyline(c, [a, b]), distToPolyline(d, [a, b]));
}

/** How far apart grid dots are, in mm, for dots about 22 px apart on screen. */
function gridStep(pxPerMm: number): number {
  const target = 22 / pxPerMm;
  const pow = Math.pow(10, Math.floor(Math.log10(target)));
  for (const m of [1, 2, 5, 10]) if (m * pow >= target) return m * pow;
  return 10 * pow;
}

/** The primitives as SVG markup in the coordinates of the guide's group. */
function markup(prims: Prim[]): string {
  return drawPrims({ view: WORLD, mm: 1, prims, selection: NONE, related: NONE, hover: null, conflicting: NONE, redundant: NONE, freeIds: NONE });
}

/** What the primitives cover. */
function boundsOf(prims: Prim[], boxes: Box[]): Box {
  const b = figureBounds(prims);
  let { x0, y0, x1, y1 } = Number.isFinite(b.x0) ? b : { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const q of boxes) { x0 = Math.min(x0, q.x0); y0 = Math.min(y0, q.y0); x1 = Math.max(x1, q.x1); y1 = Math.max(y1, q.y1); }
  return { x0, y0, x1, y1 };
}

export class CircuitWorkspace {
  private view = { cx: 0, cy: 0, scale: 4 };
  private size: V = [800, 600];
  private tool: Tool = "select";
  private sel: Sel = null;
  private hover: Hit = { kind: "none" };
  private drag: Drag | null = null;
  private cursor: V = [-1, -1];
  /** The pin or port a wire is being drawn from. */
  private from: WireEnd | null = null;
  /** The part being placed: a part of the guide, or a starter part not yet taken. */
  private placing: { part?: string; starter?: string; turn: 0 | 1 | 2 | 3; flip: boolean } | null = null;
  private L: Layout | null = null;
  private stale = true;
  private fitted = false;
  private layers = { page: "", under: "", parts: "", over: "", tags: "", text: "" };
  private bounds: Box = { x0: -50, y0: -50, x1: 50, y1: 50 };
  /** Each part's drawing as markup, plain and mirrored: kept by the part itself, so no two parts can share one. */
  private partSvg = new WeakMap<PartDef, [string?, string?]>();
  /** What of the library is open, searched for and in hand. */
  private lib: LibraryState = loadLibraryState();
  private focusNext: string | null = null;
  /** The final view: the guide on its paper, as it is exported, with nothing else drawn and nothing to edit. */
  private preview = false;
  private viewBefore: { cx: number; cy: number; scale: number } | null = null;
  private file = document.createElement("input");
  private fileKind: "csv" | "part" = "csv";
  private world: SVGGElement;
  /** The grid while drawing, the desk in the final view: behind the guide, in screen pixels. */
  private backdrop: SVGGElement;
  private groups: Record<keyof CircuitWorkspace["layers"] | "overlay", SVGGElement>;

  constructor(private host: CircuitHost, private svg: SVGSVGElement, private panel: HTMLElement, private empty: HTMLElement) {
    const ns = "http://www.w3.org/2000/svg";
    this.world = document.createElementNS(ns, "g");
    const make = (cls: string) => { const g = document.createElementNS(ns, "g"); g.setAttribute("class", cls); return g; };
    this.groups = { page: make("cw-pagegroup"), under: make("cw-under"), parts: make("cw-parts"), over: make("cw-over"), tags: make("cw-tags"), text: make("cw-text"), overlay: make("cw-overlay") };
    for (const k of ["page", "under", "parts", "over", "tags", "text"] as const) this.world.appendChild(this.groups[k]);
    this.backdrop = make("cw-backdrop");
    svg.appendChild(this.backdrop);
    svg.appendChild(this.world);
    svg.appendChild(this.groups.overlay);
    svg.addEventListener("pointerdown", (e) => this.onDown(e));
    svg.addEventListener("pointermove", (e) => this.onMove(e));
    svg.addEventListener("pointerup", (e) => this.onUp(e));
    svg.addEventListener("pointercancel", (e) => this.onUp(e));
    svg.addEventListener("pointerleave", () => { if (!this.drag) { this.hover = { kind: "none" }; this.cursor = [-1, -1]; this.host.render(); } });
    svg.addEventListener("wheel", (e) => this.onWheel(e), { passive: false });
    svg.addEventListener("dblclick", (e) => this.onDoubleClick(e));
    svg.addEventListener("contextmenu", (e) => e.preventDefault());
    svg.addEventListener("mousedown", (e) => { if (e.button === 1) e.preventDefault(); });
    this.file.type = "file";
    this.file.hidden = true;
    this.file.addEventListener("change", () => {
      const f = this.file.files?.[0];
      this.file.value = "";
      if (f) void this.openFile(f);
    });
    document.body.appendChild(this.file);
  }

  // ---- the guide ----------------------------------------------------------------------------

  /** The guide of the drawing; one is started where there is none. */
  private c(): Circuit {
    const sk = this.host.sketch();
    return (sk.circuit ??= newCircuit());
  }

  private changed(): void {
    this.stale = true;
    this.host.commit();
  }

  /** After the drawing was swapped for another (undo, a file opened, a part drawn): what was selected may be gone. */
  sync(): void {
    const c = this.c();
    const s = this.sel;
    if (s?.kind === "devices") s.ids = s.ids.filter((id) => deviceById(c, id));
    if ((s?.kind === "devices" && !s.ids.length) || (s?.kind === "wire" && !c.wires.some((w) => w.id === s.id)) ||
      (s?.kind === "text" && !c.texts.some((t) => t.id === s.id)) || (s?.kind === "bundle" && !c.wires.some((w) => bundleKey(w) === s.key))) this.sel = null;
    if (this.from && !deviceById(c, this.from.dev)) this.from = null;
    if (this.placing?.part && !c.parts.some((p) => p.id === this.placing!.part)) this.placing = null;
    this.drag = null;
    this.hover = { kind: "none" };
    this.stale = true;
    this.partSvg = new WeakMap();
  }

  /** The workspace comes on screen. */
  enter(): void {
    this.sync();
    if (!this.fitted) this.fit();
  }

  resize(w: number, h: number): void {
    this.size = [w, h];
    this.svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  }

  /** Zooms so the whole guide is in view. */
  fit(): void {
    this.refresh();
    const c = this.c();
    const g = this.bounds;
    const b = !(c.devices.length || c.texts.length) ? { x0: -60, y0: -45, x1: 60, y1: 45 }
      : this.preview ? { x0: g.x0 - MARGIN, y0: g.y0 - MARGIN - 6, x1: g.x1 + MARGIN, y1: g.y1 + MARGIN } : g;
    const [w, h] = this.size;
    const pad = 40;
    this.view.scale = Math.max(0.5, Math.min(40, Math.min((w - 2 * pad) / Math.max(1, b.x1 - b.x0), (h - 2 * pad - 20) / Math.max(1, b.y1 - b.y0))));
    this.view.cx = (b.x0 + b.x1) / 2;
    this.view.cy = (b.y0 + b.y1) / 2 - 8 / this.view.scale;
    this.fitted = true;
    this.host.render();
  }

  private toScreen([x, y]: V): V {
    const [w, h] = this.size, z = this.view.scale;
    return [w / 2 + (x - this.view.cx) * z, h / 2 - (y - this.view.cy) * z];
  }
  private toGuide([sx, sy]: V): V {
    const [w, h] = this.size, z = this.view.scale;
    return [(sx - w / 2) / z + this.view.cx, this.view.cy - (sy - h / 2) / z];
  }

  // ---- drawing --------------------------------------------------------------------------------

  /** Lays the guide out again and draws its layers, when something in it changed. */
  private refresh(): void {
    if (!this.stale && this.L) return;
    this.stale = false;
    const c = this.c();
    this.L = layout(c);
    const g = guideLayers(c, this.L, false);
    const parts = this.L.devices.map((d) => {
      const at = this.partMarkup(d.part, !!d.dev.flip);
      return `<g data-dev="${esc(d.dev.id)}" transform="translate(${n2(d.dev.x * B)} ${n2(-d.dev.y * B)})${d.dev.turn ? ` rotate(${-90 * d.dev.turn})` : ""}">${at}</g>`;
    }).join("");
    this.bounds = boundsOf([...g.under, ...g.over, ...g.tags, ...g.text], this.L.devices.map((d) => d.box));
    const b = this.bounds;
    // The paper is drawn only in the final view, with its margin dashed inside it.
    const page = Number.isFinite(b.x0) && this.preview
      ? `<rect class="page" x="${n2((b.x0 - MARGIN) * B)}" y="${n2(-(b.y1 + MARGIN) * B)}" width="${n2((b.x1 - b.x0 + 2 * MARGIN) * B)}" height="${n2((b.y1 - b.y0 + 2 * MARGIN) * B)}"/>` +
        `<rect class="page-margin" vector-effect="non-scaling-stroke" x="${n2(b.x0 * B)}" y="${n2(-b.y1 * B)}" width="${n2((b.x1 - b.x0) * B)}" height="${n2((b.y1 - b.y0) * B)}"/>`
      : "";
    const next = { page, under: markup(g.under), parts, over: markup(g.over), tags: markup(g.tags), text: markup(g.text) };
    // Only the layers that changed are put on the page again: moving one part leaves the others as they are.
    for (const k of Object.keys(next) as (keyof CircuitWorkspace["layers"])[]) {
      if (next[k] !== this.layers[k]) this.groups[k].innerHTML = next[k];
    }
    this.layers = next;
  }

  /** A part's drawing as markup, about its middle: drawn once and kept. */
  private partMarkup(part: PartDef, flip: boolean): string {
    let kept = this.partSvg.get(part);
    if (!kept) this.partSvg.set(part, (kept = []));
    const i = flip ? 1 : 0;
    let m = kept[i];
    if (m === undefined) {
      const prims = flip ? placePrims(partPrims(part), { turn: 0, flip: true, by: [0, 0] }) : partPrims(part);
      m = kept[i] = markup(prims);
    }
    return m;
  }

  draw(): void {
    const c = this.c();
    this.empty.hidden = !!(c.devices.length || c.texts.length) || this.tool === "place";
    this.refresh();
    const [w, h] = this.size, z = this.view.scale;
    this.world.setAttribute("transform", `translate(${n2(w / 2 - this.view.cx * z)} ${n2(h / 2 + this.view.cy * z)}) scale(${(z / B).toFixed(5)})`);
    this.backdrop.innerHTML = this.backdropHtml();
    this.groups.overlay.innerHTML = this.preview ? this.previewOverlay() : this.overlay();
    this.svg.dataset.over = this.cursorKind();
    this.svg.classList.toggle("cw-final", this.preview);
  }

  /** Behind the guide: white with a grid of dots while drawing, as in the sketcher; the desk in the final view. */
  private backdropHtml(): string {
    const [w, h] = this.size;
    if (this.preview) return `<rect class="sheet desk" width="${w}" height="${h}"/>`;
    const z = this.view.scale;
    const step = gridStep(z) * z;
    const o = this.toScreen([0, 0]);
    const ox = ((o[0] % step) + step) % step - step / 2, oy = ((o[1] % step) + step) % step - step / 2;
    return `<rect class="sheet" width="${w}" height="${h}"/>` +
      `<defs><pattern id="cw-grid" width="${n2(step)}" height="${n2(step)}" patternUnits="userSpaceOnUse" x="${n2(ox)}" y="${n2(oy)}">` +
      `<circle class="grid-dot" cx="${n2(step / 2)}" cy="${n2(step / 2)}" r="0.9"/></pattern></defs>` +
      `<rect width="${w}" height="${h}" fill="url(#cw-grid)"/>`;
  }

  /** In the final view, only the size the guide comes out on paper, under it. */
  private previewOverlay(): string {
    const b = this.bounds, c = this.c();
    if (!Number.isFinite(b.x0) || !(c.devices.length || c.texts.length)) return "";
    const bottom = this.toScreen([(b.x0 + b.x1) / 2, b.y0 - MARGIN]);
    const k = c.look.scale;
    return `<text class="page-size" x="${n2(bottom[0])}" y="${n2(Math.min(this.size[1] - 8, bottom[1] + 20))}" text-anchor="middle">${shown(((b.x1 - b.x0 + 2 * MARGIN) * k) / 10)} × ${shown(((b.y1 - b.y0 + 2 * MARGIN) * k) / 10)} cm, ${shown(k)} × its size in mm, with a ${shown(MARGIN * k)} mm margin</text>`;
  }

  get previewing(): boolean {
    return this.preview;
  }

  /**
   * Switches the final view on or off. Going in, the view is fitted to the
   * paper; coming back, it returns to where it was.
   */
  setPreview(on: boolean): void {
    if (on === this.preview) return;
    this.preview = on;
    this.stale = true;
    this.drag = null;
    this.hover = { kind: "none" };
    if (on) {
      this.from = null;
      if (this.tool !== "select") { this.tool = "select"; this.placing = null; }
      this.viewBefore = { ...this.view };
      this.fit();
    } else if (this.viewBefore) {
      Object.assign(this.view, this.viewBefore);
      this.viewBefore = null;
    }
    this.host.touch();
  }

  /** What is drawn over the guide while working: what is selected and pointed at, the wire being drawn, the part being placed. */
  private overlay(): string {
    const L = this.L!;
    const c = this.c();
    const z = this.view.scale;
    const S = (p: V) => this.toScreen(p);
    const pathD = (pts: V[]) => pts.map((p, i) => `${i ? "L" : "M"}${n2(S(p)[0])} ${n2(S(p)[1])}`).join("");
    const rect = (b: Box, cls: string, grow = 4) => {
      const a = S([b.x0, b.y1]), d = S([b.x1, b.y0]);
      return `<rect class="${cls}" x="${n2(a[0] - grow)}" y="${n2(a[1] - grow)}" width="${n2(d[0] - a[0] + 2 * grow)}" height="${n2(d[1] - a[1] + 2 * grow)}" rx="4"/>`;
    };
    let out = "";
    // While drawing, each device shows the name the wires and the connection list know it by.
    for (const d of L.devices) {
      // A symbol's own caption names it.
      if (d.part.symbol) continue;
      const at = S([d.box.x0, d.box.y1]);
      const label = esc(d.dev.name);
      const wpx = d.dev.name.length * 6.1 + 10;
      out += `<g class="cw-name" transform="translate(${n2(at[0])} ${n2(at[1] - 17)})"><rect width="${n2(wpx)}" height="15" rx="3"/><text x="5" y="11">${label}</text></g>`;
    }
    const wireLine = (id: string): { line: V[]; width: number } | null => {
      for (const bd of L.bundles) {
        const i = bd.wires.findIndex((w) => w.id === id);
        if (i >= 0) return { line: bd.lines[i], width: bd.width };
      }
      return null;
    };
    const glowLine = (line: V[], width: number, cls: string) => `<path class="${cls}" d="${pathD(line)}" style="stroke-width:${n2(Math.max(5, (width + 0.9) * z))}px"/>`;
    // What the pointer is over.
    const hv = this.hover;
    if (!this.drag || this.drag.kind === "pan") {
      if (hv.kind === "device" && this.tool === "select") {
        const d = L.devices.find((x) => x.dev.id === hv.id);
        if (d) out += rect(d.box, "cw-hover");
      } else if (hv.kind === "wire" && (this.tool === "select" || (this.tool === "wire" && this.joinable(hv)))) {
        const got = wireLine(hv.id);
        if (got) out += glowLine(got.line, got.width, "cw-wire-hover");
      } else if (hv.kind === "text" || hv.kind === "caption") {
        const box = this.textBoxOf(hv);
        if (box) out += rect(box, "cw-hover", 3);
      }
    }
    // What is selected.
    const s = this.sel;
    if (s?.kind === "devices") {
      for (const id of s.ids) {
        const d = L.devices.find((x) => x.dev.id === id);
        if (d) out += rect(d.box, "cw-sel");
      }
    } else if (s?.kind === "wire") {
      const got = wireLine(s.id);
      if (got) out += glowLine(got.line, got.width, "cw-wire-sel");
    } else if (s?.kind === "bundle") {
      const bd = L.bundles.find((x) => x.key === s.key);
      if (bd) {
        for (const line of bd.lines) out += glowLine(line, bd.width, "cw-wire-sel");
        // Handles on the middle stretches, which are dragged to lay the bundle another way.
        out += this.segmentHandles(bd);
      }
    } else if (s?.kind === "text") {
      const box = this.textBoxOf({ kind: "text", id: s.id });
      if (box) out += rect(box, "cw-sel", 3);
    }
    // Handles of a wire's bundle while one of its wires is selected or pointed at.
    if (this.tool === "select" && !this.drag) {
      const key = s?.kind === "wire" ? L.bundles.find((x) => x.wires.some((w) => w.id === s.id))?.key : null;
      const bd = key ? L.bundles.find((x) => x.key === key) : null;
      if (bd && s?.kind !== "bundle") out += this.segmentHandles(bd);
    }
    // Tags light up where a wire can be attached.
    if (this.tool === "wire" || this.tool === "bundle") {
      const lit = (t: TagPlace) => hv.kind === "pin" && hv.end.dev === t.dev.id && hv.end.port === t.port && (this.tool === "bundle" || hv.end.pin === t.pin);
      for (const t of L.tags) {
        const on = lit(t);
        const from = this.from && this.from.dev === t.dev.id && this.from.port === t.port && (this.tool === "bundle" || this.from.pin === t.pin);
        if (on || from) out += rect(t.box, from ? "cw-pin-from" : "cw-pin-hover", 1.5);
        else if (!t.wired && c.look.unused === "hide") out += rect(t.box, "cw-pin-ghost", 0);
      }
      for (const d of L.devices) for (const p of d.ports) {
        if (p.port.kind !== "pads") continue;
        for (const q of p.pins) {
          const on = hv.kind === "pin" && hv.end.dev === d.dev.id && hv.end.port === p.port.name && (this.tool === "bundle" || hv.end.pin === q.name);
          const from = this.from && this.from.dev === d.dev.id && this.from.port === p.port.name && (this.tool === "bundle" || this.from.pin === q.name);
          const at = S(q.at);
          out += `<circle class="${from ? "cw-pin-from" : on ? "cw-pin-hover" : "cw-pad"}" cx="${n2(at[0])}" cy="${n2(at[1])}" r="${n2(Math.max(4, 0.9 * z))}"/>`;
        }
      }
      // The wire being drawn, from its first end to the pointer.
      if (this.from && this.cursor[0] >= 0) {
        const a = this.anchorOf(this.from);
        if (a) {
          const p = S(a);
          out += `<line class="cw-rubber" x1="${n2(p[0])}" y1="${n2(p[1])}" x2="${n2(this.cursor[0])}" y2="${n2(this.cursor[1])}"/>`;
        }
      }
    }
    // The part being placed, under the pointer.
    if (this.tool === "place" && this.placing && this.cursor[0] >= 0) {
      const part = this.placingPart();
      if (part) {
        const at = this.placeAt();
        const t = `translate(${n2(this.size[0] / 2 - this.view.cx * z)} ${n2(this.size[1] / 2 + this.view.cy * z)}) scale(${(z / B).toFixed(5)}) translate(${n2(at[0] * B)} ${n2(-at[1] * B)})${this.placing.turn ? ` rotate(${-90 * this.placing.turn})` : ""}`;
        out += `<g class="cw-ghost" transform="${t}">${this.partMarkup(part, this.placing.flip)}</g>`;
      }
    }
    // The Cut tool: the wire under the pointer, or the stroke being dragged and what it crosses.
    if (this.tool === "cut") {
      const cutting = this.drag?.kind === "cut" ? this.drag : null;
      const ids = cutting ? cutting.hits : new Set(hv.kind === "wire" ? [hv.id] : []);
      for (const bd of L.bundles) bd.wires.forEach((w, i) => {
        if (ids.has(w.id)) out += `<path class="cw-wire-cut" d="${pathD(bd.lines[i])}" style="stroke-width:${n2(Math.max(5, (bd.width + 0.9) * z))}px"/>`;
      });
      if (cutting && cutting.pts.length > 1) out += `<path class="cw-cut" d="${cutting.pts.map((p, i) => `${i ? "L" : "M"}${n2(p[0])} ${n2(p[1])}`).join("")}"/>`;
    }
    // The box being dragged out.
    if (this.drag?.kind === "box") {
      const a = this.drag.a, d = this.drag.b;
      out += `<rect class="cw-box" x="${n2(Math.min(a[0], d[0]))}" y="${n2(Math.min(a[1], d[1]))}" width="${n2(Math.abs(d[0] - a[0]))}" height="${n2(Math.abs(d[1] - a[1]))}"/>`;
    }
    // Dragging a device lines its bundles up: a guide shows where one runs straight.
    if (this.drag?.kind === "move" && this.drag.moved) {
      for (const bd of L.bundles) {
        if (bd.path.length !== 2) continue;
        if (!this.drag.from.some((f) => f.id === bd.a.dev.id || f.id === bd.b.dev.id)) continue;
        out += `<path class="cw-straight" d="${pathD(bd.path)}"/>`;
      }
    }
    return out;
  }

  /** Square handles in the middle of each stretch of a bundle that can be dragged. */
  private segmentHandles(bd: BundlePlace): string {
    let out = "";
    for (let k = 1; k + 1 < bd.raw.length - 1; k++) {
      const a = bd.raw[k], b = bd.raw[k + 1];
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 1e-6) continue;
      const m = this.toScreen([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
      const vertical = Math.abs(b[0] - a[0]) < Math.abs(b[1] - a[1]);
      out += `<rect class="cw-handle" x="${n2(m[0] - (vertical ? 4 : 9))}" y="${n2(m[1] - (vertical ? 9 : 4))}" width="${vertical ? 8 : 18}" height="${vertical ? 18 : 8}" rx="3"/>`;
    }
    return out;
  }

  /** The box of a text or a caption, on the guide. */
  private textBoxOf(h: { kind: "text" | "caption"; id: string }): Box | null {
    const c = this.c();
    let prims: Prim[] = [];
    if (h.kind === "text") {
      const t = c.texts.find((x) => x.id === h.id);
      if (t) prims = guideTextPrims(t);
    } else {
      const d = this.L?.devices.find((x) => x.dev.id === h.id);
      if (d) prims = captionPrims(d);
    }
    if (!prims.length) return null;
    const b = figureBounds(prims);
    return { x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1 };
  }

  private cursorKind(): string {
    const d = this.drag;
    if (d?.kind === "pan" && d.moved) return "grab";
    if (d?.kind === "move" || d?.kind === "text" || d?.kind === "caption") return "move";
    if (d?.kind === "segment") return d.axis === "h" ? "ns" : "ew";
    if (this.preview) return d?.kind === "pan" && d.moved ? "grab" : "pan";
    if (this.tool === "cut") return "cut";
    if (this.tool === "place" || this.tool === "text") return "place";
    const h = this.hover;
    if (this.tool === "wire" || this.tool === "bundle") return h.kind === "pin" || (h.kind === "wire" && this.tool === "wire" && this.joinable(h)) ? "pointer" : "pan";
    if (h.kind === "device" || h.kind === "text" || h.kind === "caption") return "move";
    if (h.kind === "wire") return h.seg >= 0 ? (this.segmentAxis(h.key, h.seg) === "h" ? "ns" : "ew") : "pointer";
    return "pan";
  }

  hint(): string {
    if (this.preview) return "Final view: the guide on its paper, as it is exported. Press Q or Esc to go back to drawing.";
    if (this.tool === "cut") return "Drag across wires to cut them out, or click one. Esc puts the tool down.";
    if (this.tool === "place") {
      return this.placingPart()?.symbol
        ? "Click where the symbol goes; it stays in hand for the next one. R turns it, F mirrors it. Esc puts it down."
        : "Click where the part goes. R turns it, F mirrors it; hold Shift to place more than one. Esc puts it down.";
    }
    if (this.tool === "wire") {
      const h = this.hover;
      if (h.kind === "wire" && this.joinable(h)) return this.from ? "Click to end the wire on this one: a junction is put there." : "Click to start a wire from this one: a junction is put there.";
      return this.from ? `From ${describeEnd(this.c(), this.from)}: click the pin it goes to, or a wire of a circuit diagram to join onto it. Esc lets go.` : "Click a pin, then the pin it is wired to. On a circuit diagram, a click on a wire joins onto it.";
    }
    if (this.tool === "bundle") return this.from ? `From port ${this.from.port} of ${deviceById(this.c(), this.from.dev)?.name ?? ""}: click a tag of the port it plugs into. Pins are paired by what they do.` : "Click a tag of one port, then a tag of the port it plugs into: every pin is wired to the one it goes with.";
    if (this.tool === "text") return "Click where the text goes.";
    const h = this.hover;
    if (h.kind === "wire") return "Click to select the wire, double-click for its whole bundle. Drag a middle stretch to lay the bundle another way.";
    if (h.kind === "device") return "Drag to move. R turns it, F mirrors it, Delete removes it with its wires.";
    if (h.kind === "pin") return `${describeEnd(this.c(), h.end)}: pick the Wire tool (W) to wire it.`;
    return "Drag to move around, scroll to zoom; Shift-drag to select several. W wires two pins, B plugs two ports together, X cuts wires, Q shows the final view.";
  }

  coords(): string {
    if (this.cursor[0] < 0) return "";
    const [x, y] = this.toGuide(this.cursor);
    return `${x.toFixed(1)}, ${y.toFixed(1)} mm`;
  }

  // ---- finding what is where -----------------------------------------------------------------

  private screenPos(ev: PointerEvent | WheelEvent | MouseEvent): V {
    const r = this.svg.getBoundingClientRect();
    return [ev.clientX - r.left, ev.clientY - r.top];
  }

  /** Where a wire attached at this end starts. */
  private anchorOf(e: WireEnd): V | null {
    const d = this.L?.devices.find((x) => x.dev.id === e.dev);
    const p = d?.ports.find((x) => x.port.name === e.port);
    return p?.pins.find((x) => x.name === e.pin)?.anchor ?? null;
  }

  private hit(sp: V): Hit {
    this.refresh();
    const L = this.L!;
    const q = this.toGuide(sp);
    const z = this.view.scale;
    const inside = (b: Box, grow = 0) => q[0] >= b.x0 - grow && q[0] <= b.x1 + grow && q[1] >= b.y0 - grow && q[1] <= b.y1 + grow;
    const c = this.c();
    const wiring = this.tool === "wire" || this.tool === "bundle";
    // Pins first while wiring: that is what is being looked for.
    const pin = (): Hit | null => {
      for (const t of L.tags) {
        if (!t.wired && c.look.unused === "hide" && !wiring) continue;
        if (inside(t.box, 2 / z)) return { kind: "pin", end: { dev: t.dev.id, port: t.port, pin: t.pin } };
      }
      if (wiring) {
        for (const d of L.devices) for (const p of d.ports) {
          if (p.port.kind !== "pads") continue;
          for (const r of p.pins) if (Math.hypot(r.at[0] - q[0], r.at[1] - q[1]) < Math.max(1.0, 6 / z)) return { kind: "pin", end: { dev: d.dev.id, port: p.port.name, pin: r.name } };
        }
      }
      return null;
    };
    if (wiring) {
      const got = pin();
      if (got) return got;
    }
    for (const t of [...c.texts].reverse()) {
      const b = this.textBoxOf({ kind: "text", id: t.id });
      if (b && inside(b, 1 / z)) return { kind: "text", id: t.id };
    }
    for (const d of [...L.devices].reverse()) {
      const b = this.textBoxOf({ kind: "caption", id: d.dev.id });
      if (b && inside(b, 1 / z)) return { kind: "caption", id: d.dev.id };
    }
    const tol = 5 / z;
    const wire = (over: boolean): Hit | null => {
      let best: Hit | null = null, bestD = Infinity;
      for (const bd of L.bundles) {
        if (bd.over !== over) continue;
        bd.lines.forEach((line, i) => {
          const d = distToPolyline(q, line);
          if (d < Math.max(tol, bd.width / 2 + 0.2) && d < bestD) {
            bestD = d;
            best = { kind: "wire", id: bd.wires[i].id, key: bd.key, seg: this.segmentAt(bd, q) };
          }
        });
      }
      return best;
    };
    if (!wiring) {
      const got = pin();
      if (got) return got;
    }
    // A junction is a point where wires end: it is found before them, or it could not be picked up.
    if (!wiring) {
      for (const d of [...L.devices].reverse()) {
        if (d.part.ports.some((p) => p.free) && Math.hypot(d.dev.x - q[0], d.dev.y - q[1]) < Math.max(0.6, 6 / z)) return { kind: "device", id: d.dev.id };
      }
    }
    const over = wire(true);
    if (over) return over;
    for (const d of [...L.devices].reverse()) if (inside(d.box, d.part.symbol ? Math.max(0.3, 3 / z) : 0)) return { kind: "device", id: d.dev.id };
    return wire(false) ?? { kind: "none" };
  }

  /** The middle stretch of a bundle nearest a point, as the index of its place; -1 where the nearest stretch is the first or the last. */
  private segmentAt(bd: BundlePlace, q: V): number {
    let best = -1, bestD = Infinity;
    for (let k = 0; k + 1 < bd.raw.length; k++) {
      const d = distToPolyline(q, [bd.raw[k], bd.raw[k + 1]]);
      if (d < bestD) { bestD = d; best = k; }
    }
    // Stretch k is laid at place k - 1; the first and last follow the devices.
    return best >= 1 && best <= bd.raw.length - 3 ? best - 1 : -1;
  }

  /** The axis a middle stretch of a bundle runs along. */
  private segmentAxis(key: string, index: number): "h" | "v" {
    const bd = this.L?.bundles.find((b) => b.key === key);
    const first = bd ? axisOf(bd.ua) : "h";
    // Stretch 0 runs along the first axis; place `index` is stretch index + 1.
    return (index + 1) % 2 === 0 ? first : first === "h" ? "v" : "h";
  }

  // ---- the pointer ------------------------------------------------------------------------------

  private onDown(ev: PointerEvent): void {
    const sp = this.screenPos(ev);
    this.cursor = sp;
    this.svg.setPointerCapture(ev.pointerId);
    const c = this.c();
    if (ev.button === 1 || ev.button === 2) {
      this.drag = { kind: "pan", last: sp, moved: false, start: sp, clear: false };
      return;
    }
    // The final view is only looked at: dragging moves round it.
    if (this.preview) {
      this.drag = { kind: "pan", last: sp, moved: false, start: sp, clear: false };
      return;
    }
    if (this.tool === "cut") {
      this.drag = { kind: "cut", pts: [sp], hits: new Set(), start: sp };
      return this.host.render();
    }
    const q = this.toGuide(sp);
    if (this.tool === "place") return this.place(ev.shiftKey);
    if (this.tool === "text") {
      // On a circuit diagram, text is set as its labels are; on a wiring guide, in bold sans.
      const diagram = c.devices.length > 0 && c.devices.every((d) => partOf(c, d)?.symbol);
      const t: GuideText = diagram
        ? { id: circuitId(c, "t"), x: snap(q[0], 0.5), y: snap(q[1], 0.5), text: "Text", size: Number(SYM.font.toFixed(3)), align: "start", serif: true }
        : { id: circuitId(c, "t"), x: snap(q[0], 0.5), y: snap(q[1], 0.5), text: "Text", size: 3, bold: true, align: "start" };
      c.texts.push(t);
      this.sel = { kind: "text", id: t.id };
      this.tool = "select";
      this.focusNext = "text-text";
      return this.changed();
    }
    const h = this.hit(sp);
    if (this.tool === "wire" || this.tool === "bundle") {
      if (h.kind === "wire" && this.tool === "wire" && this.joinable(h)) return this.joinWire(h, q);
      if (h.kind !== "pin") {
        this.drag = { kind: "pan", last: sp, moved: false, start: sp, clear: true };
        return;
      }
      return this.wireClick(h.end);
    }
    if (h.kind === "device") {
      const s = this.sel;
      let ids = s?.kind === "devices" ? s.ids : [];
      const click: Sel = ev.shiftKey && s?.kind === "devices" ? (ids.includes(h.id) ? { kind: "devices", ids: ids.filter((x) => x !== h.id) } : { kind: "devices", ids: [...ids, h.id] }) : { kind: "devices", ids: [h.id] };
      if (!ids.includes(h.id)) ids = ev.shiftKey ? [...ids, h.id] : [h.id];
      this.sel = { kind: "devices", ids };
      this.drag = { kind: "move", start: q, grabbed: h.id, moved: false, click, from: ids.map((id) => { const d = deviceById(c, id)!; return { id, x: d.x, y: d.y }; }) };
      this.host.touch();
      return;
    }
    if (h.kind === "wire") {
      const click: Sel = { kind: "wire", id: h.id };
      if (h.seg >= 0) {
        const bd = this.L!.bundles.find((b) => b.key === h.key)!;
        const free = !!(bd.a.port.free || bd.b.port.free);
        this.drag = { kind: "segment", key: h.key, index: h.seg, axis: this.segmentAxis(h.key, h.seg), start: q, base: [...bd.places], moved: false, click, first: free ? axisOf(bd.ua) : null };
      } else {
        this.sel = click;
        this.host.touch();
      }
      return;
    }
    if (h.kind === "text") {
      const t = c.texts.find((x) => x.id === h.id)!;
      this.sel = { kind: "text", id: h.id };
      this.drag = { kind: "text", id: h.id, start: q, from: [t.x, t.y], moved: false };
      this.host.touch();
      return;
    }
    if (h.kind === "caption") {
      const d = this.L!.devices.find((x) => x.dev.id === h.id)!;
      this.sel = { kind: "devices", ids: [h.id] };
      this.drag = { kind: "caption", id: h.id, start: q, from: captionOffset(d), moved: false };
      this.host.touch();
      return;
    }
    if (h.kind === "pin") {
      // A tag in the select tool picks its device.
      this.sel = { kind: "devices", ids: [h.end.dev] };
      this.host.touch();
      return;
    }
    if (ev.shiftKey) this.drag = { kind: "box", a: sp, b: sp, add: true };
    else this.drag = { kind: "pan", last: sp, moved: false, start: sp, clear: true };
  }

  private onMove(ev: PointerEvent): void {
    const sp = this.screenPos(ev);
    this.cursor = sp;
    const d = this.drag;
    const c = this.c();
    if (!d) {
      this.hover = this.preview ? { kind: "none" } : this.hit(sp);
      return this.host.render();
    }
    if (d.kind === "cut") {
      const last = d.pts[d.pts.length - 1];
      if (Math.hypot(sp[0] - last[0], sp[1] - last[1]) < 2) return;
      d.pts.push(sp);
      this.cutAlong(d, last, sp);
      return this.host.render();
    }
    const q = this.toGuide(sp);
    if (d.kind === "pan") {
      if (!d.moved && Math.hypot(sp[0] - d.start[0], sp[1] - d.start[1]) < 3) return;
      d.moved = true;
      this.view.cx -= (sp[0] - d.last[0]) / this.view.scale;
      this.view.cy += (sp[1] - d.last[1]) / this.view.scale;
      d.last = sp;
      return this.host.render();
    }
    if (d.kind === "box") {
      d.b = sp;
      return this.host.render();
    }
    const delta: V = [q[0] - d.start[0], q[1] - d.start[1]];
    if (!d.moved && Math.hypot(delta[0], delta[1]) * this.view.scale < 3) return;
    d.moved = true;
    if (d.kind === "move") {
      const g = d.from.find((f) => f.id === d.grabbed)!;
      // The device grabbed lands on the grid, a symbol on whole millimetres so its pins meet others'; the rest keep their places against it.
      const step = this.gridOf(deviceById(c, g.id));
      let dx = (ev.altKey ? g.x + delta[0] : snap(g.x + delta[0], step)) - g.x;
      let dy = (ev.altKey ? g.y + delta[1] : snap(g.y + delta[1], step)) - g.y;
      for (const f of d.from) { const dev = deviceById(c, f.id)!; dev.x = f.x + dx; dev.y = f.y + dy; }
      if (!ev.altKey) {
        // Near enough to running straight, a bundle is pulled straight.
        const [sx, sy] = this.straighten(d.from.map((f) => f.id));
        dx += sx; dy += sy;
        for (const f of d.from) { const dev = deviceById(c, f.id)!; dev.x = f.x + dx; dev.y = f.y + dy; }
      }
      this.stale = true;
      return this.host.render();
    }
    if (d.kind === "segment") {
      const places = [...d.base];
      const v = d.base[d.index] + (d.axis === "h" ? delta[1] : delta[0]);
      places[d.index] = ev.altKey ? v : snap(v, 0.5);
      c.routes[d.key] = places;
      // A junction does not say which way its wires leave: the way this bundle does is kept with its course.
      if (d.first) (c.axes ??= {})[d.key] = d.first;
      this.sel = { kind: "bundle", key: d.key };
      this.stale = true;
      return this.host.render();
    }
    if (d.kind === "text") {
      const t = c.texts.find((x) => x.id === d.id);
      if (t) { t.x = snap(d.from[0] + delta[0], ev.altKey ? 0.01 : 0.5); t.y = snap(d.from[1] + delta[1], ev.altKey ? 0.01 : 0.5); }
      this.stale = true;
      return this.host.render();
    }
    if (d.kind === "caption") {
      const dev = deviceById(c, d.id);
      if (dev) dev.cap = [snap(d.from[0] + delta[0], 0.25), snap(d.from[1] + delta[1], 0.25)];
      this.stale = true;
      return this.host.render();
    }
  }

  /**
   * How far to move the devices so a bundle between one of them and a device
   * that stays put runs straight, where it nearly does.
   */
  private straighten(moving: string[]): V {
    this.stale = true;
    this.refresh();
    const L = this.L!;
    let best: V = [0, 0], bestD = 1.6;
    for (const bd of L.bundles) {
      const ma = moving.includes(bd.a.dev.id), mb = moving.includes(bd.b.dev.id);
      if (ma === mb) continue;
      // Ports that face each other along one axis.
      if (axisOf(bd.ua) !== axisOf(bd.ub) || bd.ua[0] * bd.ub[0] + bd.ua[1] * bd.ub[1] > -0.5) continue;
      const pa = bd.ends.map((e) => e[0].anchor), pb = bd.ends.map((e) => e[1].anchor);
      const across = leftOf(bd.ua);
      const ca = pa.reduce((s, p) => s + p[0] * across[0] + p[1] * across[1], 0) / pa.length;
      const cb = pb.reduce((s, p) => s + p[0] * across[0] + p[1] * across[1], 0) / pb.length;
      const off = ma ? cb - ca : ca - cb;
      if (Math.abs(off) < bestD && Math.abs(off) > 1e-6) { bestD = Math.abs(off); best = [across[0] * off, across[1] * off]; }
    }
    return best;
  }

  private onUp(ev: PointerEvent): void {
    const d = this.drag;
    this.drag = null;
    if (this.svg.hasPointerCapture(ev.pointerId)) this.svg.releasePointerCapture(ev.pointerId);
    if (!d) return;
    if (d.kind === "cut") {
      // A click cuts the wire under it.
      if (!d.hits.size) {
        const h = this.hit(this.screenPos(ev));
        if (h.kind === "wire") d.hits.add(h.id);
      }
      if (!d.hits.size) return this.host.render();
      const c = this.c();
      const n = d.hits.size;
      removeWires(c, d.hits);
      if (this.sel?.kind === "wire" && d.hits.has(this.sel.id)) this.sel = null;
      this.host.toast(`Cut ${n} wire${n === 1 ? "" : "s"}. Ctrl+Z puts ${n === 1 ? "it" : "them"} back.`);
      return this.changed();
    }
    if (d.kind === "pan") {
      if (!d.moved && d.clear) {
        if (this.from) this.from = null;
        else this.sel = null;
        this.host.touch();
      }
      return;
    }
    if (d.kind === "box") {
      const a = this.toGuide(d.a), b = this.toGuide(d.b);
      const box: Box = { x0: Math.min(a[0], b[0]), y0: Math.min(a[1], b[1]), x1: Math.max(a[0], b[0]), y1: Math.max(a[1], b[1]) };
      const ids = this.L!.devices.filter((x) => x.box.x0 < box.x1 && x.box.x1 > box.x0 && x.box.y0 < box.y1 && x.box.y1 > box.y0).map((x) => x.dev.id);
      const had = this.sel?.kind === "devices" ? this.sel.ids : [];
      const all = [...new Set([...had, ...ids])];
      this.sel = all.length ? { kind: "devices", ids: all } : null;
      return this.host.touch();
    }
    if (!d.moved) {
      if (d.kind === "move" || d.kind === "segment") this.sel = d.click;
      return this.host.touch();
    }
    this.changed();
  }

  /** The wires a stretch of the cut stroke crosses, or passes over. */
  private cutAlong(d: Extract<Drag, { kind: "cut" }>, a: V, b: V): void {
    this.refresh();
    const ga = this.toGuide(a), gb = this.toGuide(b);
    const tol = 2 / this.view.scale;
    for (const bd of this.L!.bundles) {
      bd.lines.forEach((line, i) => {
        const id = bd.wires[i].id;
        if (d.hits.has(id)) return;
        for (let k = 0; k + 1 < line.length; k++) {
          if (segDist(ga, gb, line[k], line[k + 1]) <= bd.width / 2 + tol) { d.hits.add(id); return; }
        }
      });
    }
  }

  private onWheel(ev: WheelEvent): void {
    ev.preventDefault();
    const sp = this.screenPos(ev);
    const before = this.toGuide(sp);
    const unit = ev.deltaMode === 1 ? 32 : 1;
    const f = Math.exp(-(ev.deltaY || ev.deltaX) * unit * 0.0016);
    this.view.scale = Math.max(0.3, Math.min(200, this.view.scale * f));
    const after = this.toGuide(sp);
    this.view.cx += before[0] - after[0];
    this.view.cy += before[1] - after[1];
    this.host.render();
  }

  private onDoubleClick(ev: MouseEvent): void {
    if (this.tool !== "select" || this.preview) return;
    const h = this.hit(this.screenPos(ev));
    if (h.kind === "wire") {
      this.sel = { kind: "bundle", key: h.key };
      return this.host.touch();
    }
    if (h.kind === "device") {
      const d = deviceById(this.c(), h.id);
      const part = d && partOf(this.c(), d);
      // A symbol's value is what is wanted next; a part drawn here opens in the sketcher.
      if (part?.symbol && d) {
        this.sel = { kind: "devices", ids: [d.id] };
        this.focusNext = part.unit ? "dev-value" : "dev-caption";
        return this.host.touch();
      }
      if (part?.sketch) return this.host.editPart(part.id);
    }
    if (h.kind === "text") { this.focusNext = "text-text"; return this.host.touch(); }
    if (h.kind === "caption") { this.focusNext = "dev-caption"; return this.host.touch(); }
  }

  // ---- doing things --------------------------------------------------------------------------

  /** A click on a pin with the Wire or the Bundle tool. */
  private wireClick(end: WireEnd): void {
    const c = this.c();
    if (!this.from) {
      this.from = end;
      return this.host.touch();
    }
    const a = this.from;
    if (a.dev === end.dev && a.port === end.port) {
      if (this.tool === "wire" && a.pin !== end.pin) return this.host.toast("Both pins are on the same port: pick a pin of another one.");
      this.from = end;
      return this.host.touch();
    }
    this.from = null;
    const port = (e: WireEnd) => { const d = deviceById(c, e.dev); return partOf(c, d!)?.ports.find((p) => p.name === e.port); };
    const pa = port(a), pb = port(end);
    // Two ports of a single pin each, as on symbols, are plugged together by wiring the two pins.
    if (this.tool === "wire" || (pa?.pins.length === 1 && pb?.pins.length === 1)) {
      if (c.wires.some((w) => (sameEnd(w.a, a) && sameEnd(w.b, end)) || (sameEnd(w.a, end) && sameEnd(w.b, a)))) return this.host.toast("Those two pins are wired already.");
      const w: Wire = { id: circuitId(c, "w"), a, b: end };
      c.wires.push(w);
      this.sel = { kind: "wire", id: w.id };
      this.host.toast(`Wired ${describeEnd(c, a)} to ${describeEnd(c, end)}.`);
      return this.changed();
    }
    // Two ports: every pin wired to the one it goes with.
    if (!pa || !pb) return;
    const pairs = pairPins(pa.pins.map((p) => p.name), pb.pins.map((p) => p.name));
    if (!pairs.length) return this.host.toast(`Nothing on ${pa.name} goes with anything on ${pb.name}: wire them pin by pin with the Wire tool.`);
    let made = 0;
    for (const [x, y] of pairs) {
      const ea: WireEnd = { dev: a.dev, port: a.port, pin: x }, eb: WireEnd = { dev: end.dev, port: end.port, pin: y };
      if (c.wires.some((w) => (sameEnd(w.a, ea) && sameEnd(w.b, eb)) || (sameEnd(w.a, eb) && sameEnd(w.b, ea)))) continue;
      c.wires.push({ id: circuitId(c, "w"), a: ea, b: eb });
      made++;
    }
    const left = pa.pins.length - pairs.length;
    this.sel = { kind: "bundle", key: bundleKey({ id: "", a, b: end }) };
    this.host.toast(`${made} wire${made === 1 ? "" : "s"}: ${pairs.map(([x, y]) => (x === y ? x : `${x}–${y}`)).join(", ")}.${left ? ` ${left} pin${left === 1 ? "" : "s"} left with nothing to go with.` : ""}`);
    this.changed();
  }

  /** Whether the Wire tool can join onto the wire: a wire of a circuit diagram takes a junction where it is clicked. */
  private joinable(h: Extract<Hit, { kind: "wire" }>): boolean {
    return !!this.L?.bundles.find((b) => b.key === h.key)?.schematic;
  }

  /**
   * With the Wire tool on a wire of a circuit diagram: a junction is put on
   * it at the click, on the millimetre grid along its stretch, and the wire
   * is carried through it. The wire being drawn ends on the junction, or a
   * new one starts from it. A click right by an end of the wire is a click on
   * the pin there.
   */
  private joinWire(h: Extract<Hit, { kind: "wire" }>, q: V): void {
    const c = this.c();
    const bd = this.L?.bundles.find((b) => b.key === h.key);
    const i = bd ? bd.wires.findIndex((w) => w.id === h.id) : -1;
    if (!bd || i < 0) return;
    const line = bd.lines[i];
    const clamp = (v: number, a: number, b: number) => Math.max(Math.min(a, b), Math.min(Math.max(a, b), v));
    let best: V = line[0], bestD = Infinity;
    for (let k = 0; k + 1 < line.length; k++) {
      const a = line[k], b = line[k + 1];
      const ab: V = [b[0] - a[0], b[1] - a[1]];
      const len2 = ab[0] * ab[0] + ab[1] * ab[1];
      if (len2 < 1e-9) continue;
      const t = Math.max(0, Math.min(1, ((q[0] - a[0]) * ab[0] + (q[1] - a[1]) * ab[1]) / len2));
      let p: V = [a[0] + ab[0] * t, a[1] + ab[1] * t];
      if (Math.abs(ab[1]) < 1e-6) p = [clamp(snap(p[0], SYM.grid), a[0], b[0]), a[1]];
      else if (Math.abs(ab[0]) < 1e-6) p = [a[0], clamp(snap(p[1], SYM.grid), a[1], b[1])];
      const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (d < bestD) { bestD = d; best = p; }
    }
    const w = bd.wires[i];
    const ends = keyedEnds(w);
    for (const k of [0, 1] as const) {
      const at = bd.ends[i][k].anchor;
      if (Math.hypot(at[0] - best[0], at[1] - best[1]) < 0.75) return this.wireClick(ends[k]);
    }
    const part = useStarter(c, JUNCTION_KEY, () => circuitId(c, "p"));
    if (!part?.ports.length) return;
    const j: Device = { id: circuitId(c, "d"), part: part.id, name: numberedName(c, part.ref), x: best[0], y: best[1], turn: 0 };
    c.devices.push(j);
    const end: WireEnd = { dev: j.id, port: part.ports[0].name, pin: part.ports[0].pins[0].name };
    removeWires(c, new Set([w.id]));
    const keep = w.color ? { color: w.color } : {};
    c.wires.push({ id: circuitId(c, "w"), a: w.a, b: end, ...keep, ...(w.label ? { label: w.label } : {}) }, { id: circuitId(c, "w"), a: end, b: w.b, ...keep });
    if (this.from) {
      c.wires.push({ id: circuitId(c, "w"), a: this.from, b: end });
      this.host.toast(`Joined ${describeEnd(c, this.from)} onto the wire.`);
      this.from = null;
    } else this.from = end;
    this.sel = null;
    this.changed();
  }

  private placingPart(): PartDef | null {
    const p = this.placing;
    if (!p) return null;
    if (p.part) return this.c().parts.find((x) => x.id === p.part) ?? null;
    return p.starter ? peekStarter(this.c(), p.starter) ?? null : null;
  }

  /** The grid a device is placed and moved on: whole millimetres for a symbol, so pins meet pins; half of one otherwise. */
  private gridOf(d: Device | undefined): number {
    return d && partOf(this.c(), d)?.symbol ? SYM.grid : 0.5;
  }

  /** Where the part being placed goes: its middle under the pointer, on its grid. */
  private placeAt(): V {
    const q = this.toGuide(this.cursor);
    const step = this.placingPart()?.symbol ? SYM.grid : 0.5;
    return [snap(q[0], step), snap(q[1], step)];
  }

  private place(more: boolean): void {
    const c = this.c();
    const p = this.placing;
    if (!p) return;
    const part = p.part ? c.parts.find((x) => x.id === p.part) : p.starter ? useStarter(c, p.starter, () => circuitId(c, "p")) : null;
    if (!part) return;
    const [x, y] = this.placeAt();
    const d: Device = { id: circuitId(c, "d"), part: part.id, name: part.symbol ? numberedName(c, part.ref) : freeName(c, part.ref), x, y, turn: p.turn, ...(p.flip ? { flip: true } : {}) };
    c.devices.push(d);
    // A diagram takes many of one symbol: a symbol stays in hand until it is put down. A part is placed once, unless Shift is held.
    if (more || part.symbol) {
      this.sel = null;
      this.placing = { ...(p.starter ? { starter: p.starter } : { part: part.id }), turn: p.turn, flip: p.flip };
    } else {
      this.sel = { kind: "devices", ids: [d.id] };
      this.placing = null;
      this.tool = "select";
    }
    this.changed();
  }

  /** Starts placing a part: one of the guide's, or a starter part. */
  startPlacing(what: { part?: string; starter?: string }): void {
    this.placing = { ...what, turn: 0, flip: false };
    this.tool = "place";
    this.from = null;
    this.host.touch();
  }

  setTool(t: Tool): void {
    if (this.preview && t !== "select") this.setPreview(false);
    this.tool = t;
    this.from = null;
    if (t !== "place") this.placing = null;
    this.host.touch();
  }

  private selectedDevices(): Device[] {
    const s = this.sel;
    const c = this.c();
    return s?.kind === "devices" ? s.ids.map((id) => deviceById(c, id)).filter((d): d is Device => !!d) : [];
  }

  /** Turns the selected devices, or the part being placed, a quarter turn; flips them with `flip`. */
  private turnSelected(step: number, flip = false): void {
    if (this.tool === "place" && this.placing) {
      if (flip) this.placing.flip = !this.placing.flip;
      else this.placing.turn = (((this.placing.turn + step) % 4) + 4) % 4 as 0 | 1 | 2 | 3;
      return this.host.touch();
    }
    const devs = this.selectedDevices();
    if (!devs.length) return;
    // Turned or mirrored, the bundles are laid again: their old course no longer fits.
    const c = this.c();
    for (const d of devs) {
      if (flip) d.flip = !d.flip || undefined;
      else d.turn = (((d.turn + step) % 4) + 4) % 4 as 0 | 1 | 2 | 3;
      if (!d.flip) delete d.flip;
      delete d.cap;
      for (const w of c.wires) if (w.a.dev === d.id || w.b.dev === d.id) dropRoute(c, bundleKey(w));
    }
    this.changed();
  }

  private deleteSelected(): void {
    const c = this.c();
    const s = this.sel;
    if (!s) return;
    if (s.kind === "devices") for (const id of s.ids) removeDevice(c, id);
    else if (s.kind === "wire") removeWires(c, new Set([s.id]));
    else if (s.kind === "bundle") removeWires(c, new Set(c.wires.filter((w) => bundleKey(w) === s.key).map((w) => w.id)));
    else if (s.kind === "text") c.texts = c.texts.filter((t) => t.id !== s.id);
    this.sel = null;
    this.changed();
  }

  private duplicateSelected(): void {
    const c = this.c();
    const devs = this.selectedDevices();
    if (!devs.length) return;
    const ids: string[] = [];
    for (const d of devs) {
      const symbol = !!partOf(c, d)?.symbol;
      const copy: Device = { ...structuredClone(d), id: circuitId(c, "d"), name: symbol ? numberedName(c, d.name) : freeName(c, d.name), x: d.x + 10, y: d.y - 10 };
      c.devices.push(copy);
      ids.push(copy.id);
    }
    this.sel = { kind: "devices", ids };
    this.changed();
  }

  /** A key pressed while no field has the keyboard. True when it was taken. */
  key(e: KeyboardEvent): boolean {
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (mod) {
      if (k === "a") {
        this.tool = "select";
        this.sel = { kind: "devices", ids: this.c().devices.map((d) => d.id) };
        this.host.touch();
        return true;
      }
      if (k === "d") { this.duplicateSelected(); return true; }
      return false;
    }
    if (k === "q" || (this.preview && e.key === "Escape")) { this.setPreview(!this.preview); return true; }
    if (this.preview) {
      // Nothing is edited in the final view; the view itself can be fitted.
      if (e.key === "0" || e.key === "Home") { this.fit(); return true; }
      return false;
    }
    if (e.key === "Escape") {
      if (this.from) this.from = null;
      else if (this.tool !== "select") { this.tool = "select"; this.placing = null; }
      else this.sel = null;
      this.host.touch();
      return true;
    }
    if (e.key === "Delete" || e.key === "Backspace") { this.deleteSelected(); return true; }
    if (e.key === "0" || e.key === "Home") { this.fit(); return true; }
    if (k === "v") { this.setTool("select"); return true; }
    if (k === "w") { this.setTool("wire"); return true; }
    if (k === "b") { this.setTool("bundle"); return true; }
    if (k === "t") { this.setTool("text"); return true; }
    if (k === "x") { this.setTool("cut"); return true; }
    if (k === "r") { this.turnSelected(e.shiftKey ? -1 : 1); return true; }
    if (k === "f") { this.turnSelected(0, true); return true; }
    if (e.key.startsWith("Arrow") && this.sel) {
      const s = this.sel;
      const step = e.shiftKey ? 5 : s.kind === "devices" && this.selectedDevices().every((d) => this.gridOf(d) === SYM.grid) ? SYM.grid : 0.5;
      const [dx, dy] = e.key === "ArrowLeft" ? [-step, 0] : e.key === "ArrowRight" ? [step, 0] : e.key === "ArrowUp" ? [0, step] : [0, -step];
      if (s.kind === "devices") for (const d of this.selectedDevices()) { d.x += dx; d.y += dy; }
      else if (s.kind === "text") { const t = this.c().texts.find((x) => x.id === s.id); if (t) { t.x += dx; t.y += dy; } }
      else return false;
      this.changed();
      return true;
    }
    return false;
  }

  // ---- files ---------------------------------------------------------------------------------

  private async openFile(f: File): Promise<void> {
    const text = await f.text();
    if (this.fileKind === "csv") return this.importCsv(text);
    this.importPart(text, f.name);
  }

  private importCsv(text: string): void {
    const c = this.c();
    const { rows, problems } = readCsv(text);
    if (!rows.length) return this.host.toast(problems[0] ?? "There are no connections in that file.");
    const r = applyCsv(c, rows);
    this.problems = [...problems, ...r.problems];
    const parts = [`${r.added} wire${r.added === 1 ? "" : "s"} added`];
    if (r.kept) parts.push(`${r.kept} already there`);
    if (r.placed.length) parts.push(`placed ${r.placed.join(", ")}`);
    if (this.problems.length) parts.push(`${this.problems.length} row${this.problems.length === 1 ? "" : "s"} need${this.problems.length === 1 ? "s" : ""} a look: see the panel`);
    this.host.toast(parts.join("; ") + ".");
    this.sel = null;
    this.changed();
    if (r.placed.length) this.fit();
  }

  /** Problems with the last connection list read in, shown in the panel until it is closed. */
  private problems: string[] = [];

  private importPart(text: string, fileName: string): void {
    const c = this.c();
    try {
      const { part, problems } = readComponent(text);
      part.id = circuitId(c, "p");
      if (c.parts.some((p) => p.name === part.name)) part.name = `${part.name} (${fileName.replace(/\.json$/i, "")})`;
      c.parts.push(part);
      this.host.toast(problems.length ? `${part.name} is in the library. ${problems[0]}` : `${part.name} is in the library: click where it goes.`);
      this.changed();
      this.startPlacing({ part: part.id });
    } catch (err) {
      this.host.toast((err as Error).message);
    }
  }

  /** The guide as a file of the given kind, or null when it is empty. */
  exported(how: "svg" | "tikz"): string | null {
    const c = this.c();
    if (!c.devices.length && !c.texts.length) return null;
    const L = layout(c);
    const prims = guidePrims(c, L);
    const b = boundsOf(prims, L.devices.map((d) => d.box));
    const page = { x0: b.x0 - MARGIN, y0: b.y0 - MARGIN, x1: b.x1 + MARGIN, y1: b.y1 + MARGIN };
    const k = c.look.scale;
    if (how === "svg") return primsToSvg([{ k: "region", layer: "fill", outlines: [{ kind: "path", start: [page.x0, page.y0], segs: [{ k: "L", to: [page.x1, page.y0] }, { k: "L", to: [page.x1, page.y1] }, { k: "L", to: [page.x0, page.y1] }, { k: "L", to: [page.x0, page.y0] }] }], color: "#ffffff" }, ...prims], k, page);
    // TikZ gets the guide at its size on paper, text and all, so small text is set at the size it is printed.
    const tikz = primsToTikz(plainWidths(scalePrims(prims, k)), 1, { x0: page.x0 * k, y0: page.y0 * k, x1: page.x1 * k, y1: page.y1 * k });
    // A guide with tags has text of a few points; a circuit diagram at its usual size is all 10 pt.
    const small = L.tags.length > 0 || Math.abs(k - 2) > 1e-6;
    return tikz && (small ? `% Its small text wants a font that scales, such as \\usepackage{lmodern}.\n${tikz}` : tikz);
  }

  fileName(): string {
    const fc = this.c().texts[0]?.text.trim();
    return (fc || "wiring-guide").toLowerCase().replace(/[\\/:*?"<>|\s]+/g, "-").slice(0, 40) || "wiring-guide";
  }

  /** The connection list, saved as a file. */
  private exportCsv(): void {
    const c = this.c();
    if (!c.wires.length) return this.host.toast("There are no wires yet to list.");
    this.host.save(writeCsv(c), ".csv", "text/csv", "Connection list", `${this.fileName()}-connections`);
  }

  // ---- after a part was drawn ------------------------------------------------------------------

  /** A part was drawn or changed in the sketcher: its drawing is kept, and a new one is ready to place. */
  partDrawn(part: PartDef, isNew: boolean): void {
    redrawPart(part);
    this.partSvg = new WeakMap();
    this.stale = true;
    if (isNew) this.startPlacing({ part: part.id });
  }

  // ---- the ribbon and the panel ---------------------------------------------------------------

  ribbonHtml(): string {
    const c = this.c();
    const tool = (act: string, name: string, label: string, title: string, extra = "") =>
      `<button type="button" class="tool" data-cact="${act}" aria-label="${title}" title="${title}"${extra}>${icon(name, 22)}<span>${label}</span></button>`;
    const on = (t: Tool) => ` aria-pressed="${this.tool === t}"`;
    const devs = this.selectedDevices().length ? "" : " disabled";
    return tool("tool-select", "select", "Select", "Select and move parts, wires and text (V)", on("select")) +
      tool("tool-wire", "wire", "Wire", "Wire a pin to a pin: click a tag, then the tag it goes to (W)", on("wire")) +
      tool("tool-bundle", "plug", "Plug in", "Plug a port into a port: every pin is wired to the one it goes with (B)", on("bundle")) +
      tool("tool-text", "note", "Text", "Put text on the guide: a title, a note (T)", on("text")) +
      tool("tool-cut", "trim", "Cut", "Cut wires: drag across them, and what the stroke crosses is taken out; or click one (X)", on("cut")) +
      `<span class="ribbon-rule"></span>` +
      tool("new-part", "partnew", "Draw part", "Draw a new part in the sketcher, with pins to wire to") +
      tool("import-part", "partin", "Import part", "Add a part from a component file (.json), such as one written from a photo of a board") +
      `<span class="ribbon-rule"></span>` +
      tool("turn", "rotate", "Turn", "Turn the selected parts a quarter turn (R; Shift+R the other way)", devs) +
      tool("flip", "mirror", "Mirror", "Mirror the selected parts left to right (F)", devs) +
      tool("reroute", "reroute", "Re-lay", "Lay the selected bundle, or every bundle, the way that is found best", c.wires.length ? "" : " disabled") +
      `<span class="ribbon-rule"></span>` +
      tool("csv-in", "csvin", "Import list", "Wire the guide from a connection list (.csv)") +
      tool("csv-out", "csvout", "Export list", "Save the guide's wires as a connection list (.csv)", c.wires.length ? "" : " disabled") +
      `<span class="ribbon-rule"></span>` +
      tool("fit", "fit", "Zoom to fit", "Bring the whole guide into view (0)");
  }

  drawPanel(): void {
    const active = document.activeElement as HTMLInputElement | null;
    const had = active && this.panel.contains(active) ? active.dataset.cf ?? null : null;
    const caret = had && active && (active.type === "text" || active.type === "search" || active.tagName === "TEXTAREA") ? [active.selectionStart, active.selectionEnd] : null;
    this.panel.innerHTML = this.panelHtml();
    const want = this.focusNext ?? had;
    this.focusNext = null;
    if (!want) return;
    const el = this.panel.querySelector<HTMLInputElement>(`[data-cf="${want}"]`);
    if (!el) return;
    el.focus();
    if (want !== had) el.select?.();
    else if (caret && caret[0] !== null) el.setSelectionRange(caret[0], caret[1]);
  }

  private panelHtml(): string {
    const s = this.sel;
    const c = this.c();
    if (this.preview) return this.finalHtml();
    if (this.tool === "place") return this.placeHtml();
    // What is selected has the panel; the library is a click away.
    const back = `<button type="button" class="cw-back" data-cact="deselect" title="Back to the library (Esc)">${icon("chevron", 14)}<span>Library</span></button>`;
    if (s?.kind === "devices" && s.ids.length === 1) return back + this.deviceHtml(deviceById(c, s.ids[0])!);
    if (s?.kind === "devices") return back + `<h2>${s.ids.length} parts</h2><p class="muted">Drag one to move them all; R turns each, Delete takes them out with their wires.</p>` +
      `<div class="btn-row"><button type="button" class="plain" data-cact="turn">Turn</button><button type="button" class="plain" data-cact="dup">Duplicate</button></div>` +
      `<button type="button" class="danger" data-cact="delete">Delete</button>`;
    if (s?.kind === "wire") { const w = c.wires.find((x) => x.id === s.id); if (w) return back + this.wireHtml(w); }
    if (s?.kind === "bundle") return back + this.bundleHtml(s.key);
    if (s?.kind === "text") { const t = c.texts.find((x) => x.id === s.id); if (t) return back + this.textHtml(t); }
    return this.guideHtml();
  }

  private choice(label: string, act: string, options: [string, string, boolean][]): string {
    return `<div class="field"><span id="cw-${act}">${label}</span><div class="segmented" role="group" aria-labelledby="cw-${act}">${options.map(([v, name, on]) =>
      `<button type="button" data-cact="${act}" data-v="${v}" aria-pressed="${on}">${name}</button>`).join("")}</div></div>`;
  }

  private text(label: string, cf: string, value: string, note = "", area = false): string {
    const input = area
      ? `<textarea data-cf="${cf}" rows="2" spellcheck="false">${esc(value)}</textarea>`
      : `<input data-cf="${cf}" type="text" spellcheck="false" autocomplete="off" value="${esc(value)}">`;
    return `<label class="field"><span>${label}</span>${input}${note ? `<small>${note}</small>` : ""}</label>`;
  }

  /** The library with what is in hand lit up, and the buttons for parts of one's own under it. */
  private libraryHtml(): string {
    this.lib.placing = this.tool === "place" && this.placing ? { starter: this.placing.starter, part: this.placing.part } : null;
    return libraryHtml(this.c(), this.lib) +
      `<div class="btn-row cw-own-row"><button type="button" class="plain" data-cact="new-part">Draw a part</button><button type="button" class="plain" data-cact="import-part">Import a part</button></div>`;
  }

  /** The panel with nothing selected: the library, the connection list and how the guide looks. */
  private guideHtml(): string {
    const c = this.c();
    const L = this.L;
    const symbols = c.devices.filter((d) => partOf(c, d)?.symbol).length;
    const diagram = symbols > 0 && symbols === c.devices.length;
    let html = `<h2>${diagram ? "Circuit diagram" : "Wiring guide"}</h2>`;
    html += `<p class="muted">${c.devices.length} ${diagram ? "symbol" : "part"}${c.devices.length === 1 ? "" : "s"} placed, ${c.wires.length} wire${c.wires.length === 1 ? "" : "s"}.</p>`;
    const problems = [...this.problems, ...(L?.problems ?? [])];
    if (problems.length) {
      html += `<div class="cw-problems"><h3>Needs a look</h3><ul>${problems.slice(0, 12).map((p) => `<li>${esc(p)}</li>`).join("")}</ul>${this.problems.length ? `<button type="button" class="plain" data-cact="clear-problems">Done</button>` : ""}</div>`;
    }
    html += `<h3 class="cw-lib-title">Library</h3>` + this.libraryHtml();
    html += `<small class="under">A part file can be written from a photo of a board: give an AI chat the photo with these instructions, and import the file it writes.</small>` +
      `<div class="btn-row"><button type="button" class="plain" data-cact="copy-howto">Copy the instructions</button><button type="button" class="plain" data-cact="save-howto">Save them</button></div>`;

    html += `<h3>Connections</h3>`;
    html += `<p class="muted">A connection list is a CSV file with a row for each wire: from_device, from_port, from_pin, to_device, to_port, to_pin, colour, label. Parts it names that are not placed yet are placed.</p>`;
    html += `<div class="btn-row"><button type="button" class="plain" data-cact="csv-in">Import a list</button><button type="button" class="plain" data-cact="csv-out"${c.wires.length ? "" : " disabled"}>Export the list</button></div>`;

    html += this.lookHtml();
    if (!diagram) {
      html += `<h3>Colours</h3><div class="cw-legend">${PIN_KINDS.slice(0, 12).map((k) => `<span><i style="background:${k.bg}"></i>${esc(k.label)}</span>`).join("")}</div>`;
      html += `<small class="under">A tag's colour is what its pin does, read from its name: GND, 5V, Tx, Rx, SCL, SDA and so on. A wire takes the colour of its first pin unless it is given its own.</small>`;
    }
    if (!c.devices.length) {
      html += `<h3>Examples</h3><p class="muted">A quadcopter on a MicoAir H743 v2, wired as a manual shows it; and a transistor switching an LED, as a circuit diagram.</p>` +
        `<div class="btn-row"><button type="button" class="plain" data-cact="example">Wiring guide</button><button type="button" class="plain" data-cact="example-diagram">Circuit diagram</button></div>`;
    }
    return html;
  }

  /** The panel of the final view: the size on paper, how the guide looks, and the export. */
  private finalHtml(): string {
    const c = this.c();
    const b = this.bounds;
    let html = `<h2>Final view</h2><p class="muted">The guide as it is exported: on its paper, with a ${shown(MARGIN * c.look.scale)} mm margin, without the names and markers shown while drawing. Press Q or Esc to go back to drawing.</p>`;
    if (Number.isFinite(b.x0) && (c.devices.length || c.texts.length)) {
      const k = c.look.scale;
      html += `<p class="cw-ends"><span>${shown(((b.x1 - b.x0 + 2 * MARGIN) * k) / 10)} × ${shown(((b.y1 - b.y0 + 2 * MARGIN) * k) / 10)} cm on paper</span></p>`;
    }
    html += this.lookHtml();
    html += `<h3>Export</h3><div class="btn-row"><button type="button" class="plain" data-act="export-svg">SVG</button><button type="button" class="plain" data-act="export-tikz">TikZ</button><button type="button" class="plain" data-act="copy-tikz">Copy TikZ</button></div>`;
    html += `<small class="under">Exported files carry the guide, so Open brings it back to edit.</small>`;
    return html;
  }

  /** How the guide is drawn: the settings of the Look section. */
  private lookHtml(): string {
    const look = this.c().look;
    let html = `<h3>Look</h3>`;
    html += this.choice("Corners of bundles", "corners", [["round", "Rounded", look.corners === "round"], ["square", "Square", look.corners === "square"]]);
    html += this.choice("Edge round each wire", "casing", [["on", "Darker edge", look.casing], ["off", "None", !look.casing]]);
    html += this.choice("Pins with nothing wired", "unused", [["outline", "Outlined tags", look.unused === "outline"], ["hide", "No tags", look.unused === "hide"]]);
    html += `<label class="field"><span>Wire thickness (mm)</span><input data-cf="look-wire" type="number" min="0.1" max="3" step="0.05" value="${look.wire}"></label>`;
    const c = this.c();
    const symbols = c.devices.some((d) => partOf(c, d)?.symbol);
    const pt = (mm: number) => shown(mm * look.scale * 2.845);
    html += `<label class="field"><span>Size on paper</span><span class="pair"><input data-cf="look-scale" type="number" min="0.2" max="20" step="0.1" value="${look.scale}" aria-label="Times its size in mm"><span>× its size in mm</span></span>` +
      `<small>Tags are ${shown(TAG.w * look.scale)} mm tall on paper, their text ${pt(TAG.font)} pt.${symbols ? ` Circuit symbols have ${pt(SYM.font)} pt letters and ${pt(SYM.line)} pt lines; a resistor is ${shown(6 * look.scale)} mm long.` : ""} The export comes out this size.</small></label>`;
    if (symbols) html += this.choice("Decimal sign in values", "comma", [["point", "4.7 kΩ", !look.comma], ["comma", "4,7 kΩ", !!look.comma]]);
    return html;
  }

  /** The panel while a part is in hand: the part as it will be put down, and the library to pick another from. */
  private placeHtml(): string {
    const part = this.placingPart();
    const p = this.placing;
    if (!part || !p) return this.guideHtml();
    const pins = part.ports.reduce((n, q) => n + q.pins.length, 0);
    return `<div class="cw-placing"><div class="cw-preview">${thumb(part, 216, 116, { cap: part.symbol ? 14 : undefined, turn: p.turn, flip: p.flip })}</div>` +
      `<h2>${esc(part.name)}</h2>` +
      `<p class="muted">${pins} pin${pins === 1 ? "" : "s"}${part.ports.length > 1 && !part.symbol ? ` on ${part.ports.length} ports` : ""}. Click on the guide where it goes. ` +
      (part.symbol ? "It stays in hand for the next one." : "Hold Shift to place more than one.") + ` Esc puts it down.</p>` +
      `<div class="btn-row"><button type="button" class="plain" data-cact="turn" title="Turn it a quarter turn (R)">Turn</button><button type="button" class="plain" data-cact="flip" aria-pressed="${p.flip}" title="Mirror it left to right (F)">Mirror</button><button type="button" class="plain" data-cact="tool-select" title="Put it down (Esc)">Done</button></div></div>` +
      `<h3 class="cw-lib-title">Library</h3>` + this.libraryHtml();
  }

  /** The ports of a part, with what each pin is wired to on the guide. */
  private portsList(part: PartDef, dev: Device | null): string {
    const c = this.c();
    let html = `<h3>${part.symbol ? "Pins" : "Ports"}</h3>`;
    if (!part.ports.length) {
      return html + `<p class="muted">${part.symbol ? "It has no pins: it is put beside what it marks." : "It has no ports: nothing can be wired to it."}${part.sketch ? " Put pins on it with the Wire pin tool on the Annotate tab of its drawing." : ""}</p>`;
    }
    const wiredTo = (port: string, pin: string): string[] => (!dev ? [] : c.wires
      .filter((w) => (w.a.dev === dev.id && w.a.port === port && w.a.pin === pin) || (w.b.dev === dev.id && w.b.port === port && w.b.pin === pin))
      .map((w) => describeEnd(c, w.a.dev === dev.id && w.a.port === port && w.a.pin === pin ? w.b : w.a)));
    const to = (other: string[]) => (other.length ? `<span class="cw-to">→ ${esc(other.join(", "))}</span>` : dev ? `<span class="cw-to muted">nothing</span>` : "");
    if (part.symbol) {
      // A symbol's pins are ports of their own: one list, in plain tags.
      html += `<div class="cw-port"><ul>`;
      for (const p of part.ports) for (const q of p.pins) html += `<li><span class="cw-tag plain">${esc(q.name)}</span>${to(wiredTo(p.name, q.name))}</li>`;
      return html + `</ul></div>`;
    }
    for (const p of part.ports) {
      html += `<div class="cw-port"><b>${esc(p.name)}</b><small>${p.kind === "pads" ? "solder pads" : "connector"}, ${p.side}</small><ul>`;
      for (const q of p.pins) {
        const k = pinKind(q.name);
        html += `<li><span class="cw-tag" style="background:${k.bg};color:${k.fg}">${esc(q.name)}</span>${to(wiredTo(p.name, q.name))}</li>`;
      }
      html += `</ul></div>`;
    }
    return html;
  }

  private deviceHtml(d: Device): string {
    const c = this.c();
    const part = partOf(c, d)!;
    let html = `<h2>${esc(part.name)}</h2>`;
    html += this.text("Name", "dev-name", d.name, part.symbol ? "What the connection list calls it, and what its label is made from." : "What the connection list calls it. No two parts on the guide share a name.");
    if (part.symbol) {
      html += this.text("Label", "dev-caption", d.caption ?? part.caption ?? designator(d.name), "Written by the symbol. Math goes between dollar signs: $R_1$, $U_\\mathrm{be}$. Leave empty for none; drag it on the guide to move it.", true);
      html += this.text("Value", "dev-value", d.value ?? "", part.unit
        ? `Written under the label. Typed short, it gets its unit: ${part.unit === "Ω" ? "4k7 is 4.7 kΩ, 220 is 220 Ω" : `100n is 100 n${esc(part.unit)}, 4u7 is 4.7 µ${esc(part.unit)}`}. Anything else is kept as typed.`
        : "Written under the label: a type, a rating. Leave empty for none.");
    } else {
      html += this.text("Caption", "dev-caption", d.caption ?? part.caption ?? "", "Written under it on the guide; a new line starts a new line. Drag it on the guide to move it.", true);
    }
    html += `<div class="btn-row"><button type="button" class="plain" data-cact="turn">Turn</button><button type="button" class="plain" data-cact="flip" aria-pressed="${!!d.flip}">Mirror</button><button type="button" class="plain" data-cact="dup">Duplicate</button></div>`;
    if (d.cap) html += `<button type="button" class="plain" data-cact="cap-reset">${part.symbol ? "Label back where it goes by itself" : "Caption back under it"}</button>`;
    if (part.sketch) html += `<button type="button" class="plain" data-cact="edit-part" data-id="${esc(part.id)}">Change its drawing</button>`;
    html += this.portsList(part, d);
    if (part.shapes) html += `<button type="button" class="plain" data-cact="save-part" data-id="${esc(part.id)}" title="A component file can be changed by hand, or given to an AI chat as a pattern for another part">Save as a component file</button>`;
    html += `<button type="button" class="danger" data-cact="delete">Delete it and its wires</button>`;
    return html;
  }

  private swatches(current: string | undefined, auto: string): string {
    const all = Object.entries(NAMED_COLORS);
    return `<div class="field"><span id="cw-colour">Colour</span><div class="swatches" role="group" aria-labelledby="cw-colour">` +
      `<button type="button" class="swatch auto" data-cact="color" data-v="" aria-pressed="${!current}" title="As its pin: ${esc(colorName(auto))}" style="background:${auto}">A</button>` +
      all.map(([name, hex]) => `<button type="button" class="swatch" data-cact="color" data-v="${hex}" aria-pressed="${current === hex}" aria-label="${name}" title="${name}" style="background:${hex}"></button>`).join("") +
      `<label class="swatch custom" title="Another colour"><input data-cf="color" type="color" value="${esc(current ?? auto)}" aria-label="Another colour"></label></div></div>`;
  }

  private wireHtml(w: Wire): string {
    const c = this.c();
    let html = `<h2>Wire</h2>`;
    html += `<p class="cw-ends"><span>${esc(describeEnd(c, w.a))}</span><span>→</span><span>${esc(describeEnd(c, w.b))}</span></p>`;
    const schematic = !!this.L?.bundles.find((b) => b.wires.some((x) => x.id === w.id))?.schematic;
    html += this.swatches(w.color, schematic ? "#000000" : pinKind(w.a.pin).bg);
    html += this.text("Note", "wire-label", w.label ?? "", "Written along the wire and kept in the connection list. Leave empty for none.");
    html += `<div class="btn-row"><button type="button" class="plain" data-cact="select-bundle">Its bundle</button><button type="button" class="plain" data-cact="swap">Swap its ends</button></div>`;
    html += `<button type="button" class="danger" data-cact="delete">Delete this wire</button>`;
    return html;
  }

  private bundleHtml(key: string): string {
    const c = this.c();
    const ws = c.wires.filter((w) => bundleKey(w) === key);
    if (!ws.length) return this.guideHtml();
    const [a, b] = [ws[0].a, ws[0].b];
    const name = (e: WireEnd) => `${deviceById(c, e.dev)?.name ?? "?"} ${e.port}`;
    let html = `<h2>Bundle</h2><p class="cw-ends"><span>${esc(name(a))}</span><span>→</span><span>${esc(name(b))}</span></p>`;
    html += `<ul class="cw-wires">${ws.map((w) => `<li><i style="background:${wireColor(w)}"></i><button type="button" class="link" data-cact="select-wire" data-id="${esc(w.id)}">${esc(w.a.pin)} → ${esc(w.b.pin)}</button></li>`).join("")}</ul>`;
    html += `<p class="muted">Drag a handle on a middle stretch to lay the bundle another way.${c.routes[key] ? "" : " It is laid the way found best, and follows its parts when they move."}</p>`;
    if (c.routes[key]) html += `<button type="button" class="plain" data-cact="reroute">Lay it the way found best</button>`;
    html += `<button type="button" class="danger" data-cact="delete">Delete these ${ws.length} wires</button>`;
    return html;
  }

  private textHtml(t: GuideText): string {
    let html = `<h2>Text</h2>`;
    html += this.text("Text", "text-text", t.text, t.serif ? "A new line starts a new line. Math goes between dollar signs: $U_1 = 5\\,\\mathrm{V}$." : "A new line starts a new line.", true);
    html += this.choice("Set in", "text-serif", [["0", "Sans", !t.serif], ["1", "Serif, with math", !!t.serif]]);
    html += `<label class="field"><span>Size (mm)</span><input data-cf="text-size" type="number" min="0.5" max="40" step="0.1" value="${t.size}"><small>${shown(t.size * this.c().look.scale * 2.845)} pt on paper.</small></label>`;
    if (!t.serif) html += this.choice("Weight", "text-bold", [["1", "Bold", !!t.bold], ["0", "Regular", !t.bold]]);
    html += this.choice("Aligned", "text-align", [["start", "Left", (t.align ?? "start") === "start"], ["middle", "Centre", t.align === "middle"], ["end", "Right", t.align === "end"]]);
    const greys = ["#16191c", "#59626a", "#9aa0a6", "#e0302b", "#2e6ec3", "#3a9c48"];
    html += `<div class="field"><span id="cw-tcol">Colour</span><div class="swatches" role="group" aria-labelledby="cw-tcol">${greys.map((g) =>
      `<button type="button" class="swatch" data-cact="text-color" data-v="${g}" aria-pressed="${(t.color ?? "#16191c") === g}" title="${g}" style="background:${g}"></button>`).join("")}` +
      `<label class="swatch custom" title="Another colour"><input data-cf="text-color" type="color" value="${esc(t.color ?? "#16191c")}" aria-label="Another colour"></label></div></div>`;
    html += `<button type="button" class="danger" data-cact="delete">Delete this text</button>`;
    return html;
  }

  act(act: string, ds: DOMStringMap): void {
    const c = this.c();
    const s = this.sel;
    switch (act) {
      case "tool-select": return this.setTool("select");
      case "tool-wire": return this.setTool("wire");
      case "tool-bundle": return this.setTool("bundle");
      case "tool-text": return this.setTool("text");
      case "tool-cut": return this.setTool("cut");
      case "preview": return this.setPreview(!this.preview);
      case "fit": return this.fit();
      case "place": return this.startPlacing(ds.starter ? { starter: ds.starter } : { part: ds.id });
      case "deselect": this.sel = null; return this.host.touch();
      case "lib-cat": {
        if (!ds.id) return;
        if (this.lib.open.has(ds.id)) this.lib.open.delete(ds.id);
        else this.lib.open.add(ds.id);
        saveLibraryState(this.lib);
        return this.host.touch();
      }
      case "lib-logic": {
        const to = ds.v === "ansi" ? "ansi" : "iec";
        // A gate in hand follows the change of shape.
        if (this.placing?.starter?.startsWith(`logic/${this.lib.logic}/`)) this.placing.starter = this.placing.starter.replace(`logic/${this.lib.logic}/`, `logic/${to}/`);
        this.lib.logic = to;
        saveLibraryState(this.lib);
        return this.host.touch();
      }
      case "comma": if (ds.v === "comma") c.look.comma = true; else delete c.look.comma; return this.changed();
      case "new-part": return this.host.editPart(null);
      case "edit-part": return ds.id ? this.host.editPart(ds.id) : undefined;
      case "import-part": this.fileKind = "part"; this.file.accept = ".json,application/json"; return this.file.click();
      case "csv-in": this.fileKind = "csv"; this.file.accept = ".csv,text/csv,text/plain"; return this.file.click();
      case "csv-out": return this.exportCsv();
      case "save-part": {
        const p = c.parts.find((x) => x.id === ds.id);
        const text = p && writeComponent(p);
        if (text) this.host.save(text, ".json", "application/json", "Component file", p!.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"));
        return;
      }
      case "del-part": c.parts = c.parts.filter((p) => p.id !== ds.id || c.devices.some((d) => d.part === p.id)); return this.changed();
      case "clear-problems": this.problems = []; return this.host.touch();
      case "copy-howto":
        navigator.clipboard?.writeText(PHOTO_HOWTO).then(() => this.host.toast("Instructions copied: paste them into an AI chat with a photo of the board."), () => this.host.toast("Copying is blocked here: save them instead."));
        return;
      case "save-howto": return this.host.save(PHOTO_HOWTO, ".md", "text/markdown", "Instructions", "pcb-photo-to-component");
      case "example": case "example-diagram": {
        const ex = act === "example" ? exampleCircuit((x) => { applyCsv(x, readCsv(EXAMPLE_CSV).rows); }) : exampleDiagram();
        // Parts the guide has already stay, and so does anything else in it.
        const sk = this.host.sketch();
        sk.circuit = { ...ex, parts: [...c.parts.filter((p) => !ex.parts.some((q) => q.starter && q.starter === p.starter)), ...ex.parts], nextId: Math.max(ex.nextId, c.nextId) };
        this.sel = null;
        this.changed();
        return this.fit();
      }
      case "corners": c.look.corners = ds.v === "square" ? "square" : "round"; return this.changed();
      case "casing": c.look.casing = ds.v !== "off"; return this.changed();
      case "unused": c.look.unused = ds.v === "hide" ? "hide" : "outline"; return this.changed();
      case "turn": return this.turnSelected(1);
      case "flip": return this.turnSelected(0, true);
      case "dup": return this.duplicateSelected();
      case "delete": return this.deleteSelected();
      case "cap-reset": for (const d of this.selectedDevices()) delete d.cap; return this.changed();
      case "reroute": {
        if (s?.kind === "bundle") dropRoute(c, s.key);
        else if (s?.kind === "wire") { const w = c.wires.find((x) => x.id === s.id); if (w) dropRoute(c, bundleKey(w)); }
        else { c.routes = {}; delete c.axes; }
        return this.changed();
      }
      case "select-bundle": if (s?.kind === "wire") { const w = c.wires.find((x) => x.id === s.id); if (w) this.sel = { kind: "bundle", key: bundleKey(w) }; } return this.host.touch();
      case "select-wire": if (ds.id) this.sel = { kind: "wire", id: ds.id }; return this.host.touch();
      case "swap": if (s?.kind === "wire") { const w = c.wires.find((x) => x.id === s.id); if (w) [w.a, w.b] = [w.b, w.a]; } return this.changed();
      case "color": {
        if (s?.kind !== "wire") return;
        const w = c.wires.find((x) => x.id === s.id);
        if (!w) return;
        if (ds.v) w.color = ds.v;
        else delete w.color;
        return this.changed();
      }
      case "text-bold": case "text-align": case "text-color": case "text-serif": {
        const t = s?.kind === "text" ? c.texts.find((x) => x.id === s.id) : null;
        if (!t) return;
        if (act === "text-serif") { if (ds.v === "1") t.serif = true; else delete t.serif; }
        else if (act === "text-bold") { if (ds.v === "1") t.bold = true; else delete t.bold; }
        else if (act === "text-align") t.align = ds.v === "middle" || ds.v === "end" ? ds.v : "start";
        else t.color = ds.v;
        return this.changed();
      }
    }
  }

  change(input: HTMLInputElement | HTMLTextAreaElement, live = false): void {
    const c = this.c();
    const s = this.sel;
    const f = input.dataset.cf;
    if (!f) return;
    const v = input.value;
    const num = Number(v.replace(",", "."));
    const done = () => { this.stale = true; if (live) this.host.render(); else this.changed(); };
    if (f === "lib-search") {
      if (this.lib.query === v) return;
      this.lib.query = v;
      return this.host.touch();
    }
    if (f === "look-wire" || f === "look-scale") {
      if (!(num > 0)) return;
      const look: Look = c.look;
      if (f === "look-wire") look.wire = Math.min(3, Math.max(0.1, num));
      else look.scale = Math.min(20, Math.max(0.2, num));
      return done();
    }
    if (s?.kind === "devices" && s.ids.length === 1) {
      const d = deviceById(c, s.ids[0]);
      if (!d) return;
      if (f === "dev-name") {
        const name = v.trim();
        if (!name) return;
        if (c.devices.some((x) => x !== d && x.name.toLowerCase() === name.toLowerCase())) { if (!live) this.host.toast(`Another part is called ${name} already.`); return; }
        d.name = name;
        return done();
      }
      if (f === "dev-caption") {
        const part = partOf(c, d);
        // What it would be labelled anyway is not kept: a symbol left with its own label follows its name.
        if (v === (part?.caption ?? (part?.symbol ? designator(d.name) : ""))) delete d.caption;
        else d.caption = v;
        return done();
      }
      if (f === "dev-value") {
        if (v.trim()) d.value = v.trim();
        else delete d.value;
        return done();
      }
    }
    if (s?.kind === "wire") {
      const w = c.wires.find((x) => x.id === s.id);
      if (!w) return;
      if (f === "wire-label") { if (v.trim()) w.label = v.trim(); else delete w.label; return done(); }
      if (f === "color") { w.color = v; return done(); }
    }
    if (s?.kind === "text") {
      const t = c.texts.find((x) => x.id === s.id);
      if (!t) return;
      if (f === "text-text") { t.text = v; return done(); }
      if (f === "text-size" && num > 0) { t.size = Math.min(40, Math.max(0.5, num)); return done(); }
      if (f === "text-color") { t.color = v; return done(); }
    }
  }
}
