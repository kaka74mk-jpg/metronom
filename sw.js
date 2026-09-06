const SW_VERSION = "mk-studio-v3";

const APP_SHELL_CACHE = `${SW_VERSION}-shell`;
const RUNTIME_CACHE = `${SW_VERSION}-runtime`;

const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png"
];


// ============================================================
// INSTALL
// ============================================================

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(APP_SHELL_CACHE)
      .then((cache) => cache.addAll(APP_SHELL))
  );

  /*
   * مهم:
   * اینجا skipWaiting() عمداً اجرا نمی‌شود.
   *
   * دلیل:
   * اگر کاربر وسط Practice Session باشد، نسخه جدید نباید
   * ناگهان جای نسخه فعلی را بگیرد.
   */
});


// ============================================================
// ACTIVATE
// ============================================================

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter(
            (key) =>
              key.startsWith("mk-studio-") &&
              key !== APP_SHELL_CACHE &&
              key !== RUNTIME_CACHE
          )
          .map((key) => caches.delete(key))
      )
    )
  );
});


// ============================================================
// MANUAL UPDATE ACTIVATION
// ============================================================

self.addEventListener("message", (event) => {

  if (event.data?.type === "MK_STUDIO_ACTIVATE_UPDATE") {
    self.skipWaiting();
  }

});


// ============================================================
// NAVIGATION
// NETWORK FIRST
// ============================================================

async function handleNavigation(request) {

  try {

    const response = await fetch(request, {
      cache: "no-store"
    });

    if (response && response.ok) {

      const cache = await caches.open(APP_SHELL_CACHE);

      await cache.put(
        "./index.html",
        response.clone()
      );

    }

    return response;

  } catch (error) {

    /*
     * اگر اینترنت قطع باشد:
     * اول خود request
     * بعد index.html
     * بعد root
     */

    return (
      await caches.match(request)
      ||
      await caches.match("./index.html")
      ||
      await caches.match("./")
    );

  }

}


// ============================================================
// STATIC / RUNTIME ASSETS
// CACHE FIRST
// ============================================================

async function handleAsset(request) {

  const cached = await caches.match(request);

  if (cached) {
    return cached;
  }

  try {

    const response = await fetch(request);

    if (response && response.ok) {

      const cache = await caches.open(RUNTIME_CACHE);

      await cache.put(
        request,
        response.clone()
      );

    }

    return response;

  } catch (error) {

    /*
     * اگر Network هم در دسترس نباشد
     * و Cache وجود نداشته باشد،
     * خطای استاندارد برگردانده می‌شود.
     */

    return Response.error();

  }

}


// ============================================================
// FETCH
// ============================================================

self.addEventListener("fetch", (event) => {

  const request = event.request;

  // فقط GET
  if (request.method !== "GET") {
    return;
  }

  const url = new URL(request.url);

  /*
   * درخواست‌های خارج از دامنه MK Studio
   * توسط این Service Worker مدیریت نمی‌شوند.
   */

  if (url.origin !== self.location.origin) {
    return;
  }


  // صفحه اصلی / Navigation
  if (request.mode === "navigate") {

    event.respondWith(
      handleNavigation(request)
    );

    return;
  }


  // سایر Assetها
  event.respondWith(
    handleAsset(request)
  );

});