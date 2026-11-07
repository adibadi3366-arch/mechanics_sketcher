// Records the demo of Mech Sketch for the landing page: a truss drawn roughly,
// constrained, dimensioned, given supports and loads, and exported to TikZ,
// in the real app, with a pointer drawn on the page so the clicks show. It
// saves the video (WebM) and the exported .tex for the LaTeX part.
//
//   npx vite --port 5174 &          (the released app's look, in dev)
//   node scripts/demo-record.cjs <out-dir>

const { chromium } = require("playwright");
const { mkdirSync, copyFileSync, readdirSync, renameSync } = require("node:fs");
const { join } = require("node:path");

const OUT = process.argv[2] ?? "demo-out";
const URL = process.env.APP_URL ?? "http://localhost:5174/app/";
const W = 1280, H = 760;

const { POINTER } = require("./demo/pointer.cjs");

(async () => {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, recordVideo: { dir: OUT, size: { width: W, height: H } }, acceptDownloads: true });
  await ctx.addInitScript(() => {
    try {
      localStorage.clear();
      localStorage.setItem("mech-sketch.welcome", "seen");
      localStorage.setItem("mech-sketch.tips", JSON.stringify({ seen: [], off: true }));
      sessionStorage.setItem("mech-sketch.session", "1");
    } catch {}
    // The browser's own save dialog cannot be answered here: the app falls back to its name dialog and a download.
    try { delete window.showSaveFilePicker; window.showSaveFilePicker = undefined; } catch {}
  });
  await ctx.addInitScript(POINTER);
  const page = await ctx.newPage();
  const t0 = Date.now();
  await page.goto(URL);
  await page.waitForFunction(() => window.app);
  await page.evaluate(() => { for (const d of document.querySelectorAll("dialog[open]")) d.close(); });
  // The demo leaves out the few seconds the released app waits with its Support button before an export.
  await page.evaluate(() => { window.app.exportWait = 0; });

  let at = [W / 2, H / 2];
  const wait = (ms) => page.waitForTimeout(ms);
  const go = async (x, y, ms = 380) => {
    const steps = Math.max(6, Math.round(ms / 16));
    await page.mouse.move(x, y, { steps });
    at = [x, y];
  };
  const click = async (x, y, opts = {}) => {
    await go(x, y, opts.ms);
    await wait(opts.before ?? 90);
    await page.mouse.down({ button: opts.button ?? "left" });
    await wait(60);
    await page.mouse.up({ button: opts.button ?? "left" });
    await wait(opts.after ?? 160);
  };
  const button = async (selector, opts = {}) => {
    const b = await page.locator(selector).first().boundingBox();
    await click(b.x + b.width / 2, b.y + b.height / 2, { ms: 520, ...opts });
  };
  const type = async (text) => { await page.keyboard.type(text, { delay: 110 }); };

  // Where model points are on screen. The truss is drawn at 70 px a unit from a spot left of the middle.
  const origin = await page.evaluate(() => {
    const r = document.querySelector("#canvas").getBoundingClientRect();
    return [r.left + r.width * 0.3, r.top + r.height * 0.66];
  });
  const S = 66;
  const P = (x, y) => [origin[0] + x * S, origin[1] - y * S];
  const rough = { A: P(0, 0), B: P(2.25, 3.25), C: P(3.85, 0.18), D: P(6.35, 2.85), E: P(7.9, -0.22) };
  const joint = (k) => page.evaluate(async (k) => {
    // Where a joint is now: the solver moves them.
    const { toScreen } = await import("/src/render.ts");
    const app = window.app, r = document.querySelector("#canvas").getBoundingClientRect();
    const p = app.sk.entities.find((e) => e.id === window.__joints[k]);
    const [x, y] = toScreen(app.view, [p.x, p.y]);
    return [r.left + x, r.top + y];
  }, k);
  const mid = async (a, b, t = 0.5) => { const p = await joint(a), q = await joint(b); return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]; };

  await wait(700);
  // 1. Draw roughly: one run of lines through the zigzag, then the chords.
  await button('button[data-tool="line"]');
  for (const k of ["A", "B", "C", "D", "E"]) await click(...rough[k], { ms: 430, after: 120 });
  await wait(250);
  await page.keyboard.press("Escape");
  await wait(250);
  await click(...rough.A, { ms: 520 }); await click(...rough.C, { ms: 420 });
  await click(...rough.C, { ms: 300 }); await click(...rough.E, { ms: 420 });
  await click(...rough.B, { ms: 520 }); await click(...rough.D, { ms: 420 });
  // Name the joints for the rest of the script: they were made in the order A to E.
  await page.evaluate(() => {
    const pts = window.app.sk.entities.filter((e) => e.type === "point" && e.id !== "origin");
    window.__joints = { A: pts[0].id, B: pts[1].id, C: pts[2].id, D: pts[3].id, E: pts[4].id };
  });
  await wait(500);

  // 2. Constrain: A fixed, the chords level, the sides equal.
  // Fix point is past the edge of the ribbon at this width: its key, F.
  await page.keyboard.press("f");
  await wait(300);
  await click(...(await joint("A")), { ms: 520 });
  await wait(250);
  await button('button[data-cmd="horizontal"]');
  await click(...(await mid("A", "C")), { ms: 520, after: 260 });
  await click(...(await mid("C", "E")), { ms: 420, after: 260 });
  await click(...(await mid("B", "D")), { ms: 420, after: 260 });
  await button('button[data-cmd="equal"]');
  await click(...(await mid("A", "B")), { ms: 520 }); await click(...(await mid("B", "C")), { ms: 420, after: 300 });
  await click(...(await mid("C", "D")), { ms: 420 }); await click(...(await mid("D", "E")), { ms: 420, after: 300 });
  await click(...(await mid("A", "C", 0.4)), { ms: 420 }); await click(...(await mid("C", "E", 0.6)), { ms: 420, after: 400 });

  // 3. Dimension: the bottom chord, then the height.
  await button('button[data-cmd="dimension"]');
  {
    const m = await mid("A", "C");
    await click(...m, { ms: 520 });
    await click(m[0], m[1] + 70, { ms: 420, button: "middle", after: 300 });
    await type("4"); await page.keyboard.press("Enter");
    await wait(700);
    const a = await joint("A"), b = await joint("B");
    await click(...a, { ms: 520 }); await click(...b, { ms: 420 });
    await click(a[0] - 70, (a[1] + b[1]) / 2, { ms: 450, button: "middle", after: 300 });
    await type("3"); await page.keyboard.press("Enter");
    await wait(900);
  }
  await page.keyboard.press("Escape");
  await wait(300);
  // Zoomed to fit, the finished truss fills the sketch.
  await go(W * 0.42, H * 0.5, 400);
  await page.keyboard.press("0");
  await wait(300);
  // Fitted to the geometry: a notch out leaves room for the loads and dimensions.
  await page.mouse.wheel(0, 260);
  await wait(700);

  // 4. Annotate: a pin and a roller, and two loads.
  await button('button[data-tab="annotate"]');
  await button('button[data-tool="pin"]');
  await click(...(await joint("A")), { ms: 520, after: 300 });
  await button('button[data-tool="roller"]');
  await click(...(await joint("E")), { ms: 520, after: 300 });
  await button('button[data-tool="load"]');
  await click(...(await joint("B")), { ms: 520, after: 300 });
  await click(...(await joint("D")), { ms: 520, after: 300 });
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await go(W - 120, H - 60, 500);
  await wait(700);
  // The print preview: the figure as it will be exported.
  await page.keyboard.press("q");
  await wait(1600);

  // 5. Export TikZ.
  await button("#export-btn");
  await wait(350);
  const download = page.waitForEvent("download");
  await button('[data-act="export-tikz"]');
  await wait(500);
  if (await page.locator("#name-dialog[open]").count()) {
    await page.locator("#name-input").fill("truss");
    await wait(300);
    await button('#name-dialog button[type="submit"]');
  }
  const file = await download;
  await file.saveAs(join(OUT, "truss.tex"));
  await wait(900);
  const state = await page.evaluate(() => ({ dof: window.app.result.dof, ok: window.app.result.ok, cons: window.app.sk.constraints.length }));
  console.log("app state at the end", JSON.stringify(state), "seconds", (Date.now() - t0) / 1000);
  const video = page.video();
  await ctx.close();
  renameSync(await video.path(), join(OUT, "app.webm"));
  await browser.close();
})();
