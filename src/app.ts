// The editor: tools, selection, dragging, constraint and dimension commands,
// and the panels around the canvas.

import {
  type Sketch, type Id, type Point, type Line, type Circle, type Arc, type Curve, type Constraint,
  type ConstraintDraft, type Dimension, type DistanceMode, type Sym, type SupportKind, type LeaderEnd,
  type ArrowEnds, type Datum, type BalloonFrame, HATCH_GAP, PICTURE_OPACITY, type AnyLoad, type LoadKind, type Diagram, type Plot, isLoad, loadKind, geometryExtent,
  type LineElement, type ElementLook, type Entity, type Bezier, isNamed, arcAngles, newId, controlPoints, addBezier,
  ORIGIN, emptySketch, entity, point, constraint, symbol, symbolRefs, points, curves, curvePoints,
  constraintRefs, isDimension, isLengthDimension, unitScale, fixedPoints, isLink, isFixed, arcRadius, addPoint, addLine, addCircle, addArc, addConstraint,
  addSupport, addFrame, addSymbol, remove, serialize, deserialize, clone,
} from "./model";
import { SketchSolver, type Drag, type SolveResult, type Freedom } from "./solver";
import { History } from "./history";
import {
  type V, add, sub, mul, dot, cross, norm, perp, mid, dist, angleOf, polar, wrap, inSweep,
  type Box, projectOnSegment, intersectLines, distToSegment, boxIsEmpty, grow, TWO_PI, bezierNearest,
} from "./geom";
import {
  type Prim, PAPER, PT_MM, printMm, geometryBox, buildPrims, dimensionPrims,
  primDistance, textCentre, distanceFrame, angleFrame, roundFrame, symbolPosition, balloonAnchor, measuredValue, measuredDimValue, settleLengthScale,
  curveParam, sideOfCurve, formatNumber, frameTips, arrowLabelAt, arrowAnchor, centerMarkEnds, etalonEnds, rightAngleFrame,
  centerMarkDashes, curveLength, hatchCount, standardWeight, bezierOf, loadScaleOf, loadLabel, loadReach, lineLoadFrame,
} from "./prims";
import {
  type View, type Glyph, type Preview, type SnapMark, GLYPH_SIZE, PREVIEW_REF, toScreen, toModel,
  layoutGlyphs, renderScene, imageUrl,
} from "./render";
import { regionAt, findOverlaps } from "./regions";
import { type TrimPlan, planTrim, applyTrim, strokeHits } from "./trim";
import { type CopyResult, PATTERN_MAX, mirrorCopy, linearCopy, circularCopy, nextDatumName } from "./pattern";
import { type FittedFigure, FIGURE_MARGIN, toSvg, toTikz, fitFigure } from "./export";
import { icon } from "./icons";
import { showTexFields } from "./texfield";
import { numberBox, showInBox } from "./slidernum";
import { packDrawing, svgWithDrawing, texWithDrawing, readOpened, EMPTY_SVG } from "./embed";
import { type ImportStyle, importSvg } from "./svgimport";
import { type Drawing, type Part, splitDrawing, mergeDrawing, activePart, shareSettings, entityIndex, followSources, isOrphan } from "./parts";
import { BETA, EXPORT_WAIT_SECONDS, NEWS_ID, REPORT_EMAIL, SUPPORT_URL } from "./config";
import { news } from "./news";
import { type ReportKind, composeReport } from "./report";
import { TipBook, welcomeDue, setWelcomeDue, firstInSession, newsDue, setNewsSeen } from "./guide";
import { type BeamEnds, straightBeam, curvedBeam } from "./beam";
import { PlotWorkspace } from "./plotwork";
import { baseline, beamAxis, diagramShape, plotPeak, traceShape, traceReach } from "./diagram";
import { defaultLook, lookOf, elementLength, springTurns } from "./element";

type DrawTool =
  | "point" | "line" | "centerline" | "arrow" | "arcarrow" | "circle" | "arc" | "bezier" | "beam" | "arcbeam"
  /** A line or an arc drawn as something else: a spring, a damper, a spiral spring, a damper bent round a joint. */
  | "spring" | "damper" | "spiral" | "arcdamper";
/** Tools that take two clicks and make a line between them. */
const LINE_TOOLS = ["line", "centerline", "arrow", "spring", "damper", "spiral"] as const;
type LineTool = (typeof LINE_TOOLS)[number];
const isLineTool = (t: Tool): t is LineTool => (LINE_TOOLS as readonly Tool[]).includes(t);
/** Tools that take a centre, a start and a sweep, and make an arc. */
const isArcTool = (t: Tool): t is "arc" | "arcarrow" | "arcdamper" => t === "arc" || t === "arcarrow" || t === "arcdamper";
type SymbolTool = "pin" | "roller" | "wall" | "frame" | "centermark" | "balloon" | "fill" | "hatch" | "datum" | "mass" | "note" | "load" | "lineload" | "moment" | "diagram" | "etalon" | "rightangle";
/** Tools that copy what is selected and take one more click to say how: about which line, around which point. */
type CopyTool = "mirror" | "turn";
type Command =
  | "horizontal" | "vertical" | "parallel" | "perpendicular" | "equal" | "coincident"
  | "midpoint" | "tangent" | "fixed" | "dimension" | "measure";
/** A constraint or the dimension command is a tool too: pick it, then the geometry. */
type Tool = "select" | DrawTool | "trim" | "project" | CopyTool | SymbolTool | Command;
/** Sketch holds what shapes the geometry; Annotate what is added to the figure; Dynamics what a model that moves is drawn with. */
/** Plot is a workspace of its own: its tab swaps the sketch for the plots that are kept with it. */
type Tab = "sketch" | "annotate" | "dynamics" | "plot";
const TABS: Tab[] = ["sketch", "annotate", "dynamics", "plot"];
const TAB_NAMES: Record<Tab, string> = { sketch: "Sketch", annotate: "Annotate", dynamics: "Dynamics", plot: "Plot" };

/**
 * How a plain curve is drawn in the figure: a solid or dashed edge, or a
 * centre line. Whether it is a construction line, left out of the figure, is
 * a switch of its own. Arrows, springs and dampers are made with their own
 * tools and stay what they are.
 */
type LineStyle = "solid" | "dashed" | "centre";
const STYLE_NAMES: Record<LineStyle, string> = { solid: "Solid", dashed: "Dashed", centre: "Centre line" };

/** Where a click lands once snapping has had its say. */
interface Snap {
  pos: V;
  pointId?: Id;
  curveId?: Id;
  midpoint?: boolean;
  axis?: "h" | "v";
}

type Pending =
  | { tool: "line"; start: Snap }
  | { tool: "circle"; center: Snap }
  /** A Bézier curve: its two ends are clicked, then how it bends. */
  | { tool: "bezier"; a: Snap; b?: Snap }
  | { tool: "arc"; center: Snap; start?: Snap; sweep: number; lastAng: number }
  /** A beam: its two centres are clicked first, then how wide it is. */
  | { tool: "beam"; a: Snap; b?: Snap }
  /** A curved beam: the centre of the bend, where it starts, where it ends after the sweep, then how wide it is. */
  | { tool: "arcbeam"; center: Snap; start?: Snap; end?: Snap; sweep: number; lastAng: number }
  /** A balloon whose leader has been anchored and whose circle is still to be placed. */
  | { tool: "balloon"; anchor: Snap }
  /** The mark of a right angle whose first line has been clicked, at `at`. */
  | { tool: "rightangle"; l1: Id; at: V };

type DragState =
  /** `quiet`: the press already confirmed a typed value, so releasing does nothing more. */
  | { kind: "pan"; last: V; moved: boolean; quiet: boolean }
  /** `click`: what to select if the press turns out to be a click, not a drag. */
  | { kind: "box"; a: V; b: V; additive: boolean; click?: Id }
  | { kind: "move"; grabbed: Id; startScreen: V; startModel: V; targets: { id: Id; x: number; y: number }[]; rim?: Id; moved: boolean; collapse: boolean }
  /** `onText`: the press was on the number, so a plain click opens it for typing. */
  | { kind: "dim"; id: Id; startScreen: V; moved: boolean; onText: boolean }
  /** `origin`: where the symbol was when the drag began (a position, or the offset of a balloon or a name). */
  | { kind: "sym"; id: Id; startScreen: V; startModel: V; origin: V; moved: boolean; edit?: EditTarget; part?: string }
  /** Pulling an end of a spread load along its line. */
  | { kind: "span"; id: Id; end: 0 | 1; startScreen: V; moved: boolean }
  /** The handle at the peak of a diagram: pulled away from the member or towards it to set how high the diagram is. */
  | { kind: "height"; id: Id; startScreen: V; moved: boolean }
  /** Pulling the tip of one of a pair of axes; `slack` is how far from the tip it was grabbed, in mm. */
  | { kind: "axis"; id: Id; axis: "x" | "y"; startScreen: V; slack: number; moved: boolean; edit?: EditTarget }
  /** Pulling an end of a centre mark to make the mark larger or smaller. */
  | { kind: "reach"; id: Id; startScreen: V; moved: boolean }
  /** Moving what a balloon points at; `centre` is where the balloon is, and stays. */
  | { kind: "tip"; id: Id; startScreen: V; centre: V; moved: boolean }
  /** Pulling the far end of an etalon to set how long it is. */
  | { kind: "stretch"; id: Id; startScreen: V; moved: boolean }
  /** Trimming with the button held: everything the pointer passes over goes. `cut`: something has been trimmed. */
  | { kind: "trim"; last: V; cut: boolean; trail: V[] }
  /** Moving the name of an arrow; `origin` is its offset from the arrow's middle when the drag began. */
  | { kind: "label"; id: Id; startScreen: V; startModel: V; origin: V; moved: boolean; edit?: EditTarget };
// `edit`, where present: the press was on a piece of text, so a plain click opens it for typing.

/** Something whose text can be typed where it stands on the drawing. */
type EditTarget =
  | { kind: "dim"; id: Id }
  | { kind: "balloon"; id: Id }
  | { kind: "datum"; id: Id }
  | { kind: "etalon"; id: Id }
  | { kind: "note"; id: Id }
  /** The name of a force, a spread load or a moment. */
  | { kind: "load"; id: Id }
  /** The name of an arrow; `id` is its line or arc. */
  | { kind: "arrow"; id: Id }
  | { kind: "axis"; id: Id; axis: "x" | "y" };

/** `part` and `text` describe the piece that was hit: which part of its owner, and whether it is text. */
interface Hit { id: Id; kind: "point" | "glyph" | "dim" | "curve" | "sym" | "fill"; part?: string; text?: boolean }

interface ToolDef {
  /**
   * "shift" is not a tool to hold: its button repeats the selection in a row there and then.
   * "construction" is a switch: while it is on, what the drawing tools make is construction lines.
   */
  id: Tool | "shift" | "construction";
  label: string;
  /** What the button says, where the full name is too long for it. */
  short?: string;
  key?: string;
  icon: string;
  tab: Tab | "both";
  /** Tools with the same group number sit together on the ribbon. */
  group: number;
  /** For constraints and the dimension command: what they are applied to. */
  need?: string;
}

const TOOLS: ToolDef[] = [
  { id: "construction", label: "Construction lines", short: "Construction", key: "G", icon: "construction", tab: "sketch", group: -1 },
  { id: "select", label: "Select", key: "Esc", icon: "select", tab: "both", group: 0 },

  { id: "line", label: "Line", key: "L", icon: "line", tab: "sketch", group: 1 },
  { id: "centerline", label: "Centre line", icon: "centerline", tab: "sketch", group: 1 },
  { id: "circle", label: "Circle", key: "C", icon: "circle", tab: "sketch", group: 1 },
  { id: "arc", label: "Arc", key: "A", icon: "arc", tab: "sketch", group: 1 },
  { id: "bezier", label: "Bézier curve", short: "Bézier", icon: "bezier", tab: "sketch", group: 1 },
  { id: "point", label: "Point", key: "P", icon: "point", tab: "sketch", group: 1 },
  { id: "beam", label: "Beam", icon: "beam", tab: "sketch", group: 1 },
  { id: "arcbeam", label: "Curved beam", short: "Curved", icon: "arcbeam", tab: "sketch", group: 1 },
  { id: "trim", label: "Trim", key: "X", icon: "trim", tab: "sketch", group: 2 },
  { id: "project", label: "Project", icon: "project", tab: "sketch", group: 2 },
  { id: "mirror", label: "Mirror", icon: "mirror", tab: "sketch", group: 2 },
  { id: "shift", label: "Linear pattern", short: "Linear", icon: "shift", tab: "sketch", group: 2 },
  { id: "turn", label: "Circular pattern", short: "Circular", icon: "turn", tab: "sketch", group: 2 },
  { id: "dimension", label: "Dimension", key: "D", icon: "dimension", tab: "sketch", group: 3, need: "a line, two points, two lines, a point and a line, or a circle" },
  { id: "horizontal", label: "Horizontal", key: "H", icon: "horizontal", tab: "sketch", group: 3, need: "a line, or two points" },
  { id: "vertical", label: "Vertical", key: "V", icon: "vertical", tab: "sketch", group: 3, need: "a line, or two points" },
  { id: "parallel", label: "Parallel", icon: "parallel", tab: "sketch", group: 3, need: "two lines" },
  { id: "perpendicular", label: "Perpendicular", icon: "perpendicular", tab: "sketch", group: 3, need: "two lines" },
  { id: "equal", label: "Equal", key: "E", icon: "equal", tab: "sketch", group: 3, need: "two lines, or two circles" },
  { id: "coincident", label: "Coincident", key: "O", icon: "coincident", tab: "sketch", group: 3, need: "two points, or a point and a line or circle" },
  { id: "midpoint", label: "Midpoint", key: "M", icon: "midpoint", tab: "sketch", group: 3, need: "a point and a line" },
  { id: "tangent", label: "Tangent", key: "T", icon: "tangent", tab: "sketch", group: 3, need: "a line and a circle or arc, or two circles or arcs" },
  { id: "fixed", label: "Fix point", key: "F", icon: "fixed", tab: "sketch", group: 3, need: "a point" },

  { id: "measure", label: "Measure", icon: "measure", tab: "annotate", group: 1, need: "a line, two points, two lines, a point and a line, or a circle" },
  { id: "pin", label: "Pin", icon: "pin", tab: "annotate", group: 2 },
  { id: "roller", label: "Roller", icon: "roller", tab: "annotate", group: 2 },
  { id: "wall", label: "Fixed", icon: "wall", tab: "annotate", group: 2 },
  { id: "load", label: "Load", icon: "load", tab: "annotate", group: 3 },
  { id: "lineload", label: "Distributed load", short: "Distributed", icon: "lineload", tab: "annotate", group: 3 },
  { id: "moment", label: "Moment", icon: "moment", tab: "annotate", group: 3 },
  { id: "diagram", label: "Diagram", icon: "diagram", tab: "annotate", group: 3 },
  { id: "frame", label: "Axes", icon: "frame", tab: "annotate", group: 4 },
  { id: "arrow", label: "Arrow", icon: "arrow", tab: "annotate", group: 4 },
  { id: "arcarrow", label: "Curved arrow", icon: "arcarrow", tab: "annotate", group: 4 },
  { id: "datum", label: "Datum point", icon: "datum", tab: "annotate", group: 4 },
  { id: "note", label: "Note", key: "N", icon: "note", tab: "annotate", group: 4 },
  { id: "centermark", label: "Centre mark", icon: "centermark", tab: "annotate", group: 4 },
  { id: "rightangle", label: "Right angle", icon: "rightangle", tab: "annotate", group: 4 },
  { id: "balloon", label: "Balloon", key: "B", icon: "balloon", tab: "annotate", group: 4 },
  { id: "etalon", label: "Etalon", icon: "etalon", tab: "annotate", group: 4 },
  { id: "fill", label: "Fill", icon: "fill", tab: "annotate", group: 5 },
  { id: "hatch", label: "Hatching", icon: "hatch", tab: "annotate", group: 5 },

  { id: "spring", label: "Spring", icon: "spring", tab: "dynamics", group: 1 },
  { id: "damper", label: "Damper", icon: "damper", tab: "dynamics", group: 1 },
  { id: "spiral", label: "Torsion spring", icon: "spiral", tab: "dynamics", group: 2 },
  { id: "arcdamper", label: "Torsion damper", icon: "arcdamper", tab: "dynamics", group: 2 },
  { id: "mass", label: "Centre of mass", icon: "mass", tab: "dynamics", group: 3 },
];

const COMMAND_IDS: Command[] = [
  "horizontal", "vertical", "parallel", "perpendicular", "equal", "coincident", "midpoint", "tangent", "fixed", "dimension", "measure",
];
/** The commands that are placed once their geometry is picked: a dimension, and a measure. */
const isPlaced = (t: Tool): t is "dimension" | "measure" => t === "dimension" || t === "measure";
const isCommand = (t: Tool): t is Command => (COMMAND_IDS as Tool[]).includes(t);
const isSymbolTool = (t: Tool): t is SymbolTool =>
  ["pin", "roller", "wall", "frame", "centermark", "balloon", "fill", "hatch", "datum", "mass", "note", "load", "lineload", "moment", "diagram", "etalon", "rightangle"].includes(t);
const isCopyTool = (t: Tool): t is CopyTool => t === "mirror" || t === "turn";
const toolDef = (t: Tool | "shift" | "construction"): ToolDef => TOOLS.find((d) => d.id === t)!;

const RELATION_NAMES: Record<string, string> = {
  coincident: "Coincident", pointOn: "Point on curve", midpoint: "Midpoint", horizontal: "Horizontal",
  vertical: "Vertical", parallel: "Parallel", perpendicular: "Perpendicular", equal: "Equal",
  tangent: "Tangent", fixed: "Fixed point", distance: "Distance", angle: "Angle", radius: "Radius",
  mirror: "Mirror image", shift: "Linear pattern", turn: "Circular pattern",
};
/** How far the supports can be scaled against the other symbols, in per cent. */
const SUPPORT_SCALE_MIN = 30, SUPPORT_SCALE_MAX = 300;
const SUPPORT_NAMES: Record<SupportKind, string> = { pin: "Pin support", roller: "Roller support", fixed: "Fixed support" };
/** Fill colours offered as swatches: light tones that print well under black lines. */
const FILL_COLORS = ["#d5dbe1", "#eceff1", "#f6d9a8", "#f4b6a6", "#b9d7ee", "#bfe3c4", "#d9c8ea", "#8f9aa3"];
/** A new hatching, in annotation mm: the size of the ground under a support, as the view is when it is made. */
const DEFAULT_HATCH = { spacing: 1.3, depth: 1.6 };
/** The hatching sliders run from few, long strokes to many, short ones, in equal ratios along the slider. */
const HATCH_COUNT: [number, number] = [2, 300];
/** Stroke length as a share of the hatched curve's length. */
const HATCH_REACH: [number, number] = [1 / 500, 1 / 2];
/** Most gaps a centre mark's line can be given. */
const CENTRE_GAPS_MAX = 16;
/** Position 0 to 100 on a slider whose values are spread in equal ratios between lo and hi. */
const ratioPos = (v: number, [lo, hi]: [number, number]) => Math.round(Math.max(0, Math.min(100, (100 * Math.log(v / lo)) / Math.log(hi / lo))));
const ratioValue = (pos: number, [lo, hi]: [number, number]) => lo * (hi / lo) ** (Math.max(0, Math.min(100, pos)) / 100);
/** Colours offered for datum points: strong ones, so the dot reads on top of the lines. */
const DATUM_COLORS = ["#d32f2f", "#1565c0", "#2e7d32", "#ef6c00", "#6a1b9a", "#17201b"];
/** Colours offered for loads: red first, as the usual way to set them apart from the structure. */
const LOAD_COLORS = ["#d32f2f", "#1565c0", "#2e7d32", "#ef6c00", "#6a1b9a", "#17201b"];
/** Colours a line, circle or arc can be drawn in, besides black. */
const CURVE_COLORS = ["#d32f2f", "#1565c0", "#2e7d32", "#ef6c00", "#6a1b9a", "#8a968e"];
/** How long a new etalon is on paper, in mm, before it is rounded to a round length of the drawing. */
const ETALON_MM = 22;
/** A round number near v: 1, 2 or 5 times a power of ten. */
function roundNumber(v: number): number {
  const pow = 10 ** Math.floor(Math.log10(v));
  const m = v / pow;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * pow;
}
/** How large the first load of each kind is drawn, in screen pixels: a force's length, the height of a spread load, a moment's radius. */
const LOAD_START: Record<LoadKind, number> = { force: 64, line: 34, moment: 30 };
/** How far apart the arrows of a new spread load are, in screen pixels. */
const LINE_ARROW_GAP = 30;
/** What a new load of each kind is called. */
const LOAD_NAME: Record<AnyLoad["type"], string> = { load: "F", lineload: "q", moment: "M" };
const LOAD_TITLE: Record<AnyLoad["type"], string> = { load: "Load", lineload: "Distributed load", moment: "Moment" };
/** The size slider of a load runs over its drawn size as a share of the figure, in equal ratios. */
const LOAD_SIZE: [number, number] = [1 / 100, 2];
/** Most arrows a spread load is drawn with. */
const LINE_ARROWS_MAX = 60;
/** How high a diagram can be set with its slider, against the length of its member, and the most strokes it is drawn with. */
const DIAGRAM_SIZE: [number, number] = [1 / 50, 2];
const DIAGRAM_STROKES_MAX = 80;
/** Where a datum's name starts out, in mm from its point; the mark of a centre of mass is larger, so its name stands further off. */
const DATUM_LABEL_OFFSET: V = [2.4, 2.4];
const MASS_LABEL_OFFSET: V = [3.4, 3.2];
/** What the mark of a centre of mass is drawn in and called to start with. */
const MASS_COLOR = "#17201b", MASS_NAME = "S";
/** How wide a new spring or damper is across, in annotation mm in the figure as it prints when it is made. */
const ELEMENT_ACROSS = 5;
/** What a new element is called: nothing, until a name is typed. The placeholders show what is usual. */
const ELEMENT_HINT: Record<LineElement, string> = { spring: "k, k_1", damper: "c, c_1", spiral: "k_t" };
const ELEMENT_TITLE: Record<LineElement, string> = { spring: "spring", damper: "damper", spiral: "torsion spring" };
/** The sliders of an element run over its sizes as shares of its length, in equal ratios. */
const ELEMENT_ACROSS_RANGE: [number, number] = [1 / 60, 1];
const ELEMENT_PITCH_RANGE: [number, number] = [1 / 150, 1 / 2];
const EXPORT_NAME_KEY = "mech-sketch.exportName";
const SKETCH_NAME_KEY = "mech-sketch.sketchName";
/** Range of the line thickness slider, in points. */
const WEIGHT_MIN = 0.1, WEIGHT_MAX = 3;
/** What is written to a file: the exported figure, or the sketch itself. Each remembers its own name and folder. */
type SaveSlot = "figure" | "sketch" | "plot";
const EDIT_SCALE_KEY = "mech-sketch.editScale";
/** Range of the slider for the size of annotations while editing, in percent. */
const EDIT_SCALE_MIN = 50, EDIT_SCALE_MAX = 250;

/** Range of the dimension size slider, in percent. */
const DIM_SCALE_MIN = 30, DIM_SCALE_MAX = 300;

/** Where the released app keeps the sketch being worked on. */
const LIVE_AUTOSAVE_KEY = "mech-sketch.autosave";
/** The beta keeps its own: a sketch with something new in it would not open whole in the released app. */
const AUTOSAVE_KEY = BETA ? "mech-sketch-beta.autosave" : LIVE_AUTOSAVE_KEY;
/**
 * Screen pixels per annotation mm while editing. Text, arrowheads and symbols
 * keep this size however far the view is zoomed, as in a CAD sketcher.
 */
const EDIT_PX_PER_MM = 5;
const POINT_TOL = 10;  // px
const CURVE_TOL = 7;   // px
const DEFAULT_SCALE = 40;
const DEG = Math.PI / 180;

const $ = <T extends HTMLElement | SVGElement = HTMLElement>(sel: string): T => {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`missing element ${sel}`);
  return el;
};
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Whether something is kept in the browser's storage under this key. */
function hasStored(key: string): boolean {
  try { return localStorage.getItem(key) !== null; } catch { return false; }
}

/** Parses a number typed with either a decimal point or a decimal comma. */
function parseNumber(text: string): number {
  const t = text.trim().replace(",", ".");
  return t === "" ? NaN : Number(t);
}

/** When this copy of the app was built, in the reader's own time, for telling versions apart. */
function buildLabel(): string {
  const built = new Date(__BUILD_TIME__);
  if (Number.isNaN(built.getTime())) return "";
  const when = built.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  return `This version was built on ${when}.`;
}

export class App {
  /**
   * Whether this browser has used this copy of the app before: in the beta, that
   * it has a sketch of its own; in the released app, that it has one at all. Only
   * then is there anything new to tell.
   */
  private readonly returning = hasStored(AUTOSAVE_KEY);
  sk: Sketch = emptySketch();
  /** The sketches of the drawing. The one being worked on is `sk`; the drawing's copy of it is brought up to date when the drawing is saved or another sketch is opened. */
  private drawing: Drawing = splitDrawing(this.sk);
  /** What the Project tool would take, under the pointer: an entity of another sketch. */
  private projectHover: Id | null = null;
  private history = new History();
  private result: SolveResult = { ok: true, dof: 0, conflicting: [], redundant: [] };

  private view: View = { cx: 0, cy: 0, scale: DEFAULT_SCALE, w: 800, h: 600 };
  private tool: Tool = "select";
  private tab: Tab = "sketch";
  /** What can still move, worked out after each edit; null until then or when it cannot be told. */
  private freedom: Freedom | null = null;
  private freedomStale = true;
  private fillColor = FILL_COLORS[0];
  /** How the next fill is filled, as the last one was: colour, hatching, or both. */
  private fillLook: "color" | "hatch" | "both" = "color";
  private beamEnds: BeamEnds = "round";
  /** Construction is switched on: the lines, circles and arcs drawn are construction lines, left out of the figure. */
  private constructing = false;
  private tips = new TipBook();
  /** The tip on show, and whether it goes away when its tool is put down. */
  private tip: { id: string; withTool: boolean } | null = null;
  /** Seconds an export waits with the Support button on show. */
  private exportWait = EXPORT_WAIT_SECONDS;
  private supportTimer = 0;
  private reportKind: ReportKind = "bug";
  private datumColor = DATUM_COLORS[0];
  private loadColor = LOAD_COLORS[0];
  /** The plot the Diagram tool lays along what is clicked; none chosen means the first there is. */
  private diagramPlotId: Id | null = null;
  /** Print preview: only what is exported is drawn, with annotations at their size in print. */
  private preview = false;
  /** How large annotations are on screen while editing, against the standard size. A setting of this browser, not of the sketch. */
  private editScale = 1;
  /** The view to go back to when the print preview is left. */
  private viewBeforePreview: View | null = null;
  /** In the print preview: the figure as it is exported, fitted to its page. Laid out afresh for every frame. */
  private fig: FittedFigure | null = null;
  /** File name, without extension, offered for the next export. */
  private exportName = "figure";
  /** File name, without extension, offered when the sketch is saved. */
  private sketchName = "sketch";
  /** What the dimension box held when it opened, to tell an edit from a plain close. */
  private editingInitial = "";
  /** What the Trim tool would remove under the pointer. */
  private trimPlan: TrimPlan | null = null;
  /** What is selected; while a command is active, the geometry picked for it so far. */
  private selection = new Set<Id>();
  private hover: Id | null = null;
  private pending: Pending | null = null;
  private drag: DragState | null = null;
  private cursor: V = [0, 0]; // last pointer position, screen px
  private snapMark: SnapMark | null = null;
  private altKey = false;
  private spaceKey = false;
  /** What the box on the drawing is editing: a dimension, or the name of something. */
  private editing: EditTarget | null = null;
  /** The last thing picked with the Select tool, for stepping through overlaps. */
  private lastPick: { pos: V; id: Id; time: number } | null = null;

  private prims: Prim[] = [];
  private glyphs: Glyph[] = [];
  private frame = 0;
  private chromeDirty = true;
  private hintOverride: string | null = null;
  /** What the last right-click through a stack picked, and where: said in the status bar while the pointer stays there. */
  private cycleNote: { pos: V; text: string } | null = null;
  private toastTimer = 0;
  private focusTimer = 0;

  private svg = $<SVGSVGElement>("#canvas");
  private stage = $<HTMLElement>("#stage");
  private panel = $<HTMLElement>("#panel");
  private titleblock = $<HTMLElement>("#titleblock");
  private hintEl = $<HTMLElement>("#hint");
  private coordsEl = $<HTMLElement>("#coords");
  private toastEl = $<HTMLElement>("#toast");
  private emptyEl = $<HTMLElement>("#empty");
  private dimEditor = $<HTMLInputElement>("#dim-editor");
  private fileInput = $<HTMLInputElement>("#file-input");
  /** The Plot workspace. It works on the plots of the same sketch, so saving and undo take them along. */
  private plots = new PlotWorkspace(
    { sketch: () => this.sk, commit: () => this.commit(), render: () => this.render(), touch: () => this.touch(), toast: (m) => this.toast(m) },
    $<SVGSVGElement>("#plot-canvas"), this.panel, $("#plot-empty"),
  );

  constructor(private solver: SketchSolver) {
    this.buildToolbars();
    this.bindEvents();
    this.restore();
    this.resize();
    this.fit();
    this.solve();
    this.history.reset(this.whole());
    this.render();
    this.greet();
  }

  // ---- welcome, tips and support ------------------------------------------------

  /** What someone opening the app is met with: the welcome the first time, a word about support after that. */
  private greet(): void {
    // Every place that asks for support gets the same link; without somewhere to send people there is none.
    for (const slot of document.querySelectorAll<HTMLElement>("[data-support]")) {
      slot.innerHTML = SUPPORT_URL
        ? `<a class="support-link" href="${esc(SUPPORT_URL)}" target="_blank" rel="noopener noreferrer">${icon("heart", 18)}${esc(slot.dataset.support ?? "Support")}</a>`
        : "";
    }
    for (const row of document.querySelectorAll<HTMLElement>("[data-support-row]")) row.hidden = !SUPPORT_URL;
    const first = firstInSession();
    if (welcomeDue()) {
      // Someone new is shown round instead; what is new is new to them anyway.
      setNewsSeen(NEWS_ID, BETA);
      this.showWelcome();
    } else if (this.returning && newsDue(NEWS_ID, BETA)) this.showNews();
    else if (SUPPORT_URL && first) this.showSupportCard();
  }

  /** Once for each release: what it brings, or in the beta, that what was tried out there is live. */
  private showNews(): void {
    const dialog = $<HTMLDialogElement>("#news-dialog");
    if (dialog.open) return;
    const n = news(BETA);
    $("#news-title").textContent = n.title;
    $("#news-body").innerHTML = n.body;
    const link = $<HTMLAnchorElement>("#news-link");
    link.hidden = !n.link;
    link.href = n.link?.href ?? "";
    link.textContent = n.link?.text ?? "";
    $("#news-close").textContent = n.close;
    setNewsSeen(NEWS_ID, BETA);
    dialog.showModal();
    $("#news-close").focus();
  }

  /** The greeting and the short guide. Also what the Help button opens. */
  private showWelcome(): void {
    const dialog = $<HTMLDialogElement>("#welcome-dialog");
    if (dialog.open) return;
    const never = $<HTMLInputElement>("#welcome-never");
    never.checked = true;
    dialog.addEventListener("close", () => setWelcomeDue(!never.checked), { once: true });
    dialog.showModal();
    dialog.querySelector<HTMLElement>("button.primary")?.focus();
  }

  /** The form for a bug report or a suggestion. What was typed stays for the next time it is opened. */
  private showReport(): void {
    const dialog = $<HTMLDialogElement>("#report-dialog");
    if (dialog.open || !REPORT_EMAIL) return;
    $("#report-hint").textContent = "";
    this.updateReport();
    dialog.showModal();
    $("#report-text").focus();
  }

  /** What the app adds to a report: which version it is, what it runs in, and how large the sketch is. */
  private reportDetails(): string[] {
    const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
    const r = this.result;
    const solver = !r.ok || r.conflicting.length ? "constraints conflict" : r.dof === 0 ? "fully constrained" : count(r.dof, "degree of freedom", "degrees of freedom");
    return [
      `Mech Sketch built ${__BUILD_TIME__} at ${location.protocol === "file:" ? "a file on disk" : location.origin}`,
      `Browser: ${navigator.userAgent}`,
      `Sketch: ${count(points(this.sk).length, "point", "points")}, ${count(curves(this.sk).length, "curve", "curves")}, ` +
        `${count(this.sk.constraints.length, "constraint", "constraints")}, ${count(this.sk.symbols.length, "symbol", "symbols")}; ${solver}`,
    ];
  }

  /** Brings the report form up to date with its fields: the wording for its kind, and the email it would send. */
  private updateReport(): void {
    const text = $<HTMLTextAreaElement>("#report-text");
    const bug = this.reportKind === "bug";
    document.querySelectorAll<HTMLElement>("[data-report]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.report === this.reportKind)));
    $("#report-ask").textContent = bug ? "What went wrong?" : "What would make it better?";
    text.placeholder = bug
      ? "What you did, what you expected, and what happened instead."
      : "What you would like to be able to do, and what for.";
    const details = this.reportDetails();
    $("#report-details").textContent = details.join(". ") + ".";
    $("#report-to").textContent = REPORT_EMAIL;
    const send = $<HTMLAnchorElement>("#report-send");
    send.href = composeReport(REPORT_EMAIL, this.reportKind, text.value, details).href;
    send.setAttribute("aria-disabled", String(!text.value.trim()));
    if (text.value.trim()) $("#report-hint").textContent = "";
  }

  /** Puts the report on the clipboard, for mail that is read in a browser. */
  private async copyReport(): Promise<void> {
    const typed = $<HTMLTextAreaElement>("#report-text").value;
    const hint = $("#report-hint");
    if (!typed.trim()) {
      hint.textContent = "Write a line about it first.";
      return $("#report-text").focus();
    }
    const report = composeReport(REPORT_EMAIL, this.reportKind, typed, this.reportDetails());
    try {
      await navigator.clipboard.writeText(report.text);
      hint.textContent = `Copied. Paste it into an email to ${REPORT_EMAIL}.`;
    } catch {
      hint.textContent = `Copying is blocked here. Please write to ${REPORT_EMAIL}.`;
    }
  }

  private showSupportCard(): void {
    const card = $("#support-card");
    card.hidden = false;
    // It has been seen by then; it does not stay in the way.
    clearTimeout(this.supportTimer);
    this.supportTimer = window.setTimeout(() => { card.hidden = true; }, 40_000);
  }

  /**
   * Shows the tip for a feature, the first time it is used. `withTool`: the
   * tip belongs to the tool in hand and goes when the tool is put down.
   */
  private showTip(id: string, withTool = false): void {
    const tip = this.tips.due(id);
    if (!tip) return;
    this.closeTip();
    this.tip = { id, withTool };
    $("#tip-title").textContent = tip.title;
    $("#tip-body").textContent = tip.body;
    const def = TOOLS.find((t) => t.id === id);
    $("#tip-icon").innerHTML = def ? icon(def.icon, 18) : id === "preview" ? icon("eye", 18) : id === "plot" ? icon("curve", 18) : "";
    $<HTMLInputElement>("#tip-never").checked = true;
    $("#tip").hidden = false;
  }

  /** Puts the tip away. Unless its box was unticked, it is not shown again. */
  private closeTip(): void {
    if (!this.tip) return;
    if ($<HTMLInputElement>("#tip-never").checked) this.tips.dismiss(this.tip.id);
    this.tip = null;
    $("#tip").hidden = true;
  }

  /** Puts the tips setting on its checkbox. */
  private showTipsSetting(): void {
    $<HTMLInputElement>("#tips-on").checked = !this.tips.off;
  }

  // ---- state ----------------------------------------------------------------

  /**
   * Annotation mm per model unit for what is on screen. While editing it
   * follows the zoom, which is what keeps annotations one size on screen; in
   * the print preview it is the scale of the exported figure.
   */
  private mm(): number {
    return this.preview ? this.printScale() : this.view.scale / (EDIT_PX_PER_MM * this.editScale);
  }

  /** Annotation mm per model unit in the exported figure, as the print preview last laid it out. */
  private printScale(): number {
    return this.preview && this.fig ? this.fig.mm : printMm(this.sk);
  }

  /** A length of the drawing as the panel shows it: in the units the sketch is dimensioned in. */
  private inUnits(v: number, digits = 4): string {
    return formatNumber(Number((v * unitScale(this.sk)).toPrecision(digits)));
  }

  /** A length typed in the units the sketch is dimensioned in, in the drawing's own. */
  private fromUnits(v: number): number {
    return v / unitScale(this.sk);
  }

  private solve(drags: Drag[] = []): SolveResult {
    this.result = this.solver.solve(this.sk, drags);
    return this.result;
  }

  /** The whole drawing as one sketch: what is saved, undone and redone. */
  private whole(): Sketch {
    return mergeDrawing(this.drawing, this.sk);
  }

  /** The sketches that are in the exported figure, as one sketch. */
  private figureSketch(): Sketch {
    return mergeDrawing(this.drawing, this.sk, true);
  }

  /** Opens a drawing: its sketches, and the one that was being worked on. */
  private loadDrawing(all: Sketch): void {
    this.drawing = splitDrawing(all);
    this.sk = activePart(this.drawing).sk;
  }

  /** The other sketches, as they are now. */
  private otherParts(): Part[] {
    return this.drawing.parts.filter((p) => p.info.id !== this.drawing.active);
  }

  /** Every constraint of the drawing, in every sketch. */
  private allConstraints(): Constraint[] {
    return [...this.sk.constraints, ...this.otherParts().flatMap((p) => p.sk.constraints)];
  }

  /**
   * The sketches after the one being worked on follow what they projected
   * from it: their projections move to where the sources are now, and each
   * that moved is solved again. None before it can depend on it.
   */
  private followDownstream(): void {
    const parts = this.drawing.parts;
    const from = parts.findIndex((p) => p.info.id === this.drawing.active);
    let index: Map<Id, import("./model").Entity> | null = null;
    for (const p of parts.slice(from + 1)) {
      if (!p.sk.entities.some((e) => e.ref)) continue;
      index ??= entityIndex(this.drawing, this.sk);
      shareSettings(this.sk, p.sk);
      if (followSources(p.sk, index)) this.solver.solve(p.sk);
    }
  }

  /** Records the current sketch as an undo step and saves it. */
  private commit(): void {
    this.freedomStale = true;
    // The scale belongs to the drawing: the first length dimension in any sketch sets it.
    const all = this.whole();
    settleLengthScale(all);
    if (all.lengthScale === undefined) delete this.sk.lengthScale;
    else this.sk.lengthScale = all.lengthScale;
    this.followDownstream();
    this.history.commit(this.whole());
    this.autosave();
    this.touch();
  }

  private autosave(): void {
    try {
      localStorage.setItem(AUTOSAVE_KEY, serialize(this.whole()));
    } catch {
      // Storage can be unavailable (private window, file:// in some browsers).
    }
  }

  private restore(): void {
    try {
      // The beta starts out from the sketch the released app was left with, and goes its own way from there.
      const saved = localStorage.getItem(AUTOSAVE_KEY) ?? (BETA ? localStorage.getItem(LIVE_AUTOSAVE_KEY) : null);
      if (saved) this.loadDrawing(deserialize(saved));
      this.exportName = localStorage.getItem(EXPORT_NAME_KEY) || this.exportName;
      this.sketchName = localStorage.getItem(SKETCH_NAME_KEY) || this.sketchName;
      const scale = Number(localStorage.getItem(EDIT_SCALE_KEY));
      if (scale >= EDIT_SCALE_MIN / 100 && scale <= EDIT_SCALE_MAX / 100) {
        this.editScale = scale;
        this.showEditScale();
      }
    } catch {
      this.loadDrawing(emptySketch());
    }
  }

  /** Marks panels as stale and schedules a redraw. */
  private touch(): void {
    this.chromeDirty = true;
    this.render();
  }

  private render(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.draw();
    });
  }

  private replaceSketch(sk: Sketch): void {
    this.loadDrawing(sk);
    this.projectHover = null;
    this.freedomStale = true;
    this.pruneSelection();
    this.pending = null;
    this.closeEditor();
    this.solve();
    this.plots.sync();
  }

  private exists(id: Id): boolean {
    return !!(entity(this.sk, id) || constraint(this.sk, id) || symbol(this.sk, id));
  }

  private pruneSelection(): void {
    for (const id of [...this.selection]) if (!this.exists(id)) this.selection.delete(id);
    if (this.hover && !this.exists(this.hover)) this.hover = null;
  }

  private toast(message: string): void {
    this.toastEl.textContent = message;
    this.toastEl.classList.add("show");
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove("show"), 4200);
  }

  /** True when nothing has been drawn: only the origin is there. */
  private isBlank(): boolean {
    return [this.sk, ...this.otherParts().map((p) => p.sk)].every((sk) => sk.entities.length <= 1 && !sk.symbols.length);
  }

  // ---- drawing the screen -----------------------------------------------------

  private draw(): void {
    if (this.tab === "plot") return this.drawPlot();
    this.fig = this.preview ? fitFigure(this.figureSketch()) : null;
    const mm = this.mm();
    this.prims = this.fig ? this.fig.prims : buildPrims(this.sk, mm, { editor: !this.preview });
    this.glyphs = this.preview ? [] : layoutGlyphs(this.sk, this.view, this.glyphFilter());

    const related = new Set<Id>();
    for (const id of this.selection) {
      const c = constraint(this.sk, id);
      if (c) constraintRefs(c).forEach((r) => related.add(r));
      const s = symbol(this.sk, id);
      if (s && s.type !== "fill") symbolRefs(s).forEach((r) => related.add(r));
    }
    this.svg.innerHTML = renderScene({
      sk: this.sk, view: this.view, mm, prims: [...this.prims, ...this.dimensionPreview(mm)], glyphs: this.glyphs,
      selection: this.selection, related, hover: this.hover,
      conflicting: new Set(this.result.conflicting), redundant: new Set(this.result.redundant),
      freeIds: this.preview ? new Set() : this.freeIds(), overlaps: findOverlaps(this.sk),
      preview: this.previewShapes(), snap: this.snapMark,
      box: this.drag?.kind === "box" ? { a: this.drag.a, b: this.drag.b } : null,
      grips: this.grips(mm), plain: this.preview, page: this.pageMark(), under: this.preview ? "" : this.otherSketches(),
    });

    this.emptyEl.hidden = !this.isBlank() || this.pending !== null || this.tool !== "select";
    this.svg.dataset.tool = this.tool === "select" ? "select" : isCommand(this.tool) || this.tool === "mirror" || this.tool === "project" ? "pick" : "draw";
    this.svg.classList.toggle("panning", this.drag?.kind === "pan" || this.spaceKey);
    this.svg.classList.toggle("over", this.tool === "select" && this.hover !== null && !this.drag);

    const m = toModel(this.view, this.cursor);
    this.coordsEl.textContent = `x ${this.inUnits(m[0], 6)}   y ${this.inUnits(m[1], 6)}`;
    this.hintEl.textContent = this.hintOverride ?? (this.preview ? "Print preview: the figure as it is exported, fitted to the figure width with a margin all round. Press Q to go back to editing." : this.toolHint());

    if (this.chromeDirty) {
      this.chromeDirty = false;
      this.drawPanel();
      this.drawTitleblock();
      this.drawStrip();
      this.updateButtons();
    }
    if (this.editing) this.placeEditor();
  }

  /** The page the print preview shows the figure on: its size on paper, and the margin round it. */
  private pageMark(): { page: Box; inner: Box; caption: string } | null {
    const fig = this.fig;
    if (!fig) return null;
    const mm = fig.mm, k = this.sk.dimScale > 0 ? this.sk.dimScale : 1;
    const shown = (v: number) => formatNumber(Number(v.toFixed(1)));
    const times = this.view.scale / mm / k / (96 / 25.4);
    const at = Math.abs(times - 1) > 0.05 ? (times > 1 ? `shown ${times.toFixed(1)}× enlarged` : `shown at ${Math.round(times * 100)} %`) : "actual size";
    const m = fig.margin;
    return {
      page: fig.page,
      inner: { x0: fig.page.x0 + m, y0: fig.page.y0 + m, x1: fig.page.x1 - m, y1: fig.page.y1 - m },
      caption: `${shown(fig.width / 10)} × ${shown(fig.height / 10)} cm · ${at} · dashed: the ${Math.round(FIGURE_MARGIN * 100)} % margin`,
    };
  }

  /** The same for the Plot workspace, which draws its own canvas and panel. */
  private drawPlot(): void {
    this.plots.draw();
    this.coordsEl.textContent = this.plots.coords();
    this.hintEl.textContent = this.hintOverride ?? this.plots.hint();
    if (this.chromeDirty) {
      this.chromeDirty = false;
      this.plots.drawPanel();
      this.updateButtons();
    }
  }

  /**
   * Which constraint markers to draw: those on what is selected, the selected
   * ones themselves, and any that conflict. The rest would only be clutter.
   */
  private glyphFilter(): (c: Constraint) => boolean {
    const sel = this.selection;
    const flagged = new Set<Id>([...this.result.conflicting, ...this.result.redundant]);
    const lines: Line[] = [];
    // Selected geometry, plus the points the selected curves are built on.
    const active = new Set<Id>();
    for (const id of sel) {
      const e = entity(this.sk, id);
      if (!e) continue;
      active.add(id);
      if (e.type === "line") lines.push(e);
      if (e.type !== "point") curvePoints(e).forEach((p) => active.add(p));
    }
    return (c) => {
      if (sel.has(c.id) || flagged.has(c.id)) return true;
      if (c.type === "horizontal" || c.type === "vertical") {
        // Held between two points: it belongs to those points and to the line that joins them,
        // not to every other line that happens to share an end.
        return sel.has(c.a) || sel.has(c.b) || lines.some((l) => (l.p1 === c.a && l.p2 === c.b) || (l.p1 === c.b && l.p2 === c.a));
      }
      return constraintRefs(c).some((r) => active.has(r));
    };
  }

  /** Handles on the selected symbol: the tips of a pair of axes or the ends of a centre mark, which can be pulled. Screen pixels. */
  private grips(mm: number): V[] {
    const s = this.selectedSymbol();
    if (!s || this.tool !== "select") return [];
    let at: V[] = [];
    if (s.type === "frame") {
      const tips = frameTips(this.sk, s, mm);
      at = [tips.x, tips.y].filter((t): t is V => t !== null);
    } else if (s.type === "centermark") at = centerMarkEnds(this.sk, s, mm);
    else if (s.type === "etalon") at = [etalonEnds(s, mm)[1]];
    else if (s.type === "picture") at = [[(s.x + s.w) * mm, (s.y + s.h) * mm]];
    else if (s.type === "balloon" && Math.hypot(s.dx, s.dy) > 1e-12) at = [mul(balloonAnchor(this.sk, s), mm)];
    else if (s.type === "lineload") {
      const f = lineLoadFrame(this.sk, s, mm);
      if (f) at = [f.e0, f.e1];
    } else if (s.type === "diagram") {
      const shape = diagramShape(this.sk, s);
      if (shape) at = [...shape.ends, ...(shape.peak ? [shape.peak.at] : [])].map((q) => mul(q, mm));
    }
    return at.map((t) => toScreen(this.view, [t[0] / mm, t[1] / mm]));
  }

  /**
   * Ids of the points and curves that can still move. A curve is free while
   * any point it is built on is, or, for a circle, while its radius is.
   */
  private freeIds(): Set<Id> {
    // Not while dragging: what is free does not change mid-drag, and probing costs a solve per point.
    if (this.freedomStale && !this.drag) {
      this.freedomStale = false;
      this.freedom = this.result.ok ? this.solver.freedom(this.sk) : null;
    }
    const ids = new Set<Id>();
    const f = this.freedom;
    if (!f) {
      // Unknown (conflicting constraints, or too large to probe): all or nothing.
      if (this.result.dof !== 0 || !this.result.ok) for (const e of this.sk.entities) ids.add(e.id);
      return ids;
    }
    for (const e of this.sk.entities) {
      if (e.type === "point") {
        if (f.points.has(e.id)) ids.add(e.id);
      } else if (curvePoints(e).some((p) => f.points.has(p)) || f.radii.has(e.id)) {
        ids.add(e.id);
      }
    }
    return ids;
  }

  private toolHint(): string {
    if (this.cycleNote && dist(this.cursor, this.cycleNote.pos) < 6) return this.cycleNote.text;
    const hint = this.toolHintFor();
    // While Construction is on, the drawing tools say so: what they make is left out of the figure.
    const drawing = this.tool === "line" || this.tool === "centerline" || this.tool === "circle" || this.tool === "arc";
    return this.constructing && drawing ? `Construction lines: ${hint}` : hint;
  }

  private toolHintFor(): string {
    const p = this.pending;
    const done = "Middle-click or Esc when done.";
    switch (this.tool) {
      case "select":
        return "Click to select, drag to move. Shift-click adds to the selection. Wheel zooms; middle-drag pans.";
      case "point": return `Click to place a point. ${done}`;
      case "spring":
      case "damper":
        return p ? `Click where the ${this.tool} ends. Hold Alt to switch snapping off.`
          : `Click where the ${this.tool} starts: a joint, a spot on a line, or anywhere. It stretches and turns with its two ends. ${done}`;
      case "spiral":
        return p ? "Click where the outer end of the spring goes: on the part it holds, or anywhere."
          : `Click the joint the spring is wound about. ${done}`;
      case "mass": return `Click where the centre of mass is: a joint, a spot on a curve, or anywhere. ${done}`;
      case "line":
      case "centerline":
      case "arrow":
        if (this.tool === "arrow") {
          return p ? "Click where the arrow points. Hold Alt to switch snapping off."
            : `Click where the arrow starts. It is constrained and dimensioned like a line. ${done}`;
        }
        return p ? "Click where the line ends. Hold Alt to switch snapping off."
          : `Click where the ${this.tool === "line" ? "line" : "centre line"} starts. ${done}`;
      case "trim": return `Click the part of a line, circle or arc to remove, up to where other curves cross it. Or hold the button and drag across everything that should go. ${done}`;
      case "project": return `Click a line, circle, arc or point of a sketch to the left of this one to bring it in as reference geometry, which follows it. ${done}`;
      case "beam":
        if (p?.tool !== "beam") return `Click where the beam starts: a joint, or anywhere. ${done}`;
        return p.b ? "Move away from the beam's middle line to set how wide it is, then click." : "Click where the beam ends. Hold Alt to switch snapping off.";
      case "arcbeam":
        if (p?.tool !== "arcbeam") return `Click the centre the beam bends round. ${done}`;
        if (!p.start) return "Click where the beam starts.";
        return p.end ? "Move towards or away from the centre to set how wide the beam is, then click." : "Sweep around the centre, then click where the beam ends.";
      case "mirror": return "Click the line to mirror the selection about. A helper line or a centre line does well. Esc cancels.";
      case "turn": return "Click the point the copies go around: a joint, a circle to use its centre, or anywhere. Esc cancels.";
      case "note": return `Click where the note should start, then type it. ${done}`;
      case "load": return `Click a joint, or a spot on a line, to put a force there. Its magnitude, in the side panel, sets its length. ${done}`;
      case "moment": return `Click a joint, or a spot on a line, to put a moment about it. Its magnitude sets its radius. ${done}`;
      case "lineload": return `Click a line, on the side the distributed load should be drawn. ${done}`;
      case "diagram": {
        const plot = this.diagramPlot();
        const param = !!plot?.curves.some((c) => c.param), fn = !!plot && this.hasFunctions(plot);
        if (param && !fn) return `Click the point that is to be the origin of the plot's curves: a joint, or anywhere. ${done}`;
        return `Click a line, an arc or a side of a beam to lay the plot along it, on the side positive values should go${param ? ", or a point to draw its parametric curves about" : ""}. ${done}`;
      }
      case "circle": return p ? "Click to set the radius." : `Click the centre. ${done}`;
      case "bezier": return p?.tool === "bezier" ? (p.b ? "Move the pointer to bend the curve, and click. Select it later to drag its control points." : "Click where the curve ends.") : `Click where the curve starts. ${done}`;
      case "arc":
      case "arcarrow":
      case "arcdamper": {
        const what = this.tool === "arc" ? "arc" : this.tool === "arcarrow" ? "arrow" : "damper";
        if (!p) return `Click the centre${this.tool === "arcarrow" ? " the arrow turns about" : this.tool === "arcdamper" ? " the damper is bent round: the joint it resists turning about" : ""}. ${done}`;
        return p.tool === "arc" && p.start ? `Sweep around the centre, then click where the ${what} ends.` : `Click where the ${what} starts.`;
      }
      case "pin":
      case "roller":
      case "wall":
        return `Click a joint to put a ${SUPPORT_NAMES[this.tool === "wall" ? "fixed" : this.tool].toLowerCase()} there. ${done}`;
      case "frame": return "Click where the coordinate axes should go. On a joint, they stay pinned to it.";
      case "centermark": return `Click a circle or arc to give it centre lines. ${done}`;
      case "balloon":
        return p ? "Click where the balloon should sit. Clicking the same spot again leaves out the leader."
          : `Click what the balloon points at. ${done}`;
      case "fill": return `Click inside a closed shape to fill it. ${done}`;
      case "hatch": return `Click a line, arc or circle, on the side the hatching should go. ${done}`;
      case "datum": return `Click where the datum point goes: a joint, a spot on a curve, or anywhere. ${done}`;
      case "dimension":
        return this.canApply("dimension")
          ? "Middle-click, or click empty space, where the dimension should go. Its position picks aligned, horizontal or vertical."
          : `Dimension: click a line, two points, two lines, a point and a line, or a circle. ${done}`;
      case "measure":
        return this.canApply("measure")
          ? "Middle-click, or click empty space, where the measure should go. It shows the value and changes nothing."
          : `Measure: click a line, two points, two lines, a point and a line, or a circle. Only you see it: it is left out of the figure. ${done}`;
      case "etalon": return `Click where the etalon starts. Drag its far end to set how long it is, and give it its unit in the side panel. ${done}`;
      case "rightangle":
        return p?.tool === "rightangle" ? "Click the second line, on the side of the corner the mark goes in."
          : `Click the first of two lines that meet, on the side of the corner the mark goes in. ${done}`;
      case "fixed": return `Fix point: click a point to fix it, or a fixed one to release it. ${done}`;
      default: {
        const info = toolDef(this.tool);
        return `${info.label}: click ${info.need}. ${done}`;
      }
    }
  }

  private previewShapes(): Preview | null {
    if (this.tool === "trim") {
      if (this.drag?.kind === "trim") return { lines: [], circles: [], arcs: [], points: [], trail: this.drag.trail };
      const g = this.trimPlan?.gone;
      if (!g || this.drag) return null;
      return {
        lines: g.kind === "line" ? [[g.a, g.b]] : [], circles: [],
        arcs: g.kind === "round" ? [{ c: g.c, r: g.r, a0: g.a0, a1: g.a1 >= g.a0 + TWO_PI ? g.a0 + TWO_PI - 1e-4 : g.a1 }] : [],
        points: [], danger: true,
      };
    }
    const p = this.pending;
    if (!p || this.drag?.kind === "pan") return null;
    const snap = this.snapAt(this.cursor, this.snapAnchor());
    const pv: Preview = { lines: [], circles: [], arcs: [], points: [] };
    // The first line of a right angle shows as picked; there is nothing else to draw yet.
    if (p.tool === "rightangle") return null;
    if (p.tool === "balloon") {
      const raw = toModel(this.view, this.cursor);
      pv.lines.push([p.anchor.pos, raw]);
      pv.circles.push({ c: raw, r: PAPER.balloonRadius / this.mm() });
      return pv;
    }
    if (p.tool === "bezier") {
      if (!p.a.pointId) pv.points.push(p.a.pos);
      if (!p.b) {
        pv.lines.push([p.a.pos, snap.pos]);
        return pv;
      }
      if (!p.b.pointId) pv.points.push(p.b.pos);
      const q = this.bezierThrough(p.a.pos, p.b.pos, toModel(this.view, this.cursor));
      pv.beziers = [q];
      // The lines to the control points, as on a selected curve.
      pv.lines.push([q[0], q[1]], [q[3], q[2]]);
      return pv;
    }
    if (p.tool === "beam") {
      if (!p.a.pointId) pv.points.push(p.a.pos);
      if (!p.b) {
        pv.lines.push([p.a.pos, snap.pos]);
        return pv;
      }
      if (!p.b.pointId) pv.points.push(p.b.pos);
      const shape = this.beamShape(p.a.pos, p.b.pos, toModel(this.view, this.cursor));
      if (!shape) pv.lines.push([p.a.pos, p.b.pos]);
      else {
        const [a1, a2, b1, b2] = shape.corners;
        pv.lines.push([a2, b1], [b2, a1]);
        if (this.beamEnds === "square") pv.lines.push([a1, a2], [b1, b2]);
        else {
          const up = angleOf(shape.n);
          pv.arcs.push({ c: p.a.pos, r: shape.r, a0: up, a1: up + Math.PI }, { c: p.b.pos, r: shape.r, a0: up - Math.PI, a1: up });
        }
      }
      return pv;
    }
    if (p.tool === "arcbeam") {
      const C = p.center.pos;
      pv.points.push(C);
      if (!p.start) {
        pv.lines.push([C, snap.pos]);
        return pv;
      }
      if (!p.start.pointId) pv.points.push(p.start.pos);
      const R = dist(C, p.start.pos);
      const a0 = angleOf(sub(p.start.pos, C));
      const a1 = angleOf(sub((p.end ?? snap).pos, C));
      // Counter-clockwise from `from`, whichever way it was swept.
      const from = p.sweep >= 0 ? a0 : a1;
      const to = from + (wrap(p.sweep >= 0 ? a1 - a0 : a0 - a1) || TWO_PI);
      const shape = p.end ? this.arcBeamWidth(p, toModel(this.view, this.cursor)) : null;
      if (!shape) {
        pv.arcs.push({ c: C, r: R, a0: from, a1: to });
        if (p.end && !p.end.pointId) pv.points.push(p.end.pos);
        return pv;
      }
      const h = shape;
      pv.arcs.push({ c: C, r: R + h, a0: from, a1: to }, { c: C, r: R - h, a0: from, a1: to });
      const A = polar(C, R, from), B = polar(C, R, to);
      if (this.beamEnds === "square") pv.lines.push([polar(C, R - h, from), polar(C, R + h, from)], [polar(C, R - h, to), polar(C, R + h, to)]);
      else pv.arcs.push({ c: A, r: h, a0: from + Math.PI, a1: from + TWO_PI }, { c: B, r: h, a0: to, a1: to + Math.PI });
      pv.points.push(A, B);
      return pv;
    }
    if (p.tool === "line") {
      pv.lines.push([p.start.pos, snap.pos]);
      if (!p.start.pointId) pv.points.push(p.start.pos);
    } else if (p.tool === "circle") {
      pv.circles.push({ c: p.center.pos, r: dist(p.center.pos, snap.pos) });
      pv.points.push(p.center.pos);
    } else {
      pv.points.push(p.center.pos);
      if (!p.start) {
        pv.lines.push([p.center.pos, snap.pos]);
      } else {
        const r = dist(p.center.pos, p.start.pos);
        const a0 = angleOf(sub(p.start.pos, p.center.pos));
        const a1 = angleOf(sub(snap.pos, p.center.pos));
        if (p.sweep >= 0) pv.arcs.push({ c: p.center.pos, r, a0, a1: a0 + (wrap(a1 - a0) || TWO_PI) });
        else pv.arcs.push({ c: p.center.pos, r, a0: a1, a1: a1 + (wrap(a0 - a1) || TWO_PI) });
        pv.points.push(p.start.pos);
      }
    }
    return pv;
  }

  /** The dimension the Dimension tool would place at the pointer right now. */
  private dimensionPreview(mm: number): Prim[] {
    if (!isPlaced(this.tool) || this.editing || this.drag || !this.canApply(this.tool)) return [];
    const draft = this.dimensionDraft(toModel(this.view, this.cursor));
    if (typeof draft === "string") return [];
    return dimensionPrims(this.sk, { ...draft, id: PREVIEW_REF, ...(this.tool === "measure" ? { measure: true } : {}) } as Dimension, mm);
  }

  // ---- hit testing and snapping -----------------------------------------------

  /**
   * Everything under a screen position, best match first. With `geometryOnly`
   * only points and curves count, which is what constraint tools pick from.
   */
  private hitCandidates(sp: V, geometryOnly = false): (Hit & { rank: number; d: number })[] {
    const found = new Map<Id, Hit & { rank: number; d: number }>();
    const offer = (h: Hit, rank: number, d: number) => {
      const old = found.get(h.id);
      if (!old || rank < old.rank || (rank === old.rank && d < old.d)) found.set(h.id, { ...h, rank, d });
    };

    // A Bézier curve's control points can be picked while they show: while it, or one of them, is selected.
    const controls = controlPoints(this.sk);
    for (const p of points(this.sk)) {
      const bz = controls.get(p.id);
      if (bz && !this.selection.has(bz.id) && !this.selection.has(bz.c1) && !this.selection.has(bz.c2)) continue;
      const d = dist(toScreen(this.view, [p.x, p.y]), sp);
      if (d < POINT_TOL) offer({ id: p.id, kind: "point" }, 0, d);
    }
    if (!geometryOnly) {
      const half = GLYPH_SIZE / 2 + 1;
      for (const g of this.glyphs) {
        if (Math.abs(sp[0] - g.x) <= half && Math.abs(sp[1] - g.y) <= half) offer({ id: g.id, kind: "glyph" }, 1, 0);
      }
    }
    const mm = this.mm();
    const pxPerMm = this.view.scale / mm;
    const q = mul(toModel(this.view, sp), mm);
    for (const p of this.prims) {
      if (!p.ref) continue;
      if (geometryOnly && p.layer !== "geom") continue;
      if (p.k === "region") {
        // A fill is picked anywhere inside it, but only when nothing else is there.
        if (primDistance(p, q) === 0) offer({ id: p.ref, kind: "fill" }, 3, 0);
        continue;
      }
      // Measured in pixels. Text gets a head start so a dimension's label is easy to grab.
      const d = primDistance(p, q) * pxPerMm - (p.k === "text" ? CURVE_TOL * 0.5 : 0);
      if (d >= CURVE_TOL) continue;
      const kind = p.layer === "dim" ? "dim" : p.layer === "sym" ? "sym" : "curve";
      offer({ id: p.ref, kind, part: p.part, text: p.k === "text" }, 2, d);
    }
    return [...found.values()].sort((a, b) => a.rank - b.rank || a.d - b.d);
  }

  private hitTest(sp: V, geometryOnly = false): Hit | null {
    return this.hitCandidates(sp, geometryOnly)[0] ?? null;
  }

  /**
   * Picks for the Select tool. Clicking the same spot again steps through
   * things that lie on top of each other, such as two overlapping lines.
   */
  private pickAt(sp: V, time: number, cycle: boolean): Hit | null {
    const cands = this.hitCandidates(sp);
    let hit: Hit | null = cands[0] ?? null;
    if (hit) {
      const stack = cands.filter((c) => c.rank === cands[0].rank && c.d <= cands[0].d + 1.5);
      const last = this.lastPick;
      const sameSpot = last !== null && dist(sp, last.pos) < 4 && time - last.time > 350;
      if (cycle && sameSpot && stack.length > 1) {
        const i = stack.findIndex((c) => c.id === last.id);
        if (i >= 0) hit = stack[(i + 1) % stack.length];
      }
    }
    this.lastPick = hit ? { pos: sp, id: hit.id, time } : null;
    return hit;
  }

  /**
   * A right-click where several things lie on top of each other: selects the
   * next of them, the one on top first. False when there is no such stack
   * under the pointer, and the right-click cancels as it always does.
   */
  private cycleUnder(sp: V): boolean {
    if (this.tool !== "select" || this.pending || this.editing) return false;
    const stack = this.hitCandidates(sp);
    if (stack.length < 2) return false;
    const now = this.selection.size === 1 ? stack.findIndex((h) => this.selection.has(h.id)) : -1;
    const i = (now + 1) % stack.length;
    const next = stack[i];
    this.selection = new Set([next.id]);
    this.lastPick = { pos: sp, id: next.id, time: performance.now() };
    this.cycleNote = { pos: sp, text: `${i + 1} of ${stack.length} here: ${this.nameOf(next.id)}. Right-click again for the next.` };
    this.touch();
    return true;
  }

  /** What something in the sketch is, in a word or two, for the status bar. */
  private nameOf(id: Id): string {
    const e = entity(this.sk, id);
    if (e) {
      if (e.type === "point") return id === ORIGIN ? "the origin" : "a point";
      if (e.type === "circle") return "a circle";
      if (e.element) return e.element === "spiral" ? "a torsion spring" : `a ${e.type === "arc" ? "torsion " : ""}${e.element}`;
      if (e.arrow) return e.type === "arc" ? "a curved arrow" : "an arrow";
      return e.construction ? `a construction ${e.type}` : e.centre ? "a centre line" : e.type === "arc" ? "an arc" : "a line";
    }
    const c = constraint(this.sk, id);
    if (c) return isDimension(c) && c.measure ? "a measure" : isDimension(c) ? "a dimension" : `a ${RELATION_NAMES[c.type]?.toLowerCase() ?? "constraint"} constraint`;
    const sym = symbol(this.sk, id);
    const names: Partial<Record<Sym["type"], string>> = {
      support: "a support", frame: "a pair of axes", centermark: "a centre mark", balloon: "a balloon", fill: "a fill", hatch: "hatching",
      datum: "a datum point", note: "a note", load: "a force", lineload: "a distributed load", moment: "a moment", diagram: "a diagram",
      trace: "a plot", etalon: "an etalon", rightangle: "a right-angle mark",
    };
    return sym ? names[sym.type] ?? "a symbol" : "something";
  }

  /** The point a drawing tool's next click is measured from, for H/V inference. */
  /**
   * A Bézier curve from a to b that bends through m, as a parabola would:
   * its control points are where the tangents at the ends meet the
   * pointer's pull. Dragging them afterwards gives any other shape.
   */
  private bezierThrough(a: V, b: V, m: V): [V, V, V, V] {
    const q = sub(mul(m, 2), mid(a, b));
    return [a, add(a, mul(sub(q, a), 2 / 3)), add(b, mul(sub(q, b), 2 / 3)), b];
  }

  private snapAnchor(): V | undefined {
    const p = this.pending;
    if (p?.tool === "line") return p.start.pos;
    if (p?.tool === "bezier" && !p.b) return p.a.pos;
    if (p?.tool === "beam" && !p.b) return p.a.pos;
    return undefined;
  }

  private snapAt(sp: V, anchor?: V): Snap {
    const raw = toModel(this.view, sp);
    if (this.altKey) return { pos: raw };

    let bestD = POINT_TOL;
    let hitPoint: Point | null = null;
    const controls = controlPoints(this.sk);
    for (const p of points(this.sk)) {
      // A Bézier curve's control points are its own: nothing else snaps to them.
      if (controls.has(p.id)) continue;
      const d = dist(toScreen(this.view, [p.x, p.y]), sp);
      if (d < bestD) { bestD = d; hitPoint = p; }
    }
    if (hitPoint) return { pos: [hitPoint.x, hitPoint.y], pointId: hitPoint.id };

    const tol = CURVE_TOL / this.view.scale;
    let bestCurve: Snap | null = null;
    let bestCurveD = tol;
    for (const e of curves(this.sk)) {
      if (e.type === "line") {
        const a = point(this.sk, e.p1), b = point(this.sk, e.p2);
        const A: V = [a.x, a.y], B: V = [b.x, b.y];
        const pr = projectOnSegment(raw, A, B);
        const d = dist(raw, pr.point);
        if (d >= bestCurveD) continue;
        const m = mid(A, B);
        const nearMid = dist(pr.point, m) * this.view.scale < 9;
        bestCurveD = d;
        bestCurve = nearMid ? { pos: m, curveId: e.id, midpoint: true } : { pos: pr.point, curveId: e.id };
      } else if (e.type !== "bezier") {
        // A point cannot be held on a Bézier curve, so nothing snaps onto one but at its ends.
        const c = point(this.sk, e.c);
        const C: V = [c.x, c.y];
        const r = e.type === "circle" ? e.r : arcRadius(this.sk, e);
        const ang = angleOf(sub(raw, C));
        if (e.type === "arc") {
          const s = point(this.sk, e.p1), t = point(this.sk, e.p2);
          if (!inSweep(ang, angleOf([s.x - c.x, s.y - c.y]), angleOf([t.x - c.x, t.y - c.y]))) continue;
        }
        const d = Math.abs(dist(raw, C) - r);
        if (d >= bestCurveD) continue;
        bestCurveD = d;
        bestCurve = { pos: polar(C, r, ang), curveId: e.id };
      }
    }
    if (bestCurve) return bestCurve;

    if (anchor) {
      const a = toScreen(this.view, anchor);
      const dx = Math.abs(sp[0] - a[0]), dy = Math.abs(sp[1] - a[1]);
      if (dy < 7 && dx > 14) return { pos: [raw[0], anchor[1]], axis: "h" };
      if (dx < 7 && dy > 14) return { pos: [anchor[0], raw[1]], axis: "v" };
    }
    return { pos: raw };
  }

  private markFor(s: Snap, anchor?: V): SnapMark | null {
    if (s.pointId) return { pos: s.pos, kind: "point" };
    if (s.curveId) return { pos: s.pos, kind: s.midpoint ? "mid" : "curve" };
    if (s.axis) return { pos: s.pos, kind: s.axis, from: anchor };
    return null;
  }

  // ---- drawing tools ------------------------------------------------------------

  /** Turns a snap into a real point, creating it if the click was on empty space. */
  private materialize(s: Snap, autos: ConstraintDraft[], standalone = false): Id {
    if (s.pointId) return s.pointId;
    const p = addPoint(this.sk, s.pos[0], s.pos[1], standalone);
    if (s.curveId) {
      autos.push(s.midpoint ? { type: "midpoint", p: p.id, l: s.curveId } : { type: "pointOn", p: p.id, on: s.curveId });
    }
    return p.id;
  }

  /**
   * Adds the constraints a drawing tool inferred, keeping each one only if the
   * sketch still solves cleanly with it, then records the edit.
   */
  private finishDrawing(autos: ConstraintDraft[]): void {
    this.settle(autos);
    this.commit();
  }

  /** Adds each of the constraints that fits, and solves. The edit is not recorded yet. */
  private settle(autos: ConstraintDraft[]): void {
    const baseline = this.solver.solve(this.sk);
    for (const a of autos) {
      const c = addConstraint(this.sk, a);
      const r = this.solver.solve(this.sk);
      if (!r.ok || r.conflicting.length > baseline.conflicting.length || r.redundant.length > baseline.redundant.length) {
        this.sk.constraints = this.sk.constraints.filter((x) => x !== c);
      }
    }
    this.solve();
  }

  private toolClick(sp: V): void {
    const snap = this.snapAt(sp, this.snapAnchor());
    const autos: ConstraintDraft[] = [];
    const p = this.pending;

    if (this.tool === "point") {
      if (snap.pointId) return;
      this.materialize(snap, autos, true);
      this.finishDrawing(autos);
      return;
    }

    if (isLineTool(this.tool)) {
      if (!p || p.tool !== "line") {
        this.pending = { tool: "line", start: snap };
        return;
      }
      const s = p.start;
      const samePoint = snap.pointId !== undefined && snap.pointId === s.pointId;
      if (samePoint || dist(toScreen(this.view, s.pos), toScreen(this.view, snap.pos)) < 3) return; // no length yet
      const a = this.materialize(s, autos);
      const b = this.materialize(snap, autos);
      const line = addLine(this.sk, a, b);
      if (this.tool === "centerline") line.centre = true;
      // While Construction is on, what is drawn is a construction line, a centre line included.
      if (this.constructing && (this.tool === "line" || this.tool === "centerline")) {
        delete line.centre;
        line.construction = true;
      }
      if (this.tool === "arrow") {
        line.arrow = "end";
        this.selection = new Set([line.id]);
      }
      if (this.tool === "spring" || this.tool === "damper" || this.tool === "spiral") {
        line.element = this.tool;
        line.look = this.newLook(line);
        this.selection = new Set([line.id]);
      }
      let axis = snap.axis;
      if (!axis && snap.pointId) {
        // Ending on an existing joint, such as when closing a rectangle: still
        // take the hint if the line came out level or upright.
        const from = toScreen(this.view, s.pos), to = toScreen(this.view, snap.pos);
        const dx = Math.abs(to[0] - from[0]), dy = Math.abs(to[1] - from[1]);
        if (dy < 7 && dx > 14) axis = "h";
        else if (dx < 7 && dy > 14) axis = "v";
      }
      if (axis) autos.push({ type: axis === "h" ? "horizontal" : "vertical", a, b });
      // One line per pair of clicks: the next click starts a new one.
      this.pending = null;
      this.finishDrawing(autos);
      // The name of an arrow, a spring or a damper is typed right away, where it will sit; clicking on leaves it without one.
      if (isNamed(line)) this.openEditor({ kind: "arrow", id: line.id });
      return;
    }

    if (this.tool === "beam") {
      if (!p || p.tool !== "beam") {
        this.pending = { tool: "beam", a: snap };
        return;
      }
      if (!p.b) {
        const same = snap.pointId !== undefined && snap.pointId === p.a.pointId;
        if (same || dist(toScreen(this.view, p.a.pos), toScreen(this.view, snap.pos)) < 3) return; // no length yet
        p.b = snap;
        return;
      }
      return this.makeBeam(p.a, p.b, toModel(this.view, sp));
    }

    if (this.tool === "arcbeam") {
      if (!p || p.tool !== "arcbeam") {
        this.pending = { tool: "arcbeam", center: snap, sweep: 0, lastAng: 0 };
        return;
      }
      if (!p.start) {
        if (dist(p.center.pos, snap.pos) * this.view.scale < 3) return;
        p.start = snap;
        p.lastAng = angleOf(sub(snap.pos, p.center.pos));
        p.sweep = 0;
        return;
      }
      if (!p.end) {
        const R = dist(p.center.pos, p.start.pos);
        if (Math.abs(p.sweep) * R * this.view.scale < 3) return; // no length yet
        const joint = snap.pointId !== undefined && snap.pointId !== p.start.pointId && snap.pointId !== p.center.pointId;
        // Anywhere but on a joint, the end lands on the arc the pointer swept.
        p.end = joint ? snap : { pos: polar(p.center.pos, R, angleOf(sub(snap.pos, p.center.pos))) };
        return;
      }
      return this.makeArcBeam(p, toModel(this.view, sp));
    }

    if (this.tool === "bezier") {
      if (!p || p.tool !== "bezier") {
        this.pending = { tool: "bezier", a: snap };
        return;
      }
      if (!p.b) {
        const same = snap.pointId !== undefined && snap.pointId === p.a.pointId;
        if (same || dist(toScreen(this.view, p.a.pos), toScreen(this.view, snap.pos)) < 3) return; // no length yet
        p.b = snap;
        return;
      }
      const [, c1, c2] = this.bezierThrough(p.a.pos, p.b.pos, toModel(this.view, sp));
      const a = this.materialize(p.a, autos), b = this.materialize(p.b, autos);
      const k1 = addPoint(this.sk, c1[0], c1[1]).id, k2 = addPoint(this.sk, c2[0], c2[1]).id;
      const curve = addBezier(this.sk, a, k1, k2, b);
      if (this.constructing) curve.construction = true;
      this.pending = null;
      this.finishDrawing(autos);
      this.selection = new Set([curve.id]);
      return;
    }

    if (this.tool === "circle") {
      if (!p || p.tool !== "circle") {
        this.pending = { tool: "circle", center: snap };
        return;
      }
      const r = dist(p.center.pos, snap.pos);
      if (r * this.view.scale < 3) return;
      const c = this.materialize(p.center, autos);
      const circle = addCircle(this.sk, c, r);
      if (this.constructing) circle.construction = true;
      if (snap.pointId && snap.pointId !== c) autos.push({ type: "pointOn", p: snap.pointId, on: circle.id });
      this.pending = null;
      this.finishDrawing(autos);
      return;
    }

    if (isArcTool(this.tool)) {
      if (!p || p.tool !== "arc") {
        this.pending = { tool: "arc", center: snap, sweep: 0, lastAng: 0 };
        return;
      }
      if (!p.start) {
        if (dist(p.center.pos, snap.pos) * this.view.scale < 3) return;
        p.start = snap;
        p.lastAng = angleOf(sub(snap.pos, p.center.pos));
        p.sweep = 0;
        return;
      }
      const r = dist(p.center.pos, p.start.pos);
      const endAng = angleOf(sub(snap.pos, p.center.pos));
      const c = this.materialize(p.center, autos);
      const s = this.materialize(p.start, autos);
      let e: Id;
      if (snap.pointId && snap.pointId !== s && snap.pointId !== c) e = snap.pointId;
      else {
        const q = polar(p.center.pos, r, endAng);
        e = addPoint(this.sk, q[0], q[1]).id;
      }
      // Arcs are kept counter-clockwise, so one swept clockwise has its ends swapped.
      const arc = p.sweep >= 0 ? addArc(this.sk, c, s, e) : addArc(this.sk, c, e, s);
      if (this.constructing && this.tool === "arc") arc.construction = true;
      if (this.tool === "arcarrow") {
        // The head goes on the end that was clicked last.
        arc.arrow = p.sweep >= 0 ? "end" : "start";
        this.selection = new Set([arc.id]);
      }
      if (this.tool === "arcdamper") {
        arc.element = "damper";
        // The rod leaves from where the sweep began, the cylinder is where it ended.
        arc.look = { ...this.newLook(arc), ...(p.sweep < 0 ? { flip: true } : {}) };
        this.selection = new Set([arc.id]);
      }
      this.pending = null;
      this.finishDrawing(autos);
      if (isNamed(arc)) this.openEditor({ kind: "arrow", id: arc.id });
    }
  }

  private setTool(t: Tool): void {
    if (t === "project" && this.drawing.parts[0].info.id === this.drawing.active) {
      this.showTip("project");
      return this.toast(this.drawing.parts.length > 1
        ? "Project takes geometry from the sketches to the left of this one, and this is the first."
        : "Project takes geometry from another sketch. Add one with + Sketch in the strip at the bottom, and project from this one into it.");
    }
    if (isCopyTool(t) && !this.copyReady(toolDef(t).label)) {
      // Not picked up, but asked for: this is when its tip is wanted.
      return this.showTip(t);
    }
    // A tip about the tool in hand goes with the tool.
    if (this.tip?.withTool) this.closeTip();
    if (t !== "select") this.showTip(t, true);
    this.tool = t;
    const home = toolDef(t).tab;
    if (home !== "both") this.tab = home;
    this.pending = null;
    this.snapMark = null;
    this.trimPlan = null;
    // A copy tool works on what is selected, so the selection stays.
    if (t !== "select" && !isCopyTool(t)) this.selection.clear();
    if (t !== "select") this.hover = null;
    this.closeEditor();
    this.touch();
  }

  // ---- beams ---------------------------------------------------------------------

  /**
   * A beam around the centres a and b, as wide as the pointer at q is far from
   * its middle line. Corners in order: left and right of a, then right and left
   * of b, seen from a towards b. Null while it has no width to speak of.
   */
  private beamShape(a: V, b: V, q: V): { r: number; n: V; corners: [V, V, V, V] } | null {
    if (dist(a, b) < 1e-12) return null;
    const u = norm(sub(b, a)), n = perp(u);
    const r = Math.abs(dot(sub(q, a), n));
    if (r * this.view.scale < 3) return null;
    const off = mul(n, r);
    return { r, n, corners: [add(a, off), sub(a, off), sub(b, off), add(b, off)] };
  }

  /**
   * Draws a beam: two lines either side of the centres, closed by half-circles
   * about them or by square ends. It is ordinary geometry, held in shape by
   * ordinary constraints, so it is dimensioned, filled and trimmed like the rest.
   */
  private makeBeam(sa: Snap, sb: Snap, q: V): void {
    const shape = this.beamShape(sa.pos, sb.pos, q);
    if (!shape) return; // no width yet
    const autos: ConstraintDraft[] = [];
    const square = this.beamEnds === "square";
    // With square ends no curve is built on the centres, so they are kept as points of their own.
    const a = this.materialize(sa, autos, square), b = this.materialize(sb, autos, square);
    if (sb.axis) autos.push({ type: sb.axis === "h" ? "horizontal" : "vertical", a, b });
    autos.push(...straightBeam(this.sk, a, b, shape.r, this.beamEnds).autos);
    this.pending = null;
    this.finishDrawing(autos);
  }

  /** Half the width of the curved beam being drawn, with the pointer at q: how far q is from its middle arc. Null while that is next to nothing. */
  private arcBeamWidth(p: Extract<Pending, { tool: "arcbeam" }>, q: V): number | null {
    if (!p.start) return null;
    const R = dist(p.center.pos, p.start.pos);
    const h = Math.min(Math.abs(dist(q, p.center.pos) - R), 0.95 * R);
    return h * this.view.scale < 3 ? null : h;
  }

  /**
   * Draws a beam bent round a centre: two arcs about it, closed by half-circles
   * or by square ends. Ordinary geometry again, held by ordinary constraints.
   */
  private makeArcBeam(p: Extract<Pending, { tool: "arcbeam" }>, q: V): void {
    const h = this.arcBeamWidth(p, q);
    if (!p.start || !p.end || h === null) return; // no width yet
    const autos: ConstraintDraft[] = [];
    const square = this.beamEnds === "square";
    const o = this.materialize(p.center, autos);
    const s = this.materialize(p.start, autos, square), e = this.materialize(p.end, autos, square);
    // Arcs are kept counter-clockwise, so a beam swept clockwise has its ends swapped.
    const [a, b] = p.sweep >= 0 ? [s, e] : [e, s];
    autos.push(...curvedBeam(this.sk, o, a, b, h, this.beamEnds).autos);
    this.pending = null;
    this.finishDrawing(autos);
  }

  // ---- mirror and patterns ---------------------------------------------------------

  /** True when there is geometry selected to copy; says what to do when there is not. */
  private copyReady(what: string): boolean {
    if (this.tool === "select" && this.picked().entities > 0 && !(this.selection.size === 1 && this.selection.has(ORIGIN))) return true;
    this.toast(`${what}: select what to copy first, then press this.`);
    if (this.tool !== "select") this.setTool("select");
    return false;
  }

  /**
   * Makes copies with `build` and keeps them if the sketch still solves.
   * `build` may add constraints worth having to `autos`; each is kept only if
   * it fits. The copies end up selected.
   */
  private applyCopy(build: (autos: ConstraintDraft[]) => CopyResult | string): void {
    const before = clone(this.sk);
    const baseline = this.result;
    const autos: ConstraintDraft[] = [];
    const made = build(autos);
    const r = typeof made === "string" ? null : this.solver.solve(this.sk);
    if (!r || !r.ok || r.conflicting.length > baseline.conflicting.length) {
      this.sk = before;
      this.solve();
      this.toast(typeof made === "string" ? made : "The copies could not be tied to the original as the sketch is constrained now.");
      return this.touch();
    }
    this.setTool("select");
    this.selection = new Set((made as CopyResult).made);
    this.finishDrawing(autos);
    this.keepInView();
    // The keyboard goes back to the drawing, not to the button a dialog was opened from.
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  }

  /** A click with a copy tool: the line to mirror about, or the point to go around. */
  private copyClick(sp: V): void {
    const picked = [...this.selection];
    if (this.tool === "mirror") {
      const hit = this.hitTest(sp, true);
      const e = hit ? entity(this.sk, hit.id) : undefined;
      if (e?.type !== "line") return this.toast("Click a line to mirror about.");
      return this.applyCopy((autos) => {
        const made = mirrorCopy(this.sk, picked, e.id);
        // A point the image shares with the original has to stay on the line for the two to match.
        if (typeof made !== "string") for (const p of made.shared) autos.push({ type: "pointOn", p, on: e.id });
        return made;
      });
    }
    const snap = this.snapAt(sp);
    const on = snap.curveId ? entity(this.sk, snap.curveId) : undefined;
    // A circle or arc stands for its centre.
    const centre: Snap = on && (on.type === "circle" || on.type === "arc")
      ? { pos: [point(this.sk, on.c).x, point(this.sk, on.c).y], pointId: on.c } : snap;
    void this.askPattern("turn").then((want) => {
      if (!want || this.tool !== "turn") return;
      this.applyCopy((autos) => circularCopy(this.sk, picked, this.materialize(centre, autos, true), want.count, want.angle));
    });
  }

  /** Repeats the selection in a row, after asking how many copies and which way. */
  private async linearPattern(): Promise<void> {
    this.showTip("shift");
    if (!this.copyReady(toolDef("shift").label)) return;
    const picked = [...this.selection];
    const want = await this.askPattern("shift");
    if (!want) return;
    // A first spacing that keeps the copies clear of each other; from then on it is dragged or dimensioned.
    const b = geometryBox({ entities: this.copyExtent(picked) });
    const w = boxIsEmpty(b) ? 0 : b.x1 - b.x0, h = boxIsEmpty(b) ? 0 : b.y1 - b.y0;
    const gap = Math.max(0.25 * Math.max(w, h), 36 / this.view.scale);
    const step: V = want.direction === "vertical" ? [0, h + gap] : [w + gap, 0];
    this.applyCopy((autos) => {
      const made = linearCopy(this.sk, picked, want.count, step);
      if (typeof made === "string" || want.direction === "free") return made;
      const link = constraint(this.sk, made.link);
      // Level or upright between a point and its first copy keeps the whole row that way.
      const first = link && isLink(link) ? link.pairs.find((p) => (p[2] ?? 1) === 1) : undefined;
      if (first) autos.push({ type: want.direction, a: first[0], b: first[1] });
      return made;
    });
  }

  /** The picked curves and points, with the points the curves are built on, for measuring how much room they take. */
  private copyExtent(picked: Id[]): Sketch["entities"] {
    const ids = new Set<Id>();
    for (const id of picked) {
      const e = entity(this.sk, id);
      if (!e) continue;
      ids.add(id);
      if (e.type !== "point") curvePoints(e).forEach((p) => ids.add(p));
    }
    return this.sk.entities.filter((e) => ids.has(e.id));
  }

  /** Asks how a pattern should be laid out. Resolves to null when the dialog is cancelled. */
  private askPattern(kind: "shift"): Promise<{ count: number; direction: "horizontal" | "vertical" | "free" } | null>;
  private askPattern(kind: "turn"): Promise<{ count: number; angle: number } | null>;
  private askPattern(kind: "shift" | "turn"): Promise<{ count: number; direction?: string; angle?: number } | null> {
    const dialog = $<HTMLDialogElement>("#pattern-dialog");
    const count = $<HTMLInputElement>("#pattern-count"), angle = $<HTMLInputElement>("#pattern-angle");
    const full = $<HTMLInputElement>("#pattern-full");
    $("#pattern-title").textContent = toolDef(kind).label;
    $("#pattern-row").hidden = kind !== "shift";
    $("#pattern-ring").hidden = kind !== "turn";
    this.syncPatternDialog();
    return new Promise((resolve) => {
      dialog.addEventListener("close", () => {
        if (dialog.returnValue !== "ok") return resolve(null);
        const n = Math.max(2, Math.min(PATTERN_MAX, Math.round(parseNumber(count.value)) || 2));
        if (kind === "shift") {
          const pressed = dialog.querySelector<HTMLElement>('[data-dir][aria-pressed="true"]')?.dataset.dir;
          return resolve({ count: n, direction: pressed ?? "horizontal" });
        }
        let deg = full.checked ? 360 / n : parseNumber(angle.value);
        if (!Number.isFinite(deg) || Math.abs(deg) < 1e-6 || Math.abs(deg) > 360) deg = 360 / n;
        resolve({ count: n, angle: deg * DEG });
      }, { once: true });
      dialog.returnValue = "";
      dialog.showModal();
      count.select();
    });
  }

  /** Keeps the angle box of the pattern dialog in step with the count while the copies fill a full turn. */
  private syncPatternDialog(): void {
    const count = $<HTMLInputElement>("#pattern-count"), angle = $<HTMLInputElement>("#pattern-angle");
    const full = $<HTMLInputElement>("#pattern-full").checked;
    angle.disabled = full;
    const n = Math.round(parseNumber(count.value));
    if (full && n >= 2) angle.value = formatNumber(Number((360 / n).toFixed(3)));
  }

  // ---- sketches ------------------------------------------------------------------

  /** A curve of another sketch as an SVG path on screen. */
  private curvePath(sk: Sketch, e: Curve): string {
    const S = (q: V) => toScreen(this.view, q);
    const xy = (id: Id): V => { const p = point(sk, id); return [p.x, p.y]; };
    if (e.type === "line") {
      const a = S(xy(e.p1)), b = S(xy(e.p2));
      return `M${a[0].toFixed(1)} ${a[1].toFixed(1)}L${b[0].toFixed(1)} ${b[1].toFixed(1)}`;
    }
    if (e.type === "bezier") {
      const [a, b, c, d] = [e.p1, e.c1, e.c2, e.p2].map((id) => S(xy(id)).map((v) => v.toFixed(1)).join(" "));
      return `M${a}C${b} ${c} ${d}`;
    }
    const c = S(xy(e.c));
    if (e.type === "circle") {
      const r = (e.r * this.view.scale).toFixed(1);
      return `M${(c[0] - e.r * this.view.scale).toFixed(1)} ${c[1].toFixed(1)}a${r} ${r} 0 1 0 ${(2 * e.r * this.view.scale).toFixed(1)} 0a${r} ${r} 0 1 0 ${(-2 * e.r * this.view.scale).toFixed(1)} 0`;
    }
    const r = arcRadius(sk, e), { a0, a1 } = arcAngles(sk, e);
    const a = S(polar(xy(e.c), r, a0)), b = S(polar(xy(e.c), r, a1)), rs = (r * this.view.scale).toFixed(1);
    // Counter-clockwise in the drawing is clockwise on screen, where y points down.
    return `M${a[0].toFixed(1)} ${a[1].toFixed(1)}A${rs} ${rs} 0 ${a1 - a0 > Math.PI ? 1 : 0} 0 ${b[0].toFixed(1)} ${b[1].toFixed(1)}`;
  }

  /** The sketches not being worked on, as thin lines: no dimensions, constraints or symbols. Those the Project tool can take from light up under the pointer. */
  private otherSketches(): string {
    const parts = this.drawing.parts;
    const here = parts.findIndex((p) => p.info.id === this.drawing.active);
    let out = "";
    // Pictures first, under every line.
    parts.forEach((p, i) => {
      if (i === here || p.info.hidden) return;
      for (const s of p.sk.symbols) {
        if (s.type !== "picture") continue;
        const tl = toScreen(this.view, [s.x, s.y + s.h]);
        out += `<image class="picture" href="${imageUrl(s.src)}" x="${tl[0].toFixed(1)}" y="${tl[1].toFixed(1)}" width="${(s.w * this.view.scale).toFixed(1)}" height="${(s.h * this.view.scale).toFixed(1)}" opacity="${s.opacity ?? PICTURE_OPACITY}" preserveAspectRatio="none"/>`;
      }
    });
    parts.forEach((p, i) => {
      if (i === here || p.info.hidden) return;
      const pickable = this.tool === "project" && i < here;
      for (const e of p.sk.entities) {
        if (e.type === "point" || e.construction) continue;
        out += `<path class="other${pickable ? " pickable" : ""}${this.projectHover === e.id ? " hov" : ""}" d="${this.curvePath(p.sk, e)}"/>`;
      }
      if (!pickable) return;
      for (const q of this.projectablePoints(p.sk)) {
        const at = toScreen(this.view, [q.x, q.y]);
        out += `<circle class="other-pt${this.projectHover === q.id ? " hov" : ""}" cx="${at[0].toFixed(1)}" cy="${at[1].toFixed(1)}" r="${this.projectHover === q.id ? 4.2 : 2.6}"/>`;
      }
    });
    return out;
  }

  /** The points of another sketch that can be projected: the ends and centres of what is drawn, and points placed on their own. */
  private projectablePoints(sk: Sketch): Point[] {
    const ids = new Set<Id>();
    for (const e of sk.entities) {
      if (e.type === "point") { if (e.standalone && e.id !== ORIGIN) ids.add(e.id); continue; }
      if (!e.construction) curvePoints(e).forEach((id) => ids.add(id));
    }
    ids.delete(ORIGIN);
    return sk.entities.filter((e): e is Point => e.type === "point" && ids.has(e.id));
  }

  /** The geometry of another sketch on show under a screen position, points first. */
  private otherAt(sp: V): { part: Part; entity: Entity } | null {
    let best: { part: Part; entity: Entity; d: number; rank: number } | null = null;
    const offer = (part: Part, entity: Entity, d: number, rank: number) => {
      if (!best || rank < best.rank || (rank === best.rank && d < best.d)) best = { part, entity, d, rank };
    };
    for (const part of this.otherParts()) {
      if (part.info.hidden) continue;
      const sk = part.sk;
      const S = (id: Id): V => { const p = point(sk, id); return toScreen(this.view, [p.x, p.y]); };
      for (const q of this.projectablePoints(sk)) {
        const d = dist(S(q.id), sp);
        if (d < POINT_TOL) offer(part, q, d, 0);
      }
      for (const e of sk.entities) {
        if (e.type === "point" || e.construction) continue;
        let d: number;
        if (e.type === "line") d = distToSegment(sp, S(e.p1), S(e.p2));
        else if (e.type === "bezier") d = bezierNearest(bezierOf(sk, e), toModel(this.view, sp)).d * this.view.scale;
        else {
          const c = S(e.c), r = (e.type === "circle" ? e.r : arcRadius(sk, e)) * this.view.scale;
          d = Math.abs(dist(sp, c) - r);
          if (e.type === "arc") {
            // Off the arc's sweep, only its ends are near.
            const m = toModel(this.view, sp), centre = point(sk, e.c), { a0, a1 } = arcAngles(sk, e);
            if (!inSweep(angleOf([m[0] - centre.x, m[1] - centre.y]), a0, a1)) d = Infinity;
          }
        }
        if (d < 7) offer(part, e, d, 1);
      }
    }
    return best;
  }

  /**
   * The Project tool takes what is under the pointer in a sketch to the left
   * of this one and brings it in as reference geometry: fixed where its
   * source is, following it when that moves, in a colour of its own and left
   * out of the figure. Lines, circles and arcs come with their points, and a
   * point already brought in is used again, so projected edges stay joined.
   */
  private projectClick(sp: V): void {
    const hit = this.otherAt(sp);
    if (!hit) return;
    const parts = this.drawing.parts;
    if (parts.indexOf(hit.part) > parts.findIndex((p) => p.info.id === this.drawing.active)) {
      return this.toast("Only sketches to the left of this one can be projected from, so a sketch never ends up depending on itself.");
    }
    const sk = this.sk, from = hit.part.sk, src = hit.entity;
    if (sk.entities.some((e) => e.ref === src.id)) return this.toast("That is in this sketch already.");
    const pointFor = (id: Id): Id => {
      const had = sk.entities.find((e) => e.type === "point" && e.ref === id);
      if (had) return had.id;
      const q = point(from, id);
      const p = addPoint(sk, q.x, q.y);
      p.ref = id;
      return p.id;
    };
    if (src.type === "point") {
      const p = point(sk, pointFor(src.id));
      p.standalone = true;
    } else {
      const made = src.type === "line" ? addLine(sk, pointFor(src.p1), pointFor(src.p2))
        : src.type === "circle" ? addCircle(sk, pointFor(src.c), src.r)
        : src.type === "bezier" ? addBezier(sk, pointFor(src.p1), pointFor(src.c1), pointFor(src.c2), pointFor(src.p2))
        : addArc(sk, pointFor(src.c), pointFor(src.p1), pointFor(src.p2));
      made.construction = true;
      made.ref = src.id;
    }
    this.projectHover = null;
    this.solve();
    this.commit();
  }

  /** The name of the sketch an entity was projected from, if it is still there. */
  private sourceName(ref: Id): string | null {
    const part = this.otherParts().find((p) => p.sk.entities.some((e) => e.id === ref));
    return part ? part.info.name : null;
  }

  /** Turns projected geometry into geometry of this sketch's own, which no longer follows its source. */
  private breakLinks(ids: Id[]): void {
    for (const id of ids) {
      const e = entity(this.sk, id);
      if (!e?.ref) continue;
      delete e.ref;
      if (e.type !== "point") for (const p of curvePoints(e)) {
        const q = entity(this.sk, p);
        // An end shared with another projection keeps following its source.
        if (q?.ref && !this.sk.entities.some((x) => x !== e && x.type !== "point" && x.ref && curvePoints(x).includes(p))) delete q.ref;
      }
    }
    this.solve();
    this.commit();
  }

  /** The strip at the bottom: one tab for each sketch, and one to add another. */
  private drawStrip(): void {
    const strip = $("#sheets");
    const one = this.drawing.parts.length === 1;
    strip.innerHTML = this.drawing.parts.map((p) => {
      const on = p.info.id === this.drawing.active;
      return `<div class="sheet${on ? " on" : ""}${p.info.hidden && !on ? " gone" : ""}${p.info.out ? " out" : ""}" data-part="${p.info.id}">` +
        `<button type="button" class="sheet-name" role="tab" aria-selected="${on}" data-sheet="open" title="${on ? "Double-click to rename" : "Work on this sketch"}">${(on ? this.sk : p.sk).lineColor ? `<span class="sheet-dot" style="background:${(on ? this.sk : p.sk).lineColor}"></span>` : ""}${esc(p.info.name)}</button>` +
        `<button type="button" class="sheet-btn" data-sheet="hide" aria-pressed="${!!p.info.hidden}"${on ? " disabled" : ""} title="${on ? "The sketch being worked on is always shown" : p.info.hidden ? "Hidden while you work on another sketch: show it" : "Hide it while you work on another sketch"}">${icon(p.info.hidden && !on ? "eyeoff" : "eye", 15)}</button>` +
        `<button type="button" class="sheet-btn" data-sheet="out" aria-pressed="${!p.info.out}" title="${p.info.out ? "Left out of the exported figure: put it in" : "In the exported figure: leave it out"}">${icon(p.info.out ? "pageoff" : "page", 15)}</button>` +
        (on && !one ? `<button type="button" class="sheet-btn" data-sheet="delete" title="Delete this sketch">${icon("close", 13)}</button>` : "") +
        `</div>`;
    }).join("") +
      `<button type="button" class="sheet-add" data-sheet="add" title="A new sketch, after the others">${icon("plus", 14)}<span>Sketch</span></button>`;
  }

  /** Works on another sketch: this one goes to thin lines, that one comes up with everything in it. */
  private openSketch(id: Id): void {
    if (id === this.drawing.active) return;
    const next = this.drawing.parts.find((p) => p.info.id === id);
    if (!next) return;
    this.closeEditor();
    this.pending = null;
    this.drag = null;
    this.selection.clear();
    this.hover = null;
    this.projectHover = null;
    if (this.tool === "project" && this.drawing.parts.indexOf(next) === 0) this.setTool("select");
    activePart(this.drawing).sk = this.sk;
    shareSettings(this.sk, next.sk);
    this.drawing.active = id;
    this.sk = next.sk;
    delete next.info.hidden;
    if (followSources(this.sk, entityIndex(this.drawing, this.sk))) this.solve();
    this.solve();
    this.freedomStale = true;
    this.autosave();
    this.touch();
  }

  /** Starts a new sketch after the others, and works on it. */
  private addSketch(): void {
    this.makeSketch();
    this.commit();
    this.showTip("sketches");
  }

  /** Makes a new, empty sketch after the others and works on it. Named "Sketch n" unless it is given a name. */
  private makeSketch(name?: string): void {
    activePart(this.drawing).sk = this.sk;
    const taken = new Set(this.drawing.parts.map((p) => p.info.name));
    let n = this.drawing.parts.length + 1;
    while (taken.has(`Sketch ${n}`)) n++;
    const sk = { entities: [this.sk.entities.find((e) => e.id === ORIGIN)!], constraints: [], symbols: [] } as unknown as Sketch;
    shareSettings(this.sk, sk);
    const info = { id: newId(this.sk, "sketch"), name: name ?? `Sketch ${n}` };
    sk.nextId = this.sk.nextId;
    this.drawing.parts.push({ info, sk });
    this.openSketch(info.id);
  }

  /**
   * Brings in a picture to trace over, in a sketch of its own: it shows under
   * the other sketches while they are worked on, and is never part of the
   * figure. A very large picture is brought down to a size the browser keeps
   * comfortably.
   */
  private async importPicture(file: File): Promise<void> {
    const read = (f: Blob) => new Promise<string>((ok, fail) => {
      const r = new FileReader();
      r.onload = () => ok(String(r.result));
      r.onerror = () => fail(new Error("That picture could not be read."));
      r.readAsDataURL(f);
    });
    const load = (src: string) => new Promise<HTMLImageElement>((ok, fail) => {
      const img = new Image();
      img.onload = () => ok(img);
      img.onerror = () => fail(new Error("That picture could not be shown."));
      img.src = src;
    });
    let src = await read(file);
    let img = await load(src);
    const MAX = 2400;
    if (Math.max(img.naturalWidth, img.naturalHeight) > MAX) {
      const k = MAX / Math.max(img.naturalWidth, img.naturalHeight);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.naturalWidth * k);
      canvas.height = Math.round(img.naturalHeight * k);
      canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
      src = canvas.toDataURL(file.type === "image/png" ? "image/png" : "image/jpeg", 0.88);
      img = await load(src);
    }
    const name = file.name.replace(/\.[a-z0-9]+$/i, "");
    this.makeSketch(`Picture: ${name}`);
    // Most of the view wide, in the middle of it.
    const w = (this.view.w * 0.7) / this.view.scale, h = (w * img.naturalHeight) / Math.max(1, img.naturalWidth);
    const pic = addSymbol(this.sk, { type: "picture", src, name: file.name, x: this.view.cx - w / 2, y: this.view.cy - h / 2, w, h });
    this.setTool("select");
    this.selection = new Set([pic.id]);
    this.commit();
    this.showTip("picture");
  }

  /**
   * Brings in the lines, arcs, circles and curves of an SVG drawing, such as
   * one exported from a CAD program, as a sketch of their own: fixed where
   * they are, so they can be dimensioned (the dimensions are driven), filled
   * and hatched, and projected into other sketches.
   */
  private importDrawing(text: string, fileName: string): void {
    const d = importSvg(text);
    const count = d.lines.length + d.arcs.length + d.circles.length + d.beziers.length;
    const left = [...d.skipped].map(([what, n]) => `${n} ${what}`).join(", ");
    if (!count) return this.toast(`There are no drawn lines in that SVG to bring in${left ? `; left out: ${left}` : ""}.`);
    this.makeSketch(`Drawing: ${fileName.replace(/\.svg$/i, "")}`);
    const sk = this.sk;
    const ids = d.points.map(([x, y], i) => {
      const p = addPoint(sk, x, y, d.crossings.has(i));
      p.locked = true;
      return p.id;
    });
    const dress = (e: Curve, s: ImportStyle) => {
      if (s.color) e.color = s.color;
      if (s.weight !== undefined) e.weight = Math.max(0.1, Math.min(3, s.weight));
      if (s.centre) e.centre = true;
      else if (s.dashed) e.dashed = true;
    };
    for (const l of d.lines) dress(addLine(sk, ids[l.a], ids[l.b]), l.style);
    for (const a of d.arcs) dress(addArc(sk, ids[a.c], ids[a.p1], ids[a.p2]), a.style);
    for (const c of d.circles) {
      const circle = addCircle(sk, ids[c.c], c.r);
      circle.locked = true;
      dress(circle, c.style);
    }
    for (const b of d.beziers) dress(addBezier(sk, ids[b.p1], ids[b.c1], ids[b.c2], ids[b.p2]), b.style);
    this.setTool("select");
    this.solve();
    this.commit();
    this.fit();
    const made = [[d.lines.length, "line"], [d.arcs.length, "arc"], [d.circles.length, "circle"], [d.beziers.length, "curve"]]
      .filter(([n]) => n).map(([n, w]) => `${n} ${w}${n === 1 ? "" : "s"}`).join(", ");
    this.toast(`Brought in ${made}${left ? `. Left out: ${left}` : ""}.`);
    this.showTip("imported");
  }

  /** Pulls the top right corner of a picture: it grows or shrinks about its bottom left corner, keeping its shape. */
  private dragPictureCorner(id: Id, sp: V): void {
    const s = symbol(this.sk, id);
    if (s?.type !== "picture") return;
    const q = toModel(this.view, sp);
    const w = Math.max((q[0] - s.x + ((q[1] - s.y) * s.w) / s.h) / 2, 8 / this.view.scale);
    s.h = (s.h * w) / s.w;
    s.w = w;
  }

  /** Deletes the sketch being worked on. What later sketches projected from it stays where it was, as their own. */
  private deleteSketch(): void {
    const parts = this.drawing.parts;
    if (parts.length < 2) return;
    const i = parts.findIndex((p) => p.info.id === this.drawing.active);
    const gone = parts[i];
    const next = parts[i + 1] ?? parts[i - 1];
    this.openSketch(next.info.id);
    this.drawing.parts = parts.filter((p) => p !== gone);
    this.commit();
    this.toast(`${gone.info.name} is deleted. Undo brings it back.`);
  }

  /** Renames a sketch, in place on its tab. */
  private renameSketch(id: Id): void {
    const tab = $("#sheets").querySelector<HTMLElement>(`[data-part="${id}"] .sheet-name`);
    const part = this.drawing.parts.find((p) => p.info.id === id);
    if (!tab || !part) return;
    const box = document.createElement("input");
    box.className = "sheet-rename";
    box.value = part.info.name;
    box.setAttribute("aria-label", "Name of the sketch");
    tab.replaceWith(box);
    box.focus();
    box.select();
    let done = false;
    const finish = (keep: boolean) => {
      if (done) return;
      done = true;
      const name = box.value.trim();
      if (keep && name && name !== part.info.name) {
        part.info.name = name;
        this.commit();
      }
      this.drawStrip();
    };
    box.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") finish(true);
      else if (e.key === "Escape") finish(false);
    });
    box.addEventListener("blur", () => finish(true));
  }

  /** What a click on the strip asks for. */
  private onStrip(e: MouseEvent): void {
    const btn = (e.target as HTMLElement).closest<HTMLElement>("[data-sheet]");
    if (!btn) return;
    const id = btn.closest<HTMLElement>("[data-part]")?.dataset.part;
    const part = this.drawing.parts.find((p) => p.info.id === id);
    switch (btn.dataset.sheet) {
      case "add": return this.addSketch();
      case "open": return id ? this.openSketch(id) : undefined;
      case "delete": return this.deleteSketch();
      case "hide":
        if (!part || part.info.id === this.drawing.active) return;
        if (part.info.hidden) delete part.info.hidden;
        else part.info.hidden = true;
        this.projectHover = null;
        return this.commit();
      case "out":
        if (!part) return;
        if (part.info.out) delete part.info.out;
        else part.info.out = true;
        return this.commit();
    }
  }

  // ---- trim --------------------------------------------------------------------

  /** What a trim at this screen position would remove, if there is a curve there. */
  private trimAt(sp: V): TrimPlan | null {
    // The nearest curve, whatever joints are close by: a point under the pointer is not in the
    // way of the piece of line beside it.
    const hit = this.hitCandidates(sp, true).find((h) => h.kind === "curve");
    // Projected geometry is its source's: it is trimmed there, not here.
    if (!hit || entity(this.sk, hit.id)?.ref) return null;
    return planTrim(this.sk, hit.id, toModel(this.view, sp));
  }

  /** Carries out a trim and settles the sketch. It is recorded when the button is let go. */
  private trimNow(plan: TrimPlan): void {
    const autos = applyTrim(this.sk, plan);
    this.pruneSelection();
    this.settle(autos);
    this.freedomStale = true;
    this.chromeDirty = true;
  }

  /** The button goes down with the Trim tool: the piece under the pointer goes, and a stroke begins. */
  private trimPress(sp: V): void {
    const plan = this.trimAt(sp);
    this.trimPlan = null;
    if (plan) this.trimNow(plan);
    this.drag = { kind: "trim", last: sp, cut: plan !== null, trail: [toModel(this.view, sp)] };
  }

  /** The pointer moves with the button held: every curve it has passed over since the last move is trimmed where it crossed. */
  private trimStroke(d: Extract<DragState, { kind: "trim" }>, sp: V): void {
    let from = toModel(this.view, d.last);
    const to = toModel(this.view, sp);
    // One at a time, nearest first: each trim changes what the rest of the stroke will meet.
    for (let guard = 0; guard < 60; guard++) {
      const next = strokeHits(this.sk, from, to).map((h) => ({ h, plan: planTrim(this.sk, h.id, h.at) })).find((x) => x.plan);
      if (!next?.plan) break;
      this.trimNow(next.plan);
      d.cut = true;
      from = next.h.at;
    }
    d.last = sp;
    d.trail.push(to);
  }

  // ---- symbols ----------------------------------------------------------------

  /** A fixed support turns to face the one member that ends in it. */
  private supportAngle(kind: SupportKind, at: Id): number {
    if (kind !== "fixed") return 0;
    const attached = curves(this.sk).filter((e): e is Line => e.type === "line" && (e.p1 === at || e.p2 === at));
    if (attached.length !== 1) return 0;
    const here = point(this.sk, at);
    const far = point(this.sk, attached[0].p1 === at ? attached[0].p2 : attached[0].p1);
    return Math.atan2(far.y - here.y, far.x - here.x) - Math.PI / 2;
  }

  /** The next free part number: one more than the largest number already on a balloon. */
  private nextBalloonNumber(): string {
    let max = 0;
    for (const s of this.sk.symbols) {
      if (s.type === "balloon" && /^\d+$/.test(s.text.trim())) max = Math.max(max, Number(s.text));
    }
    return String(max + 1);
  }

  /**
   * How a new spring or damper is drawn: like the first one of its kind in
   * the sketch, so they match, or at a size that suits the figure. It is
   * never wider than it is long.
   */
  private newLook(e: Line | Arc): ElementLook {
    const length = elementLength(this.sk, e);
    const like = curves(this.sk).find((c): c is Line | Arc => c !== e && c.type !== "circle" && c.element === e.element && !!c.look);
    // Sized for the figure as it prints, where it stands beside the supports and the arrowheads; a long one is a little wider.
    const look: ElementLook = like?.look ? { across: like.look.across, pitch: like.look.pitch } : defaultLook(Math.max(ELEMENT_ACROSS / this.printScale(), length / 14));
    if (like?.look?.coil) look.coil = true;
    if (length > 0) {
      const most = length * (e.element === "damper" ? 0.5 : 0.6);
      if (look.across > most) {
        look.pitch *= most / look.across;
        look.across = most;
      }
      // A spiral is as large as it was drawn: the first one has its windings spaced to give it three of them.
      if (e.element === "spiral" && !like) look.pitch = length / 3.25;
    }
    return look;
  }

  /** The datum mark on a point, if it has one. */
  private datumOn(pointId: Id): Datum | undefined {
    return this.sk.symbols.find((s): s is Datum => s.type === "datum" && s.at === pointId);
  }

  private symbolClick(sp: V): void {
    const tool = this.tool as SymbolTool;
    const raw = toModel(this.view, sp);

    if (tool === "frame") {
      const snap = this.snapAt(sp);
      // A handy length on screen to start with; from then on it belongs to the drawing.
      const size = this.preview ? 10 / this.printScale() : 56 / this.view.scale;
      const f = addFrame(this.sk, snap.pos[0], snap.pos[1], snap.pointId, size);
      this.commit();
      this.setTool("select");
      this.selection = new Set([f.id]);
      return;
    }

    if (tool === "etalon") {
      // As long as a round number, in the units the sketch is dimensioned in, that comes out at about 2 cm in print.
      const snap = this.snapAt(sp);
      const length = this.fromUnits(roundNumber((ETALON_MM / this.printScale()) * unitScale(this.sk)));
      const e = addSymbol(this.sk, { type: "etalon", x: snap.pos[0], y: snap.pos[1], angle: 0, length, label: "" });
      this.commit();
      this.setTool("select");
      this.selection = new Set([e.id]);
      return;
    }

    if (tool === "rightangle") {
      // Two lines, each clicked on the side of the corner the mark goes in.
      const hit = this.hitCandidates(sp, true).find((h) => entity(this.sk, h.id)?.type === "line");
      if (!hit) return this.toast("Click a line.");
      const p = this.pending;
      if (p?.tool !== "rightangle") {
        this.pending = { tool: "rightangle", l1: hit.id, at: raw };
        this.selection = new Set([hit.id]);
        return;
      }
      if (hit.id === p.l1) return;
      const ends = (id: Id): [V, V] => { const l = entity(this.sk, id) as Line; const a = point(this.sk, l.p1), b = point(this.sk, l.p2); return [[a.x, a.y], [b.x, b.y]]; };
      const [A1, B1] = ends(p.l1), [A2, B2] = ends(hit.id);
      const d1 = norm(sub(B1, A1)), d2 = norm(sub(B2, A2));
      const c = Math.abs(cross(d1, d2)) > 1e-6 ? intersectLines(A1, d1, A2, d2) : null;
      if (!c) return this.toast("Those lines are parallel: they make no corner to mark.");
      // Which way along each line from the corner: towards where it was clicked, or, clicked at the corner, towards its far end.
      const side = (at: V, d: V, A: V, B: V): 1 | -1 => {
        const t = dot(sub(at, c), d);
        if (Math.abs(t) * this.view.scale > 4) return t > 0 ? 1 : -1;
        return dist(c, B) >= dist(c, A) ? 1 : -1;
      };
      const mark = addSymbol(this.sk, { type: "rightangle", l1: p.l1, l2: hit.id, s1: side(p.at, d1, A1, B1), s2: side(raw, d2, A2, B2) });
      this.pending = null;
      this.commit();
      this.selection = new Set([mark.id]);
      return;
    }

    if (tool === "note") {
      // The note is typed where it was clicked; one left empty is not kept.
      const n = addSymbol(this.sk, { type: "note", x: raw[0], y: raw[1], text: "" });
      this.setTool("select");
      this.selection = new Set([n.id]);
      this.openEditor({ kind: "note", id: n.id });
      return;
    }

    if (tool === "balloon") {
      const p = this.pending;
      if (!p || p.tool !== "balloon") {
        this.pending = { tool: "balloon", anchor: this.snapAt(sp) };
        return;
      }
      const a = p.anchor;
      // Placed on the spot it points at, the balloon needs no leader.
      const onSpot = dist(toScreen(this.view, a.pos), sp) < 6;
      const offset = onSpot ? [0, 0] : sub(raw, a.pos);
      const b = addSymbol(this.sk, {
        type: "balloon", text: this.nextBalloonNumber(), x: a.pos[0], y: a.pos[1],
        dx: offset[0], dy: offset[1], end: a.curveId || a.pointId ? "arrow" : "dot",
        ...(a.pointId ? { at: a.pointId } : a.curveId ? { on: a.curveId, t: curveParam(this.sk, a.curveId, a.pos) } : {}),
      });
      this.pending = null;
      this.commit();
      this.selection = new Set([b.id]);
      return;
    }

    if (tool === "fill") {
      const region = regionAt(this.sk, raw);
      if (!region) {
        this.toast("Click inside a closed shape. Its lines must meet at shared points.");
        return;
      }
      const same = (f: Sym) => f.type === "fill" && (region.kind === "circle"
        ? f.circle === region.circle
        : !f.circle && f.points.length === region.face.points.length && region.face.points.every((id) => f.points.includes(id)));
      const existing = this.sk.symbols.find(same);
      const look = this.fillLook === "color" ? {} : { look: this.fillLook };
      if (existing && existing.type === "fill") {
        // Filling a filled shape fills it again, as the fill in hand does.
        existing.color = this.fillColor;
        if (this.fillLook === "color") delete existing.look;
        else existing.look = this.fillLook;
        this.selection = new Set([existing.id]);
        return this.commit();
      }
      const f = region.kind === "circle"
        ? addSymbol(this.sk, { type: "fill", color: this.fillColor, circle: region.circle, points: [], arcs: [], curves: [], holes: [], ...look })
        : addSymbol(this.sk, { type: "fill", color: this.fillColor, points: region.face.points, arcs: region.face.arcs, curves: region.face.curves, holes: region.holes, ...look });
      this.selection = new Set([f.id]);
      return this.commit();
    }

    if (tool === "datum" || tool === "mass") {
      const snap = this.snapAt(sp);
      const autos: ConstraintDraft[] = [];
      const at = this.materialize(snap, autos, true);
      const existing = this.sk.symbols.find((x): x is Datum => x.type === "datum" && x.at === at);
      if (existing) {
        this.selection = new Set([existing.id]);
        return this.toast(`That point is ${existing.mass ? "marked as a centre of mass" : "a datum point"} already.`);
      }
      const d = addSymbol(this.sk, tool === "mass"
        ? { type: "datum", at, color: MASS_COLOR, label: MASS_NAME, dx: MASS_LABEL_OFFSET[0], dy: MASS_LABEL_OFFSET[1], mass: true }
        : { type: "datum", at, color: this.datumColor, label: nextDatumName(this.sk), dx: DATUM_LABEL_OFFSET[0], dy: DATUM_LABEL_OFFSET[1] });
      this.finishDrawing(autos);
      this.selection = new Set([d.id]);
      return;
    }

    if (tool === "lineload") {
      // The click is beside the line, on the side the load goes, so it need not be right on it.
      let e: Line | undefined, nearest = 40 / this.view.scale;
      for (const c of curves(this.sk)) {
        if (c.type !== "line") continue;
        const a = point(this.sk, c.p1), b = point(this.sk, c.p2);
        const d = dist(raw, projectOnSegment(raw, [a.x, a.y], [b.x, b.y]).point);
        if (d < nearest) { nearest = d; e = c; }
      }
      if (!e) return this.toast("Click beside a line to put the distributed load on it.");
      const side = sideOfCurve(this.sk, e.id, raw) >= 0 ? 1 : -1;
      this.startLoadScale("line");
      // A handy spacing for the view as it is now; from then on the number of arrows is the load's own.
      const a = point(this.sk, e.p1), b = point(this.sk, e.p2);
      const count = Math.max(3, Math.min(LINE_ARROWS_MAX, Math.round((dist([a.x, a.y], [b.x, b.y]) * this.view.scale) / LINE_ARROW_GAP) + 1));
      const q = addSymbol(this.sk, { type: "lineload", on: e.id, t0: 0, t1: 1, q1: 1, q2: 1, side, count, label: this.loadName("lineload"), color: this.loadColor });
      this.selection = new Set([q.id]);
      return this.commit();
    }

    if (tool === "diagram") {
      const plot = this.diagramPlot();
      if (!plot) return this.toast("There is no plot to lay along a member yet. Make one on the Plot tab first.");
      // The curves of the plot given by a parameter go about a point, which is their origin: one clicked,
      // or, when the plot has nothing else to draw, one made where the click was.
      if (plot.curves.some((c) => c.param)) {
        const snap = this.snapAt(sp);
        if (snap.pointId || !this.hasFunctions(plot)) {
          const autos: ConstraintDraft[] = [];
          const at = this.materialize(snap, autos, true);
          // The furthest point of the curves comes out about 70 pixels from the origin; from then on the size is its own.
          const reach = traceReach(plot);
          const t = addSymbol(this.sk, { type: "trace", plot: plot.id, at, scale: reach > 0 ? 70 / this.view.scale / reach : 1 });
          this.finishDrawing(autos);
          this.selection = new Set([t.id]);
          return;
        }
      }
      // The nearest line or arc, clicked on or beside: the side of it says where positive values go.
      let on: Id | null = null, nearest = 40 / this.view.scale;
      for (const c of curves(this.sk)) {
        const b = c.type === "circle" ? null : baseline(this.sk, { on: c.id });
        if (!b) continue;
        const d = dist(raw, b.at(b.nearest(raw)));
        if (d < nearest) { nearest = d; on = c.id; }
      }
      if (!on) return this.toast("Click a line, an arc or a side of a beam to lay the plot along it.");
      // On a side of a beam it runs along the middle of the beam.
      const axis = beamAxis(this.sk, on);
      const base = baseline(this.sk, { on, ...(axis ? { axis } : {}) });
      if (!base) return;
      const t = base.nearest(raw);
      const side = dot(sub(raw, base.at(t)), base.left(t)) >= 0 ? 1 : -1;
      // Its largest value comes out a quarter as high as the member is long; from then on the height is the diagram's own.
      const peak = plotPeak(plot);
      const d = addSymbol(this.sk, { type: "diagram", plot: plot.id, on, ...(axis ? { axis } : {}), t0: 0, t1: 1, side, scale: peak > 0 ? (0.25 * base.length) / peak : 1 });
      this.selection = new Set([d.id]);
      return this.commit();
    }

    if (tool === "load" || tool === "moment") {
      const snap = this.snapAt(sp);
      if (!snap.pointId && !snap.curveId) return this.toast(`Click a joint, or a spot on a line, to put the ${tool === "load" ? "load" : "moment"} there.`);
      const autos: ConstraintDraft[] = [];
      const at = this.materialize(snap, autos, true);
      this.startLoadScale(tool === "load" ? "force" : "moment");
      const made = tool === "load"
        // Straight down onto the joint, as weight does.
        ? addSymbol(this.sk, { type: "load", at, angle: -Math.PI / 2, value: 1, label: this.loadName("load"), color: this.loadColor })
        : addSymbol(this.sk, { type: "moment", at, angle: -Math.PI / 4, value: 1, label: this.loadName("moment"), color: this.loadColor });
      this.finishDrawing(autos);
      this.selection = new Set([made.id]);
      return;
    }

    if (tool === "centermark" || tool === "hatch") {
      const hit = this.hitTest(sp, true);
      const e = hit ? entity(this.sk, hit.id) : undefined;
      if (tool === "centermark") {
        if (!e || (e.type !== "circle" && e.type !== "arc")) return this.toast("Click a circle or an arc.");
        if (this.sk.symbols.some((x) => x.type === "centermark" && x.on === e.id)) return this.toast("That one already has centre lines.");
        const c = addSymbol(this.sk, { type: "centermark", on: e.id, angle: 0 });
        this.selection = new Set([c.id]);
        return this.commit();
      }
      if (!e || e.type === "point") return this.toast("Click a line, an arc or a circle.");
      // The hatching goes on the side of the curve the click was on.
      const side = sideOfCurve(this.sk, e.id, raw) >= 0 ? 1 : -1;
      // Sized like a support's ground as the view is now; from then on it belongs to the drawing.
      const unit = this.mm();
      const h = addSymbol(this.sk, { type: "hatch", on: e.id, side, spacing: DEFAULT_HATCH.spacing / unit, depth: DEFAULT_HATCH.depth / unit });
      this.selection = new Set([h.id]);
      return this.commit();
    }

    // Supports
    const snap = this.snapAt(sp);
    if (!snap.pointId && !snap.curveId) {
      this.toast("Click a joint, or a spot on a line, to put the support there.");
      return;
    }
    const kind: SupportKind = tool === "wall" ? "fixed" : (tool as "pin" | "roller");
    const autos: ConstraintDraft[] = [];
    const at = this.materialize(snap, autos, true);
    // One support per joint: a new one replaces what was there.
    this.sk.symbols = this.sk.symbols.filter((s) => !(s.type === "support" && s.at === at));
    addSupport(this.sk, kind, at, this.supportAngle(kind, at));
    this.finishDrawing(autos);
  }

  /**
   * Gives a kind of load its scale if it has none: the first one, of magnitude
   * 1, comes out a handy size for the view as it is. From then on the scale
   * belongs to the sketch, and every load of the kind is drawn at it.
   */
  private startLoadScale(kind: LoadKind): void {
    if (this.sk.loadScale?.[kind]) return;
    const perPx = this.preview ? EDIT_PX_PER_MM / this.printScale() : 1 / this.view.scale;
    this.sk.loadScale = { ...this.sk.loadScale, [kind]: LOAD_START[kind] * perPx };
  }

  /** A name for a new load: F, then F_2, F_3 and so on (q and M likewise). */
  private loadName(type: AnyLoad["type"]): string {
    const base = LOAD_NAME[type];
    const used = new Set(this.sk.symbols.flatMap((s) => (isLoad(s) ? [s.label.trim()] : [])));
    if (!used.has(base)) return base;
    for (let n = 2; n < 200; n++) if (!used.has(`${base}_${n}`) && !used.has(`${base}_{${n}}`)) return n < 10 ? `${base}_${n}` : `${base}_{${n}}`;
    return base;
  }

  /** Where a drag of a symbol starts from: its position, or for a balloon its offset. */
  private symbolDragOrigin(s: Sym): V {
    // A plot about a point is turned by dragging it: how it was turned when the drag began.
    if (s.type === "trace") return [s.angle ?? 0, 0];
    return s.type === "balloon" || s.type === "datum" ? [s.dx, s.dy] : symbolPosition(this.sk, s);
  }

  /** Which end of a spread load's envelope is under a screen position, if either. */
  private lineLoadEndAt(s: Sym, sp: V): 0 | 1 | null {
    if (s.type !== "lineload") return null;
    const mm = this.mm();
    const f = lineLoadFrame(this.sk, s, mm);
    if (!f) return null;
    const near = (q: V) => dist(toScreen(this.view, [q[0] / mm, q[1] / mm]), sp) < 10;
    return near(f.e0) ? 0 : near(f.e1) ? 1 : null;
  }

  /** Whether a plot has a function of x with something typed: what a diagram lays along a member. */
  private hasFunctions(plot: Plot): boolean {
    return plot.curves.some((c) => !c.param && c.pieces.some((x) => x.expr.trim()));
  }

  /** The plot the Diagram tool is set to lay along a member. */
  private diagramPlot(): Plot | null {
    const plots = this.sk.plots ?? [];
    return plots.find((p) => p.id === this.diagramPlotId) ?? plots[0] ?? null;
  }

  /** Which handle of a diagram is under a screen position: an end of the stretch it covers, or its peak. */
  private diagramGripAt(s: Sym, sp: V): 0 | 1 | "peak" | null {
    if (s.type !== "diagram") return null;
    const shape = diagramShape(this.sk, s);
    if (!shape) return null;
    const near = (q: V) => dist(toScreen(this.view, q), sp) < 10;
    if (shape.peak && near(shape.peak.at)) return "peak";
    return near(shape.ends[0]) ? 0 : near(shape.ends[1]) ? 1 : null;
  }

  /** Pulls the peak of a diagram away from its member or towards it: that sets how high the diagram is, and across the member, which side it is on. */
  private dragHeight(d: Extract<DragState, { kind: "height" }>, sp: V): void {
    const s = symbol(this.sk, d.id);
    const shape = s?.type === "diagram" ? diagramShape(this.sk, s) : null;
    if (s?.type !== "diagram" || !shape?.peak) return;
    const { t, v } = shape.peak;
    const h = dot(sub(toModel(this.view, sp), shape.base.at(t)), shape.base.left(t));
    if (Math.abs(h) * this.view.scale < 3) return; // on the member itself it has no height to take
    s.scale = Math.abs(h / v);
    s.side = h * v >= 0 ? 1 : -1;
  }

  /** How a diagram's height is shown beside its slider: that of its largest value, in the drawing's units. */
  private diagramHeightLabel(s: Diagram): string {
    const peak = diagramShape(this.sk, s)?.peak;
    return peak ? this.inUnits(Math.abs(peak.v) * s.scale, 3) : "–";
  }

  /** Opens the plot of a diagram in the Plot workspace. */
  private editPlotOf(s: Sym | null): void {
    if (s?.type !== "diagram" && s?.type !== "trace") return;
    this.plots.show(s.plot);
    this.setTab("plot");
  }

  /** Pulls an end of a spread load along its line, so it covers more or less of it. */
  private dragSpan(d: Extract<DragState, { kind: "span" }>, sp: V): void {
    const s = symbol(this.sk, d.id);
    if (s?.type === "diagram") {
      // The same for a diagram: its end follows the pointer along the member.
      const base = baseline(this.sk, s);
      if (!base) return;
      let t = base.nearest(toModel(this.view, sp));
      if (!this.altKey) for (const stop of [0, 0.5, 1]) if (Math.abs(t - stop) * base.length * this.view.scale < 8) t = stop;
      const [t0, t1] = d.end === 0 ? [Math.min(t, s.t1 - 0.02), s.t1] : [s.t0, Math.max(t, s.t0 + 0.02)];
      // Its strokes stay as far apart as they were.
      if (s.strokes) s.strokes = Math.max(1, Math.min(DIAGRAM_STROKES_MAX, Math.round(((s.strokes + 1) * (t1 - t0)) / (s.t1 - s.t0)) - 1));
      s.t0 = t0;
      s.t1 = t1;
      return;
    }
    if (s?.type !== "lineload") return;
    const f = lineLoadFrame(this.sk, s, 1);
    if (!f) return;
    const m = toModel(this.view, sp);
    // Followed along the arrows, back to the line.
    const foot = intersectLines(m, f.body, f.a, sub(f.b, f.a)) ?? projectOnSegment(m, f.a, f.b).point;
    const span = sub(f.b, f.a);
    let t = Math.max(0, Math.min(1, dot(sub(foot, f.a), span) / dot(span, span)));
    // The ends and the middle of the line catch it, unless Alt is held.
    if (!this.altKey) for (const stop of [0, 0.5, 1]) if (Math.abs(t - stop) * Math.hypot(span[0], span[1]) * this.view.scale < 8) t = stop;
    if (d.end === 0) this.setSpan(s, Math.min(t, s.t1 - 0.02), s.t1);
    else this.setSpan(s, s.t0, Math.max(t, s.t0 + 0.02));
  }

  /** Changes how much of its line a spread load covers, keeping its arrows as far apart as they were. */
  private setSpan(s: Extract<Sym, { type: "lineload" }>, t0: number, t1: number): void {
    const gaps = ((s.count - 1) * (t1 - t0)) / (s.t1 - s.t0);
    s.count = Math.max(2, Math.min(LINE_ARROWS_MAX, Math.round(gaps) + 1));
    s.t0 = t0;
    s.t1 = t1;
  }

  private dragSymbol(d: Extract<DragState, { kind: "sym" }>, sp: V): void {
    const s = symbol(this.sk, d.id);
    if (!s) return;
    const m = toModel(this.view, sp);
    const mm = this.mm();
    const snapAngle = (a: number) => (this.altKey ? a : Math.round(a / (15 * DEG)) * 15 * DEG);

    if (isLoad(s) && d.part === "label") {
      // The name moves on its own; the load stays.
      const moved = mul(sub(m, d.startModel), mm);
      s.dx = d.origin[0] + moved[0];
      s.dy = d.origin[1] + moved[1];
    } else if (s.type === "load" || s.type === "moment") {
      const centre = symbolPosition(this.sk, s);
      if (dist(m, centre) * this.view.scale < 6) return;
      const dir = sub(m, centre);
      // The free end of a force follows the pointer, so a push acts the other way; a moment's arc starts at it.
      s.angle = snapAngle(angleOf(s.type === "load" && !s.pull ? mul(dir, -1) : dir));
    } else if (s.type === "lineload") {
      // Pulled across its line, it changes side.
      if (s.angle === undefined) s.side = sideOfCurve(this.sk, s.on, m) >= 0 ? 1 : -1;
    } else if (s.type === "trace") {
      // Turned about its point by as much as the pointer has gone round it.
      const centre = symbolPosition(this.sk, s);
      if (dist(m, centre) * this.view.scale < 6 || dist(d.startModel, centre) * this.view.scale < 6) return;
      const turned = angleOf(sub(m, centre)) - angleOf(sub(d.startModel, centre));
      const a = snapAngle(d.origin[0] + turned);
      const tidy = Math.abs(wrap(a + 1e-12) - 1e-12) < 1e-9 ? 0 : wrap(a);
      if (tidy) s.angle = tidy;
      else delete s.angle;
    } else if (s.type === "support" || s.type === "centermark") {
      const centre = symbolPosition(this.sk, s);
      if (dist(m, centre) * this.view.scale < 6) return;
      const dir = sub(m, centre);
      // A support's ground side follows the pointer; a centre mark's first line points at it.
      s.angle = snapAngle(s.type === "support" ? Math.atan2(dir[0], -dir[1]) : angleOf(dir));
    } else if (s.type === "balloon" || s.type === "datum") {
      // The balloon, or the datum's name, moves; what it belongs to stays. A
      // balloon is placed in the drawing; a name keeps its distance in annotation mm.
      const moved = mul(sub(m, d.startModel), s.type === "balloon" ? 1 : mm);
      s.dx = d.origin[0] + moved[0];
      s.dy = d.origin[1] + moved[1];
    } else if (s.type === "hatch") {
      // Pulling away from the curve sets how deep the strokes reach, and on which side.
      const off = sideOfCurve(this.sk, s.on, m);
      s.side = off >= 0 ? 1 : -1;
      const whole = curveLength(this.sk, s.on);
      s.depth = Math.max(whole * HATCH_REACH[0], Math.min(whole * HATCH_REACH[1], Math.abs(off)));
    } else if (s.type === "note" || s.type === "etalon" || s.type === "picture") {
      const pos = add(d.origin, sub(m, d.startModel));
      s.x = pos[0];
      s.y = pos[1];
    } else if (s.type === "frame") {
      // Axes move freely; dropped on a joint they pin to it.
      const pos = add(d.origin, sub(m, d.startModel));
      const screenPos = toScreen(this.view, pos);
      const near = points(this.sk).find((p) => dist(toScreen(this.view, [p.x, p.y]), screenPos) < POINT_TOL);
      if (near && !this.altKey) {
        s.at = near.id;
        s.x = near.x;
        s.y = near.y;
      } else {
        delete s.at;
        s.x = pos[0];
        s.y = pos[1];
      }
    }
  }

  /** Pulls the tip of an axis along its own direction to set its length. */
  private dragAxis(d: Extract<DragState, { kind: "axis" }>, sp: V): void {
    const s = symbol(this.sk, d.id);
    if (!s || s.type !== "frame") return;
    const mm = this.mm();
    const o = mul(symbolPosition(this.sk, s), mm);
    const q = mul(toModel(this.view, sp), mm);
    const ang = s.angle + (d.axis === "y" ? Math.PI / 2 : 0);
    const size = dot(sub(q, o), [Math.cos(ang), Math.sin(ang)]) - d.slack;
    // Kept in the drawing's units, and never shorter than the arrowhead it carries.
    const length = Math.max(2 * PAPER.arrowLen, size) / mm;
    if (d.axis === "x") s.xSize = length;
    else s.ySize = length;
  }

  /** True when a screen position is on one of the handles drawn for the selected symbol. */
  private gripsAt(sp: V): boolean {
    return this.grips(this.mm()).some((g) => dist(g, sp) < 9);
  }

  /** Points a balloon's leader at whatever is under the pointer; the balloon itself stays where it is. */
  private dragBalloonTip(d: Extract<DragState, { kind: "tip" }>, sp: V): void {
    const s = symbol(this.sk, d.id);
    if (s?.type !== "balloon") return;
    const snap = this.snapAt(sp);
    delete s.at;
    delete s.on;
    delete s.t;
    if (snap.pointId) s.at = snap.pointId;
    else if (snap.curveId) {
      s.on = snap.curveId;
      s.t = curveParam(this.sk, snap.curveId, snap.pos);
    }
    [s.x, s.y] = snap.pos;
    const anchor = balloonAnchor(this.sk, s);
    s.dx = d.centre[0] - anchor[0];
    s.dy = d.centre[1] - anchor[1];
  }

  /** Pulls the far end of an etalon: how long it is, at a round length, and which way it runs, in steps of 15 degrees. Alt lets both go free. */
  private dragEtalonEnd(id: Id, sp: V): void {
    const s = symbol(this.sk, id);
    if (s?.type !== "etalon") return;
    const v = sub(toModel(this.view, sp), [s.x, s.y]);
    const length = Math.hypot(v[0], v[1]);
    if (length * this.view.scale < 8) return;
    if (this.altKey) {
      s.length = length;
      s.angle = angleOf(v);
      return;
    }
    // Two figures are kept, so the length is a number to write on it, in the units the sketch is dimensioned in.
    const worth = length * unitScale(this.sk);
    const step = 10 ** (Math.floor(Math.log10(worth)) - 1);
    s.length = this.fromUnits(Number((Math.round(worth / step) * step).toPrecision(12)));
    s.angle = wrap(Math.round(angleOf(v) / (15 * DEG)) * 15 * DEG);
  }

  /** True when a screen position is on one of the four ends of a centre mark. */
  private centerMarkEndAt(s: Sym, sp: V): boolean {
    if (s.type !== "centermark") return false;
    const mm = this.mm();
    return centerMarkEnds(this.sk, s, mm).some((e) => dist(toScreen(this.view, [e[0] / mm, e[1] / mm]), sp) < 10);
  }

  /** Pulls an end of a centre mark in or out, which scales the whole mark. */
  private dragReach(id: Id, sp: V): void {
    const s = symbol(this.sk, id);
    if (!s || s.type !== "centermark") return;
    const mm = this.mm();
    const f = roundFrame(this.sk, s.on, mm);
    if (!f) return;
    const over = dist(mul(toModel(this.view, sp), mm), f.c) - f.r;
    let scale = over / PAPER.centreOver;
    if (!this.altKey) scale = Math.round(scale * 20) / 20; // steps of 0.05, unless Alt is held
    s.scale = Math.max(0.2, Math.min(10, scale));
  }

  /** Which axis tip of a pair of axes is under a screen position, if any. */
  private axisTipAt(s: Sym, sp: V, hit: Hit): { axis: "x" | "y"; slack: number } | null {
    if (s.type !== "frame") return null;
    const mm = this.mm();
    const tips = frameTips(this.sk, s, mm);
    const o = mul(symbolPosition(this.sk, s), mm);
    const q = mul(toModel(this.view, sp), mm);
    for (const axis of ["x", "y"] as const) {
      const tip = tips[axis];
      if (!tip) continue;
      const near = dist(toScreen(this.view, [tip[0] / mm, tip[1] / mm]), sp) < 10;
      // The label sits at the tip, so grabbing it pulls the tip too.
      if (!near && !(hit.text && hit.part === axis)) continue;
      const dir = norm(sub(tip, o));
      return { axis, slack: dot(sub(q, o), dir) - dist(tip, o) };
    }
    return null;
  }

  private rotateSelected(by: number): void {
    let turned = false;
    for (const id of this.selection) {
      const s = symbol(this.sk, id);
      if (s && (s.type === "support" || s.type === "frame" || s.type === "centermark" || s.type === "load" || s.type === "moment" || s.type === "etalon")) {
        s.angle = wrap(s.angle + by + Math.PI) - Math.PI;
        turned = true;
      }
    }
    if (turned) this.commit();
  }

  // ---- pointer --------------------------------------------------------------

  private screenPos(ev: PointerEvent | WheelEvent | MouseEvent): V {
    const r = this.svg.getBoundingClientRect();
    return [ev.clientX - r.left, ev.clientY - r.top];
  }

  private onPointerDown(ev: PointerEvent): void {
    const sp = this.screenPos(ev);
    this.cursor = sp;
    this.altKey = ev.altKey;
    const wasEditing = this.editing !== null;
    if (wasEditing) this.commitEditor();
    // Working on the canvas ends any typing in the panels.
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && focused !== document.body) focused.blur();
    this.svg.setPointerCapture(ev.pointerId);

    if (ev.button === 1 || ev.button === 2 || (ev.button === 0 && this.spaceKey)) {
      this.drag = { kind: "pan", last: sp, moved: false, quiet: wasEditing };
      this.render();
      return;
    }
    if (ev.button !== 0) return;

    if (isCommand(this.tool)) {
      this.commandClick(sp);
      this.touch();
      return;
    }
    if (isCopyTool(this.tool)) {
      this.copyClick(sp);
      this.touch();
      return;
    }
    if (isSymbolTool(this.tool)) {
      this.symbolClick(sp);
      this.updateSnapMark();
      this.touch();
      return;
    }
    if (this.tool === "trim") {
      this.trimPress(sp);
      this.touch();
      return;
    }
    if (this.tool === "project") {
      this.projectClick(sp);
      this.touch();
      return;
    }
    if (this.tool !== "select") {
      this.toolClick(sp);
      this.updateSnapMark();
      this.render();
      return;
    }

    // The ends of a selected spread load are handles, grabbed before whatever lies under them:
    // where the load runs down to nothing, its end is on the line itself.
    const chosen = this.selectedSymbol();
    const end = chosen && !ev.shiftKey ? this.lineLoadEndAt(chosen, sp) : null;
    if (chosen && end !== null) {
      this.drag = { kind: "span", id: chosen.id, end, startScreen: sp, moved: false };
      return this.touch();
    }
    // The same goes for the handles of a selected diagram: its two ends and its peak.
    const grip = chosen && !ev.shiftKey ? this.diagramGripAt(chosen, sp) : null;
    if (chosen && grip !== null) {
      this.drag = grip === "peak" ? { kind: "height", id: chosen.id, startScreen: sp, moved: false } : { kind: "span", id: chosen.id, end: grip, startScreen: sp, moved: false };
      return this.touch();
    }
    // And the far end of a selected etalon, and the tip of a selected balloon's leader.
    if (chosen && !ev.shiftKey && this.gripsAt(sp)) {
      if (chosen.type === "etalon" || chosen.type === "picture") this.drag = { kind: "stretch", id: chosen.id, startScreen: sp, moved: false };
      else if (chosen.type === "balloon") this.drag = { kind: "tip", id: chosen.id, startScreen: sp, centre: add(balloonAnchor(this.sk, chosen), [chosen.dx, chosen.dy]), moved: false };
      if (this.drag) return this.touch();
    }

    const hit = this.pickAt(sp, ev.timeStamp, !ev.shiftKey);
    if (!hit || hit.kind === "fill") {
      // On a fill, a drag still draws a selection box; only a plain click picks the fill.
      this.drag = { kind: "box", a: sp, b: sp, additive: ev.shiftKey, click: hit?.id };
      return;
    }
    if (ev.shiftKey) {
      if (this.selection.has(hit.id)) this.selection.delete(hit.id);
      else this.selection.add(hit.id);
      this.touch();
      return;
    }
    const wasSelected = this.selection.has(hit.id);
    if (!wasSelected) this.selection = new Set([hit.id]);

    if (hit.kind === "dim") {
      this.drag = { kind: "dim", id: hit.id, startScreen: sp, moved: false, onText: hit.text === true };
    } else if (hit.kind === "sym") {
      const s = symbol(this.sk, hit.id)!;
      const tip = this.axisTipAt(s, sp, hit);
      if (tip) {
        const edit: EditTarget | undefined = hit.text ? { kind: "axis", id: hit.id, axis: tip.axis } : undefined;
        this.drag = { kind: "axis", id: hit.id, axis: tip.axis, startScreen: sp, slack: tip.slack, moved: false, edit };
      } else if (s.type === "centermark" && this.centerMarkEndAt(s, sp)) {
        this.drag = { kind: "reach", id: hit.id, startScreen: sp, moved: false };

      } else if (s.type === "datum" && hit.part !== "label") {
        // The dot is the point itself: dragging it moves the geometry.
        this.selection = new Set([s.at]);
        this.drag = this.startMove(s.at, sp, false);
      } else {
        const edit: EditTarget | undefined = !hit.text ? undefined
          : s.type === "balloon" ? { kind: "balloon", id: hit.id }
          : s.type === "datum" ? { kind: "datum", id: hit.id }
          : s.type === "etalon" ? { kind: "etalon", id: hit.id }
          : s.type === "note" ? { kind: "note", id: hit.id }
          : isLoad(s) ? { kind: "load", id: hit.id } : undefined;
        const origin: V = isLoad(s) && hit.part === "label" ? [s.dx ?? 0, s.dy ?? 0] : this.symbolDragOrigin(s);
        this.drag = { kind: "sym", id: hit.id, startScreen: sp, startModel: toModel(this.view, sp), origin, moved: false, edit, part: hit.part };
      }
    } else if (hit.kind === "curve" && hit.part === "label") {
      // The name of an arrow: it moves on its own, the arrow stays.
      const e = entity(this.sk, hit.id) as Line | Arc;
      const mm = this.mm();
      const origin = sub(arrowLabelAt(this.sk, e, mm) ?? [0, 0], arrowAnchor(this.sk, e, mm));
      this.drag = { kind: "label", id: hit.id, startScreen: sp, startModel: toModel(this.view, sp), origin, moved: false, edit: { kind: "arrow", id: hit.id } };
    } else if (hit.kind !== "glyph") {
      this.drag = this.startMove(hit.id, sp, wasSelected && this.selection.size > 1);
    }
    this.touch();
  }

  private startMove(grabbed: Id, sp: V, collapse: boolean): DragState {
    const ids = new Set<Id>();
    let rim: Id | undefined;
    const selected = [...this.selection].map((id) => entity(this.sk, id)).filter((e) => e !== undefined);
    if (selected.length === 1 && (selected[0].type === "circle" || selected[0].type === "arc")) {
      rim = selected[0].id;
    } else {
      for (const e of selected) {
        if (e.type === "point") ids.add(e.id);
        else curvePoints(e).forEach((p) => ids.add(p));
      }
    }
    const targets = [...ids].map((id) => { const p = point(this.sk, id); return { id, x: p.x, y: p.y }; });
    return { kind: "move", grabbed, startScreen: sp, startModel: toModel(this.view, sp), targets, rim, moved: false, collapse };
  }

  private onPointerMove(ev: PointerEvent): void {
    const sp = this.screenPos(ev);
    this.cursor = sp;
    this.altKey = ev.altKey;
    const d = this.drag;

    if (d?.kind === "pan") {
      const dx = sp[0] - d.last[0], dy = sp[1] - d.last[1];
      if (Math.abs(dx) + Math.abs(dy) > 0) d.moved = true;
      this.view.cx -= dx / this.view.scale;
      this.view.cy += dy / this.view.scale;
      d.last = sp;
    } else if (d?.kind === "box") {
      d.b = sp;
    } else if (d?.kind === "trim") {
      this.trimStroke(d, sp);
    } else if (d?.kind === "move") {
      if (!d.moved && dist(sp, d.startScreen) < 3) return;
      d.moved = true;
      const m = toModel(this.view, sp);
      const delta = sub(m, d.startModel);
      const drags: Drag[] = d.rim
        ? [{ kind: "rim", id: d.rim, x: m[0], y: m[1] }]
        : d.targets.map((t) => ({ kind: "point", id: t.id, x: t.x + delta[0], y: t.y + delta[1] }));
      this.solve(drags);
      this.chromeDirty = true;
    } else if (d?.kind === "dim") {
      if (!d.moved && dist(sp, d.startScreen) < 3) return;
      d.moved = true;
      this.dragDimension(d.id, sp);
    } else if (d?.kind === "sym") {
      if (!d.moved && dist(sp, d.startScreen) < 3) return;
      d.moved = true;
      this.dragSymbol(d, sp);
    } else if (d?.kind === "axis") {
      if (!d.moved && dist(sp, d.startScreen) < 3) return;
      d.moved = true;
      this.dragAxis(d, sp);
      this.chromeDirty = true;
    } else if (d?.kind === "reach") {
      if (!d.moved && dist(sp, d.startScreen) < 3) return;
      d.moved = true;
      this.dragReach(d.id, sp);
      this.chromeDirty = true;
    } else if (d?.kind === "tip") {
      if (!d.moved && dist(sp, d.startScreen) < 3) return;
      d.moved = true;
      this.dragBalloonTip(d, sp);
      this.chromeDirty = true;
    } else if (d?.kind === "stretch") {
      if (!d.moved && dist(sp, d.startScreen) < 3) return;
      d.moved = true;
      if (symbol(this.sk, d.id)?.type === "picture") this.dragPictureCorner(d.id, sp);
      else this.dragEtalonEnd(d.id, sp);
      this.chromeDirty = true;
    } else if (d?.kind === "span") {
      if (!d.moved && dist(sp, d.startScreen) < 3) return;
      d.moved = true;
      this.dragSpan(d, sp);
      this.chromeDirty = true;
    } else if (d?.kind === "height") {
      if (!d.moved && dist(sp, d.startScreen) < 3) return;
      d.moved = true;
      this.dragHeight(d, sp);
      this.chromeDirty = true;
    } else if (d?.kind === "label") {
      if (!d.moved && dist(sp, d.startScreen) < 3) return;
      d.moved = true;
      const l = entity(this.sk, d.id);
      if (l?.type === "line" || l?.type === "arc") {
        const moved = mul(sub(toModel(this.view, sp), d.startModel), this.mm());
        l.lx = d.origin[0] + moved[0];
        l.ly = d.origin[1] + moved[1];
      }
    } else if (this.tool === "select") {
      this.hover = this.hitTest(sp)?.id ?? null;
    } else if (isCommand(this.tool) || this.tool === "mirror") {
      this.hover = this.hitTest(sp, true)?.id ?? null;
    } else if (this.tool === "trim") {
      this.trimPlan = this.trimAt(sp);
    } else if (this.tool === "project") {
      this.projectHover = this.otherAt(sp)?.entity.id ?? null;
    } else {
      const p = this.pending;
      if ((p?.tool === "arc" && p.start) || (p?.tool === "arcbeam" && p.start && !p.end)) {
        const ang = angleOf(sub(toModel(this.view, sp), p.center.pos));
        let step = ang - p.lastAng;
        if (step > Math.PI) step -= TWO_PI;
        if (step < -Math.PI) step += TWO_PI;
        p.sweep = Math.max(-TWO_PI, Math.min(TWO_PI, p.sweep + step));
        p.lastAng = ang;
      }
      this.updateSnapMark();
    }
    this.render();
  }

  private updateSnapMark(): void {
    if (this.tool === "select" || this.tool === "trim" || this.tool === "mirror" || isCommand(this.tool)) {
      this.snapMark = null;
      return;
    }
    // The third click of a beam sets its width; it lands nowhere in particular.
    if ((this.pending?.tool === "beam" && this.pending.b) || (this.pending?.tool === "arcbeam" && this.pending.end)) {
      this.snapMark = null;
      return;
    }
    const anchor = this.snapAnchor();
    this.snapMark = this.markFor(this.snapAt(this.cursor, anchor), anchor);
  }

  private onPointerUp(ev: PointerEvent): void {
    const d = this.drag;
    this.drag = null;
    if (this.svg.hasPointerCapture(ev.pointerId)) this.svg.releasePointerCapture(ev.pointerId);
    if (!d) return;

    if (d.kind === "pan") {
      if (!d.moved) {
        // A press that did not pan is a click: middle confirms, right cancels.
        if (ev.button === 1 && !d.quiet) this.confirm(this.screenPos(ev));
        else if (ev.button === 2 && !this.cycleUnder(this.screenPos(ev))) this.cancel();
      }
    } else if (d.kind === "box") {
      this.finishBox(d);
    } else if (d.kind === "trim") {
      // One stroke is one edit, however much it took off.
      if (d.cut) this.commit();
    } else if (d.kind === "move") {
      if (d.moved) {
        this.solve();
        this.commit();
      } else if (d.collapse) {
        this.selection = new Set([d.grabbed]);
      }
    } else if (d.kind === "dim" && !d.moved && d.onText && ev.type === "pointerup") {
      // A click on the number, not a drag: type the new value where it stands.
      this.openDimEditor(d.id);
    } else if ((d.kind === "sym" || d.kind === "axis" || d.kind === "label") && !d.moved && d.edit && ev.type === "pointerup") {
      // The same for a name: a click on it, and it is typed where it stands.
      this.openEditor(d.edit);
    } else if ((d.kind === "dim" || d.kind === "sym" || d.kind === "axis" || d.kind === "label" || d.kind === "reach" || d.kind === "span" || d.kind === "height" || d.kind === "tip" || d.kind === "stretch") && d.moved) {
      this.commit();
    }
    this.touch();
  }

  private finishBox(d: Extract<DragState, { kind: "box" }>): void {
    if (!d.additive) this.selection.clear();
    if (dist(d.a, d.b) < 3) {
      if (d.click) {
        if (d.additive && this.selection.has(d.click)) this.selection.delete(d.click);
        else this.selection.add(d.click);
      }
      return;
    }
    const x0 = Math.min(d.a[0], d.b[0]), x1 = Math.max(d.a[0], d.b[0]);
    const y0 = Math.min(d.a[1], d.b[1]), y1 = Math.max(d.a[1], d.b[1]);
    const within = (m: V) => {
      const s = toScreen(this.view, m);
      return s[0] >= x0 && s[0] <= x1 && s[1] >= y0 && s[1] <= y1;
    };
    const inside = (id: Id) => { const p = point(this.sk, id); return within([p.x, p.y]); };
    for (const e of this.sk.entities) {
      if (e.id === ORIGIN) continue;
      if (e.type === "point") {
        if (inside(e.id)) this.selection.add(e.id);
      } else if (curvePoints(e).every(inside)) {
        if (e.type === "circle") {
          const c = toScreen(this.view, [point(this.sk, e.c).x, point(this.sk, e.c).y]);
          const r = e.r * this.view.scale;
          if (c[0] - r < x0 || c[0] + r > x1 || c[1] - r < y0 || c[1] + r > y1) continue;
        }
        this.selection.add(e.id);
      }
    }
    for (const s of this.sk.symbols) if (within(symbolPosition(this.sk, s))) this.selection.add(s.id);
  }

  private onWheel(ev: WheelEvent): void {
    ev.preventDefault();
    const sp = this.screenPos(ev);
    const before = toModel(this.view, sp);
    const unit = ev.deltaMode === 1 ? 32 : 1; // lines vs pixels
    const factor = Math.exp(-ev.deltaY * unit * 0.0016);
    this.view.scale = Math.max(1e-4, Math.min(1e7, this.view.scale * factor));
    const after = toModel(this.view, sp);
    this.view.cx += before[0] - after[0];
    this.view.cy += before[1] - after[1];
    this.render();
  }

  private onDoubleClick(ev: MouseEvent): void {
    if (this.tool !== "select") return;
    const hit = this.hitTest(this.screenPos(ev));
    if (!hit) return;
    // On a diagram it opens the plot the diagram draws.
    const shown = symbol(this.sk, hit.id);
    if (shown?.type === "diagram" || shown?.type === "trace") return this.editPlotOf(shown);
    // A double-click opens the text of what was hit, also where there is no text yet to click on.
    let target: EditTarget | null = null;
    if (hit.kind === "dim") target = { kind: "dim", id: hit.id };
    else if (hit.kind === "curve") {
      const e = entity(this.sk, hit.id);
      if (isNamed(e)) target = { kind: "arrow", id: hit.id };
    } else if (hit.kind === "point") {
      const d = this.datumOn(hit.id);
      if (d) target = { kind: "datum", id: d.id };
    } else if (hit.kind === "sym") {
      const s = symbol(this.sk, hit.id);
      if (s?.type === "balloon" || s?.type === "datum" || s?.type === "note") target = { kind: s.type, id: hit.id };
      else if (s && isLoad(s)) target = { kind: "load", id: hit.id };
    }
    if (!target) return;
    if (target.kind === "dim") this.selection = new Set([hit.id]);
    this.openEditor(target);
    this.touch();
  }

  /** Esc and right-click: back out one level at a time. */
  private cancel(): void {
    if (this.editing) this.closeEditor();
    else if (this.pending) this.pending = null;
    else if (isCommand(this.tool) && this.selection.size) this.selection.clear();
    else if (this.tool !== "select") return this.setTool("select");
    else this.selection.clear();
    this.snapMark = null;
    this.touch();
  }

  /**
   * Middle-click: accept and move on. It places the dimension being made, ends
   * the shape being drawn, and with nothing in progress leaves the tool.
   */
  private confirm(sp: V): void {
    if (isPlaced(this.tool) && this.canApply(this.tool)) {
      this.placeDimension(sp);
    } else if (this.pending) {
      this.pending = null;
      this.snapMark = null;
    } else if (isCommand(this.tool) && this.picked().entities > 0) {
      this.selection.clear();
    } else if (this.tool !== "select") {
      return this.setTool("select");
    }
    this.touch();
  }

  // ---- dimensions -----------------------------------------------------------

  private dragDimension(id: Id, sp: V): void {
    const d = constraint(this.sk, id);
    if (!d || !isDimension(d)) return;
    const mm = this.mm();
    const q = mul(toModel(this.view, sp), mm);
    if (d.type === "distance") {
      const f = distanceFrame(this.sk, d, mm);
      d.offset = dot(sub(q, f.A), f.n) / mm;
    } else if (d.type === "angle") {
      const f = angleFrame(this.sk, d, mm);
      if (f) d.radius = Math.max(3, dist(q, f.vertex)) / mm;
    } else {
      // The far end of the leader follows the pointer: its direction, its
      // length, and whether it is inside the circle or outside.
      const f = roundFrame(this.sk, d.target, mm);
      if (!f) return;
      const reach = dist(q, f.c);
      if (reach < 1e-9) return;
      d.angle = angleOf(sub(q, f.c));
      // Never shorter than its own arrowhead.
      const length = (v: number) => Math.max(2, v) / mm;
      if (reach > f.r + 1) {
        d.outside = true;
        d.len = length(reach - f.r);
      } else if (reach < f.r - 1) {
        delete d.outside;
        // Close to the centre it snaps back to the usual leader from the centre.
        if (reach < Math.max(1.5, f.r * 0.12)) delete d.len;
        else d.len = length(f.r - reach);
      }
    }
  }

  /**
   * Offset, in model units, that puts a distance dimension on the outside of
   * the figure: the side of the two points that faces away from the middle of
   * the geometry, at the standard distance for the view as it is now.
   */
  private outsideOffset(a: { x: number; y: number }, b: { x: number; y: number }, mode: DistanceMode): number {
    const mm = this.mm();
    const box = geometryBox(this.sk);
    const centre: V = [(box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2];
    const A: V = [a.x, a.y], B: V = [b.x, b.y];
    const m = mid(A, B);
    if (mode === "aligned") {
      const n = perp(norm(sub(B, A)));
      const lean = dot(sub(m, centre), n);
      const side = Math.abs(lean) < 1e-9 ? (n[1] > 0 ? -1 : 1) : Math.sign(lean);
      return (side * PAPER.dimOffset) / mm;
    }
    // Horizontal dimensions sit above or below both points, vertical ones left or right.
    const i = mode === "horizontal" ? 1 : 0;
    const lo = Math.min(A[i], B[i]), hi = Math.max(A[i], B[i]);
    return m[i] <= centre[i] ? lo - A[i] - PAPER.dimOffset / mm : hi - A[i] + PAPER.dimOffset / mm;
  }

  /**
   * The dimension the current picks call for. With `at` (a model position)
   * the dimension is laid out there, and for a distance the position also
   * chooses the kind: beside the span it is aligned, above or below it
   * horizontal, left or right of it vertical. Without `at` it gets a default
   * spot outside the figure.
   */
  private dimensionDraft(at?: V): ConstraintDraft | string {
    const draft = this.drawnDimension(at);
    // Lengths are given in the units the sketch is dimensioned in.
    if (typeof draft !== "string" && (draft.type === "distance" || draft.type === "radius")) draft.value *= unitScale(this.sk);
    return draft;
  }

  /** The same, with lengths as the drawing measures them. */
  private drawnDimension(at?: V): ConstraintDraft | string {
    const { pts, lines, rounds } = this.picked();
    const mm = this.mm();
    const xy = (p: Point): V => [p.x, p.y];

    if ((pts.length === 2 && !lines.length && !rounds.length) || (lines.length === 1 && !pts.length && !rounds.length)) {
      const [a, b] = pts.length === 2 ? pts : [point(this.sk, lines[0].p1), point(this.sk, lines[0].p2)];
      const A = xy(a), B = xy(b);
      const length = dist(A, B);
      if (length < 1e-9) return "Those two points are in the same place.";
      if (!at) return { type: "distance", a: a.id, b: b.id, mode: "aligned", value: length, offset: this.outsideOffset(a, b, "aligned") };

      const x0 = Math.min(A[0], B[0]), x1 = Math.max(A[0], B[0]);
      const y0 = Math.min(A[1], B[1]), y1 = Math.max(A[1], B[1]);
      const slanted = x1 - x0 > length * 0.02 && y1 - y0 > length * 0.02;
      const inX = at[0] >= x0 && at[0] <= x1, inY = at[1] >= y0 && at[1] <= y1;
      let mode: DistanceMode = "aligned";
      if (slanted && inX && !inY) mode = "horizontal";
      else if (slanted && inY && !inX) mode = "vertical";
      if (mode === "horizontal") return { type: "distance", a: a.id, b: b.id, mode, value: x1 - x0, offset: at[1] - A[1] };
      if (mode === "vertical") return { type: "distance", a: a.id, b: b.id, mode, value: y1 - y0, offset: at[0] - A[0] };
      const n = perp(norm(sub(B, A)));
      return { type: "distance", a: a.id, b: b.id, mode, value: length, offset: dot(sub(at, A), n) };
    }

    // A point and a line, or two lines that run side by side: the distance square to the line.
    const toLine = (p: Point, l: Line): ConstraintDraft | string => {
      const P = xy(p), L0 = xy(point(this.sk, l.p1)), L1 = xy(point(this.sk, l.p2));
      const t = norm(sub(L1, L0));
      const foot = add(L0, mul(t, dot(sub(P, L0), t)));
      const gap = dist(P, foot);
      if (gap < 1e-9) return lines.length === 2 ? "Those lines are in line with each other." : "That point is on the line.";
      const n = perp(norm(sub(foot, P)));
      const offset = at ? dot(sub(at, P), n) : this.outsideOffset(p, { x: foot[0], y: foot[1] }, "aligned");
      return { type: "distance", a: p.id, b: l.id, mode: "aligned", toLine: true, value: gap, offset };
    };
    if (pts.length === 1 && lines.length === 1 && !rounds.length) return toLine(pts[0], lines[0]);

    if (lines.length === 2 && !pts.length && !rounds.length) {
      let [l1, l2] = lines;
      const ends = (l: Line): [V, V] => [xy(point(this.sk, l.p1)), xy(point(this.sk, l.p2))];
      let [a1, b1] = ends(l1), [a2, b2] = ends(l2);
      // Side by side, within a degree or so: the distance between them, from the end of the second nearest the pointer.
      if (Math.abs(cross(norm(sub(b1, a1)), norm(sub(b2, a2)))) < 0.02) {
        const near = at ?? mid(a1, b1);
        const p = dist(a2, near) <= dist(b2, near) ? point(this.sk, l2.p1) : point(this.sk, l2.p2);
        return toLine(p, l1);
      }
      const vertex = intersectLines(a1, sub(b1, a1), a2, sub(b2, a2));
      if (!vertex) return "Those lines are parallel, so there is no angle to dimension.";
      let rev1: boolean, rev2: boolean;
      const u1 = norm(sub(b1, a1)), u2 = norm(sub(b2, a2));
      const w = at ? sub(at, vertex) : null;
      if (w && dist(at!, vertex) * this.view.scale > 4) {
        // Of the four sectors the lines make, measure the one the pointer is in.
        rev1 = false;
        rev2 = false;
        for (const [r1, r2] of [[false, false], [false, true], [true, false], [true, true]]) {
          const e1 = mul(u1, r1 ? -1 : 1), e2 = mul(u2, r2 ? -1 : 1);
          const turn = cross(e1, e2);
          if (cross(e1, w) * turn >= 0 && cross(w, e2) * turn >= 0) { rev1 = r1; rev2 = r2; break; }
        }
      } else {
        // Measure along each member away from the vertex, towards its far end.
        rev1 = dist(vertex, a1) > dist(vertex, b1);
        rev2 = dist(vertex, a2) > dist(vertex, b2);
      }
      let d1 = mul(u1, rev1 ? -1 : 1), d2 = mul(u2, rev2 ? -1 : 1);
      let value = Math.atan2(cross(d1, d2), dot(d1, d2));
      if (value < 0) {
        [l1, l2] = [l2, l1];
        [rev1, rev2] = [rev2, rev1];
        [a1, b1, a2, b2] = [a2, b2, a1, b1];
        [d1, d2] = [d2, d1];
        value = -value;
      }
      if (value < 1e-6 || value > Math.PI - 1e-6) return "Those lines are in line with each other.";
      const reach = Math.min(dist(a1, b1), dist(a2, b2)) * mm;
      const radius = at ? Math.max(3, dist(at, vertex) * mm) : Math.max(6, Math.min(14, reach * 0.35));
      return { type: "angle", l1: l1.id, rev1, l2: l2.id, rev2, value, radius: radius / mm };
    }

    if (rounds.length === 1 && !pts.length && !lines.length) {
      const e = rounds[0];
      const c = point(this.sk, e.c);
      if (at && dist(at, xy(c)) > 1e-9) {
        const r = e.type === "circle" ? e.r : arcRadius(this.sk, e);
        const base = { type: "radius" as const, target: e.id, value: r, angle: angleOf(sub(at, xy(c))) };
        // Placed beyond the rim, the dimension is drawn outside and reaches to the pointer.
        const beyond = (dist(at, xy(c)) - r) * mm;
        return beyond > 1 ? { ...base, outside: true, len: Math.max(2, beyond) / mm } : base;
      }
      if (e.type === "circle") return { type: "radius", target: e.id, value: e.r, angle: Math.PI / 4 };
      const s = point(this.sk, e.p1), t = point(this.sk, e.p2);
      const a0 = angleOf([s.x - c.x, s.y - c.y]);
      const a1 = a0 + (wrap(angleOf([t.x - c.x, t.y - c.y]) - a0) || TWO_PI);
      return { type: "radius", target: e.id, value: arcRadius(this.sk, e), angle: (a0 + a1) / 2 };
    }
    return "Select a line, two points, two lines, a point and a line, or a circle to dimension.";
  }

  /**
   * Creates the dimension for the current picks and opens its value for
   * typing. With `measure`, a measure instead: it drives nothing, so it is
   * simply added, and there is no value to type.
   */
  private createDimension(at?: V, measure = this.tool === "measure"): void {
    const draft = this.dimensionDraft(at);
    if (typeof draft === "string") return this.toast(draft);
    if (measure) {
      const m = addConstraint(this.sk, { ...draft, measure: true } as ConstraintDraft);
      this.commit();
      this.selection = isCommand(this.tool) ? new Set() : new Set([m.id]);
      this.touch();
      return;
    }
    // Of geometry that cannot move, a dimension can only say what it measures.
    if (this.allFixed(draft)) {
      const d = addConstraint(this.sk, { ...draft, driven: true } as ConstraintDraft);
      this.commit();
      this.selection = new Set([d.id]);
      this.openDimEditor(d.id);
      return this.touch();
    }
    const made = this.addManual([draft], "That dimension would over-constrain the sketch.");
    if (!made) {
      if (isCommand(this.tool)) this.selection.clear();
      return;
    }
    this.selection = new Set([made[0].id]);
    this.openDimEditor(made[0].id);
    this.touch();
  }

  /** True when nothing a dimension would measure can move: then it can only be driven. */
  private allFixed(draft: ConstraintDraft): boolean {
    const fixed = fixedPoints(this.sk);
    const ends = (id: Id): Id[] => { const e = entity(this.sk, id); return e && e.type !== "point" ? curvePoints(e) : [id]; };
    if (draft.type === "distance") return [draft.a, ...ends(draft.b)].every((id) => fixed.has(id));
    if (draft.type === "angle") return [...ends(draft.l1), ...ends(draft.l2)].every((id) => fixed.has(id));
    if (draft.type === "radius") {
      const e = entity(this.sk, draft.target);
      if (e?.type === "circle") return fixed.has(e.c) && !!(e.ref || e.locked);
      return e?.type === "arc" && curvePoints(e).every((id) => fixed.has(id));
    }
    return false;
  }

  private placeDimension(sp: V): void {
    this.createDimension(toModel(this.view, sp));
  }

  /** The number shown to the user: degrees for angles, plain value otherwise. A measure shows what it measures now. */
  private shownValue(d: Dimension): string {
    const v = d.measure || d.driven ? measuredDimValue(this.sk, d) : d.value;
    return formatNumber(d.type === "angle" ? v / DEG : v);
  }

  private setDimValue(id: Id, text: string): boolean {
    const d = constraint(this.sk, id);
    if (!d || !isDimension(d)) return false;
    let v = parseNumber(text);
    if (!Number.isFinite(v)) {
      this.toast("Type a number, such as 3 or 2,5.");
      return false;
    }
    if (d.type === "angle") {
      if (v <= 0 || v >= 360) { this.toast("An angle must be between 0 and 360 degrees."); return false; }
      v *= DEG;
    } else if (d.type === "radius" || (d.type === "distance" && d.mode === "aligned")) {
      if (v <= 0) { this.toast("That value must be greater than zero."); return false; }
    } else if (v < 0) {
      this.toast("Distances cannot be negative.");
      return false;
    }
    if (Math.abs(v - d.value) < 1e-12) return true;
    if (d.driven) {
      // A driven dimension moves nothing. As the only length dimension it says what the drawing is worth.
      const drawn = measuredValue(this.sk, d);
      if (isLengthDimension(d) && this.allConstraints().filter(isLengthDimension).length === 1 && drawn > 1e-12) {
        d.value = v;
        this.sk.lengthScale = v / drawn;
        this.toast("The first dimension sets the scale: every other dimension of the drawing now reads in these units.");
        this.commit();
        return true;
      }
      this.toast("This dimension is of fixed geometry, so it shows what that measures and cannot change it. Type a label to show text instead.");
      return false;
    }

    const before = clone(this.sk);
    const old = d.value;
    d.value = v;
    // The only length dimension there is has nothing to be measured against: it says what its line is worth, and nothing moves.
    const only = isLengthDimension(d) && this.allConstraints().filter(isLengthDimension).length === 1;
    const drawn = measuredValue(this.sk, d);
    if (only && drawn > 1e-12) {
      this.sk.lengthScale = v / drawn;
      this.toast("The first dimension sets the scale, so nothing moves. Later ones are measured against it.");
    }
    let r = this.solver.solve(this.sk);
    if (!r.ok) {
      // A big jump can fail from the current shape; walk there in small steps.
      this.sk = clone(before);
      const dd = constraint(this.sk, id) as Dimension;
      const STEPS = 16;
      for (let k = 1; k <= STEPS; k++) {
        dd.value = old + ((v - old) * k) / STEPS;
        r = this.solver.solve(this.sk);
        if (!r.ok) break;
      }
    }
    if (!r.ok) {
      this.sk = before;
      this.solve();
      this.toast("No solution with that value. Another constraint or dimension rules it out.");
      this.touch();
      return false;
    }
    this.result = r;
    this.commit();
    this.keepInView();
    return true;
  }

  /** Refits the view when an edit left the figure off screen or tiny. */
  private keepInView(): void {
    const b = geometryBox(this.sk);
    if (boxIsEmpty(b)) return;
    const [x0, y1] = toScreen(this.view, [b.x0, b.y0]);
    const [x1, y0] = toScreen(this.view, [b.x1, b.y1]);
    const outside = x0 < 0 || y0 < 0 || x1 > this.view.w || y1 > this.view.h;
    const tiny = x1 - x0 < this.view.w * 0.15 && y1 - y0 < this.view.h * 0.15;
    if (outside || tiny) this.fit();
  }

  private openDimEditor(id: Id): void {
    this.openEditor({ kind: "dim", id });
  }

  /** The text prim that shows what an edit target holds, if it is on the drawing right now. */
  private editPrim(t: EditTarget): Extract<Prim, { k: "text" }> | undefined {
    const part = t.kind === "axis" ? t.axis : t.kind === "datum" || t.kind === "arrow" || t.kind === "load" || t.kind === "etalon" ? "label" : undefined;
    return this.prims.find((p): p is Extract<Prim, { k: "text" }> => p.k === "text" && p.ref === t.id && (part === undefined || p.part === part));
  }

  /** What an edit target holds now, as the text to put in the box; null when it no longer exists. */
  private editValue(t: EditTarget): string | null {
    if (t.kind === "dim") {
      const d = constraint(this.sk, t.id);
      // A measure has nothing to type. Otherwise the box shows what the figure shows: the label when there is one, else the number.
      if (d && isDimension(d) && d.measure) return null;
      return d && isDimension(d) ? d.label?.trim() || this.shownValue(d) : null;
    }
    if (t.kind === "arrow") {
      const e = entity(this.sk, t.id);
      return isNamed(e) ? e.label ?? "" : null;
    }
    const s = symbol(this.sk, t.id);
    if (t.kind === "balloon") return s?.type === "balloon" ? s.text : null;
    if (t.kind === "note") return s?.type === "note" ? s.text : null;
    if (t.kind === "load") return s && isLoad(s) ? s.label : null;
    if (t.kind === "datum") return s?.type === "datum" ? s.label : null;
    // An etalon with no name of its own shows its length; that is what the box starts with.
    if (t.kind === "etalon") return s?.type === "etalon" ? s.label.trim() || this.inUnits(s.length, 6) : null;
    return s?.type === "frame" ? (t.axis === "x" ? s.xLabel : s.yLabel) : null;
  }

  /** Opens the box for typing on the drawing, over the text it edits. */
  private openEditor(t: EditTarget): void {
    const value = this.editValue(t);
    if (value === null) return;
    this.editing = t;
    this.dimEditor.hidden = false;
    this.editingInitial = value;
    this.dimEditor.value = value;
    this.dimEditor.setAttribute("aria-label", t.kind === "dim" ? "Dimension value or label" : t.kind === "note" ? "Note text" : "Name");
    // A note is a line of text, typed from where it starts; everything else is short and centred.
    this.dimEditor.classList.toggle("wide", t.kind === "note");
    // The prims on hand may predate the thing being edited (an arrow just drawn).
    this.prims = buildPrims(this.sk, this.mm(), { editor: !this.preview });
    this.placeEditor();
    // Focus once the click that opened it has run its course; otherwise the
    // browser's own handling of that click takes the focus or the selection back.
    this.focusTimer = window.setTimeout(() => {
      if (this.editing !== t) return;
      this.dimEditor.focus();
      this.dimEditor.select();
    }, 0);
  }

  private placeEditor(): void {
    const t = this.editing;
    if (!t) return;
    if (this.editValue(t) === null) return this.closeEditor();
    const mm = this.mm();
    const text = this.editPrim(t);
    let at: V | null = text ? textCentre(text) : null;
    if (t.kind === "note") {
      const s = symbol(this.sk, t.id);
      at = s?.type === "note" ? [s.x * mm, s.y * mm] : null;
    } else if (!at) {
      // Nothing is shown yet (an empty name): the box goes where the text will appear.
      if (t.kind === "arrow") at = arrowLabelAt(this.sk, entity(this.sk, t.id) as Line | Arc, mm, true);
      else {
        const s = symbol(this.sk, t.id);
        if (s?.type === "datum") at = add(mul(symbolPosition(this.sk, s), mm), [s.dx, s.dy]);
        else if (s && isLoad(s)) at = loadLabel(this.sk, s, mm)?.at ?? null;
        else if (s?.type === "balloon") at = mul(add(balloonAnchor(this.sk, s), [s.dx, s.dy]), mm);
        else if (s?.type === "frame" && t.kind === "axis") at = frameTips(this.sk, s, mm)[t.axis];
      }
    }
    if (!at) return;
    const sp = toScreen(this.view, [at[0] / mm, at[1] / mm]);
    this.dimEditor.style.left = `${sp[0]}px`;
    this.dimEditor.style.top = `${sp[1]}px`;
  }

  private commitEditor(): void {
    const t = this.editing;
    if (!t) return;
    // Names are math already, so dollar signs around them are dropped. In a note they mark the math.
    const text = t.kind === "note" ? this.dimEditor.value.trim() : this.dimEditor.value.trim().replace(/^\$+|\$+$/g, "");
    const unchanged = text === this.editingInitial.trim();
    this.closeEditor(text !== "");
    if (unchanged || this.editValue(t) === null) return this.touch();
    if (t.kind !== "dim") {
      // A name: what was typed is what is shown.
      if (t.kind === "note") {
        const s = symbol(this.sk, t.id);
        if (s?.type !== "note") return;
        // Emptied, a note that was there before is deleted.
        if (text) s.text = text;
        else {
          remove(this.sk, [s.id]);
          this.selection.delete(s.id);
        }
      } else if (t.kind === "arrow") {
        const e = entity(this.sk, t.id) as Line | Arc;
        if (text) e.label = text;
        else delete e.label;
      } else {
        const s = symbol(this.sk, t.id)!;
        if (s.type === "balloon") s.text = text;
        else if (s.type === "datum" || isLoad(s) || s.type === "etalon") s.label = text;
        else if (s.type === "frame" && t.kind === "axis") {
          if (t.axis === "x") s.xLabel = text;
          else s.yLabel = text;
        }
      }
      return this.commit();
    }
    const id = t.id;
    const d = constraint(this.sk, id) as Dimension;
    const label = d.label;
    if (text === "") {
      // Cleared: a label goes, and the number shows again.
      if (label) { delete d.label; this.commit(); }
    } else if (Number.isFinite(parseNumber(text))) {
      // A number drives the geometry, and replaces a label that was shown instead.
      delete d.label;
      const same = Math.abs(parseNumber(text) * (d.type === "angle" ? DEG : 1) - d.value) < 1e-12;
      const ok = this.setDimValue(id, text);
      const now = constraint(this.sk, id);
      if (!ok && label && now && isDimension(now)) now.label = label;
      else if (ok && same && label) this.commit();
    } else {
      // Anything else is a label, shown instead of the number.
      d.label = text;
      this.commit();
    }
    this.touch();
  }

  /** Closes the box on the drawing. A note that was left empty goes with it, unless `keep`: its text is about to be set. */
  private closeEditor(keep = false): void {
    const t = this.editing;
    if (!t) return;
    clearTimeout(this.focusTimer);
    this.editing = null;
    this.dimEditor.hidden = true;
    if (t.kind !== "note" || keep) return;
    const s = symbol(this.sk, t.id);
    if (s?.type !== "note" || s.text.trim()) return;
    remove(this.sk, [s.id]);
    this.selection.delete(s.id);
    this.touch();
  }

  // ---- constraint commands ------------------------------------------------------

  private picked() {
    const pts: Point[] = [], lines: Line[] = [], rounds: (Circle | Arc)[] = [], beziers: Bezier[] = [], cons: Constraint[] = [], syms: Sym[] = [];
    for (const id of this.selection) {
      const e = entity(this.sk, id);
      if (e?.type === "point") pts.push(e);
      else if (e?.type === "line") lines.push(e);
      else if (e?.type === "bezier") beziers.push(e);
      else if (e) rounds.push(e);
      else {
        const c = constraint(this.sk, id);
        if (c) cons.push(c);
        const s = symbol(this.sk, id);
        if (s) syms.push(s);
      }
    }
    return { pts, lines, rounds, beziers, cons, syms, entities: pts.length + lines.length + rounds.length + beziers.length };
  }

  /** True when the picked geometry is exactly what the command needs. */
  private canApply(cmd: Command): boolean {
    const { pts, lines, rounds, beziers } = this.picked();
    // No constraint or dimension takes a Bézier curve; only its points.
    if (beziers.length) return false;
    const P = pts.length, L = lines.length, R = rounds.length;
    switch (cmd) {
      case "horizontal":
      case "vertical":
        return (L >= 1 && P === 0 && R === 0) || (P === 2 && L === 0 && R === 0);
      case "parallel": return L >= 2 && P === 0 && R === 0;
      case "perpendicular": return L === 2 && P === 0 && R === 0;
      case "equal": return (L >= 2 && P === 0 && R === 0) || (R >= 2 && P === 0 && L === 0);
      case "coincident": return (P === 2 && L + R === 0) || (P === 1 && L + R === 1);
      case "midpoint": return P === 1 && L === 1 && R === 0;
      case "tangent": return (L === 1 && R === 1 && P === 0) || (R === 2 && L === 0 && P === 0);
      case "fixed": return P >= 1 && L + R === 0;
      case "dimension":
      case "measure":
        return (P === 2 && L + R === 0) || (L === 1 && P + R === 0) || (L === 2 && P + R === 0) || (P === 1 && L === 1 && R === 0) || (R === 1 && P + L === 0);
    }
  }

  /** True when one more pick could complete what the command needs. */
  private couldGrow(cmd: Command): boolean {
    const { pts, lines, rounds } = this.picked();
    const P = pts.length, L = lines.length, R = rounds.length;
    const only = (n: number) => n === 1 && P + L + R === 1;
    switch (cmd) {
      case "horizontal":
      case "vertical":
      case "dimension":
      case "measure":
        return only(P);
      case "parallel":
      case "perpendicular":
        return only(L);
      case "equal": return only(L) || only(R);
      case "coincident": return P + L + R === 1;
      case "midpoint": return only(P) || only(L);
      case "tangent": return only(L) || only(R);
      case "fixed": return false;
    }
  }

  /**
   * A click while a constraint or the dimension command is the active tool:
   * the geometry under it joins the picks, and the command runs as soon as it
   * has what it needs.
   */
  private commandClick(sp: V): void {
    const cmd = this.tool as Command;
    const info = toolDef(cmd);
    // Picks are geometry; a dimension left selected by the last placement is dropped.
    for (const id of [...this.selection]) if (!entity(this.sk, id)) this.selection.delete(id);

    const hit = this.hitTest(sp, true);
    if (!hit) {
      if (isPlaced(cmd) && this.canApply(cmd)) this.placeDimension(sp);
      else this.selection.clear();
      return;
    }
    if (this.selection.has(hit.id)) {
      this.selection.delete(hit.id); // clicking a pick again takes it back
      return;
    }
    this.selection.add(hit.id);
    const ready = () => this.canApply(cmd);
    if (!ready() && !this.couldGrow(cmd)) {
      // The new pick does not go with the earlier ones: start over from it.
      this.selection = new Set([hit.id]);
      if (!ready() && !this.couldGrow(cmd)) {
        this.selection.clear();
        this.toast(`${info.label} needs ${info.need}.`);
        return;
      }
    }
    // A dimension or a measure waits to be placed; everything else applies at once.
    if (!isPlaced(cmd) && ready()) {
      this.run(cmd);
      this.selection.clear();
    }
  }

  /**
   * A constraint button or its key. With fitting geometry already selected it
   * applies straight away; otherwise it becomes the tool and waits for picks.
   */
  private activate(cmd: Command): void {
    if (this.tool === "select" && this.picked().entities > 0 && this.canApply(cmd)) {
      this.showTip(cmd);
      if (isPlaced(cmd)) this.createDimension(undefined, cmd === "measure");
      else this.run(cmd);
      return;
    }
    this.setTool(cmd);
  }

  /**
   * Adds constraints the user asked for. If the sketch no longer solves, or
   * they add nothing new, the sketch is put back and the reason is shown.
   */
  private addManual(drafts: ConstraintDraft[], redundantMessage = "The sketch is already constrained that way.", replacing: Id[] = []): Constraint[] | null {
    const before = clone(this.sk);
    const baseline = this.result;
    // Constraints the new ones say again, and more: they are taken out so the new ones are not refused as repeats.
    if (replacing.length) this.sk.constraints = this.sk.constraints.filter((c) => !replacing.includes(c.id));
    const made = drafts.map((d) => addConstraint(this.sk, d));
    const r = this.solver.solve(this.sk);
    let problem: string | null = null;
    if (r.conflicting.length > baseline.conflicting.length) problem = "That conflicts with constraints already in the sketch.";
    else if (!r.ok) problem = "The solver could not satisfy that constraint from the current shape.";
    else if (r.redundant.length > baseline.redundant.length) problem = redundantMessage;
    if (problem) {
      this.sk = before;
      this.solve();
      this.toast(problem);
      this.touch();
      return null;
    }
    this.result = r;
    this.commit();
    return made;
  }

  /** Applies a constraint to the picked geometry. */
  private run(cmd: Exclude<Command, "dimension" | "measure">): void {
    const info = toolDef(cmd);
    if (!this.canApply(cmd)) {
      this.toast(`${info.label} needs ${info.need}.`);
      return;
    }
    const { pts, lines, rounds } = this.picked();
    const drafts: ConstraintDraft[] = [];
    const replacing: Id[] = [];
    switch (cmd) {
      case "horizontal":
      case "vertical":
        if (lines.length) lines.forEach((l) => drafts.push({ type: cmd, a: l.p1, b: l.p2 }));
        else drafts.push({ type: cmd, a: pts[0].id, b: pts[1].id });
        break;
      case "parallel":
        // Chained pair by pair, so no line collects a marker for every other line.
        lines.slice(1).forEach((l, i) => drafts.push({ type: "parallel", l1: lines[i].id, l2: l.id }));
        break;
      case "perpendicular":
        drafts.push({ type: "perpendicular", l1: lines[0].id, l2: lines[1].id });
        break;
      case "equal": {
        const items: Curve[] = lines.length ? lines : rounds;
        items.slice(1).forEach((e, i) => drafts.push({ type: "equal", a: items[i].id, b: e.id }));
        break;
      }
      case "coincident":
        if (pts.length === 2) drafts.push({ type: "coincident", a: pts[0].id, b: pts[1].id });
        else {
          const on = lines[0] ?? rounds[0];
          if (curvePoints(on).includes(pts[0].id)) return this.toast("That point already belongs to the curve.");
          drafts.push({ type: "pointOn", p: pts[0].id, on: on.id });
        }
        break;
      case "midpoint":
        if (curvePoints(lines[0]).includes(pts[0].id)) return this.toast("An endpoint cannot be the midpoint of its own line.");
        drafts.push({ type: "midpoint", p: pts[0].id, l: lines[0].id });
        // A point already held on the line (a member that ends on it, say) is promoted to its midpoint.
        for (const c of this.sk.constraints) {
          if (c.type === "pointOn" && c.p === pts[0].id && c.on === lines[0].id) replacing.push(c.id);
        }
        break;
      case "tangent":
        // Two circles or arcs touch each other; the first stands where the line would.
        drafts.push(lines.length ? { type: "tangent", l: lines[0].id, c: rounds[0].id } : { type: "tangent", l: rounds[0].id, c: rounds[1].id });
        break;
      case "fixed": {
        const movable = pts.filter((p) => p.id !== ORIGIN);
        if (!movable.length) return this.toast("The origin is always fixed.");
        const loose = movable.filter((p) => !isFixed(this.sk, p.id));
        if (!loose.length) {
          // Every picked point is fixed already: the command releases them.
          const ids = new Set(movable.map((p) => p.id));
          this.sk.constraints = this.sk.constraints.filter((c) => !(c.type === "fixed" && ids.has(c.p)));
          this.solve();
          this.commit();
          return;
        }
        loose.forEach((p) => drafts.push({ type: "fixed", p: p.id }));
        break;
      }
    }
    this.addManual(drafts, undefined, replacing);
  }

  private deleteSelection(): void {
    if (!this.selection.size) return;
    const onlyOrigin = this.selection.size === 1 && this.selection.has(ORIGIN);
    if (onlyOrigin) return this.toast("The origin cannot be deleted.");
    remove(this.sk, this.selection);
    this.selection.clear();
    this.hover = null;
    this.solve();
    this.commit();
  }

  // ---- history, files, view -------------------------------------------------

  private undo(): void {
    const sk = this.history.undo();
    if (!sk) return;
    this.replaceSketch(sk);
    this.autosave();
    this.touch();
  }

  private redo(): void {
    const sk = this.history.redo();
    if (!sk) return;
    this.replaceSketch(sk);
    this.autosave();
    this.touch();
  }

  private newSketch(): void {
    this.selection.clear();
    this.replaceSketch(emptySketch());
    this.commit();
    this.fit();
  }

  /**
   * Saves the drawing, asking where it should go and what it should be called.
   * The file is an SVG of the figure with the drawing inside it: a picture
   * anything can show, which Mech Sketch opens again with everything in it.
   */
  private async save(): Promise<void> {
    const packed = await packDrawing(JSON.stringify(this.whole()));
    void this.saveAs(svgWithDrawing(toSvg(this.figureSketch()) ?? EMPTY_SVG, packed), ".svg", "image/svg+xml", "Mech Sketch drawing (SVG)", "sketch");
  }

  private download(name: string, text: string, type: string): void {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  /**
   * Saves a file in a folder and under a name the user chooses. Where the
   * browser lets a page open its save dialog, that is used: it opens in the
   * folder used last time for the same kind of file. Elsewhere a page cannot
   * pick a folder, so the name is asked for here and the file is downloaded
   * to wherever the browser puts downloads.
   */
  private async saveAs(text: string, ext: string, mime: string, what: string, slot: SaveSlot = "figure"): Promise<void> {
    // A plot is offered its own name each time; the other two remember the name used last.
    const last = slot === "sketch" ? this.sketchName : slot === "plot" ? this.plots.fileName() : this.exportName;
    const clean = (name: string) => {
      let base = name.trim().replace(/[\\/:*?"<>|\u0000-\u001f]/g, "");
      if (base.toLowerCase().endsWith(ext)) base = base.slice(0, -ext.length);
      return base.replace(/[. ]+$/, "");
    };
    const remember = (base: string) => {
      if (slot === "plot") return;
      if (slot === "sketch") this.sketchName = base;
      else this.exportName = base;
      try { localStorage.setItem(slot === "sketch" ? SKETCH_NAME_KEY : EXPORT_NAME_KEY, base); } catch { /* storage unavailable */ }
    };
    type SaveHandle = { name: string; createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }> };
    const picker = (window as unknown as { showSaveFilePicker?: (o: object) => Promise<SaveHandle> }).showSaveFilePicker;
    if (picker) {
      try {
        // The id is what the browser remembers the folder by, so sketches and figures each keep their own.
        const handle = await picker.call(window, {
          id: `mech-sketch-${slot}`, startIn: "documents", suggestedName: last + ext,
          types: [{ description: what, accept: { [mime]: [ext] } }],
        });
        const out = await handle.createWritable();
        await out.write(text);
        await out.close();
        remember(clean(handle.name) || last);
        return this.toast(`Saved ${handle.name}.`);
      } catch (err) {
        if ((err as DOMException)?.name === "AbortError") return; // the dialog was cancelled
        // The dialog is not allowed here (an embedded page, say): fall through to a download.
      }
    }
    const typed = await this.askName(ext, slot === "sketch" ? "Save sketch" : `Export ${what}`, last);
    if (typed === null) return;
    const base = clean(typed) || slot;
    remember(base);
    this.download(base + ext, text, mime);
  }

  /** Asks for a file name in a small dialog. Resolves to null when it is cancelled. */
  private askName(ext: string, title: string, name: string): Promise<string | null> {
    const dialog = $<HTMLDialogElement>("#name-dialog");
    const input = $<HTMLInputElement>("#name-input");
    $("#name-title").textContent = title;
    $("#name-ext").textContent = ext;
    input.value = name;
    return new Promise((resolve) => {
      dialog.addEventListener("close", () => resolve(dialog.returnValue === "ok" ? input.value : null), { once: true });
      dialog.returnValue = "";
      dialog.showModal();
      input.select();
    });
  }

  /**
   * Holds an export back for a few seconds with the Support button on show.
   * The button that finishes the export comes alive when the wait is over;
   * pressing it is what lets the browser save a file or fill the clipboard.
   * Resolves to false when the export is called off.
   */
  private waitToExport(title: string, verb: string): Promise<boolean> {
    const total = this.exportWait * 1000;
    if (!SUPPORT_URL || !(total > 0)) return Promise.resolve(true);
    const dialog = $<HTMLDialogElement>("#export-dialog");
    const go = $<HTMLButtonElement>("#export-go"), bar = $("#export-bar"), wait = $("#export-wait");
    const meter = bar.parentElement!;
    $("#export-title").textContent = title;
    go.textContent = verb;
    go.disabled = true;
    return new Promise((resolve) => {
      const started = performance.now();
      const tick = () => {
        const left = total - (performance.now() - started);
        const done = Math.max(0, Math.min(1, 1 - left / total));
        bar.style.width = `${(done * 100).toFixed(1)}%`;
        meter.setAttribute("aria-valuenow", String(Math.round(done * 100)));
        if (left > 0) {
          const s = Math.ceil(left / 1000);
          wait.textContent = `Ready in ${s} ${s === 1 ? "second" : "seconds"}.`;
          return;
        }
        clearInterval(timer);
        wait.textContent = `Ready. Press ${verb} to finish.`;
        go.disabled = false;
        go.focus();
      };
      const timer = window.setInterval(tick, 100);
      dialog.addEventListener("close", () => {
        clearInterval(timer);
        resolve(dialog.returnValue === "ok");
      }, { once: true });
      dialog.returnValue = "";
      dialog.showModal();
      tick();
    });
  }

  /** Exports the figure. `how` picks the format and whether it is saved or copied. */
  private async exportFigure(how: "svg" | "tikz" | "copy-tikz"): Promise<void> {
    // Each workspace exports what it shows: the figure, or the plot.
    const plotting = this.tab === "plot";
    let text = plotting ? this.plots.exported(how === "svg" ? "svg" : "tikz") : how === "svg" ? toSvg(this.figureSketch()) : toTikz(this.figureSketch());
    if (!text) return this.toast(plotting ? "There is no plot to export yet." : "There is nothing to export yet.");
    // A figure saved to a file carries its drawing, so opening the file brings back everything; a copy for pasting does not.
    if (!plotting && how !== "copy-tikz") {
      const packed = await packDrawing(JSON.stringify(this.whole()));
      text = how === "svg" ? svgWithDrawing(text, packed) : texWithDrawing(text, packed);
    }
    const title = how === "svg" ? "Export SVG" : how === "tikz" ? "Export TikZ" : "Copy TikZ";
    if (!(await this.waitToExport(title, how === "copy-tikz" ? "Copy" : "Save"))) return;
    const slot: SaveSlot = plotting ? "plot" : "figure";
    if (how === "svg") return this.saveAs(text, ".svg", "image/svg+xml", "SVG image", slot);
    if (how === "tikz") return this.saveAs(text, ".tex", "text/x-tex", plotting ? "pgfplots picture" : "TikZ picture", slot);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // No clipboard access (an old browser, or a page not allowed to use it): copy through a text box.
      const box = document.createElement("textarea");
      box.value = text;
      box.style.position = "fixed";
      box.style.opacity = "0";
      document.body.appendChild(box);
      box.select();
      const ok = document.execCommand("copy");
      box.remove();
      if (!ok) return this.toast("Copying is blocked here. Use Export TikZ to save the file instead.");
    }
    this.toast("TikZ copied. Paste it into your document.");
  }

  private async open(file: File): Promise<void> {
    try {
      // A picture comes in to trace over.
      if (/^image\/(png|jpeg|gif|webp|bmp)$/.test(file.type) || /\.(png|jpe?g|gif|webp|bmp)$/i.test(file.name)) return await this.importPicture(file);
      const got = await readOpened(await file.text());
      if (got.kind === "none") return this.toast(got.why);
      // Any other SVG is a drawing to annotate: its lines come in as a sketch of their own.
      if (got.kind === "svg") return this.importDrawing(await file.text(), file.name);
      const sk = deserialize(got.json);
      // Saved again, it is offered its own name.
      const name = file.name.replace(/\.(json|svg|tex)$/i, "").trim();
      if (name) {
        this.sketchName = name;
        try { localStorage.setItem(SKETCH_NAME_KEY, name); } catch { /* storage unavailable */ }
      }
      this.selection.clear();
      this.replaceSketch(sk);
      this.commit();
      this.fit();
      if (this.tab === "plot") this.plots.fit();
    } catch (err) {
      this.toast(err instanceof SyntaxError ? "That file is not valid JSON." : (err as Error).message);
    }
  }

  private resize(): void {
    const r = this.stage.getBoundingClientRect();
    this.view.w = Math.max(50, r.width);
    this.view.h = Math.max(50, r.height);
    this.svg.setAttribute("viewBox", `0 0 ${this.view.w} ${this.view.h}`);
    this.plots.resize(this.view.w, this.view.h);
    this.render();
  }

  /** Zooms so the whole figure, with room for its dimensions, is in view. */
  private fit(): void {
    // Keep the figure clear of the title block in the bottom corner.
    const reserved = Math.min(this.titleblock.offsetHeight + 20, this.view.h / 3);
    const usable = this.view.h - reserved;
    // The print preview shows the page the figure is exported on, with its size written under it.
    this.fig = this.preview ? fitFigure(this.figureSketch()) : null;
    if (this.fig) {
      const { page, mm } = this.fig;
      const bw = (page.x1 - page.x0) / mm, bh = (page.y1 - page.y0) / mm;
      const caption = 34;
      this.view.scale = Math.min((this.view.w - 48) / bw, (usable - 24 - caption) / bh);
      this.view.cx = (page.x0 + page.x1) / 2 / mm;
      this.view.cy = (page.y0 + page.y1) / 2 / mm - (reserved + caption) / 2 / this.view.scale;
      return this.render();
    }
    // Twice: how much room axes take in the drawing depends on the zoom being worked out.
    for (let pass = 0; pass < 2; pass++) {
      const mm = this.mm();
      const b = geometryBox(this.sk);
      // The other sketches on show are in view too.
      for (const p of this.otherParts()) {
        if (p.info.hidden) continue;
        const o = geometryBox(p.sk);
        if (!boxIsEmpty(o)) { grow(b, [o.x0, o.y0]); grow(b, [o.x1, o.y1]); }
      }
      // Axes and balloons placed away from the geometry belong in view too.
      for (const s of this.sk.symbols) {
        if (s.type === "frame") grow(b, symbolPosition(this.sk, s), boxIsEmpty(b) ? 0 : Math.max(s.xSize, s.ySize));
        if (s.type === "balloon") grow(b, add(balloonAnchor(this.sk, s), [s.dx, s.dy]));
        if (s.type === "note") grow(b, [s.x, s.y]);
        if (isLoad(s)) for (const q of loadReach(this.sk, s)) grow(b, q);
        if (s.type === "diagram") for (const part of diagramShape(this.sk, s)?.parts ?? []) for (const line of part.lines) for (const q of line) grow(b, q);
        if (s.type === "trace") for (const part of traceShape(this.sk, s) ?? []) for (const run of part.runs) for (const q of run) grow(b, q);
      }
      if (boxIsEmpty(b) || (b.x1 - b.x0 < 1e-9 && b.y1 - b.y0 < 1e-9)) {
        this.view.cx = 0;
        this.view.cy = 0;
        this.view.scale = DEFAULT_SCALE;
        break;
      }
      const bw = b.x1 - b.x0, bh = b.y1 - b.y0;
      if (this.preview) {
        // Annotations grow with the view here, so the room they need is a share of the figure.
        const margin = 18 / mm;
        this.view.scale = Math.min(this.view.w / (bw + 2 * margin), usable / (bh + 2 * margin));
      } else {
        // While editing they keep their size on screen, so the room is a fixed number of pixels.
        const pad = 18 * EDIT_PX_PER_MM * this.editScale;
        const fitTo = (px: number, extent: number) => (extent > 1e-9 ? Math.max(px - 2 * pad, px * 0.25) / extent : Infinity);
        this.view.scale = Math.min(fitTo(this.view.w, bw), fitTo(usable, bh));
      }
      this.view.cx = (b.x0 + b.x1) / 2;
      this.view.cy = (b.y0 + b.y1) / 2 - reserved / 2 / this.view.scale;
    }
    this.render();
  }

  /**
   * Switches the print preview on or off. Going in, the view is fitted to the
   * figure as it prints; coming back, it returns to where it was.
   */
  private setPreview(on: boolean): void {
    if (on === this.preview) return;
    this.closeEditor();
    this.preview = on;
    if (on) this.showTip("preview");
    else if (this.tip?.id === "preview") this.closeTip();
    if (on) {
      this.viewBeforePreview = { ...this.view };
      this.fit();
    } else if (this.viewBeforePreview) {
      const { cx, cy, scale } = this.viewBeforePreview;
      Object.assign(this.view, { cx, cy, scale });
      this.viewBeforePreview = null;
    }
    this.touch();
  }

  // ---- chrome ---------------------------------------------------------------

  private buildToolbars(): void {
    $("#tabs").innerHTML = TABS.map((t) =>
      `<button type="button" role="tab" class="tab${t === "plot" ? " apart" : ""}" data-tab="${t}" id="tab-${t}" aria-controls="ribbon"${t === "plot" ? ` title="Plot functions: a workspace of its own beside the sketch"` : ""}>${TAB_NAMES[t]}</button>`,
    ).join("");
    $("#view-actions").innerHTML =
      `<button type="button" class="icon-btn" data-act="undo" aria-label="Undo" title="Undo (Ctrl+Z)">${icon("undo")}</button>` +
      `<button type="button" class="icon-btn" data-act="redo" aria-label="Redo" title="Redo (Ctrl+Y)">${icon("redo")}</button>` +
      `<span class="rule"></span>` +
      // A plain link, so it opens in the browser like any other; it is left out until there is somewhere to send people.
      (SUPPORT_URL ? `<a class="icon-btn support" href="${esc(SUPPORT_URL)}" target="_blank" rel="noopener noreferrer" aria-label="Support Mech Sketch" title="Support Mech Sketch with a donation">${icon("heart")}</a>` : "") +
      `<div class="menu">` +
      `<button type="button" class="icon-btn" id="view-btn" data-menu="view" aria-label="View settings" title="View settings" aria-haspopup="true" aria-expanded="false" aria-controls="view-list">${icon("sliders")}</button>` +
      `<div class="menu-list popover" id="view-list" role="group" aria-labelledby="view-btn" hidden>` +
      `<label class="pop-row" title="Double-click for 100%."><span>Dimension size while editing</span>` +
      `<span class="pop-ctl"><input id="edit-scale" type="range" min="${EDIT_SCALE_MIN}" max="${EDIT_SCALE_MAX}" step="5" value="100">${numberBox('id="edit-scale-num"', "100 %", "Dimension size while editing")}</span></label>` +
      `<p class="pop-note">How large text, arrows and symbols look on screen while you draw. The size in print is set in the corner box.</p>` +
      `<label class="check pop-check pop-rule"><input id="tips-on" type="checkbox"><span>Show a tip the first time a tool is used</span></label>` +
      `<button type="button" class="linkish" data-act="tips-reset">Show the tips again from the start</button>` +
      `<p class="pop-note pop-build">${esc(buildLabel())}</p>` +
      `</div></div>` +
      `<button type="button" class="icon-btn" data-act="preview" aria-label="Print preview" title="Print preview: hide everything that is not exported (Q)">${icon("eye")}</button>` +
      `<button type="button" class="icon-btn" data-act="origin" aria-label="Show origin axes" title="Show or hide the axes at the origin">${icon("frame")}</button>` +
      `<button type="button" class="icon-btn" data-act="fit" aria-label="Zoom to fit" title="Zoom to fit (0)">${icon("fit")}</button>` +
      (REPORT_EMAIL ? `<button type="button" class="icon-btn" data-act="report" aria-label="Report a bug or suggest something" title="Report a bug or suggest something">${icon("report")}</button>` : "") +
      `<button type="button" class="icon-btn" data-act="help" aria-label="Help" title="How to use Mech Sketch">${icon("help")}</button>`;
    this.buildRibbon();
    this.showEditScale();
    this.showTipsSetting();
  }

  /** Puts the editing size on its slider. */
  private showEditScale(): void {
    const percent = Math.round(this.editScale * 100);
    $<HTMLInputElement>("#edit-scale").value = String(percent);
    showInBox($("#edit-scale").parentElement, `${percent} %`);
  }

  /** Sets how large annotations are on screen while editing, from the slider's percentage. */
  private setEditScale(percent: number, save: boolean): void {
    if (!Number.isFinite(percent)) return;
    this.editScale = Math.max(EDIT_SCALE_MIN, Math.min(EDIT_SCALE_MAX, percent)) / 100;
    this.showEditScale();
    // It only shows while editing, so the print preview is left.
    if (this.preview) this.setPreview(false);
    if (save) {
      try { localStorage.setItem(EDIT_SCALE_KEY, String(this.editScale)); } catch { /* storage unavailable */ }
    }
    this.closeEditor();
    this.render();
  }

  /** The ribbon shows the tools of the open tab, in groups. */
  private buildRibbon(): void {
    if (this.tab === "plot") {
      const bar = $("#ribbon");
      bar.innerHTML = this.plots.ribbonHtml();
      bar.setAttribute("aria-labelledby", "tab-plot");
      bar.dataset.shown = "plot";
      return;
    }
    const tools = TOOLS.filter((t) => t.tab === this.tab || t.tab === "both");
    let html = "";
    let group: number | null = null;
    for (const t of tools) {
      if (group !== null && t.group !== group) html += `<span class="ribbon-rule"></span>`;
      group = t.group;
      const attr = t.id === "shift" || t.id === "construction" ? `data-act="${t.id}"` : isCommand(t.id) ? `data-cmd="${t.id}"` : `data-tool="${t.id}"`;
      html += `<button type="button" class="tool" ${attr} aria-label="${t.label}" title="${t.label}${t.key ? ` (${t.key})` : ""}">${icon(t.icon, 22)}<span>${t.short ?? t.label}</span></button>`;
    }
    const ribbon = $("#ribbon");
    ribbon.innerHTML = html;
    ribbon.setAttribute("aria-labelledby", `tab-${this.tab}`);
    ribbon.dataset.shown = this.tab;
  }

  private setTab(tab: Tab): void {
    if (tab === this.tab) return;
    const was = this.tab;
    if (tab === "plot") {
      // The sketch is left as it is, with nothing half done in it.
      if (this.tool !== "select") this.setTool("select");
      this.closeEditor();
      if (this.preview) this.setPreview(false);
    }
    this.tab = tab;
    if (tab === "plot" || was === "plot") {
      $("#app").dataset.workspace = tab === "plot" ? "plot" : "sketch";
      if (this.tip) this.closeTip();
    }
    if (tab === "plot") {
      this.plots.enter();
      this.showTip("plot");
      return this.touch();
    }
    // A tool that lives on the other tab is put down.
    const home = toolDef(this.tool).tab;
    if (home !== "both" && home !== tab) return this.setTool("select");
    this.touch();
  }

  /** The tool or command a key stands for. */
  private keyTool(key: string): ToolDef | undefined {
    return TOOLS.find((t) => t.key === key);
  }

  private updateButtons(): void {
    // The Plot ribbon greys out what needs a plot, so it is drawn afresh each time.
    if ($("#ribbon").dataset.shown !== this.tab || this.tab === "plot") this.buildRibbon();
    document.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach((b) => {
      b.setAttribute("aria-selected", String(b.dataset.tab === this.tab));
    });
    document.querySelectorAll<HTMLButtonElement>("[data-tool], [data-cmd]").forEach((b) => {
      b.setAttribute("aria-pressed", String((b.dataset.tool ?? b.dataset.cmd) === this.tool));
    });
    $<HTMLButtonElement>('[data-act="undo"]').disabled = !this.history.canUndo;
    $<HTMLButtonElement>('[data-act="redo"]').disabled = !this.history.canRedo;
    $<HTMLButtonElement>('[data-act="origin"]').setAttribute("aria-pressed", String(this.sk.showOrigin));
    $<HTMLButtonElement>('[data-act="preview"]').setAttribute("aria-pressed", String(this.preview));
    document.querySelector('#ribbon [data-act="construction"]')?.setAttribute("aria-pressed", String(this.constructing));
  }

  private drawTitleblock(): void {
    const r = this.result;
    let state: string, cls: string, count: string;
    if (this.sk.entities.length <= 1) { count = "–"; state = "Nothing drawn yet"; cls = ""; }
    else if (r.conflicting.length || !r.ok) { count = "!"; state = "Constraints conflict"; cls = "bad"; }
    else if (r.dof === 0) { count = "0"; state = "Fully constrained"; cls = "done"; }
    else { count = String(r.dof); state = r.dof === 1 ? "degree of freedom left" : "degrees of freedom left"; cls = "free"; }

    const width = formatNumber(Number((this.sk.figureWidthMm / 10).toFixed(2)));
    const percent = Math.round(this.sk.dimScale * 100);
    const busy = this.titleblock.contains(document.activeElement) && document.activeElement?.tagName === "INPUT";
    if (busy) {
      // Leave the controls alone while one is in use.
      const dof = this.titleblock.querySelector(".tb-dof");
      if (dof) dof.outerHTML = this.dofCell(count, state, cls);
      return;
    }
    this.titleblock.innerHTML =
      this.dofCell(count, state, cls) +
      `<label class="tb-cell tb-size" title="How large text, arrows and symbols are in the exported figure. Double-click for 100%."><span class="tb-k">Dimension size in print</span>` +
      `<span class="tb-v"><input id="dim-scale" data-scale="dim" type="range" min="${DIM_SCALE_MIN}" max="${DIM_SCALE_MAX}" step="5" value="${percent}" aria-valuetext="${percent}%">${numberBox('data-scale="dim-num"', `${percent} %`, "Dimension size in print")}</span></label>` +
      `<label class="tb-cell" title="How wide the exported figure is: everything in it, with a 5 % margin all round."><span class="tb-k">Figure width</span><span class="tb-v"><input id="fig-width" data-scale="width" type="text" inputmode="decimal" value="${width}"> cm</span></label>`;
  }

  private dofCell(count: string, state: string, cls: string): string {
    return `<div class="tb-cell tb-dof ${cls}"><span class="tb-count">${count}</span><span class="tb-state">${state}</span></div>`;
  }

  private describe(c: Constraint): string {
    if (isDimension(c) && c.measure) return `Measure ${this.shownValue(c)}${c.type === "angle" ? "°" : ""}`;
    if (isDimension(c)) {
      const unit = c.type === "angle" ? "°" : "";
      const label = c.label?.trim() ? ` shown as ${c.label.trim()}` : "";
      return `${RELATION_NAMES[c.type]} ${this.shownValue(c)}${unit}${label}`;
    }
    if (c.type === "turn") return `${RELATION_NAMES[c.type]}, ${formatNumber(Number((c.angle / DEG).toFixed(3)))}° apart`;
    return RELATION_NAMES[c.type];
  }

  private constraintRows(list: Constraint[]): string {
    if (!list.length) return "";
    const bad = new Set(this.result.conflicting), extra = new Set(this.result.redundant);
    return `<ul class="rows">${list.map((c) => {
      const flag = bad.has(c.id) ? `<span class="flag bad">conflicts</span>` : extra.has(c.id) ? `<span class="flag extra">redundant</span>` : "";
      const ico = isDimension(c) ? "dimension" : c.type;
      return `<li><button type="button" class="row" data-select="${c.id}">${icon(ico, 16)}<span>${esc(this.describe(c))}</span>${flag}</button>` +
        `<button type="button" class="row-del" data-delete="${c.id}" aria-label="Delete ${esc(this.describe(c))}" title="Delete">${icon("trash", 16)}</button></li>`;
    }).join("")}</ul>`;
  }

  /** What stands beside a hatching slider: the stroke length in the drawing's units, or the number of strokes. */
  private hatchLabel(s: Extract<Sym, { type: "hatch" }>, which: "depth" | "freq"): string {
    if (which === "depth") return this.inUnits(s.depth, 3);
    const n = hatchCount(curveLength(this.sk, s.on), s.spacing);
    return `${n} ${n === 1 ? "stroke" : "strokes"}`;
  }

  /** What stands beside a load's size slider: how large it is drawn, in the drawing's units. */
  private loadSizeLabel(s: AnyLoad): string {
    const magnitude = s.type === "lineload" ? Math.max(s.q1, s.q2) : s.value;
    return this.inUnits(magnitude * loadScaleOf(this.sk, loadKind(s)), 3);
  }

  /** What stands beside the gaps slider: the number asked for, and the number drawn when fewer fit. */
  private gapsLabel(s: Extract<Sym, { type: "centermark" }>): string {
    const asked = s.gaps ?? 2;
    if (s.solid) return "none";
    const f = roundFrame(this.sk, s.on, this.mm());
    const drawn = f ? 2 * centerMarkDashes(s, f.r).shorts : asked;
    return drawn < asked ? `${asked} (${drawn} fit)` : String(asked);
  }

  /** The slider that sets how large every support is drawn. */
  private supportSizeField(): string {
    const pct = Math.round((this.sk.supportScale ?? 1) * 100);
    return `<label class="field"><span>Size of the supports</span><span class="slider-row"><input data-field="support-scale" type="range" min="${SUPPORT_SCALE_MIN}" max="${SUPPORT_SCALE_MAX}" step="5" value="${pct}">${numberBox('data-num="support-scale"', `${pct} %`, "Size of the supports")}</span>` +
      `<small>For every support in the sketch, and for nothing else: the size sliders in the corner still scale them along with the rest. Double-click the slider to go back to 100 %.</small></label>`;
  }

  /** `extra` goes in above the Delete button. */
  private symbolPanel(s: Sym, extra = ""): string {
    const degrees = (angle: number) => formatNumber(Number((angle / DEG).toFixed(2)));
    /** A field of text; `tex` says it takes TeX math, which shows typeset while it is not being typed in. */
    const text = (label: string, field: string, value: string, note = "", tex = false) =>
      `<label class="field"><span>${label}</span><input data-field="${field}" type="text" spellcheck="false" value="${esc(value)}"${tex ? ` data-tex="math"` : ""}>${note ? `<small>${note}</small>` : ""}</label>`;
    const number = (label: string, field: string, value: string, note = "") =>
      `<label class="field"><span>${label}</span><input data-field="${field}" type="text" inputmode="decimal" value="${value}">${note ? `<small>${note}</small>` : ""}</label>`;
    const slider = (label: string, field: string, min: number, max: number, step: number, value: number, shown: string, note = "", off = false) =>
      `<label class="field"><span>${label}</span><span class="slider-row"><input data-field="${field}" type="range" min="${min}" max="${max}" step="${step}" value="${value}"${off ? " disabled" : ""}>${numberBox(`data-num="${field}"`, shown, label, off)}</span>${note ? `<small>${note}</small>` : ""}</label>`;
    const rotate = `<button type="button" class="plain" data-act="rotate">Rotate 90° (R)</button>`;
    let html = "";

    switch (s.type) {
      case "support": {
        const kinds: [SupportKind, string][] = [["pin", "Pin"], ["roller", "Roller"], ["fixed", "Fixed"]];
        html += `<h2>${SUPPORT_NAMES[s.kind]}</h2>`;
        html += `<div class="field"><span id="kind-label">Kind</span><div class="segmented" role="group" aria-labelledby="kind-label">${kinds.map(([k, name]) =>
          `<button type="button" data-kind="${k}" aria-pressed="${s.kind === k}">${name}</button>`).join("")}</div></div>`;
        html += number("Rotation (degrees)", "sym-angle", degrees(s.angle), "At 0 the ground is below the joint. Dragging the support around its joint turns it too.");
        html += rotate;
        html += this.supportSizeField();
        html += `<p class="muted note-block">Supports are drawn only. To hold a joint in place, fix the point.</p>`;
        break;
      }
      case "frame":
        html += `<h2>Coordinate axes</h2>`;
        html += text("First axis label", "sym-xlabel", s.xLabel, "", true);
        html += text("Second axis label", "sym-ylabel", s.yLabel, "Written as TeX math. Leave empty for no label. Clicking a label on the drawing edits it there.", true);
        html += number("First axis length (in the drawing's units)", "sym-xsize", this.inUnits(s.xSize));
        html += number("Second axis length (in the drawing's units)", "sym-ysize", this.inUnits(s.ySize), "Set a length to 0 to leave that axis out. The lengths belong to the drawing: neither size slider changes them.");
        html += number("Rotation (degrees)", "sym-angle", degrees(s.angle));
        html += rotate;
        html += `<p class="muted note-block">Drag an arrow tip to make that axis longer or shorter. ${s.at ? "The axes are pinned to a joint and move with it; drag them away to free them." : "Drag the axes anywhere. Dropped on a joint, they stay pinned there."}</p>`;
        break;
      case "centermark":
        html += `<h2>Centre mark</h2>`;
        html += number("Size (1 is the standard mark)", "sym-scale", formatNumber(Number((s.scale ?? 1).toFixed(2))), "Scales the short dashes, the gaps and how far the lines run past the rim. Dragging an end of the mark sets this too.");
        html += `<label class="check"><input data-field="sym-segmented" type="checkbox"${s.solid ? "" : " checked"}><span>Segmented, like a centre line</span></label>`;
        html += slider("Gaps on each line", "sym-gaps", 2, CENTRE_GAPS_MAX, 2, s.gaps ?? 2, this.gapsLabel(s),
          "Long and short dashes in turn. A small mark is drawn with as many as fit.", !!s.solid);
        html += number("Rotation (degrees)", "sym-angle", degrees(s.angle), "Dragging the mark by its middle turns it too.");
        html += rotate;
        break;
      case "balloon": {
        const ends: [LeaderEnd, string][] = [["arrow", "Arrow"], ["dot", "Dot"], ["none", "Plain"]];
        html += `<h2>Balloon</h2>`;
        html += text("Text", "sym-text", s.text, "A part number, or any TeX math. Clicking it on the drawing edits it there.", true);
        html += `<div class="field"><span id="end-label">Leader ends in</span><div class="segmented" role="group" aria-labelledby="end-label">${ends.map(([e, name]) =>
          `<button type="button" data-end="${e}" aria-pressed="${s.end === e}">${name}</button>`).join("")}</div></div>`;
        const frames: [BalloonFrame, string][] = [["circle", "Circle"], ["box", "Box"], ["underline", "Underline"], ["none", "None"]];
        html += `<div class="field"><span id="frame-label">Around the text</span><div class="segmented wrap" role="group" aria-labelledby="frame-label">${frames.map(([f, name]) =>
          `<button type="button" data-frame="${f}" aria-pressed="${(s.frame ?? "circle") === f}">${name}</button>`).join("")}</div></div>`;
        html += `<p class="muted note-block">Drag the balloon to move it; its leader keeps pointing at the same spot. Drag the handle at the tip of the leader to point it at something else: a joint, a spot on a curve, or anywhere.</p>`;
        break;
      }
      case "picture": {
        html += `<h2>Picture to trace over</h2>`;
        html += `<p class="muted note-block">${esc(s.name)}. It is shown under the other sketches while you work on them, and never in the figure. Drag it to move it and its top right corner to scale it. There is no need to scale it to size: the first dimension you give what you trace sets the scale.</p>`;
        const pct = Math.round((s.opacity ?? PICTURE_OPACITY) * 100);
        html += slider("Strength", "sym-opacity", 10, 100, 5, pct, `${pct} %`, "How strongly it shows. Faint is easier to trace over.");
        html += number("Width (in the drawing's units)", "sym-width", this.inUnits(s.w, 6));
        break;
      }
      case "etalon":
        html += `<h2>Etalon</h2>`;
        html += text("Name", "sym-label", s.label, "What the bar is worth, as TeX math: 1\\,\\mathrm{m}, or 10\\,\\mathrm{kN} for forces drawn at a scale. Left empty, it shows its length in the drawing's units. Clicking it on the drawing edits it there.", true);
        html += number("Length (in the drawing's units)", "sym-length", this.inUnits(s.length, 6), "Dragging the handle at its far end sets this too, at a round length; hold Alt for any length.");
        html += number("Parts", "sym-parts", String(Math.max(1, Math.round(s.parts ?? 1))), "Marks it off into equal parts with shorter ticks, as on a ruler. 1 has ticks at the ends only.");
        html += number("Rotation (degrees)", "sym-angle", degrees(s.angle));
        html += rotate;
        html += `<p class="muted note-block">Drag the bar to move it.</p>`;
        break;
      case "rightangle": {
        html += `<h2>Right angle</h2>`;
        html += `<label class="check"><input data-field="sym-dot" type="checkbox"${s.dot ? " checked" : ""}><span>A dot inside the square</span></label>`;
        html += `<button type="button" class="plain" data-act="ra-corner">Move it to the next corner</button>`;
        const f = rightAngleFrame(this.sk, s, 1);
        const held = this.sk.constraints.some((c) => c.type === "perpendicular" && ((c.l1 === s.l1 && c.l2 === s.l2) || (c.l1 === s.l2 && c.l2 === s.l1)));
        const angle = f ? Math.acos(Math.max(-1, Math.min(1, Math.abs(dot(f.u1, f.u2))))) / DEG : 0;
        if (held) html += `<p class="muted note-block">The two lines are held at a right angle by a Perpendicular constraint.</p>`;
        else {
          html += `<p class="muted note-block">${Math.abs(angle - 90) < 0.05 ? "The two lines are at a right angle now. The mark is only drawn: it holds nothing." : `The two lines are at ${formatNumber(Number(angle.toFixed(2)))}°, not at a right angle.`}</p>`;
          html += `<button type="button" class="plain" data-act="ra-perp">Hold them at a right angle</button>`;
        }
        break;
      }
      case "fill":
        html += `<h2>Fill</h2>`;
        html += `<div class="field"><span id="colour-label">Colour</span><div class="swatches" role="group" aria-labelledby="colour-label">${FILL_COLORS.map((c) =>
          `<button type="button" class="swatch" data-color="${c}" aria-pressed="${s.color === c}" aria-label="Colour ${c}" title="${c}" style="background:${c}"></button>`).join("")}` +
          `<label class="swatch custom" title="Another colour"><input data-field="sym-color" type="color" value="${esc(s.color)}" aria-label="Another colour"></label></div></div>`;
        if (s.holes.length) html += `<p class="muted note-block">${s.holes.length === 1 ? "The circle inside is" : "The circles inside are"} left unfilled.</p>`;
        {
          const look = s.look ?? "color";
          html += `<div class="field"><span id="look-label">Filled with</span><div class="segmented" role="group" aria-labelledby="look-label">` +
            ([["color", "Colour"], ["hatch", "Hatching"], ["both", "Both"]] as const).map(([v, name]) =>
              `<button type="button" data-filllook="${v}" aria-pressed="${look === v}">${name}</button>`).join("") + `</div>` +
            `<small>Hatching is drawn as a cut is: thin strokes across the shape, black over the colour or on their own. The next fill you make is filled the same way.</small></div>`;
          if (s.look) {
            const deg = Math.round(((s.hatchAngle ?? Math.PI / 4) * 180) / Math.PI * 100) / 100;
            html += `<div class="field"><span id="hangle-label">Strokes lean</span><div class="segmented" role="group" aria-labelledby="hangle-label">` +
              `<button type="button" data-hangle="45" aria-pressed="${deg === 45}">45°</button><button type="button" data-hangle="135" aria-pressed="${deg === 135}">135°</button>` +
              `<button type="button" data-hangle="0" aria-pressed="${deg === 0}">0°</button><button type="button" data-hangle="90" aria-pressed="${deg === 90}">90°</button></div></div>`;
            html += number("Angle of the strokes (degrees)", "sym-hangle", formatNumber(deg), "Turn neighbouring parts' hatching different ways so they read apart.");
            const gap = s.hatchGap ?? HATCH_GAP;
            html += slider("Strokes apart (mm in print)", "sym-hgap", 0.5, 6, 0.1, gap, `${formatNumber(gap)} mm`, "Measured on paper: the spacing stays the same however large the drawing is.");
          }
        }
        break;
      case "hatch":
        html += `<h2>Hatching</h2>`;
        html += slider("Stroke size", "sym-depth", 0, 100, 1, ratioPos(s.depth / (curveLength(this.sk, s.on) || 1), HATCH_REACH), this.hatchLabel(s, "depth"),
          "Dragging the hatching away from the curve sets this too.");
        html += slider("Frequency", "sym-freq", 0, 100, 1, ratioPos(hatchCount(curveLength(this.sk, s.on), s.spacing), HATCH_COUNT), this.hatchLabel(s, "freq"),
          "The hatching belongs to the drawing: neither size slider changes it, and it keeps its strokes when you zoom.");
        html += `<button type="button" class="plain" data-act="flip">Move to the other side</button>`;
        html += `<button type="button" class="plain" data-act="lean">Lean the strokes the other way</button>`;
        break;
      case "diagram": {
        const plots = this.sk.plots ?? [];
        const shape = diagramShape(this.sk, s);
        const height = shape?.peak ? Math.abs(shape.peak.v) * s.scale : 0;
        const pick = (label: string, id: string, options: [string, string, boolean][]) =>
          `<div class="field"><span id="${id}-label">${label}</span><div class="segmented wrap" role="group" aria-labelledby="${id}-label">${options.map(([attr, name, on]) =>
            `<button type="button" ${attr} aria-pressed="${on}">${name}</button>`).join("")}</div></div>`;
        const check = (label: string, field: string, on: boolean) => `<label class="check"><input data-field="${field}" type="checkbox"${on ? " checked" : ""}><span>${label}</span></label>`;
        const plain = (v: number) => formatNumber(Number(v.toPrecision(6)));
        html += `<h2>Diagram</h2>`;
        html += `<label class="field"><span>Plot</span><select data-field="sym-plot">${plots.map((p) =>
          `<option value="${p.id}"${p.id === s.plot ? " selected" : ""}>${esc(p.name || "Plot")}</option>`).join("")}</select>` +
          `<small>The functions, their colours and their line styles are the plot's own. Its range is stretched over the member.</small></label>`;
        html += `<button type="button" class="plain" data-act="edit-plot">Edit this plot</button>`;
        html += slider("Height", "sym-height", 0, 100, 1, ratioPos(height / (shape?.base.length || 1), DIAGRAM_SIZE), this.diagramHeightLabel(s),
          "How far the largest value is set off from the member, in the drawing's units. Dragging the handle at the peak sets it too.", !shape?.peak);
        html += pick("The plot runs from", "back", [[`data-back="0"`, "The start", !s.back], [`data-back="1"`, "The far end", !!s.back]]);
        if (s.axis || beamAxis(this.sk, s.on)) html += pick("Drawn along", "along", [[`data-along="axis"`, "The middle of the beam", !!s.axis], [`data-along="edge"`, "This edge", !s.axis]]);
        html += number("Covers the member from (%)", "sym-t0", plain(s.t0 * 100));
        html += number("to (%)", "sym-t1", plain(s.t1 * 100), "Dragging an end of the diagram along the member sets these too.");
        html += check("Shade the area", "sym-shade", !s.plain);
        html += check("Draw strokes across it", "sym-strokes", !!s.strokes);
        if (s.strokes) html += slider("Number of strokes", "sym-count", 1, DIAGRAM_STROKES_MAX, 1, s.strokes, String(s.strokes));
        html += check("Write the values at the ends, jumps and peaks", "sym-values", !!s.values);
        html += check("Close the ends down to the member", "sym-closed", !!s.closed);
        html += `<button type="button" class="plain" data-act="flip">Move to the other side</button>`;
        break;
      }
      case "trace": {
        const plots = this.sk.plots ?? [];
        const plot = plots.find((p) => p.id === s.plot);
        html += `<h2>Diagram at a point</h2>`;
        html += `<label class="field"><span>Plot</span><select data-field="sym-plot">${plots.map((p) =>
          `<option value="${p.id}"${p.id === s.plot ? " selected" : ""}>${esc(p.name || "Plot")}</option>`).join("")}</select>` +
          `<small>Its curves given by a parameter are drawn with the point as their origin, in the plot's colours and line styles.${plot && !plot.curves.some((c) => c.param) ? " This plot has none." : ""}</small></label>`;
        html += `<button type="button" class="plain" data-act="edit-plot">Edit this plot</button>`;
        html += number("One unit of the plot is", "sym-unit", this.inUnits(s.scale, 6), "This long in the drawing.");
        html += number("Rotation (degrees)", "sym-angle", degrees(s.angle ?? 0), "Of the plot's x axis, anticlockwise. Dragging the curves round the point turns them too.");
        if (plot?.curves.some((c) => c.param && c.fill)) html += `<label class="check"><input data-field="sym-shade" type="checkbox"${s.plain ? "" : " checked"}><span>Shade what the plot shades</span></label>`;
        html += `<p class="muted note-block">Moving the point moves the curves with it.</p>`;
        break;
      }
      case "load":
      case "lineload":
      case "moment": {
        const kind = loadKind(s);
        const which = { force: "loads", line: "distributed loads", moment: "moments" }[kind];
        const magnitude = s.type === "lineload" ? Math.max(s.q1, s.q2) : s.value;
        const size = magnitude * loadScaleOf(this.sk, kind);
        const plain = (v: number) => formatNumber(Number(v.toPrecision(6)));
        const colours = `<div class="field"><span id="colour-label">Colour</span><div class="swatches" role="group" aria-labelledby="colour-label">${LOAD_COLORS.map((c) =>
          `<button type="button" class="swatch" data-color="${c}" aria-pressed="${s.color === c}" aria-label="Colour ${c}" title="${c}" style="background:${c}"></button>`).join("")}` +
          `<label class="swatch custom" title="Another colour"><input data-field="sym-color" type="color" value="${esc(s.color)}" aria-label="Another colour"></label></div></div>`;
        const sizeSlider = slider(`Size (all ${which} together)`, "sym-size", 0, 100, 1, ratioPos(size / (geometryExtent(this.sk) || 1), LOAD_SIZE), this.loadSizeLabel(s),
          `Every one of the ${which} is drawn at one scale, so their sizes compare as their magnitudes do. This sets that scale; it belongs to the drawing, and neither size slider changes it.`, magnitude <= 0);
        const choice = (label: string, id: string, options: [string, string, boolean][]) =>
          `<div class="field"><span id="${id}-label">${label}</span><div class="segmented wrap" role="group" aria-labelledby="${id}-label">${options.map(([attr, name, on]) =>
            `<button type="button" ${attr} aria-pressed="${on}">${name}</button>`).join("")}</div></div>`;
        html += `<h2>${LOAD_TITLE[s.type]}</h2>`;
        html += text("Name", "sym-label", s.label, "Written as TeX math, such as F_1 or 10\\,\\mathrm{kN}. Leave empty for none. On the drawing, click the name to type it there and drag it to move it.", true);
        if (s.type === "lineload") {
          html += number("Magnitude at the start", "sym-q1", plain(s.q1));
          html += number("Magnitude at the end", "sym-q2", plain(s.q2), "The start is the end of the line that was drawn first. Two different values give a trapezium; 0 at one end brings the load to a point.");
          html += sizeSlider;
          html += slider("Number of arrows", "sym-count", 2, LINE_ARROWS_MAX, 1, s.count, String(s.count));
          html += `<label class="check"><input data-field="sym-shade" type="checkbox"${s.plain ? "" : " checked"}><span>Shade the area under the arrows</span></label>`;
          html += choice("The arrows", "pull", [[`data-pull="0"`, "Point at the line", !s.pull], [`data-pull="1"`, "Point away", !!s.pull]]);
          html += choice("Direction", "square", [[`data-square="1"`, "Square to the line", s.angle === undefined], [`data-square="0"`, "At an angle", s.angle !== undefined]]);
          if (s.angle !== undefined) html += number("Angle the arrows point at (degrees)", "sym-dir", degrees(s.angle), "0 points right, 90 up, -90 down: weight on a sloping beam is -90.");
          html += number("Covers the line from (%)", "sym-t0", plain(s.t0 * 100));
          html += number("to (%)", "sym-t1", plain(s.t1 * 100), "Dragging an end of the load along its line sets these too.");
          if (s.angle === undefined) html += `<button type="button" class="plain" data-act="flip">Move to the other side</button>`;
        } else {
          html += number("Magnitude", "sym-value", plain(s.value), s.type === "load" ? "Sets the length of the arrow." : "Sets the radius of the arc.");
          html += sizeSlider;
          if (s.type === "load") {
            html += choice("Drawn", "pull", [[`data-pull="0"`, "Arriving at the point", !s.pull], [`data-pull="1"`, "Leaving it", !!s.pull]]);
            html += number("Direction it acts in (degrees)", "sym-angle", degrees(s.angle), "0 points right, 90 up, -90 down. Dragging the arrow round its point turns it too.");
          } else {
            html += choice("Turns", "turn", [[`data-turn="ccw"`, "Anticlockwise", !s.cw], [`data-turn="cw"`, "Clockwise", !!s.cw]]);
            html += number("Rotation (degrees)", "sym-angle", degrees(s.angle), "Where the arc starts. Dragging it round its point turns it too.");
          }
          html += rotate;
        }
        html += colours;
        break;
      }
      case "note":
        html += `<h2>Note</h2>`;
        html += text("Text", "sym-text", s.text, "Plain text. Put math between dollar signs, as in $F_1 = 2a$, and \\\\ where a new line starts. Clicking the note on the drawing edits it there; dragging moves it.");
        break;
      case "datum":
        html += `<h2>${s.mass ? "Centre of mass" : "Datum point"}</h2>`;
        html += `<div class="field"><span id="mark-label">Marked with</span><div class="segmented" role="group" aria-labelledby="mark-label">` +
          `<button type="button" data-mass="0" aria-pressed="${!s.mass}">A dot</button><button type="button" data-mass="1" aria-pressed="${!!s.mass}">Centre of mass</button></div></div>`;
        html += text("Name", "sym-label", s.label, "Written as TeX math. Leave empty for none. On the drawing, click the name to type it there and drag it to move it.", true);
        html += `<div class="field"><span id="colour-label">Colour</span><div class="swatches" role="group" aria-labelledby="colour-label">${DATUM_COLORS.map((c) =>
          `<button type="button" class="swatch" data-color="${c}" aria-pressed="${s.color === c}" aria-label="Colour ${c}" title="${c}" style="background:${c}"></button>`).join("")}` +
          `<label class="swatch custom" title="Another colour"><input data-field="sym-color" type="color" value="${esc(s.color)}" aria-label="Another colour"></label></div></div>`;
        html += `<p class="muted note-block">The ${s.mass ? "mark" : "dot"} and its name are part of the exported figure. The point under it is constrained and dimensioned like any other.</p>`;
        html += `<button type="button" class="plain" data-act="undatum">Back to a plain point</button>`;
        break;
    }
    return html + extra + `<button type="button" class="danger" data-act="delete">Delete</button>`;
  }

  private drawPanel(): void {
    const focusField = (document.activeElement as HTMLElement | null)?.dataset?.field;
    const { pts, lines, rounds, beziers, cons, syms, entities } = this.picked();
    let html = "";

    if (this.tool === "arcbeam") {
      html += `<h2>Curved beam</h2>`;
      html += `<div class="field"><span id="beam-label">Ends</span><div class="segmented" role="group" aria-labelledby="beam-label">` +
        `<button type="button" data-beam="round" aria-pressed="${this.beamEnds === "round"}">Round</button>` +
        `<button type="button" data-beam="square" aria-pressed="${this.beamEnds === "square"}">Square</button></div></div>`;
      html += `<ol class="steps"><li>Click the centre the beam bends round.</li><li>Click where the beam starts, sweep round the centre and click where it ends.</li>` +
        `<li>Move towards or away from the centre and click to set the width.</li></ol>`;
      html += `<p class="muted note-block">The beam is made of arcs${this.beamEnds === "round" ? "" : " and lines"} with the constraints that keep its shape. ` +
        `Dimension the distance from the centre to an end of the beam for the bend's radius, and ${this.beamEnds === "round" ? "an end's radius" : "an end"} for the width.</p>`;
    } else if (this.tool === "beam") {
      html += `<h2>Beam</h2>`;
      html += `<div class="field"><span id="beam-label">Ends</span><div class="segmented" role="group" aria-labelledby="beam-label">` +
        `<button type="button" data-beam="round" aria-pressed="${this.beamEnds === "round"}">Round</button>` +
        `<button type="button" data-beam="square" aria-pressed="${this.beamEnds === "square"}">Square</button></div></div>`;
      html += `<ol class="steps"><li>Click where the beam starts and where it ends. Joints that are there already are used.</li>` +
        `<li>Move away from its middle line and click to set the width.</li></ol>`;
      html += `<p class="muted note-block">The beam is made of lines${this.beamEnds === "round" ? " and arcs" : ""} with the constraints that keep its shape. ` +
        `Dimension the distance between its two centres for the length${this.beamEnds === "round" ? ", and an end's radius for the width" : ", and an end for the width"}.</p>`;
    } else if ((this.tool === "pin" || this.tool === "roller" || this.tool === "wall") && !syms.length && !entities && !cons.length) {
      html += `<h2>${SUPPORT_NAMES[this.tool === "wall" ? "fixed" : this.tool]}</h2>`;
      html += `<p class="muted">Click a joint, or a spot on a line, to put the support there.</p>`;
      html += this.supportSizeField();
    } else if (this.tool === "diagram" && !syms.length && !entities && !cons.length) {
      const plots = this.sk.plots ?? [];
      html += `<h2>Diagram</h2>`;
      if (!plots.length) {
        html += `<p class="muted">A diagram lays a plot along a member, the way an internal force diagram is drawn. There is no plot yet: make one on the Plot tab first.</p>` +
          `<button type="button" class="plain" data-tab="plot">Go to the Plot tab</button>`;
      } else {
        const chosen = this.diagramPlot();
        if (plots.length > 1) html += `<label class="field"><span>Plot to lay along the member</span><select data-field="diagram-plot">${plots.map((p) =>
          `<option value="${p.id}"${p.id === chosen?.id ? " selected" : ""}>${esc(p.name || "Plot")}</option>`).join("")}</select></label>`;
        html += `<ol class="steps"><li>Click a line, an arc or a side of a beam, on the side positive values should go.</li>` +
          `<li>Drag the handle at the peak to set the height, and the handles at the ends to cover only part of the member.</li></ol>`;
        if (chosen?.curves.some((c) => c.param)) {
          html += `<p class="muted note-block">${esc(chosen.name || "This plot")} has curves given by a parameter: click a point, and they are drawn with it as their origin.${this.hasFunctions(chosen) ? "" : " A click anywhere else makes a point there."}</p>`;
        }
        html += `<p class="muted note-block">${plots.length > 1 ? "" : `It draws ${esc(chosen?.name || "the plot")}. `}The plot's range is stretched over the member. On a side of a beam the diagram runs along the middle of the beam.</p>`;
      }
    } else if (isCopyTool(this.tool)) {
      html += `<h2>${toolDef(this.tool).label}</h2>`;
      html += this.tool === "mirror"
        ? `<p class="muted">Click the line to mirror the selection about. Points on that line are shared by both halves.</p>` +
          `<p class="muted">The image stays a mirror image: change the original and it follows.</p>`
        : `<p class="muted">Click the point the copies go around. You are then asked how many there should be.</p>` +
          `<p class="muted">The copies stay copies: change the original and they follow.</p>`;
      html += `<p class="muted">Esc returns to Select.</p>`;
    } else if (isCommand(this.tool) && !(cons.length === 1 && isDimension(cons[0]))) {
      const info = toolDef(this.tool);
      html += `<h2>${info.label}</h2>`;
      html += this.tool === "measure"
        ? `<ol class="steps"><li>Click ${info.need}.</li><li>Middle-click, or click empty space, where the measure should go.</li></ol><p class="muted">A measure shows what the geometry measures, in brackets, and changes nothing. Only you see it: it is left out of the print and the exported figure. Drag it like a dimension.</p>`
        : this.tool === "dimension"
        ? `<ol class="steps"><li>Click ${info.need}.</li><li>Middle-click where the dimension should go. Beside the line gives its length; above or below, the horizontal distance; left or right, the vertical one.</li><li>Type the value and press Enter.</li></ol>`
        : this.tool === "fixed"
          ? `<p class="muted">Click a point to fix it in place. Click a fixed point to release it.</p>`
          : `<p class="muted">Click ${info.need}. The constraint is applied as soon as you have picked them.</p>`;
      html += `<p class="muted">Middle-click or Esc returns to Select.</p>`;
    } else if (cons.length === 1 && entities === 0 && !syms.length && isDimension(cons[0]) && cons[0].measure) {
      const d = cons[0];
      const what = d.type === "distance" ? (d.toLine ? "Distance to the line" : d.mode === "aligned" ? "Length" : d.mode === "horizontal" ? "Horizontal distance" : "Vertical distance") : d.type === "angle" ? "Angle" : "Radius";
      html += `<h2>Measure</h2>`;
      html += `<p class="measure-value"><span>${what}</span><b>${this.shownValue(d)}${d.type === "angle" ? "°" : ""}</b></p>`;
      html += `<p class="muted note-block">Shows what the geometry measures now, and follows it as it changes. It drives nothing, and only you see it: it is left out of the print and the exported figure. Drag it to move it.</p>`;
      if (d.type === "distance" && !d.toLine) {
        const modes: [DistanceMode, string][] = [["aligned", "Aligned"], ["horizontal", "Horizontal"], ["vertical", "Vertical"]];
        html += `<div class="field"><span id="mode-label">Measured</span><div class="segmented" role="group" aria-labelledby="mode-label">${modes.map(([m, name]) =>
          `<button type="button" data-mode="${m}" aria-pressed="${d.mode === m}">${name}</button>`).join("")}</div></div>`;
      }
      html += `<button type="button" class="plain" data-act="measure-to-dim" title="A dimension of the value it shows now: it then holds the geometry to it">Make it a dimension</button>`;
      html += `<button type="button" class="danger" data-act="delete">Delete measure</button>`;
    } else if (cons.length === 1 && entities === 0 && !syms.length && isDimension(cons[0])) {
      const d = cons[0];
      html += `<h2>${RELATION_NAMES[d.type]}</h2>`;
      if (d.driven) html += `<p class="muted note-block">Driven: the geometry it measures is fixed, so it shows what that measures and holds nothing. It is in the figure like any other dimension. Typed as the drawing's only length dimension, it sets the scale.</p>`;
      html += `<label class="field"><span>Value${d.type === "angle" ? " (degrees)" : ""}</span><input data-field="value" type="text" inputmode="decimal" value="${this.shownValue(d)}"></label>`;
      html += `<label class="field"><span>Label</span><input data-field="label" type="text" spellcheck="false" placeholder="2a, F_1, \\alpha" value="${esc(d.label ?? "")}" data-tex="math"><small>Shown in the figure instead of the number. Written as TeX math; spaces you type are kept. Clicking the number on the drawing edits it in place.</small></label>`;
      if (d.type === "distance") {
        const modes: [DistanceMode, string][] = [["aligned", "Aligned"], ["horizontal", "Horizontal"], ["vertical", "Vertical"]];
        if (d.toLine) html += `<p class="muted note-block">Measured square to the line, from the point it starts at. Drag it along the lines to move it.</p>`;
        else html += `<div class="field"><span id="mode-label">Measured</span><div class="segmented" role="group" aria-labelledby="mode-label">${modes.map(([m, name]) =>
          `<button type="button" data-mode="${m}" aria-pressed="${d.mode === m}">${name}</button>`).join("")}</div></div>`;
        if (d.mode !== "horizontal") {
          const along = (d.text ?? (d.mode === "aligned" ? "along" : "upright")) === "along";
          html += `<label class="check"><input data-field="along" type="checkbox"${along ? " checked" : ""}><span>Turn the text along the dimension line</span></label>`;
        }
      }
      if (d.type === "radius") {
        html += `<div class="field"><span id="place-label">Drawn</span><div class="segmented" role="group" aria-labelledby="place-label">` +
          `<button type="button" data-place="inside" aria-pressed="${!d.outside}">Inside</button>` +
          `<button type="button" data-place="outside" aria-pressed="${!!d.outside}">Outside</button></div></div>`;
        const shown = d.len !== undefined ? this.inUnits(d.len) : "";
        html += `<label class="field"><span>Arrow length (in the drawing's units)</span><input data-field="radius-len" type="text" inputmode="decimal" value="${shown}" placeholder="${d.outside ? "standard" : "from the centre"}">` +
          `<small>${d.outside ? "Empty: a standard length. " : "Empty: the arrow starts at the centre. "}Dragging the dimension sets the length too, and pulling it across the rim moves it inside or outside.</small></label>`;
      }
      html += `<label class="check"><input data-field="hidden" type="checkbox"${d.hidden ? " checked" : ""}><span>Leave out of the figure</span></label>`;
      html += `<button type="button" class="danger" data-act="delete">Delete dimension</button>`;
    } else if (syms.length === 1 && entities === 0 && !cons.length) {
      html += this.symbolPanel(syms[0]);
    } else if (entities === 1 && pts.length === 1 && !syms.length && !cons.length && this.datumOn(pts[0].id)) {
      // The dot of a datum point is the point itself: show the datum, with what holds the point.
      const attached = this.sk.constraints.filter((c) => constraintRefs(c).includes(pts[0].id));
      const extra = `<p class="muted">x ${this.inUnits(pts[0].x, 6)}, y ${this.inUnits(pts[0].y, 6)}</p>` +
        `<h3>Constraints on the point</h3>${attached.length ? this.constraintRows(attached) : `<p class="muted">None yet.</p>`}`;
      html += this.symbolPanel(this.datumOn(pts[0].id)!, extra);
    } else if (cons.length >= 1 && entities === 0 && !syms.length) {
      html += `<h2>${cons.length === 1 ? RELATION_NAMES[cons[0].type] : `${cons.length} constraints`}</h2>`;
      html += this.constraintRows(cons);
      const only = cons.length === 1 ? cons[0] : null;
      if (only?.type === "turn") {
        html += `<label class="field note-block"><span>Angle between copies (degrees)</span><input data-field="turn-angle" type="text" inputmode="decimal" value="${formatNumber(Number((only.angle / DEG).toFixed(3)))}"></label>`;
      }
      if (only && isLink(only)) {
        const n = only.pairs.length + only.half.length;
        html += `<p class="muted note-block">Holds ${n} ${n === 1 ? "point" : "points"}${only.circles.length ? ` and ${only.circles.length} ${only.circles.length === 1 ? "radius" : "radii"}` : ""} of the ${only.type === "mirror" ? "image" : "copies"} to the original. ` +
          `${only.type === "shift" ? "The spacing is free: drag a copy, or dimension from a point to its copy. " : ""}Delete it to let the ${only.type === "mirror" ? "image" : "copies"} go their own way.</p>`;
      }
      html += `<button type="button" class="danger" data-act="delete">Delete</button>`;
    } else if (entities === 1 && pts.length === 1 && pts[0].id === ORIGIN && !syms.length) {
      html += `<h2>Origin</h2><p class="muted">Fixed at (0, 0). Constrain or dimension geometry against it like any other point. It is not part of the exported figure.</p>`;
      const attached = this.sk.constraints.filter((c) => constraintRefs(c).includes(ORIGIN));
      if (attached.length) html += `<h3>Constraints on the origin</h3>${this.constraintRows(attached)}`;
    } else if (entities > 0 || syms.length) {
      const names: string[] = [];
      const count = (n: number, one: string, many: string) => { if (n) names.push(`${n} ${n === 1 ? one : many}`); };
      count(pts.length, "point", "points");
      count(lines.length, "line", "lines");
      count(rounds.filter((r) => r.type === "circle").length, "circle", "circles");
      count(rounds.filter((r) => r.type === "arc").length, "arc", "arcs");
      count(beziers.length, "Bézier curve", "Bézier curves");
      count(syms.length, "symbol", "symbols");
      html += `<h2>${names.join(", ")}</h2>`;
      if (pts.length === 1 && entities === 1) {
        html += `<p class="muted">x ${this.inUnits(pts[0].x, 6)}, y ${this.inUnits(pts[0].y, 6)}</p>`;
      }
      // Projected from another sketch: where it comes from, and the way to make it this sketch's own.
      const projected = [...pts, ...lines, ...rounds].filter((e) => e.ref);
      if (projected.length) {
        const index = entityIndex(this.drawing, this.sk);
        const lost = projected.some((e) => isOrphan(index, e));
        const from = [...new Set(projected.map((e) => this.sourceName(e.ref!)).filter((n): n is string => !!n))];
        html += `<p class="muted note-block ref-note">${lost
          ? "Projected from a sketch, or from something in it, that has since been deleted: it stays where it was."
          : `Projected from ${esc(from.join(" and "))}: it follows ${from.length > 1 ? "them" : "it"}, and cannot be moved here. It is left out of the figure.`}</p>` +
          `<button type="button" class="plain" data-act="break-ref" title="It stays where it is, as geometry of this sketch that no longer follows its source">Make it this sketch's own</button>`;
      }
      const cs: Curve[] = [...lines, ...rounds, ...beziers];
      if (cs.length) {
        // Arrows, springs and dampers are made with their own tools and keep what they are; the rest can be drawn one way or another.
        const plain = cs.filter((c) => !isNamed(c));
        if (plain.length) {
          const styleOf = (c: Curve): LineStyle => (c.centre ? "centre" : c.dashed ? "dashed" : "solid");
          // Construction lines are not drawn in the figure at all, so no way of drawing them is shown as picked.
          const building = plain.every((c) => c.construction);
          const shared = !plain.some((c) => c.construction) && plain.every((c) => styleOf(c) === styleOf(plain[0])) ? styleOf(plain[0]) : null;
          const styles: LineStyle[] = ["solid", "dashed", "centre"];
          html += `<div class="field"><span id="style-label">Drawn as</span><div class="segmented wrap" role="group" aria-labelledby="style-label">${styles.map((st) =>
            `<button type="button" data-style="${st}" aria-pressed="${shared === st}">${STYLE_NAMES[st]}</button>`).join("")}</div>` +
            `<small>A centre line is thin and dash-dotted.</small></div>`;
          html += `<div class="field"><button type="button" class="plain switch" data-act="set-construction" aria-pressed="${building}">${icon("construction", 18)}<span>Construction line</span></button>` +
            `<small>${building
              ? "Left out of the print and the exported figure. Press it again, or pick how it is drawn above, to put it back in."
              : "Turns the selection into construction lines: dashed here, and left out of the print and the exported figure."}</small></div>`;
        }
        html += this.elementPanel();
        html += this.curveColorField(cs);
        // One slider for all of them; it shows the thickness of the first.
        const plainEdge = (c: Curve) => !c.construction && !c.centre && !(c.type !== "circle" && (c.arrow || c.element));
        const weight = cs[0].weight ?? (plainEdge(cs[0]) && this.sk.lineWeight !== undefined ? this.sk.lineWeight : standardWeight(cs[0]));
        const own = cs.some((c) => c.weight !== undefined);
        html += `<label class="field"><span>Line thickness</span><span class="slider-row"><input data-field="weight" type="range" min="${WEIGHT_MIN}" max="${WEIGHT_MAX}" step="0.1" value="${weight}">${numberBox('data-num="weight"', this.weightLabel(weight), "Line thickness")}</span>` +
          `<small>In points, as LaTeX counts line widths${own ? "" : "; this is the standard thickness"}. It grows and shrinks with the dimension size in print. Double-click the slider to go back to the standard.</small></label>`;
        const only = cs.length === 1 ? cs[0] : undefined;
        const named = isNamed(only) ? only : null;
        if (named?.element) {
          html += `<label class="field"><span>Name</span><input data-field="arrow-label" type="text" spellcheck="false" placeholder="${ELEMENT_HINT[named.element]}" value="${esc(named.label ?? "")}" data-tex="math"><small>Written as TeX math. On the drawing, click the name to type it there and drag it to move it; double-click the ${ELEMENT_TITLE[named.element]} to give it one.</small></label>`;
        }
        const arrow = named?.arrow ? named : null;
        if (arrow) {
          const heads: [ArrowEnds, string][] = arrow.type === "line"
            ? [["end", "End"], ["start", "Start"], ["both", "Both"]]
            : [["end", "Anticlockwise"], ["start", "Clockwise"], ["both", "Both"]];
          html += `<label class="field"><span>Name</span><input data-field="arrow-label" type="text" spellcheck="false" placeholder="${arrow.type === "line" ? "F, \\vec{v}_0" : "M, \\omega"}" value="${esc(arrow.label ?? "")}" data-tex="math"><small>Written as TeX math. On the drawing, click the name to type it there and drag it to move it; double-click the arrow to give it one.</small></label>`;
          html += `<div class="field"><span id="head-label">${arrow.type === "line" ? "Arrowhead at the" : "Points"}</span><div class="segmented wrap" role="group" aria-labelledby="head-label">${heads.map(([h, name]) =>
            `<button type="button" data-head="${h}" aria-pressed="${arrow.arrow === h}">${name}</button>`).join("")}</div></div>`;
        }
      }
      if (entities > 0) {
        const ids = new Set<Id>([...this.selection]);
        for (const c of cs) curvePoints(c).forEach((p) => ids.add(p));
        const attached = this.sk.constraints.filter((c) => constraintRefs(c).some((r) => ids.has(r)));
        html += `<h3>Constraints on the selection</h3>`;
        html += attached.length ? this.constraintRows(attached) : `<p class="muted">None yet.</p>`;
      }
      html += `<button type="button" class="danger" data-act="delete">Delete selection</button>`;
    } else {
      html += `<h2>Nothing selected</h2>`;
      html += this.sketchStyleFields();
      const over = findOverlaps(this.sk);
      const n = over.segments.length + over.rounds.length;
      if (n) html += `<p class="warn">${n === 1 ? "Two curves lie" : `Curves lie in ${n} places`} on top of each other, shown in red. Click there again to step through them and delete the extra one.</p>`;
      if (this.sk.constraints.length) {
        html += `<h3>All constraints</h3>${this.constraintRows(this.sk.constraints)}`;
      } else {
        html += `<ol class="steps"><li><b>Draw.</b> On the Sketch tab, place joints with the Line tool; exact positions do not matter yet.</li>` +
          `<li><b>Constrain.</b> Press a constraint, then click the geometry it applies to. Curves turn black once nothing about them can move.</li>` +
          `<li><b>Dimension.</b> Press Dimension, the first of the constraints, click a line, middle-click where the dimension goes and type its length. The first one only sets the scale; after that, the drawing follows the number.</li>` +
          `<li><b>Annotate.</b> Supports, loads, balloons, fills and hatching are on the Annotate tab.</li></ol>`;
      }
    }
    this.panel.innerHTML = html;
    showTexFields(this.panel);
    if (focusField) this.panel.querySelector<HTMLElement>(`[data-field="${focusField}"]`)?.focus();
  }

  // ---- events ---------------------------------------------------------------

  private bindEvents(): void {
    const svg = this.svg;
    svg.addEventListener("pointerdown", (e) => this.onPointerDown(e));
    svg.addEventListener("pointermove", (e) => this.onPointerMove(e));
    svg.addEventListener("pointerup", (e) => this.onPointerUp(e));
    svg.addEventListener("pointercancel", (e) => this.onPointerUp(e));
    svg.addEventListener("pointerleave", () => {
      if (this.drag) return;
      this.hover = null;
      this.snapMark = null;
      this.render();
    });
    svg.addEventListener("wheel", (e) => this.onWheel(e), { passive: false });
    svg.addEventListener("dblclick", (e) => this.onDoubleClick(e));
    svg.addEventListener("contextmenu", (e) => e.preventDefault());
    // The middle button confirms and pans here; keep the browser from starting
    // its own scroll mode or pasting on it.
    svg.addEventListener("mousedown", (e) => { if (e.button === 1) e.preventDefault(); });
    svg.addEventListener("auxclick", (e) => e.preventDefault());
    new ResizeObserver(() => this.resize()).observe(this.stage);

    document.addEventListener("click", (e) => {
      const btn = (e.target as Element).closest<HTMLElement>("button");
      const menuBtn = btn?.dataset.menu ? btn : null;
      // Any click closes an open menu, other than the one on its own button, which toggles it.
      // A popover holds controls, not commands: clicks inside it leave it open.
      const within = (e.target as Element).closest(".menu-list.popover")?.id;
      for (const open of document.querySelectorAll<HTMLElement>('[data-menu][aria-expanded="true"]')) {
        if (open !== menuBtn && open.getAttribute("aria-controls") !== within) this.setMenu(open, false);
      }
      if (!btn) return;
      const ds = btn.dataset;
      // A click made from the keyboard (detail 0) moves focus into the menu.
      if (menuBtn) return this.setMenu(menuBtn, menuBtn.getAttribute("aria-expanded") !== "true", e.detail === 0);
      if (ds.pact) return this.plots.act(ds.pact, ds);
      if (ds.tab) this.setTab(ds.tab as Tab);
      else if (ds.tool) this.setTool(ds.tool as Tool);
      else if (ds.cmd) this.activate(ds.cmd as Command);
      else if (ds.select) { this.setTool("select"); this.selection = new Set([ds.select]); this.touch(); }
      else if (ds.delete) { remove(this.sk, [ds.delete]); this.pruneSelection(); this.solve(); this.commit(); }
      else if (ds.mode) this.setDimMode(ds.mode as DistanceMode);
      else if (ds.kind) this.setSupportKind(ds.kind as SupportKind);
      else if (ds.style) this.setLineStyle(ds.style as LineStyle);
      else if (ds.coil) this.editElements((look) => { if (ds.coil === "1") look.coil = true; else delete look.coil; });
      else if (ds.mass) this.editSymbol((x) => {
        if (x.type !== "datum") return;
        if (ds.mass === "1") x.mass = true;
        else delete x.mass;
      });
      else if (ds.end) this.editSymbol((x) => { if (x.type === "balloon") x.end = ds.end as LeaderEnd; });
      else if (ds.pull) this.editSymbol((x) => {
        if (x.type !== "load" && x.type !== "lineload") return;
        if (ds.pull === "1") x.pull = true;
        else delete x.pull;
      });
      else if (ds.turn) this.editSymbol((x) => {
        if (x.type !== "moment") return;
        if (ds.turn === "cw") x.cw = true;
        else delete x.cw;
      });
      else if (ds.square) this.editSymbol((x) => {
        if (x.type !== "lineload") return;
        if (ds.square === "1") delete x.angle;
        // Starting out as it is drawn now, so nothing jumps: straight down where that makes sense.
        else x.angle ??= -Math.PI / 2;
      });
      else if (ds.back) this.editSymbol((x) => {
        if (x.type !== "diagram") return;
        if (ds.back === "1") x.back = true;
        else delete x.back;
      });
      else if (ds.along) this.editSymbol((x) => {
        if (x.type !== "diagram") return;
        const axis = ds.along === "axis" ? beamAxis(this.sk, x.on) : null;
        if (axis) x.axis = axis;
        else delete x.axis;
      });
      else if (ds.frame) this.editSymbol((x) => {
        if (x.type !== "balloon") return;
        if (ds.frame === "circle") delete x.frame;
        else x.frame = ds.frame as BalloonFrame;
      });
      else if (ds.filllook) {
        this.fillLook = ds.filllook as "color" | "hatch" | "both";
        this.editSymbol((x) => {
          if (x.type !== "fill") return;
          if (ds.filllook === "color") delete x.look;
          else x.look = ds.filllook as "hatch" | "both";
        });
      }
      else if (ds.hangle) this.editSymbol((x) => {
        if (x.type !== "fill") return;
        const a = (Number(ds.hangle) * Math.PI) / 180;
        if (Math.abs(a - Math.PI / 4) < 1e-9) delete x.hatchAngle;
        else x.hatchAngle = a;
      });
      else if (ds.ccolor) this.setCurveColor(ds.ccolor === "none" ? null : ds.ccolor);
      else if (ds.skcolor) this.setSketchColor(ds.skcolor === "none" ? null : ds.skcolor);
      else if (ds.color) this.setColor(ds.color);
      else if (ds.head) this.setArrowHead(ds.head as ArrowEnds);
      else if (ds.place) this.setRadiusPlace(ds.place === "outside");
      else if (ds.beam) { this.beamEnds = ds.beam as BeamEnds; this.touch(); }
      else if (ds.report) { this.reportKind = ds.report as ReportKind; this.updateReport(); }
      else if (ds.dir) btn.parentElement?.querySelectorAll("[data-dir]").forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
      else if (ds.dialog === "cancel") btn.closest("dialog")?.close("cancel");
      else if (ds.act) this.action(ds.act);
    });

    // Explain a constraint button on hover or focus.
    const explain = (e: Event) => {
      const btn = (e.target as Element).closest?.<HTMLElement>("[data-cmd]");
      if (!btn) return;
      const info = toolDef(btn.dataset.cmd as Tool);
      this.hintOverride = `${info.label}${info.key ? ` (${info.key})` : ""}: press this, then click ${info.need}.`;
      this.render();
    };
    const unexplain = () => { this.hintOverride = null; this.render(); };
    const bar = $("#ribbon");
    bar.addEventListener("mouseover", explain);
    bar.addEventListener("focusin", explain);
    bar.addEventListener("mouseleave", unexplain);
    bar.addEventListener("focusout", unexplain);

    const strip = $("#sheets");
    strip.addEventListener("click", (e) => this.onStrip(e));
    strip.addEventListener("dblclick", (e) => {
      const tab = (e.target as HTMLElement).closest<HTMLElement>(".sheet.on .sheet-name");
      const id = tab?.closest<HTMLElement>("[data-part]")?.dataset.part;
      if (id) this.renameSketch(id);
    });

    this.panel.addEventListener("change", (e) => {
      if (this.tab === "plot") return this.plots.change(e.target as HTMLInputElement | HTMLSelectElement);
      const input = e.target as HTMLInputElement;
      if (input.dataset.num) return this.onSliderNumber(input.dataset.num, input.value);
      this.onPanelChange(input);
    });
    this.panel.addEventListener("input", (e) => {
      const input = e.target as HTMLInputElement;
      // A plot follows its fields as they are typed in; a list of choices acts when one is chosen.
      if (this.tab === "plot") { if (input.tagName !== "SELECT") this.plots.change(input, true); return; }
      if (input.type === "range") this.onPanelChange(input, true);
    });
    this.panel.addEventListener("dblclick", (e) => {
      const input = e.target as HTMLInputElement;
      const field = input.dataset?.field;
      if (field !== "weight" && field !== "support-scale" && field !== "sketch-weight") return;
      input.blur();
      if (field === "weight") return this.resetWeight();
      if (field === "sketch-weight") { delete this.sk.lineWeight; return this.commit(); }
      delete this.sk.supportScale;
      this.commit();
    });
    // A slider let go with the mouse gives the keyboard back to the drawing; moved with the arrow keys, it keeps it.
    this.panel.addEventListener("pointerup", (e) => {
      const input = e.target as HTMLInputElement;
      if (input.type === "range") input.blur();
    });
    const editScale = $<HTMLInputElement>("#edit-scale");
    editScale.addEventListener("input", () => this.setEditScale(Number(editScale.value), false));
    editScale.addEventListener("change", () => this.setEditScale(Number(editScale.value), true));
    editScale.addEventListener("dblclick", () => this.setEditScale(100, true));
    const editScaleBox = $<HTMLInputElement>("#edit-scale-num");
    editScaleBox.addEventListener("change", () => {
      const v = parseNumber(editScaleBox.value);
      if (Number.isFinite(v) && v >= EDIT_SCALE_MIN && v <= EDIT_SCALE_MAX) this.setEditScale(v, true);
      else this.toast(`The size while editing is between ${EDIT_SCALE_MIN} and ${EDIT_SCALE_MAX} %.`);
      this.showEditScale();
    });
    editScaleBox.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") editScaleBox.blur(); });

    // The slider acts as it moves. What it changes only shows in print, so the preview comes on with it.
    this.titleblock.addEventListener("input", (e) => {
      const input = e.target as HTMLInputElement;
      if (input.dataset.scale !== "dim") return;
      this.setDimScale(Number(input.value));
    });
    this.titleblock.addEventListener("dblclick", (e) => {
      const input = e.target as HTMLInputElement;
      if (input.dataset?.scale !== "dim") return;
      input.value = "100";
      this.setDimScale(100);
      input.blur();
      this.commit();
    });
    this.titleblock.addEventListener("change", (e) => {
      const input = e.target as HTMLInputElement;
      if (input.dataset.scale === "dim-num") {
        const v = parseNumber(input.value);
        if (Number.isFinite(v) && v >= DIM_SCALE_MIN && v <= DIM_SCALE_MAX) this.setDimScale(v);
        else this.toast(`The dimension size is between ${DIM_SCALE_MIN} and ${DIM_SCALE_MAX} %.`);
        this.chromeDirty = true;
      }
      if (input.dataset.scale === "width") {
        const v = parseNumber(input.value);
        if (Number.isFinite(v) && v >= 1 && v <= 100) this.sk.figureWidthMm = v * 10;
        else this.toast("Figure width must be between 1 and 100 cm.");
      }
      // For the slider this is the end of a drag: the size is set already, and is recorded now.
      input.blur();
      this.commit();
    });
    this.titleblock.addEventListener("keydown", (e) => {
      if (e.key === "Enter") (e.target as HTMLElement).blur();
    });

    this.dimEditor.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); this.commitEditor(); }
      else if (e.key === "Escape") { e.preventDefault(); this.closeEditor(); this.touch(); }
      e.stopPropagation();
    });
    this.dimEditor.addEventListener("blur", () => { if (this.editing) this.commitEditor(); });

    $("#report-text").addEventListener("input", () => this.updateReport());
    $("#report-send").addEventListener("click", (e) => {
      if (!$<HTMLTextAreaElement>("#report-text").value.trim()) {
        e.preventDefault();
        $("#report-hint").textContent = "Write a line about it first.";
        return $("#report-text").focus();
      }
      // The link opens the mail program; what happens there is out of this page's sight.
      $("#report-hint").textContent = `Your mail program should open with the report. If nothing opened, copy the text and send it to ${REPORT_EMAIL}.`;
    });
    const tipsOn = $<HTMLInputElement>("#tips-on");
    tipsOn.addEventListener("change", () => {
      this.tips.setOff(!tipsOn.checked);
      if (!tipsOn.checked && this.tip) { this.tip = null; $("#tip").hidden = true; }
    });
    $("#pattern-count").addEventListener("input", () => this.syncPatternDialog());
    $("#pattern-full").addEventListener("change", () => this.syncPatternDialog());

    this.fileInput.addEventListener("change", () => {
      const f = this.fileInput.files?.[0];
      if (f) void this.open(f);
      this.fileInput.value = "";
    });

    // Starting to draw, pan or drag also closes an open menu.
    document.addEventListener("pointerdown", (e) => {
      if ((e.target as Element).closest(".menu")) return;
      for (const open of document.querySelectorAll<HTMLElement>('[data-menu][aria-expanded="true"]')) this.setMenu(open, false);
    });
    window.addEventListener("keydown", (e) => { if (!this.menuKey(e)) this.onKeyDown(e); });
    window.addEventListener("keyup", (e) => {
      this.altKey = e.altKey;
      if (e.code === "Space") { this.spaceKey = false; this.render(); }
    });
    window.addEventListener("blur", () => { this.spaceKey = false; this.altKey = false; });
  }

  private action(act: string): void {
    switch (act) {
      case "undo": return this.undo();
      case "redo": return this.redo();
      case "fit": return this.tab === "plot" ? this.plots.fit() : this.fit();
      case "new": return this.newSketch();
      case "break-ref": return this.breakLinks([...this.selection]);
      case "open": return this.fileInput.click();
      case "save": return void this.save();
      case "export-svg": return void this.exportFigure("svg");
      case "export-tikz": return void this.exportFigure("tikz");
      case "copy-tikz": return void this.exportFigure("copy-tikz");
      case "shift": return void this.linearPattern();
      case "help": return this.showWelcome();
      case "report": return this.showReport();
      case "report-copy": return void this.copyReport();
      case "tip-close": return this.closeTip();
      case "tips-off":
        this.tip = null;
        $("#tip").hidden = true;
        this.tips.setOff(true);
        this.showTipsSetting();
        return this.toast("Tips are off. The settings button in the top right switches them back on.");
      case "tips-reset":
        this.tips.reset();
        this.showTipsSetting();
        return this.toast("Every tip will be shown once more.");
      case "support-close":
        $("#support-card").hidden = true;
        return;
      case "delete": return this.deleteSelection();
      case "rotate": return this.rotateSelected(Math.PI / 2);
      case "measure-to-dim": return this.measureToDimension();
      case "ra-corner":
        // Round the four corners the two lines make, one at a time.
        return this.editSymbol((x) => {
          if (x.type !== "rightangle") return;
          if (x.s1 === x.s2) x.s2 = x.s2 === 1 ? -1 : 1;
          else x.s1 = x.s1 === 1 ? -1 : 1;
        });
      case "ra-perp": {
        const m = this.selectedSymbol();
        if (m?.type !== "rightangle") return;
        const keep = this.selection;
        if (this.addManual([{ type: "perpendicular", l1: m.l1, l2: m.l2 }], "The two lines are already held at a right angle.")) this.selection = keep;
        return this.touch();
      }
      case "flip":
        return this.editSymbol((x) => { if (x.type === "hatch" || x.type === "lineload" || x.type === "diagram") x.side = x.side === 1 ? -1 : 1; });
      case "edit-plot": return this.editPlotOf(this.selectedSymbol());
      case "lean":
        return this.editSymbol((x) => { if (x.type === "hatch") x.lean = (x.lean ?? 1) === 1 ? -1 : 1; });
      case "el-flip":
        return this.editElements((look) => { if (look.flip) delete look.flip; else look.flip = true; });
      case "set-construction": return this.toggleConstruction();
      case "construction":
        this.constructing = !this.constructing;
        if (this.constructing) this.showTip("construction");
        return this.touch();
      case "undatum": {
        // The mark goes; the point it was on stays.
        const d = this.selectedSymbol();
        if (d?.type !== "datum") return;
        remove(this.sk, [d.id]);
        this.selection = new Set([d.at]);
        return this.commit();
      }
      case "preview":
        if (this.tab === "plot") return;
        return this.setPreview(!this.preview);
      case "origin":
        if (this.tab === "plot") return;
        this.sk.showOrigin = !this.sk.showOrigin;
        return this.commit();
    }
  }

  private selectedDimension(): Dimension | null {
    if (this.selection.size !== 1) return null;
    const c = constraint(this.sk, [...this.selection][0]);
    return c && isDimension(c) ? c : null;
  }

  /** The one selected symbol. A datum point counts when its point is what is selected. */
  private selectedSymbol(): Sym | null {
    if (this.selection.size !== 1) return null;
    const id = [...this.selection][0];
    return symbol(this.sk, id) ?? this.datumOn(id) ?? null;
  }

  /**
   * Sets how the selected curves are drawn in the figure. A construction line
   * given a way to be drawn is put back in the figure. Arrows, springs and
   * dampers are left as they are.
   */
  private setLineStyle(style: LineStyle): void {
    const { lines, rounds, beziers } = this.picked();
    for (const c of [...lines, ...rounds, ...beziers]) {
      if (isNamed(c)) continue;
      delete c.construction;
      delete c.centre;
      delete c.dashed;
      if (style === "centre") c.centre = true;
      if (style === "dashed") c.dashed = true;
    }
    this.commit();
  }

  /**
   * Makes the selected curves construction lines, or, when they all are
   * already, puts them back in the figure drawn as they were before.
   */
  private toggleConstruction(): void {
    const { lines, rounds, beziers } = this.picked();
    const plain = [...lines, ...rounds, ...beziers].filter((c) => !isNamed(c));
    if (!plain.length) return;
    const on = !plain.every((c) => c.construction);
    for (const c of plain) {
      if (on) c.construction = true;
      else delete c.construction;
    }
    this.commit();
  }

  /** One of an element's sizes as it is shown beside its slider, in the drawing's units. */
  private elementSizeLabel(e: Line | Arc, what: "across" | "pitch"): string {
    return this.inUnits(lookOf(this.sk, e)[what], 3);
  }

  /** The colour of the selected curves: black, one of a few, or any other. */
  private curveColorField(cs: Curve[]): string {
    const now = (c: Curve) => c.color ?? "";
    const shared = cs.every((c) => now(c) === now(cs[0])) ? now(cs[0]) : null;
    const swatch = (c: string, name: string) =>
      `<button type="button" class="swatch" data-ccolor="${c || "none"}" aria-pressed="${shared === c}" aria-label="${name}" title="${name}" style="background:${c || "#17201b"}"></button>`;
    return `<div class="field"><span id="ccolour-label">Colour</span><div class="swatches" role="group" aria-labelledby="ccolour-label">` +
      swatch("", "Black") + CURVE_COLORS.map((c) => swatch(c, `Colour ${c}`)).join("") +
      `<label class="swatch custom" title="Another colour"><input data-field="curve-color" type="color" value="${esc(shared || "#17201b")}" aria-label="Another colour"></label></div>` +
      `<small>${cs.some((c) => c.construction) ? "A construction line keeps its own colours in the editor. " : ""}An arrow's head and name take its colour too.</small></div>`;
  }

  /** The colour and thickness of the sketch's lines: for every plain line, circle and arc in it that has none of its own. */
  private sketchStyleFields(): string {
    const name = esc(activePart(this.drawing).info.name);
    const now = this.sk.lineColor ?? "";
    const swatch = (c: string, label: string) =>
      `<button type="button" class="swatch" data-skcolor="${c || "none"}" aria-pressed="${now === c}" aria-label="${label}" title="${label}" style="background:${c || "#17201b"}"></button>`;
    const weight = this.sk.lineWeight ?? Number((PAPER.member / PT_MM).toFixed(2));
    return `<details class="sketch-style"${this.sk.lineColor || this.sk.lineWeight !== undefined ? " open" : ""}><summary>Lines of ${name}</summary>` +
      `<div class="field"><span id="skcolour-label">Colour</span><div class="swatches" role="group" aria-labelledby="skcolour-label">` +
      swatch("", "Black") + CURVE_COLORS.map((c) => swatch(c, `Colour ${c}`)).join("") +
      `<label class="swatch custom" title="Another colour"><input data-field="sketch-color" type="color" value="${esc(now || "#17201b")}" aria-label="Another colour"></label></div></div>` +
      `<label class="field"><span>Line thickness</span><span class="slider-row"><input data-field="sketch-weight" type="range" min="${WEIGHT_MIN}" max="${WEIGHT_MAX}" step="0.1" value="${weight}">${numberBox('data-num="sketch-weight"', this.weightLabel(weight), "Line thickness")}</span>` +
      `<small>For every line, circle and arc of this sketch that has no colour or thickness of its own${this.sk.lineWeight === undefined ? "; this is the standard thickness" : ""}. Centre lines, arrows and springs keep theirs. Double-click the slider to go back to the standard.</small></label></details>`;
  }

  /** Gives the sketch's lines a colour, or black again with null. */
  private setSketchColor(color: string | null): void {
    if (color !== null && !/^#[0-9a-f]{6}$/i.test(color)) return;
    if (color && color.toLowerCase() !== "#17201b") this.sk.lineColor = color;
    else delete this.sk.lineColor;
    this.commit();
  }

  /** Draws the selected curves in a colour, or in black again with null. */
  private setCurveColor(color: string | null): void {
    if (color !== null && !/^#[0-9a-f]{6}$/i.test(color)) return;
    const { lines, rounds, beziers } = this.picked();
    for (const c of [...lines, ...rounds, ...beziers]) {
      if (color && color.toLowerCase() !== "#17201b") c.color = color;
      else delete c.color;
    }
    this.commit();
  }

  /** The side panel's fields for the selected springs or dampers: how they are drawn. */
  private elementPanel(): string {
    const els = this.selectedElements();
    const e = els[0];
    if (!e?.element) return "";
    const look = lookOf(this.sk, e), length = elementLength(this.sk, e) || 1;
    const slider = (label: string, field: string, range: [number, number], value: number, what: "across" | "pitch", note: string) =>
      `<label class="field"><span>${label}</span><span class="slider-row"><input data-field="${field}" type="range" min="0" max="100" step="1" value="${ratioPos(value / length, range)}">${numberBox(`data-num="${field}"`, this.elementSizeLabel(e, what), label)}</span><small>${note}</small></label>`;
    let html = "";
    if (e.element === "spring") {
      html += `<div class="field"><span id="coil-label">Look</span><div class="segmented" role="group" aria-labelledby="coil-label">` +
        `<button type="button" data-coil="0" aria-pressed="${!look.coil}">Zigzag</button><button type="button" data-coil="1" aria-pressed="${!!look.coil}">Coil</button></div></div>`;
      html += slider("Width", "el-across", ELEMENT_ACROSS_RANGE, look.across, "across", "Across the spring, in the drawing's units.");
      html += slider("Turns apart", "el-pitch", ELEMENT_PITCH_RANGE, look.pitch, "pitch",
        `${springTurns(length, look)} turns now. Their spacing stays as it is set: a spring pulled longer gets more turns.`);
    } else if (e.element === "damper") {
      html += slider("Size", "el-across", ELEMENT_ACROSS_RANGE, look.across, "across", "How wide the cylinder is, in the drawing's units; its length goes with it.");
      html += `<button type="button" class="plain" data-act="el-flip">Turn it round</button>`;
    } else {
      html += slider("Windings apart", "el-pitch", ELEMENT_PITCH_RANGE, look.pitch, "pitch",
        "The spring is wound about the start of its line and ends at the other end: drag that end to make it larger.");
      html += `<button type="button" class="plain" data-act="el-flip">Wind it the other way</button>`;
    }
    return html;
  }

  /** A line thickness as it is shown beside its slider. */
  private weightLabel(points: number): string {
    return `${formatNumber(Number(points.toFixed(2)))} pt`;
  }

  /** Puts the selected curves back to the standard thickness for how they are drawn. */
  private resetWeight(): void {
    const { lines, rounds, beziers } = this.picked();
    for (const c of [...lines, ...rounds, ...beziers]) delete c.weight;
    this.commit();
  }

  /** The one selected line or arc, when it is drawn as something with a name: an arrow, a spring, a damper. */
  private selectedNamed(): Line | Arc | null {
    if (this.selection.size !== 1) return null;
    const e = entity(this.sk, [...this.selection][0]);
    return isNamed(e) ? e : null;
  }

  /** Sets which end of the selected arrow carries the head. */
  private setArrowHead(ends: ArrowEnds): void {
    const e = this.selectedNamed();
    if (!e?.arrow) return;
    e.arrow = ends;
    this.commit();
  }

  /** The selected springs and dampers, when everything selected is one kind of them. */
  private selectedElements(): (Line | Arc)[] {
    const { lines, rounds, beziers, pts, syms, cons } = this.picked();
    const cs = [...lines, ...rounds, ...beziers];
    const first = cs[0];
    if (!first || first.type === "circle" || !first.element || pts.length || syms.length || cons.length) return [];
    return cs.every((c) => c.type !== "circle" && c.element === first.element) ? (cs as (Line | Arc)[]) : [];
  }

  /** Changes how the selected springs and dampers are drawn. */
  private editElements(change: (look: ElementLook, e: Line | Arc) => void, record = true): void {
    for (const e of this.selectedElements()) {
      e.look = { ...lookOf(this.sk, e) };
      change(e.look, e);
    }
    if (record) this.commit();
    else this.render();
  }

  /** Moves the selected radius dimension inside or outside its circle. */
  private setRadiusPlace(outside: boolean): void {
    const d = this.selectedDimension();
    if (!d || d.type !== "radius" || !!d.outside === outside) return;
    if (outside) d.outside = true;
    else delete d.outside;
    // A length set for one side would make little sense on the other.
    delete d.len;
    this.commit();
  }

  /** Changes the one selected symbol and records the edit. */
  private editSymbol(change: (s: Sym) => void): void {
    const s = this.selectedSymbol();
    if (!s) return;
    change(s);
    this.commit();
  }

  /** Sets how large annotations are in print, from the slider's percentage, and shows the result. */
  private setDimScale(percent: number): void {
    if (!Number.isFinite(percent)) return;
    this.sk.dimScale = Math.max(DIM_SCALE_MIN, Math.min(DIM_SCALE_MAX, percent)) / 100;
    showInBox(this.titleblock.querySelector("#dim-scale")?.parentElement, `${Math.round(this.sk.dimScale * 100)} %`);
    if (!this.preview) {
      this.setPreview(true);
      this.toast("Showing the print preview, where the dimension size applies. Press Q to go back to editing.");
    }
    this.render();
  }

  /** Sets the angle between the copies of a circular pattern, in degrees, if the sketch can follow. */
  private setTurnAngle(id: Id, degrees: number): void {
    if (!Number.isFinite(degrees) || Math.abs(degrees) < 1e-6 || Math.abs(degrees) > 360) {
      return this.toast("The angle must be a number of degrees, not zero and at most 360.");
    }
    const before = clone(this.sk);
    const c = constraint(this.sk, id);
    if (c?.type !== "turn") return;
    const old = c.angle, want = degrees * DEG;
    // The original is asked to stay where it is, so it is the copies that move.
    const stay: Drag[] = [...new Set([c.c, ...c.pairs.map((x) => x[0]), ...c.half.map((h) => h.from)])]
      .map((p) => ({ kind: "point", id: p, x: point(this.sk, p).x, y: point(this.sk, p).y }));
    // Walked there in steps: from far away the solver may not find the turned copies.
    const STEPS = 24;
    let r = this.result;
    for (let k = 1; k <= STEPS; k++) {
      c.angle = old + ((want - old) * k) / STEPS;
      r = this.solver.solve(this.sk, stay);
      if (!r.ok) break;
    }
    if (r.ok) r = this.solver.solve(this.sk);
    if (!r.ok || r.conflicting.length > this.result.conflicting.length) {
      this.sk = before;
      this.solve();
      return this.toast("No solution with that angle. Another constraint or dimension rules it out.");
    }
    this.result = r;
    this.commit();
    this.keepInView();
  }

  /** Colours the selected fill or datum point, and remembers the colour for the next one of its kind. */
  private setColor(color: string): void {
    if (!/^#[0-9a-f]{6}$/i.test(color)) return;
    const s = this.selectedSymbol();
    if (s?.type === "datum") this.datumColor = color;
    else if (s && isLoad(s)) this.loadColor = color;
    else this.fillColor = color;
    this.editSymbol((x) => { if (x.type === "fill" || x.type === "datum" || isLoad(x)) x.color = color; });
  }

  private setSupportKind(kind: SupportKind): void {
    const s = this.selectedSymbol();
    if (!s || s.type !== "support" || s.kind === kind) return;
    s.kind = kind;
    this.commit();
  }

  /** Turns the selected measure into a dimension of what it measures now, which then holds the geometry to it. */
  private measureToDimension(): void {
    const d = this.selectedDimension();
    if (!d?.measure) return;
    const before = clone(this.sk);
    const baseline = this.result;
    d.value = measuredDimValue(this.sk, d);
    delete d.measure;
    const r = this.solver.solve(this.sk);
    if (!r.ok || r.conflicting.length > baseline.conflicting.length || r.redundant.length > baseline.redundant.length) {
      this.sk = before;
      this.solve();
      this.toast("As a dimension it would over-constrain the sketch.");
      return this.touch();
    }
    this.result = r;
    this.commit();
  }

  private setDimMode(mode: DistanceMode): void {
    const d = this.selectedDimension();
    if (!d || d.type !== "distance" || d.mode === mode || d.toLine) return;
    const before = clone(this.sk);
    const a = point(this.sk, d.a), b = point(this.sk, d.b);
    // Keep the geometry where it is: the value becomes what the new direction measures now.
    const value = mode === "aligned" ? dist([a.x, a.y], [b.x, b.y]) : Math.abs(mode === "horizontal" ? b.x - a.x : b.y - a.y);
    if (mode === "aligned" && value < 1e-9) return this.toast("Those two points are in the same place.");
    d.mode = mode;
    d.value = value * unitScale(this.sk);
    d.offset = this.outsideOffset(a, b, mode);
    const r = this.solver.solve(this.sk);
    if (!r.ok || r.conflicting.length || r.redundant.length > this.result.redundant.length) {
      this.sk = before;
      this.solve();
      this.toast("Measured that way, the dimension would over-constrain the sketch.");
      return this.touch();
    }
    this.result = r;
    this.commit();
  }

  /**
   * A field in the side panel changed. `live` is a slider on the move: the
   * change is shown at once, and recorded as one edit when the slider is let go.
   */
  /**
   * A number typed in the box beside a slider: the value itself, set exactly,
   * where the slider only goes in steps. Lengths are in the units the sketch
   * is dimensioned in.
   */
  private onSliderNumber(field: string, text: string): void {
    const v = parseNumber(text);
    const no = (message: string) => { this.toast(message); this.chromeDirty = true; return this.touch(); };
    if (!Number.isFinite(v)) return no("Type a number, such as 3 or 2,5.");
    const s = this.selectedSymbol();
    const length = (what: string) => (v > 0 ? this.fromUnits(v) : (no(`${what} is a number above zero, in the drawing's units.`), null));
    switch (field) {
      case "support-scale":
        if (v < SUPPORT_SCALE_MIN || v > SUPPORT_SCALE_MAX) return no(`The size of the supports is between ${SUPPORT_SCALE_MIN} and ${SUPPORT_SCALE_MAX} %.`);
        if (Math.abs(v - 100) < 1e-9) delete this.sk.supportScale;
        else this.sk.supportScale = v / 100;
        break;
      case "sketch-weight":
        if (v < WEIGHT_MIN || v > WEIGHT_MAX) return no(`A line is between ${WEIGHT_MIN} and ${WEIGHT_MAX} pt thick.`);
        this.sk.lineWeight = Number(v.toFixed(3));
        break;
      case "weight": {
        if (v < WEIGHT_MIN || v > WEIGHT_MAX) return no(`A line is between ${WEIGHT_MIN} and ${WEIGHT_MAX} pt thick.`);
        const { lines, rounds, beziers } = this.picked();
        for (const c of [...lines, ...rounds, ...beziers]) c.weight = Number(v.toFixed(3));
        break;
      }
      case "el-across":
      case "el-pitch": {
        const size = length("A size");
        if (size === null) return;
        this.editElements((look) => { if (field === "el-across") look.across = size; else look.pitch = size; }, false);
        break;
      }
      case "sym-opacity":
        if (s?.type !== "picture") return;
        if (v < 5 || v > 100) return no("The strength is between 5 and 100 %.");
        if (Math.abs(v / 100 - PICTURE_OPACITY) < 1e-9) delete s.opacity;
        else s.opacity = v / 100;
        break;
      case "sym-hgap":
        if (s?.type !== "fill") return;
        if (v < 0.2 || v > 20) return no("The strokes are between 0.2 and 20 mm apart.");
        if (Math.abs(v - HATCH_GAP) < 1e-9) delete s.hatchGap;
        else s.hatchGap = v;
        break;
      case "sym-gaps":
        if (s?.type !== "centermark") return;
        if (s.gaps === undefined && v === 2) break;
        s.gaps = Math.max(2, Math.min(CENTRE_GAPS_MAX, 2 * Math.round(v / 2)));
        if (s.gaps === 2) delete s.gaps;
        break;
      case "sym-depth": {
        if (s?.type !== "hatch") return;
        const depth = length("The stroke size");
        if (depth === null) return;
        s.depth = depth;
        break;
      }
      case "sym-freq": {
        if (s?.type !== "hatch") return;
        const n = Math.round(v), whole = curveLength(this.sk, s.on);
        if (!(n >= 1 && n <= 1000) || !(whole > 0)) return no("The number of strokes is a whole number from 1 to 1000.");
        s.spacing = whole / n;
        break;
      }
      case "sym-height": {
        if (s?.type !== "diagram") return;
        const peak = diagramShape(this.sk, s)?.peak;
        const h = length("The height");
        if (h === null || !peak || Math.abs(peak.v) < 1e-12) return;
        s.scale = h / Math.abs(peak.v);
        break;
      }
      case "sym-count":
        if (s?.type === "diagram") s.strokes = Math.max(1, Math.min(DIAGRAM_STROKES_MAX, Math.round(v) || 1));
        else if (s?.type === "lineload") s.count = Math.max(2, Math.min(LINE_ARROWS_MAX, Math.round(v) || 2));
        else return;
        break;
      case "sym-size": {
        if (!s || !isLoad(s)) return;
        const magnitude = s.type === "lineload" ? Math.max(s.q1, s.q2) : s.value;
        const size = length("The size");
        if (size === null || !(magnitude > 0)) return;
        this.sk.loadScale = { ...this.sk.loadScale, [loadKind(s)]: size / magnitude };
        break;
      }
      default:
        return;
    }
    this.commit();
  }

  private onPanelChange(input: HTMLInputElement, live = false): void {
    const field = input.dataset.field;
    if (!field) return;
    /** Shows a slider's new value beside it and redraws, without rebuilding the panel under the pointer. */
    const slide = (shown: string) => {
      showInBox(input.parentElement, shown);
      return live ? this.render() : this.commit();
    };

    if (field.startsWith("sym-")) {
      const s = this.selectedSymbol();
      if (!s) return;
      const v = parseNumber(input.value);
      const label = input.value.trim().replace(/^\$+|\$+$/g, "");
      if (field === "sym-angle" && (s.type === "support" || s.type === "frame" || s.type === "centermark" || s.type === "load" || s.type === "moment" || s.type === "trace" || s.type === "etalon")) {
        if (!Number.isFinite(v)) { this.toast("Type the rotation as a number of degrees."); return this.touch(); }
        s.angle = v * DEG;
      } else if (s.type === "centermark" && field === "sym-scale") {
        if (!Number.isFinite(v) || v < 0.2 || v > 10) { this.toast("The size must be between 0.2 and 10."); return this.touch(); }
        if (Math.abs(v - 1) < 1e-9) delete s.scale;
        else s.scale = v;
      } else if (s.type === "centermark" && field === "sym-segmented") {
        if (input.checked) delete s.solid;
        else s.solid = true;
      } else if (s.type === "centermark" && field === "sym-gaps") {
        const gaps = Math.max(2, Math.min(CENTRE_GAPS_MAX, 2 * Math.round(v / 2)));
        if (gaps === 2) delete s.gaps;
        else s.gaps = gaps;
        return slide(this.gapsLabel(s));
      } else if (s.type === "frame" && (field === "sym-xsize" || field === "sym-ysize")) {
        if (!Number.isFinite(v) || v < 0) { this.toast("An axis length must be zero or more."); return this.touch(); }
        if (field === "sym-xsize") s.xSize = this.fromUnits(v);
        else s.ySize = this.fromUnits(v);
      } else if (s.type === "frame" && field === "sym-xlabel") s.xLabel = label;
      else if (s.type === "frame" && field === "sym-ylabel") s.yLabel = label;
      else if (s.type === "balloon" && field === "sym-text") s.text = label;
      else if (s.type === "note" && field === "sym-text") {
        // Dollar signs mark the math in a note, so the text is taken as typed.
        if (!input.value.trim()) { this.toast("A note needs some text. Delete removes it."); return this.touch(); }
        s.text = input.value.trim();
      }
      else if ((s.type === "datum" || isLoad(s) || s.type === "etalon") && field === "sym-label") s.label = label;
      else if (s.type === "etalon" && field === "sym-length") {
        if (!(v > 0)) { this.toast("The length is a number above zero, in the drawing's units."); return this.touch(); }
        s.length = this.fromUnits(v);
      } else if (s.type === "etalon" && field === "sym-parts") {
        const n = Math.round(v);
        if (!(n >= 1 && n <= 50)) { this.toast("The number of parts is a whole number from 1 to 50."); return this.touch(); }
        if (n === 1) delete s.parts;
        else s.parts = n;
      } else if (s.type === "rightangle" && field === "sym-dot") {
        if (input.checked) s.dot = true;
        else delete s.dot;
      }
      else if (isLoad(s) && field === "sym-size") {
        const magnitude = s.type === "lineload" ? Math.max(s.q1, s.q2) : s.value;
        if (!Number.isFinite(v) || magnitude <= 0) return;
        const size = ratioValue(v, LOAD_SIZE) * (geometryExtent(this.sk) || 1);
        this.sk.loadScale = { ...this.sk.loadScale, [loadKind(s)]: size / magnitude };
        return slide(this.loadSizeLabel(s));
      } else if ((s.type === "load" || s.type === "moment") && field === "sym-value") {
        if (!Number.isFinite(v) || v < 0) { this.toast("The magnitude must be a number, zero or more. The direction is set separately."); return this.touch(); }
        s.value = v;
      } else if (s.type === "lineload" && (field === "sym-q1" || field === "sym-q2")) {
        if (!Number.isFinite(v) || v < 0) { this.toast("A magnitude must be a number, zero or more."); return this.touch(); }
        if (field === "sym-q1") s.q1 = v;
        else s.q2 = v;
      } else if (s.type === "trace" && field === "sym-plot") {
        // Another plot, as large as the one before it.
        const reachOf = (id: Id) => { const p = this.sk.plots?.find((x) => x.id === id); return p ? traceReach(p) : 0; };
        const before = reachOf(s.plot), after = reachOf(input.value);
        s.plot = input.value;
        if (before > 0 && after > 0) s.scale *= before / after;
      } else if (s.type === "trace" && field === "sym-unit") {
        if (!(v > 0)) { this.toast("The size is a number above zero: how long one unit of the plot is in the drawing."); return this.touch(); }
        s.scale = this.fromUnits(v);
      } else if (s.type === "trace" && field === "sym-shade") {
        if (input.checked) delete s.plain;
        else s.plain = true;
      } else if (s.type === "diagram" && field === "sym-plot") {
        // Another plot, drawn as high as the one before it.
        const peakOf = (id: Id) => { const p = this.sk.plots?.find((x) => x.id === id); return p ? plotPeak(p) : 0; };
        const before = peakOf(s.plot), after = peakOf(input.value);
        s.plot = input.value;
        if (before > 0 && after > 0) s.scale *= before / after;
      } else if (s.type === "diagram" && field === "sym-height") {
        const shape = diagramShape(this.sk, s);
        if (!Number.isFinite(v) || !shape?.peak) return;
        s.scale = (ratioValue(v, DIAGRAM_SIZE) * shape.base.length) / Math.abs(shape.peak.v);
        return slide(this.diagramHeightLabel(s));
      } else if (s.type === "diagram" && (field === "sym-t0" || field === "sym-t1")) {
        const t = v / 100;
        const [t0, t1] = field === "sym-t0" ? [t, s.t1] : [s.t0, t];
        if (!Number.isFinite(t) || t0 < 0 || t1 > 1 || t1 - t0 < 0.02) { this.toast("The diagram runs from a smaller to a larger share of the member, between 0 and 100 %."); return this.touch(); }
        s.t0 = t0;
        s.t1 = t1;
      } else if (s.type === "diagram" && field === "sym-shade") {
        if (input.checked) delete s.plain;
        else s.plain = true;
      } else if (s.type === "diagram" && field === "sym-strokes") {
        const base = baseline(this.sk, s);
        // A handy spacing for the view as it is now; from then on the number is the diagram's own.
        if (input.checked) s.strokes = Math.max(3, Math.min(DIAGRAM_STROKES_MAX, Math.round(((base?.length ?? 0) * (s.t1 - s.t0) * this.view.scale) / 16)));
        else delete s.strokes;
      } else if (s.type === "diagram" && field === "sym-count") {
        s.strokes = Math.max(1, Math.min(DIAGRAM_STROKES_MAX, Math.round(v) || 1));
        return slide(String(s.strokes));
      } else if (s.type === "diagram" && field === "sym-values") {
        if (input.checked) s.values = true;
        else delete s.values;
      } else if (s.type === "diagram" && field === "sym-closed") {
        if (input.checked) s.closed = true;
        else delete s.closed;
      } else if (s.type === "lineload" && field === "sym-shade") {
        if (input.checked) delete s.plain;
        else s.plain = true;
      } else if (s.type === "lineload" && field === "sym-count") {
        s.count = Math.max(2, Math.min(LINE_ARROWS_MAX, Math.round(v) || 2));
        return slide(String(s.count));
      } else if (s.type === "lineload" && field === "sym-dir") {
        if (!Number.isFinite(v)) { this.toast("Type the angle as a number of degrees."); return this.touch(); }
        s.angle = v * DEG;
      } else if (s.type === "lineload" && (field === "sym-t0" || field === "sym-t1")) {
        const t = v / 100;
        const [t0, t1] = field === "sym-t0" ? [t, s.t1] : [s.t0, t];
        if (!Number.isFinite(t) || t0 < 0 || t1 > 1 || t1 - t0 < 0.02) { this.toast("The load runs from a smaller to a larger share of the line, between 0 and 100 %."); return this.touch(); }
        this.setSpan(s, t0, t1);
      }
      else if ((s.type === "fill" || s.type === "datum" || isLoad(s)) && field === "sym-color") return this.setColor(input.value);
      else if (s.type === "picture" && field === "sym-opacity") {
        const v2 = Math.max(10, Math.min(100, v));
        if (!Number.isFinite(v2)) return;
        if (Math.abs(v2 / 100 - PICTURE_OPACITY) < 1e-9) delete s.opacity;
        else s.opacity = v2 / 100;
        return slide(`${Math.round(v2)} %`);
      } else if (s.type === "picture" && field === "sym-width") {
        if (!(v > 0)) { this.toast("The width is a number above zero, in the drawing's units."); return this.touch(); }
        const w = this.fromUnits(v);
        s.h = (s.h * w) / s.w;
        s.w = w;
      }
      else if (s.type === "fill" && field === "sym-hangle") {
        if (!Number.isFinite(v)) { this.toast("Type the angle as a number of degrees."); return this.touch(); }
        const a = ((((v % 180) + 180) % 180) * Math.PI) / 180;
        if (Math.abs(a - Math.PI / 4) < 1e-9) delete s.hatchAngle;
        else s.hatchAngle = a;
      } else if (s.type === "fill" && field === "sym-hgap") {
        const g = Math.max(0.5, Math.min(6, v));
        if (!Number.isFinite(g)) return;
        if (Math.abs(g - HATCH_GAP) < 1e-9) delete s.hatchGap;
        else s.hatchGap = Number(g.toFixed(2));
        return slide(`${formatNumber(g)} mm`);
      }
      else if (s.type === "hatch" && (field === "sym-depth" || field === "sym-freq")) {
        const whole = curveLength(this.sk, s.on);
        if (!Number.isFinite(v) || whole <= 0) return;
        if (field === "sym-depth") s.depth = whole * ratioValue(v, HATCH_REACH);
        else s.spacing = whole / Math.round(ratioValue(v, HATCH_COUNT));
        return slide(this.hatchLabel(s, field === "sym-depth" ? "depth" : "freq"));
      }
      return this.commit();
    }

    if (field === "diagram-plot") {
      this.diagramPlotId = input.value;
      return this.touch();
    }

    if (field === "support-scale") {
      const pct = Math.max(SUPPORT_SCALE_MIN, Math.min(SUPPORT_SCALE_MAX, Math.round(Number(input.value))));
      if (!Number.isFinite(pct)) return;
      if (pct === 100) delete this.sk.supportScale;
      else this.sk.supportScale = pct / 100;
      return slide(`${pct} %`);
    }

    if (field === "curve-color") return this.setCurveColor(input.value);

    if (field === "sketch-color") return this.setSketchColor(input.value);
    if (field === "sketch-weight") {
      const v = Math.max(WEIGHT_MIN, Math.min(WEIGHT_MAX, Number(input.value)));
      if (!Number.isFinite(v)) return;
      this.sk.lineWeight = Number(v.toFixed(2));
      return slide(this.weightLabel(v));
    }

    if (field === "weight") {
      const v = Math.max(WEIGHT_MIN, Math.min(WEIGHT_MAX, Number(input.value)));
      if (!Number.isFinite(v)) return;
      const { lines, rounds, beziers } = this.picked();
      for (const c of [...lines, ...rounds, ...beziers]) c.weight = Number(v.toFixed(2));
      return slide(this.weightLabel(v));
    }

    if (field === "turn-angle") {
      const c = this.selection.size === 1 ? constraint(this.sk, [...this.selection][0]) : undefined;
      if (c?.type === "turn") this.setTurnAngle(c.id, parseNumber(input.value));
      return this.touch();
    }

    if (field === "el-across" || field === "el-pitch") {
      const els = this.selectedElements();
      if (!els.length) return;
      // The slider is in shares of the first one's length; the size it gives is the same for all of them.
      const length = elementLength(this.sk, els[0]);
      const size = length * ratioValue(Number(input.value), field === "el-across" ? ELEMENT_ACROSS_RANGE : ELEMENT_PITCH_RANGE);
      if (!(size > 0)) return;
      this.editElements((look) => { if (field === "el-across") look.across = size; else look.pitch = size; }, false);
      return slide(this.elementSizeLabel(els[0], field === "el-across" ? "across" : "pitch"));
    }

    if (field === "arrow-label") {
      const e = this.selectedNamed();
      if (!e) return;
      const name = input.value.trim().replace(/^\$+|\$+$/g, "");
      if (name) e.label = name;
      else delete e.label;
      return this.commit();
    }

    const d = this.selectedDimension();
    if (!d) return;
    if (field === "along" && d.type === "distance") {
      d.text = input.checked ? "along" : "upright";
      return this.commit();
    }
    if (field === "radius-len" && d.type === "radius") {
      const v = parseNumber(input.value);
      if (input.value.trim() === "") delete d.len;
      else if (Number.isFinite(v) && v > 0) d.len = this.fromUnits(v);
      else { this.toast("The arrow length must be a number greater than zero."); return this.touch(); }
      return this.commit();
    }
    if (field === "value") {
      if (!this.setDimValue(d.id, input.value)) input.value = this.shownValue(d);
      this.touch();
    } else if (field === "label") {
      const label = input.value.trim().replace(/^\$+|\$+$/g, "");
      if (label) d.label = label;
      else delete d.label;
      this.commit();
    } else if (field === "hidden") {
      if (input.checked) d.hidden = true;
      else delete d.hidden;
      this.commit();
    }
  }

  /** Opens or closes a drop-down menu; `focus` puts the keyboard on its first item. */
  private setMenu(btn: HTMLElement, open: boolean, focus = false): void {
    const list = document.getElementById(btn.getAttribute("aria-controls") ?? "");
    if (!list) return;
    btn.setAttribute("aria-expanded", String(open));
    list.hidden = !open;
    if (open && btn.dataset.menu === "export") this.showTip("export");
    if (open && focus) list.querySelector<HTMLElement>("button, input")?.focus();
  }

  /** Keys for an open menu. Returns true when the key was the menu's to handle. */
  private menuKey(e: KeyboardEvent): boolean {
    const btn = document.querySelector<HTMLElement>('[data-menu][aria-expanded="true"]');
    const target = e.target as HTMLElement;
    if (!btn) {
      // Arrow down on the closed button opens it, as menus do.
      if (e.key === "ArrowDown" && target.dataset?.menu) { e.preventDefault(); this.setMenu(target, true, true); return true; }
      return false;
    }
    const list = document.getElementById(btn.getAttribute("aria-controls") ?? "");
    if (list?.classList.contains("popover")) {
      // Its controls take the keys themselves (the arrows move a slider); Esc closes it.
      if (e.key !== "Escape") return true;
      this.setMenu(btn, false);
      btn.focus();
      e.preventDefault();
      return true;
    }
    const items = [...(list?.querySelectorAll<HTMLElement>("button") ?? [])];
    const at = items.indexOf(document.activeElement as HTMLElement);
    const go = (i: number) => items[(i + items.length) % items.length]?.focus();
    switch (e.key) {
      case "Escape": this.setMenu(btn, false); btn.focus(); break;
      case "ArrowDown": go(at + 1); break;
      case "ArrowUp": go(at < 0 ? -1 : at - 1); break;
      case "Home": go(0); break;
      case "End": go(-1); break;
      case "Tab": this.setMenu(btn, false); return true; // let focus move on
      default:
        if (e.ctrlKey || e.metaKey) return false;
        // Enter and Space press the focused item. Other typed keys are not tool shortcuts while the menu is open.
        return e.key === "Enter" || e.key.length === 1;
    }
    e.preventDefault();
    return true;
  }

  private onKeyDown(e: KeyboardEvent): void {
    this.altKey = e.altKey;
    // A dialog has the keyboard to itself: no tool is picked up behind it.
    if (document.querySelector("dialog[open]")) return;
    const target = e.target as HTMLElement;
    // Checkboxes and buttons keep focus after a click but take no text.
    const textInput = target.tagName === "INPUT" && !["checkbox", "radio", "button", "file", "range"].includes((target as HTMLInputElement).type);
    const typing = textInput || target.tagName === "TEXTAREA" || target.isContentEditable;
    const mod = e.ctrlKey || e.metaKey;

    if (mod && !typing) {
      const k = e.key.toLowerCase();
      if (k === "z") { e.preventDefault(); return e.shiftKey ? this.redo() : this.undo(); }
      if (k === "y") { e.preventDefault(); return this.redo(); }
      if (k === "s") { e.preventDefault(); return void this.save(); }
      if (k === "o") { e.preventDefault(); return this.fileInput.click(); }
      if (k === "a" && this.tab !== "plot") {
        e.preventDefault();
        this.setTool("select");
        this.selection = new Set([
          ...this.sk.entities.filter((x) => x.id !== ORIGIN).map((x) => x.id),
          ...this.sk.symbols.map((x) => x.id),
        ]);
        return this.touch();
      }
      return;
    }
    if (typing || mod || e.altKey) {
      if (e.key === "Enter" && typing && this.panel.contains(target)) target.blur();
      return;
    }

    if (this.tab === "plot") {
      // The sketcher's shortcuts are for the sketcher; the plot has a few of its own.
      if (this.plots.key(e)) e.preventDefault();
      return;
    }
    if (e.code === "Space") {
      // Space on a focused button should press it, not start a pan.
      if (target.tagName === "BUTTON") return;
      e.preventDefault();
      if (!this.spaceKey) { this.spaceKey = true; this.render(); }
      return;
    }
    if (e.key === "Escape") return this.cancel();
    if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); return this.deleteSelection(); }
    if (e.key === "0" || e.key === "Home") return this.fit();
    if (e.key === "Enter" && this.tool === "select") {
      const d = this.selectedDimension();
      if (d) { e.preventDefault(); this.openDimEditor(d.id); }
      return;
    }

    const key = e.key.toUpperCase();
    if (key === "R" && this.tool === "select" && this.picked().syms.length) {
      e.preventDefault();
      return this.rotateSelected(e.shiftKey ? -Math.PI / 2 : Math.PI / 2);
    }
    if (key === "Q") {
      e.preventDefault();
      return this.action("preview");
    }
    const tool = this.keyTool(key);
    if (!tool || tool.id === "shift") return;
    // Without this the letter would be typed into the dimension box a command opens.
    e.preventDefault();
    if (tool.id === "construction") return this.action("construction");
    if (isCommand(tool.id)) this.activate(tool.id);
    else this.setTool(tool.id);
  }
}
