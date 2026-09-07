const CACHE_NAME = "mk-studio-v8";

const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./version.json"
];

self.addEventListener("install", (event) => {
  self.skipWaiting();

  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(APP_SHELL);
    })
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

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // نسخه و Service Worker همیشه از شبکه خوانده شوند
  if (
    url.pathname.endsWith("/version.json") ||
    url.pathname.endsWith("/sw.js")
  ) {
    event.respondWith(
      fetch(request, {
        cache: "no-store"
      })
        .then((response) => {
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // صفحات HTML: اول شبکه، در صورت نبود اینترنت از کش
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
        .catch(() => {
          return caches.match(request);
        })
    );

    return;
  }

  // سایر فایل‌ها: کش اول، سپس شبکه
  event.respondWith(
    caches.match(request).then((cached) => {
      return cached || fetch(request);
    })
  );
});