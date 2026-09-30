// service-worker.js — app-shell caching with an offline fallback.
//
// Cached: this site's own static files (HTML shell, JS, CSS, images, fonts)
// and pinned library files from the public CDNs the app loads.
// NEVER cached (always straight to the network): anything that is not a GET,
// Firebase (auth, realtime database, functions), AI providers and proxies,
// payment gateways, and IP/geo lookups — so no patient data, tokens, AI
// output or payment state is ever stored by this worker.
const CACHE_VERSION = 'rehablix-v2';
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

const SHELL_FILES = [
  '/',
  '/index.html',
  '/offline.html',
  '/manifest.json',
    '/img/icon-192.png',
  '/img/icon-512.png'
];

// Hosts whose responses must never be cached.
const NEVER_CACHE = [
  /(^|\.)firebaseio\.com$/, /(^|\.)firebasedatabase\.app$/, /(^|\.)cloudfunctions\.net$/, /(^|\.)run\.app$/,
  /^identitytoolkit\.googleapis\.com$/, /^securetoken\.googleapis\.com$/, /^firebaseinstallations\.googleapis\.com$/,
  /^www\.googleapis\.com$/, /^firestore\.googleapis\.com$/, /(^|\.)firebaseapp\.com$/,
  /^api\.openai\.com$/, /^api\.deepseek\.com$/, /^r\.jina\.ai$/,
  /(^|\.)paystack\.(co|com)$/, /(^|\.)flutterwave\.com$/, /^pay\.google\.com$/,
  /^ipapi\.co$/
];

// Cross-origin static hosts that may be cached (versioned library files / fonts).
const CACHEABLE_CDNS = [
  /^cdnjs\.cloudflare\.com$/, /^cdn\.jsdelivr\.net$/, /^unpkg\.com$/,
  /^fonts\.googleapis\.com$/, /^fonts\.gstatic\.com$/, /^www\.gstatic\.com$/
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_FILES))
      .catch(() => { /* a missing optional file must not block install */ })
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(CACHE_VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isNeverCache(url) {
  return NEVER_CACHE.some((re) => re.test(url.hostname));
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // POSTs (AI, payments, uploads) go straight to the network
  const url = new URL(req.url);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
  if (isNeverCache(url)) return;

  const sameOrigin = url.origin === self.location.origin;

  // Page navigations: network first, then the cached shell, then offline.html.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((resp) => {
          if (resp && resp.ok && sameOrigin) {
            const copy = resp.clone();
            caches.open(SHELL_CACHE).then((c) => c.put('/index.html', copy)).catch(() => {});
          }
          return resp;
        })
        .catch(() => caches.match('/index.html').then((r) => r || caches.match('/offline.html')))
    );
    return;
  }

  const cacheable = sameOrigin || CACHEABLE_CDNS.some((re) => re.test(url.hostname));
  if (!cacheable) return;

  // Static assets: stale-while-revalidate.
  event.respondWith(
    caches.open(RUNTIME_CACHE).then((cache) =>
      cache.match(req).then((cached) => {
        const network = fetch(req)
          .then((resp) => {
            // Only complete, successful (or opaque CDN) responses are stored.
            if (resp && (resp.ok || resp.type === 'opaque')) cache.put(req, resp.clone()).catch(() => {});
            return resp;
          })
          .catch(() => cached);
        return cached || network;
      })
    )
  );
});
