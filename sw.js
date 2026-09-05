/* Service worker: offline support for the Lyric Sync PWA.
   The CACHE name is bumped automatically from package.json by
   scripts/prepare-www.js (APK build) and the GitHub Pages workflow,
   so every release invalidates the offline cache. */
const CACHE = "lyric-sync-v1.4.0";
const CORE = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./vendor/wavesurfer.min.js",
  "./vendor/jsmediatags.min.js",
  "./vendor/soundtouch.min.js",
];
self.addEventListener("install", (e) =>
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(CORE))
      .then(() => self.skipWaiting()),
  ),
);
self.addEventListener("activate", (e) =>
  e.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  ),
);
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith(
    caches.match(e.request).then(
      (cached) =>
        cached ||
        fetch(e.request)
          .then((res) => {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(e.request, copy));
            return res;
          })
          .catch(() => caches.match("./index.html")),
    ),
  );
});
