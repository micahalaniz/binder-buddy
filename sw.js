// Offline support. App files: network first, then cache (so updates show up right away).
// Card pictures from the card databases: cache first (they never change).
// Price and search requests are never cached here; the app caches them itself in IndexedDB.
const CACHE = "binder-buddy-v2.1.0", IMAGES = "binder-buddy-img-v1";
const SHELL = ["./", "index.html", "css/app.css", "manifest.webmanifest", "icon-192.png", "icon-512.png", "fonts/fredoka.woff2", "fonts/nunito.woff2",
  "js/app.js", "js/util.js", "js/logic.js", "js/store.js", "js/ui.js", "js/catalog.js", "js/chart.js", "js/picker.js", "js/binder.js",
  "js/wishlist.js", "js/trade.js", "js/pricecheck.js", "js/scan.js", "js/scanui.js", "js/share.js", "js/more.js", "js/tradelink.js", "js/learn.js", "js/fixes.js"];
const IMG_HOSTS = ["assets.tcgdex.net", "cards.lorcast.io", "optcgapi.com"];

self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE && k !== IMAGES).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    e.respondWith(fetch(req).then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); return res; })
      .catch(() => caches.match(req, {ignoreSearch: true}).then(r => r || caches.match("index.html"))));
    return;
  }
  const isImg = IMG_HOSTS.includes(url.hostname) && (req.destination === "image" || /\.(png|jpe?g|webp|avif)$/i.test(url.pathname));
  if (isImg) {
    e.respondWith(caches.open(IMAGES).then(async c => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok || res.type === "opaque") {
        await c.put(req, res.clone());
        const keys = await c.keys();
        if (keys.length > 800) for (const k of keys.slice(0, keys.length - 800)) c.delete(k);   // keep the cache small
      }
      return res;
    }));
  }
});
