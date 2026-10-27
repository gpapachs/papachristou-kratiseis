/* Service worker: η εφαρμογή ανοίγει γρήγορα και φορτώνει ακόμα κι αν πέσει στιγμιαία το internet.
   Τα αρχεία της εφαρμογής φέρνονται πάντα πρώτα από το δίκτυο (για να έρχονται οι ενημερώσεις αμέσως)
   και μόνο αν δεν υπάρχει σύνδεση χρησιμοποιείται το αντίγραφο. Τα δεδομένα (Supabase) δεν αποθηκεύονται. */
const CACHE = 'kratiseis-v2.3.1';
const SHELL = [
  './', 'index.html', 'styles.css', 'theme.js', 'config.js', 'logic.js', 'store.js', 'floor.js', 'app.js',
  'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png', 'icons/badge-96.png', 'icons/mark.svg', 'icons/logo.svg', 'icons/favicon.svg'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Supabase (δεδομένα, σύνδεση, realtime): πάντα ζωντανά, ποτέ από cache
  if (url.hostname.endsWith('.supabase.co') || url.hostname.endsWith('.supabase.in')) return;

  const sameOrigin = url.origin === self.location.origin;
  const isLib = /cdn\.jsdelivr\.net|fonts\.(googleapis|gstatic)\.com/.test(url.hostname);
  if (!sameOrigin && !isLib) return;

  if (isLib) {
    // βιβλιοθήκες/γραμματοσειρές: από cache, αλλιώς δίκτυο
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
      const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); return res;
    })));
    return;
  }
  // αρχεία εφαρμογής: πρώτα δίκτυο, αλλιώς cache
  e.respondWith(fetch(req).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
    return res;
  }).catch(() => caches.match(req, { ignoreSearch: true }).then(hit => hit || caches.match('index.html'))));
});

/* ---------- Ειδοποιήσεις (push) για νέες / ακυρωμένες κρατήσεις ---------- */
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (x) { d = { title: 'Κρατήσεις', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    // αν η εφαρμογή είναι ανοιχτή μπροστά μας, το μήνυμα το δείχνει η ίδια πάνω στην οθόνη (με ήχο)
    const front = list.find(c => c.visibilityState === 'visible' && c.focused);
    if (front) { front.postMessage({ type: 'push', data: d }); return; }
    return self.registration.showNotification(d.title || 'Κρατήσεις', {
      body: d.body || '',
      tag: d.tag || undefined,
      renotify: true,
      icon: 'icons/icon-192.png',
      badge: 'icons/badge-96.png',
      vibrate: [200, 100, 200, 100, 300],
      requireInteraction: d.kind === 'new' || d.kind === 'soon',
      data: { url: d.url || './' }
    });
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || './', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    const c = list.find(x => x.url.startsWith(self.registration.scope));
    if (c) { c.postMessage({ type: 'open', url }); return c.focus(); }
    return self.clients.openWindow(url);
  }));
});
