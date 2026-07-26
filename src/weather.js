import { BACKEND_URL } from "./constants.js";
import { geocode } from "./geocode.js";

// Open-Meteo + 기상청 3종(실황/초단기예보/단기예보) 조회를 백엔드(FastAPI)에 위임.
// 백엔드가 기상청 서비스키를 들고 있고, 같은 위경도에 대해선 캐싱해서 응답한다.
async function fetchWeatherFromBackend(place) {
  const res = await fetch(`${BACKEND_URL}/api/weather?lat=${place.latitude}&lon=${place.longitude}`);
  if (!res.ok) throw new Error(`백엔드 응답 오류 (${res.status})`);
  return res.json();
}

// 도시 하나에 대해 지오코딩 + 백엔드 날씨 조회
export async function fetchCityWeather(city) {
  const place = await geocode(city);
  if (!place) return { ok: false, query: city };

  const { openMeteo, kma, kmaForecast, kmaHourly } = await fetchWeatherFromBackend(place);

  return {
    ok: true,
    query: city,
    label: `${place.name}${place.admin1 ? ", " + place.admin1 : ""} (${place.country})`,
    openMeteo,
    kma,
    kmaForecast,
    kmaHourly,
  };
}
