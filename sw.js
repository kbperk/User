// OneSignalのコアシステムを読み込み
importScripts("https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js");

// PWAのインストール要件（Add to Home Screen）を満たすためのダミーイベント
// ※通信には一切干渉せず、すべてのリクエストをブラウザの標準動作に任せます（完全な通信パススルー）
self.addEventListener('fetch', function(event) {
    // 何もせず素通りさせる
});