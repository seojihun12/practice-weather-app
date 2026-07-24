import {
  KMA_KEY,
  describeWeatherCode,
  describeKmaPty,
  describeKmaSky,
  formatDayLabel,
  formatHourLabel,
  DAY_PERIODS,
} from "./constants.js";
import { geocode } from "./geocode.js";

// 한 구간(새벽/오전/오후/저녁)에 속한 시간별 데이터를 요약: 최고/최저 기온, 최대 강수확률,
// 대표 날씨(비가 하나라도 있으면 그중 가장 강한 비를 우선 표시).
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

// 특정 날짜(dateStr)의 시간별 데이터를 4구간으로 나눠 요약. 오늘/내일 한눈에 보기 카드에 쓰임.
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

// ---- 소스 1: Open-Meteo (키 불필요, 전세계 지원) ----
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
    pop: hourly.precipitation_probability[startIdx + i],
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

// 기상청 초단기실황(현재 관측값) 조회
async function fetchKma(place) {
  const { nx, ny } = latLonToKmaGrid(place.latitude, place.longitude);
  const { base_date, base_time } = getKmaBaseDateTime();

  // HTTPS로 호출해야 함: GitHub Pages(HTTPS)에서 http:// 요청은 Mixed Content로 브라우저가 차단함.
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

// 도시 하나에 대해 지오코딩 + 모든 날씨 소스를 동시에 조회
export async function fetchCityWeather(city) {
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
