importScripts("https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js");

// ★古いキャッシュを強制破棄させるため v2 に変更
const CACHE_NAME = 'kb-park-cache-v2';

self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  
  // ★追加: OneSignalやGAS等の外部通信は絶対にキャッシュを通さず、素通りさせる（通信遮断の防止）
  if (url.hostname.includes('onesignal.com') || url.hostname.includes('script.google.com')) {
      return; 
  }

  // 基本は常に最新のネットワークデータを取得し、通信エラー時のみキャッシュを返す安全な設定
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});