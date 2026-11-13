const CACHE_NAME = 'agromacarena-35ha-v3';
const TILE_CACHE_NAME = 'agromacarena-map-tiles-v1';
const ASSETS = [
    './',
    './index.html',
    './manifest.json',
    './icon-192.png',
    './icon-512.png',
    './icon-192.svg',
    './icon-512.svg',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS).catch(() => {}))
    );
    self.skipWaiting();
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys => Promise.all(
            keys.filter(k => k !== CACHE_NAME && k !== TILE_CACHE_NAME).map(k => caches.delete(k))
        ))
    );
    self.clients.claim();
});

async function fetchConTimeout(req, ms) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    try {
        const res = await fetch(req, { signal: ctrl.signal });
        clearTimeout(timer);
        return res;
    } catch (err) {
        clearTimeout(timer);
        throw err;
    }
}

self.addEventListener('fetch', event => {
    const req = event.request;
    if (req.method !== 'GET') return;
    const url = new URL(req.url);

    // 1. Caché dedicada para cuadros de imagen satelitales / topográficos (Modo Offline en el Monte)
    if (
        req.url.includes('mt1.google.com/vt/') ||
        req.url.includes('tile.opentopomap.org/') ||
        req.url.includes('server.arcgisonline.com/ArcGIS/')
    ) {
        event.respondWith(
            caches.open(TILE_CACHE_NAME).then(cache =>
                cache.match(req).then(cached => {
                    const netFetch = fetch(req)
                        .then(res => {
                            if (res && (res.ok || res.type === 'opaque')) {
                                cache.put(req, res.clone());
                            }
                            return res;
                        })
                        .catch(() => cached);
                    return cached || netFetch;
                })
            )
        );
        return;
    }

    // 2. Recursos externos (Tailwind CDN, Google Fonts, Google Apps Script, Leaflet):
    // NUNCA devolver index.html como fallback para scripts/CSS externos.
    if (url.origin !== self.location.origin) {
        if (req.url.includes('unpkg.com/leaflet')) {
            event.respondWith(
                fetch(req)
                    .then(res => {
                        if (res && (res.ok || res.type === 'opaque')) {
                            const copy = res.clone();
                            caches.open(CACHE_NAME).then(cache => cache.put(req, copy));
                        }
                        return res;
                    })
                    .catch(() => caches.match(req))
            );
        }
        return;
    }

    // 3. Navegación principal (blindada contra Error 1033 / PC apagado / 404 / 5xx con timeout de 2s)
    if (req.mode === 'navigate' || url.pathname.endsWith('/index.html') || url.pathname === '/' || url.pathname.endsWith('/')) {
        event.respondWith((async () => {
            const cache = await caches.open(CACHE_NAME);
            try {
                const res = await fetchConTimeout(req, 2000);
                if (res && res.ok) {
                    cache.put(req, res.clone());
                    cache.put('./index.html', res.clone());
                    return res;
                }
            } catch {}
            return (await cache.match(req)) || (await cache.match('./index.html')) || (await cache.match('./'));
        })());
        return;
    }

    // 4. Llamadas API locales: red con fallback a caché (sin devolver index.html)
    if (url.pathname.includes('/api/')) {
        event.respondWith(
            fetch(req)
                .then(res => {
                    if (res && res.ok) {
                        const copy = res.clone();
                        caches.open(CACHE_NAME).then(cache => cache.put(req, copy));
                    }
                    return res;
                })
                .catch(() => caches.match(req))
        );
        return;
    }

    // 5. Archivos estáticos propios (manifest, íconos): Network-First con fallback a caché propia
    event.respondWith(
        fetch(req)
            .then(async res => {
                if (res && res.ok) {
                    const copy = res.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(req, copy));
                    return res;
                }
                return (await caches.match(req)) || res;
            })
            .catch(() => caches.match(req))
    );
});