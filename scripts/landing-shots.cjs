// Makes the pictures on the landing page from the app itself, so they can be
// made again whenever the app changes:
//
//   npx vite --port 5174 &          (the released app's look, in dev)
//   node scripts/landing-shots.cjs
//
// It draws an example truss in the app at each step of the workflow (drawn
// roughly, constrained, dimensioned and annotated, exported) and saves the
// canvas as a picture of each, into public/landing/. It also writes the
// truss's TikZ export to landing/truss.tex, which scripts/landing-tex.sh sets
// in a LaTeX page for the landing page's TikZ section.

const { chromium } = require("playwright");
const { writeFileSync, mkdirSync } = require("node:fs");
const { join } = require("node:path");

const { execFileSync } = require("node:child_process");
/** The picture as WebP, a quarter the size of the PNG; the PNG is dropped. */
const webp = (name) => execFileSync("python3", ["-c",
  `from PIL import Image; import os; p = ${JSON.stringify(join(__dirname, "..", "public", "landing", name))}; Image.open(p + ".png").convert("RGB").save(p + ".webp", quality=86, method=6); os.remove(p + ".png")`]);

const URL = process.env.APP_URL ?? "http://localhost:5174/app/";
const OUT = join(__dirname, "..", "public", "landing");
const SRC = join(__dirname, "..", "landing");

(async () => {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1180, height: 740 }, deviceScaleFactor: 2 });
  // A first visit with the welcome page and the tips already seen.
  await page.addInitScript(() => {
    try {
      localStorage.clear();
      localStorage.setItem("mech-sketch.tips", JSON.stringify({ seen: [], off: true }));
    } catch {}
  });
  await page.goto(URL);
  await page.waitForFunction(() => window.app);
  await page.evaluate(() => {
    for (const d of document.querySelectorAll("dialog[open]")) d.close();
  });

  // The truss, built from the app's own model: a two-panel Warren truss on a pin and a roller.
  await page.evaluate(async () => {
    const m = await import("/src/model.ts");
    const app = window.app;
    const sk = m.emptySketch();
    const A = m.ORIGIN;
    const P = (x, y) => m.addPoint(sk, x, y).id;
    const B = P(2, 3), C = P(4, 0), D = P(6, 3), E = P(8, 0);
    const lines = [[A, C], [C, E], [A, B], [B, C], [B, D], [C, D], [D, E]].map(([p, q]) => m.addLine(sk, p, q));
    window.__truss = { A, B, C, D, E, lines: lines.map((l) => l.id) };
    // Roughly drawn: every joint a little off, as a first sketch is.
    const rough = { [B]: [-0.25, 0.3], [C]: [0.2, 0.25], [D]: [0.35, -0.2], [E]: [-0.3, 0.35] };
    for (const e of sk.entities) if (rough[e.id]) { e.x += rough[e.id][0]; e.y += rough[e.id][1]; }
    window.__rough = JSON.parse(JSON.stringify(sk));
    app.loadDrawing(sk);
    app.solve();
    app.commit();
    app.touch();
  });
  const settle = () => page.waitForTimeout(400);
  const canvas = page.locator("#stage");
  const shot = async (name) => {
    await settle();
    await canvas.screenshot({ path: join(OUT, `${name}.png`) });
    webp(name);
    console.log("wrote", name);
  };
  const fit = async () => { await page.mouse.move(500, 400); await page.keyboard.press("0"); await settle(); };
  await fit();

  // 1. Drawn roughly: the Line tool out, a line being drawn from the top right joint.
  await page.locator('button[data-tool="line"]').click();
  const at = await page.evaluate(async () => {
    const { toScreen } = await import("/src/render.ts");
    const app = window.app, d = app.sk.entities.find((e) => e.id === window.__truss.D);
    const r = document.querySelector("#canvas").getBoundingClientRect();
    const [x, y] = toScreen(app.view, [d.x, d.y]);
    return [r.left + x, r.top + y];
  });
  if (at) {
    await page.mouse.click(at[0], at[1]);
    await page.mouse.move(at[0] + 140, at[1] + 60);
  }
  await shot("step-draw");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");

  // 2. Constrained: level chords and equal sides, shown on the selected members; still free to move, so still blue.
  await page.evaluate(() => {
    const app = window.app, sk = app.sk, t = window.__truss;
    const add = (c) => sk.constraints.push({ ...c, id: `k${sk.nextId++}` });
    add({ type: "horizontal", a: t.A, b: t.C });
    add({ type: "horizontal", a: t.C, b: t.E });
    add({ type: "horizontal", a: t.B, b: t.D });
    add({ type: "equal", a: t.lines[2], b: t.lines[3] });
    add({ type: "equal", a: t.lines[5], b: t.lines[6] });
    app.solve();
    app.commit();
    // Two equal sides and the top chord selected, which shows what holds them.
    app.selection = new Set([t.lines[2], t.lines[3], t.lines[4]]);
    app.touch();
  });
  await shot("step-constrain");

  // 3. Dimensioned and annotated: fully constrained, so black, with the supports, the loads and the joints' names.
  await page.evaluate(() => {
    const app = window.app, sk = app.sk, t = window.__truss;
    const add = (c) => sk.constraints.push({ ...c, id: `k${sk.nextId++}` });
    add({ type: "distance", a: t.A, b: t.C, mode: "aligned", value: 4, offset: -1.6, label: "a" });
    add({ type: "distance", a: t.C, b: t.E, mode: "aligned", value: 4, offset: -1.6, label: "a" });
    add({ type: "distance", a: t.A, b: t.B, mode: "vertical", value: 3, offset: -1.4, label: "h" });
    const sym = (s) => sk.symbols.push({ ...s, id: `s${sk.nextId++}` });
    sym({ type: "support", kind: "pin", at: t.A, angle: 0 });
    sym({ type: "support", kind: "roller", at: t.E, angle: 0 });
    sym({ type: "load", at: t.B, angle: -Math.PI / 2, value: 1, label: "F", color: "#d32f2f" });
    sym({ type: "load", at: t.D, angle: -Math.PI / 2, value: 2, label: "2F", color: "#d32f2f" });
    app.selection.clear();
    app.solve();
    app.commit();
    for (const [p, dx, dy] of [[t.A, -0.75, 0.15], [t.B, -0.75, 0.45], [t.C, -0.2, -0.75], [t.D, 0.4, 0.45], [t.E, 0.45, 0.15]]) {
      const q = sk.entities.find((e) => e.id === p);
      sym({ type: "note", x: q.x + dx, y: q.y + dy, text: `$${({ [t.A]: "A", [t.B]: "B", [t.C]: "C", [t.D]: "D", [t.E]: "E" })[p]}$` });
    }
    app.commit();
    app.touch();
  });
  await fit();
  const mid = await page.evaluate(() => { const r = document.querySelector("#canvas").getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height * 0.42]; });
  await page.mouse.move(mid[0], mid[1]);
  await page.mouse.wheel(0, -240);
  await page.mouse.move(4, 4);
  await page.evaluate(() => { const app = window.app; app.hover = null; app.selection.clear(); app.touch(); });
  await shot("step-dimension");

  // 4. Exported: the print preview, with the Export menu open.
  await page.keyboard.press("q");
  await page.addStyleTag({ content: ".titleblock { display: none !important; }" });
  await settle();
  await page.locator('[data-menu="export"], button:has-text("Export")').first().click().catch(() => {});
  await settle();
  await page.screenshot({ path: join(OUT, "step-export.png"), clip: await page.evaluate(() => {
    const r = document.querySelector("#stage").getBoundingClientRect();
    return { x: r.left, y: 0, width: r.width, height: r.bottom };
  }) });
  webp("step-export");
  console.log("wrote step-export");

  // The TikZ the truss exports to, for the LaTeX page.
  const tex = await page.evaluate(async () => {
    const x = await import("/src/export.ts");
    return x.toTikz(window.app.figureSketch());
  });
  writeFileSync(join(SRC, "truss.tex"), tex);
  console.log("wrote landing/truss.tex");
  const state = await page.evaluate(() => ({ dof: document.querySelector(".dof, #dof")?.textContent }));
  console.log(state);
  await browser.close();
})();
