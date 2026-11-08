// The truss at the top of the landing page draws itself the way one is drawn in
// Mech Sketch: rough lines first, in blue because they can still move; then
// constraints level the chords and even the sides; then dimensions fix the
// rest, and it turns black; then the supports, loads and names go on. Once,
// when the page opens, and again from the button under it. With reduced
// motion, it is shown finished.

(function () {
  const svg = document.getElementById("truss");
  if (!svg) return;
  const NS = "http://www.w3.org/2000/svg";
  const members = document.getElementById("members");
  const glyphs = document.getElementById("glyphs");
  const count = document.getElementById("tb-count");
  const state = document.getElementById("tb-state");
  const box = count.parentElement;
  const replay = document.getElementById("replay");

  // Joints, in the figure's units (y down): drawn roughly, constrained but still free, and exact.
  const ROUGH = { A: [0, 0], B: [26, -47], C: [63, -4], D: [95, -39], E: [116, -6] };
  const HELD = { A: [0, 0], B: [32, -48], C: [64, 0], D: [91, -48], E: [118, 0] };
  const EXACT = { A: [0, 0], B: [30, -42], C: [60, 0], D: [90, -42], E: [120, 0] };
  const BARS = [["A", "C"], ["C", "E"], ["A", "B"], ["B", "C"], ["B", "D"], ["C", "D"], ["D", "E"]];
  // What holds which member: level for the chords, equal for the sides.
  const HOLDS = { AC: "level", CE: "level", BD: "level", AB: "equal", BC: "equal", CD: "equal", DE: "equal" };
  const ICON = { level: "M-2.4 0H2.4M-2.4 -1.3V1.3M2.4 -1.3V1.3", equal: "M-2 -0.95H2M-2 0.95H2" };
  const CENTRE = [60, -21];

  const el = (name, attrs) => {
    const e = document.createElementNS(NS, name);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  };
  const lines = BARS.map(() => members.appendChild(el("line", {})));
  const joints = {};
  for (const id of Object.keys(EXACT)) joints[id] = el("circle", { r: "1.25" });
  for (const id of Object.keys(joints)) members.appendChild(joints[id]);
  const marks = BARS.map(([a, b]) => {
    const g = glyphs.appendChild(el("g", { class: "glyph" }));
    g.appendChild(el("rect", { x: "-3.8", y: "-2.8", width: "7.6", height: "5.6", rx: "1.3" }));
    g.appendChild(el("path", { d: ICON[HOLDS[a + b]] }));
    return g;
  });

  let at = {};
  const place = (pts) => {
    at = pts;
    BARS.forEach(([a, b], i) => {
      const [x1, y1] = pts[a], [x2, y2] = pts[b];
      const l = lines[i];
      l.setAttribute("x1", x1); l.setAttribute("y1", y1); l.setAttribute("x2", x2); l.setAttribute("y2", y2);
      // The marker sits beside the middle of the member, on the side away from the middle of the truss.
      const mx = (x1 + x2) / 2, my = (y1 + y2) / 2, len = Math.hypot(x2 - x1, y2 - y1) || 1;
      let nx = -(y2 - y1) / len, ny = (x2 - x1) / len;
      if (nx * (mx - CENTRE[0]) + ny * (my - CENTRE[1]) < 0) { nx = -nx; ny = -ny; }
      marks[i].setAttribute("transform", `translate(${(mx + nx * 5).toFixed(2)} ${(my + ny * 5).toFixed(2)})`);
    });
    for (const id in joints) { joints[id].setAttribute("cx", pts[id][0]); joints[id].setAttribute("cy", pts[id][1]); }
  };
  const mix = (p, q, t) => {
    const out = {};
    for (const id in p) out[id] = [p[id][0] + (q[id][0] - p[id][0]) * t, p[id][1] + (q[id][1] - p[id][1]) * t];
    return out;
  };
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const tween = (from, to, ms) => new Promise((done) => {
    const start = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - start) / ms);
      place(mix(from, to, ease(t)));
      if (t < 1) requestAnimationFrame(step); else done();
    };
    requestAnimationFrame(step);
  });
  const free = (n) => {
    count.textContent = String(n);
    state.textContent = n === 0 ? "Fully constrained" : n === 1 ? "degree of freedom left" : "degrees of freedom left";
    box.classList.toggle("done", n === 0);
  };
  const finished = () => {
    place(EXACT);
    svg.classList.remove("drawing", "constrained", "dimensioned", "annotated");
    members.classList.remove("free");
    for (const l of lines) { l.style.strokeDasharray = ""; l.style.strokeDashoffset = ""; l.style.transition = ""; }
    free(0);
  };

  let running = false;
  async function draw() {
    if (running) return;
    running = true;
    replay.hidden = true;
    svg.classList.add("drawing");
    svg.classList.remove("constrained", "dimensioned", "annotated");
    members.classList.add("free");
    free(8);
    place(ROUGH);
    // The members go down one after another, as they are clicked in.
    lines.forEach((l) => {
      const len = Math.hypot(l.x2.baseVal.value - l.x1.baseVal.value, l.y2.baseVal.value - l.y1.baseVal.value);
      l.style.transition = "none";
      l.style.strokeDasharray = `${len} ${len}`;
      l.style.strokeDashoffset = `${len}`;
    });
    for (const id in joints) joints[id].style.opacity = "0";
    await wait(250);
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      l.style.transition = "stroke-dashoffset 0.32s ease-out, stroke 0.5s ease";
      l.style.strokeDashoffset = "0";
      const [a, b] = BARS[i];
      joints[a].style.opacity = "1";
      setTimeout(() => { joints[b].style.opacity = "1"; }, 300);
      await wait(150);
    }
    await wait(500);
    for (const l of lines) { l.style.strokeDasharray = ""; l.style.strokeDashoffset = ""; }
    // Constrained: level and equal, still free to move.
    svg.classList.add("constrained");
    await wait(350);
    await tween(ROUGH, HELD, 750);
    free(3);
    await wait(650);
    // Dimensioned: exact, and black.
    svg.classList.add("dimensioned");
    await wait(250);
    await tween(HELD, EXACT, 750);
    members.classList.remove("free");
    free(0);
    await wait(700);
    svg.classList.add("annotated");
    await wait(600);
    running = false;
    replay.hidden = false;
  }

  replay.addEventListener("click", () => { draw(); });
  const still = window.matchMedia("(prefers-reduced-motion: reduce)");
  if (still.matches) finished();
  else {
    place(ROUGH);
    svg.classList.add("drawing");
    for (const l of lines) { l.style.strokeDasharray = "0 999"; }
    (document.fonts ? document.fonts.ready : Promise.resolve()).then(() => setTimeout(draw, 200));
  }
})();

// The demo video plays, muted, while it is on screen, and waits otherwise.
// With reduced motion it waits for its play button. The MP4 comes first: iPhones
// say they may play WebM and then often cannot.
(function () {
  const video = document.getElementById("demo");
  if (!video) return;
  // Muted and inline, as iPhones need to start a video on their own.
  video.muted = true;
  video.defaultMuted = true;
  video.playsInline = true;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) return;
  // A pause the viewer asked for (a tap or a key on the video) holds until they play it again;
  // pauses from scrolling away, or from the phone, do not.
  let touched = 0, held = false;
  for (const kind of ["pointerdown", "keydown"]) video.addEventListener(kind, () => { touched = Date.now(); });
  video.addEventListener("pause", () => { if (Date.now() - touched < 1500) held = true; });
  video.addEventListener("play", () => { held = false; });
  let visible = false;
  const start = () => { if (visible && !held && video.paused) video.play().catch(() => { /* Low Power Mode and the like: the play button is there */ }); };
  new IntersectionObserver((entries) => {
    for (const e of entries) {
      visible = e.isIntersecting;
      if (visible) start();
      else if (!video.paused) video.pause();
    }
  }, { threshold: 0.35 }).observe(video);
  // Back to the page with the video in view: on again.
  document.addEventListener("visibilitychange", () => { if (!document.hidden) start(); });
})();
