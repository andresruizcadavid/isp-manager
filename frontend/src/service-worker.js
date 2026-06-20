/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

const sw = /** @type {ServiceWorkerGlobalScope} */ (/** @type {unknown} */ (self));

import { build, files, version } from '$service-worker';

const ASSETS = `cache-${version}`;
const STATIC_ASSETS = build.concat(files).filter(
  (f) => !f.includes('version.json') && !f.includes('manifest.json')
);

sw.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(ASSETS).then((cache) => cache.addAll(STATIC_ASSETS)).then(() => sw.skipWaiting())
  );
});

sw.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((k) => { if (k !== ASSETS) return caches.delete(k); }))
    ).then(() => sw.clients.claim())
  );
});

sw.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/')) return;
  if (url.pathname.startsWith('/socket.io/')) return;
  if (request.method !== 'GET') return;

  // Hashed build assets are immutable (their URL changes when content changes),
  // so cache-first is safe and fast.
  const isImmutable =
    build.includes(url.pathname) || url.pathname.startsWith('/_app/immutable/');

  if (isImmutable) {
    event.respondWith(caches.match(request).then((cached) => cached || fetch(request)));
    return;
  }

  // Everything else — navigations (HTML), the SPA fallback (200.html) and other
  // static files — uses NETWORK-FIRST. This was the fix for the mobile
  // "flicker / reload loop": cache-first used to serve a STALE app shell that
  // referenced JS chunks a later deploy had already deleted → chunk-load error
  // → SvelteKit auto-reload → loop. Network-first always picks up the latest
  // deploy and only falls back to cache when truly offline.
  event.respondWith(
    fetch(request)
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(ASSETS).then((c) => c.put(request, copy)).catch(() => {});
        }
        return res;
      })
      .catch(async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        // Last resort for client-side routes when offline: the SPA shell.
        return (await caches.match('/200.html')) || (await caches.match('/index.html')) || Response.error();
      })
  );
});
