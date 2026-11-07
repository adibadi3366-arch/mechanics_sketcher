// The pointer, and a ring where it clicks: headless recordings show no cursor of their own.
exports.POINTER = () => {
  const install = () => {
    if (document.getElementById("demo-pointer")) return;
    const style = document.createElement("style");
    style.textContent = `
      #demo-pointer { position: fixed; left: 0; top: 0; width: 22px; height: 30px; z-index: 2147483647; pointer-events: none; transform: translate(-100px, -100px); }
      .demo-ring { position: fixed; z-index: 2147483646; pointer-events: none; width: 34px; height: 34px; margin: -17px 0 0 -17px; border-radius: 50%;
        border: 2.5px solid rgba(226, 87, 10, 0.9); animation: demo-ring 0.45s ease-out forwards; }
      @keyframes demo-ring { from { transform: scale(0.35); opacity: 1; } to { transform: scale(1.15); opacity: 0; } }`;
    document.head.appendChild(style);
    const p = document.createElement("div");
    p.id = "demo-pointer";
    p.innerHTML = `<svg width="22" height="30" viewBox="0 0 22 30"><path d="M2 2v22l6-5.5 4.2 9.3 3.6-1.6-4.1-9.1H20z" fill="#17201b" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
    document.body.appendChild(p);
    window.addEventListener("mousemove", (e) => { p.style.transform = `translate(${e.clientX - 2}px, ${e.clientY - 2}px)`; }, true);
    window.addEventListener("mousedown", (e) => {
      const r = document.createElement("div");
      r.className = "demo-ring";
      r.style.left = `${e.clientX}px`;
      r.style.top = `${e.clientY}px`;
      document.body.appendChild(r);
      setTimeout(() => r.remove(), 500);
    }, true);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install);
  else install();
};

