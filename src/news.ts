// The one-time notice about a release. In the released app it tells someone
// who has used it before what is new; in the beta, that what was tried out
// there is now in the released app.

export interface News {
  title: string;
  /** The body of the notice, as markup. */
  body: string;
  /** A link beside the button that closes it, if there is one: where it goes, and what it says. */
  link?: { href: string; text: string };
  /** What the button that closes it says. */
  close: string;
}

/** What is new in the released app, for those who used it before. */
const LIVE: News = {
  title: "New in Mech Sketch",
  body:
    `<p class="lead">Here is what is new since you last used it.</p>` +
    `<ul class="news">` +
    `<li><b>Sketches.</b> Split a drawing into sketches, as tabs along the bottom. Only the one you work on shows its dimensions; the others are thin grey lines. Each tab can be hidden, left out of the figure or renamed, and <b>Project</b> brings geometry from an earlier sketch. Select geometry and use <b>Move to sketch</b> in the side panel to move it.</li>` +
    `<li><b>Dimensions set the scale.</b> In a new drawing the first length dimension only says how long that line is, and nothing moves; every later one is in the same units.</li>` +
    `<li><b>Distance between parallel lines</b>, or from a point to a line, with Dimension.</li>` +
    `<li><b>Equal dimensions.</b> Select two dimensions, or a dimension and a measure, and press Equal (E) to hold them to one value.</li>` +
    `<li><b>Spline and Bézier curve</b> on the Sketch tab, with optional arrowheads at their ends.</li>` +
    `<li><b>Lines run on</b> from where the last one ended. Esc stops the run and keeps the Line tool.</li>` +
    `<li><b>Hatched fills</b>, and <b>notes that turn</b>: drag the handle past a note's end, or press R.</li>` +
    `<li><b>Save writes an SVG</b> with the whole drawing inside it, and exported SVG and TikZ files open again with everything in them. Your .json files still open.</li>` +
    `<li><b>Open a drawing from CAD</b> as an SVG to annotate it, or a PNG or JPG to trace over.</li>` +
    `<li>The export now fits the whole figure to the width you set, and every slider has a box to type the exact value.</li>` +
    `</ul>`,
  close: "Got it",
};

/** In the beta: what was tried out here is in the released app now. */
const BETA: News = {
  title: "These features are live",
  body:
    `<p class="lead">Sketches, Project and Move to sketch, relative dimensions, distances between parallel lines, equal dimensions, splines and Bézier curves, hatched fills, turning notes, line runs, SVG saves that reopen, CAD and picture import and the fitted export are now in the released Mech Sketch at mech-sketch.org. Thank you for trying them out.</p>` +
    `<p>Your sketch here stays in the beta, apart from the released app's. To carry it over, <b>Save</b> it here and <b>Open</b> the file there.</p>` +
    `<p class="muted">The next new features will show up here first.</p>`,
  link: { href: "../../", text: "Open the released app" },
  close: "Stay in the beta",
};

export const news = (beta: boolean): News => (beta ? BETA : LIVE);
