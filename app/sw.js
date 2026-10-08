// Service worker Farde : l'app reste consultable hors ligne.
// Fichiers du site : réseau d'abord (mises à jour immédiates), cache en secours.
const CACHE = 'farde-__VERSION__';
const SHELL = ['./', 'index.html', 'css/app.css', 'js/main.js', 'js/store.js', 'js/ui.js', 'js/valuation.js', 'js/match.js', 'js/tcgdex.js',
  'js/carddialog.js', 'js/config.js', 'js/vendor/supabase.js', 'js/views/dashboard.js', 'js/views/catalogue.js', 'js/views/collection.js',
  'js/views/import.js', 'js/views/binders.js', 'js/views/sets.js', 'js/views/sealed.js', 'js/views/wishlist.js', 'js/views/settings.js', 'js/views/expenses.js', 'js/views/opportunities.js',
  'js/views/sales.js', 'js/views/quickadd.js', 'js/search.js', 'js/sell.js', 'js/scan.js', 'js/ocr.js', 'js/excel.js', 'vitrine.html', 'js/vitrine.js',
  'manifest.webmanifest', 'icons/icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return; // Supabase, TCGdex : jamais mis en cache ici
  e.respondWith(
    fetch(e.request).then((r) => {
      if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
      return r;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('index.html')))
  );
});
