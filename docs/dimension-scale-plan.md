# Relative dimensions and fitted export: plan

Status: agreed in a workshop, tried out in a demo, and **built into the beta** (branch `next`, 28 October 2026). Not in the released app yet.
The demo is [`demos/dimension-scale-demo.html`](demos/dimension-scale-demo.html). Open it in a browser; it needs nothing else.

## What changes

Right now a dimension's value is a length in model units. Typing 200 makes the line 200 units long, however big the rest of the sketch was drawn. The overhaul makes dimensions behave the way Creo sketches do.

1. **Draw first, size later.** Lines are laid down without sizes, at whatever size they look right.
2. **The first dimension only sets the scale.** If a line that looks about 9 units long is dimensioned 200, it keeps looking the same. The 200 just says what that line is worth. Nothing moves.
3. **Every later dimension is relative to that scale.** Dimensioning another line 150 makes it 150/200 of the first one, and the sketch solves around it as usual.
4. **When the first dimension is the only one, editing it moves nothing.** It just renames the scale. When there are others, editing it drives its line like any other dimension.
5. **Deleting dimensions.** Deleting one keeps the scale. Deleting the last length dimension clears the scale, and the next dimension sets a new one.
6. **Geometry without dimensions keeps its drawn proportions throughout.** Nothing gets rescaled when the first dimension goes on.

Dropped after trying the demo: a highlight on the first dimension, and a way to show which lines have no dimension.

## Export: fit the figure to the set width

The figure width box in the lower-right corner of the app sets the exported width.

- **Everything is fitted inside that width:** the geometry, dimensions, extension lines, arrowheads, text and symbols. There is a margin of 5% of the width on every side, so 4 mm all round at 8 cm. The content gets the remaining 90%.
- **The height follows from the drawing.** The top and bottom margins are also 5% of the *width*.
- **Only the geometry scales.** Text stays 10 pt (times the "Dimension size in print" factor), and arrowheads and line weights keep their print size. These parts have a fixed size, so the fit can't be solved in one step. Iterate instead: `mm = (inner − fixed) / extent`, where `fixed = boxWidth − extent·mm`. In the demo this converges in a few rounds.
- **Dimension values don't affect print size.** A drawing dimensioned in kilometres and one in mm print at the same size if they look the same.
- **Export preview.** Show the page at its paper size, with the margin dashed and the size printed under it (as in the demo, key P).

### Short dimensions

At small widths (around 3 cm), short dimensions got crowded. Built: when the dimension line is shorter than two arrowheads and a little room, the arrowheads point in from outside the extension lines; when the number is wider than the room between the extension lines, it goes past the second one, in line with the dimension line.

## Implementation notes for the app

**Model** (`src/model.ts`)
- Add `Sketch.lengthScale?: number`: dimension units per model unit. It is unset until the first length dimension is made.
- `Dimension.value` stays what the user typed. Angles are unaffected and never set the scale.
- Length dimensions are distance (aligned, horizontal, vertical) and radius/diameter. Any of them can set the scale.
- File upgrade: existing files get `lengthScale = 1`, so their dimensions keep meaning exactly what they did.

**Solver** (`src/solver.ts`, around lines 243–269)
- Length targets become `c.value / lengthScale` (`p2p_distance`, the difference constraints, `circle_radius`, `arc_radius`). Angles stay `c.value`.

**App** (`src/app.ts`)
- **Making a dimension:** if there's no `lengthScale` yet, set `lengthScale = value / measuredLength` and don't solve. Otherwise behave as now.
- **Editing a dimension:** if it's the only length dimension, update `lengthScale` only. Otherwise solve.
- **Deleting:** if no length dimensions are left, clear `lengthScale`.
- **Readouts in "the drawing's units"** (element sliders, cursor x/y, anything else) should be shown times `lengthScale` once it is set.
- The status bar or panel could show the scale, e.g. "1 grid square = 22.2".

**Export** (`src/prims.ts` `printMm`, `src/export.ts`)
- `printMm` currently makes the *geometry* `figureWidthMm` wide. It should make the *whole figure* `0.9 · figureWidthMm` wide, using the iteration above over the prims' bounding box (text measured as in the demo, or better).
- SVG: `width`/`height` in mm, with the viewBox including the margins.
- TikZ: LaTeX measures text itself, so set the bounding box explicitly so the figure is exactly the set width: `\useasboundingbox (0,0) rectangle (W,H);` from the computed box plus margins.

**Unchanged:** sizes already in model units (load scales, hatch spacing, spring/damper looks, balloon offsets, diagram heights). The geometry doesn't move when the scale is set, so these stay put.

## As built

- The scale lives in `Sketch.lengthScale`; `settleLengthScale` (prims.ts) keeps it in step on every commit, and `unitScale(sk)` reads it (1 when unset).
- Typing the only length dimension renames the scale and shows a toast: "The first dimension sets the scale, so nothing moves."
- Measures, etalons (their default label and length), point coordinates, the cursor readout and every "in the drawing's units" field in the side panel are shown times the scale.
- `fitFigure(sk)` (export.ts) does the fit with a secant iteration on the figure's width; a figure much taller than wide is still held to about three times its width, centred on its page. SVG and TikZ both come out exactly the set width (TikZ via `\useasboundingbox`, ending in `%` so no stray space widens it).
- The print preview (Q) shows the page on the desk, with the margin dashed and its size written under it.

## Still open

- Whether to add an optional height limit (fit inside width × height instead of width only).
- Whether to offer "Lock scale", so the first dimension can never move anything again.
- The scale readout: where it goes, and whether the user can type it directly. (Not built: the toast explains the first dimension.)
- A units label (mm, m) next to dimension values, or bare numbers as now.
- Whether hidden dimensions (still driving, not printed) should be able to set the scale. They probably should; they're still length dimensions.
