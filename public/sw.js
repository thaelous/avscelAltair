// Service Worker de Alto Rendimiento para AVS Mobile Studio Pro
const CACHE_NAME = 'avs-studio-v2';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon.svg',
  '/pwa-192x192.png',
  '/pwa-512x512.png',
  '/pwa-maskable-512x512.png',
  '/apple-touch-icon.png'
];

// Instalación: Precaching de recursos críticos
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    }).then(() => self.skipWaiting())
  );
});

// Activación: Limpieza de caches antiguos y toma de control inmediata
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Estrategia de Fetch:
// - Para navegación (HTML): Network first con fallback a cache offline.
// - Para assets estáticos, scripts, fuentes y estilos: Cache first con revalidación en segundo plano.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Omitir peticiones no GET o de esquemas no soportados (ej. chrome-extension)
  if (req.method !== 'GET' || !req.url.startsWith('http')) {
    return;
  }

  // Peticiones de navegación (documentos)
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).then((networkRes) => {
        if (networkRes && networkRes.status === 200) {
          const resClone = networkRes.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
        }
        return networkRes;
      }).catch(() => {
        return caches.match('/index.html') || caches.match('/');
      })
    );
    return;
  }

  // Recursos estáticos y fuentes externas (Google Fonts, cdnjs, etc.)
  event.respondWith(
    caches.match(req).then((cachedRes) => {
      if (cachedRes) {
        // Revalidar en segundo plano para mantener assets frescos
        fetch(req).then((networkRes) => {
          if (networkRes && networkRes.status === 200) {
            caches.open(CACHE_NAME).then((cache) => cache.put(req, networkRes));
          }
        }).catch(() => {});
        return cachedRes;
      }

      return fetch(req).then((networkRes) => {
        if (networkRes && networkRes.status === 200) {
          const resClone = networkRes.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
        }
        return networkRes;
      }).catch((err) => {
        // Fallback silencioso si falla la red
        return cachedRes;
      });
    })
  );
});
