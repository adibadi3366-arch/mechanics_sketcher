/// <reference types="vitest/config" />
import { readFileSync } from "node:fs";
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
 * beta gets its own name, icon and saved-sketch key, and is kept out of search.
 */
function landingPage(): Plugin {
  const page = () => {
    const beta = process.env.VITE_CHANNEL === "beta";
    let html = readFileSync(fileURLToPath(new URL("./landing/index.html", import.meta.url)), "utf8")
      .replace(/\{\{icon:([a-z]+)\}\}/g, (_, name: string) => icon(name, 28))
      .replace("{{autosave}}", beta ? "mech-sketch-beta.autosave" : "mech-sketch.autosave");
    if (beta) {
      html = html
        .replace("<head>", `<head>\n<meta name="robots" content="noindex">`)
        .replace("<title>Mech Sketch –", "<title>Mech Sketch beta –")
        .replace('href="icon.svg"', 'href="icon-beta.svg"')
        .replace('href="manifest.webmanifest"', 'href="manifest-beta.webmanifest"')
        .replace('href="icon-192.png"', 'href="icon-beta-192.png"')
        .replace("<!--beta-->", `<span class="beta-badge" title="New features are tried out here first">beta</span>`)
        .replace("<!--beta-note-->", `<p class="beta-note">This is the beta, where new features are tried out first. Its sketches are kept apart from the released app at <a href="../">mech-sketch.org</a>.</p>`);
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

// The app, with the solver and the fonts, is inlined into one app/index.html,
// so it runs from a file:// URL as well as from a server.
export default defineConfig({
  base: "./",
  plugins: [planegcsWasm(), betaPage(), viteSingleFile(), landingPage()],
  // When this copy was built, shown in the app so it is easy to tell which version is open.
  define: { __BUILD_TIME__: JSON.stringify(new Date().toISOString()) },
  build: {
    target: "es2022",
    assetsInlineLimit: 100_000_000,
    rollupOptions: { input: fileURLToPath(new URL("./app/index.html", import.meta.url)) },
  },
  test: { environment: "node" },
});
