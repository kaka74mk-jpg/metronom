const CACHE_NAME = "mk-studio-v15";

const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./version.json"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      cache.addAll(APP_SHELL)
    )
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // Always get latest version and service worker
  if (
    url.pathname.endsWith("/version.json") ||
    url.pathname.endsWith("/sw.js")
  ) {
    event.respondWith(
      fetch(request, { cache: "no-store" }).catch(() =>
        caches.match(request)
      )
    );
    return;
  }

  // HTML / navigation: network first
  if (
    request.mode === "navigate" ||
    url.pathname.endsWith(".html") ||
    url.pathname === "/" ||
    url.pathname.endsWith("/")
  ) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();

          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, copy);
          });

          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // Other assets: cache first
  event.respondWith(
    caches.match(request).then(
      (cached) => cached || fetch(request)
    )
  );
});