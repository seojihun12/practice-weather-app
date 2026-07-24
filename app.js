const form = document.getElementById("searchForm");
const cityInput = document.getElementById("cityInput");
const statusMsg = document.getElementById("statusMsg");
const resultsContainer = document.getElementById("resultsContainer");

// 기상청 API 인증키. 코드에만 존재하며 화면에는 노출되지 않음.
const KMA_KEY = "60d0f885d832f29ab3ca30908375c57db9c3d27dcf2d61cc6f9d32da02022f66";

// 카카오 JavaScript 키. 도메인 화이트리스트로 보호되는 공개용 키라 코드에 있어도 됨.
const KAKAO_JS_KEY = "a748c6007515dc9de3e8ed0e03284441";

const kakaoLoadPromise = new Promise((resolve) => {
  const script = document.createElement("script");
  script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${KAKAO_JS_KEY}&autoload=false&libraries=services`;
  script.onload = () => window.kakao.maps.load(resolve);
  script.onerror = () => resolve(); // 로드 실패해도 앱은 계속 동작 (해외 도시는 Open-Meteo로 처리)
  document.head.appendChild(script);
});

// ---- 날씨 코드 설명 ----
const WEATHER_CODES = {
  0: "맑음", 1: "대체로 맑음", 2: "구름 조금", 3: "흐림",
  45: "안개", 48: "짙은 안개",
  51: "약한 이슬비", 53: "이슬비", 55: "강한 이슬비",
  61: "약한 비", 63: "비", 65: "강한 비",
  71: "약한 눈", 73: "눈", 75: "폭설",
  80: "약한 소나기", 81: "소나기", 82: "강한 소나기",
  95: "뇌우", 96: "우박 동반 뇌우", 99: "강한 우박 동반 뇌우",
};
function describeWeatherCode(code) {
  return WEATHER_CODES[code] || "-";
}

const KMA_PTY_CODES = {
  0: "강수 없음", 1: "비", 2: "비/눈", 3: "눈", 5: "빗방울", 6: "빗방울눈날림", 7: "눈날림",
};
function describeKmaPty(code) {
  return KMA_PTY_CODES[code] ?? "-";
}

const KMA_SKY_CODES = { 1: "맑음", 3: "구름 많음", 4: "흐림" };
function describeKmaSky(code) {
  return KMA_SKY_CODES[code] ?? "-";
}

function formatDayLabel(dateStr, index) {
  if (index === 0) return "오늘";
  if (index === 1) return "내일";
  const days = ["일", "월", "화", "수", "목", "금", "토"];
  const d = new Date(dateStr);
  return `${d.getMonth() + 1}/${d.getDate()} (${days[d.getDay()]})`;
}

function formatHourLabel(timeStr, index) {
  if (index === 0) return "지금";
  const hour = Number(timeStr.slice(11, 13));
  return `${hour}시`;
}

// ---- 공통: 도시/동네 이름 -> 위도/경도 ----
// 국내 지명(동/면 단위 포함)은 카카오로, 카카오가 못 찾으면(해외 도시 등) Open-Meteo로 재시도
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

async function geocode(city) {
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

// ---- 오늘/내일을 새벽·오전·오후·저녁 4구간으로 요약 (비가 언제 오고 언제 그치는지 한눈에 보이게) ----
const DAY_PERIODS = [
  { key: "dawn", label: "새벽", from: 0, to: 6 },
  { key: "morning", label: "오전", from: 6, to: 12 },
  { key: "afternoon", label: "오후", from: 12, to: 18 },
  { key: "evening", label: "저녁", from: 18, to: 24 },
];

function summarizePeriod(hours) {
  if (hours.length === 0) return null;
  const temps = hours.map(h => h.temp);
  const max = Math.max(...temps);
  const min = Math.min(...temps);
  const pop = Math.max(...hours.map(h => h.pop ?? 0));
  const rainCodes = hours.map(h => h.code).filter(c => c >= 51);
  const repCode = rainCodes.length > 0
    ? Math.max(...rainCodes)
    : hours[Math.floor(hours.length / 2)].code;
  return {
    desc: describeWeatherCode(repCode),
    max,
    min,
    pop: Math.round(pop),
    hasRain: rainCodes.length > 0,
  };
}

function buildDayTimeline(hourly, dateStr, label) {
  const buckets = { dawn: [], morning: [], afternoon: [], evening: [] };

  hourly.time.forEach((t, i) => {
    if (!t.startsWith(dateStr)) return;
    const hour = Number(t.slice(11, 13));
    const item = { temp: hourly.temperature_2m[i], code: hourly.weather_code[i], pop: hourly.precipitation_probability[i] };
    const period = DAY_PERIODS.find(p => hour >= p.from && hour < p.to);
    if (period) buckets[period.key].push(item);
  });

  return {
    label,
    periods: DAY_PERIODS.map(p => ({ label: p.label, ...(summarizePeriod(buckets[p.key]) || { desc: "-", max: null, min: null, pop: 0, hasRain: false }) })),
  };
}

// ---- 소스 1: Open-Meteo (키 불필요) ----
async function fetchOpenMeteo(place) {
  const res = await fetch(
    `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}` +
    `&current=temperature_2m,relative_humidity_2m,apparent_temperature,wind_speed_10m` +
    `&hourly=temperature_2m,weather_code,precipitation_probability` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min` +
    `&timezone=auto&forecast_days=7`
  );
  const data = await res.json();
  const current = data.current;
  const daily = data.daily;
  const hourly = data.hourly;

  const forecast = daily.time.map((date, i) => ({
    dateKey: date.replace(/-/g, ""),
    label: formatDayLabel(date, i),
    desc: describeWeatherCode(daily.weather_code[i]),
    max: daily.temperature_2m_max[i],
    min: daily.temperature_2m_min[i],
  }));

  // 현재 시각과 같은 "정시"부터 앞으로 12시간치를 뽑아옴
  const currentHourStr = current.time.slice(0, 14) + "00";
  let startIdx = hourly.time.indexOf(currentHourStr);
  if (startIdx === -1) startIdx = 0;

  const hourlyForecast = hourly.time.slice(startIdx, startIdx + 12).map((t, i) => ({
    label: formatHourLabel(t, i),
    temp: hourly.temperature_2m[startIdx + i],
    desc: describeWeatherCode(hourly.weather_code[startIdx + i]),
  }));

  const dayTimelines = [
    buildDayTimeline(hourly, daily.time[0], "오늘"),
    buildDayTimeline(hourly, daily.time[1], "내일"),
  ];

  return {
    temp: `${current.temperature_2m}°C`,
    feelsLike: `${current.apparent_temperature}°C`,
    humidity: `${current.relative_humidity_2m}%`,
    wind: `${current.wind_speed_10m} km/h`,
    forecast,
    hourlyForecast,
    dayTimelines,
  };
}

// ---- 소스 2: 기상청 단기예보 (위경도 -> 격자좌표 변환 필요) ----
// KMA 공식 변환식 (Lambert Conformal Conic). 위경도를 기상청 격자 nx, ny로 바꿔줌.
function latLonToKmaGrid(lat, lon) {
  const RE = 6371.00877, GRID = 5.0, SLAT1 = 30.0, SLAT2 = 60.0, OLON = 126.0, OLAT = 38.0, XO = 43, YO = 136;
  const DEGRAD = Math.PI / 180.0;
  const re = RE / GRID;
  const slat1 = SLAT1 * DEGRAD;
  const slat2 = SLAT2 * DEGRAD;
  const olon = OLON * DEGRAD;
  const olat = OLAT * DEGRAD;

  let sn = Math.tan(Math.PI * 0.25 + slat2 * 0.5) / Math.tan(Math.PI * 0.25 + slat1 * 0.5);
  sn = Math.log(Math.cos(slat1) / Math.cos(slat2)) / Math.log(sn);
  let sf = Math.tan(Math.PI * 0.25 + slat1 * 0.5);
  sf = (Math.pow(sf, sn) * Math.cos(slat1)) / sn;
  let ro = Math.tan(Math.PI * 0.25 + olat * 0.5);
  ro = (re * sf) / Math.pow(ro, sn);

  let ra = Math.tan(Math.PI * 0.25 + (lat * DEGRAD) * 0.5);
  ra = (re * sf) / Math.pow(ra, sn);
  let theta = lon * DEGRAD - olon;
  if (theta > Math.PI) theta -= 2.0 * Math.PI;
  if (theta < -Math.PI) theta += 2.0 * Math.PI;
  theta *= sn;

  return {
    nx: Math.floor(ra * Math.sin(theta) + XO + 0.5),
    ny: Math.floor(ro - ra * Math.cos(theta) + YO + 0.5),
  };
}

// getUltraSrtNcst(초단기실황)는 매시 40분에 그 시각 관측값이 올라옴 -> 40분 이전이면 한 시간 전 값을 요청해야 함
function getKmaBaseDateTime() {
  const now = new Date();
  if (now.getMinutes() < 40) now.setHours(now.getHours() - 1);
  const pad = (n) => String(n).padStart(2, "0");
  const base_date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const base_time = `${pad(now.getHours())}00`;
  return { base_date, base_time };
}

async function fetchKma(place) {
  const { nx, ny } = latLonToKmaGrid(place.latitude, place.longitude);
  const { base_date, base_time } = getKmaBaseDateTime();

  const url =
    `https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getUltraSrtNcst` +
    `?serviceKey=${encodeURIComponent(KMA_KEY)}&pageNo=1&numOfRows=20&dataType=JSON` +
    `&base_date=${base_date}&base_time=${base_time}&nx=${nx}&ny=${ny}`;

  const res = await fetch(url);
  const text = await res.text();

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return { error: "응답 형식 오류 (국내 지역이 아닐 수 있어요)" };
  }

  const header = data?.response?.header;
  if (!header || header.resultCode !== "00") {
    return { error: header?.resultMsg || "조회 실패" };
  }

  const items = data.response.body.items.item;
  const byCategory = {};
  items.forEach((it) => (byCategory[it.category] = it.obsrValue));

  return {
    temp: byCategory.T1H !== undefined ? `${byCategory.T1H}°C` : "-",
    humidity: byCategory.REH !== undefined ? `${byCategory.REH}%` : "-",
    wind: byCategory.WSD !== undefined ? `${(Number(byCategory.WSD) * 3.6).toFixed(1)} km/h` : "-",
    desc: describeKmaPty(Number(byCategory.PTY)),
  };
}

// getVilageFcst(단기예보)는 하루 8번(02,05,08,11,14,17,20,23시) 발표되고, 발표 후 약 10분 뒤부터 조회 가능
function getVilageFcstBaseDateTime() {
  const issueTimes = [2, 5, 8, 11, 14, 17, 20, 23];
  const now = new Date();
  now.setMinutes(now.getMinutes() - 10);
  const pad = (n) => String(n).padStart(2, "0");
  let chosen = issueTimes.filter(h => h <= now.getHours()).pop();
  if (chosen === undefined) {
    now.setDate(now.getDate() - 1);
    chosen = 23;
  }
  const base_date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const base_time = `${pad(chosen)}00`;
  return { base_date, base_time };
}

// 기상청 단기예보: 최대 3일치, 3시간 간격 데이터를 날짜별로 묶어서 최고/최저 기온 + 하늘상태로 요약
async function fetchKmaForecast(place) {
  const { nx, ny } = latLonToKmaGrid(place.latitude, place.longitude);
  const { base_date, base_time } = getVilageFcstBaseDateTime();

  const url =
    `https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getVilageFcst` +
    `?serviceKey=${encodeURIComponent(KMA_KEY)}&pageNo=1&numOfRows=1000&dataType=JSON` +
    `&base_date=${base_date}&base_time=${base_time}&nx=${nx}&ny=${ny}`;

  const res = await fetch(url);
  const text = await res.text();

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return { error: "응답 형식 오류" };
  }

  const header = data?.response?.header;
  if (!header || header.resultCode !== "00") {
    return { error: header?.resultMsg || "조회 실패" };
  }

  const items = data.response.body.items.item;
  const byDate = {};
  items.forEach(it => {
    const d = (byDate[it.fcstDate] ||= { tmp: [], sky: {}, pty: {}, tmn: null, tmx: null });
    if (it.category === "TMP") d.tmp.push(Number(it.fcstValue));
    if (it.category === "SKY") d.sky[it.fcstTime] = it.fcstValue;
    if (it.category === "PTY") d.pty[it.fcstTime] = it.fcstValue;
    if (it.category === "TMN") d.tmn = Number(it.fcstValue);
    if (it.category === "TMX") d.tmx = Number(it.fcstValue);
  });

  const days = Object.keys(byDate).sort().map(dateKey => {
    const d = byDate[dateKey];
    const times = Object.keys(d.sky).sort();
    const midTime = times.find(t => t >= "1200") || times[times.length - 1] || times[0];
    const skyCode = Number(d.sky[midTime] || 1);
    const ptyCode = Number(d.pty[midTime] || 0);
    const desc = ptyCode > 0 ? describeKmaPty(ptyCode) : describeKmaSky(skyCode);
    const max = d.tmx !== null ? d.tmx : (d.tmp.length ? Math.max(...d.tmp) : null);
    const min = d.tmn !== null ? d.tmn : (d.tmp.length ? Math.min(...d.tmp) : null);
    return { dateKey, desc, max, min };
  });

  return { days };
}

// ---- 도시 하나에 대해 소스들을 동시에 조회 ----
async function fetchCityWeather(city) {
  const place = await geocode(city);
  if (!place) return { ok: false, query: city };

  const [openMeteo, kma, kmaForecast] = await Promise.all([
    fetchOpenMeteo(place),
    fetchKma(place).catch(err => ({ error: err.message })),
    fetchKmaForecast(place).catch(err => ({ error: err.message })),
  ]);

  return {
    ok: true,
    query: city,
    label: `${place.name}${place.admin1 ? ", " + place.admin1 : ""} (${place.country})`,
    openMeteo,
    kma,
    kmaForecast,
  };
}

// ---- 렌더링 ----
function renderProviderBlock(name, p) {
  if (!p) return "";
  if (p.error) {
    return `<div class="provider-block"><div class="provider-name">${name}</div><div class="provider-error">${p.error}</div></div>`;
  }
  const descLine = p.desc ? `<div class="provider-line">${p.desc}</div>` : "";
  return `
    <div class="provider-block">
      <div class="provider-name">${name}</div>
      <div class="provider-line">기온 ${p.temp}${p.feelsLike ? ` (체감 ${p.feelsLike})` : ""}</div>
      <div class="provider-line">습도 ${p.humidity} · 풍속 ${p.wind}</div>
      ${descLine}
    </div>`;
}

function renderTempCompare(data) {
  const providers = [
    { name: "Open-Meteo", temp: data.openMeteo?.temp },
    { name: "기상청", temp: data.kma?.temp },
  ].filter(p => p.temp && p.temp !== "-");

  if (providers.length < 2) return "";

  const values = providers.map(p => parseFloat(p.temp));
  const maxDiff = (Math.max(...values) - Math.min(...values)).toFixed(1);
  const line = providers.map(p => `${p.name} ${p.temp}`).join(" · ");

  return `<div class="compare-line">기온 비교: ${line} (차이 ${maxDiff}°C)</div>`;
}

function renderForecastDay(day, kmaForecast) {
  const kmaDay = kmaForecast?.days?.find(d => d.dateKey === day.dateKey);
  const kmaPart = kmaDay
    ? `
      <div class="forecast-source kma">기상청</div>
      <div class="forecast-desc">${kmaDay.desc}</div>
      <div class="forecast-temps"><span class="max">${kmaDay.max}°</span> / <span class="min">${kmaDay.min}°</span></div>`
    : `<div class="forecast-source muted">기상청 자료 없음</div>`;

  return `
    <div class="forecast-day">
      <div class="forecast-label">${day.label}</div>
      <div class="forecast-source">Open-Meteo</div>
      <div class="forecast-desc">${day.desc}</div>
      <div class="forecast-temps"><span class="max">${day.max}°</span> / <span class="min">${day.min}°</span></div>
      ${kmaPart}
    </div>`;
}

function renderDayTimeline(timeline) {
  return `
    <div class="timeline-row">
      <div class="timeline-label">${timeline.label}</div>
      <div class="timeline-periods">
        ${timeline.periods.map(p => `
          <div class="timeline-period${p.hasRain ? " rain" : ""}">
            <div class="tp-label">${p.label}</div>
            <div class="tp-desc">${p.desc}</div>
            ${p.max !== null ? `<div class="tp-temp">${p.max}° / ${p.min}°</div>` : ""}
            ${p.pop > 0 ? `<div class="tp-pop">강수 ${p.pop}%</div>` : ""}
          </div>
        `).join("")}
      </div>
    </div>`;
}

function renderCityBlock(data) {
  if (!data.ok) {
    return `
      <div class="city-block error">
        <div class="place-name">${data.query}</div>
        <div class="error-msg">해당 도시를 찾을 수 없어요.</div>
      </div>`;
  }

  return `
    <div class="city-block">
      <div class="place-name">${data.label}</div>

      <div class="section-label">오늘 · 내일 한눈에 보기</div>
      ${data.openMeteo.dayTimelines.map(renderDayTimeline).join("")}

      ${renderTempCompare(data)}

      <div class="provider-row">
        ${renderProviderBlock("Open-Meteo", data.openMeteo)}
        ${renderProviderBlock("기상청", data.kma)}
      </div>

      <div class="section-label">시간대별 예보 (Open-Meteo)</div>
      <div class="hourly-row">
        ${data.openMeteo.hourlyForecast.map(h => `
          <div class="hourly-item">
            <div class="hourly-label">${h.label}</div>
            <div class="hourly-temp">${h.temp}°</div>
            <div class="hourly-desc">${h.desc}</div>
          </div>
        `).join("")}
      </div>

      <div class="section-label">이번 주 예보 비교 (Open-Meteo · 기상청 최대 3일)</div>
      <div class="forecast-row">
        ${data.openMeteo.forecast.map(day => renderForecastDay(day, data.kmaForecast)).join("")}
      </div>
    </div>`;
}

async function searchCities(rawInput) {
  const cities = rawInput
    .split(",")
    .map(c => c.trim())
    .filter(c => c.length > 0);

  if (cities.length === 0) return;

  resultsContainer.innerHTML = "";
  statusMsg.textContent = `${cities.length}개 도시 검색 중...`;

  try {
    const results = await Promise.all(cities.map(fetchCityWeather));
    resultsContainer.innerHTML = results.map(renderCityBlock).join("");
    statusMsg.textContent = "";
  } catch (err) {
    statusMsg.textContent = "데이터를 가져오는 중 오류가 발생했어요. 인터넷 연결을 확인해주세요.";
    console.error(err);
  }
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  searchCities(cityInput.value);
});

searchCities(cityInput.value);
