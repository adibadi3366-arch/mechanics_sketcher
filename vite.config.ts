/// <reference types="vitest/config" />
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import { icon } from "./src/icons";

const WASM = fileURLToPath(
  new URL("./node_modules/@salusoft89/planegcs/dist/planegcs_dist/planegcs.wasm", import.meta.url),
);

/**
 * Serves the solver's .wasm as a base64 string, so it can live inside the JS
 * bundle and be handed to the solver directly (see src/solver-web.ts).
 */
function planegcsWasm(): Plugin {
  const id = "virtual:planegcs-wasm";
  return {
    name: "planegcs-wasm",
    enforce: "pre",
    resolveId: (source) => (source === id ? `\0${id}` : null),
    load: (resolved) =>
      resolved === `\0${id}`
        ? `export default ${JSON.stringify(readFileSync(WASM).toString("base64"))};`
        : null,
    // The solver's loader also refers to the .wasm by URL, which would make
    // Vite inline a second copy. That path is never taken, so blank it out.
    transform(code, file) {
      if (!file.endsWith("planegcs_dist/planegcs.js")) return null;
      return code.replace('(new URL("planegcs.wasm",import.meta.url)).href', '""');
    },
  };
}

/**
 * The beta is for trying things out: search engines are asked to leave it
 * alone. Its icon has a little b in the corner, so its tab is told apart from
 * the released app's, and it has a manifest of its own, so it installs as an
 * app of its own with its own desktop icon.
 */
function betaPage(): Plugin {
  return {
    name: "beta-page",
    transformIndexHtml: {
      order: "post",
      handler: (html) =>
        process.env.VITE_CHANNEL === "beta"
          ? html
            .replace("<head>", `<head>\n<meta name="robots" content="noindex">`)
            .replace(/(<link rel="icon" href="[^"]*?)icon\.svg"/, `$1icon-beta.svg"`)
            .replace(/(<link rel="manifest" href="[^"]*?)manifest\.webmanifest"/, `$1manifest-beta.webmanifest"`)
            .replace(/(<link rel="apple-touch-icon" href="[^"]*?)icon-192\.png"/, `$1icon-beta-192.png"`)
          : html,
    },
  };
}

/**
 * The landing page, at the top of the site: a plain page that says what Mech
 * Sketch is, with the app itself one level down, in app/. It is written in
 * landing/index.html; its pictures, styles and script are in public/landing.
 * Here the app's icons are put in where it names them ({{icon:name}}), and the
 * beta gets its own name and icon, and is kept out of search.
 */
function landingPage(): Plugin {
  const page = () => {
    const beta = process.env.VITE_CHANNEL === "beta";
    let html = readFileSync(fileURLToPath(new URL("./landing/index.html", import.meta.url)), "utf8")
      .replace(/\{\{icon:([a-z]+)\}\}/g, (_, name: string) => icon(name, 28));
    if (beta) {
      html = html
        .replace("<head>", `<head>\n<meta name="robots" content="noindex">`)
        .replace("<title>Mech Sketch –", "<title>Mech Sketch beta –")
        .replace('href="icon.svg"', 'href="icon-beta.svg"')
        .replace('href="manifest.webmanifest"', 'href="manifest-beta.webmanifest"')
        .replace('href="icon-192.png"', 'href="icon-beta-192.png"')
        .replace("<!--beta-->", `<span class="beta-badge" title="New features are tried out here first">beta</span>`)
        .replace("<!--beta-note-->", `<p class="beta-note">This is the beta, where new features are tried out first. Its sketches are kept apart from the released app at <a href="../">mech-sketch.org</a>. New here: <a href="circuit/">wiring guides</a>, for showing how a drone or any electronics project is wired up.</p>`);
    }
    // The released site does not name the beta, not even in a comment.
    return html.replace("<!--beta-->", "").replace("<!--beta-note-->", "");
  };
  return {
    name: "landing-page",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = (req.url ?? "").split("?")[0];
        if (path !== "/" && path !== "/index.html") return next();
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(page());
      });
    },
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "index.html", source: page() });
    },
  };
}

/**
 * The Wiring page, at circuit/: the same app, opened on its Wiring
 * workspace, where parts are placed and wired into a wiring guide. Its page
 * is the app's, with a tag that tells the app which page it is; it is written
 * here before each build and built on its own (vite build --mode circuit), as
 * a page made into one file has to be.
 */
function circuitPage(): string {
  const html = readFileSync(fileURLToPath(new URL("./app/index.html", import.meta.url)), "utf8")
    .replace("<head>", `<head>\n<meta name="mech-sketch-page" content="circuit">`)
    .replace(/<title>[^<]*<\/title>/, "<title>Mech Sketch Wiring – wiring guides for electronics projects</title>")
    .replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="Draw wiring guides for electronics projects: boards as clean vector drawings, colour-coded pin tags and wire bundles, exported as SVG or TikZ.">`);
  const dir = fileURLToPath(new URL("./circuit/", import.meta.url));
  mkdirSync(dir, { recursive: true });
  const file = `${dir}index.html`;
  writeFileSync(file, html);
  return file;
}

// The app, with the solver and the fonts, is inlined into one app/index.html,
// so it runs from a file:// URL as well as from a server.
export default defineConfig(({ mode }) => {
  const circuit = mode === "circuit";
  const input = circuit ? circuitPage() : fileURLToPath(new URL("./app/index.html", import.meta.url));
  if (!circuit) circuitPage();
  return {
    base: "./",
    plugins: [planegcsWasm(), betaPage(), viteSingleFile(), ...(circuit ? [] : [landingPage()])],
    // When this copy was built, shown in the app so it is easy to tell which version is open.
    define: { __BUILD_TIME__: JSON.stringify(new Date().toISOString()) },
    build: {
      target: "es2022",
      assetsInlineLimit: 100_000_000,
      // The Wiring page is built after the app, into the same folder.
      emptyOutDir: !circuit,
      rollupOptions: { input },
    },
    test: { environment: "node" },
  };
});
