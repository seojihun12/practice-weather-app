// 바람 지도(myWindMap.js)와 구름 지도(cloudMap.js)가 같이 쓰는 Leaflet 로더.
// 각자 따로 로드하면 <script>가 두 번 삽입돼서 중복 로딩되므로 하나로 공유.
let leafletLoadPromise = null;

export function loadLeaflet() {
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
