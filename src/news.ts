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
    `<li><b>Dynamics tab.</b> Springs, drawn as a zigzag or a coil, dampers, a torsion spring and damper, and the centre of mass mark. They stretch and turn with what they are tied to.</li>` +
    `<li><b>Plot tab.</b> Functions, functions in pieces and curves given by x(t) and y(t), with the graph and the print side by side. A plot exports as SVG, or for pgfplots with its formulas kept as formulas.</li>` +
    `<li><b>Diagram</b>, on the Annotate tab, lays a plot along a beam, the way an internal force diagram is drawn. Change the function and the diagram follows.</li>` +
    `<li><b>Construction lines.</b> With the switch at the start of the Sketch ribbon (G) on, what you draw is left out of the print.</li>` +
    `<li><b>Dimension</b> has moved to the Sketch tab, first among the constraints.</li>` +
    `<li><b>TeX shows typeset</b> in the side panel: <code>\\pi</code> as π, <code>F_1</code> with its subscript.</li>` +
    `<li><b>A shorter wait</b> before an export: 3 seconds instead of 10.</li>` +
    `</ul>`,
  close: "Got it",
};

/** In the beta: what was tried out here is in the released app now. */
const BETA: News = {
  title: "The beta's features are live",
  body:
    `<p class="lead">Everything you have been trying out here is now in the released Mech Sketch at mech-sketch.org: the Dynamics and Plot tabs, diagrams, construction lines and the rest. Thank you for testing them.</p>` +
    `<p>Your sketch here stays in the beta, apart from the released app's. To carry it over, <b>Save</b> it here and <b>Open</b> the file there.</p>` +
    `<p class="muted">The beta goes on: the next new features will show up here first. If you would rather stay with the released app, you can uninstall the beta's app and use mech-sketch.org.</p>`,
  link: { href: "../", text: "Open the released app" },
  close: "Stay in the beta",
};

export const news = (beta: boolean): News => (beta ? BETA : LIVE);
