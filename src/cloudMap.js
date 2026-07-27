import { loadLeaflet } from "./leafletLoader.js";

// RainViewer: 무료, API 키 불필요. 과거 ~2시간치 실제 위성 적외선(구름) 타일 프레임을 제공해서
// 그대로 순서대로 넘기면 Windy처럼 구름이 흘러가는 애니메이션이 됨.
const RAINVIEWER_API = "https://api.rainviewer.com/public/weather-maps.json";
const FRAME_INTERVAL_MS = 500;

let map = null;
let frameLayers = [];
let playTimer = null;

async function fetchFrameUrls() {
  const res = await fetch(RAINVIEWER_API);
  const data = await res.json();
  const host = data.host;
  return (data.satellite?.infrared ?? []).map((frame) => `${host}${frame.path}/256/{z}/{x}/{y}/0/0_0.png`);
}

function ensureMap(L) {
  if (map) return map;
  map = L.map("cloudMapContainer", { zoomControl: true }).setView([36.3, 127.8], 6);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors",
    maxZoom: 18,
  }).addTo(map);
  return map;
}

function showFrame(index) {
  frameLayers.forEach((layer, i) => layer.setOpacity(i === index ? 0.75 : 0));
}

function stopPlayback() {
  if (playTimer) {
    clearInterval(playTimer);
    playTimer = null;
  }
}

async function loadCloudFrames(L) {
  frameLayers.forEach((layer) => map.removeLayer(layer));
  stopPlayback();

  const urls = await fetchFrameUrls();
  if (urls.length === 0) return;

  // 프레임을 미리 다 깔아두고 opacity만 바꿔가며 넘겨야 매 프레임 타일 로딩 텀 없이 부드럽게 재생됨
  frameLayers = urls.map((url) => L.tileLayer(url, { opacity: 0, zIndex: 5 }).addTo(map));

  let current = 0;
  showFrame(current);
  playTimer = setInterval(() => {
    current = (current + 1) % frameLayers.length;
    showFrame(current);
  }, FRAME_INTERVAL_MS);
}

export function initCloudMap() {
  const openBtn = document.getElementById("cloudMapBtn");
  const closeBtn = document.getElementById("cloudMapCloseBtn");
  const modal = document.getElementById("cloudMapModal");

  function close() {
    modal.classList.add("hidden");
    document.body.classList.remove("wind-map-open");
    stopPlayback();
  }

  openBtn.addEventListener("click", async () => {
    modal.classList.remove("hidden");
    document.body.classList.add("wind-map-open");
    const L = await loadLeaflet();
    ensureMap(L);
    requestAnimationFrame(() => map.invalidateSize());
    await loadCloudFrames(L);
  });

  closeBtn.addEventListener("click", close);
  modal.addEventListener("click", (e) => {
    if (e.target === modal) close();
  });
}
