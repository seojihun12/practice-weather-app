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
// "가평"처럼 순수 행정구역 이름을 검색하면 카카오가 관련 상호명/POI를 1순위로 잡아버릴 수 있어서,
// 결과 중 카테고리가 "행정구역"인 항목이 있으면 그걸 우선 사용함.
function geocodeKakao(query) {
  return new Promise((resolve) => {
    if (!window.kakao || !window.kakao.maps) { resolve(null); return; }
    const places = new kakao.maps.services.Places();
    places.keywordSearch(query, (data, status) => {
      if (status === kakao.maps.services.Status.OK && data.length > 0) {
        const r = data.find(d => d.category_name?.startsWith("행정구역")) || data[0];
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

// 카카오 주소 검색(Geocoder)으로 지오코딩. keywordSearch는 상호명/장소명 검색에 최적화돼 있어서
// 상호명 없는 순수 도로명·지번 주소(예: "용추로171번길 100")는 못 찾는 경우가 있어 보완용으로 사용.
function geocodeKakaoAddress(query) {
  return new Promise((resolve) => {
    if (!window.kakao || !window.kakao.maps) { resolve(null); return; }
    const geocoder = new kakao.maps.services.Geocoder();
    geocoder.addressSearch(query, (data, status) => {
      if (status === kakao.maps.services.Status.OK && data.length > 0) {
        const r = data[0];
        resolve({
          name: r.address_name,
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

// 도시/동네 이름 -> 위도/경도.
// 1) 카카오 키워드 검색(행정구역 우선 매칭 + 장소명/랜드마크에 강함)
// 2) 카카오 주소 검색(상호명 없는 순수 도로명·지번 주소에 강함, 1번이 못 찾을 때만 보완)
// 3) Open-Meteo 지오코딩(해외 도시 등 카카오가 못 찾는 경우)
export async function geocode(city) {
  await kakaoLoadPromise;

  const kakaoResult = await geocodeKakao(city);
  if (kakaoResult) return kakaoResult;

  const addressResult = await geocodeKakaoAddress(city);
  if (addressResult) return addressResult;

  const res = await fetch(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=ko`
  );
  const data = await res.json();
  if (!data.results || data.results.length === 0) return null;
  return data.results[0];
}
