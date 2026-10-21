/* Offline shell for the installed app.
   The shell is cached so the app opens and shows a clear message when there
   is no connection. API responses are never cached: fees and attendance must
   always come from the server.

   The code is served NETWORK FIRST, and the cache is only the fallback.

   It used to be the other way round - cache first, network only on a miss -
   and that made every deploy invisible. A browser that had opened the app
   once held `login.js` in the cache and kept serving it, so new screens
   simply never arrived: teachers saw the old login for as long as the cache
   name stayed the same. Bumping SHELL on every deploy is easy to forget, and
   forgetting it is silent. Network first cannot be forgotten.

   What this costs is one request per file on a warm start; what it buys is
   that what is deployed is what runs. Images and icons, which do not change
   without changing name, stay cache first. */

const SHELL = 'plus-shell-v4';
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

/** Things that never change without changing their name. */
const IMMUTABLE = /\.(png|jpg|jpeg|svg|webp|woff2?|ico)$/i;

/** Keep the cache in step with what the network just gave us. */
async function store(request, response) {
  if (!response.ok || response.type !== 'basic') return;
  const cache = await caches.open(SHELL);
  await cache.put(request, response.clone());
}

/** The network decides; the cache catches us when it is not there. */
async function networkFirst(request) {
  try {
    const fresh = await fetch(request);
    await store(request, fresh);
    return fresh;
  } catch {
    const hit = await caches.match(request);
    if (hit) return hit;
    // A navigation with nothing cached still has to render something.
    if (request.mode === 'navigate') {
      const shell = await caches.match('/index.html');
      if (shell) return shell;
    }
    throw new Error('offline and not cached');
  }
}

/** For bytes that do not change: answer at once, refresh in the background. */
async function cacheFirst(request) {
  const hit = await caches.match(request);
  if (hit) return hit;
  const fresh = await fetch(request);
  await store(request, fresh);
  return fresh;
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return; // always live

  event.respondWith(
    IMMUTABLE.test(url.pathname) ? cacheFirst(event.request) : networkFirst(event.request),
  );
});
