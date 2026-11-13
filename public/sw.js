// =============================================================
// Service worker toi thieu cho MangaReader (PWA)
//
// Chien luoc AN TOAN — uu tien khong bao gio lam hong du lieu dong:
// - KHONG BAO GIO cham vao /api/* (du lieu, phien dang nhap, CSRF) va
//   khong cham request non-GET (upload/PUT den R2 di khac origin).
// - KHONG cham request khac origin (R2 presigned, CDN, analytics).
// - Static bat bien (/_next/static co hash, /icons): cache-first.
// - Navigation (SPA shell): network-first, offline tra shell da cache
//   de app van mo va hien trang thai that (API se bao loi mang).
//
// Cap nhat SW: doi VERSION -> activate tu xoa cache cu (suffix khac).
// =============================================================
const VERSION = "v2";
const SHELL_CACHE = `mr-shell-${VERSION}`;
const STATIC_CACHE = `mr-static-${VERSION}`;
const SHELL_URLS = [
  "/",
  "/manifest.webmanifest",
  "/logo.svg",
  "/placeholder-cover.svg",
  "/favicon.ico",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
  "/icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // allSettled: 1 URL loi khong phong toan bo install
      await Promise.allSettled(SHELL_URLS.map((u) => cache.add(u)));
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((n) => n.startsWith("mr-") && !n.endsWith(VERSION))
          .map((n) => caches.delete(n))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return; // POST/mutation + upload -> browser tu xu ly

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // R2 presigned, CDN...
  if (url.pathname.startsWith("/api/")) return; // KHONG cache API dong

  // 1) Static bat bien (URL co hash / icon) -> cache-first
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        const res = await fetch(request);
        if (res.ok && res.type === "basic") {
          const cache = await caches.open(STATIC_CACHE);
          cache.put(request, res.clone());
        }
        return res;
      })()
    );
    return;
  }

  // 2) Navigation (SPA shell) -> network-first, offline tra shell
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(request);
          if (res.ok && res.type === "basic") {
            const cache = await caches.open(SHELL_CACHE);
            cache.put("/", res.clone()); // giu shell moi nhat cho offline
          }
          return res;
        } catch {
          const cached = await caches.match("/");
          if (cached) return cached;
          throw new Error("Offline va chua co shell trong cache");
        }
      })()
    );
  }
});
