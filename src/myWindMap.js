// 기상청 대신 Open-Meteo를 쓰는 이유: 한 번의 요청으로 위경도 여러 개를 배열로 보낼 수 있어서,
// 대한민국 전역 격자를 API 호출 한 번으로 받아올 수 있음(기상청은 격자점 하나당 호출 1번 필요).
const KOREA_LAT_STEPS = [33.5, 34.5, 35.5, 36.5, 37.5, 38.5];
const KOREA_LON_STEPS = [125, 126, 127, 128, 129];

let leafletLoadPromise = null;
function loadLeaflet() {
  if (leafletLoadPromise) return leafletLoadPromise;
  leafletLoadPromise = new Promise((resolve, reject) => {
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
    document.head.appendChild(css);

    const script = document.createElement("script");
    script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
    script.onload = () => resolve(window.L);
    script.onerror = () => reject(new Error("Leaflet 로드 실패"));
    document.head.appendChild(script);
  });
  return leafletLoadPromise;
}

function buildGridPoints() {
  const points = [];
  for (const lat of KOREA_LAT_STEPS) {
    for (const lon of KOREA_LON_STEPS) points.push({ lat, lon });
  }
  return points;
}

async function fetchWindGrid(points) {
  const lats = points.map((p) => p.lat).join(",");
  const lons = points.map((p) => p.lon).join(",");
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}&current=wind_speed_10m,wind_direction_10m&timezone=auto`;
  const res = await fetch(url);
  const data = await res.json();
  const results = Array.isArray(data) ? data : [data]; // 좌표가 1개면 배열이 아니라 객체 하나로 옴
  return points.map((p, i) => ({
    lat: p.lat,
    lon: p.lon,
    speed: results[i]?.current?.wind_speed_10m,
    direction: results[i]?.current?.wind_direction_10m,
  }));
}

function windColor(speed) {
  if (speed == null) return "#94a3b8";
  if (speed < 10) return "#2563eb";
  if (speed < 20) return "#16a34a";
  if (speed < 35) return "#ea580c";
  return "#dc2626";
}

function arrowIcon(L, point) {
  const size = 16 + (Math.min(point.speed ?? 0, 40) / 40) * 16;
  // wind_direction_10m은 "바람이 불어오는 방향"이라 화살표가 실제로 흘러가는 방향을 가리키게 하려면 180도 뒤집어야 함
  const rotation = ((point.direction ?? 0) + 180) % 360;
  const html = `<div style="transform: rotate(${rotation}deg); font-size:${size}px; color:${windColor(point.speed)};">↑</div>`;
  return L.divIcon({ html, className: "wind-arrow-icon", iconSize: [size, size], iconAnchor: [size / 2, size / 2] });
}

let map = null;
let markersLayer = null;

function ensureMap(L) {
  if (map) return map;
  map = L.map("myMapContainer", { zoomControl: true }).setView([36.3, 127.8], 6);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors",
    maxZoom: 18,
  }).addTo(map);
  markersLayer = L.layerGroup().addTo(map);
  return map;
}

async function loadWindArrows(L) {
  const points = buildGridPoints();
  const grid = await fetchWindGrid(points);
  markersLayer.clearLayers();
  grid.forEach((point) => {
    if (point.speed == null) return;
    L.marker([point.lat, point.lon], { icon: arrowIcon(L, point), interactive: false }).addTo(markersLayer);
  });
}

export function initMyWindMap() {
  const openBtn = document.getElementById("myMapBtn");
  const closeBtn = document.getElementById("myMapCloseBtn");
  const modal = document.getElementById("myMapModal");

  function close() {
    modal.classList.add("hidden");
    document.body.classList.remove("wind-map-open");
  }

  openBtn.addEventListener("click", async () => {
    modal.classList.remove("hidden");
    document.body.classList.add("wind-map-open");
    const L = await loadLeaflet();
    ensureMap(L);
    // 모달이 display:none이던 상태에서 막 보여진 직후라 지도 크기 재계산이 필요함
    requestAnimationFrame(() => map.invalidateSize());
    await loadWindArrows(L);
  });

  closeBtn.addEventListener("click", close);
  modal.addEventListener("click", (e) => {
    if (e.target === modal) close();
  });
}
