// Service worker d'Atelier Vidéo : garde l'interface disponible hors ligne.
// Les appels à l'API (autre domaine) ne passent jamais par le cache.
const CACHE = 'atelier-video-v1';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png'];

self.addEventListener('install', event => {
    event.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', event => {
    const req = event.request;
    if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
    // Réseau d'abord (pour recevoir les mises à jour), cache si hors ligne
    event.respondWith(
        fetch(req)
            .then(res => {
                const copy = res.clone();
                caches.open(CACHE).then(c => c.put(req, copy));
                return res;
            })
            .catch(() => caches.match(req).then(r => r || caches.match('./index.html')))
    );
});
