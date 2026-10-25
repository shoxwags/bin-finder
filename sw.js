// Offline support for the app's own files. Online: always fetch the newest files (so updates arrive by themselves).
// Offline: serve the last saved copy. Product data is never cached here; the app keeps it in IndexedDB after sign-in.
const CACHE = "bbf-shell-v2";
const SHELL = ["./", "index.html", "app.js", "config.js", "styles.css", "manifest.webmanifest",
  "vendor/zxing.min.js", "vendor/supabase.js", "icons/icon-192.png", "icons/icon-512.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return; // Supabase calls go straight to network
  e.respondWith(
    fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match("index.html")))
  );
});
