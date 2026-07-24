import { KAKAO_JS_KEY } from "./constants.js";

// 카카오 지도 JS SDK를 동적으로 로드. 로드가 끝나야 kakao.maps.services를 쓸 수 있어서
// 다른 모든 지오코딩 요청은 이 Promise가 풀릴 때까지 기다림.
export const kakaoLoadPromise = new Promise((resolve) => {
  const script = document.createElement("script");
  script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${KAKAO_JS_KEY}&autoload=false&libraries=services`;
  script.onload = () => window.kakao.maps.load(resolve);
  script.onerror = () => resolve(); // 로드 실패해도 앱은 계속 동작 (해외 도시는 Open-Meteo로 처리)
  document.head.appendChild(script);
});

// 카카오 키워드 검색으로 지오코딩. 국내 동/면 단위까지 정확하게 잡아줌
// (Open-Meteo 지오코딩은 "삼성동" 검색 시 평양이 1순위로 나오는 등 국내 지명 정확도가 낮아서 대체).
function geocodeKakao(query) {
  return new Promise((resolve) => {
    if (!window.kakao || !window.kakao.maps) { resolve(null); return; }
    const places = new kakao.maps.services.Places();
    places.keywordSearch(query, (data, status) => {
      if (status === kakao.maps.services.Status.OK && data.length > 0) {
        const r = data[0];
        resolve({
          name: r.address_name || r.place_name,
          admin1: "",
          country: "대한민국",
          latitude: parseFloat(r.y),
          longitude: parseFloat(r.x),
        });
      } else {
        resolve(null);
      }
    });
  });
}

// 도시/동네 이름 -> 위도/경도. 카카오로 먼저 시도하고(국내 지명 정확도가 더 좋음),
// 카카오가 못 찾으면(해외 도시 등) Open-Meteo 지오코딩으로 재시도.
export async function geocode(city) {
  await kakaoLoadPromise;

  const kakaoResult = await geocodeKakao(city);
  if (kakaoResult) return kakaoResult;

  const res = await fetch(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=ko`
  );
  const data = await res.json();
  if (!data.results || data.results.length === 0) return null;
  return data.results[0];
}
