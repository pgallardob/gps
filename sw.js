"use strict";

const VERSION = "dev-v1";
const PREFIX = `punto-shell:${new URL(self.registration.scope).pathname}:`;
const CACHE = PREFIX + VERSION;
// APP_ASSETS_START
const APP_ASSETS = [
    "./", "index.html", "share.html", "manifest.webmanifest", "css/styles.css", "assets/favicon.svg",
    "assets/icon-180.png", "assets/icon-192.png", "assets/icon-512.png",
    "vendor/leaflet/leaflet.css", "vendor/leaflet/leaflet.js", "vendor/leaflet/LICENSE",
    "vendor/leaflet/images/layers.png", "vendor/leaflet/images/layers-2x.png",
    "vendor/leaflet/images/marker-icon.png", "vendor/leaflet/images/marker-icon-2x.png", "vendor/leaflet/images/marker-shadow.png",
    "js/deployment.js", "js/config.js", "js/geo.js", "js/location.js", "js/address.js", "js/map.js",
    "js/session.js", "js/route-files.js", "js/qgis.js", "js/sharing-client.js", "js/sharing.js",
    "js/share-publisher.js", "js/pwa.js", "js/app.js"
];
// APP_ASSETS_END
const URLS = new Set(APP_ASSETS.map(path => new URL(path, self.registration.scope).href));

self.addEventListener("install", event => {
    event.waitUntil(caches.open(CACHE).then(cache => cache.addAll([...URLS])));
    // Do not replace a running app or reload an unsaved GPS session automatically.
});

self.addEventListener("activate", event => {
    event.waitUntil((async () => {
        const names = await caches.keys();
        await Promise.all(names.filter(name => name.startsWith(PREFIX) && name !== CACHE).map(name => caches.delete(name)));
        await self.clients.claim();
    })());
});

self.addEventListener("fetch", event => {
    const request = event.request;
    const url = new URL(request.url);
    // No API traffic, credentials, invitation URLs with query parameters, maps, or offline upload queues.
    if (request.method !== "GET" || url.origin !== self.location.origin || url.search ||
        request.headers.has("Authorization") || request.headers.has("X-Punto-Token") || !URLS.has(url.href)) return;
    event.respondWith((async () => {
        const cache = await caches.open(CACHE);
        try {
            const response = await fetch(request);
            if (!response.ok) {
                const cached = await cache.match(request);
                if (cached) return cached;
            }
            if (response.ok && response.type !== "opaque") await cache.put(request, response.clone());
            return response;
        } catch {
            const cached = await cache.match(request);
            return cached || new Response("Sin conexión. Abre la aplicación una vez con internet.", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
        }
    })());
});
