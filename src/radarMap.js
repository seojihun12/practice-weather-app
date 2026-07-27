import { loadLeaflet } from "./leafletLoader.js";

// RainViewer: 무료, API 키 불필요. (위성 구름 이미지는 public API에서 항상 비어있어서 강수 레이더로 대체함)
// 과거 ~2시간치 실제 레이더 프레임을 그대로 순서대로 넘기면 비/눈이 흘러가는 애니메이션이 됨.
const RAINVIEWER_API = "https://api.rainviewer.com/public/weather-maps.json";
const FRAME_INTERVAL_MS = 500;

let map = null;
let frameLayers = [];
let playTimer = null;

async function fetchFrameUrls() {
  const res = await fetch(RAINVIEWER_API);
  const data = await res.json();
  const host = data.host;
  return (data.radar?.past ?? []).map((frame) => `${host}${frame.path}/256/{z}/{x}/{y}/2/1_1.png`);
}

function ensureMap(L) {
  if (map) return map;
  map = L.map("radarMapContainer", { zoomControl: true }).setView([36.3, 127.8], 6);
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

async function loadRadarFrames(L) {
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

export function initRadarMap() {
  const openBtn = document.getElementById("radarMapBtn");
  const closeBtn = document.getElementById("radarMapCloseBtn");
  const modal = document.getElementById("radarMapModal");

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
    await loadRadarFrames(L);
  });

  closeBtn.addEventListener("click", close);
  modal.addEventListener("click", (e) => {
    if (e.target === modal) close();
  });
}
