const CACHE_NAME = "weather-app-shell-v6";
const APP_SHELL = [
  "./",
  "index.html",
  "style.css",
  "src/main.js",
  "src/weather.js",
  "src/render.js",
  "src/charts.js",
  "src/geocode.js",
  "src/constants.js",
  "src/storage.js",
  "src/windMap.js",
  "src/leafletLoader.js",
  "src/myWindMap.js",
  "src/radarMap.js",
  "src/installApp.js",
  "manifest.json",
  "icons/icon.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

// 앱 셸(정적 파일)만 캐시 우선으로 응답. 백엔드/Open-Meteo/기상청/카카오 같은 API 호출은
// 캐시하지 않고 항상 네트워크로 보내서 날씨 데이터가 오래된 채로 보이는 일이 없게 함.
self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;

  event.respondWith(caches.match(request).then((cached) => cached || fetch(request)));
});
