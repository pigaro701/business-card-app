const CACHE = 'myeonghamcheop-v5';  // 버전 올릴 때마다 캐시 강제 갱신
const ASSETS = [
  '/',
  '/index.html',
  '/css/style.css',
  '/js/app.js',
  '/js/config.js',
  '/manifest.json',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  // CDN / API 요청은 캐시하지 않음 (항상 네트워크)
  if (
    e.request.url.includes('cdn.jsdelivr') ||
    e.request.url.includes('supabase') ||
    e.request.url.includes('fonts.googleapis') ||
    e.request.url.includes('fonts.gstatic') ||
    e.request.url.includes('/api/')
  ) {
    return;
  }
  // 네트워크 우선 → 실패 시 캐시 (항상 최신 코드 사용)
  e.respondWith(
    fetch(e.request)
      .then(res => {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
