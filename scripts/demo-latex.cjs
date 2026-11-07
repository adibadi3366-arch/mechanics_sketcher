// The second part of the demo: the TikZ that scripts/demo-record.cjs exported
// goes into a LaTeX document. It sets the document with pdflatex twice, without
// the figure and with it, and records scripts/demo/latex-scene.html: the
// figure typed into the source, Compile pressed, and the page set with it.
//
//   node scripts/demo-latex.cjs <out-dir>     (the folder demo-record.cjs wrote truss.tex into)

const { chromium } = require("playwright");
const { mkdirSync, copyFileSync, writeFileSync, renameSync } = require("node:fs");
const { execFileSync } = require("node:child_process");
const { join, resolve } = require("node:path");
const { POINTER } = require("./demo/pointer.cjs");

const OUT = resolve(process.argv[2] ?? "demo-out");
const HERE = __dirname;
const W = 1280, H = 760;

const preamble = String.raw`\documentclass[11pt]{article}
\usepackage[paperwidth=10.6cm, paperheight=11.2cm, margin=0.85cm]{geometry}
\usepackage{tikz}
\usetikzlibrary{arrows.meta, bending}
\pagestyle{empty}
\begin{document}
\section*{Problem 3}
The truss in Figure~\ref{fig:truss} carries $F$ and
$F_2$ at its upper joints. Find the reactions at
the supports.
`;
const figure = String.raw`
\begin{figure}[h]
  \centering
  \input{truss.tex}
  \caption{A two-panel truss.}
  \label{fig:truss}
\end{figure}
`;

function setPage(name, body) {
  const dir = join(OUT, `tex-${name}`);
  mkdirSync(dir, { recursive: true });
  copyFileSync(join(OUT, "truss.tex"), join(dir, "truss.tex"));
  writeFileSync(join(dir, "main.tex"), preamble + body + "\n\\end{document}\n");
  for (let i = 0; i < 2; i++) execFileSync("pdflatex", ["-interaction=nonstopmode", "main.tex"], { cwd: dir, stdio: "ignore" });
  execFileSync("pdftocairo", ["-png", "-r", "220", "-singlefile", join(dir, "main.pdf"), join(OUT, name)]);
}

(async () => {
  setPage("before", "");
  setPage("after", figure);
  copyFileSync(join(HERE, "demo", "latex-scene.html"), join(OUT, "latex-scene.html"));
  for (const f of ["barlow-500.woff2", "lm-mono.woff2"]) copyFileSync(join(HERE, "..", "public", "landing", "fonts", f), join(OUT, f));

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, recordVideo: { dir: OUT, size: { width: W, height: H } } });
  await ctx.addInitScript(POINTER);
  const page = await ctx.newPage();
  await page.goto("file://" + join(OUT, "latex-scene.html"));
  await page.waitForTimeout(600);
  const wait = (ms) => page.waitForTimeout(ms);
  // The pointer goes to where the figure will be typed.
  const line = await page.evaluate(() => {
    const r = document.getElementById("code").getBoundingClientRect();
    return [r.left + 60, r.top + 18 + 10 * 25];
  });
  await page.mouse.move(W * 0.5, H * 0.5);
  await page.mouse.move(line[0], line[1], { steps: 30 });
  await page.mouse.down(); await page.mouse.up();
  await wait(300);
  await page.evaluate(() => window.typeFigure(38));
  await wait(500);
  const b = await page.locator("#compile").boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 32 });
  await wait(200);
  await page.mouse.down(); await page.mouse.up();
  await wait(1300);
  // Toward the figure on the page.
  await page.mouse.move(W * 0.74, H * 0.52, { steps: 40 });
  await wait(3200);
  const video = page.video();
  await ctx.close();
  renameSync(await video.path(), join(OUT, "latex.webm"));
  await browser.close();
  console.log("wrote", join(OUT, "latex.webm"));
})();
