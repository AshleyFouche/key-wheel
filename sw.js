// Offline support: app files are cached; the library is fetched fresh when online and served from cache when not.
const CACHE = "key-wheel-v27";
const SHELL = ["./", "index.html", "app.css", "app.js", "spotify.js", "icons.js", "config.js", "library.json", "manifest.webmanifest", "icons/icon-192.png", "icons/apple-touch-icon.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  // Never cache Spotify calls.
  if (url.hostname.endsWith("spotify.com")) return;
  // Same-origin files: network first (so updates arrive), cache as fallback.
  if (url.origin === location.origin) {
    e.respondWith(
      fetch(e.request, { cache: "no-cache" }).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r; })
        .catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match("index.html")))
    );
    return;
  }
  // Fonts: cache first.
  if (url.hostname.includes("fonts.g")) {
    e.respondWith(caches.match(e.request).then(r => r || fetch(e.request).then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return res; })));
  }
});
