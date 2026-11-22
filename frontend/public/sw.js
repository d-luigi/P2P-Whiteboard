/* P2P Whiteboard service worker: makes the app itself load with no network.
 *
 * Drawings are NOT handled here: they live in IndexedDB (docStore.ts) and sync peer to peer.
 * This only keeps the app's own files (page, scripts, styles, icons) so the app opens offline.
 *
 *  - Page (navigation): network first, so a new deployment shows up as soon as you are online;
 *    if the network is down or slow (> 4 s) the saved copy is used.
 *  - Built files under /assets/ have content hashes in their names, so they never change:
 *    served from the cache first. After each page load, the files that page needs are saved and
 *    files from older versions are deleted.
 *  - Everything else on this site (icons, manifest): cache first, refreshed in the background.
 *  - Other sites (the signalling server, the account server, STUN/TURN) are never touched.
 *
 * Bump CACHE if you change this file's logic, so old caches are dropped.
 */
const CACHE = 'p2pwb-app-v1';
const PAGE = '/';
const CORE = ['/', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/maskable-512.png', '/icons/apple-touch-icon.png', '/icons/favicon-32.png'];
const NAV_TIMEOUT_MS = 4000;

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await Promise.allSettled(CORE.map((u) => cache.add(new Request(u, { cache: 'reload' }))));
      await keepPageAssets(cache); // the scripts and styles the page needs, so the very first visit works offline too
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

/** Save the built files named in the cached page, and delete saved built files it no longer names. */
async function keepPageAssets(cache) {
  try {
    const page = await cache.match(PAGE);
    if (!page) return;
    const html = await page.clone().text();
    const wanted = new Set([...html.matchAll(/(?:src|href)="(\/assets\/[^"?#]+)"/g)].map((m) => m[1]));
    await Promise.allSettled([...wanted].map((u) => (cache.match(u).then((hit) => hit || cache.add(u)))));
    for (const req of await cache.keys()) {
      const path = new URL(req.url).pathname;
      if (path.startsWith('/assets/') && !wanted.has(path)) await cache.delete(req);
    }
  } catch {
    /* offline or partial: the next page load tries again */
  }
}

async function navigate(event) {
  const cache = await caches.open(CACHE);
  const saved = await cache.match(PAGE, { ignoreSearch: true });
  const network = fetch(event.request)
    .then(async (res) => {
      if (res.ok && res.type === 'basic') {
        await cache.put(PAGE, res.clone());
        event.waitUntil(keepPageAssets(cache));
      }
      return res;
    });
  if (!saved) return network; // nothing saved yet: wait for the network
  const timeout = new Promise((resolve) => setTimeout(() => resolve(saved), NAV_TIMEOUT_MS));
  try {
    return await Promise.race([network, timeout]);
  } catch {
    return saved; // offline
  }
}

async function cacheFirst(event, refresh) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(event.request);
  if (hit) {
    if (refresh) event.waitUntil(fetch(event.request).then((r) => r.ok && cache.put(event.request, r)).catch(() => undefined));
    return hit;
  }
  const res = await fetch(event.request);
  if (res.ok && res.type === 'basic') cache.put(event.request, res.clone());
  return res;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // other sites: not ours to cache
  if (url.pathname === '/sw.js') return; // the browser checks this one itself
  if (req.mode === 'navigate') {
    event.respondWith(navigate(event));
  } else if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(event, false));
  } else {
    event.respondWith(cacheFirst(event, true));
  }
});
