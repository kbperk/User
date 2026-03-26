importScripts("https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js");

const CACHE_NAME = 'kb-park-cache-v1';

self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (e) => {
  // 基本は常に最新のネットワークデータを取得し、通信エラー時のみキャッシュを返す安全な設定
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});