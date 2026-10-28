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
    `<li><b>Measure</b>, on the Annotate tab. Click what to measure and where to put it, as for a dimension. It shows the value in brackets and follows the geometry, but changes nothing, and only you see it: it is left out of the print and the exports.</li>` +
    `<li><b>Etalon</b>, on the Annotate tab: a scale bar named with its unit, such as 1 m, or 10 kN for forces drawn at a scale. Drag its far end to set its length.</li>` +
    `<li><b>Right angle</b>, on the Annotate tab: the small square in the corner two lines make, with a dot inside if you like.</li>` +
    `<li><b>Colours</b> for lines, circles, arcs, arrows and springs, in the side panel. They are kept in SVG and TikZ.</li>` +
    `<li><b>Balloons</b> can be pointed at something else: select one and drag the handle at the tip of its leader.</li>` +
    `<li><b>Right-click</b> where things lie on top of each other to pick the next one under the pointer.</li>` +
    `</ul>`,
  close: "Got it",
};

/** In the beta: what was tried out here is in the released app now. */
const BETA: News = {
  title: "These features are live",
  body:
    `<p class="lead">Measure, the etalon, the right-angle mark, coloured lines, the handle on a balloon's leader and right-clicking through stacked items are now in the released Mech Sketch at mech-sketch.org. Thank you for trying them out.</p>` +
    `<p>Your sketch here stays in the beta, apart from the released app's. To carry it over, <b>Save</b> it here and <b>Open</b> the file there.</p>` +
    `<p class="muted">The next new features will show up here first.</p>`,
  link: { href: "../", text: "Open the released app" },
  close: "Stay in the beta",
};

export const news = (beta: boolean): News => (beta ? BETA : LIVE);
