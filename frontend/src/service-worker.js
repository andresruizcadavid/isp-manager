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
  const url = new URL(event.request.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/')) return;
  if (url.pathname.startsWith('/socket.io/')) return;
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
