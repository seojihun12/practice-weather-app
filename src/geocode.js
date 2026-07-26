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

// 카카오 주소 검색(Geocoder). 실제로는 "경기 가평군" -> address_type: REGION, "서울특별시" -> REGION처럼
// 행정구역 이름이든 "용추로171번길 100" 같은 도로명주소든 카카오 공식 주소 체계 그대로 정확히 잡아줌.
// keywordSearch(장소/상호명 검색)보다 신뢰도가 높아서 국내 지명은 이걸 최우선으로 사용.
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

// 카카오 키워드 검색. "강남역"·"경복궁"처럼 정식 주소가 아닌 랜드마크/장소명 검색에 강함.
// addressSearch가 못 찾을 때만 보완용으로 사용.
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

// 도시/동네 이름 -> 위도/경도.
// 1) 카카오 주소 검색(행정구역·도로명·지번 주소를 카카오 공식 체계로 정확히 매칭)
// 2) 카카오 키워드 검색(정식 주소가 아닌 랜드마크·장소명)
// 3) Open-Meteo 지오코딩(해외 도시 등 카카오가 못 찾는 경우)
export async function geocode(city) {
  await kakaoLoadPromise;

  const addressResult = await geocodeKakaoAddress(city);
  if (addressResult) return addressResult;

  const kakaoResult = await geocodeKakao(city);
  if (kakaoResult) return kakaoResult;

  const res = await fetch(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=ko`
  );
  const data = await res.json();
  if (!data.results || data.results.length === 0) return null;
  return data.results[0];
}
