// Keeps the app usable offline once it has been opened online. The network is
// tried first, and asked for a fresh copy rather than one the browser kept, so
// a new version shows up on the next load after it is published; the cached
// copy is the fallback when there is no network.
//
// The worker sits at the top of the site: the landing page is here, the app in
// app/, and the beta, with the same two, in beta/.
const CACHE = "mech-sketch-v3";
const SHELL = ["./", "./app/", "./manifest.webmanifest", "./icon.svg", "./icon-192.png", "./icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  // Copies kept by earlier versions of this worker are dropped.
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

/** The page to show for a page that is not in the cache: the app of its copy (released or beta) for a page of an app, else its landing page. */
function fallbackFor(url) {
  const base = url.pathname.includes("/beta/") ? "./beta/" : "./";
  return /\/app(\/|$)/.test(url.pathname) ? `${base}app/` : base;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  event.respondWith(
    // "no-cache": check with the server every time instead of trusting a copy for some minutes.
    fetch(request, { cache: "no-cache" })
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(async () =>
        (await caches.match(request, { ignoreSearch: true })) ??
        (request.mode === "navigate" ? await caches.match(fallbackFor(url)) : undefined) ??
        Response.error()),
  );
});
