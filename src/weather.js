import { BACKEND_URL } from "./constants.js";
import { geocode } from "./geocode.js";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Render 무료 플랜은 일정 시간 요청이 없으면 서버가 잠들고, 깨어나는 데 최대 수십 초가 걸린다.
// 그 사이에 오는 요청은 연결 실패/5xx로 떨어지므로 몇 차례 재시도하며 기다려준다.
const COLD_START_MAX_RETRIES = 8;
const COLD_START_RETRY_DELAY_MS = 5000;

// Open-Meteo + 기상청 3종(실황/초단기예보/단기예보) 조회를 백엔드(FastAPI)에 위임.
// 백엔드가 기상청 서비스키를 들고 있고, 같은 위경도에 대해선 캐싱해서 응답한다.
async function fetchWeatherFromBackend(place) {
  const url = `${BACKEND_URL}/api/weather?lat=${place.latitude}&lon=${place.longitude}`;

  for (let attempt = 0; attempt <= COLD_START_MAX_RETRIES; attempt++) {
    let res;
    try {
      res = await fetch(url);
    } catch (err) {
      if (attempt === COLD_START_MAX_RETRIES) throw err;
      await sleep(COLD_START_RETRY_DELAY_MS);
      continue;
    }

    if (res.ok) return res.json();
    if (res.status >= 500 && attempt < COLD_START_MAX_RETRIES) {
      await sleep(COLD_START_RETRY_DELAY_MS);
      continue;
    }
    throw new Error(`백엔드 응답 오류 (${res.status})`);
  }
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
