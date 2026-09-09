// ux-review 뷰어 서비스 워커.
//
// 산출물(WebM·PNG)은 수 MB~수십 MB라 캐시하지 않는다. 목록과 판정도 계속 바뀌므로
// 캐시하지 않는다. 캐시는 오프라인에서 껍데기라도 뜨게 하는 용도로만 쓴다.
// 오리진을 다른 앱과 나눠 쓸 수 있다. 캐시 정리는 반드시 우리 접두사 안에서만 한다.
const PREFIX = 'ux-review-';
const VERSION = PREFIX + 'v1';
const SHELL = ['/', '/ui/ui.css', '/ui/tokens.css', '/ui/base.css', '/ui/components.css'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((k) => k.startsWith(PREFIX) && k !== VERSION)
        .map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // 데이터와 산출물은 늘 서버에서 받는다. 오래된 목록을 보여주는 쪽이 더 나쁘다.
  if (url.pathname.startsWith('/api/')
    || url.pathname.startsWith('/files/')
    || url.pathname.startsWith('/download/')) return;

  // 껍데기는 네트워크 우선, 끊겼을 때만 캐시로 되돌린다.
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(VERSION).then((cache) => cache.put(request, copy)).catch(() => {});
        }
        return response;
      })
      .catch(() => caches.match(request).then((hit) => hit
        || (request.mode === 'navigate' ? caches.match('/') : undefined))),
  );
});
