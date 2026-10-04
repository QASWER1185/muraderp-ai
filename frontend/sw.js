const CACHE_NAME = "muraderp-ai-shell-v18";
const APP_SHELL = [
  "/",
  "/index.html",
  "/styles.css",
  "/app.js",
  "/dashboard.js",
  "/dashboard-api.js",
  "/icons.js",
  "/icons/icon.svg",
  "/workspace-context.js",
  "/product-api.js",
  "/products.js",
  "/rate-list-api.js",
  "/rate-lists.js",
  "/accounting-api.js",
  "/accounting.js",
  "/reports-api.js",
  "/reports.js",
  "/invoice-api.js",
  "/invoices.js",
  "/payment-api.js",
  "/payments.js",
  "/return-api.js",
  "/returns.js",
  "/purchase-api.js",
  "/purchases.js",
  "/stock-api.js",
  "/stock.js",
  "/warehouse-api.js",
  "/warehouses.js",
  "/auth.js",
  "/ai-experience.js",
  "/copilot-api.js",
  "/copilot-ui.js",
  "/estimate-conversion.js",
  "/estimate-pdf.js",
  "/estimate-api.js",
  "/estimates.js",
  "/customer-api.js",
  "/customers.js",
  "/vendor-api.js",
  "/vendors.js",
  "/offline-store.js",
  "/offline-sync.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  event.respondWith(
    fetch(request)
      .then((response) => {
        const copy = response.clone();
        void caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        return response;
      })
      .catch(() => caches.match(request).then((cached) => cached ?? caches.match("/index.html"))),
  );
});
