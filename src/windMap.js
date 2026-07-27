// windy.com 공식 임베드 위젯(무료, API 키 불필요). 대한민국 전역이 보이도록 중심 좌표 고정.
const WINDY_EMBED_URL =
  "https://embed.windy.com/embed2.html?lat=36.5&lon=127.8&detailLat=36.5&detailLon=127.8" +
  "&width=650&height=450&zoom=6&level=surface&overlay=wind&product=ecmwf" +
  "&menu=&message=true&marker=&calendar=now&pressure=&type=map&location=coordinates" +
  "&detail=&metricWind=default&metricTemp=default&radarRange=-1";

export function initWindMap() {
  const openBtn = document.getElementById("windMapBtn");
  const closeBtn = document.getElementById("windMapCloseBtn");
  const modal = document.getElementById("windMapModal");
  const iframe = document.getElementById("windMapFrame");

  function close() {
    modal.classList.add("hidden");
    document.body.classList.remove("wind-map-open");
  }

  openBtn.addEventListener("click", () => {
    if (!iframe.src) iframe.src = WINDY_EMBED_URL; // 처음 열 때만 로드
    modal.classList.remove("hidden");
    // 모달이 떠 있는 동안 배경 페이지 스크롤/핀치줌을 잠가서 지도 조작이 배경에 새지 않게 함
    document.body.classList.add("wind-map-open");
  });

  closeBtn.addEventListener("click", close);
  modal.addEventListener("click", (e) => {
    if (e.target === modal) close();
  });
}
