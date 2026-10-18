/* Offline shell for the installed app.
   The shell is cached so the app opens instantly and shows a clear message
   when there is no connection. API responses are never cached: fees and
   attendance must always come from the server. */

const SHELL = 'plus-shell-v3';
const FILES = [
  '/',
  '/index.html',
  '/join.html',
  '/app/join.js',
  '/style.css',
  '/manifest.json',
  '/app/main.js',
  '/app/api.js',
  '/app/state.js',
  '/app/ui.js',
  '/app/rules.js',
  '/app/i18n.js',
  '/app/fonts.js',
  '/app/join-steps.js',
  '/app/onboard-steps.js',
  '/app/screens/login.js',
  '/app/screens/teacher.js',
  '/app/screens/teacher-forms.js',
  '/app/screens/family.js',
  '/app/screens/income.js',
  '/app/qr.js',
  '/assets/logo.png',
  '/assets/icon-192.png',
  '/assets/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL).then((cache) => cache.addAll(FILES)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return; // always live

  event.respondWith(
    caches.match(event.request).then(
      (hit) =>
        hit ||
        fetch(event.request)
          .then((res) => {
            if (res.ok && res.type === 'basic') {
              const copy = res.clone();
              caches.open(SHELL).then((cache) => cache.put(event.request, copy));
            }
            return res;
          })
          .catch(() => caches.match('/index.html')),
    ),
  );
});
