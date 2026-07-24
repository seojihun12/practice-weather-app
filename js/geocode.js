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

function hasHangul(text) {
  return /[가-힣]/.test(text);
}

// "삼성동"처럼 동/읍/면/리로 끝나거나 "용추로171번길 100"처럼 숫자(번지·건물번호)가 포함되면
// 세부 주소로 간주. 이런 건 카카오가 정확하고 Open-Meteo는 부정확(북한 지명과 혼동 등)함.
// 반대로 "서울"·"가평군"처럼 넓은 행정구역 이름은 카카오 키워드 검색이 관광명소 등 엉뚱한 장소를
// 1순위로 주는 문제가 있어서, Open-Meteo(도시 중심 좌표 제공)를 먼저 시도함.
function looksLikeDetailedAddress(text) {
  return /(동|읍|면|리)$/.test(text.trim()) || /\d/.test(text);
}

// 카카오 키워드 검색으로 지오코딩. 동/읍/면 단위 상세 지명이나 도로명주소, 랜드마크에 강함.
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

// Open-Meteo 지오코딩. 전 세계 도시/행정구역 이름에 강하지만, 국내 동 단위 이하는
// 북한 지명과 혼동되는 등 정확도가 낮음 (예: "삼성동" -> 평양).
async function geocodeOpenMeteo(query) {
  const res = await fetch(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=1&language=ko`
  );
  const data = await res.json();
  if (!data.results || data.results.length === 0) return null;
  return data.results[0];
}

// 도시/동네 이름 -> 위도/경도.
export async function geocode(city) {
  await kakaoLoadPromise;

  if (!looksLikeDetailedAddress(city)) {
    const omResult = await geocodeOpenMeteo(city);
    // 한글 검색인데 결과가 한국이 아니면(북한 등 오매칭) 신뢰하지 않고 카카오로 넘어감
    if (omResult && (!hasHangul(city) || omResult.country_code === "KR")) return omResult;
  }

  const kakaoResult = await geocodeKakao(city);
  if (kakaoResult) return kakaoResult;

  const addressResult = await geocodeKakaoAddress(city);
  if (addressResult) return addressResult;

  return await geocodeOpenMeteo(city);
}
