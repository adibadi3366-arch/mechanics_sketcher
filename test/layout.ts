// The figure laid out with the drawing itself at the figure width, as exports
// were before they were fitted to their page. It keeps the numbers in tests
// of what the files say round; fitting the figure to its page is tested in
// export.test.ts.

import type { Sketch } from "../src/model";
import { type Prim, buildPrims, printMm } from "../src/prims";
import { primsToSvg, primsToTikz } from "../src/export";

export const figurePrims = (sk: Sketch): Prim[] => buildPrims(sk, printMm(sk), { editor: false });
export const toSvg = (sk: Sketch): string | null => primsToSvg(figurePrims(sk), sk.dimScale);
export const toTikz = (sk: Sketch): string | null => primsToTikz(figurePrims(sk), sk.dimScale);
